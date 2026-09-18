const axios = require('axios');
const { THRESHOLDS, GOPLUS_CHAIN } = require('./thresholds');

const http = axios.create({
  timeout: 18000,
  headers: { 'User-Agent': 'JFNetwork-DexScreen/1.0', Accept: 'application/json' },
});

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeChain(chainId) {
  return String(chainId || '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Ambil kandidat dari DexScreener (boosts + profiles) lalu enrich pair data.
 */
async function fetchDexScreenerCandidates() {
  const seeds = [];
  const urls = [
    'https://api.dexscreener.com/token-boosts/top/v1',
    'https://api.dexscreener.com/token-profiles/latest/v1',
  ];

  for (const url of urls) {
    try {
      const { data } = await http.get(url);
      if (Array.isArray(data)) seeds.push(...data);
    } catch (err) {
      console.warn('[dexScreen] DexScreener seed gagal:', url, err.message);
    }
  }

  const allowed = new Set(THRESHOLDS.chains);
  const seen = new Set();
  const unique = [];

  for (const s of seeds) {
    const chain = normalizeChain(s.chainId);
    const address = s.tokenAddress || s.address;
    if (!chain || !address) continue;
    if (allowed.size && !allowed.has(chain)) continue;
    const key = `${chain}:${String(address).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ chain, address, source: 'dexscreener-seed' });
    if (unique.length >= THRESHOLDS.maxCandidates) break;
  }

  const enriched = [];
  for (const item of unique) {
    try {
      const pair = await fetchBestPair(item.chain, item.address);
      if (pair) enriched.push(pair);
    } catch (err) {
      console.warn(`[dexScreen] pair ${item.chain}:${item.address}:`, err.message);
    }
  }
  return enriched;
}

async function fetchBestPair(chain, address) {
  const { data } = await http.get(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`
  );
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const chainPairs = pairs.filter(
    (p) => normalizeChain(p.chainId) === normalizeChain(chain)
  );
  const pool = chainPairs.length ? chainPairs : pairs;
  if (!pool.length) return null;

  pool.sort(
    (a, b) =>
      (toNum(b.liquidity?.usd) || 0) - (toNum(a.liquidity?.usd) || 0) ||
      (toNum(b.volume?.h24) || 0) - (toNum(a.volume?.h24) || 0)
  );
  const p = pool[0];
  const buys = toNum(p.txns?.h24?.buys) || 0;
  const sells = toNum(p.txns?.h24?.sells) || 0;
  const mc = toNum(p.marketCap) ?? toNum(p.fdv);
  const fdv = toNum(p.fdv) ?? toNum(p.marketCap);

  return {
    source: 'dexscreener',
    chain: normalizeChain(p.chainId),
    address: p.baseToken?.address || address,
    symbol: p.baseToken?.symbol || '???',
    name: p.baseToken?.name || p.baseToken?.symbol || 'Unknown',
    pairAddress: p.pairAddress || null,
    priceUsd: toNum(p.priceUsd),
    marketCapUsd: mc,
    fdvUsd: fdv,
    liquidityUsd: toNum(p.liquidity?.usd),
    volume24hUsd: toNum(p.volume?.h24),
    change24hPct: toNum(p.priceChange?.h24),
    buys24h: buys,
    sells24h: sells,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? 99 : 0,
    url: p.url || `https://dexscreener.com/${p.chainId}/${p.pairAddress}`,
    imageUrl: p.info?.imageUrl || null,
    dexId: p.dexId || null,
    goplusChain: GOPLUS_CHAIN[normalizeChain(p.chainId)] || null,
  };
}

/**
 * New pools GeckoTerminal (pelengkap kandidat).
 */
async function fetchGeckoNewPools() {
  const networks = THRESHOLDS.chains.filter((c) =>
    ['solana', 'eth', 'ethereum', 'bsc', 'base', 'arbitrum'].includes(c)
  );
  const mapNet = {
    ethereum: 'eth',
    eth: 'eth',
    bsc: 'bsc',
    solana: 'solana',
    base: 'base',
    arbitrum: 'arbitrum',
  };

  const out = [];
  await Promise.all(
    networks.map(async (chain) => {
      const net = mapNet[chain] || chain;
      try {
        const { data } = await http.get(
          `https://api.geckoterminal.com/api/v2/networks/${net}/new_pools`,
          { params: { page: 1 } }
        );
        const rows = Array.isArray(data?.data) ? data.data : [];
        for (const row of rows.slice(0, 8)) {
          const a = row.attributes || {};
          const name = String(a.name || '');
          const symbol = name.split('/')[0]?.trim() || name;
          // Enrich via DexScreener by searching symbol is weak — skip without address
          const addr =
            a.address ||
            row.relationships?.base_token?.data?.id?.split('_')?.[1] ||
            null;
          if (!addr) continue;
          const pair = await fetchBestPair(chain === 'eth' ? 'ethereum' : chain, addr);
          if (pair) out.push({ ...pair, source: 'geckoterminal' });
        }
      } catch (err) {
        console.warn(`[dexScreen] Gecko ${chain}:`, err.message);
      }
    })
  );
  return out;
}

async function collectCandidates() {
  const fromDex = await fetchDexScreenerCandidates();
  let fromGecko = [];
  if (process.env.DEX_SCREEN_INCLUDE_GECKO === 'true') {
    fromGecko = await fetchGeckoNewPools();
  }

  const seen = new Set();
  const merged = [];
  for (const t of [...fromDex, ...fromGecko]) {
    const key = `${t.chain}:${String(t.address).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  return merged.slice(0, THRESHOLDS.maxCandidates);
}

module.exports = {
  collectCandidates,
  fetchBestPair,
  fetchDexScreenerCandidates,
  fetchGeckoNewPools,
  toNum,
  normalizeChain,
};
