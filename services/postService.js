const fs = require('fs');
const path = require('path');
const {
  getMarketSnapshot,
  getNewsPromoSnapshot,
  markNewsPosted,
} = require('./cryptoService');
const {
  getSafeDexAutopostSnapshot,
  markSafeDexPosted,
} = require('./dexScreen/autopostSnapshot');
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
 * Rotasi 4 slot/hari agar konten relevan:
 * 09 → spot | 13 → airdrop (DEX aman) | 19 → news | 21 → spot/airdrop bergiliran
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

  if (hour < 11) return 'spot'; // ~09
  if (hour < 16) return 'airdrop'; // ~13 — DEX screened → OKX Web3
  if (hour < 20) return 'news'; // ~19
  // ~21 — campur: genap airdrop aman, ganjil spot closing
  return dayNum % 2 === 0 ? 'airdrop' : 'spot';
}

/**
 * Pipeline: fetch → konten → kirim (spot / airdrop aman / news).
 */
async function runPipeline({
  target = 'channel',
  slot = null,
  category: forcedCategory = null,
} = {}) {
  applyRuntimeEnv();
  let category = resolvePostCategory(forcedCategory);
  const startedAt = new Date().toISOString();
  console.log(`[pipeline] Mulai ${startedAt} | target=${target} | category=${category}`);

  let snapshot;
  if (category === 'airdrop') {
    const useSafe = process.env.DEX_SAFE_AUTOPOST !== 'false';
    if (useSafe) {
      console.log('[pipeline] Fetch DEX Safe Screen (filter ketat GoPlus+DexScreener)...');
      snapshot = await getSafeDexAutopostSnapshot();
      if (!snapshot.safePass || !snapshot.hotGem) {
        console.warn(
          `[pipeline] Tidak ada token lolos filter aman (candidates=${snapshot.screenStats?.candidates || 0}) → fallback SPOT`
        );
        category = 'spot';
        snapshot = await getMarketSnapshot();
        snapshot.category = 'spot';
      } else {
        console.log(
          `[pipeline] DEX SAFE OK → $${snapshot.hotGem.symbol}@${snapshot.hotGem.chain} | MC≈${snapshot.hotGem.marketCapUsd}`
        );
      }
    } else {
      console.log('[pipeline] DEX_SAFE_AUTOPOST=false — mode legacy (tidak disarankan)');
      const { getDexAirdropSnapshot } = require('./cryptoService');
      snapshot = await getDexAirdropSnapshot(5);
    }
  } else if (category === 'news') {
    console.log('[pipeline] Fetch OKX announcements (listing/event/promo)...');
    snapshot = await getNewsPromoSnapshot();
    console.log(
      `[pipeline] News items=${snapshot.items.length} | pick=${snapshot.hotNews ? snapshot.hotNews.title.slice(0, 60) : '-'}`
    );
  }

  if (category === 'spot') {
    if (!snapshot || snapshot.category === 'airdrop') {
      console.log('[pipeline] Fetch OKX / Bitget market...');
      snapshot = await getMarketSnapshot();
    }
    snapshot.category = 'spot';
    const hot = snapshot.hotCoin;
    console.log(
      `[pipeline] ${snapshot.primaryLabel} | gainers=${(snapshot.primary?.topGainers || []).length} | hot=${hot ? hot.base : '-'}`
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
  if (category === 'airdrop' && snapshot.screened && snapshot.hotGem && target === 'channel') {
    markSafeDexPosted(snapshot);
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
