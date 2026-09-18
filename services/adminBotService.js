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
/test — preview spot CEX ke grup private
/test\\_airdrop — preview Airdrop/DEX ke grup private
/postnow — post spot ke channel
/airdrop — post Airdrop/DEX ke channel

Top aktif grup (@caricuanhp):
/topaktif — lihat ranking minggu ini
/topaktif\\_post — kirim Top 10 ke grup sekarang
/topaktif\\_test — preview Top 10 ke chat ini
/topaktif\\_reset — reset skor minggu ini

Jadwal:
/jadwal — lihat jadwal
/jadwal\\_set 09:00,21:00 — ganti semua jam
/jadwal\\_add 12:30 — tambah jam
/jadwal\\_del 12:30 — hapus jam
/jadwal\\_on — aktifkan
/jadwal\\_off — nonaktifkan

Lainnya:
/sumber okx|bitget|auto — sumber CEX
/kategori spot|airdrop|auto — jenis konten
/status — status bot
/help — bantuan

Hanya @${ADMIN_USERNAME} yang bisa memakai command ini.`;

function isAdmin(msg) {
  const username = (msg?.from?.username || '').toLowerCase();
  if (username && username === ADMIN_USERNAME) return true;

  // Opsional: izinkan juga lewat user id numerik (ADMIN_TELEGRAM_USER_IDS=123,456)
  const ids = String(process.env.ADMIN_TELEGRAM_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const uid = msg?.from?.id != null ? String(msg.from.id) : '';
  return Boolean(uid && ids.includes(uid));
}

/** Opsi balasan aman untuk forum topic (supergroup). Private topic sering invalid. */
function replyOpts(msg, extra = {}) {
  const opts = {
    ...extra,
  };
  if (msg?.message_id) {
    opts.reply_to_message_id = msg.message_id;
  }
  // Jangan kirim message_thread_id di private — Bot API sering error "thread not found"
  if (msg?.message_thread_id && msg.chat?.type && msg.chat.type !== 'private') {
    opts.message_thread_id = msg.message_thread_id;
  }
  return opts;
}

function denyText() {
  return `⛔ Akses ditolak.\nCommand pengaturan hanya untuk @${ADMIN_USERNAME}.`;
}

/** Balasan ramah untuk user non-admin di chat pribadi (bukan daftar command). */
function publicPrivateMessage() {
  return {
    text: [
      'Hai! 👋',
      '',
      'Terima kasih sudah menghubungi bot JF Network.',
      'Command admin hanya untuk pengelola.',
      '',
      'Silakan lanjut di sini:',
      '💬 Diskusi & komunitas → grup',
      '📢 Update info & berita → channel',
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💬 Grup Diskusi', url: 'https://t.me/caricuanhp' },
          { text: '📢 Channel Update', url: 'https://t.me/jfnetworknet' },
        ],
      ],
    },
  };
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
        category: 'spot',
      };

    case '/test':
      return {
        reply: null,
        allowed: true,
        runTest: true,
        category: 'spot',
      };

    case '/test_airdrop':
    case '/testairdrop':
      return {
        reply: null,
        allowed: true,
        runTest: true,
        category: 'airdrop',
      };

    case '/airdrop':
    case '/post_airdrop':
      return {
        reply: null,
        allowed: true,
        runPostNow: true,
        category: 'airdrop',
      };

    case '/topaktif':
    case '/top_aktif':
      return { reply: null, allowed: true, runTopAktif: 'status' };

    case '/topaktif_post':
    case '/top_aktif_post':
      return { reply: null, allowed: true, runTopAktif: 'post' };

    case '/topaktif_test':
    case '/top_aktif_test':
      return { reply: null, allowed: true, runTopAktif: 'test' };

    case '/topaktif_reset':
    case '/top_aktif_reset':
      return { reply: null, allowed: true, runTopAktif: 'reset' };

    case '/kategori':
    case '/category': {
      const val = String(args || '').toLowerCase().trim();
      if (!['spot', 'airdrop', 'auto', 'dex', 'cex'].includes(val)) {
        return {
          reply: 'Format: /kategori spot | airdrop | auto',
          allowed: true,
        };
      }
      const normalized = val === 'dex' ? 'airdrop' : val === 'cex' ? 'spot' : val;
      return {
        reply: `✅ Kategori konten → *${normalized}*`,
        allowed: true,
        parseMode: 'Markdown',
        postCategory: normalized,
      };
    }

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
          `AI_PROVIDER: ${process.env.AI_PROVIDER || 'free'}`,
          `EXCHANGE_SOURCE: ${process.env.EXCHANGE_SOURCE || 'auto'}`,
          `POST_CATEGORY: ${process.env.POST_CATEGORY || 'auto'}`,
          `Channel: ${process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet'}`,
          `Top Aktif: ${process.env.ACTIVITY_ENABLED === 'false' ? 'OFF' : 'ON'} → ${process.env.ACTIVITY_CHAT_ID || process.env.TELEGRAM_FORWARD_CHAT_ID || '@caricuanhp'}`,
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
  publicPrivateMessage,
  handleAdminCommand,
  parseCommand,
  replyOpts,
};
