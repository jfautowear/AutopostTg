const TelegramBot = require('node-telegram-bot-api');

/**
 * Channel gratis = limit API Telegram standar.
 * Caption foto max 1024 (UTF-16). Kita pakai default lebih ketat
 * karena emoji (2 unit) + tag HTML ikut dihitung.
 */
const MAX_CAPTION_CHARS = Number(process.env.MAX_CAPTION_CHARS) || 700;

const AFFILIATES = {
  okx: {
    text: '💰 Trade di OKX',
    url: 'https://okx.ac/join/76785925',
  },
  bitget: {
    text: '💰 Trade di Bitget',
    url: 'https://partner.bitgetapp.com/bg/CSGH1P',
  },
};

const GROUP_BUTTON = {
  text: '👥 Gabung Grup',
  url: 'https://t.me/caricuanhp',
};

const DISCLAIMER = '⚠️ Disclaimer: NFA & DYOR.';

let botInstance = null;

function getBot() {
  if (botInstance) return botInstance;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('your_bot_token')) {
    throw new Error('TELEGRAM_BOT_TOKEN belum di-set di .env / secrets');
  }

  botInstance = new TelegramBot(token, { polling: false });
  return botInstance;
}

function getChannelId() {
  return process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet';
}

/** Grup tujuan forward — default @caricuanhp (https://t.me/caricuanhp/80483) */
function getForwardChatId() {
  return process.env.TELEGRAM_FORWARD_CHAT_ID || '@caricuanhp';
}

/**
 * Topic / thread forum (opsional).
 * Dari link https://t.me/caricuanhp/80483 → thread id = 80483
 */
function getForwardThreadId() {
  const raw =
    process.env.TELEGRAM_FORWARD_THREAD_ID ||
    process.env.TELEGRAM_FORWARD_TOPIC_ID ||
    '80483';
  if (raw === '' || raw === '0' || String(raw).toLowerCase() === 'none') {
    return null;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function telegramLength(text) {
  // Telegram menghitung UTF-16 code units (= String.length di JS)
  return String(text || '').length;
}

function clip(text, max) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (telegramLength(clean) <= max) return clean;

  let out = clean;
  while (telegramLength(out) > max - 1 && out.length > 0) {
    out = out.slice(0, -1);
  }
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > Math.floor(max * 0.5)) {
    out = out.slice(0, lastSpace);
  }
  return `${out.trim()}…`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildInlineKeyboard(primarySource) {
  const affiliate = AFFILIATES[primarySource] || AFFILIATES.okx;
  return {
    inline_keyboard: [
      [{ text: affiliate.text, url: affiliate.url }],
      [{ text: GROUP_BUTTON.text, url: GROUP_BUTTON.url }],
    ],
  };
}

/**
 * Format: HOOK → Informasi → CTA → Disclaimer
 * Selalu dipotong agar ≤ MAX_CAPTION_CHARS (aman channel gratis).
 */
function formatMarketMessage(snapshot, content) {
  const exchange = snapshot.primaryLabel;

  const build = (hook, info, cta) =>
    [
      escapeHtml(hook),
      '',
      `<b>📡 Info pasar ${escapeHtml(exchange)}</b>`,
      escapeHtml(info),
      '',
      escapeHtml(cta),
      '',
      `<i>${escapeHtml(DISCLAIMER)}</i>`,
    ].join('\n');

  let message = build(content.hook, content.info, content.cta);

  if (telegramLength(message) > MAX_CAPTION_CHARS) {
    const templateOverhead = telegramLength(
      build('', '', '')
    );
    const budget = Math.max(120, MAX_CAPTION_CHARS - templateOverhead - 8);
    const hookBudget = Math.min(60, Math.floor(budget * 0.18));
    const ctaBudget = Math.min(80, Math.floor(budget * 0.18));
    const infoBudget = Math.max(80, budget - hookBudget - ctaBudget);

    message = build(
      clip(content.hook, hookBudget),
      clip(content.info, infoBudget),
      clip(content.cta, ctaBudget)
    );
  }

  // Hard cap terakhir (emoji + HTML)
  while (telegramLength(message) > MAX_CAPTION_CHARS) {
    message = message.slice(0, -2);
  }
  if (telegramLength(message) === MAX_CAPTION_CHARS) {
    message = `${message.slice(0, -1)}…`;
  }

  return message;
}

/**
 * Forward post channel → grup (opsional ke topic forum).
 * Link acuan: https://t.me/caricuanhp/80483
 * Bot harus admin di channel & anggota/admin di grup.
 */
async function forwardToGroup(fromChatId, messageId) {
  const enabled = process.env.TELEGRAM_FORWARD_ENABLED !== 'false';
  if (!enabled) {
    console.log('[telegram] Forward dimatikan (TELEGRAM_FORWARD_ENABLED=false)');
    return null;
  }

  const bot = getBot();
  const toChatId = getForwardChatId();
  const threadId = getForwardThreadId();

  const tryForward = async (opts, label) => {
    console.log(`[telegram] Forward ${fromChatId}#${messageId} → ${toChatId}${label}`);
    return bot.forwardMessage(toChatId, fromChatId, messageId, opts);
  };

  try {
    if (threadId) {
      return await tryForward(
        { message_thread_id: threadId },
        ` topic/${threadId}`
      );
    }
    return await tryForward({}, '');
  } catch (err) {
    // Jika 80483 bukan forum topic, coba forward biasa ke grup
    if (threadId) {
      console.warn(
        `[telegram] Forward ke topic ${threadId} gagal (${err.message}), coba tanpa topic...`
      );
      return tryForward({}, ' (tanpa topic)');
    }
    throw err;
  }
}

async function postToChannel({ snapshot, content, imageBuffer }) {
  const bot = getBot();
  const chatId = getChannelId();
  const caption = formatMarketMessage(snapshot, content);
  const reply_markup = buildInlineKeyboard(snapshot.primarySource);
  const len = telegramLength(caption);

  if (len > 1024) {
    throw new Error(`Caption terlalu panjang (${len} > 1024) — cek MAX_CAPTION_CHARS`);
  }

  console.log(`[telegram] Caption ${len}/${MAX_CAPTION_CHARS} chars (limit aman channel gratis)`);

  let sent;
  if (imageBuffer && imageBuffer.length > 0) {
    sent = await bot.sendPhoto(chatId, imageBuffer, {
      caption,
      parse_mode: 'HTML',
      reply_markup,
    });
  } else {
    sent = await bot.sendMessage(chatId, caption, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
  }

  let forwarded = null;
  try {
    forwarded = await forwardToGroup(chatId, sent.message_id);
  } catch (err) {
    // Post channel tetap sukses meski forward gagal
    console.error('[telegram] Forward ke grup gagal:', err.message);
    console.error(
      '[telegram] Pastikan bot admin channel + anggota grup, dan TELEGRAM_FORWARD_THREAD_ID benar jika forum topic.'
    );
  }

  return {
    chatId,
    messageId: sent.message_id,
    hasImage: Boolean(imageBuffer),
    captionLength: len,
    source: snapshot.primarySource,
    forwarded: Boolean(forwarded),
    forwardChatId: getForwardChatId(),
    forwardThreadId: getForwardThreadId(),
  };
}

module.exports = {
  getBot,
  getChannelId,
  getForwardChatId,
  getForwardThreadId,
  formatMarketMessage,
  buildInlineKeyboard,
  forwardToGroup,
  postToChannel,
  telegramLength,
  clip,
  MAX_CAPTION_CHARS,
  AFFILIATES,
  GROUP_BUTTON,
};
