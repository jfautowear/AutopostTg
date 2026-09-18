const { THRESHOLDS } = require('./thresholds');
const { collectCandidates } = require('./sources');
const { fetchGoPlusSecurity } = require('./goplus');
const { evaluateToken } = require('./filters');
const { formatDexScreenAlert } = require('./format');
const { wasPostedRecently, markPosted } = require('./cache');

/**
 * Satu siklus screening: fetch → GoPlus → filter → list lolos (belum di-cache).
 */
async function runDexScreenCycle({ dryRun = false } = {}) {
  console.log(
    `[dexScreen] Mulai | chains=${THRESHOLDS.chains.join(',')} | max=${THRESHOLDS.maxCandidates}`
  );

  const candidates = await collectCandidates();
  console.log(`[dexScreen] Kandidat mentah: ${candidates.length}`);

  const passed = [];
  const rejected = [];

  for (const token of candidates) {
    if (wasPostedRecently(token.chain, token.address)) {
      rejected.push({ token, reason: 'cache-24h' });
      continue;
    }

    // Pre-filter murah sebelum GoPlus (hemat rate-limit)
    const pre = evaluateToken(token, null);
    const softFail = pre.reasons.filter(
      (r) => !r.includes('GoPlus') && !r.includes('tidak diketahui') && !r.includes('Mint')
    );
    // Jika market metrics sudah gagal keras, skip GoPlus
    const hardMarketFail = softFail.some(
      (r) =>
        r.startsWith('MC ') ||
        r.startsWith('Liquidity ') ||
        r.startsWith('Vol24h') ||
        r.startsWith('Chg24h') ||
        r.startsWith('Buys/Sells') ||
        r.startsWith('MC/FDV') ||
        r.startsWith('Liq/MC')
    );
    if (hardMarketFail) {
      rejected.push({ token, reasons: softFail.slice(0, 3) });
      continue;
    }

    const security = await fetchGoPlusSecurity(token.chain, token.address);
    const evaluation = evaluateToken(token, security);

    if (!evaluation.pass) {
      rejected.push({ token, reasons: evaluation.reasons.slice(0, 4) });
      continue;
    }

    passed.push({ token, evaluation, security });
    if (passed.length >= THRESHOLDS.maxAlertsPerRun) break;
  }

  console.log(
    `[dexScreen] Lolos=${passed.length} | ditolak/di-skip≈${rejected.length}`
  );

  return {
    candidates: candidates.length,
    passed,
    rejectedSample: rejected.slice(0, 15),
    dryRun,
  };
}

function getDexScreenChatId() {
  return (
    process.env.DEX_SCREEN_CHAT_ID ||
    process.env.TELEGRAM_CHANNEL_ID ||
    process.env.TEST_CHAT_ID ||
    ''
  );
}

/**
 * Kirim alert ke Telegram untuk token yang lolos.
 */
async function sendDexScreenAlerts(passed, { dryRun = false } = {}) {
  if (!passed?.length) {
    console.log('[dexScreen] Tidak ada token lolos untuk di-alert');
    return [];
  }

  const chatId = getDexScreenChatId();
  if (!chatId) {
    throw new Error('DEX_SCREEN_CHAT_ID / TELEGRAM_CHANNEL_ID / TEST_CHAT_ID belum di-set');
  }

  if (dryRun) {
    for (const row of passed) {
      console.log('--- DRY RUN ---');
      console.log(formatDexScreenAlert(row.token, row.evaluation));
    }
    return passed.map((p) => ({ dryRun: true, symbol: p.token.symbol }));
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('your_bot_token')) {
    throw new Error('TELEGRAM_BOT_TOKEN belum di-set');
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(token, { polling: false });
  const results = [];

  for (const row of passed) {
    const text = formatDexScreenAlert(row.token, row.evaluation);
    const msg = await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    markPosted(row.token.chain, row.token.address);
    results.push({
      messageId: msg.message_id,
      chatId,
      symbol: row.token.symbol,
      address: row.token.address,
      chain: row.token.chain,
    });
    console.log(
      `[dexScreen] Alert terkirim: $${row.token.symbol} @ ${row.token.chain} → ${chatId}#${msg.message_id}`
    );
  }

  return results;
}

async function runDexScreenAndAlert(opts = {}) {
  const cycle = await runDexScreenCycle(opts);
  const sent = await sendDexScreenAlerts(cycle.passed, opts);
  return { ...cycle, sent };
}

module.exports = {
  runDexScreenCycle,
  sendDexScreenAlerts,
  runDexScreenAndAlert,
  getDexScreenChatId,
  THRESHOLDS,
};
