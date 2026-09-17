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

/** Chain populer untuk narasi airdrop / early gem. */
const DEX_CHAINS = new Set(['solana', 'base', 'arbitrum']);
const DEXSCREENER_BASE = 'https://api.dexscreener.com';
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

function chainLabel(chainId) {
  const map = { solana: 'Solana', base: 'Base', arbitrum: 'Arbitrum' };
  return map[String(chainId || '').toLowerCase()] || chainId;
}

function mapDexScreenerPair(pair) {
  if (!pair?.chainId || !DEX_CHAINS.has(String(pair.chainId).toLowerCase())) return null;

  const vol1 = toNumber(pair.volume?.h1);
  const vol6 = toNumber(pair.volume?.h6);
  const vol24 = toNumber(pair.volume?.h24);
  const ch1 = toNumber(pair.priceChange?.h1);
  const ch6 = toNumber(pair.priceChange?.h6);
  const liq = toNumber(pair.liquidity?.usd);
  const price = toNumber(pair.priceUsd);
  const base = pair.baseToken?.symbol || pair.baseToken?.name;
  if (!base || !price) return null;

  // Lonjakan volume khas early gem: vol 1h atau 6h signifikan vs likuiditas
  const spikeVol = Math.max(vol1 || 0, (vol6 || 0) / 4);
  const liqSafe = Math.max(liq || 1, 1);
  const volumeSpikeRatio = spikeVol / liqSafe;

  return {
    source: 'dexscreener',
    chainId: String(pair.chainId).toLowerCase(),
    chain: chainLabel(pair.chainId),
    symbol: base,
    name: pair.baseToken?.name || base,
    address: pair.baseToken?.address || null,
    pairAddress: pair.pairAddress || null,
    priceUsd: price,
    change1h: ch1,
    change6h: ch6,
    change24h: toNumber(pair.priceChange?.h24),
    volume1h: vol1,
    volume6h: vol6,
    volume24h: vol24,
    liquidityUsd: liq,
    volumeSpikeRatio,
    dexId: pair.dexId || null,
    url: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`,
    txns1h: (toNumber(pair.txns?.h1?.buys) || 0) + (toNumber(pair.txns?.h1?.sells) || 0),
  };
}

function isEarlyGemCandidate(t) {
  if (!t || !DEX_CHAINS.has(t.chainId)) return false;
  const vol1 = t.volume1h || 0;
  const vol6 = t.volume6h || 0;
  const liq = t.liquidityUsd || 0;
  // Minimal aktivitas + lonjakan pendek (1–6 jam)
  if (vol1 < 15000 && vol6 < 80000) return false;
  if (liq > 0 && liq < 5000) return false; // terlalu tipis / mungkin honeypot noise
  // Prefer naik di window pendek ATAU volume spike tinggi
  const shortPump = (t.change1h != null && t.change1h >= 8) || (t.change6h != null && t.change6h >= 15);
  const hotVol = t.volumeSpikeRatio >= 0.35 || vol1 >= 80000 || vol6 >= 400000;
  return shortPump || hotVol;
}

function gemScore(t) {
  const vol = Math.max(t.volume1h || 0, (t.volume6h || 0) / 3, 1);
  const ch = Math.max(t.change1h || 0, (t.change6h || 0) / 2, 0);
  return ch * Math.log10(vol + 10) + Math.log10(vol + 10) * (t.volumeSpikeRatio || 0) * 10;
}

async function fetchDexScreenerBoostAddresses() {
  const urls = [
    `${DEXSCREENER_BASE}/token-boosts/top/v1`,
    `${DEXSCREENER_BASE}/token-boosts/latest/v1`,
  ];
  const items = [];
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      if (Array.isArray(data)) items.push(...data);
    } catch (err) {
      console.warn('[cryptoService] DexScreener boosts gagal:', err.message);
    }
  }

  const seen = new Set();
  const out = [];
  for (const item of items) {
    const chainId = String(item.chainId || '').toLowerCase();
    if (!DEX_CHAINS.has(chainId)) continue;
    const key = `${chainId}:${item.tokenAddress}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chainId, tokenAddress: item.tokenAddress, url: item.url });
  }
  return out.slice(0, 40);
}

async function fetchDexScreenerPairsByTokens(boosts) {
  const pairs = [];
  // Batch ~5 address agar tidak spam API
  const chunkSize = 5;
  for (let i = 0; i < boosts.length; i += chunkSize) {
    const chunk = boosts.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (b) => {
        try {
          const { data } = await axios.get(
            `${DEXSCREENER_BASE}/latest/dex/tokens/${b.tokenAddress}`,
            { timeout: 15000 }
          );
          const list = Array.isArray(data?.pairs) ? data.pairs : [];
          for (const p of list) {
            if (String(p.chainId).toLowerCase() !== b.chainId) continue;
            const mapped = mapDexScreenerPair(p);
            if (mapped) pairs.push(mapped);
          }
        } catch {
          // skip token
        }
      })
    );
  }
  return pairs;
}

