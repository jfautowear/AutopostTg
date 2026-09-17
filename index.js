require('dotenv').config();

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./services/postService');
const {
  getBot,
  getTestChatId,
} = require('./services/telegramService');
const {
  loadSchedule,
  shouldPostNow,
  alreadyPostedSlot,
  formatScheduleText,
  currentTimeLabel,
} = require('./services/scheduleService');
const {
  handleAdminCommand,
  isAdmin,
  denyText,
  parseCommand,
  replyOpts,
} = require('./services/adminBotService');

async function safeReply(bot, msg, text, extra = {}) {
  try {
    return await bot.sendMessage(msg.chat.id, text, replyOpts(msg, extra));
  } catch (err) {
    console.warn('[bot] safeReply retry plain:', err.message);
    return bot.sendMessage(msg.chat.id, text, extra);
  }
}

async function runAutoPost(slot = null, category = null) {
  return runPipeline({ target: 'channel', slot, category });
}

async function runTestCommand(msg, category = 'spot') {
  const bot = getBot();
  const chatId = msg.chat.id;
  const statusMsg = await safeReply(
    bot,
    msg,
    category === 'airdrop'
      ? '⏳ Scan DEX trending & generate konten Airdrop/Early Gem...'
      : '⏳ Sedang mengambil data market terbaru & generate konten AI...'
  );


  try {
    if (!getTestChatId()) {
      throw new Error(
        'TEST_CHAT_ID belum diisi di .env (pakai ID numerik grup private, bukan link invite t.me/+...).'
      );
    }

    const result = await runPipeline({ target: 'test', category });
    const label =
      category === 'airdrop'
        ? result.snapshot?.hotGem
          ? `${result.snapshot.hotGem.symbol}@${result.snapshot.hotGem.chain}`
          : '—'
        : result.snapshot?.hotCoin?.base || '—';

    await bot.editMessageText(
      `✅ Tes berhasil (${category})!\n📦 Preview dikirim ke grup private testing.\n🔥 ${label}\n📝 ${result.captionLength} karakter`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );
    return result;
  } catch (err) {
    console.error('[test] Gagal:', err.message);
    try {
      await bot.editMessageText(`❌ Tes gagal: ${err.message}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    } catch {
      await safeReply(bot, msg, `❌ Tes gagal: ${err.message}`);
    }
    throw err;
  }
}

async function runPostNowCommand(msg, category = 'spot') {
  const bot = getBot();
  const chatId = msg.chat.id;
  const statusMsg = await safeReply(
    bot,
    msg,
    category === 'airdrop'
      ? '⏳ Posting Airdrop/DEX ke channel...'
      : '⏳ Posting ke channel utama...'
  );


  try {
    const result = await runPipeline({
      target: 'channel',
      slot: `manual-${Date.now()}`,
      category,
    });
    await bot.editMessageText(
      `✅ Post berhasil (${result.category})!\n🆔 ${result.chatId}#${result.messageId}`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );
    return result;
  } catch (err) {
    console.error('[postnow] Gagal:', err.message);
    try {
      await bot.editMessageText(`❌ Post gagal: ${err.message}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    } catch {
      await safeReply(bot, msg, `❌ Post gagal: ${err.message}`);
    }
    throw err;
  }
}

async function handleIncomingMessage(msg) {
  if (!msg?.text) return;

  const parsed = parseCommand(msg.text);
  if (!parsed) return;

  if (!isAdmin(msg)) {
    if (
      msg.chat?.type === 'private' ||
      ['/test', '/postnow', '/test_airdrop', '/airdrop'].includes(parsed.cmd)
    ) {
      await safeReply(getBot(), msg, denyText());
    }
    return;
  }

  console.log(`[bot] cmd @${msg.from?.username}: ${msg.text}`);

  if (parsed.cmd === '/test') {
    await runTestCommand(msg, 'spot');
    return;
  }

  if (parsed.cmd === '/test_airdrop' || parsed.cmd === '/testairdrop') {
    await runTestCommand(msg, 'airdrop');
    return;
  }

  if (
    parsed.cmd === '/postnow' ||
    parsed.cmd === '/post_sekarang' ||
    parsed.cmd === '/post_now'
  ) {
    await runPostNowCommand(msg, 'spot');
    return;
  }

  if (parsed.cmd === '/airdrop' || parsed.cmd === '/post_airdrop') {
    await runPostNowCommand(msg, 'airdrop');
    return;
  }

  const result = handleAdminCommand(msg);
  if (result.reply) {
    await safeReply(getBot(), msg, result.reply, {
      parse_mode: result.parseMode || undefined,
    });
  }

  if (result.exchangeSource || result.postCategory) {
    const runtimePath = path.join(__dirname, 'config', 'runtime.json');
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    } catch {
      data = {};
    }
    if (result.exchangeSource) data.exchangeSource = result.exchangeSource;
    if (result.postCategory) data.postCategory = result.postCategory;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(runtimePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function startCommandBot() {
  // Hindari double instance: buat bot polling baru
  const bot = getBot({ polling: false, forceNew: true });

  bot
    .deleteWebHook({ drop_pending_updates: false })
    .then(() => {
      console.log('[bot] Webhook cleared, start polling…');
      return bot.startPolling();
    })
    .catch((err) => {
      console.warn('[bot] deleteWebhook/startPolling:', err.message);
      return bot.startPolling();
    });

  console.log('[bot] Polling command aktif (/test, /postnow, /jadwal, ...)');
  console.log(
    `[bot] Admin only: @${process.env.ADMIN_TELEGRAM_USERNAME || 'jfnetworkindo'}`
  );

  bot.on('message', (msg) => {
    handleIncomingMessage(msg).catch((err) => {
      console.error('[bot] Handler error:', err.message);
    });
  });

  bot.on('polling_error', (err) => {
    console.error('[bot] polling_error:', err.message);
  });

  return bot;
}

async function runOnceRespectingSchedule() {
  const force =
    process.argv.includes('--force') ||
    process.env.FORCE_POST === 'true' ||
    process.env.FORCE_POST === '1';

  const schedule = loadSchedule();
  console.log(formatScheduleText(schedule));
  console.log(`[autopost] Waktu sekarang: ${currentTimeLabel(schedule.timezone)}`);

  if (force) {
    const cat = process.argv.includes('--airdrop') ? 'airdrop' : null;
    console.log(`[autopost] FORCE_POST aktif${cat ? ` (${cat})` : ''}`);
    return runAutoPost(`force-${Date.now()}`, cat);
  }

  if (process.argv.includes('--test')) {
    const cat = process.argv.includes('--airdrop') ? 'airdrop' : 'spot';
    console.log(`[autopost] Mode --test → TEST_CHAT_ID (${cat})`);
    return runPipeline({ target: 'test', category: cat });
  }

  if (process.argv.includes('--airdrop')) {
    console.log('[autopost] Mode --airdrop → channel');
    return runPipeline({
      target: 'channel',
      slot: `airdrop-${Date.now()}`,
      category: 'airdrop',
    });
  }

  const check = shouldPostNow(schedule);
  if (!check.match) {
    console.log('[autopost] Skip — di luar jadwal (pakai --force / --test)');
    return { skipped: true };
  }

  if (alreadyPostedSlot(check.slot)) {
    console.log(`[autopost] Skip — slot ${check.slot} sudah dipost`);
    return { skipped: true, reason: 'duplicate_slot' };
  }

  return runAutoPost(check.slot);
}

function startScheduler() {
  const timezone = loadSchedule().timezone || 'Asia/Jakarta';
  console.log(`[scheduler] Watcher aktif tiap menit (${timezone})`);
  console.log(formatScheduleText());
  console.log(`[scheduler] Channel: ${process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet'}`);
  console.log(`[scheduler] TEST_CHAT_ID: ${getTestChatId() || '(belum di-set)'}`);

  cron.schedule(
    '* * * * *',
    () => {
      const schedule = loadSchedule();
      const check = shouldPostNow(schedule, new Date(), 0);
      if (!check.match) return;
      if (alreadyPostedSlot(check.slot)) return;

      runAutoPost(check.slot).catch((err) => {
        console.error('[autopost] Gagal:', err.message);
      });
    },
    { timezone }
  );

  if (process.env.RUN_ON_START === 'true') {
    console.log('[scheduler] RUN_ON_START=true → eksekusi segera');
    runAutoPost(`start-${Date.now()}`).catch((err) =>
      console.error('[autopost] Gagal:', err.message)
    );
  }
}

async function main() {
  const once =
    process.argv.includes('--once') || process.env.GITHUB_ACTIONS === 'true';

  if (once) {
    try {
      await runOnceRespectingSchedule();
      process.exit(0);
    } catch (err) {
      console.error('[autopost] Gagal:', err.message);
      if (err.response?.data) {
        console.error('[autopost] Detail:', JSON.stringify(err.response.data));
      }
      process.exit(1);
    }
    return;
  }

  startScheduler();
  startCommandBot();
  console.log('[scheduler] Menunggu jadwal + command Telegram...');
  console.log('[scheduler] /test → preview grup private | /postnow → channel');
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});

module.exports = {
  runPipeline,
  runAutoPost,
  runTestCommand,
  runPostNowCommand,
  handleIncomingMessage,
};
