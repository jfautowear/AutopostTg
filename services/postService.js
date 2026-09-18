const fs = require('fs');
const path = require('path');
const {
  getMarketSnapshot,
  getDexAirdropSnapshot,
  getNewsPromoSnapshot,
  markNewsPosted,
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
 * spot | airdrop | news | auto
 * auto = rotasi 3 jenis (spot → airdrop → news) agar konten variatif.
 * PC OFF: dipanggil GitHub Actions 2×/hari.
 */
function resolvePostCategory(forced) {
  if (forced === 'airdrop' || forced === 'spot' || forced === 'news') {
    return forced;
  }
  const raw = (process.env.POST_CATEGORY || 'auto').toLowerCase();
  if (raw === 'airdrop' || raw === 'dex') return 'airdrop';
  if (raw === 'spot' || raw === 'cex') return 'spot';
  if (raw === 'news' || raw === 'promo' || raw === 'announcement') return 'news';

  const tz = process.env.CRON_TIMEZONE || 'Asia/Jakarta';
  const day = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const dayNum = Number(String(day).replace(/-/g, ''));
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  // Pagi/sore beda slot → rotasi merata tiap run Actions
  const slot = hour < 15 ? 0 : 1;
  const idx = Math.abs(dayNum + slot) % 3;
  return ['spot', 'airdrop', 'news'][idx];
}

/**
 * Pipeline: fetch → konten → kirim (spot / airdrop / news).
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
  } else if (category === 'news') {
    console.log('[pipeline] Fetch OKX announcements (listing/event/promo)...');
    snapshot = await getNewsPromoSnapshot();
    console.log(
      `[pipeline] News items=${snapshot.items.length} | pick=${snapshot.hotNews ? snapshot.hotNews.title.slice(0, 60) : '-'}`
    );
  } else {
    console.log('[pipeline] Fetch OKX / Bitget market...');
    snapshot = await getMarketSnapshot();
    snapshot.category = 'spot';
    const hot = snapshot.hotCoin;
    console.log(
      `[pipeline] ${snapshot.primaryLabel} | gainers=${(snapshot.primary.topGainers || []).length} | hot=${hot ? hot.base : '-'}`
    );
  }

  console.log('[pipeline] Generate konten...');
  const { content, imageBuffer } = await generatePostAssets(snapshot);
  console.log(
    `[pipeline] AI=${content.provider} | chars h/i/c=${content.hook.length}/${content.info.length}/${content.cta.length} | img=${Boolean(imageBuffer)}`
  );

  const payload = { snapshot, content, imageBuffer };
  const result =
    target === 'test'
      ? await postToTestChat(payload)
      : await postToChannel(payload);

  if (category === 'news' && snapshot.hotNews?.url && target === 'channel') {
    markNewsPosted(snapshot.hotNews.url);
  }

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
