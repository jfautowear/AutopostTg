require('dotenv').config();

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getMarketSnapshot } = require('./services/cryptoService');
const { generatePostAssets } = require('./services/aiService');
const { postToChannel } = require('./services/telegramService');
const {
  loadSchedule,
  shouldPostNow,
  alreadyPostedSlot,
  markPostedSlot,
  formatScheduleText,
  currentTimeLabel,
} = require('./services/scheduleService');

function applyRuntimeEnv() {
  try {
    const runtimePath = path.join(__dirname, 'config', 'runtime.json');
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (runtime.exchangeSource && !process.env.EXCHANGE_SOURCE_OVERRIDE) {
      process.env.EXCHANGE_SOURCE = runtime.exchangeSource;
    }
  } catch {
    // ignore
  }
}

async function runAutoPost(slot = null) {
  applyRuntimeEnv();
  const startedAt = new Date().toISOString();
  console.log(`[autopost] Mulai ${startedAt}`);

  console.log('[autopost] Fetch data OKX & Bitget...');
  const snapshot = await getMarketSnapshot();
  console.log(
    `[autopost] Sumber: ${snapshot.primaryLabel} | majors: ${snapshot.primary.majors.length} | gainers: ${snapshot.primary.gainers.length}`
  );

  console.log('[autopost] Generate konten & gambar AI...');
  const { content, imageBuffer } = await generatePostAssets(snapshot);
  console.log(
    `[autopost] AI=${content.provider} | hook=${content.hook.length} info=${content.info.length} cta=${content.cta.length} | gambar: ${imageBuffer ? 'ya' : 'tidak'}`
  );

  console.log('[autopost] Posting ke Telegram + forward grup...');
  const result = await postToChannel({ snapshot, content, imageBuffer });
  console.log(
    `[autopost] Sukses → ${result.chatId}#${result.messageId} | affiliate=${result.source} | ${result.captionLength} chars | forward=${result.forwarded ? result.forwardChatId : 'gagal/skip'}`
  );

  if (slot) markPostedSlot(slot);
  return result;
}

/**
 * Mode GitHub Actions / --once:
 * - --force / FORCE_POST=true → selalu post
 * - selain itu cek config/schedule.json
 */
async function runOnceRespectingSchedule() {
  const force =
    process.argv.includes('--force') ||
    process.env.FORCE_POST === 'true' ||
    process.env.FORCE_POST === '1';

  const schedule = loadSchedule();
  console.log(formatScheduleText(schedule));
  console.log(`[autopost] Waktu sekarang: ${currentTimeLabel(schedule.timezone)}`);

  if (force) {
    console.log('[autopost] FORCE_POST aktif');
    return runAutoPost(`force-${Date.now()}`);
  }

  const check = shouldPostNow(schedule);
  if (!check.match) {
    console.log('[autopost] Skip — di luar jadwal (pakai --force untuk paksa post)');
    return { skipped: true };
  }

  if (alreadyPostedSlot(check.slot)) {
    console.log(`[autopost] Skip — slot ${check.slot} sudah dipost`);
    return { skipped: true, reason: 'duplicate_slot' };
  }

  return runAutoPost(check.slot);
}

function startScheduler() {
  const timezone = loadSchedule().timezone || 'Asia/Jakarta';
  console.log(`[scheduler] Watcher aktif tiap menit (${timezone})`);
  console.log(formatScheduleText());
  console.log(`[scheduler] Channel: ${process.env.TELEGRAM_CHANNEL_ID || '@jfnetworknet'}`);

  cron.schedule(
    '* * * * *',
    () => {
      const schedule = loadSchedule();
      const check = shouldPostNow(schedule, new Date(), 0);
      if (!check.match) return;
      if (alreadyPostedSlot(check.slot)) return;

      runAutoPost(check.slot).catch((err) => {
        console.error('[autopost] Gagal:', err.message);
      });
    },
    { timezone }
  );

  if (process.env.RUN_ON_START === 'true') {
    console.log('[scheduler] RUN_ON_START=true → eksekusi segera');
    runAutoPost(`start-${Date.now()}`).catch((err) =>
      console.error('[autopost] Gagal:', err.message)
    );
  }
}

async function main() {
  const once =
    process.argv.includes('--once') || process.env.GITHUB_ACTIONS === 'true';

  if (once) {
    try {
      await runOnceRespectingSchedule();
      process.exit(0);
    } catch (err) {
      console.error('[autopost] Gagal:', err.message);
      if (err.response?.data) {
        console.error('[autopost] Detail:', JSON.stringify(err.response.data));
      }
      process.exit(1);
    }
    return;
  }

  startScheduler();
  console.log('[scheduler] Menunggu jadwal... (Ctrl+C untuk berhenti)');
  console.log('[scheduler] Atur jadwal via DM bot sebagai @jfnetworkindo');
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
