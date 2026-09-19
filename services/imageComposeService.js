const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

const WIDTH = 1024;
const HEIGHT = 576;

/** Logo exchange lokal — andal di GHA tanpa tergantung CDN. */
const LOCAL_LOGOS = {
  OKX: path.join(__dirname, '..', 'assets', 'logos', 'okx.png'),
  BITGET: path.join(__dirname, '..', 'assets', 'logos', 'bitget.png'),
};

/** CDN icon statis (hanya jika file memang ada). */
const ICON_CDN =
  'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color';

/**
 * Logo resmi via CoinGecko CDN (bukan AI).
 * Sumber: coin-images.coingecko.com — di-cache di process.
 */
const COINGECKO_LARGE = {
  BTC: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
  ETH: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
  SOL: 'https://coin-images.coingecko.com/coins/images/4128/large/solana.png',
  OKB: 'https://coin-images.coingecko.com/coins/images/4463/large/WeChat_Image_20220118095654.png',
  BNB: 'https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  XRP: 'https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
  DOGE: 'https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png',
  ADA: 'https://coin-images.coingecko.com/coins/images/975/large/cardano.png',
  AVAX: 'https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
  DOT: 'https://coin-images.coingecko.com/coins/images/12171/large/polkadot.png',
  LINK: 'https://coin-images.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
  MATIC: 'https://coin-images.coingecko.com/coins/images/4713/large/polygon.png',
  POL: 'https://coin-images.coingecko.com/coins/images/32440/large/polygon.png',
  ATOM: 'https://coin-images.coingecko.com/coins/images/1481/large/cosmos_hub.png',
  UNI: 'https://coin-images.coingecko.com/coins/images/12504/large/uniswap-logo.png',
  APT: 'https://coin-images.coingecko.com/coins/images/26455/large/aptos_round.png',
  SUI: 'https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png',
  TIA: 'https://coin-images.coingecko.com/coins/images/31967/large/tia.jpg',
  USDT: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png',
  USDC: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
  TRX: 'https://coin-images.coingecko.com/coins/images/1094/large/tron-logo.png',
  LTC: 'https://coin-images.coingecko.com/coins/images/2/large/litecoin.png',
  BCH: 'https://coin-images.coingecko.com/coins/images/780/large/bitcoin-cash-circle.png',
  NEAR: 'https://coin-images.coingecko.com/coins/images/10365/large/near.jpg',
  ARB: 'https://coin-images.coingecko.com/coins/images/16547/large/arb.jpg',
  OP: 'https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png',
  SHIB: 'https://coin-images.coingecko.com/coins/images/11939/large/shiba.png',
  PEPE: 'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg',
  WIF: 'https://coin-images.coingecko.com/coins/images/33566/large/dogwifhat.jpg',
  TON: 'https://coin-images.coingecko.com/coins/images/17980/large/ton_symbol.png',
  BGB: 'https://coin-images.coingecko.com/coins/images/11610/large/Bitget_logo.png',
};

/** Bukan koin publik / poin internal — jangan tampilkan logo karangan. */
const NON_COIN_TICKERS = new Set([
  'CP', // OKX Campaign / Flash Earn points
  'POINTS',
  'POINT',
  'REWARD',
  'REWARDS',
  'CREDIT',
  'CREDITS',
  'OKX',
  'BITGET',
]);

const TICKER_FILE = {
  BTC: 'btc',
  ETH: 'eth',
  SOL: 'sol',
  BNB: 'bnb',
  XRP: 'xrp',
  DOGE: 'doge',
  ADA: 'ada',
  AVAX: 'avax',
  DOT: 'dot',
  LINK: 'link',
  MATIC: 'matic',
  POL: 'matic',
  ATOM: 'atom',
  UNI: 'uni',
  USDT: 'usdt',
  USDC: 'usdc',
  TRX: 'trx',
  LTC: 'ltc',
  BCH: 'bch',
  NEAR: 'near',
  SHIB: 'shib',
};

