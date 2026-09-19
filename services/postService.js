const fs = require('fs');
const path = require('path');
const {
  getMarketSnapshot,
  getTopCoinsSnapshot,
  getNewsPromoSnapshot,
  markNewsPosted,
  pickHotCoin,
} = require('./cryptoService');
const {
  getSafeDexAutopostSnapshot,
  markSafeDexPosted,
} = require('./dexScreen/autopostSnapshot');
const { generatePostAssets } = require('./aiService');
const { postToChannel, postToTestChat } = require('./telegramService');
const { markPostedSlot } = require('./scheduleService');
const {
  buildContentKey,
  isFreshSnapshot,
  markContentPosted,
  wasContentPosted,
} = require('./contentHistoryService');

/** Pool autopost random (weight). */
const CATEGORY_POOL = [
  { id: 'topcoin', weight: 3 },
  { id: 'spot', weight: 3 },
  { id: 'airdrop', weight: 2 },
  { id: 'news', weight: 2 },
  { id: 'event', weight: 2 },
  { id: 'listing', weight: 2 },
];

const NEWS_TYPE_FILTER = {
  event: ['latest-events', 'announcements-jumpstart'],
  listing: ['announcements-new-listings'],
  news: null, // semua tipe
};

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

function normalizeCategory(raw) {
  const v = String(raw || '')
    .toLowerCase()
    .trim();
  if (v === 'dex') return 'airdrop';
  if (v === 'cex' || v === 'gainer' || v === 'topmove') return 'spot';
  if (v === 'promo' || v === 'announcement') return 'news';
  if (v === 'top' || v === 'top15' || v === 'majors' || v === 'topcoins') return 'topcoin';
  if (v === 'newlisting' || v === 'listings') return 'listing';
  if (['spot', 'airdrop', 'news', 'event', 'listing', 'topcoin'].includes(v)) return v;
  return null;
}

