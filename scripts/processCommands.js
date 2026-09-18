/**
 * Poll Telegram updates → command admin (@jfnetworkindo).
 * Mendukung /test, /test_airdrop, /postnow, /airdrop.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getBot, getTestChatId } = require('../services/telegramService');
const {
  handleAdminCommand,
  isAdmin,
  publicPrivateMessage,
  replyOpts,
} = require('../services/adminBotService');
const {
  loadSchedule,
  formatScheduleText,
} = require('../services/scheduleService');
const { runPipeline } = require('../services/postService');
const {
  recordMessage,
  recordReaction,
  resetWeek,
} = require('../services/activityService');
const { postWeeklyTop, statusText } = require('../services/weeklyTopService');

const OFFSET_PATH = path.join(__dirname, '..', 'config', 'telegram-offset.json');
const RUNTIME_PATH = path.join(__dirname, '..', 'config', 'runtime.json');

function readOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0;
  } catch {
    return 0;
  }
}

function writeOffset(offset) {
  fs.mkdirSync(path.dirname(OFFSET_PATH), { recursive: true });
  fs.writeFileSync(
    OFFSET_PATH,
    `${JSON.stringify({ offset, updatedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

function readRuntime() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
  } catch {
    return { exchangeSource: 'auto' };
  }
}

function writeRuntime(patch) {
  const data = { ...readRuntime(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(RUNTIME_PATH, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function gitSync(message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

  try {
    execSync('git config user.name "autopost-bot"');
    execSync('git config user.email "autopost-bot@users.noreply.github.com"');
    execSync('git pull --rebase origin HEAD || true', { shell: true });
    execSync(
      'git add config/schedule.json config/telegram-offset.json config/runtime.json data/activity-week.json'
    );
    const dirty = execSync(
      'git status --porcelain config/ data/activity-week.json'
    ).toString().trim();
    if (!dirty) return;
    execSync(`git commit -m "${message}"`);
    execSync('git push');
    console.log('[commands] Config di-push ke repo');
  } catch (err) {
    console.error('[commands] git sync gagal:', err.message);
  }
}

function setOutput(forcePost) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `force_post=${forcePost ? 'true' : 'false'}\n`
    );
  }
}

async function safeReply(bot, msg, text, extra = {}) {
  try {
    return await bot.sendMessage(msg.chat.id, text, replyOpts(msg, extra));
  } catch (err) {
    console.warn('[commands] safeReply retry plain:', err.message);
    return bot.sendMessage(msg.chat.id, text, extra);
  }
}

async function executeTest(bot, msg, category = 'spot') {
  let statusMsg;
  try {
    statusMsg = await safeReply(
      bot,
      msg,
      category === 'airdrop'
        ? '⏳ Scan DEX trending & generate konten Airdrop/Early Gem...'
        : category === 'news'
          ? '⏳ Ambil pengumuman OKX (listing/event/promo)...'
          : '⏳ Sedang mengambil data market terbaru & generate konten AI...'
    );
  } catch (err) {
    console.error('[commands] gagal kirim status:', err.message);
    return;
  }

  try {
    if (!getTestChatId()) {
      throw new Error('TEST_CHAT_ID belum di-set (ID numerik grup private).');
    }
    const result = await runPipeline({ target: 'test', category });
    const label =
      category === 'airdrop'
        ? result.snapshot?.hotGem
          ? `${result.snapshot.hotGem.symbol}@${result.snapshot.hotGem.chain}`
          : '—'
        : category === 'news'
          ? result.snapshot?.hotNews?.title?.slice(0, 40) || '—'
          : result.snapshot?.hotCoin?.base || '—';
    await bot.editMessageText(
      `✅ Tes berhasil (${category})!\n📦 Preview → grup private\n🔥 ${label}\n📝 ${result.captionLength} karakter`,
      { chat_id: msg.chat.id, message_id: statusMsg.message_id }
    );
  } catch (err) {
    try {
      await bot.editMessageText(`❌ Tes gagal: ${err.message}`, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id,
      });
    } catch {
      await safeReply(bot, msg, `❌ Tes gagal: ${err.message}`);
    }
  }
}

async function executePostNow(bot, msg, category = 'spot') {
  let statusMsg;
  try {
    statusMsg = await safeReply(
      bot,
      msg,
      category === 'airdrop'
        ? '⏳ Posting Airdrop/DEX ke channel...'
        : category === 'news'
          ? '⏳ Posting berita/promo OKX ke channel...'
          : '⏳ Posting ke channel utama...'
    );
  } catch (err) {
    console.error('[commands] gagal kirim status:', err.message);
    return;
  }

  try {
    const result = await runPipeline({
      target: 'channel',
      slot: `cmd-${Date.now()}`,
      category,
    });
    await bot.editMessageText(
      `✅ Post berhasil (${result.category})!\n🆔 ${result.chatId}#${result.messageId}`,
      { chat_id: msg.chat.id, message_id: statusMsg.message_id }
    );
  } catch (err) {
    try {
      await bot.editMessageText(`❌ Post gagal: ${err.message}`, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id,
      });
    } catch {
      await safeReply(bot, msg, `❌ Post gagal: ${err.message}`);
    }
  }
}

async function executeTopAktif(bot, msg, mode = 'status') {
  try {
    if (mode === 'status') {
      await safeReply(bot, msg, statusText());
      return;
    }
    if (mode === 'reset') {
      resetWeek();
      await safeReply(bot, msg, '✅ Skor Top Aktif minggu ini di-reset.');
      return;
    }
    if (mode === 'test') {
      const result = await postWeeklyTop({
        force: true,
        isTest: true,
        targetChatId: msg.chat.id,
      });
      await safeReply(
        bot,
        msg,
        `✅ Preview Top Aktif (test).\n👥 ${result.count} | minggu ${result.weekKey}`
      );
      return;
    }
    if (mode === 'post') {
      const result = await postWeeklyTop({ force: true, isTest: false });
      await safeReply(
        bot,
        msg,
        `✅ Top Aktif dipost!\n💬 ${result.chatId}#${result.messageId}\n👥 ${result.count}`
      );
    }
  } catch (err) {
    await safeReply(bot, msg, `❌ Top Aktif gagal: ${err.message}`);
  }
}

async function processCommands() {
  const bot = getBot();

  try {
    await bot.deleteWebHook({ drop_pending_updates: false });
    console.log('[commands] Webhook dihapus (siap polling getUpdates)');
  } catch (err) {
    console.warn('[commands] deleteWebhook:', err.message);
  }

  let offset = readOffset();
  console.log(`[commands] Poll getUpdates offset=${offset}`);

  const updates = await bot.getUpdates({
    offset: offset > 0 ? offset : undefined,
    timeout: 0,
    allowed_updates: ['message', 'message_reaction'],
  });

  if (!updates.length) {
    console.log('[commands] Tidak ada update baru');
    setOutput(false);
    return { processed: 0, forcePost: false };
  }

  let scheduleChanged = false;
  let runtimeChanged = false;
  let forcePost = false;
  let processed = 0;

  for (const update of updates) {
    offset = update.update_id + 1;

    if (update.message_reaction) {
      try {
        recordReaction(update.message_reaction);
      } catch (err) {
        console.warn('[commands] reaction:', err.message);
      }
      continue;
    }

    const msg = update.message;
    if (!msg) continue;

    try {
      recordMessage(msg);
    } catch (err) {
      console.warn('[commands] activity:', err.message);
    }

    if (!msg.text) continue;

    const isPrivate = msg.chat?.type === 'private';

    if (!isAdmin(msg)) {
      console.warn(
        `[commands] Skip non-admin @${msg.from?.username || '?'} id=${msg.from?.id}`
      );
      if (isPrivate) {
        const pub = publicPrivateMessage();
        await safeReply(bot, msg, pub.text, { reply_markup: pub.reply_markup });
      }
      continue;
    }

    console.log(`[commands] Admin cmd from @${msg.from?.username}: ${msg.text}`);
    const result = handleAdminCommand(msg);
    processed += 1;

    if (result.runTest) {
      await executeTest(bot, msg, result.category || 'spot');
      continue;
    }

    if (result.runPostNow || result.forcePost) {
      await executePostNow(bot, msg, result.category || 'spot');
      forcePost = false;
      continue;
    }

    if (result.runTopAktif) {
      await executeTopAktif(bot, msg, result.runTopAktif);
      continue;
    }

    if (result.scheduleChanged) scheduleChanged = true;
    if (result.exchangeSource) {
      writeRuntime({ exchangeSource: result.exchangeSource });
      runtimeChanged = true;
    }
    if (result.postCategory) {
      writeRuntime({ postCategory: result.postCategory });
      runtimeChanged = true;
    }

    if (result.reply) {
      await safeReply(bot, msg, result.reply, {
        parse_mode: result.parseMode || undefined,
      });
    }
  }

  writeOffset(offset);

  const needGit =
    scheduleChanged ||
    runtimeChanged ||
    (process.env.GITHUB_ACTIONS === 'true' && updates.length > 0);

  if (needGit) {
    gitSync('chore: update jadwal/config via telegram admin @jfnetworkindo');
  }

  console.log(
    `[commands] processed=${processed}\n${formatScheduleText(loadSchedule())}`
  );
  setOutput(forcePost);
  return { processed, forcePost, schedule: loadSchedule() };
}

if (require.main === module) {
  processCommands()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[commands] Gagal:', err.message);
      process.exit(1);
    });
}

module.exports = { processCommands };
