const { THRESHOLDS } = require('./thresholds');

/**
 * Evaluasi ketat: SEMUA kriteria harus lolos.
 * @returns {{ pass: boolean, reasons: string[], warnings: string[], metrics: object }}
 */
function evaluateToken(token, security) {
  const reasons = [];
  const warnings = [];
  const T = THRESHOLDS;

  const mc = token.marketCapUsd;
  const fdv = token.fdvUsd;
  const liq = token.liquidityUsd;
  const vol = token.volume24hUsd;
  const chg = token.change24hPct;
  const buySell = token.buySellRatio;

  // --- Market Cap & FDV ---
  if (mc == null || mc < T.minMarketCapUsd) {
    reasons.push(`MC $${fmt(mc)} < min $${fmt(T.minMarketCapUsd)}`);
  } else if (mc < T.preferredMinMcUsd || mc > T.preferredMaxMcUsd) {
    warnings.push(
      `MC di luar rentang ideal $${fmt(T.preferredMinMcUsd)}–$${fmt(T.preferredMaxMcUsd)}`
    );
  }

  if (fdv != null && fdv > 0 && mc != null) {
    const ratio = mc / fdv;
    if (ratio < T.minMcFdvRatio) {
      reasons.push(`MC/FDV ${(ratio * 100).toFixed(1)}% < ${T.minMcFdvRatio * 100}%`);
    }
  } else if (mc != null && (fdv == null || fdv <= 0)) {
    warnings.push('FDV tidak tersedia — rasio MC/FDV tidak diverifikasi');
  }

  // --- Liquidity ---
  if (liq == null || liq < T.minLiquidityUsd) {
    reasons.push(`Liquidity $${fmt(liq)} < min $${fmt(T.minLiquidityUsd)}`);
  }
  if (mc != null && mc > 0 && liq != null) {
    const liqMc = liq / mc;
    if (liqMc < T.minLiqMcRatio) {
      reasons.push(
        `Liq/MC ${(liqMc * 100).toFixed(1)}% < ${T.minLiqMcRatio * 100}%`
      );
    }
  }

  // --- Security (GoPlus) ---
  if (T.requireGoPlus && !security) {
    reasons.push('Data GoPlus tidak tersedia (wajib untuk rug-check)');
  }

  if (security) {
    if (security.isHoneypot) reasons.push('Honeypot terdeteksi');
    if (isTruthy(security.rawFlags?.cannot_buy)) reasons.push('cannot_buy');
    if (isTruthy(security.rawFlags?.cannot_sell_all)) {
      reasons.push('cannot_sell_all');
    }

    if (security.buyTaxPct != null && security.buyTaxPct > T.maxTaxPct) {
      reasons.push(`Buy tax ${security.buyTaxPct.toFixed(2)}% > ${T.maxTaxPct}%`);
    } else if (security.buyTaxPct == null) {
      reasons.push('Buy tax tidak diketahui');
    }

    if (security.sellTaxPct != null && security.sellTaxPct > T.maxTaxPct) {
      reasons.push(`Sell tax ${security.sellTaxPct.toFixed(2)}% > ${T.maxTaxPct}%`);
    } else if (security.sellTaxPct == null) {
      reasons.push('Sell tax tidak diketahui');
    }

    const mintOk = security.isMintable === false || security.renounced === true;
    if (!mintOk) {
      reasons.push('Mint masih aktif / ownership belum renounced');
    }

    const lpOk =
      security.lpBurned === true ||
      (security.lpLockedPct != null && security.lpLockedPct >= T.minLpLockedPct);
    if (!lpOk) {
      reasons.push(
        `LP lock/burn tidak cukup (locked=${fmtPct(security.lpLockedPct)}, burned=${security.lpBurned})`
      );
    }

    if (security.top10HolderPct != null) {
      if (security.top10HolderPct > T.maxTop10HolderPct) {
        reasons.push(
          `Top10 holders ${security.top10HolderPct.toFixed(1)}% > ${T.maxTop10HolderPct}%`
        );
      }
    } else {
      reasons.push('Distribusi top10 holders tidak diketahui');
    }
  }

  // --- Volume & growth ---
  if (vol == null || vol < T.minVolume24hUsd) {
    reasons.push(`Vol24h $${fmt(vol)} < min $${fmt(T.minVolume24hUsd)}`);
  }

  if (chg == null) {
    reasons.push('Price change 24h tidak tersedia');
  } else if (chg < T.minPriceChange24h || chg > T.maxPriceChange24h) {
    reasons.push(
      `Chg24h ${chg.toFixed(1)}% di luar +${T.minPriceChange24h}%…+${T.maxPriceChange24h}%`
    );
  }

  if (buySell == null || buySell < T.minBuySellRatio) {
    reasons.push(
      `Buys/Sells ${buySell != null ? buySell.toFixed(2) : '—'} < ${T.minBuySellRatio}`
    );
  }

  const metrics = {
    marketCapUsd: mc,
    fdvUsd: fdv,
    mcFdvRatio: mc != null && fdv > 0 ? mc / fdv : null,
    liquidityUsd: liq,
    liqMcRatio: mc > 0 && liq != null ? liq / mc : null,
    volume24hUsd: vol,
    change24hPct: chg,
    buySellRatio: buySell,
    buyTaxPct: security?.buyTaxPct ?? null,
    sellTaxPct: security?.sellTaxPct ?? null,
    lpLockedPct: security?.lpLockedPct ?? null,
    lpBurned: security?.lpBurned ?? null,
    top10HolderPct: security?.top10HolderPct ?? null,
    renounced: security?.renounced ?? null,
    isMintable: security?.isMintable ?? null,
    isHoneypot: security?.isHoneypot ?? null,
  };

  return {
    pass: reasons.length === 0,
    reasons,
    warnings,
    metrics,
  };
}

function isTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const x = Number(n);
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(Math.round(x));
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

module.exports = {
  evaluateToken,
  fmt,
  fmtPct,
};
