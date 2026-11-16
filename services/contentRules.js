/**
 * Aturan ketat konten JFNetwork — sumber kebenaran anti-ngasal / anti-overclaim.
 * Tombol & URL referral TIDAK boleh digenerate AI; selalu dari config/referrals.json.
 */

const MANDATORY_DISCLAIMER =
  '⚠️ Disclaimer: Not financial advice (NFA). Selalu lakukan riset mandiri (DYOR) sebelum berpartisipasi.';

const BANNED_PHRASES = [
  'pasti kaya',
  'jaminan profit',
  'jaminan untung',
  'auto sultan',
  'tanpa risiko',
  'tanpa resiko',
  '100% profit',
  'profit 100%',
  'pasti cuan',
  'pasti untung',
  'dijamin kaya',
  'langsung kaya',
  'bebas risiko',
  'bebas resiko',
  'zero risk',
  'guaranteed profit',
  'risk free',
];

const COPY_STYLES = [
  {
    id: 'A',
    name: 'Gaya A (Storytelling / Relatable)',
    brief:
      'Mulai dari masalah sehari-hari (kuota terbuang, capek pantau chart, internet menganggur). Relatable, human.',
  },
  {
    id: 'B',
    name: 'Gaya B (Edukasi Singkat / Insight)',
    brief:
      'Jelaskan cara kerja singkat (DePIN / bandwidth / Grid Bot saat sideways) tanpa mengarang angka teknis.',
  },
  {
    id: 'C',
    name: 'Gaya C (Update / Social Proof)',
    brief:
      'Soroti progress/fitur nyata dari DATA saja. Jangan invent saldo, APR, atau jumlah user.',
  },
  {
    id: 'D',
    name: 'Gaya D (FOMO Halus / Peluang Awal)',
    brief:
      'Tekankan peluang ikut lebih awal sebelum ekosistem ramai — tetap realistis, tanpa tekanan berlebihan.',
  },
  {
    id: 'E',
    name: 'Gaya E (To-The-Point / Bullet Points)',
    brief:
      'Langsung 3–4 poin keunggulan singkat. Padat, jelas, actionable.',
  },
];

const OKX_TRADE_URL = 'https://okx.ac/join/76785925';

const BITGET_TRADE_URLS = [
  'https://partner.bitgetapps.com/bg/jfnet10',
  'https://partner.bitgetapps.com/bg/CSGH1P',
];

const IMAGE_THEME_BY_PROJECT = {
  honeygain:
    'Warm golden yellow & royal blue cyber aesthetic, 3D bees honeycomb Wi-Fi coins desktop dashboard',
  grass:
    'Deep forest cyber-green & neon lime glow, smartphone wallet silhouette leaves network nodes',
  chainers:
    'Vibrant purple golden harvest playful 3D voxel farm aesthetic, farm characters POL BNB coins',
  beincom:
    'Futuristic violet magenta glowing silver Web3 aesthetic, BIC coins rockets stars wallet mockup',
  okx_bot:
    'Sleek obsidian black neon emerald green metallic silver fintech aesthetic, trading bot tablet dashboard',
  crypto:
    'Sleek obsidian black neon emerald green metallic silver fintech aesthetic, candlestick glow metallic coins',
};

function pickCopyStyle(seed = null) {
  if (typeof seed === 'string' && /^[A-Ea-e]$/.test(seed.trim())) {
    return (
      COPY_STYLES.find((s) => s.id === seed.trim().toUpperCase()) || COPY_STYLES[0]
    );
  }
  if (seed != null && Number.isFinite(Number(seed))) {
    return COPY_STYLES[Math.abs(Number(seed)) % COPY_STYLES.length];
  }
  return COPY_STYLES[Math.floor(Math.random() * COPY_STYLES.length)];
}

function pickBitgetUrl() {
  return BITGET_TRADE_URLS[Math.floor(Math.random() * BITGET_TRADE_URLS.length)];
}

function containsBannedPhrase(text) {
  const lower = String(text || '').toLowerCase();
  return BANNED_PHRASES.filter((p) => lower.includes(p));
}

