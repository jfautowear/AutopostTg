// Set GitHub Actions secrets dari file .env lokal (tanpa menampilkan nilai).
// Jalankan SETELAH login sebagai pemilik repo jfautowear:
//   gh auth login
//   node scripts/pushSecretsFromEnv.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const REPO = process.env.GITHUB_REPO || 'jfautowear/AutopostTg';

const SECRET_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHANNEL_ID',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'TELEGRAM_FORWARD_CHAT_ID',
  'TELEGRAM_FORWARD_THREAD_ID',
  'TEST_CHAT_ID',
];

function parseEnv(filePath) {
  const out = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function looksLikePlaceholder(value) {
  if (!value) return true;
  const v = value.toLowerCase();
  return (
    v.includes('your_') ||
    v.includes('changeme') ||
    v.includes('+xqvu') ||
    v === 'xxx' ||
    v === 'todo'
  );
}

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('.env tidak ditemukan');
    process.exit(1);
  }

  const env = parseEnv(ENV_PATH);
  let ok = 0;
  let skip = 0;

  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (looksLikePlaceholder(value)) {
      console.log(`SKIP ${key} (kosong/placeholder)`);
      skip += 1;
      continue;
    }

    execFileSync('gh', ['secret', 'set', key, '--repo', REPO], {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`SET  ${key}`);
    ok += 1;
  }

  if (looksLikePlaceholder(env.TELEGRAM_FORWARD_CHAT_ID)) {
    execFileSync('gh', ['secret', 'set', 'TELEGRAM_FORWARD_CHAT_ID', '--repo', REPO], {
      input: '@caricuanhp',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log('SET  TELEGRAM_FORWARD_CHAT_ID (default)');
    ok += 1;
  }
  if (looksLikePlaceholder(env.TELEGRAM_FORWARD_THREAD_ID)) {
    execFileSync('gh', ['secret', 'set', 'TELEGRAM_FORWARD_THREAD_ID', '--repo', REPO], {
      input: '80483',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log('SET  TELEGRAM_FORWARD_THREAD_ID (default)');
    ok += 1;
  }

  console.log(`\nSelesai: ${ok} secrets di-set, ${skip} di-skip → ${REPO}`);
}

main();
