const axios = require('axios');

const OKX_BASE = 'https://www.okx.com';
const BITGET_BASE = 'https://api.bitget.com';

const MAJOR_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT'];
const EXCLUDED_FROM_GAINERS = new Set(['BTC', 'ETH']);
const STABLE_BASES = new Set([
  'USDT', 'USDC', 'USD', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'BUSD',
]);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPct(value) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value) {
  if (value == null) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function isTradableAlt(t) {
  if (!t?.base || EXCLUDED_FROM_GAINERS.has(t.base)) return false;
  if (STABLE_BASES.has(t.base)) return false;
  if (t.changePct == null || t.volume24h == null) return false;
  if (t.last == null || t.last <= 0) return false;
  return t.volume24h >= 100000;
}

async function fetchOkxTickers() {
  const { data } = await axios.get(`${OKX_BASE}/api/v5/market/tickers`, {
    params: { instType: 'SPOT' },
    timeout: 15000,
  });

  if (data.code !== '0' || !Array.isArray(data.data)) {
    throw new Error(`OKX API error: ${data.msg || data.code}`);
  }

  return data.data
    .filter((t) => t.instId && t.instId.endsWith('-USDT'))
    .map((t) => {
      const last = toNumber(t.last);
      const open24h = toNumber(t.open24h);
      const changePct =
        last != null && open24h != null && open24h !== 0
          ? ((last - open24h) / open24h) * 100
          : null;

      return {
        exchange: 'OKX',
        symbol: t.instId,
        base: t.instId.replace('-USDT', ''),
        last,
        high24h: toNumber(t.high24h),
        low24h: toNumber(t.low24h),
        volume24h: toNumber(t.volCcy24h) ?? toNumber(t.vol24h),
        changePct,
      };
    });
}

async function fetchBitgetTickers() {
  const { data } = await axios.get(`${BITGET_BASE}/api/v2/spot/market/tickers`, {
    timeout: 15000,
  });

  if (data.code !== '00000' || !Array.isArray(data.data)) {
    throw new Error(`Bitget API error: ${data.msg || data.code}`);
  }

  return data.data
    .filter((t) => t.symbol && String(t.symbol).endsWith('USDT'))
    .map((t) => {
      const symbol = t.symbol.includes('-')
        ? t.symbol
        : t.symbol.replace(/USDT$/, '-USDT');

      return {
        exchange: 'Bitget',
        symbol,
        base: symbol.replace('-USDT', ''),
        last: toNumber(t.lastPr ?? t.close),
        high24h: toNumber(t.high24h),
        low24h: toNumber(t.low24h),
        volume24h: toNumber(t.quoteVolume ?? t.usdtVolume ?? t.baseVolume),
        changePct:
          toNumber(t.change24h) != null
            ? toNumber(t.change24h) * (Math.abs(toNumber(t.change24h)) < 1 ? 100 : 1)
            : null,
      };
    });
}

function pickMajors(tickers, exchangeLabel) {
  return MAJOR_PAIRS.map((pair) => {
    const found = tickers.find((t) => t.symbol === pair || t.symbol === pair.replace('-', ''));
    if (!found) return null;
    return { ...found, exchange: exchangeLabel };
  }).filter(Boolean);
}

/** TOP 3 GAINERS — abaikan BTC & ETH. */
function getTopGainers(tickers, limit = 3) {
  return [...tickers]
    .filter((t) => isTradableAlt(t) && t.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit)
    .map((t) => ({ ...t, tag: 'gainer' }));
}

/**
 * UNUSUAL VOLUME — volume terbesar + lonjakan harga positif.
 * Skor: volume * (1 + change%/100) agar harga naik + volume besar menonjol.
 */
function getUnusualVolume(tickers, limit = 3) {
  return [...tickers]
    .filter((t) => isTradableAlt(t) && t.changePct > 0)
    .map((t) => ({
      ...t,
      volumeScore: t.volume24h * (1 + Math.max(0, t.changePct) / 100),
      tag: 'unusual_volume',
    }))
    .sort((a, b) => b.volumeScore - a.volumeScore)
    .slice(0, limit);
}

/** Skor viral/hot untuk prioritas caption. */
function viralScore(t) {
  const vol = Math.max(1, t.volume24h || 1);
  const pct = Math.max(0, t.changePct || 0);
  return pct * Math.log10(vol + 10) + Math.log10(vol + 10);
}

/**
 * Pilih koin paling viral/hot dari gabungan gainers + unusual volume.
 * Mode: priority (default) | random (acak dari top kandidat).
 */
function pickHotCoin(candidates, mode = process.env.HOT_PICK_MODE || 'priority') {
  const unique = new Map();
  for (const c of candidates) {
    const key = `${c.exchange}:${c.symbol}`;
    const prev = unique.get(key);
    if (!prev || viralScore(c) > viralScore(prev)) unique.set(key, c);
  }

  const ranked = [...unique.values()]
    .map((t) => ({ ...t, viralScore: viralScore(t) }))
    .sort((a, b) => b.viralScore - a.viralScore);

  if (!ranked.length) return null;

  if (String(mode).toLowerCase() === 'random') {
    const pool = ranked.slice(0, Math.min(3, ranked.length));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return ranked[0];
}

function resolvePrimarySource() {
  const raw = (process.env.EXCHANGE_SOURCE || 'auto').toLowerCase();
  if (raw === 'okx' || raw === 'bitget') return raw;

  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
  });
  const dayNum = Number(day.replace(/-/g, ''));
  return dayNum % 2 === 0 ? 'okx' : 'bitget';
}

