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
const { markPostedSlot, loadSchedule } = require('./scheduleService');
const {
  buildContentKey,
  isFreshSnapshot,
  markContentPosted,
  wasContentPosted,
} = require('./contentHistoryService');
const {
  resolveSlotPlan,
  buildReferralSnapshot,
  ensureDailyPlan,
  formatDailyPlanText,
} = require('./referralService');

/** Pool crypto harian (1×/hari saat auto). */
const CRYPTO_CATEGORY_POOL = [
  { id: 'topcoin', weight: 2 },
  { id: 'spot', weight: 3 },
];

/** Legacy pool — dipakai jika force kategori lama / override. */
const CATEGORY_POOL = [
  { id: 'topcoin', weight: 3 },
  { id: 'spot', weight: 3 },
  { id: 'airdrop', weight: 2 },
  { id: 'news', weight: 2 },
  { id: 'event', weight: 2 },
  { id: 'listing', weight: 2 },
  { id: 'referral', weight: 4 },
];

const NEWS_TYPE_FILTER = {
  event: ['latest-events', 'announcements-jumpstart'],
  listing: ['announcements-new-listings'],
  news: null,
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
  // referral / referral:honeygain / honeygain / okx_bot
  if (
    v === 'ref' ||
    v === 'referral' ||
    v === 'affiliate' ||
    v.startsWith('referral:') ||
    v.startsWith('ref:') ||
    [
      'depin',
      'honeygain',
      'jumptask',
      'grass',
      'chainers',
      'beincom',
      'okx_bot',
      'okxbot',
    ].includes(v)
  ) {
    return 'referral';
  }
  if (
    ['spot', 'airdrop', 'news', 'event', 'listing', 'topcoin', 'referral'].includes(v)
  ) {
    return v;
  }
  return null;
}

