/**
 * Referral / promo projects + rencana harian:
 * 1 slot crypto (spot/topcoin) + 3 slot referral acak dari pool.
 */
const fs = require('fs');
const path = require('path');
const { loadSchedule } = require('./scheduleService');
const { pickCopyStyle } = require('./contentRules');

const REFERRALS_PATH = path.join(__dirname, '..', 'config', 'referrals.json');
const RUNTIME_PATH = path.join(__dirname, '..', 'config', 'runtime.json');

function todayLabel(tz = 'Asia/Jakarta') {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOne(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

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

function loadProjects() {
  try {
    const raw = JSON.parse(fs.readFileSync(REFERRALS_PATH, 'utf8'));
    return Array.isArray(raw.projects) ? raw.projects : [];
  } catch (err) {
    console.warn('[referral] Gagal baca referrals.json:', err.message);
    return [];
  }
}

function getProject(id) {
  const needle = String(id || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  const aliases = {
    honey: 'honeygain',
    jumptask: 'honeygain',
    jump: 'honeygain',
    depin: 'honeygain',
    okx: 'okx_bot',
    okxbot: 'okx_bot',
    bot: 'okx_bot',
    grid: 'okx_bot',
    bic: 'beincom',
    chain: 'chainers',
    game: 'chainers',
  };
  const idNorm = aliases[needle] || needle;
  return loadProjects().find((p) => p.id === idNorm) || null;
}

/**
 * Buat / muat rencana hari ini: tepat 1 crypto + sisanya referral (proyek beda).
 */
function ensureDailyPlan(schedule = loadSchedule(), now = new Date()) {
  const tz = schedule.timezone || 'Asia/Jakarta';
  const date = todayLabel(tz);
  const times = [...(schedule.times || [])].sort();
  const runtime = readRuntime();
  const existing = runtime.dailyPlan;

  if (
    existing?.date === date &&
    Array.isArray(existing.slots) &&
    existing.slots.length === times.length &&
    existing.slots.every((s, i) => s.time === times[i])
  ) {
    return existing;
  }

  const projects = loadProjects();
  if (!times.length) {
    const empty = { date, slots: [], createdAt: new Date().toISOString() };
    runtime.dailyPlan = empty;
    writeRuntime(runtime);
    return empty;
  }

  const cryptoIndex = Math.floor(Math.random() * times.length);
  const cryptoCategory = Math.random() < 0.5 ? 'spot' : 'topcoin';
  const referralPool = shuffle(projects);
  let refIdx = 0;

  const slots = times.map((time, i) => {
    if (i === cryptoIndex) {
      return {
        time,
        kind: 'crypto',
        cryptoCategory,
      };
    }
    const project = referralPool[refIdx % Math.max(referralPool.length, 1)];
    refIdx += 1;
    const variant = Math.floor(Math.random() * 100000);
    const style = pickCopyStyle(variant);
    return {
      time,
      kind: 'referral',
      projectId: project?.id || 'honeygain',
      angle: pickOne(project?.angles || ['default']) || 'default',
      variant,
      copyStyleId: style.id,
      copyStyleName: style.name,
    };
  });

  const plan = {
    date,
    slots,
    createdAt: new Date().toISOString(),
  };
  runtime.dailyPlan = plan;
  writeRuntime(runtime);
  console.log(
    `[referral] Daily plan ${date}: ${slots
      .map((s) =>
        s.kind === 'crypto'
          ? `${s.time}=crypto/${s.cryptoCategory}`
          : `${s.time}=ref/${s.projectId}`
      )
      .join(' | ')}`
  );
  return plan;
}

/** Ambil entri plan untuk jam HH:MM (dari slot "YYYY-MM-DD-HH:MM"). */
function resolveSlotPlan(slot, schedule = loadSchedule()) {
  const plan = ensureDailyPlan(schedule);
  if (!slot || typeof slot !== 'string') return null;

  const m = String(slot).match(/(\d{2}:\d{2})$/);
  const time = m ? m[1] : null;
  if (!time) return null;
  return plan.slots.find((s) => s.time === time) || null;
}

function buildReferralSnapshot({
  projectId = null,
  angle = null,
  variant = null,
  copyStyleId = null,
} = {}) {
  const projects = loadProjects();
  if (!projects.length) {
    throw new Error('Tidak ada proyek di config/referrals.json');
  }

  const project = projectId ? getProject(projectId) : pickOne(projects);
  if (!project) {
    throw new Error(`Proyek referral tidak ditemukan: ${projectId}`);
  }

  const chosenAngle = angle || pickOne(project.angles) || 'default';
  const chosenVariant =
    variant != null ? Number(variant) : Math.floor(Math.random() * 100000);
  const copyStyle = copyStyleId
    ? pickCopyStyle(String(copyStyleId))
    : pickCopyStyle(chosenVariant);

  return {
    category: 'referral',
    projectId: project.id,
    project,
    angle: chosenAngle,
    variant: chosenVariant,
    copyStyle,
    primaryLabel: project.shortName || project.name,
    primarySource: 'referral',
    fetchedAt: new Date().toISOString(),
  };
}

function formatDailyPlanText(schedule = loadSchedule()) {
  const plan = ensureDailyPlan(schedule);
  const lines = [`🗓 Rencana hari ini (${plan.date}):`];
  for (const s of plan.slots) {
    if (s.kind === 'crypto') {
      lines.push(`  • ${s.time} → CRYPTO (${s.cryptoCategory}) → topik 80483`);
    } else {
      lines.push(
        `  • ${s.time} → REFERRAL ${s.projectId}${s.angle ? ` / ${s.angle}` : ''}${s.copyStyleId ? ` / gaya ${s.copyStyleId}` : ''} → topik 341`
      );
    }
  }
  return lines.join('\n');
}

module.exports = {
  REFERRALS_PATH,
  loadProjects,
  getProject,
  ensureDailyPlan,
  resolveSlotPlan,
  buildReferralSnapshot,
  formatDailyPlanText,
  todayLabel,
};
