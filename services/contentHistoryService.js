/**
 * Riwayat konten yang sudah dipost — cegah ulang konten usang.
 * Disimpan di config/runtime.json → di-push GHA setelah tiap post.
 */
const fs = require('fs');
const path = require('path');

const RUNTIME_PATH = path.join(__dirname, '..', 'config', 'runtime.json');

/** TTL default per jenis konten (jam). */
const TTL_HOURS = {
  spot: Number(process.env.DEDUP_SPOT_HOURS) || 48,
  topcoin: Number(process.env.DEDUP_TOPCOIN_HOURS) || 18,
  news: Number(process.env.DEDUP_NEWS_HOURS) || 720,
  event: Number(process.env.DEDUP_NEWS_HOURS) || 720,
  listing: Number(process.env.DEDUP_NEWS_HOURS) || 720,
  airdrop: Number(process.env.DEDUP_AIRDROP_HOURS) || 168,
  default: 72,
};

function readRuntime() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeRuntime(data) {
  fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function pruneHistory(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((row) => {
    if (!row?.key || !row?.at) return false;
    const ageH = (now - new Date(row.at).getTime()) / 36e5;
    const cat = String(row.key).split(':')[0];
    const ttl = TTL_HOURS[cat] ?? TTL_HOURS.default;
    return ageH < ttl;
  });
}

function getHistory() {
  const data = readRuntime();
  return pruneHistory(data.recentContent || []);
}

function wasContentPosted(key) {
  if (!key) return false;
  return getHistory().some((row) => row.key === key);
}

function markContentPosted(key, meta = {}) {
  if (!key) return;
  const data = readRuntime();
  const list = pruneHistory(data.recentContent || []);
  data.recentContent = [
    { key, at: new Date().toISOString(), ...meta },
    ...list.filter((r) => r.key !== key),
  ].slice(0, 80);
  writeRuntime(data);
}

/** Fingerprint unik per jenis konten. */
function buildContentKey(snapshot) {
  if (!snapshot) return null;
  const cat = snapshot.category || 'spot';

  if (cat === 'topcoin') {
    const day = new Date().toLocaleDateString('en-CA', {
      timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
    });
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
        hour: '2-digit',
        hour12: false,
      }).format(new Date())
    );
    const bucket = Math.floor(hour / 6);
    return `topcoin:${day}:b${bucket}`;
  }

  if (cat === 'news' || cat === 'event' || cat === 'listing') {
    const url = snapshot.hotNews?.url;
    return url ? `news:${url}` : null;
  }

  if (cat === 'airdrop') {
    const g = snapshot.hotGem;
    if (g?.address && g?.chain) {
      return `airdrop:${g.chain}:${String(g.address).toLowerCase()}`;
    }
    if (g?.symbol) {
      return `airdrop:${g.chain || 'x'}:${String(g.symbol).toUpperCase()}`;
    }
    return null;
  }

  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const ex = snapshot.primaryLabel || snapshot.primarySource || 'cex';
  if (hot?.base) return `spot:${ex}:${String(hot.base).toUpperCase()}`;
  return null;
}

function isFreshSnapshot(snapshot) {
  const key = buildContentKey(snapshot);
  if (!key) return false;
  if (wasContentPosted(key)) return false;

  if (['news', 'event', 'listing'].includes(snapshot.category) && !snapshot.hotNews) {
    return false;
  }
  if (snapshot.category === 'airdrop' && !snapshot.hotGem) return false;
  if (snapshot.category === 'topcoin' && !(snapshot.topCoins || []).length) return false;
  if (snapshot.category === 'spot' && !(snapshot.hotCoin || snapshot.primary?.hotCoin)) {
    return false;
  }
  return true;
}

module.exports = {
  buildContentKey,
  wasContentPosted,
  markContentPosted,
  isFreshSnapshot,
  getHistory,
  TTL_HOURS,
};