function buildExchangeBundle(tickers, exchangeLabel) {
  const topGainers = getTopGainers(tickers, 3);
  const unusualVolume = getUnusualVolume(tickers, 3);
  const hotCoin = pickHotCoin([...topGainers, ...unusualVolume]);

  return {
    majors: pickMajors(tickers, exchangeLabel),
    gainers: topGainers,
    topGainers,
    unusualVolume,
    hotCoin,
  };
}

/**
 * Ambil ringkasan pasar + top gainers + unusual volume + hot coin.
 */
async function getMarketSnapshot() {
  const primarySource = resolvePrimarySource();
  const [okxTickers, bitgetTickers] = await Promise.all([
    fetchOkxTickers(),
    fetchBitgetTickers(),
  ]);

  const okx = buildExchangeBundle(okxTickers, 'OKX');
  const bitget = buildExchangeBundle(bitgetTickers, 'Bitget');
  const primary = primarySource === 'okx' ? okx : bitget;
  const primaryLabel = primarySource === 'okx' ? 'OKX' : 'Bitget';

  return {
    fetchedAt: new Date().toISOString(),
    primarySource,
    primaryLabel,
    primary,
    hotCoin: primary.hotCoin,
    okx,
    bitget,
  };
}

function buildMarketSummaryText(snapshot) {
  const { primary, primaryLabel, fetchedAt, hotCoin } = snapshot;
  const lines = [
    `Sumber data: ${primaryLabel}`,
    `Waktu data: ${fetchedAt}`,
    '',
    `Major (${primaryLabel}):`,
  ];

  for (const t of primary.majors.slice(0, 5)) {
    lines.push(`- ${t.base}: $${formatPrice(t.last)} (${formatPct(t.changePct)})`);
  }

  lines.push('');
  lines.push(`TOP 3 GAINERS 24h (${primaryLabel}, tanpa BTC/ETH):`);
  for (const t of primary.topGainers || primary.gainers || []) {
    lines.push(
      `- ${t.base}: $${formatPrice(t.last)} (${formatPct(t.changePct)}) vol≈${Math.round(t.volume24h || 0)}`
    );
  }

  lines.push('');
  lines.push(`UNUSUAL VOLUME (${primaryLabel}, harga positif):`);
  for (const t of primary.unusualVolume || []) {
    lines.push(
      `- ${t.base}: $${formatPrice(t.last)} (${formatPct(t.changePct)}) vol≈${Math.round(t.volume24h || 0)}`
    );
  }

  const hot = hotCoin || primary.hotCoin;
  if (hot) {
    lines.push('');
    lines.push(
      `HOT/VIRAL PICK: ${hot.base} @ $${formatPrice(hot.last)} (${formatPct(hot.changePct)}) — fokus analisis caption`
    );
  }

  return lines.join('\n');
}

module.exports = {
  getMarketSnapshot,
  buildMarketSummaryText,
  resolvePrimarySource,
  getTopGainers,
  getUnusualVolume,
  pickHotCoin,
  viralScore,
  formatPrice,
  formatPct,
};
