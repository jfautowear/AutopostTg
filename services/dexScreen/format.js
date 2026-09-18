const { fmt, fmtPct } = require('./filters');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function chartLinks(token) {
  const dex = token.url || `https://dexscreener.com/${token.chain}/${token.pairAddress || ''}`;
  const links = [`📊 <a href="${escapeHtml(dex)}">DEXScreener</a>`];
  if (String(token.chain).toLowerCase() === 'solana' && token.address) {
    links.push(
      `👁 <a href="https://birdeye.so/token/${encodeURIComponent(token.address)}?chain=solana">Birdeye</a>`
    );
  }
  return links.join(' · ');
}

/**
 * Format alert Telegram (HTML).
 */
function formatDexScreenAlert(token, evaluation) {
  const m = evaluation.metrics || {};
  const sym = token.symbol || '???';
  const name = token.name || sym;
  const chain = String(token.chain || '').toUpperCase();
  const ca = token.address || '—';

  const tax =
    m.buyTaxPct != null || m.sellTaxPct != null
      ? `Buy ${fmtPct(m.buyTaxPct)} / Sell ${fmtPct(m.sellTaxPct)}`
      : '—';

  const lp =
    m.lpBurned
      ? `Burned ✅`
      : m.lpLockedPct != null
        ? `Locked ${fmtPct(m.lpLockedPct)}`
        : '—';

  const warnBlock =
    evaluation.warnings?.length > 0
      ? `\n⚠️ ${escapeHtml(evaluation.warnings.slice(0, 2).join(' · '))}`
      : '';

  return [
    '<b>🛡️ DEX SCREEN · LOLOS FILTER</b>',
    '',
    `<b>${escapeHtml(name)}</b> · $${escapeHtml(sym)}`,
    `⛓ Network: <b>${escapeHtml(chain)}</b>`,
    `📝 CA: <code>${escapeHtml(ca)}</code>`,
    '',
    `💰 MC: <b>$${fmt(m.marketCapUsd)}</b> · FDV: $${fmt(m.fdvUsd)}`,
    `💧 Liquidity: <b>$${fmt(m.liquidityUsd)}</b> · Liq/MC: ${fmtPct((m.liqMcRatio || 0) * 100)}`,
    `🔒 LP: ${escapeHtml(lp)}`,
    `🧾 Tax: ${escapeHtml(tax)}`,
    `📈 24h: <b>${m.change24hPct != null ? `${m.change24hPct >= 0 ? '+' : ''}${m.change24hPct.toFixed(1)}%` : '—'}</b> · Vol: $${fmt(m.volume24hUsd)}`,
    `🔄 Buys/Sells: ${m.buySellRatio != null ? m.buySellRatio.toFixed(2) : '—'}`,
    m.top10HolderPct != null
      ? `👥 Top10 (ex LP/burn): ${fmtPct(m.top10HolderPct)}`
      : null,
    '',
    chartLinks(token),
    warnBlock,
    '',
    '<i>⚠️ DYOR &amp; NFA — bukan saran investasi. Filter ketat ≠ bebas risiko.</i>',
  ]
    .filter((line) => line != null)
    .join('\n');
}

module.exports = {
  formatDexScreenAlert,
  escapeHtml,
};
