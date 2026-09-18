const { runDexScreenCycle } = require('./index');
const { markPosted } = require('./cache');
const { THRESHOLDS } = require('./thresholds');

/**
 * Snapshot autopost dari token yang LOLOS filter ketat (bukan asal gem).
 * Dipakai kategori airdrop/DEX → CTA tetap OKX Web3.
 */
async function getSafeDexAutopostSnapshot() {
  // Autopost: 1 alert cukup; jangan spam channel
  const prevMax = THRESHOLDS.maxAlertsPerRun;
  THRESHOLDS.maxAlertsPerRun = Math.min(prevMax, 1);

  let cycle;
  try {
    cycle = await runDexScreenCycle({ dryRun: true });
  } finally {
    THRESHOLDS.maxAlertsPerRun = prevMax;
  }

  const row = cycle.passed?.[0] || null;
  if (!row) {
    return {
      category: 'airdrop',
      screened: true,
      safePass: false,
      fetchedAt: new Date().toISOString(),
      primarySource: 'dex-safe',
      primaryLabel: 'DEX Safe Screen',
      chains: THRESHOLDS.chains,
      gems: [],
      hotGem: null,
      hotCoin: null,
      screenStats: {
        candidates: cycle.candidates,
        passed: 0,
      },
    };
  }

  const t = row.token;
  const m = row.evaluation.metrics || {};
  const hotGem = {
    source: t.source || 'dexscreener',
    chainId: t.chain,
    chain: capitalize(t.chain),
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    pairAddress: t.pairAddress,
    imageUrl: t.imageUrl || null,
    priceUsd: t.priceUsd,
    change1h: null,
    change6h: null,
    change24h: t.change24hPct,
    volume1h: null,
    volume6h: null,
    volume24h: t.volume24hUsd,
    liquidityUsd: t.liquidityUsd,
    marketCapUsd: t.marketCapUsd,
    fdvUsd: t.fdvUsd,
    url: t.url,
    screened: true,
    security: {
      buyTaxPct: m.buyTaxPct,
      sellTaxPct: m.sellTaxPct,
      lpLockedPct: m.lpLockedPct,
      lpBurned: m.lpBurned,
      top10HolderPct: m.top10HolderPct,
      renounced: m.renounced,
      isMintable: m.isMintable,
      isHoneypot: m.isHoneypot,
      mcFdvRatio: m.mcFdvRatio,
      liqMcRatio: m.liqMcRatio,
      buySellRatio: m.buySellRatio,
    },
    warnings: row.evaluation.warnings || [],
  };

  return {
    category: 'airdrop',
    screened: true,
    safePass: true,
    fetchedAt: new Date().toISOString(),
    primarySource: 'dex-safe',
    primaryLabel: 'DEX Safe Screen',
    chains: THRESHOLDS.chains,
    gems: [hotGem],
    hotGem,
    hotCoin: {
      base: hotGem.symbol,
      last: hotGem.priceUsd,
      changePct: hotGem.change24h,
      exchange: hotGem.chain,
    },
    screenStats: {
      candidates: cycle.candidates,
      passed: cycle.passed.length,
    },
  };
}

function capitalize(s) {
  const x = String(s || '');
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
}

/** Setelah berhasil post ke channel, tandai cache anti-spam. */
function markSafeDexPosted(snapshot) {
  const g = snapshot?.hotGem;
  if (!g?.address || !g?.chainId) return;
  markPosted(g.chainId, g.address);
}

module.exports = {
  getSafeDexAutopostSnapshot,
  markSafeDexPosted,
};
