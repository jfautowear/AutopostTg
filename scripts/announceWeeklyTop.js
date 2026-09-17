/**
 * Analisa snapshot data/activity-week.json → post Top 10 ke grup.
 * Dipakai GHA Sabtu ~09:00 WIB (setelah poll snapshot).
 */
require('dotenv').config();

const { execSync } = require('child_process');
const { postWeeklyTop, statusText } = require('../services/weeklyTopService');
const { getTopUsers } = require('../services/activityService');

function gitPersist(message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  try {
    execSync('git config user.name "autopost-bot"');
    execSync('git config user.email "autopost-bot@users.noreply.github.com"');
    execSync('git pull --rebase origin HEAD || true', { shell: true });
    execSync('git add data/activity-week.json');
    const dirty = execSync('git status --porcelain data/activity-week.json')
      .toString()
      .trim();
    if (!dirty) return;
    execSync(`git commit -m "${message}"`);
    execSync('git push');
    console.log('[announce] Mark posted di-push ke repo');
  } catch (err) {
    console.error('[announce] git persist gagal:', err.message);
  }
}

async function main() {
  const force =
    process.argv.includes('--force') ||
    process.env.FORCE_ANNOUNCE === 'true';

  console.log(statusText());
  console.log('---');

  const { ranked, weekKey } = getTopUsers(10);
  console.log(
    `[announce] Analisa snapshot week=${weekKey} | kandidat=${ranked.length}`
  );

  const result = await postWeeklyTop({ force, isTest: false });
  console.log('[announce] Hasil:', result);

  if (!result.skipped) {
    gitPersist(`chore: mark weekly top posted (${weekKey})`);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[announce] Gagal:', err.message);
      process.exit(1);
    });
}

module.exports = { main };
