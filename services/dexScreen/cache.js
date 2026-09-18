const fs = require('fs');
const path = require('path');
const { THRESHOLDS } = require('./thresholds');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'dex-screen-cache.json');

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { posted: {} };
  } catch {
    return { posted: {} };
  }
}

function saveCache(cache) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

function cacheKey(chain, address) {
  return `${String(chain || '').toLowerCase()}:${String(address || '').toLowerCase()}`;
}

function pruneExpired(cache, now = Date.now()) {
  const maxAge = THRESHOLDS.cacheHours * 60 * 60 * 1000;
  const posted = cache.posted || {};
  let changed = false;
  for (const [key, ts] of Object.entries(posted)) {
    if (!ts || now - Number(ts) > maxAge) {
      delete posted[key];
      changed = true;
    }
  }
  cache.posted = posted;
  return changed;
}

function wasPostedRecently(chain, address) {
  const cache = loadCache();
  pruneExpired(cache);
  const key = cacheKey(chain, address);
  const ts = cache.posted?.[key];
  if (!ts) return false;
  const maxAge = THRESHOLDS.cacheHours * 60 * 60 * 1000;
  return Date.now() - Number(ts) < maxAge;
}

function markPosted(chain, address) {
  const cache = loadCache();
  pruneExpired(cache);
  if (!cache.posted) cache.posted = {};
  cache.posted[cacheKey(chain, address)] = Date.now();
  saveCache(cache);
}

module.exports = {
  CACHE_PATH,
  loadCache,
  saveCache,
  wasPostedRecently,
  markPosted,
  cacheKey,
  pruneExpired,
};
