const {
  loadSchedule,
  saveSchedule,
  formatScheduleText,
  normalizeTime,
  currentTimeLabel,
} = require('./scheduleService');

/** Hanya username ini yang boleh akses command admin. */
const ADMIN_USERNAME = (
  process.env.ADMIN_TELEGRAM_USERNAME || 'jfnetworkindo'
)
  .replace(/^@/, '')
  .toLowerCase();

const HELP_TEXT = `🛠 *Admin Autopost* (@${ADMIN_USERNAME})

Test & post:
/test — preview ke grup private (TEST\\_CHAT\\_ID)
/postnow — post ke channel utama

Jadwal:
/jadwal — lihat jadwal
/jadwal\\_set 09:00,21:00 — ganti semua jam
/jadwal\\_add 12:30 — tambah jam
/jadwal\\_del 12:30 — hapus jam
/jadwal\\_on — aktifkan
/jadwal\\_off — nonaktifkan

Lainnya:
/sumber okx|bitget|auto — sumber data
/status — status bot
/help — bantuan

Hanya @${ADMIN_USERNAME} yang bisa memakai command ini.`;

function isAdmin(msg) {
  const username = (msg?.from?.username || '').toLowerCase();
  return Boolean(username) && username === ADMIN_USERNAME;
}

function denyText() {
  return `⛔ Akses ditolak.\nCommand pengaturan hanya untuk @${ADMIN_USERNAME}.`;
}

function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;

  const [cmdPart, ...rest] = raw.split(/\s+/);
  const cmd = cmdPart.split('@')[0].toLowerCase().replace(/_/g, '_');
  const args = rest.join(' ').trim();
  return { cmd, args };
}

function parseTimesList(args) {
  return [...new Set(
    String(args || '')
      .split(/[,;\s]+/)
      .map(normalizeTime)
      .filter(Boolean)
  )].sort();
}

/**
 * Proses satu pesan admin. Mengembalikan { reply, scheduleChanged, forcePost, exchangeSource }.
 */
function handleAdminCommand(msg) {
  if (!isAdmin(msg)) {
    return { reply: denyText(), allowed: false };
  }

  const parsed = parseCommand(msg.text);
  if (!parsed) {
    return { reply: null, allowed: true };
  }

  const { cmd, args } = parsed;
  const username = msg.from.username;
  let schedule = loadSchedule();

  switch (cmd) {
    case '/start':
    case '/help':
      return { reply: HELP_TEXT, allowed: true, parseMode: 'Markdown' };

    case '/jadwal':
    case '/schedule':
      return {
        reply: formatScheduleText(schedule),
        allowed: true,
      };

    case '/jadwal_set':
    case '/schedule_set': {
      const times = parseTimesList(args);
      if (!times.length) {
        return {
          reply: 'Format: /jadwal_set 09:00,21:00',
          allowed: true,
        };
      }
      schedule = saveSchedule({ ...schedule, times }, username);
      return {
        reply: `✅ Jadwal diganti.\n\n${formatScheduleText(schedule)}`,
        allowed: true,
        scheduleChanged: true,
        schedule,
      };
    }

    case '/jadwal_add':
    case '/schedule_add': {
      const t = normalizeTime(args);
      if (!t) {
        return { reply: 'Format: /jadwal_add 12:30', allowed: true };
      }
      const times = [...new Set([...(schedule.times || []), t])].sort();
      schedule = saveSchedule({ ...schedule, times }, username);
      return {
        reply: `✅ Jam ${t} ditambahkan.\n\n${formatScheduleText(schedule)}`,
        allowed: true,
        scheduleChanged: true,
        schedule,
      };
    }

    case '/jadwal_del':
    case '/schedule_del': {
      const t = normalizeTime(args);
      if (!t) {
        return { reply: 'Format: /jadwal_del 12:30', allowed: true };
      }
      const times = (schedule.times || []).filter((x) => x !== t);
      schedule = saveSchedule({ ...schedule, times }, username);
      return {
        reply: `✅ Jam ${t} dihapus.\n\n${formatScheduleText(schedule)}`,
        allowed: true,
        scheduleChanged: true,
        schedule,
      };
    }

    case '/jadwal_on':
    case '/schedule_on':
      schedule = saveSchedule({ ...schedule, enabled: true }, username);
      return {
        reply: `✅ Autopost diaktifkan.\n\n${formatScheduleText(schedule)}`,
        allowed: true,
        scheduleChanged: true,
        schedule,
      };

    case '/jadwal_off':
    case '/schedule_off':
      schedule = saveSchedule({ ...schedule, enabled: false }, username);
      return {
        reply: `⏸ Autopost dinonaktifkan.\n\n${formatScheduleText(schedule)}`,
        allowed: true,
        scheduleChanged: true,
        schedule,
      };

    case '/post_sekarang':
    case '/post_now':
    case '/postnow':
      return {
        reply: null,
        allowed: true,
        forcePost: true,
        runPostNow: true,
      };

    case '/test':
      return {
        reply: null,
        allowed: true,
        runTest: true,
      };

    case '/sumber':
    case '/source': {
      const val = String(args || '').toLowerCase().trim();
      if (!['okx', 'bitget', 'auto'].includes(val)) {
        return {
          reply: 'Format: /sumber okx | bitget | auto',
          allowed: true,
        };
      }
      return {
        reply: `✅ Sumber data diset ke *${val}* (berlaku di run berikutnya).`,
        allowed: true,
        parseMode: 'Markdown',
        exchangeSource: val,
      };
    }

    case '/status':
      return {
        reply: [
          '📊 Status Autopost',
          `👤 Admin: @${ADMIN_USERNAME}`,
          `🕐 Sekarang: ${currentTimeLabel(schedule.timezone)}`,
          '',
          formatScheduleText(schedule),
          '',
          `AI_PROVIDER: ${process.env.AI_PROVIDER || 'gemini'}`,
          `EXCHANGE_SOURCE: ${process.env.EXCHANGE_SOURCE || 'auto'}`,
          `Channel: ${process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet'}`,
        ].join('\n'),
        allowed: true,
      };

    default:
      return { reply: null, allowed: true };
  }
}

module.exports = {
  ADMIN_USERNAME,
  HELP_TEXT,
  isAdmin,
  denyText,
  handleAdminCommand,
  parseCommand,
};
