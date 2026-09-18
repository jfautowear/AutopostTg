#!/usr/bin/env node
/**
 * DEX Token Screener — filter ketat + alert Telegram.
 *
 * Usage:
 *   node scripts/dexScreen.js              # sekali jalan
 *   node scripts/dexScreen.js --loop       # polling tiap N menit (DEX_SCREEN_POLL_MINUTES)
 *   node scripts/dexScreen.js --dry-run    # cetak hasil tanpa kirim Telegram
 *   node scripts/dexScreen.js --force-demo # (dev) tampilkan sample format saja
 */
require('dotenv').config();

const cron = require('node-cron');
const {
  runDexScreenAndAlert,
  THRESHOLDS,
} = require('../services/dexScreen');
const { formatDexScreenAlert } = require('../services/dexScreen/format');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function runOnce() {
  const dryRun = hasFlag('--dry-run');
  console.log(`[dexScreen:cli] once dryRun=${dryRun}`);
  const result = await runDexScreenAndAlert({ dryRun });
  console.log(
    `[dexScreen:cli] done candidates=${result.candidates} passed=${result.passed.length} sent=${result.sent?.length || 0}`
  );
  if (result.rejectedSample?.length) {
    console.log('[dexScreen:cli] sample reject:');
    for (const r of result.rejectedSample.slice(0, 5)) {
      console.log(
        `  - $${r.token?.symbol} ${r.token?.chain}: ${(r.reasons || [r.reason]).join('; ')}`
      );
    }
  }
  return result;
}

function startLoop() {
  const minutes = Math.max(1, Number(THRESHOLDS.pollMinutes) || 5);
  // Cron tiap N menit
  const expr = `*/${minutes} * * * *`;
  console.log(`[dexScreen:cli] loop cron="${expr}" TZ=${process.env.CRON_TIMEZONE || 'Asia/Jakarta'}`);

  const run = () => {
    runOnce().catch((err) => {
      console.error('[dexScreen:cli] error:', err.message);
    });
  };

  run();
  cron.schedule(expr, run, {
    timezone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
  });
}

async function main() {
  if (hasFlag('--force-demo')) {
    const demo = formatDexScreenAlert(
      {
        name: 'Demo Token',
        symbol: 'DEMO',
        chain: 'solana',
        address: 'Demo1111111111111111111111111111111111111',
        url: 'https://dexscreener.com/solana/demo',
      },
      {
        warnings: ['Contoh format saja'],
        metrics: {
          marketCapUsd: 2_500_000,
          fdvUsd: 4_000_000,
          liquidityUsd: 320_000,
          liqMcRatio: 0.128,
          volume24hUsd: 450_000,
          change24hPct: 42.5,
          buySellRatio: 1.15,
          buyTaxPct: 0,
          sellTaxPct: 0,
          lpLockedPct: 95,
          lpBurned: false,
          top10HolderPct: 12.4,
        },
      }
    );
    console.log(demo);
    return;
  }

  if (hasFlag('--loop')) {
    startLoop();
    return;
  }

  await runOnce();
}

main().catch((err) => {
  console.error('[dexScreen:cli] fatal:', err);
  process.exit(1);
});
