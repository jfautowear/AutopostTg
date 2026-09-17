const TelegramBot = require('node-telegram-bot-api');

/**
 * Channel gratis = limit API Telegram standar.
 * Caption foto max 1024 (UTF-16). Default lebih ketat karena emoji + HTML.
 */
const MAX_CAPTION_CHARS = Number(process.env.MAX_CAPTION_CHARS) || 700;

const AFFILIATE_BUTTONS = [
  { text: 'Trade di OKX CEX', url: 'https://okx.ac/join/76785925' },
  { text: 'OKX Web3 DEX', url: 'https://web3.okx.ac/join/JFNETWORK' },
  { text: 'Trade di Bitget', url: 'https://partner.bitgetapp.com/bg/CSGH1P' },
];

const OKX_WEB3_DEX = {
  text: '🔍 Cek di OKX Web3 DEX',
  url: 'https://web3.okx.ac/join/JFNETWORK',
};

const AIRDROP_DISCLAIMER = '⚠️ HIGH RISK · NFA & DYOR. Bukan jaminan airdrop.';
const DISCLAIMER = '⚠️ Disclaimer: NFA & DYOR.';

let botInstance = null;

function getBot(options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('your_bot_token')) {
    throw new Error('TELEGRAM_BOT_TOKEN belum di-set di .env / secrets');
  }

  if (botInstance && !options.forceNew) {
    return botInstance;
  }

  if (botInstance && options.forceNew) {
    try {
      botInstance.stopPolling?.();
    } catch {
      // ignore
    }
    botInstance = null;
  }

  botInstance = new TelegramBot(token, {
    polling: Boolean(options.polling),
  });
  return botInstance;
}

function getChannelId() {
  return process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet';
}

/**
 * Grup private testing.
 * Catatan: link invite t.me/+... TIDAK bisa dipakai langsung —
 * isi TEST_CHAT_ID dengan ID numerik (contoh -100xxxxxxxxxx).
 */
function getTestChatId() {
  const id = (process.env.TEST_CHAT_ID || '').trim();
  if (!id || id.includes('your_') || id.includes('+xqVu')) {
    return null;
  }
  return id;
}

function getForwardChatId() {
  return process.env.TELEGRAM_FORWARD_CHAT_ID || '@caricuanhp';
}

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

/** Keyboard spot CEX (3 affiliate). */
function buildInlineKeyboard() {
  return {
    inline_keyboard: AFFILIATE_BUTTONS.map((btn) => [{ text: btn.text, url: btn.url }]),
  };
}

/** Keyboard khusus kategori airdrop/DEX — fokus OKX Web3 DEX. */
function buildAirdropInlineKeyboard(snapshot) {
  const rows = [[{ text: OKX_WEB3_DEX.text, url: OKX_WEB3_DEX.url }]];
  const url = snapshot?.hotGem?.url;
  if (url && /^https?:\/\//i.test(url)) {
    rows.push([{ text: '📊 Lihat chart', url }]);
  }
  return { inline_keyboard: rows };
}

function formatMarketMessage(snapshot, content, { isTest = false } = {}) {
  if (snapshot.category === 'airdrop') {
    return formatAirdropMessage(snapshot, content, { isTest });
  }

  const exchange = snapshot.primaryLabel;
  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const hotLine = hot
    ? `🔥 Hot: <b>${escapeHtml(hot.base)}</b> ${escapeHtml(formatPctSafe(hot.changePct))}`
    : null;

  const build = (hook, info, cta) =>
    [
      isTest ? '<b>🧪 [TEST PREVIEW]</b>' : null,
      escapeHtml(hook),
      hotLine,
      '',
      `<b>📡 Info pasar ${escapeHtml(exchange)}</b>`,
      escapeHtml(info),
      '',
      escapeHtml(cta),
      '',
      `<i>${escapeHtml(DISCLAIMER)}</i>`,
    ]
      .filter((line) => line != null)
      .join('\n');

  return finalizeCaption(build, content);
}