const EXCHANGE_LOGOS = {
  OKX: [
    'https://static.okx.com/cdn/assets/imgs/221/187957948BD02D97.png',
  ],
  BITGET: [
    // CMC exchange id 540 = Bitget (jangan pakai 1300)
    'https://s2.coinmarketcap.com/static/img/exchanges/128x128/540.png',
    'https://s2.coinmarketcap.com/static/img/exchanges/64x64/540.png',
  ],
};

const bufferCache = new Map();
const geckoResolveCache = new Map(); // symbol -> imageUrl | null

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text, maxChars, maxLines = 2) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > 3 ? `${last.slice(0, maxChars - 1)}…` : last;
  }
  return lines;
}

function normalizeTicker(ticker) {
  return String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

function isRenderableTicker(ticker) {
  const sym = normalizeTicker(ticker);
  if (!sym) return false;
  if (NON_COIN_TICKERS.has(sym)) return false;
  // Izinkan ticker 1 huruf (mis. G) jika itu simbol exchange asli
  if (sym.length < 1 || sym.length > 12) return false;
  return true;
}

async function fetchBuffer(url, { timeout = 18000 } = {}) {
  if (!url) return null;
  if (bufferCache.has(url)) return bufferCache.get(url);
  try {
    const { data, headers } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout,
      headers: { 'User-Agent': 'JFNetwork-Autopost/1.0' },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const buf = Buffer.from(data);
    const ctype = String(headers['content-type'] || '');
    if (buf.length < 200) return null;
    if (ctype && !/image|octet-stream|png|jpeg|webp|svg/i.test(ctype) && buf[0] === 0x3c) {
      // likely HTML error page
      return null;
    }
    bufferCache.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Resolve URL logo resmi dari CoinGecko (exact symbol match saja).
 * Jangan ambil hasil pencarian yang beda ticker (mis. CP → ICP).
 */
async function resolveCoinGeckoLogoUrl(symbol) {
  const sym = normalizeTicker(symbol);
  if (!isRenderableTicker(sym)) return null;
  if (geckoResolveCache.has(sym)) return geckoResolveCache.get(sym);
  if (COINGECKO_LARGE[sym]) {
    geckoResolveCache.set(sym, COINGECKO_LARGE[sym]);
    return COINGECKO_LARGE[sym];
  }

  const pickUrl = (coin) => {
    if (!coin) return null;
    if (coin.large) return coin.large;
    if (coin.image) return coin.image;
    if (coin.thumb) return String(coin.thumb).replace('/thumb/', '/large/');
    return null;
  };

  try {
    // 1) Search — pilih exact symbol dengan market_cap_rank terbaik
    const { data } = await axios.get('https://api.coingecko.com/api/v3/search', {
      params: { query: sym },
      timeout: 12000,
      headers: { 'User-Agent': 'JFNetwork-Autopost/1.0', Accept: 'application/json' },
    });
    const coins = Array.isArray(data?.coins) ? data.coins : [];
    const exacts = coins
      .filter((c) => String(c.symbol || '').toUpperCase() === sym)
      .sort((a, b) => (a.market_cap_rank || 99999) - (b.market_cap_rank || 99999));
    let url = pickUrl(exacts[0]);

    // 2) Fallback markets by symbol (untuk ticker pendek seperti G)
    if (!url) {
      const m = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params: { vs_currency: 'usd', symbols: sym.toLowerCase(), per_page: 10 },
        timeout: 12000,
        headers: { 'User-Agent': 'JFNetwork-Autopost/1.0', Accept: 'application/json' },
      });
      const rows = (Array.isArray(m.data) ? m.data : [])
        .filter((c) => String(c.symbol || '').toUpperCase() === sym)
        .sort((a, b) => (a.market_cap_rank || 99999) - (b.market_cap_rank || 99999));
      // Ambil yang rank terbaik; skip kalau tidak ada rank & nama terlalu asing? tetap pakai terbaik.
      url = pickUrl(rows[0]);
    }

    geckoResolveCache.set(sym, url || null);
    return url || null;
  } catch (err) {
    console.warn(`[imageCompose] CoinGecko resolve ${sym}:`, err.message);
    geckoResolveCache.set(sym, null);
    return null;
  }
}

async function bufferToCircularLogo(raw, size) {
  const resized = await sharp(raw)
    .resize(size, size, {
      fit: 'cover',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const outer = size + 8;
  const ringed = await sharp({
    create: {
      width: outer,
      height: outer,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.95 },
    },
  })
    .composite([{ input: resized, left: 4, top: 4 }])
    .png()
    .toBuffer();

  const circle = Buffer.from(
    `<svg width="${outer}" height="${outer}"><circle cx="${outer / 2}" cy="${outer / 2}" r="${outer / 2}" fill="#fff"/></svg>`
  );
  return sharp(ringed)
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * Logo koin besar + ring neon brand (Bitget cyan / OKX hijau) untuk layout spotlight.
 */
async function bufferToSpotlightCoin(raw, size, exchange = 'OKX') {
  const accent = brandAccent(exchange);
  const pad = 12;
  const outer = size + pad * 2;
  const resized = await sharp(raw)
    .resize(size, size, {
      fit: 'cover',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const ringSvg = Buffer.from(
    `<svg width="${outer}" height="${outer}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="${accent.fill}" stop-opacity="0.7"/>
          <stop offset="100%" stop-color="${accent.fill}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${outer / 2}" cy="${outer / 2}" r="${outer / 2 - 1}" fill="url(#g)"/>
      <circle cx="${outer / 2}" cy="${outer / 2}" r="${size / 2 + 7}"
        fill="none" stroke="${accent.fill}" stroke-width="5" stroke-opacity="0.95"/>
      <circle cx="${outer / 2}" cy="${outer / 2}" r="${size / 2 + 2}" fill="#0b1220"/>
    </svg>`
  );

  const masked = await sharp(resized)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  return sharp(ringSvg)
    .composite([{ input: masked, left: pad, top: pad }])
    .png()
    .toBuffer();
}

/**
 * Ambil logo koin resmi. Tidak pernah membuat logo "ngarang".
 * @returns {Promise<Buffer|null>}
 */
async function loadTokenLogo(ticker, size = 96, imageUrl = null) {
  const sym = normalizeTicker(ticker);
  if (!isRenderableTicker(sym) && !imageUrl) return null;

  const candidates = [];
  if (imageUrl) candidates.push(imageUrl);
  if (COINGECKO_LARGE[sym]) candidates.push(COINGECKO_LARGE[sym]);

  const file = TICKER_FILE[sym];
  if (file) {
    candidates.push(`${ICON_CDN}/${file}.png`);
  }

  const geckoUrl = await resolveCoinGeckoLogoUrl(sym);
  if (geckoUrl) candidates.push(geckoUrl);

  const tried = new Set();
  for (const url of candidates) {
    if (!url || tried.has(url)) continue;
    tried.add(url);
    const raw = await fetchBuffer(url);
    if (!raw) continue;
    try {
      return await bufferToCircularLogo(raw, size);
    } catch {
      // coba URL berikutnya
    }
  }

  console.warn(`[imageCompose] Logo tidak ditemukan untuk ${sym} — dilewati (no fake badge)`);
  return null;
}

async function loadTokenLogoSpotlight(ticker, size = 220, imageUrl = null, exchange = 'OKX') {
  const sym = normalizeTicker(ticker);
  if (!isRenderableTicker(sym) && !imageUrl) return null;

  const candidates = [];
  if (imageUrl) candidates.push(imageUrl);
  if (COINGECKO_LARGE[sym]) candidates.push(COINGECKO_LARGE[sym]);
  const file = TICKER_FILE[sym];
  if (file) candidates.push(`${ICON_CDN}/${file}.png`);
  const geckoUrl = await resolveCoinGeckoLogoUrl(sym);
  if (geckoUrl) candidates.push(geckoUrl);

  const tried = new Set();
  for (const url of candidates) {
    if (!url || tried.has(url)) continue;
    tried.add(url);
    const raw = await fetchBuffer(url);
    if (!raw) continue;
    try {
      return await bufferToSpotlightCoin(raw, size, exchange);
    } catch {
      // coba URL berikutnya
    }
  }
  console.warn(`[imageCompose] Spotlight logo ${sym} gagal — dilewati`);
  return null;
}

async function loadExchangeLogo(exchange, height = 44) {
  const key = String(exchange || 'OKX').toUpperCase().includes('BITGET')
    ? 'BITGET'
    : 'OKX';

  // 1) File lokal (paling andal di GHA)
  try {
    const localPath = LOCAL_LOGOS[key];
    if (localPath && fs.existsSync(localPath)) {
      return await sharp(localPath)
        .resize({ height, fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();
    }
  } catch {
    // lanjut CDN
  }

  // 2) CDN fallback
  const urls = EXCHANGE_LOGOS[key] || [];
  for (const url of urls) {
    const raw = await fetchBuffer(url);
    if (!raw) continue;
    try {
      return await sharp(raw)
        .resize({ height, fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();
    } catch {
      // coba URL berikutnya
    }
  }

  console.warn(`[imageCompose] Logo ${key} gagal diunduh — pakai badge teks`);
  const label = key === 'BITGET' ? 'Bitget' : 'OKX';
  const w = key === 'BITGET' ? 120 : 90;
  const brand = key === 'BITGET' ? '#00f0ff' : '#00ff66';
  const svg = Buffer.from(
    `<svg width="${w}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${height}" rx="8" fill="#0b1220" stroke="${brand}" stroke-width="2"/>
      <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
    </svg>`
  );
  return sharp(svg).png().toBuffer();
}

function pickLayout(meta = {}) {
  const logoCount = Array.isArray(meta.logoEntries)
    ? meta.logoEntries.length
    : (meta.tickers || []).length;
  // 1 token: selalu spotlight (kartu listing profesional)
  if (logoCount <= 1) return 'spotlight';

  const key = `${meta.title || ''}|${(meta.tickers || []).join(',')}|${meta.badge || ''}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return ['center', 'bottom', 'stack'][hash % 3];
}

function brandAccent(exchange) {
  // Bitget: hitam/putih + cyan · OKX: hitam + hijau neon
  return String(exchange || '')
    .toUpperCase()
    .includes('BITGET')
    ? { fill: '#00F0FF', soft: 'rgba(0,240,255,0.35)', badge: '#0d9488' }
    : { fill: '#00FF66', soft: 'rgba(0,255,102,0.35)', badge: '#16a34a' };
}

function buildOverlaySvg({
  titleLines,
  hookLines,
  badge,
  width,
  height,
  layout = 'center',
  singleLogo = false,
  exchange = 'OKX',
  pctLabel = '',
}) {
  const accent = brandAccent(exchange);
  const isSpotlight = layout === 'spotlight' && singleLogo;

  let titleFont = singleLogo ? 48 : 36;
  let hookFont = 22;
  let titleY = 140;
  let titleX = '50%';
  let titleAnchor = 'middle';
  let hookY = height - 100;
  let hookX = '50%';
  let hookAnchor = 'middle';

  if (isSpotlight) {
    // Teks kiri terklaster, koin kanan besar (kartu listing)
    titleFont = 58;
    hookFont = 26;
    titleY = 195;
    titleX = '6%';
    titleAnchor = 'start';
    hookY = height - 88;
    hookX = '6%';
    hookAnchor = 'start';
  } else if (layout === 'hero') {
    titleY = singleLogo ? 200 : 150;
    titleX = singleLogo ? '68%' : '50%';
    hookY = height - 90;
  } else if (layout === 'stack') {
    titleY = singleLogo ? 360 : 320;
    hookY = height - 80;
  } else if (layout === 'bottom') {
    titleY = 120;
    hookY = 250;
  }

  const titleSpans = titleLines
    .map(
      (line, i) =>
        `<tspan x="${titleX}" dy="${i === 0 ? 0 : 52}">${escapeXml(line)}</tspan>`
    )
    .join('');
  const hookSpans = hookLines
    .map(
      (line, i) =>
        `<tspan x="${hookX}" dy="${i === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`
    )
    .join('');

  const pctBlock =
    isSpotlight && pctLabel
      ? `<text x="${titleX}" y="${titleY + 58}" text-anchor="${titleAnchor}"
           font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700"
           fill="${accent.fill}" filter="url(#shadow)">${escapeXml(pctLabel)}</text>
         <text x="${titleX}" y="${titleY + 96}" text-anchor="${titleAnchor}"
           font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="600"
           fill="#94a3b8" filter="url(#shadow)">Top Move</text>`
      : '';

  const titleYAdj = isSpotlight && pctLabel ? titleY - 8 : titleY;
  const hookYAdj = hookY;

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topFade" x1="0" y1="0" x2="${isSpotlight ? '1' : '0'}" y2="${isSpotlight ? '0' : '1'}">
          <stop offset="0%" stop-color="#000000" stop-opacity="${isSpotlight ? '0.78' : '0.70'}"/>
          <stop offset="55%" stop-color="#000000" stop-opacity="${isSpotlight ? '0.22' : '0.25'}"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="${isSpotlight ? '0.55' : '0.78'}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.85"/>
        </filter>
        <radialGradient id="coinGlow" cx="62%" cy="48%" r="38%">
          <stop offset="0%" stop-color="${accent.fill}" stop-opacity="0.55"/>
          <stop offset="55%" stop-color="${accent.fill}" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#topFade)"/>
      ${isSpotlight ? `<rect width="${width}" height="${height}" fill="url(#coinGlow)"/>` : ''}
      ${
        badge
          ? `<rect x="${width - 200}" y="22" width="172" height="36" rx="18" fill="${accent.badge}" fill-opacity="0.95"/>
             <text x="${width - 114}" y="46" text-anchor="middle"
               font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeXml(badge)}</text>`
          : ''
      }
      <text x="${titleX}" y="${titleYAdj}" text-anchor="${titleAnchor}"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="${titleFont}" font-weight="800"
        fill="#ffffff" filter="url(#shadow)">${titleSpans}</text>
      ${pctBlock}
      <text x="${hookX}" y="${hookYAdj}" text-anchor="${hookAnchor}"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="${hookFont}" font-weight="600"
        fill="#fde68a" filter="url(#shadow)">${hookSpans}</text>
    </svg>`
  );
}

function logoPlacement(layout, count, logoOuter, width, height) {
  const gap = count > 1 ? 16 : 0;
  const totalW = count * logoOuter + Math.max(0, count - 1) * gap;
  const positions = [];

  if (layout === 'spotlight' && count === 1) {
    // Koin besar di kanan — dekat ke teks agar tidak bolong di tengah
    positions.push({
      left: Math.round(width * 0.52),
      top: Math.round((height - logoOuter) / 2 - 6),
    });
    return positions;
  }

  if (layout === 'hero' && count === 1) {
    positions.push({
      left: Math.round(width * 0.12),
      top: Math.round(height / 2 - logoOuter / 2),
    });
    return positions;
  }

  let y = Math.round(height / 2 - logoOuter / 2 + 8);
  if (layout === 'stack') y = count === 1 ? 110 : 130;
  if (layout === 'bottom') y = height - 200;

  let x = Math.round((width - totalW) / 2);
  for (let i = 0; i < count; i++) {
    positions.push({ left: x, top: y });
    x += logoOuter + gap;
  }
  return positions;
}

/** Potong pojok kanan-bawah agar watermark Pollinations hilang. */
async function prepareBackground(backgroundBuffer) {
  const meta = await sharp(backgroundBuffer).metadata();
  const w = meta.width || WIDTH;
  const h = meta.height || HEIGHT;
  // Crop ~6% kanan & bawah (area watermark), lalu stretch ke canvas
  const cropW = Math.max(100, Math.round(w * 0.94));
  const cropH = Math.max(100, Math.round(h * 0.94));
  return sharp(backgroundBuffer)
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .modulate({ brightness: 0.85, saturation: 1.05 })
    .png()
    .toBuffer();
}

/**
 * @param {Buffer} backgroundBuffer
 * @param {{
 *   title?: string,
 *   hook?: string,
 *   tickers?: string[],
 *   logoEntries?: Array<{ symbol: string, imageUrl?: string|null }>,
 *   exchange?: string,
 *   badge?: string
 * }} meta
 */
async function composePromoImage(backgroundBuffer, meta = {}) {
  const title = String(meta.title || 'Crypto Update').trim();
  const hook = String(meta.hook || '').trim();
  const exchange = meta.exchange || 'OKX';
  const badge = meta.badge || '';
  const layout = meta.layout || pickLayout(meta);

  /** @type {Array<{ symbol: string, imageUrl?: string|null }>} */
  let entries = Array.isArray(meta.logoEntries) ? [...meta.logoEntries] : [];
  if (!entries.length && Array.isArray(meta.tickers)) {
    entries = meta.tickers.map((t) => ({ symbol: t }));
  }

  const seen = new Set();
  entries = entries
    .map((e) => ({
      symbol: normalizeTicker(e.symbol || e.ticker || e.base),
      imageUrl: e.imageUrl || e.logoUrl || null,
    }))
    .filter((e) => {
      if (!e.symbol) return false;
      if (seen.has(e.symbol)) return false;
      if (!isRenderableTicker(e.symbol) && !e.imageUrl) return false;
      seen.add(e.symbol);
      return true;
    })
    .slice(0, 6);

  const bg = await prepareBackground(backgroundBuffer);
  const singleLogo = entries.length <= 1;
  const isSpotlight = layout === 'spotlight' && singleLogo;
  const pctLabel = String(meta.pctLabel || '').trim();
  const titleMax = isSpotlight ? 22 : layout === 'hero' && singleLogo ? 28 : 36;
  const titleLines = wrapLines(title, titleMax, 2);
  const hookLines = wrapLines(hook, isSpotlight ? 36 : 48, 2);
  const overlaySvg = buildOverlaySvg({
    titleLines,
    hookLines,
    badge,
    width: WIDTH,
    height: HEIGHT,
    layout,
    singleLogo,
    exchange,
    pctLabel,
  });

  const composites = [{ input: overlaySvg, left: 0, top: 0 }];

  try {
    // Bitget wordmark lebar → height lebih kecil agar proporsional di pojok
    const isBitget = String(exchange).toUpperCase().includes('BITGET');
    const exLogo = await loadExchangeLogo(exchange, isBitget ? 36 : 40);
    composites.push({ input: exLogo, left: 28, top: 22 });
  } catch {
    // ignore
  }

  if (entries.length) {
    const logoSize =
      entries.length === 1
        ? isSpotlight
          ? 220
          : layout === 'hero'
            ? 168
            : 128
        : entries.length >= 5
          ? 72
          : 88;
    const logos = [];
    for (const e of entries) {
      try {
        const logo = isSpotlight
          ? await loadTokenLogoSpotlight(e.symbol, logoSize, e.imageUrl, exchange)
          : await loadTokenLogo(e.symbol, logoSize, e.imageUrl);
        if (logo) logos.push(logo);
      } catch {
        // skip
      }
    }

    if (logos.length) {
      const outer = isSpotlight ? logoSize + 24 : logoSize + 8;
      const places = logoPlacement(layout, logos.length, outer, WIDTH, HEIGHT);
      logos.forEach((logo, i) => {
        const p = places[i];
        if (p) composites.push({ input: logo, left: p.left, top: p.top });
      });
    }
  }

  console.log(
    `[imageCompose] layout=${layout} logos=${entries.map((e) => e.symbol).join(',') || '-'}`
  );

  return sharp(bg).composite(composites).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

module.exports = {
  WIDTH,
  HEIGHT,
  composePromoImage,
  loadTokenLogo,
  loadExchangeLogo,
  fetchBuffer,
  wrapLines,
  isRenderableTicker,
  normalizeTicker,
  resolveCoinGeckoLogoUrl,
  pickLayout,
  NON_COIN_TICKERS,
};
