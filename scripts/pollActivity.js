/**
 * Poll update Telegram → snapshot skor + balas DM/command.
 * Dipakai GitHub Actions berkala (PC tidak perlu ON).
 *
 * Juga memproses chat pribadi:
 * - non-admin → pesan ramah + 2 tombol (grup & channel)
 * - @jfnetworkindo → command admin
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getBot } = require('../services/telegramService');
const {
  recordMessage,
  recordReaction,
  loadStore,
  getTopUsers,
  activityEnabled,
} = require('../services/activityService');
const { handleIncomingMessage } = require('../index');
const { syncBotCommands } = require('../services/adminBotService');

const OFFSET_PATH = path.join(__dirname, '..', 'config', 'telegram-offset.json');

function readOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_PATH, 'utf8')).offset || 0;
  } catch {
    return 0;
  }
}

function writeOffset(offset) {
  fs.mkdirSync(path.dirname(OFFSET_PATH), { recursive: true });
  fs.writeFileSync(
    OFFSET_PATH,
    `${JSON.stringify({ offset, updatedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

function gitPersist(message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

  try {
    execSync('git config user.name "autopost-bot"');
    execSync('git config user.email "autopost-bot@users.noreply.github.com"');
    execSync('git add data/activity-week.json config/telegram-offset.json');
    const dirty = execSync(
      'git status --porcelain data/activity-week.json config/telegram-offset.json'
    )
      .toString()
      .trim();
    if (!dirty) {
      console.log('[activity] Tidak ada perubahan untuk di-commit');
      return;
    }
    execSync(`git commit -m "${message}"`);
    execSync('git pull --rebase --autostash origin HEAD || true', { shell: true });
    execSync('git push');
    console.log('[activity] Snapshot di-push ke repo');
  } catch (err) {
    console.error('[activity] git persist gagal:', err.message);
  }
}

async function pollActivity() {
  if (!activityEnabled()) {
    console.log('[activity] ACTIVITY_ENABLED=false — skip');
    return { polled: 0, skipped: true };
  }

  const bot = getBot();

  try {
    await bot.deleteWebHook({ drop_pending_updates: false });
  } catch (err) {
    console.warn('[activity] deleteWebhook:', err.message);
  }

  try {
    await syncBotCommands(bot);
  } catch {
    // ignore
  }

  let offset = readOffset();
  console.log(`[activity] Poll getUpdates offset=${offset}`);

  const updates = await bot.getUpdates({
    offset: offset > 0 ? offset : undefined,
    timeout: 10,
    allowed_updates: ['message', 'message_reaction', 'edited_message'],
  });

  let messages = 0;
  let reactions = 0;
  let chats = 0;

  for (const update of updates) {
    offset = update.update_id + 1;

    if (update.message_reaction) {
      if (recordReaction(update.message_reaction)) reactions += 1;
      continue;
    }

    if (update.message) {
      if (recordMessage(update.message)) messages += 1;
      try {
        await handleIncomingMessage(update.message);
        chats += 1;
      } catch (err) {
        console.warn('[activity] handle chat:', err.message);
      }
    }
  }

  writeOffset(offset);
  const store = loadStore();
  const { ranked, weekKey } = getTopUsers(5);

  console.log(
    `[activity] updates=${updates.length} | +msg=${messages} +reaksi=${reactions} | chats=${chats} | week=${weekKey} | users=${Object.keys(store.users || {}).length}`
  );
  if (ranked.length) {
    console.log(
      '[activity] Top sementara:',
      ranked
        .map((u, i) => `${i + 1}.${u.username || u.firstName || u.id}(${u.score})`)
        .join(' ')
    );
  }

  gitPersist('chore: snapshot aktivitas top-aktif mingguan');

  return {
    polled: updates.length,
    messages,
    reactions,
    chats,
    weekKey,
    userCount: Object.keys(store.users || {}).length,
  };
}

if (require.main === module) {
  pollActivity()
    .then((r) => {
      console.log('[activity] Selesai', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[activity] Gagal:', err.message);
      process.exit(1);
    });
}

module.exports = { pollActivity };
