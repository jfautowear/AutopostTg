/**
 * Cek cepat jadwal tanpa npm install (hemat menit GitHub Actions).
 * Exit 0 = boleh lanjut post | Exit 78 = skip di luar jadwal / sudah dipost
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

const check = shouldPostNow(schedule);
if (!check.match) {
  console.log('[check] SKIP — di luar jendela jadwal (hemat Actions)');
  process.exit(78);
}

if (alreadyPostedSlot(check.slot)) {
  console.log(`[check] SKIP — slot ${check.slot} sudah dipost`);
  process.exit(78);
}

console.log(`[check] OK — slot ${check.slot}`);
process.exit(0);