async function fetchGeckoTrendingPools() {
  const networks = ['solana', 'base', 'arbitrum'];
  const gems = [];

  await Promise.all(
    networks.map(async (network) => {
      try {
        const { data } = await axios.get(
          `${GECKO_BASE}/networks/${network}/trending_pools`,
          {
            timeout: 15000,
            headers: { Accept: 'application/json' },
            params: { include: 'base_token', page: 1 },
          }
        );
        const rows = Array.isArray(data?.data) ? data.data : [];
        for (const row of rows) {
          const a = row.attributes || {};
          const vol = a.volume_usd || {};
          const priceChange = a.price_change_percentage || {};
          const name = a.name || '';
          const symbol = String(name).split('/')[0].trim() || name;
          const mapped = {
            source: 'geckoterminal',
            chainId: network,
            chain: chainLabel(network),
            symbol,
            name,
            address: a.address || null,
            pairAddress: a.address || null,
            priceUsd: toNumber(a.base_token_price_usd),
            change1h: toNumber(priceChange.h1),
            change6h: toNumber(priceChange.h6),
            change24h: toNumber(priceChange.h24),
            volume1h: toNumber(vol.h1),
            volume6h: toNumber(vol.h6),
            volume24h: toNumber(vol.h24),
            liquidityUsd: toNumber(a.reserve_in_usd),
            volumeSpikeRatio:
              (toNumber(vol.h1) || 0) / Math.max(toNumber(a.reserve_in_usd) || 1, 1),
            dexId: a.dex_id || null,
            url: a.address
              ? `https://www.geckoterminal.com/${network}/pools/${a.address}`
              : `https://www.geckoterminal.com/${network}`,
            txns1h: toNumber(a.transactions?.h1?.buys) || 0,
          };
          gems.push(mapped);
        }
      } catch (err) {
        console.warn(`[cryptoService] GeckoTerminal ${network} gagal:`, err.message);
      }
    })
  );

  return gems;
}

/**
 * Ambil token trending DEX/on-chain (DexScreener + GeckoTerminal),
 * saring Solana/Base/Arbitrum dengan lonjakan volume 1–6 jam.
 */
async function getDexAirdropSnapshot(limit = 5) {
  const boosts = await fetchDexScreenerBoostAddresses();
  const [dexPairs, geckoPools] = await Promise.all([
    fetchDexScreenerPairsByTokens(boosts),
    fetchGeckoTrendingPools(),
  ]);

  const merged = new Map();
  for (const t of [...dexPairs, ...geckoPools]) {
    if (!isEarlyGemCandidate(t)) continue;
    const key = `${t.chainId}:${(t.symbol || '').toUpperCase()}:${t.pairAddress || t.address}`;
    const prev = merged.get(key);
    if (!prev || gemScore(t) > gemScore(prev)) merged.set(key, t);
  }

  const ranked = [...merged.values()]
    .map((t) => ({ ...t, gemScore: gemScore(t) }))
    .sort((a, b) => b.gemScore - a.gemScore)
    .slice(0, limit);

  const pick =
    ranked[0] ||
    null;

  return {
    category: 'airdrop',
    fetchedAt: new Date().toISOString(),
    primarySource: 'dex',
    primaryLabel: 'DEX / On-chain',
    chains: ['solana', 'base', 'arbitrum'],
    gems: ranked,
    hotGem: pick,
    hotCoin: pick
      ? {
          base: pick.symbol,
          last: pick.priceUsd,
          changePct: pick.change1h ?? pick.change6h,
          exchange: pick.chain,
        }
      : null,
  };
}

function buildAirdropSummaryText(snapshot) {
  const lines = [
    'Kategori: Airdrop / Early Gem Opportunity (DEX)',
    `Waktu data: ${snapshot.fetchedAt}`,
    `Chain fokus: ${(snapshot.chains || []).join(', ')}`,
    '',
  ];

  if (snapshot.hotGem) {
    const g = snapshot.hotGem;
    lines.push('HOT GEM PICK:');
    lines.push(
      `- ${g.symbol} (${g.chain}) $${formatPrice(g.priceUsd)} | 1h ${formatPct(g.change1h)} | 6h ${formatPct(g.change6h)}`
    );
    lines.push(
      `  vol1h≈${Math.round(g.volume1h || 0)} | vol6h≈${Math.round(g.volume6h || 0)} | liq≈${Math.round(g.liquidityUsd || 0)}`
    );
    lines.push(`  url: ${g.url}`);
    lines.push('');
  }

  lines.push('Watchlist trending (volume spike 1–6h):');
  for (const g of snapshot.gems || []) {
    lines.push(
      `- ${g.symbol} @ ${g.chain}: $${formatPrice(g.priceUsd)} (1h ${formatPct(g.change1h)}, 6h ${formatPct(g.change6h)}) vol1h≈${Math.round(g.volume1h || 0)}`
    );
  }

  if (!(snapshot.gems || []).length) {
    lines.push('- (tidak ada kandidat yang lolos filter saat ini)');
  }

  return lines.join('\n');
}

module.exports = {
  getMarketSnapshot,
  buildMarketSummaryText,
  getDexAirdropSnapshot,
  buildAirdropSummaryText,
  resolvePrimarySource,
  getTopGainers,
  getUnusualVolume,
  pickHotCoin,
  viralScore,
  formatPrice,
  formatPct,
  DEX_CHAINS,
};