function weightedPick(pool) {
  const total = pool.reduce((s, p) => s + (p.weight || 1), 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.weight || 1;
    if (r <= 0) return p.id;
  }
  return pool[pool.length - 1]?.id || 'spot';
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Auto = acak dari pool. Forced = kategori pasti.
 */
function resolvePostCategory(forced) {
  const forcedNorm = normalizeCategory(forced);
  if (forcedNorm) return forcedNorm;

  const raw = normalizeCategory(process.env.POST_CATEGORY || 'auto');
  if (raw) return raw;

  return weightedPick(CATEGORY_POOL);
}

/** Urutan fallback jika kategori terpilih kosong / duplikat. */
function buildTryOrder(primary) {
  const rest = CATEGORY_POOL.map((p) => p.id).filter((id) => id !== primary);
  return [primary, ...shuffled(rest)];
}

/**
 * Spot: skip hot coin yang sudah dipost baru-baru ini.
 */
async function fetchFreshSpotSnapshot() {
  const snapshot = await getMarketSnapshot();
  snapshot.category = 'spot';
  const gainers = snapshot.primary?.topGainers || snapshot.primary?.gainers || [];
  const unusual = snapshot.primary?.unusualVolume || [];
  const candidates = [...gainers, ...unusual];

  const fresh = candidates.filter((c) => {
    const key = `spot:${snapshot.primaryLabel}:${String(c.base).toUpperCase()}`;
    return !wasContentPosted(key);
  });

  if (fresh.length) {
    snapshot.hotCoin = pickHotCoin(fresh);
    if (snapshot.primary) snapshot.primary.hotCoin = snapshot.hotCoin;
  } else if (snapshot.hotCoin) {
    const key = buildContentKey(snapshot);
    if (wasContentPosted(key)) {
      snapshot.hotCoin = null;
      if (snapshot.primary) snapshot.primary.hotCoin = null;
    }
  }

  return snapshot;
}

async function fetchCategorySnapshot(category) {
  if (category === 'topcoin') {
    return getTopCoinsSnapshot();
  }

  if (category === 'airdrop') {
    const useSafe = process.env.DEX_SAFE_AUTOPOST !== 'false';
    if (!useSafe) {
      const { getDexAirdropSnapshot } = require('./cryptoService');
      return getDexAirdropSnapshot(5);
    }
    return getSafeDexAutopostSnapshot();
  }

  if (category === 'event' || category === 'listing' || category === 'news') {
    return getNewsPromoSnapshot({
      preferTypes: NEWS_TYPE_FILTER[category],
      categoryLabel: category === 'news' ? 'news' : category,
    });
  }

  // spot
  return fetchFreshSpotSnapshot();
}

/**
 * Pipeline: pilih kategori (random) → snapshot segar → post.
 * Tidak pernah memposting fingerprint yang sudah ada di riwayat.
 */
async function runPipeline({
  target = 'channel',
  slot = null,
  category: forcedCategory = null,
} = {}) {
  applyRuntimeEnv();
  const primary = resolvePostCategory(forcedCategory);
  const tryOrder = forcedCategory
    ? [normalizeCategory(forcedCategory) || primary]
    : buildTryOrder(primary);

  const startedAt = new Date().toISOString();
  console.log(
    `[pipeline] Mulai ${startedAt} | target=${target} | primary=${primary} | try=${tryOrder.join('→')}`
  );

  let category = null;
  let snapshot = null;

  for (const cat of tryOrder) {
    console.log(`[pipeline] Coba kategori: ${cat}`);
    try {
      const snap = await fetchCategorySnapshot(cat);
      snap.category = cat === 'spot' ? 'spot' : cat;

      // airdrop tanpa token aman → skip
      if (cat === 'airdrop' && !snap.hotGem) {
        console.warn('[pipeline] Airdrop kosong / tidak lolos filter — skip');
        continue;
      }

      if (!isFreshSnapshot(snap)) {
        const key = buildContentKey(snap);
        console.warn(`[pipeline] Skip ${cat} — konten tidak segar / duplikat (${key || 'no-key'})`);
        continue;
      }

      category = cat;
      snapshot = snap;
      break;
    } catch (err) {
      console.warn(`[pipeline] Gagal fetch ${cat}:`, err.message);
    }
  }

  if (!snapshot || !category) {
    throw new Error(
      'Tidak ada konten SEGAR untuk dipost (semua kategori kosong atau sudah pernah dipost). Coba lagi nanti.'
    );
  }

  console.log(`[pipeline] Pilih kategori=${category} | key=${buildContentKey(snapshot)}`);

  if (category === 'topcoin') {
    console.log(
      `[pipeline] TopCoin n=${snapshot.topCoins?.length || 0} | up=${snapshot.topCoinStats?.up} down=${snapshot.topCoinStats?.down}`
    );
  } else if (category === 'airdrop') {
    console.log(
      `[pipeline] DEX → $${snapshot.hotGem?.symbol}@${snapshot.hotGem?.chain}`
    );
  } else if (['news', 'event', 'listing'].includes(category)) {
    console.log(
      `[pipeline] News pick=${snapshot.hotNews ? snapshot.hotNews.title.slice(0, 60) : '-'}`
    );
  } else {
    const hot = snapshot.hotCoin;
    console.log(
      `[pipeline] ${snapshot.primaryLabel} | hot=${hot ? hot.base : '-'}`
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

  if (target === 'channel') {
    const key = buildContentKey(snapshot);
    markContentPosted(key, { category, chatId: result.chatId, messageId: result.messageId });

    if (['news', 'event', 'listing'].includes(category) && snapshot.hotNews?.url) {
      markNewsPosted(snapshot.hotNews.url);
    }
    if (category === 'airdrop' && snapshot.screened && snapshot.hotGem) {
      markSafeDexPosted(snapshot);
    }
    if (slot) markPostedSlot(slot);
  }

  console.log(
    `[pipeline] OK → ${result.chatId}#${result.messageId} | ${result.captionLength} chars | cat=${category}`
  );

  return { ...result, snapshot, content, category };
}

module.exports = {
  runPipeline,
  applyRuntimeEnv,
  resolvePostCategory,
  normalizeCategory,
  CATEGORY_POOL,
};
