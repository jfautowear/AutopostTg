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
} = require('./services/adminBotService');

async function runAutoPost(slot = null) {
  return runPipeline({ target: 'channel', slot });
}

async function runTestCommand(msg) {
  const bot = getBot();
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(
    chatId,
    '⏳ Sedang mengambil data market terbaru & generate konten AI...',
    { reply_to_message_id: msg.message_id }
  );

  try {
    if (!getTestChatId()) {
      throw new Error(
        'TEST_CHAT_ID belum diisi di .env (pakai ID numerik grup private, bukan link invite t.me/+...).'
      );
    }

    const result = await runPipeline({ target: 'test' });
    const hot = result.snapshot?.hotCoin?.base || '—';

    await bot.editMessageText(
      `✅ Tes berhasil!\n📦 Preview dikirim ke grup private testing.\n🔥 Hot coin: ${hot}\n📝 ${result.captionLength} karakter`,
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
      await bot.sendMessage(chatId, `❌ Tes gagal: ${err.message}`, {
        reply_to_message_id: msg.message_id,
      });
    }
    throw err;
  }
}

async function runPostNowCommand(msg) {
  const bot = getBot();
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(
    chatId,
    '⏳ Posting ke channel utama...',
    { reply_to_message_id: msg.message_id }
  );

  try {
    const result = await runPipeline({
      target: 'channel',
      slot: `manual-${Date.now()}`,
    });
    await bot.editMessageText(
      `✅ Post berhasil ke channel!\n🆔 ${result.chatId}#${result.messageId}`,
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
      await bot.sendMessage(chatId, `❌ Post gagal: ${err.message}`, {
        reply_to_message_id: msg.message_id,
      });
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
      parsed.cmd === '/test' ||
      parsed.cmd === '/postnow'
    ) {
      await getBot().sendMessage(msg.chat.id, denyText(), {
        reply_to_message_id: msg.message_id,
      });
    }
    return;
  }

  if (parsed.cmd === '/test') {
    await runTestCommand(msg);
    return;
  }

  if (
    parsed.cmd === '/postnow' ||
    parsed.cmd === '/post_sekarang' ||
    parsed.cmd === '/post_now'
  ) {
    await runPostNowCommand(msg);
    return;
  }

  const result = handleAdminCommand(msg);
  if (result.reply) {
    await getBot().sendMessage(msg.chat.id, result.reply, {
      reply_to_message_id: msg.message_id,
      parse_mode: result.parseMode || undefined,
    });
  }

  if (result.exchangeSource) {
    const runtimePath = path.join(__dirname, 'config', 'runtime.json');
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    } catch {
      data = {};
    }
    data.exchangeSource = result.exchangeSource;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(runtimePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function startCommandBot() {
  // Hindari double instance: buat bot polling baru
  const bot = getBot({ polling: true, forceNew: true });
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
    console.log('[autopost] FORCE_POST aktif');
    return runAutoPost(`force-${Date.now()}`);
  }

  if (process.argv.includes('--test')) {
    console.log('[autopost] Mode --test → kirim ke TEST_CHAT_ID');
    return runPipeline({ target: 'test' });
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
