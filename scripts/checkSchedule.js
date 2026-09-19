/**
 * Cek cepat jadwal tanpa npm install (hemat menit GitHub Actions).
 * Exit 0 = boleh lanjut post | Exit 78 = skip di luar jadwal / sudah dipost
 *
 * Di GHA window diperlebar (6 jam) karena cron GitHub sering delay,
 * agar slot 09:00/13:00/19:00/21:00 tidak kelewat.
 * Catatan: index.js post:once HARUS pakai jendela yang sama (SCHEDULE_WINDOW_MINUTES).
 */
const {
  loadSchedule,
  shouldPostNow,
  alreadyPostedSlot,
  formatScheduleText,
  currentTimeLabel,
} = require('../services/scheduleService');

const force =
  process.env.FORCE_POST === 'true' ||
  process.env.FORCE_POST === '1' ||
  process.argv.includes('--force');

const schedule = loadSchedule();
console.log(formatScheduleText(schedule));
console.log(`[check] Sekarang: ${currentTimeLabel(schedule.timezone)}`);

if (force) {
  console.log('[check] FORCE_POST — lanjut');
  process.exit(0);
}

// Lokal: 30 menit | GitHub Actions: 6 jam (antisipasi delay runner)
const windowMinutes =
  process.env.GITHUB_ACTIONS === 'true'
    ? Number(process.env.SCHEDULE_WINDOW_MINUTES) || 360
    : Number(process.env.SCHEDULE_WINDOW_MINUTES) || 30;

const check = shouldPostNow(schedule, new Date(), windowMinutes);
if (!check.match) {
  console.log(
    `[check] SKIP — di luar jendela jadwal (±${windowMinutes}m) (hemat Actions)`
  );
  process.exit(78);
}

if (alreadyPostedSlot(check.slot)) {
  console.log(`[check] SKIP — slot ${check.slot} sudah dipost`);
  process.exit(78);
}

console.log(`[check] OK — slot ${check.slot} (window ${windowMinutes}m)`);
process.exit(0);
