const TelegramBot = require('node-telegram-bot-api');

/**
 * Channel gratis = limit API Telegram standar.
 * Caption foto max 1024 (UTF-16). Default lebih ketat karena emoji + HTML.
 */
const MAX_CAPTION_CHARS = Number(process.env.MAX_CAPTION_CHARS) || 700;

/** Referral OKX Web3 DEX — dipilih acak tiap post. */
const OKX_WEB3_URLS = [
  'https://web3.okx.ac/join/JFNETWORK',
  'https://web3.okx.ac/join/OKXDEXJF',
];

function pickOkxWeb3Url() {
  return OKX_WEB3_URLS[Math.floor(Math.random() * OKX_WEB3_URLS.length)];
}

function buildAffiliateButtons() {
  return [
    { text: '📈 Trade OKX', url: 'https://okx.ac/join/76785925' },
    { text: '⚡ Trade Bitget', url: 'https://partner.bitgetapp.com/bg/CSGH1P' },
  ];
}

/** Tombol daftar untuk news/promo (CTA registrasi). */
function buildRegisterButton(source = 'OKX') {
  const isBitget = String(source || '').toUpperCase().includes('BITGET');
  if (isBitget) {
    return {
      text: '✨ Daftar Bitget',
      url: 'https://partner.bitgetapp.com/bg/CSGH1P',
    };
  }
  return {
    text: '✨ Daftar OKX',
    url: 'https://okx.ac/join/76785925',
  };
}

const JOIN_GROUP_BTN = {
  text: '💬 JOIN GROUP',
  url: 'https://t.me/caricuanhp',
};

const AIRDROP_DISCLAIMER = '⚠️ HIGH RISK · NFA & DYOR.';
const DISCLAIMER = '⚠️ NFA & DYOR.';

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

/**
 * Keyboard spot — CTA utama = sumber data, plus 1 tombol ke exchange lain + JOIN GROUP.
 * Contoh Bitget: [Trade Bitget | Cek OKX] / [JOIN GROUP]
 */
function buildInlineKeyboard(snapshot) {
  const [okx, bitget] = buildAffiliateButtons();
  const isBitget = String(snapshot?.primaryLabel || '')
    .toUpperCase()
    .includes('BITGET');

  const primary = isBitget
    ? { text: '⚡ Trade Bitget', url: bitget.url }
    : { text: '📈 Trade OKX', url: okx.url };
  const secondary = isBitget
    ? { text: '🔗 Cek OKX', url: okx.url }
    : { text: '🔗 Cek Bitget', url: bitget.url };

  console.log(
    `[telegram] Spot keyboard → primary=${primary.text} | secondary=${secondary.text}`
  );

  return {
    inline_keyboard: [[primary, secondary], [JOIN_GROUP_BTN]],
  };
}

/** Keyboard airdrop/DEX — 2 baris: [OKX WEB3 | CHART] lalu [JOIN GROUP]. */
function buildAirdropInlineKeyboard(snapshot) {
  const web3Url = pickOkxWeb3Url();
  const chartUrl =
    snapshot?.hotGem?.url && /^https?:\/\//i.test(snapshot.hotGem.url)
      ? snapshot.hotGem.url
      : 'https://dexscreener.com';

  console.log(`[telegram] Airdrop keyboard → OKX=${web3Url} | chart=${chartUrl}`);

  return {
    inline_keyboard: [
      [
        { text: '🌐 Trade OKX Web3', url: web3Url },
        { text: '📊 CHART', url: chartUrl },
      ],
      [JOIN_GROUP_BTN],
    ],
  };
}

/**
 * Keyboard berita/promo — Daftar OKX/Bitget | Baca Info | JOIN GROUP.
 */
function buildNewsInlineKeyboard(snapshot) {
  const source =
    snapshot?.hotNews?.exchange || snapshot?.primaryLabel || 'OKX';
  const daftar = buildRegisterButton(source);
  const rawUrl =
    snapshot?.hotNews?.url && /^https?:\/\//i.test(snapshot.hotNews.url)
      ? snapshot.hotNews.url
      : 'https://www.okx.ac/help/section/announcements-latest-announcements';
  const infoUrl = String(rawUrl)
    .replace(/https?:\/\/(www\.)?okx\.com/gi, 'https://www.okx.ac')
    .replace(/https?:\/\/(www\.)?okx\.cc/gi, 'https://www.okx.ac');

  return {
    inline_keyboard: [
      [daftar, { text: '📄 Baca Info', url: infoUrl }],
      [JOIN_GROUP_BTN],
    ],
  };
}

