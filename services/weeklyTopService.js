const { getBot } = require('./telegramService');
const {
  getTopUsers,
  markWeeklyPosted,
  alreadyPostedThisWeek,
  buildWeeklyTopCaption,
  buildWeeklyTopKeyboard,
  getActivityChatRef,
  loadStore,
  activityEnabled,
} = require('./activityService');

/**
 * Kirim ranking Top 10 ke topik grup (default: https://t.me/caricuanhp/65640).
 */
async function postWeeklyTop({ force = false, isTest = false, targetChatId = null } = {}) {
  if (!activityEnabled() && !force) {
    return { skipped: true, reason: 'disabled' };
  }

  const { ranked, weekKey, store } = getTopUsers(10);

  if (!force && !isTest && alreadyPostedThisWeek()) {
    console.log(`[weeklyTop] Skip — minggu ${weekKey} sudah dipost`);
    return { skipped: true, reason: 'already_posted', weekKey };
  }

  const bot = getBot();
  const chatId =
    targetChatId ||
    store.chatId ||
    process.env.ACTIVITY_CHAT_ID ||
    process.env.TELEGRAM_FORWARD_CHAT_ID ||
    getActivityChatRef();

  if (!chatId) {
    throw new Error('ACTIVITY_CHAT_ID / chat grup belum diketahui. Pastikan bot sudah menerima pesan di grup.');
  }

  const caption = buildWeeklyTopCaption(ranked, { isTest });
  const reply_markup = buildWeeklyTopKeyboard();

  // Topik forum: t.me/caricuanhp/65640 → message_thread_id=65640
  // Skip thread jika preview ke private/test chat
  const threadRaw =
    process.env.ACTIVITY_THREAD_ID ||
    process.env.WEEKLY_TOP_THREAD_ID ||
    '65640';
  let threadId = null;
  if (!isTest && threadRaw && String(threadRaw).toLowerCase() !== 'none') {
    const n = Number(threadRaw);
    if (Number.isFinite(n) && n > 0) threadId = n;
  }

  const opts = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup,
  };
  if (threadId) opts.message_thread_id = threadId;

  console.log(
    `[weeklyTop] → ${chatId}${threadId ? ` topic/${threadId}` : ''} | week=${weekKey} | top=${ranked.length} | test=${isTest}`
  );

  let sent;
  try {
    sent = await bot.sendMessage(chatId, caption, opts);
  } catch (err) {
    if (threadId) {
      console.warn(
        `[weeklyTop] Topic ${threadId} gagal (${err.message}), coba tanpa topic...`
      );
      delete opts.message_thread_id;
      sent = await bot.sendMessage(chatId, caption, opts);
    } else {
      throw err;
    }
  }

  if (!isTest) {
    markWeeklyPosted(weekKey);
  }

  return {
    chatId,
    messageId: sent.message_id,
    threadId,
    weekKey,
    count: ranked.length,
    isTest,
  };
}

function statusText() {
  const { ranked, weekKey, store } = getTopUsers(10);
  const lines = [
    '🏆 Status Top Aktif Mingguan',
    `📅 Minggu: ${weekKey}`,
    `💬 Chat: ${store.chatRef || getActivityChatRef()}`,
    `🆔 chatId: ${store.chatId || '(belum terdeteksi)'}`,
    `🧵 Topic: ${process.env.ACTIVITY_THREAD_ID || process.env.WEEKLY_TOP_THREAD_ID || '65640'}`,
    `📌 Sudah post minggu ini: ${store.lastPostedWeekKey === weekKey ? 'ya' : 'belum'}`,
    '',
    ranked.length ? 'Top sementara:' : 'Belum ada skor minggu ini.',
  ];
  ranked.forEach((u, i) => {
    const name = u.username ? `@${u.username}` : u.firstName || u.id;
    lines.push(
      `${i + 1}. ${name} — skor ${u.score} (chat ${u.messages}, reaksi ${u.reactions})`
    );
  });
  return lines.join('\n');
}

module.exports = {
  postWeeklyTop,
  statusText,
  loadStore,
};
