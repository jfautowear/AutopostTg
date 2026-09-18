const fs = require('fs');
const path = require('path');

const SCHEDULE_PATH = path.join(__dirname, '..', 'config', 'schedule.json');

const DEFAULT_SCHEDULE = {
  enabled: true,
  timezone: 'Asia/Jakarta',
  times: ['09:00', '13:00', '19:00', '21:00'],
  updatedAt: null,
  updatedBy: null,
};

function normalizeTime(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function loadSchedule() {
  try {
    const raw = fs.readFileSync(SCHEDULE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SCHEDULE,
      ...parsed,
      times: Array.isArray(parsed.times)
        ? parsed.times.map(normalizeTime).filter(Boolean).sort()
        : [...DEFAULT_SCHEDULE.times],
    };
  } catch {
    return { ...DEFAULT_SCHEDULE, times: [...DEFAULT_SCHEDULE.times] };
  }
}

function saveSchedule(schedule, updatedBy = null) {
  const next = {
    enabled: Boolean(schedule.enabled),
    timezone: schedule.timezone || 'Asia/Jakarta',
    times: [...new Set((schedule.times || []).map(normalizeTime).filter(Boolean))].sort(),
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || schedule.updatedBy || null,
  };
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function formatScheduleText(schedule) {
  const s = schedule || loadSchedule();
  const status = s.enabled ? 'AKTIF ✅' : 'NONAKTIF ⏸';
  const times = s.times.length ? s.times.join(', ') : '(kosong)';
  const lines = [
    `📅 Jadwal Autopost: ${status}`,
    `🌏 Timezone: ${s.timezone}`,
    `⏰ Jam: ${times}`,
  ];
  if (s.updatedAt) {
    lines.push(`✏️ Update: ${s.updatedAt}${s.updatedBy ? ` oleh @${s.updatedBy}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Cek apakah sekarang (WIB) masuk slot jadwal.
 * windowMinutes: toleransi untuk cron GHA (default 30 — cocok slot jam penuh).
 * Selalu return object { match, slot } agar pemanggil aman.
 */
function shouldPostNow(schedule = loadSchedule(), now = new Date(), windowMinutes = 30) {
  if (!schedule.enabled || !schedule.times.length) {
    return { match: false, slot: null };
  }

  const tz = schedule.timezone || 'Asia/Jakarta';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const nowMinutes = hour * 60 + minute;
  const today = `${get('year')}-${get('month')}-${get('day')}`;

  // Ambil slot terdekat yang sudah lewat dalam window (bukan slot lama yang masih masuk window lebar GHA)
  let best = null;
  let bestDiff = Infinity;
  for (const t of schedule.times) {
    const [h, m] = t.split(':').map(Number);
    const target = h * 60 + m;
    const diff = nowMinutes - target;
    if (diff >= 0 && diff <= windowMinutes && diff < bestDiff) {
      bestDiff = diff;
      best = { match: true, slot: `${today}-${t}` };
    }
  }
  return best || { match: false, slot: null };
}

function alreadyPostedSlot(slot) {
  if (!slot) return false;
  try {
    const runtimePath = path.join(__dirname, '..', 'config', 'runtime.json');
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    return runtime.lastPostedSlot === slot;
  } catch {
    return false;
  }
}

function markPostedSlot(slot) {
  if (!slot) return;
  const runtimePath = path.join(__dirname, '..', 'config', 'runtime.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  } catch {
    data = {};
  }
  data.lastPostedSlot = slot;
  data.lastPostedAt = new Date().toISOString();
  fs.writeFileSync(runtimePath, `${JSON.stringify(data, null, 2)}\n`);
}

function currentTimeLabel(timezone = 'Asia/Jakarta') {
  return new Date().toLocaleString('id-ID', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

module.exports = {
  SCHEDULE_PATH,
  DEFAULT_SCHEDULE,
  normalizeTime,
  loadSchedule,
  saveSchedule,
  formatScheduleText,
  shouldPostNow,
  alreadyPostedSlot,
  markPostedSlot,
  currentTimeLabel,
};
