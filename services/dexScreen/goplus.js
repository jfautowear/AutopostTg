const axios = require('axios');
const { GOPLUS_CHAIN, EXCLUDE_HOLDER_TAGS, BURN_TAGS } = require('./thresholds');

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': 'JFNetwork-DexScreen/1.0', Accept: 'application/json' },
});

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function isFalsyFlag(v) {
  if (v === false || v === 0) return true;
  const s = String(v ?? '').toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === '';
}

function isZeroAddress(addr) {
  const a = String(addr || '').toLowerCase();
  return (
    !a ||
    a === '0x0000000000000000000000000000000000000000' ||
    a === '0x000000000000000000000000000000000000dead' ||
    /^0x0+$/.test(a)
  );
}

/**
 * Ambil keamanan token dari GoPlus (EVM atau Solana).
 * @returns {Promise<object|null>}
 */
async function fetchGoPlusSecurity(chain, address) {
  const gpChain = GOPLUS_CHAIN[String(chain).toLowerCase()] || null;
  if (!gpChain || !address) return null;

  try {
    let data;
    if (gpChain === 'solana') {
      const res = await http.get(
        'https://api.gopluslabs.io/api/v1/solana/token_security',
        { params: { contract_addresses: address } }
      );
      data = res.data;
    } else {
      const res = await http.get(
        `https://api.gopluslabs.io/api/v1/token_security/${gpChain}`,
        { params: { contract_addresses: address } }
      );
      data = res.data;
    }

    if (Number(data?.code) !== 1) {
      console.warn('[dexScreen] GoPlus code:', data?.code, data?.message);
      return null;
    }

    const result = data.result || {};
    // Key bisa lowercase address
    const key = Object.keys(result).find(
      (k) => k.toLowerCase() === String(address).toLowerCase()
    );
    const raw = key ? result[key] : Object.values(result)[0];
    if (!raw || typeof raw !== 'object') return null;

    return normalizeGoPlus(raw, gpChain === 'solana');
  } catch (err) {
    console.warn(`[dexScreen] GoPlus ${chain}:${address}:`, err.message);
    return null;
  }
}

function normalizeGoPlus(raw, isSolana) {
  const buyTax = toNum(raw.buy_tax ?? raw.buyTax);
  const sellTax = toNum(raw.sell_tax ?? raw.sellTax);

  // Tax GoPlus kadang 0-1 (ratio) kadang 0-100 (%)
  const normTax = (t) => {
    if (t == null) return null;
    return t <= 1 ? t * 100 : t;
  };

  const isHoneypot = isTruthyFlag(raw.is_honeypot ?? raw.isHoneypot);
  const isMintable = isTruthyFlag(raw.is_mintable ?? raw.mintable ?? raw.isMintable);

  const owner = raw.owner_address || raw.creator_address || raw.owner || null;
  const renounced =
    isTruthyFlag(raw.owner_renounced) ||
    isTruthyFlag(raw.is_renounced) ||
    isZeroAddress(owner) ||
    isFalsyFlag(raw.can_take_back_ownership);

  // LP lock / burn
  let lpLockedPct = toNum(raw.lp_locked_percent ?? raw.liquidity_locked_percent);
  let lpBurned = isTruthyFlag(raw.lp_burned) || isTruthyFlag(raw.is_burned);

  const lpHolders = Array.isArray(raw.lp_holders) ? raw.lp_holders : [];
  if ((lpLockedPct == null || lpLockedPct === 0) && lpHolders.length) {
    let locked = 0;
    let burned = 0;
    for (const h of lpHolders) {
      const pct = toNum(h.percent) || 0;
      const tag = String(h.tag || h.address || '').toLowerCase();
      if (isTruthyFlag(h.is_locked) || isTruthyFlag(h.is_locked_contract)) {
        locked += pct;
      }
      if (BURN_TAGS.has(tag) || isZeroAddress(h.address) || /dead|burn/i.test(tag)) {
        burned += pct;
        lpBurned = true;
      }
    }
    // percent kadang 0-1
    const scale = locked <= 1 && burned <= 1 ? 100 : 1;
    lpLockedPct = (locked + burned) * scale;
  }

  if (lpLockedPct != null && lpLockedPct <= 1) lpLockedPct *= 100;

  // Top 10 holders ex LP/burn/cex
  const holders = Array.isArray(raw.holders) ? raw.holders : [];
  let top10Pct = null;
  if (holders.length) {
    const filtered = holders.filter((h) => {
      const tag = String(h.tag || '').toLowerCase();
      if (EXCLUDE_HOLDER_TAGS.has(tag)) return false;
      if (isTruthyFlag(h.is_locked) && /liquidity|lp|pool/i.test(tag)) return false;
      if (isZeroAddress(h.address)) return false;
      if (/burn|dead|blackhole/i.test(tag)) return false;
      return true;
    });
    const top = filtered.slice(0, 10);
    top10Pct = top.reduce((sum, h) => {
      let p = toNum(h.percent) || 0;
      if (p <= 1) p *= 100;
      return sum + p;
    }, 0);
  }

  return {
    provider: 'goplus',
    isSolana: Boolean(isSolana),
    buyTaxPct: normTax(buyTax),
    sellTaxPct: normTax(sellTax),
    isHoneypot,
    isMintable,
    renounced,
    ownerAddress: owner,
    lpLockedPct,
    lpBurned,
    top10HolderPct: top10Pct,
    holderCount: toNum(raw.holder_count) || holders.length || null,
    rawFlags: {
      is_open_source: raw.is_open_source,
      cannot_buy: raw.cannot_buy,
      cannot_sell_all: raw.cannot_sell_all,
      trading_cooldown: raw.trading_cooldown,
      transfer_pausable: raw.transfer_pausable,
    },
  };
}

module.exports = {
  fetchGoPlusSecurity,
  normalizeGoPlus,
};
