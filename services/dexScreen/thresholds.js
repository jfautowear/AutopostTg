/**
 * Ambang batas screening DEX — bisa di-override via .env
 */
function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const THRESHOLDS = {
  // Market
  minMarketCapUsd: num('DEX_MIN_MC_USD', 500_000),
  preferredMinMcUsd: num('DEX_PREFERRED_MIN_MC_USD', 1_000_000),
  preferredMaxMcUsd: num('DEX_PREFERRED_MAX_MC_USD', 10_000_000),
  minMcFdvRatio: num('DEX_MIN_MC_FDV_RATIO', 0.3),

  // Liquidity
  minLiquidityUsd: num('DEX_MIN_LIQ_USD', 50_000),
  minLiqMcRatio: num('DEX_MIN_LIQ_MC_RATIO', 0.1),
  minLpLockedPct: num('DEX_MIN_LP_LOCKED_PCT', 80),

  // Security
  maxTaxPct: num('DEX_MAX_TAX_PCT', 5),
  maxTop10HolderPct: num('DEX_MAX_TOP10_HOLDER_PCT', 20),

  // Growth
  minVolume24hUsd: num('DEX_MIN_VOL24_USD', 100_000),
  minPriceChange24h: num('DEX_MIN_CHG24_PCT', 10),
  maxPriceChange24h: num('DEX_MAX_CHG24_PCT', 100),
  minBuySellRatio: num('DEX_MIN_BUY_SELL_RATIO', 0.8),

  // Runtime
  pollMinutes: num('DEX_SCREEN_POLL_MINUTES', 5),
  cacheHours: num('DEX_SCREEN_CACHE_HOURS', 24),
  maxCandidates: num('DEX_SCREEN_MAX_CANDIDATES', 40),
  maxAlertsPerRun: num('DEX_SCREEN_MAX_ALERTS', 3),
  requireGoPlus: bool('DEX_REQUIRE_GOPLUS', true),
  chains: String(process.env.DEX_SCREEN_CHAINS || 'solana,ethereum,bsc,base,arbitrum')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

/** DexScreener chainId → GoPlus chain id */
const GOPLUS_CHAIN = {
  ethereum: '1',
  eth: '1',
  bsc: '56',
  binance: '56',
  base: '8453',
  arbitrum: '42161',
  polygon: '137',
  avalanche: '43114',
  optimism: '10',
  solana: 'solana',
};

const BURN_TAGS = new Set([
  'burn',
  'dead',
  'null',
  'blackhole',
  'burn address',
]);

const EXCLUDE_HOLDER_TAGS = new Set([
  'liquidity vault',
  'liquidity pool',
  'lp',
  'pool',
  'exchange',
  'cex',
  'locked',
  ...BURN_TAGS,
]);

module.exports = {
  THRESHOLDS,
  GOPLUS_CHAIN,
  BURN_TAGS,
  EXCLUDE_HOLDER_TAGS,
};