/** Ambil projectId dari forced category seperti "referral:grass" / "honeygain". */
function extractReferralProjectId(forcedCategory) {
  const raw = String(forcedCategory || '')
    .toLowerCase()
    .trim();
  if (!raw) return null;
  const afterColon = raw.includes(':') ? raw.split(':').slice(1).join(':').trim() : raw;
  const candidates = [
    afterColon,
    raw.replace(/^referral:?/, '').replace(/^ref:/, ''),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  for (const c of candidates) {
    if (
      ['honeygain', 'jumptask', 'grass', 'chainers', 'beincom', 'okx_bot', 'okxbot'].includes(
        c
      )
    ) {
      return c === 'okxbot' || c === 'jumptask' ? (c === 'jumptask' ? 'honeygain' : 'okx_bot') : c;
    }
  }
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
 * Auto terjadwal = ikut daily plan (1 crypto + 3 referral).
 * Forced = kategori pasti.
 */
function resolvePostCategory(forced) {
  const forcedNorm = normalizeCategory(forced);
  if (forcedNorm) return forcedNorm;

  const raw = normalizeCategory(process.env.POST_CATEGORY || 'auto');
  if (raw) return raw;

  return weightedPick(CRYPTO_CATEGORY_POOL);
}

/** Urutan fallback crypto jika kategori terpilih kosong / duplikat. */
function buildTryOrder(primary) {
  if (primary === 'referral') return ['referral'];
  const cryptoIds = CRYPTO_CATEGORY_POOL.map((p) => p.id);
  if (cryptoIds.includes(primary)) {
    const rest = cryptoIds.filter((id) => id !== primary);
    return [primary, ...shuffled(rest)];
  }
  const rest = CATEGORY_POOL.map((p) => p.id).filter(
    (id) => id !== primary && id !== 'referral'
  );
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

async function fetchCategorySnapshot(category, referralOpts = null) {
  if (category === 'referral') {
    return buildReferralSnapshot(referralOpts || {});
  }

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

  return fetchFreshSpotSnapshot();
}

/**
 * Tentukan kind slot dari jadwal harian (kecuali forced category).
 */
function resolveScheduledIntent({ slot, forcedCategory }) {
  if (forcedCategory) {
    const cat = normalizeCategory(forcedCategory);
    if (cat === 'referral') {
      const projectId = extractReferralProjectId(forcedCategory);
      return {
        kind: 'referral',
        category: 'referral',
        referralOpts: projectId ? { projectId } : {},
      };
    }
    return { kind: 'crypto', category: cat || 'spot', referralOpts: null };
  }

  // Override env eksplisit (bukan auto) → paksa kategori itu
  const envCat = normalizeCategory(process.env.POST_CATEGORY || 'auto');
  if (envCat && process.env.POST_CATEGORY && process.env.POST_CATEGORY !== 'auto') {
    if (envCat === 'referral') {
      return { kind: 'referral', category: 'referral', referralOpts: {} };
    }
    return { kind: 'crypto', category: envCat, referralOpts: null };
  }

  const schedule = loadSchedule();
  ensureDailyPlan(schedule);
  console.log(formatDailyPlanText(schedule));

  const planEntry = resolveSlotPlan(slot, schedule);
  if (planEntry?.kind === 'referral') {
    return {
      kind: 'referral',
      category: 'referral',
      referralOpts: {
        projectId: planEntry.projectId,
        angle: planEntry.angle,
        variant: planEntry.variant,
        copyStyleId: planEntry.copyStyleId,
      },
    };
  }

  if (planEntry?.kind === 'crypto') {
    return {
      kind: 'crypto',
      category: planEntry.cryptoCategory || weightedPick(CRYPTO_CATEGORY_POOL),
      referralOpts: null,
    };
  }

  // Force / slot tanpa plan → crypto default
  return {
    kind: 'crypto',
    category: weightedPick(CRYPTO_CATEGORY_POOL),
    referralOpts: null,
  };
}

/**
 * Pipeline: daily plan (1 crypto + 3 referral) → snapshot → AI → post.
 */
async function runPipeline({
  target = 'channel',
  slot = null,
  category: forcedCategory = null,
} = {}) {
  applyRuntimeEnv();
  const intent = resolveScheduledIntent({ slot, forcedCategory });
  const primary = intent.category;
  const tryOrder =
    intent.kind === 'referral'
      ? ['referral']
      : forcedCategory
        ? [normalizeCategory(forcedCategory) || primary]
        : buildTryOrder(primary);

  const startedAt = new Date().toISOString();
  console.log(
    `[pipeline] Mulai ${startedAt} | target=${target} | kind=${intent.kind} | primary=${primary} | try=${tryOrder.join('→')}`
  );

  let category = null;
  let snapshot = null;

  for (const cat of tryOrder) {
    console.log(`[pipeline] Coba kategori: ${cat}`);
    try {
      const snap = await fetchCategorySnapshot(
        cat,
        cat === 'referral' ? intent.referralOpts : null
      );
      snap.category = cat;

      if (cat === 'airdrop' && !snap.hotGem) {
        console.warn('[pipeline] Airdrop kosong / tidak lolos filter — skip');
        continue;
      }

      if (!isFreshSnapshot(snap)) {
        const key = buildContentKey(snap);
        console.warn(
          `[pipeline] Skip ${cat} — konten tidak segar / duplikat (${key || 'no-key'})`
        );
        // Referral: kalau angle/variant bentrok TTL pendek, coba angle baru
        if (cat === 'referral') {
          const retry = buildReferralSnapshot({
            ...(intent.referralOpts || {}),
            angle: null,
            variant: Math.floor(Math.random() * 100000),
          });
          retry.category = 'referral';
          if (isFreshSnapshot(retry)) {
            category = 'referral';
            snapshot = retry;
            break;
          }
        }
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

  if (category === 'referral') {
    console.log(
      `[pipeline] Referral → ${snapshot.projectId} / angle=${snapshot.angle} / v=${snapshot.variant}`
    );
  } else if (category === 'topcoin') {
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
    markContentPosted(key, {
      category,
      chatId: result.chatId,
      messageId: result.messageId,
      projectId: snapshot.projectId || null,
    });

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
  CRYPTO_CATEGORY_POOL,
  resolveScheduledIntent,
};