/** Buang klaim terlarang dari teks AI (fallback aman). */
function sanitizeMarketingText(text) {
  let out = String(text || '');
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, 'potensi tambahan');
  }
  // Hapus baris disclaimer yang AI tulis sendiri — kita append teks resmi
  out = out
    .replace(/\n?\s*⚠️?\s*Disclaimer\s*:[\s\S]*$/i, '')
    .replace(/\n?\s*Not financial advice[\s\S]*$/i, '')
    .replace(/\n?\s*\(?\s*NFA\s*\)?\.?\s*(DYOR)?\.?\s*$/i, '')
    .replace(/\bDYOR\b\.?\s*$/i, '')
    .trim();
  return out;
}

function clipHeadline(text, maxWords = 6) {
  const words = String(text || '')
    .replace(/[^\w\sÀ-ÿ%+./\-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(' ').trim() || 'Update JF Network';
}

/**
 * Blok aturan yang disuntik ke setiap prompt AI.
 */
function buildStrictPromptBlock({ style = null, kind = 'referral' } = {}) {
  const styleLine = style
    ? `GAYA COPYWRITING WAJIB pakai sekarang: ${style.name} — ${style.brief}`
    : 'Pilih salah satu gaya A–E secara konsisten dalam 1 caption.';

  return `
PERAN: Automation Content Strategist channel Telegram JFNetwork (t.me/jfnetworknet).
Bahasa: Indonesia natural, emoji proporsional (1–3 per bagian).

${styleLine}

LARANGAN KERAS (anti-ngasal & anti-overclaim):
- DILARANG mengarang harga, %, volume, saldo, APR, jumlah user, tanggal event, atau nama token di luar DATA.
- DILARANG: "pasti kaya", "jaminan profit 100%", "auto sultan", "tanpa risiko", "pasti cuan", nominal uang pasti untuk user baru.
- Pakai diksi realistis: "potensi tambahan", "alternatif passive income", "sesuai aktivitas", "optimalkan aset menganggur".
- DILARANG menulis URL / link / domain di teks (tombol disediakan sistem).
- DILARANG menulis baris Disclaimer/NFA/DYOR di JSON (sistem menambahkan otomatis teks resmi).
- Jangan meniru template kaku; bedakan wording tiap generate.

${
  kind === 'referral'
    ? 'Jenis: PROJECT_PROMO referral. Fokus 1 proyek saja.'
    : 'Jenis: CRYPTO_UPDATE pasar. Fokus data market / top coin saja.'
}
`.trim();
}

function buildImagePromptRules({ projectId = 'crypto', headline = '' } = {}) {
  const theme =
    IMAGE_THEME_BY_PROJECT[projectId] || IMAGE_THEME_BY_PROJECT.crypto;
  const safeHeadline = clipHeadline(headline, 6);

  return [
    'Professional Telegram crypto marketing banner, aspect ratio 16:9 landscape,',
    'split composition: promotional visual weight on right (device mockup / 3D assets), clean dark space on left for overlay text,',
    `color theme: ${theme},`,
    safeHeadline
      ? `optional sharp Indonesian headline concept (max 6 words): "${safeHeadline}" — but prefer NO rendered letters in the image itself,`
      : 'no readable letters or logos in the background,',
    'vary camera angle of smartphone OR floating tablet OR holographic glass screen each time,',
    'floating 3D accents: related coins, mini rockets, green candlesticks, security shield, or network icons — change mix each generation,',
    'cinematic lighting, shallow depth of field, high quality,',
    'Strictly mask/censor any wallet address strings using asterisks like 0x814••••••••••013,',
    'no real people faces, no watermarks except space reserved bottom-right for T.me/jfnetworknet overlay,',
    'do not invent fake UI balances or APR numbers as readable text',
  ].join(' ');
}

module.exports = {
  MANDATORY_DISCLAIMER,
  BANNED_PHRASES,
  COPY_STYLES,
  OKX_TRADE_URL,
  BITGET_TRADE_URLS,
  IMAGE_THEME_BY_PROJECT,
  pickCopyStyle,
  pickBitgetUrl,
  containsBannedPhrase,
  sanitizeMarketingText,
  clipHeadline,
  buildStrictPromptBlock,
  buildImagePromptRules,
};
