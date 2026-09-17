const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'activity-week.json');
const TIMEZONE = () => process.env.CRON_TIMEZONE || 'Asia/Jakarta';

/** Bobot skor: komentar/diskusi lebih bernilai dari reaksi. */
const WEIGHTS = {
  message: Number(process.env.ACTIVITY_WEIGHT_MESSAGE) || 2,
  reaction: Number(process.env.ACTIVITY_WEIGHT_REACTION) || 1,
};

function activityEnabled() {
  return process.env.ACTIVITY_ENABLED !== 'false';
}

function getActivityChatRef() {
  return (
    process.env.ACTIVITY_CHAT_ID ||
    process.env.TELEGRAM_FORWARD_CHAT_ID ||
    '@caricuanhp'
  ).trim();
}

/** Cocokkan chat grup caricuanhp (username atau id numerik). */
function isActivityChat(chat) {
  if (!chat) return false;
  const ref = getActivityChatRef();
  if (!ref) return false;

  if (ref.startsWith('@') || /^[a-zA-Z_]/.test(ref)) {
    const want = ref.replace(/^@/, '').toLowerCase();
    return String(chat.username || '').toLowerCase() === want;
  }
  return String(chat.id) === String(ref);
}

/** Minggu ISO berbasis kalender WIB (Senin–Minggu). Contoh: 2026-W38 */
function getWeekKey(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  const tmp = new Date(Date.UTC(y, m - 1, d));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function emptyStore(weekKey) {
  return {
    weekKey,
    chatRef: getActivityChatRef(),
    users: {},
    lastPostedWeekKey: null,
    updatedAt: new Date().toISOString(),
  };
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

function loadStore() {
  const weekKey = getWeekKey();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (!raw.weekKey || raw.weekKey !== weekKey) {
      const next = emptyStore(weekKey);
      next.lastPostedWeekKey = raw.lastPostedWeekKey || null;
      // Bawa chatId lintas minggu agar announce tetap tahu target
      if (raw.chatId) next.chatId = raw.chatId;
      saveStore(next);
      return next;
    }
    return raw;
  } catch {
    const store = emptyStore(weekKey);
    saveStore(store);
    return store;
  }
}

function saveStore(store) {
  ensureDataDir();
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function ensureUser(store, user) {
  if (!user?.id || user.is_bot) return null;
  const id = String(user.id);
  if (!store.users[id]) {
    store.users[id] = {
      id: user.id,
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      messages: 0,
      reactions: 0,
      score: 0,
    };
  } else {
    if (user.username) store.users[id].username = user.username;
    if (user.first_name) store.users[id].firstName = user.first_name;
    if (user.last_name) store.users[id].lastName = user.last_name;
  }
  return store.users[id];
}

function recomputeScore(row) {
  row.score = row.messages * WEIGHTS.message + row.reactions * WEIGHTS.reaction;
}

function recordMessage(msg) {
  if (!activityEnabled()) return null;
  if (!isActivityChat(msg.chat)) return null;
  if (!msg.from || msg.from.is_bot) return null;
  // Abaikan command bot
  if (typeof msg.text === 'string' && msg.text.startsWith('/')) return null;
  // Abaikan service message
  if (
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.group_chat_created ||
    msg.migrate_to_chat_id ||
    msg.pinned_message
  ) {
    return null;
  }

  const store = loadStore();
  const row = ensureUser(store, msg.from);
  if (!row) return null;
  row.messages += 1;
  recomputeScore(row);
  if (msg.chat?.id) store.chatId = msg.chat.id;
  saveStore(store);
  return row;
}

/**
 * Reaksi: +1 per emoji baru yang ditambahkan user.
 * Butuh bot admin + allowed_updates message_reaction.
 */
function recordReaction(reaction) {
  if (!activityEnabled()) return null;
  if (!isActivityChat(reaction.chat)) return null;
  const user = reaction.user;
  if (!user || user.is_bot) return null;

  const oldN = Array.isArray(reaction.old_reaction) ? reaction.old_reaction.length : 0;
  const newN = Array.isArray(reaction.new_reaction) ? reaction.new_reaction.length : 0;
  const added = newN - oldN;
  if (added <= 0) return null;

  const store = loadStore();
  const row = ensureUser(store, user);
  if (!row) return null;
  row.reactions += added;
  recomputeScore(row);
  if (reaction.chat?.id) store.chatId = reaction.chat.id;
  saveStore(store);
  return row;
}

function getTopUsers(limit = 10) {
  const store = loadStore();
  const ranked = Object.values(store.users || {})
    .filter((u) => u.score > 0)
    .sort((a, b) => b.score - a.score || b.messages - a.messages)
    .slice(0, limit);
  return { store, ranked, weekKey: store.weekKey };
}

function markWeeklyPosted(weekKey) {
  const store = loadStore();
  store.lastPostedWeekKey = weekKey || store.weekKey;
  saveStore(store);
  return store;
}

function alreadyPostedThisWeek() {
  const store = loadStore();
  return store.lastPostedWeekKey === store.weekKey;
}

function resetWeek() {
  const store = emptyStore(getWeekKey());
  saveStore(store);
  return store;
}

function formatDisplayName(user) {
  if (user.username) return `@${user.username}`;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || `User ${user.id}`;
  return name;
}

/** Mention HTML yang tetap klikable tanpa username. */
function formatMentionHtml(user) {
  if (user.username) {
    return `@${escapeHtml(user.username)}`;
  }
  const label = escapeHtml(formatDisplayName(user));
  return `<a href="tg://user?id=${user.id}">${label}</a>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildWeeklyTopCaption(ranked, { isTest = false } = {}) {
  const lines = [
    isTest ? '<b>🧪 [TEST] Top Aktif</b>' : null,
    isTest ? '' : null,
    '<b>🏆 Anggota Paling Aktif Minggu Ini!</b>',
    '',
  ];

  if (!ranked.length) {
    lines.push('Belum ada data aktivitas minggu ini.');
    lines.push('Ayo diskusi & kasih reaksi biar masuk Top 10! 💬');
  } else {
    ranked.forEach((u, i) => {
      lines.push(`${i + 1}. ${formatMentionHtml(u)}`);
    });
  }

  lines.push('');
  lines.push(
    'Ayo lebih aktif di diskusi & reaksi biar masuk Top 10 minggu depan! 💪'
  );
  lines.push(
    'Ajak anggota baru join biar komunitas makin rame 🚀'
  );
  lines.push('');
  lines.push('<i>⚠️ Ranking berdasarkan chat & reaksi di grup.</i>');

  return lines.filter((l) => l != null).join('\n');
}

function buildWeeklyTopKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: '▶️ Subscribe',
          url: 'https://www.youtube.com/@jfnetworknet',
        },
        {
          text: '𝕏 Follow X',
          url: 'https://x.com/Jfnetworkx',
        },
      ],
      [
        {
          text: '📝 Daftar Beincom',
          url: 'https://group.beincom.com/ref/MjHHVP?type=personal',
        },
        {
          text: '👥 Grup Beincom',
          url: 'https://group.beincom.com/ref/WV1YcM',
        },
      ],
    ],
  };
}

module.exports = {
  DATA_PATH,
  WEIGHTS,
  activityEnabled,
  getActivityChatRef,
  isActivityChat,
  getWeekKey,
  loadStore,
  saveStore,
  recordMessage,
  recordReaction,
  getTopUsers,
  markWeeklyPosted,
  alreadyPostedThisWeek,
  resetWeek,
  formatDisplayName,
  formatMentionHtml,
  buildWeeklyTopCaption,
  buildWeeklyTopKeyboard,
};