function formatAirdropMessage(snapshot, content, { isTest = false } = {}) {
  const gem = snapshot.hotGem;
  const gemLine = gem
    ? `💎 <b>${escapeHtml(gem.symbol)}</b> · ${escapeHtml(gem.chain)} · 1h ${escapeHtml(formatPctSafe(gem.change1h))}`
    : null;

  const build = (hook, info, cta) =>
    [
      isTest ? '<b>🧪 [TEST AIRDROP/DEX]</b>' : null,
      '<b>🪂 Airdrop / Early Gem</b>',
      escapeHtml(hook),
      gemLine,
      '',
      '<b>⛓ On-chain pulse</b>',
      escapeHtml(info),
      '',
      escapeHtml(cta),
      '',
      `<i>${escapeHtml(AIRDROP_DISCLAIMER)}</i>`,
    ]
      .filter((line) => line != null)
      .join('\n');

  return finalizeCaption(build, content);
}

function finalizeCaption(build, content) {
  let message = build(content.hook, content.info, content.cta);

  if (telegramLength(message) > MAX_CAPTION_CHARS) {
    const templateOverhead = telegramLength(build('', '', ''));
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

  while (telegramLength(message) > MAX_CAPTION_CHARS) {
    message = message.slice(0, -2);
  }
  if (telegramLength(message) === MAX_CAPTION_CHARS) {
    message = `${message.slice(0, -1)}…`;
  }

  return message;
}

function formatPctSafe(value) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(2)}%`;
}

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
      return await tryForward({ message_thread_id: threadId }, ` topic/${threadId}`);
    }
    return await tryForward({}, '');
  } catch (err) {
    if (threadId) {
      console.warn(
        `[telegram] Forward ke topic ${threadId} gagal (${err.message}), coba tanpa topic...`
      );
      return tryForward({}, ' (tanpa topic)');
    }
    throw err;
  }
}

/**
 * Kirim post ke target chat.
 * @param {'channel'|'test'|string} target
 */
async function sendMarketPost({
  snapshot,
  content,
  imageBuffer,
  target = 'channel',
  forward = true,
  isTest = false,
}) {
  const bot = getBot();
  let chatId;

  if (target === 'channel') {
    chatId = getChannelId();
  } else if (target === 'test') {
    chatId = getTestChatId();
    if (!chatId) {
      throw new Error(
        'TEST_CHAT_ID belum di-set. Isi ID numerik grup private (bukan link t.me/+...). Tambahkan bot ke grup & jadikan admin.'
      );
    }
    isTest = true;
    forward = false;
  } else {
    chatId = target;
  }

  const caption = formatMarketMessage(snapshot, content, { isTest });
  const reply_markup =
    snapshot.category === 'airdrop'
      ? buildAirdropInlineKeyboard(snapshot)
      : buildInlineKeyboard();
  const len = telegramLength(caption);

  if (len > 1024) {
    throw new Error(`Caption terlalu panjang (${len} > 1024) — cek MAX_CAPTION_CHARS`);
  }

  console.log(
    `[telegram] → ${chatId} | ${len}/${MAX_CAPTION_CHARS} chars | test=${isTest}`
  );

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
  if (forward && target === 'channel') {
    try {
      forwarded = await forwardToGroup(chatId, sent.message_id);
    } catch (err) {
      console.error('[telegram] Forward ke grup gagal:', err.message);
    }
  }

  return {
    chatId,
    messageId: sent.message_id,
    hasImage: Boolean(imageBuffer),
    captionLength: len,
    source: snapshot.primarySource,
    isTest,
    forwarded: Boolean(forwarded),
    forwardChatId: getForwardChatId(),
    forwardThreadId: getForwardThreadId(),
  };
}

async function postToChannel(payload) {
  return sendMarketPost({ ...payload, target: 'channel', forward: true, isTest: false });
}

async function postToTestChat(payload) {
  return sendMarketPost({ ...payload, target: 'test', forward: false, isTest: true });
}

module.exports = {
  getBot,
  getChannelId,
  getTestChatId,
  getForwardChatId,
  getForwardThreadId,
  formatMarketMessage,
  formatAirdropMessage,
  buildInlineKeyboard,
  buildAirdropInlineKeyboard,
  forwardToGroup,
  sendMarketPost,
  postToChannel,
  postToTestChat,
  telegramLength,
  clip,
  MAX_CAPTION_CHARS,
  AFFILIATE_BUTTONS,
  OKX_WEB3_DEX,
};
