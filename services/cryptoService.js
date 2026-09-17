const axios = require('axios');

const OKX_BASE = 'https://www.okx.com';
const BITGET_BASE = 'https://api.bitget.com';

const MAJOR_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT'];

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

function topGainers(tickers, limit = 3) {
  return [...tickers]
    .filter((t) => t.changePct != null && t.volume24h != null && t.volume24h > 100000)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit);
}

/**
 * okx | bitget — auto bergantian tiap hari (WIB).
 */
function resolvePrimarySource() {
  const raw = (process.env.EXCHANGE_SOURCE || 'auto').toLowerCase();
  if (raw === 'okx' || raw === 'bitget') return raw;

  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
  });
  const dayNum = Number(day.replace(/-/g, ''));
  return dayNum % 2 === 0 ? 'okx' : 'bitget';
}

/**
 * Ambil ringkasan pasar; primarySource menentukan fokus konten + tombol affiliate.
 */
async function getMarketSnapshot() {
  const primarySource = resolvePrimarySource();
  const [okxTickers, bitgetTickers] = await Promise.all([
    fetchOkxTickers(),
    fetchBitgetTickers(),
  ]);

  const okx = {
    majors: pickMajors(okxTickers, 'OKX'),
    gainers: topGainers(okxTickers, 3),
  };
  const bitget = {
    majors: pickMajors(bitgetTickers, 'Bitget'),
    gainers: topGainers(bitgetTickers, 3),
  };

  const primary = primarySource === 'okx' ? okx : bitget;
  const primaryLabel = primarySource === 'okx' ? 'OKX' : 'Bitget';

  return {
    fetchedAt: new Date().toISOString(),
    primarySource,
    primaryLabel,
    primary,
    okx,
    bitget,
  };
}

/**
 * Ringkasan teks fokus ke exchange utama (untuk prompt AI).
 */
function buildMarketSummaryText(snapshot) {
  const { primary, primaryLabel, fetchedAt } = snapshot;
  const lines = [
    `Sumber data: ${primaryLabel}`,
    `Waktu data: ${fetchedAt}`,
    '',
    `Major (${primaryLabel}):`,
  ];

  for (const t of primary.majors) {
    lines.push(`- ${t.base}: $${formatPrice(t.last)} (${formatPct(t.changePct)})`);
  }

  lines.push('');
  lines.push(`Top Gainers 24h (${primaryLabel}):`);
  for (const t of primary.gainers) {
    lines.push(`- ${t.base}: $${formatPrice(t.last)} (${formatPct(t.changePct)})`);
  }

  return lines.join('\n');
}

module.exports = {
  getMarketSnapshot,
  buildMarketSummaryText,
  resolvePrimarySource,
  formatPrice,
  formatPct,
};
