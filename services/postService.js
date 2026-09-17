const fs = require('fs');
const path = require('path');
const {
  getMarketSnapshot,
  getDexAirdropSnapshot,
} = require('./cryptoService');
const { generatePostAssets } = require('./aiService');
const { postToChannel, postToTestChat } = require('./telegramService');
const { markPostedSlot } = require('./scheduleService');

function applyRuntimeEnv() {
  try {
    const runtimePath = path.join(__dirname, '..', 'config', 'runtime.json');
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (runtime.exchangeSource && !process.env.EXCHANGE_SOURCE_OVERRIDE) {
      process.env.EXCHANGE_SOURCE = runtime.exchangeSource;
    }
    if (runtime.postCategory && !process.env.POST_CATEGORY_OVERRIDE) {
      process.env.POST_CATEGORY = runtime.postCategory;
    }
  } catch {
    // ignore
  }
}

/**
 * spot | airdrop | auto
 * auto = bergantian tiap jam (WIB): genap=spot, ganjil=airdrop
 */
function resolvePostCategory(forced) {
  if (forced === 'airdrop' || forced === 'spot') return forced;
  const raw = (process.env.POST_CATEGORY || 'auto').toLowerCase();
  if (raw === 'airdrop' || raw === 'dex') return 'airdrop';
  if (raw === 'spot' || raw === 'cex') return 'spot';

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  return hour % 2 === 0 ? 'spot' : 'airdrop';
}

/**
 * Pipeline: fetch → AI → kirim (spot CEX atau airdrop DEX).
 */
async function runPipeline({
  target = 'channel',
  slot = null,
  category: forcedCategory = null,
} = {}) {
  applyRuntimeEnv();
  const category = resolvePostCategory(forcedCategory);
  const startedAt = new Date().toISOString();
  console.log(`[pipeline] Mulai ${startedAt} | target=${target} | category=${category}`);

  let snapshot;
  if (category === 'airdrop') {
    console.log('[pipeline] Fetch DEX trending (DexScreener + GeckoTerminal)...');
    snapshot = await getDexAirdropSnapshot(5);
    console.log(
      `[pipeline] DEX gems=${snapshot.gems.length} | hot=${snapshot.hotGem ? `${snapshot.hotGem.symbol}@${snapshot.hotGem.chain}` : '-'}`
    );
  } else {
    console.log('[pipeline] Fetch OKX & Bitget...');
    snapshot = await getMarketSnapshot();
    snapshot.category = 'spot';
    const hot = snapshot.hotCoin;
    console.log(
      `[pipeline] ${snapshot.primaryLabel} | gainers=${(snapshot.primary.topGainers || []).length} | unusual=${(snapshot.primary.unusualVolume || []).length} | hot=${hot ? hot.base : '-'}`
    );
  }

  console.log('[pipeline] Generate AI...');
  const { content, imageBuffer } = await generatePostAssets(snapshot);
  console.log(
    `[pipeline] AI=${content.provider} | chars h/i/c=${content.hook.length}/${content.info.length}/${content.cta.length} | img=${Boolean(imageBuffer)}`
  );

  const payload = { snapshot, content, imageBuffer };
  const result =
    target === 'test'
      ? await postToTestChat(payload)
      : await postToChannel(payload);

  console.log(
    `[pipeline] OK → ${result.chatId}#${result.messageId} | ${result.captionLength} chars | cat=${category}`
  );

  if (slot && target === 'channel') markPostedSlot(slot);
  return { ...result, snapshot, content, category };
}

module.exports = {
  runPipeline,
  applyRuntimeEnv,
  resolvePostCategory,
};
