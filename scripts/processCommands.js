/**
 * Poll Telegram updates → command admin (@jfnetworkindo).
 * Mendukung /test (ke TEST_CHAT_ID) dan /postnow (channel).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getBot, getTestChatId } = require('../services/telegramService');
const {
  handleAdminCommand,
  isAdmin,
  denyText,
} = require('../services/adminBotService');
const {
  loadSchedule,
  formatScheduleText,
} = require('../services/scheduleService');
const { runPipeline } = require('../services/postService');

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
    execSync('git add config/schedule.json config/telegram-offset.json config/runtime.json');
    const dirty = execSync('git status --porcelain config/').toString().trim();
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

async function executeTest(bot, msg, category = 'spot') {
  const statusMsg = await bot.sendMessage(
    msg.chat.id,
    category === 'airdrop'
      ? '⏳ Scan DEX trending & generate konten Airdrop/Early Gem...'
      : '⏳ Sedang mengambil data market terbaru & generate konten AI...',
    { reply_to_message_id: msg.message_id }
  );

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
        : result.snapshot?.hotCoin?.base || '—';
    await bot.editMessageText(
      `✅ Tes berhasil (${category})!\n📦 Preview → grup private\n🔥 ${label}\n📝 ${result.captionLength} karakter`,
      { chat_id: msg.chat.id, message_id: statusMsg.message_id }
    );
  } catch (err) {
    await bot.editMessageText(`❌ Tes gagal: ${err.message}`, {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
    });
  }
}

async function executePostNow(bot, msg, category = 'spot') {
  const statusMsg = await bot.sendMessage(
    msg.chat.id,
    category === 'airdrop'
      ? '⏳ Posting Airdrop/DEX ke channel...'
      : '⏳ Posting ke channel utama...',
    { reply_to_message_id: msg.message_id }
  );

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
    await bot.editMessageText(`❌ Post gagal: ${err.message}`, {
      chat_id: msg.chat.id,
      message_id: statusMsg.message_id,
    });
  }
}

async function processCommands() {
  const bot = getBot();
  let offset = readOffset();
  console.log(`[commands] Poll getUpdates offset=${offset}`);

  const updates = await bot.getUpdates({
    offset: offset > 0 ? offset : undefined,
    timeout: 0,
    allowed_updates: ['message'],
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
    const msg = update.message;
    if (!msg?.text) continue;

    const isPrivate = msg.chat?.type === 'private';
    const wantsCommand = String(msg.text).startsWith('/');

    if (!isAdmin(msg)) {
      if (isPrivate && wantsCommand) {
        await bot.sendMessage(msg.chat.id, denyText(), {
          reply_to_message_id: msg.message_id,
        });
      }
      continue;
    }

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
      await bot.sendMessage(msg.chat.id, result.reply, {
        reply_to_message_id: msg.message_id,
        parse_mode: result.parseMode || undefined,
      });
    }
  }

  writeOffset(offset);

  if (scheduleChanged || runtimeChanged || process.env.GITHUB_ACTIONS === 'true') {
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