/** Harga ringkas untuk caption mobile. */
function formatPriceSafe(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatShortTime(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * Caption spot/CEX — hook kuat di baris pertama, bullets gainer, CTA jelas.
 */
function formatMarketMessage(snapshot, content, { isTest = false } = {}) {
  if (snapshot.category === 'airdrop') {
    return formatAirdropMessage(snapshot, content, { isTest });
  }
  if (snapshot.category === 'news') {
    return formatNewsMessage(snapshot, content, { isTest });
  }

  const exchange = snapshot.primaryLabel || 'CEX';
  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const gainers = (snapshot.primary?.topGainers || snapshot.primary?.gainers || []).slice(
    0,
    3
  );
  const when = formatShortTime(snapshot.fetchedAt);
  const pct = hot?.changePct != null ? formatPctSafe(hot.changePct) : null;
  const defaultHook = hot?.base
    ? pct && !String(pct).startsWith('-')
      ? `🚀 Lonjakan ekstrem: ${hot.base} ${pct}!`
      : `🔥 Breaking: ${hot.base} jadi fokusasi utama di ${exchange}`
    : `🔥 Breaking Market Pulse · ${exchange}`;

  const build = (hook, info, cta) => {
    const gainerBlock = gainers.length
      ? [
          '<b>🛰 Top Gainer</b>',
          ...gainers.map(
            (g) =>
              `• <b>${escapeHtml(g.base)}</b> ${escapeHtml(formatPctSafe(g.changePct))}`
          ),
          '',
        ]
      : [];

    const firstLine = escapeHtml(hook || defaultHook);

    return [
      isTest ? '<b>🧪 [TEST PREVIEW]</b>' : null,
      isTest ? '' : null,
      `<b>${firstLine}</b>`,
      '',
      '<b>🔥 MARKET PULSE</b>',
      hot
        ? `Hot: <b>${escapeHtml(hot.base)}</b> · ${escapeHtml(exchange)}`
        : `Exchange: ${escapeHtml(exchange)}`,
      hot
        ? `📈 24h ${escapeHtml(formatPctSafe(hot.changePct))} · $${escapeHtml(formatPriceSafe(hot.last))}`
        : null,
      when ? `<i>Data: ${escapeHtml(exchange)} · ${escapeHtml(when)} WIB</i>` : null,
      '',
      ...gainerBlock,
      escapeHtml(info),
      '',
      escapeHtml(
        cta || `Buka app ${exchange} untuk analisis ${hot?.base || 'pasar'} sekarang. 📊`
      ),
      '',
      `<i>${escapeHtml(DISCLAIMER)}</i>`,
    ]
      .filter((line) => line != null)
      .join('\n');
  };

  return finalizeCaption(build, content);
}

/**
 * Caption berita/promo — marketing natural; fakta dari pengumuman, tanpa label kaku.
 */
function formatNewsMessage(snapshot, content, { isTest = false } = {}) {
  const n = snapshot.hotNews;
  const emoji = n?.emoji || '🎁';
  const typeLabel = n?.typeLabel || 'Update';
  const exchange = n?.exchange || snapshot.primaryLabel || 'OKX';
  const when = formatShortTime(n?.publishedAt || snapshot.fetchedAt);

  const build = (hook, info, cta) =>
    [
      isTest ? '<b>🧪 [TEST NEWS/PROMO]</b>' : null,
      isTest ? '' : null,
      escapeHtml(hook),
      '',
      `<b>${emoji} ${escapeHtml(typeLabel)}</b> · ${escapeHtml(exchange)}`,
      when ? `<i>${escapeHtml(exchange)} · ${escapeHtml(when)} WIB</i>` : null,
      '',
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

/** Volume ringkas untuk mobile: $1.17M / $85.2K */
function formatVolumeUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Caption DEX aman (lolos filter) — CTA OKX Web3.
 */
function formatAirdropMessage(snapshot, content, { isTest = false } = {}) {
  const gem = snapshot.hotGem;
  const token = gem?.symbol || '—';
  const chain = gem?.chain || 'Multi-chain';
  const screened = Boolean(snapshot.screened || gem?.screened);
  const sec = gem?.security || {};
  const when = formatShortTime(snapshot.fetchedAt);

  let volumeLine = 'Volume 24h: —';
  if (gem?.volume24h != null && gem.volume24h > 0) {
    volumeLine = `Volume 24h: ${formatVolumeUsd(gem.volume24h)}`;
  } else if (gem?.volume6h != null && gem.volume6h > 0) {
    volumeLine = `Volume 6h: ${formatVolumeUsd(gem.volume6h)}`;
  } else if (gem?.volume1h != null && gem.volume1h > 0) {
    volumeLine = `Volume 1h: ${formatVolumeUsd(gem.volume1h)}`;
  }

  const ch24 =
    gem?.change24h != null
      ? formatPctSafe(gem.change24h)
      : formatPctSafe(gem?.change1h);
  const mcLine = gem?.marketCapUsd != null;

  const taxLine =
    sec.buyTaxPct != null || sec.sellTaxPct != null
      ? `Tax: buy ${sec.buyTaxPct ?? '—'}% / sell ${sec.sellTaxPct ?? '—'}%`
      : null;
  const lpLine = sec.lpBurned
    ? 'LP: burned ✅'
    : sec.lpLockedPct != null
      ? `LP locked: ${Number(sec.lpLockedPct).toFixed(0)}%`
      : null;

  const hook = content?.hook || `${token} lolos screen aman`;
  const info =
    content?.info ||
    'Token lolos filter keamanan & likuiditas. Tetap DYOR — bukan saran investasi.';
  const cta =
    content?.cta || 'Trade / cek pair di OKX Web3 DEX sekarang. 🌐';

  const title = screened
    ? '<b>🛡️ DEX SAFE · LOLOS FILTER</b>'
    : '<b>🪂 AIRDROP / EARLY GEM</b>';

  const build = (h, i, c) =>
    [
      isTest ? '<b>🧪 [TEST DEX SAFE]</b>' : null,
      isTest ? '' : null,
      title,
      '',
      `Token: <b>${escapeHtml(token)}</b> · ${escapeHtml(chain)}`,
      gem?.address ? `CA: <code>${escapeHtml(gem.address)}</code>` : null,
      ch24 !== '—' ? `24h: <b>${escapeHtml(ch24)}</b>` : null,
      mcLine
        ? escapeHtml(
            `MC: ${formatVolumeUsd(gem.marketCapUsd) || '—'} · Liq: ${formatVolumeUsd(gem.liquidityUsd) || '—'}`
          )
        : null,
      escapeHtml(volumeLine),
      taxLine ? escapeHtml(taxLine) : null,
      lpLine ? escapeHtml(lpLine) : null,
      when
        ? `<i>Screen: DexScreener + GoPlus · ${escapeHtml(when)} WIB</i>`
        : '<i>Screen: DexScreener + GoPlus</i>',
      '',
      '<b>📡 Ringkasan</b>',
      escapeHtml(h),
      '',
      escapeHtml(i),
      '',
      escapeHtml(c),
      '',
      '<b>Trade via:</b> OKX Web3 DEX',
      '<b>Disclaimer:</b> Filter ketat ≠ bebas risiko. DYOR &amp; NFA.',
      '',
      `<i>${escapeHtml(AIRDROP_DISCLAIMER)}</i>`,
    ]
      .filter((line) => line != null)
      .join('\n');

  return finalizeCaption(build, { hook, info, cta });
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
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  // Lonjakan besar: tanpa desimal biar enak di mobile
  if (Math.abs(n) >= 100) return `${sign}${n.toFixed(0)}%`;
  return `${sign}${n.toFixed(2)}%`;
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
  let reply_markup;
  if (snapshot.category === 'airdrop') {
    reply_markup = buildAirdropInlineKeyboard(snapshot);
  } else if (snapshot.category === 'news') {
    reply_markup = buildNewsInlineKeyboard(snapshot);
  } else {
    reply_markup = buildInlineKeyboard(snapshot);
  }
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
  formatNewsMessage,
  buildInlineKeyboard,
  buildAirdropInlineKeyboard,
  buildNewsInlineKeyboard,
  forwardToGroup,
  sendMarketPost,
  postToChannel,
  postToTestChat,
  telegramLength,
  clip,
  MAX_CAPTION_CHARS,
  OKX_WEB3_URLS,
  pickOkxWeb3Url,
  buildAffiliateButtons,
  buildRegisterButton,
};
