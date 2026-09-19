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
  publicPrivateMessage,
  parseCommand,
  replyOpts,
  syncBotCommands,
} = require('./services/adminBotService');
const {
  recordMessage,
  recordReaction,
  activityEnabled,
  getActivityChatRef,
  resetWeek,
} = require('./services/activityService');
const { postWeeklyTop, statusText } = require('./services/weeklyTopService');

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
      : category === 'news'
        ? '⏳ Ambil pengumuman OKX (listing/event/promo)...'
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
        : category === 'news'
          ? result.snapshot?.hotNews?.title?.slice(0, 40) || '—'
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
      : category === 'news'
        ? '⏳ Posting berita/promo OKX ke channel...'
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

  const isPrivate = msg.chat?.type === 'private';
  const parsed = parseCommand(msg.text);

  // Non-admin: di chat pribadi selalu balas ramah + 2 tombol (bukan daftar command)
  if (!isAdmin(msg)) {
    if (isPrivate) {
      const pub = publicPrivateMessage();
      await safeReply(getBot(), msg, pub.text, { reply_markup: pub.reply_markup });
    }
    return;
  }

  // Admin, tapi bukan command → tip singkat
  if (!parsed) {
    if (isPrivate) {
      await safeReply(
        getBot(),
        msg,
        '🛠 Mode admin aktif. Ketik /help untuk daftar command.'
      );
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

  if (parsed.cmd === '/test_news' || parsed.cmd === '/testnews') {
    await runTestCommand(msg, 'news');
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

  if (parsed.cmd === '/news' || parsed.cmd === '/post_news' || parsed.cmd === '/promo') {
    await runPostNowCommand(msg, 'news');
    return;
  }

  if (
    parsed.cmd === '/topaktif' ||
    parsed.cmd === '/top_aktif' ||
    parsed.cmd === '/topaktif_post' ||
    parsed.cmd === '/top_aktif_post' ||
    parsed.cmd === '/topaktif_test' ||
    parsed.cmd === '/top_aktif_test' ||
    parsed.cmd === '/topaktif_reset' ||
    parsed.cmd === '/top_aktif_reset'
  ) {
    await runTopAktifCommand(msg, parsed.cmd);
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

async function runTopAktifCommand(msg, cmd) {
  const bot = getBot();
  let mode = 'status';
  if (String(cmd).includes('post')) mode = 'post';
  else if (String(cmd).includes('test')) mode = 'test';
  else if (String(cmd).includes('reset')) mode = 'reset';

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
        `✅ Preview Top Aktif terkirim (test).\n👥 ${result.count} user | minggu ${result.weekKey}`
      );
      return;
    }
    if (mode === 'post') {
      const statusMsg = await safeReply(bot, msg, '⏳ Mengirim Top 10 ke grup...');
      const result = await postWeeklyTop({ force: true, isTest: false });
      try {
        await bot.editMessageText(
          `✅ Top Aktif dipost!\n💬 ${result.chatId}#${result.messageId}\n👥 ${result.count} user`,
          { chat_id: msg.chat.id, message_id: statusMsg.message_id }
        );
      } catch {
        await safeReply(
          bot,
          msg,
          `✅ Top Aktif dipost!\n💬 ${result.chatId}#${result.messageId}`
        );
      }
    }
  } catch (err) {
    console.error('[topaktif] Gagal:', err.message);
    await safeReply(bot, msg, `❌ Top Aktif gagal: ${err.message}`);
  }
}

function startCommandBot() {
  const bot = getBot({ polling: false, forceNew: true });
  // gha = tracking via Actions (default). local = PC mencatat aktivitas.
  const activitySource = (process.env.ACTIVITY_SOURCE || 'gha').toLowerCase();
  const trackLocal = activitySource === 'local' && activityEnabled();

  const pollingOpts = {
    params: {
      allowed_updates: trackLocal
        ? ['message', 'edited_message', 'message_reaction']
        : ['message'],
    },
  };

  bot
    .deleteWebHook({ drop_pending_updates: false })
    .then(() => syncBotCommands(bot))
    .then(() => {
      console.log('[bot] Webhook cleared, start polling…');
      return bot.startPolling(pollingOpts);
    })
    .catch((err) => {
      console.warn('[bot] deleteWebhook/startPolling:', err.message);
      return bot.startPolling(pollingOpts);
    });

  console.log('[bot] Polling command aktif (/test, /news, /postnow, /topaktif, ...)');
  console.log(
    `[bot] Admin only: @${process.env.ADMIN_TELEGRAM_USERNAME || 'jfnetworkindo'}`
  );

  if (trackLocal) {
    console.log(`[bot] Top Aktif LOCAL tracking: ${getActivityChatRef()}`);
  } else {
    console.log(
      '[bot] Top Aktif via GitHub Actions (ACTIVITY_SOURCE=gha). Jangan biarkan npm start ON terus — bentrok getUpdates.'
    );
  }

  bot.on('message', (msg) => {
    if (trackLocal) {
      try {
        recordMessage(msg);
      } catch (err) {
        console.warn('[activity] recordMessage:', err.message);
      }
    }

    handleIncomingMessage(msg).catch((err) => {
      console.error('[bot] Handler error:', err.message);
    });
  });

  if (trackLocal) {
    bot.on('message_reaction', (reaction) => {
      try {
        recordReaction(reaction);
      } catch (err) {
        console.warn('[activity] recordReaction:', err.message);
      }
    });
  }

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
    const cat = process.argv.includes('--airdrop')
      ? 'airdrop'
      : process.argv.includes('--news')
        ? 'news'
        : null;
    console.log(`[autopost] FORCE_POST aktif${cat ? ` (${cat})` : ''}`);
    return runAutoPost(`force-${Date.now()}`, cat);
  }

  if (process.argv.includes('--test')) {
    const cat = process.argv.includes('--airdrop')
      ? 'airdrop'
      : process.argv.includes('--news')
        ? 'news'
        : 'spot';
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

  if (process.argv.includes('--news')) {
    console.log('[autopost] Mode --news → channel');
    return runPipeline({
      target: 'channel',
      slot: `news-${Date.now()}`,
      category: 'news',
    });
  }

  // Samakan jendela dengan scripts/checkSchedule.js
  // GHA cron sering delay 30–90+ menit → default lokal 30m, Actions 360m
  const windowMinutes =
    process.env.GITHUB_ACTIONS === 'true'
      ? Number(process.env.SCHEDULE_WINDOW_MINUTES) || 360
      : Number(process.env.SCHEDULE_WINDOW_MINUTES) || 30;

  const check = shouldPostNow(schedule, new Date(), windowMinutes);
  if (!check.match) {
    console.log(
      `[autopost] Skip — di luar jadwal (±${windowMinutes}m). Pakai --force / FORCE_POST=true`
    );
    return { skipped: true };
  }

  if (alreadyPostedSlot(check.slot)) {
    console.log(`[autopost] Skip — slot ${check.slot} sudah dipost`);
    return { skipped: true, reason: 'duplicate_slot' };
  }

  console.log(`[autopost] Slot ${check.slot} OK (window ${windowMinutes}m)`);
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

  // Top 10 lokal hanya jika eksplisit (default = GHA announce, hindari double post)
  if (
    activityEnabled() &&
    String(process.env.ACTIVITY_LOCAL_CRON || '').toLowerCase() === 'true'
  ) {
    const weeklyCron = process.env.WEEKLY_TOP_CRON || '0 10 * * 6';
    console.log(`[scheduler] Weekly Top Aktif LOKAL: cron "${weeklyCron}" (${timezone})`);
    cron.schedule(
      weeklyCron,
      () => {
        postWeeklyTop({ force: false, isTest: false }).catch((err) => {
          console.error('[weeklyTop] Gagal:', err.message);
        });
      },
      { timezone }
    );
  } else if (activityEnabled()) {
    console.log('[scheduler] Weekly Top Aktif: via GitHub Actions (Sabtu pagi)');
  }

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
  console.log('[scheduler] /test → preview | /postnow → channel | /topaktif → ranking');
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
