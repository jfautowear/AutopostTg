const axios = require('axios');
const {
  buildMarketSummaryText,
  buildAirdropSummaryText,
  buildNewsSummaryText,
  formatPrice,
  formatPct,
} = require('./cryptoService');
const { composePromoImage } = require('./imageComposeService');

/** Batas ketat agar total caption (HTML+emoji) aman di channel gratis. */
const LIMITS = {
  hook: Number(process.env.MAX_HOOK_CHARS) || 60,
  info: Number(process.env.MAX_INFO_CHARS) || 220,
  cta: Number(process.env.MAX_CTA_CHARS) || 80,
};

/** Hanya model free — cegah salah isi env yang kena billing. */
const OPENROUTER_FREE_MODELS = (
  process.env.OPENROUTER_FREE_MODEL || 'qwen/qwen3.8-27b:free,openrouter/free'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter(
    (m) =>
      m.includes(':free') ||
      m === 'openrouter/free' ||
      m.endsWith('/free')
  )
  .slice(0, 2);

if (!OPENROUTER_FREE_MODELS.length) {
  OPENROUTER_FREE_MODELS.push('openrouter/free');
}

const OPENROUTER_PAID_MODEL =
  process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getGroqKey() {
  return process.env.GROQ_API_KEY || process.env.QROQ_API_KEY || '';
}

function clip(text, max) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  let out = clean.slice(0, max - 1);
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > Math.floor(max * 0.5)) out = out.slice(0, lastSpace);
  return `${out.trim()}…`;
}

function errorPayload(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  const msg = [
    err.message,
    status ? `HTTP ${status}` : '',
    typeof data === 'string' ? data : data ? JSON.stringify(data) : '',
  ]
    .filter(Boolean)
    .join(' | ');
  return msg;
}

/** Deteksi kuota / kredit / rate-limit habis. */
function isQuotaOrLimitError(err) {
  const status = err.response?.status;
  const raw = `${err.message} ${JSON.stringify(err.response?.data || {})}`.toLowerCase();

  if (status === 429 || status === 402 || status === 403) return true;

  return (
    raw.includes('resource_exhausted') ||
    raw.includes('quota') ||
    raw.includes('rate limit') ||
    raw.includes('rate_limit') ||
    raw.includes('insufficient') ||
    raw.includes('credit') ||
    raw.includes('billing') ||
    raw.includes('exceeded') ||
    raw.includes('limit: 0') ||
    raw.includes('free_tier') ||
    raw.includes('payment required') ||
    raw.includes('no endpoints found') ||
    raw.includes('provider returned error')
  );
}

/** Prinsip editorial: akurat, kontekstual, CTA jelas — AI hanya variasi wording. */
const ACCURACY_RULES = `
PRINSIP (WAJIB):
1) Hanya pakai fakta dari blok DATA di bawah. Dilarang mengarang harga, %, volume, reward, tanggal, atau nama token.
2) AI boleh memvariasikan gaya bahasa, hook, saran hati-hati, dan CTA — tapi HARUS sesuai konteks DATA.
3) Bukan saran investasi. Jangan jamin profit / "aman" / "pasti cuan".
4) CTA harus actionable (ajak cek chart / baca info resmi / buka app) tanpa menulis URL.
5) Bahasa Indonesia natural; emoji 1–3 per bagian; bedakan wording tiap kali (jangan template kaku).
6) Satu post = satu fokus. Jangan campur banyak ticker di hook kecuali memang bandingkan 2 peer secara sengaja.
`.trim();

const CTA_POOL = {
  spot: (ex) => [
    `Cek pair-nya di ${ex} sekarang — pantau dulu sebelum masuk! 📊`,
    `Bandingkan orderbook di ${ex}, jangan FOMO ya. ⚡`,
    `Lihat depth & volume di ${ex} dulu. Semoga untung! 🚀`,
    `Masuk ${ex}, cek likuiditas hot coin ini sekarang. 👀`,
  ],
  news: [
    'Daftar OKX & cek detail eventnya sekarang! 📱',
    'Gabung OKX dulu, lalu ikut eventnya — baca syarat ya. ✅',
    'Buka OKX, daftar kalau belum, cek promo resminya. 🚀',
    'Siap ikut? Daftar OKX & baca info lengkapnya! 🔍',
  ],
  airdrop: [
    'Cek chart & likuiditas di OKX Web3 DEX sekarang. 🌐',
    'Buka chart dulu di OKX Web3 — high risk, pantau masuk! ⚡',
    'Verifikasi kontrak & volume di OKX Web3 sebelum entry. 🔎',
    'Lihat pair-nya di OKX Web3 DEX. Semoga untung! 🚀',
  ],
};

function pickCta(pool) {
  const list = Array.isArray(pool) ? pool : [];
  if (!list.length) return 'Cek detailnya sekarang. DYOR!';
  return list[Math.floor(Math.random() * list.length)];
}

function buildAirdropPrompt(snapshot) {
  const summary = buildAirdropSummaryText(snapshot);
  const gem = snapshot.hotGem;

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat konten "Airdrop / Early Gem" dari data DEX real-time di bawah.

WAJIB balas HANYA JSON valid (tanpa markdown):
{"hook":"...","info":"...","cta":"..."}

${ACCURACY_RULES}
- Nada: peluang early / gem on-chain, JUJUR soal risiko.
- Wajib nuansa HIGH RISK & DYOR di info (bukan jaminan airdrop).
- Fokus gem: ${gem ? `${gem.symbol} @ ${gem.chain}` : 'token trending DEX'}.
- Boleh sebut chain + lonjakan 1h/6h HANYA jika ada di DATA.
- Jangan klaim "pasti airdrop" / "safe entry" / rug-proof.

Panjang: hook≤${LIMITS.hook}, info≤${LIMITS.info}, cta≤${LIMITS.cta} (ajak OKX Web3, tanpa URL)

DATA (sumber: DexScreener / GeckoTerminal):
${summary}`;
}

function fallbackAirdropContent(snapshot) {
  const g = snapshot.hotGem || (snapshot.gems || [])[0];
  if (!g) {
    return {
      hook: clip('📡 Scan DEX: belum ada spike jelas', LIMITS.hook),
      info: clip(
        'Tidak ada kandidat volume spike yang lolos filter. High risk kalau dipaksa entry — DYOR.',
        LIMITS.info
      ),
      cta: clip(pickCta(CTA_POOL.airdrop), LIMITS.cta),
      provider: 'template-airdrop',
    };
  }

  return {
    hook: clip(`⚡ ${g.symbol} ramai di ${g.chain}`, LIMITS.hook),
    info: clip(
      `Data on-chain: 1h ${formatPct(g.change1h)} · 6h ${formatPct(g.change6h)}. Early gem = HIGH RISK, bukan jaminan airdrop. DYOR.`,
      LIMITS.info
    ),
    cta: clip(pickCta(CTA_POOL.airdrop), LIMITS.cta),
    provider: 'template-airdrop',
  };
}

function fallbackNewsContent(snapshot) {
  const n = snapshot.hotNews || (snapshot.items || [])[0];
  if (!n) {
    return {
      hook: clip('📰 Belum ada promo OKX yang menonjol', LIMITS.hook),
      info: clip(
        'Belum ada pengumuman segar dari feed OKX. Pantau listing, event, Jumpstart, dan Earn — selalu baca syarat resmi.',
        LIMITS.info
      ),
      cta: clip(pickCta(CTA_POOL.news), LIMITS.cta),
      provider: 'fallback-news',
    };
  }
  return {
    hook: clip(`✨ Ada ${n.typeLabel} seru di OKX`, LIMITS.hook),
    info: clip(
      `OKX baru update soal ${n.typeLabel.toLowerCase()}. Intinya: ${clip(n.title, 100)}. Baca syarat dulu sebelum ikut ya.`,
      LIMITS.info
    ),
    cta: clip(pickCta(CTA_POOL.news), LIMITS.cta),
    provider: 'fallback-news',
  };
}

function buildNewsPrompt(snapshot) {
  const summary = buildNewsSummaryText(snapshot);
  const n = snapshot.hotNews;
  const exchange = n?.exchange || snapshot.primaryLabel || 'OKX';

  return `Kamu copywriter marketing channel Telegram kripto Indonesia (@jfnetworknet).
Tulis promo/news ${exchange} yang natural — seperti manusia, bukan template bot.

WAJIB balas HANYA JSON valid (tanpa markdown):
{"hook":"...","info":"...","cta":"..."}

${ACCURACY_RULES}
- Nada: marketing santai, ramah, persuasif — JANGAN kaku ("Judul resmi", "Jenis:", "Sumber data").
- Fokus: ${n ? n.typeLabel : 'Update'} di ${exchange}.
- hook: 1 kalimat pembuka menarik (boleh pakai fakta inti dari judul, diparafase Bahasa Indonesia).
- info: jelaskan inti promo/event dengan bahasa natural. Angka reward HANYA jika ada di DATA. Ajak baca syarat, jangan overpromise.
- cta: ajak daftar / buka app ${exchange} & cek detail (tanpa URL). Contoh vibe: "Daftar ${exchange} & cek eventnya sekarang".
- Jangan copy-paste judul Inggris mentah; parafrase natural tetap akurat.

Panjang: hook≤${LIMITS.hook}, info≤${LIMITS.info}, cta≤${LIMITS.cta}

DATA (sumber: ${exchange} Announcements — fakta wajib dihormati):
${summary}`;
}

function buildPostPrompt(snapshot) {
  if (snapshot.category === 'airdrop') {
    return buildAirdropPrompt(snapshot);
  }
  if (snapshot.category === 'news') {
    return buildNewsPrompt(snapshot);
  }

  const summary = buildMarketSummaryText(snapshot);
  const exchange = snapshot.primaryLabel;
  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const hotHint = hot
    ? `Fokus HOT: ${hot.base} (24h ${Number(hot.changePct).toFixed(2)}% — angka ini sudah di header, jangan diulang di info).`
    : 'Fokus top gainers / volume dari DATA.';

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat ringkasan market pulse singkat (mobile).

WAJIB balas HANYA JSON valid (tanpa markdown):
{"hook":"...","info":"...","cta":"..."}

${ACCURACY_RULES}
- ${hotHint}
- info: 1–2 kalimat soal volume/momentum TOKEN FOKUS saja.
- JANGAN name-drop BTC/ETH/SOL/ZEC atau koin lain sebagai “konteks pasar” di info — itu mengaburkan fokus.
- Boleh bandingkan 1 peer gainer HANYA jika disebut juga di hook (contoh hook: "G dan ONE ramai").
- cta: ajak cek chart token fokus di ${exchange}, tanpa URL.

Panjang: hook≤${LIMITS.hook}, info≤${LIMITS.info}, cta≤${LIMITS.cta}

DATA ${exchange} (ticker live):
${summary}`;
}

function fallbackPostContent(snapshot) {
  if (snapshot.category === 'airdrop') {
    return fallbackAirdropContent(snapshot);
  }
  if (snapshot.category === 'news') {
    return fallbackNewsContent(snapshot);
  }

  const { primary, primaryLabel, hotCoin } = snapshot;
  const hot = hotCoin || primary?.hotCoin;
  const gainer = (primary?.topGainers || primary?.gainers || [])[0];

  return {
    hook: clip(
      hot
        ? `🔥 ${hot.base} lagi ramai di ${primaryLabel}`
        : `📡 Move altcoin terpantau di ${primaryLabel}`,
      LIMITS.hook
    ),
    info: clip(
      gainer
        ? `Top gainer: ${gainer.base} ${formatPct(gainer.changePct)}. Pantau volume & likuiditas — jangan FOMO.`
        : 'Volume & momentum berubah — pantau likuiditas, jangan FOMO.',
      LIMITS.info
    ),
    cta: clip(pickCta(CTA_POOL.spot(primaryLabel || 'OKX')), LIMITS.cta),
    provider: 'fallback',
  };
}

function parsePostJson(raw, provider) {
  const text = String(raw || '').trim();
  const fenced = text.match(/\{[\s\S]*\}/);
  const jsonStr = fenced ? fenced[0] : text;
  const parsed = JSON.parse(jsonStr);

  if (!parsed.hook || !parsed.info || !parsed.cta) {
    throw new Error('JSON AI tidak lengkap (butuh hook, info, cta)');
  }

  return {
    hook: clip(parsed.hook, LIMITS.hook),
    info: clip(parsed.info, LIMITS.info),
    cta: clip(parsed.cta, LIMITS.cta),
    provider,
  };
}

const SYSTEM_JSON =
  'Balas HANYA JSON valid {"hook":"...","info":"...","cta":"..."} Bahasa Indonesia. Fakta HANYA dari DATA user — dilarang mengarang angka/reward/token. Variasikan wording, CTA actionable, NFA. Emoji secukupnya. Tanpa markdown.';

/** Groq — gratis (rate-limit harian). */
async function generateWithGroq(prompt) {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('GROQ_API_KEY belum di-set');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_JSON },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 260,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  );

  if (data?.error) {
    const err = new Error(data.error.message || 'Groq API error');
    err.response = { status: data.error.code || 400, data: data.error };
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq tidak mengembalikan konten');
  return parsePostJson(text, 'groq');
}

/** OpenRouter — coba beberapa model gratis berurutan, lalu opsi berbayar. */
async function generateWithOpenRouter(prompt, { free = true } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY belum di-set');

  const models = free ? OPENROUTER_FREE_MODELS : [OPENROUTER_PAID_MODEL];
  let lastErr = null;

  for (const model of models) {
    try {
      const body = {
        model,
        messages: [
          { role: 'system', content: SYSTEM_JSON },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 260,
      };

      if (!free) {
        body.response_format = { type: 'json_object' };
      }

      console.log(`[aiService] OpenRouter model: ${model}`);
      const { data } = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        body,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://t.me/jfnetworknet',
            'X-Title': 'JF Network AutoPost',
          },
          timeout: 35000,
        }
      );

      if (data?.error) {
        const err = new Error(data.error.message || 'OpenRouter API error');
        err.response = { status: data.error.code || 400, data: data.error };
        throw err;
      }

      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('OpenRouter tidak mengembalikan konten');
      return parsePostJson(text, free ? `openrouter-free:${model}` : `openrouter-paid:${model}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[aiService] OpenRouter ${model} gagal: ${errorPayload(err)}`);
    }
  }

  throw lastErr || new Error('OpenRouter gagal semua model');
}

/** Gemini — dianggap berbayar / last resort. */
async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum di-set');

  const model = process.env.GEMINI_MODEL || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const { data } = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: `${SYSTEM_JSON}\n\n${prompt}` }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 260,
        responseMimeType: 'application/json',
      },
    },
    { timeout: 25000 }
  );

  if (data?.error) {
    const err = new Error(data.error.message || 'Gemini API error');
    err.response = { status: data.error.code || 400, data: data.error };
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    const block = data?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini tidak mengembalikan konten${block ? ` (${block})` : ''}`);
  }

  return parsePostJson(text, 'gemini');
}

/**
 * Cascade hemat kredit (AI_PROVIDER):
 * - free  → Groq → OpenRouter free → fallback lokal (TIDAK sentuh berbayar)
 * - auto  → free dulu, lalu paid jika gratis gagal
 * - paid  → OpenRouter paid / Gemini dulu, lalu free
 */
async function generatePostContent(snapshot) {
  // Airdrop tetap template (hemat). News/Promo pakai AI rangkuman (bahasa Indonesia).
  if (snapshot.category === 'airdrop') {
    console.log('[aiService] Airdrop → template lokal (skip LLM teks)');
    return fallbackAirdropContent(snapshot);
  }

  const prompt = buildPostPrompt(snapshot);
  if (snapshot.category === 'news') {
    console.log('[aiService] News/Promo → rangkuman AI (batas karakter ketat)');
  }

  const mode = (process.env.AI_PROVIDER || 'free').toLowerCase();
  const allowPaid = mode === 'auto' || mode === 'paid';
  const preferPaidFirst = mode === 'paid';

  const freeChain = [
    {
      name: 'groq',
      tier: 'free',
      ready: () => Boolean(getGroqKey()),
      run: () => generateWithGroq(prompt),
    },
    {
      name: 'openrouter-free',
      tier: 'free',
      ready: () => Boolean(process.env.OPENROUTER_API_KEY),
      run: () => generateWithOpenRouter(prompt, { free: true }),
    },
  ];

  const paidChain = [
    {
      name: 'openrouter-paid',
      tier: 'paid',
      ready: () => Boolean(process.env.OPENROUTER_API_KEY),
      run: () => generateWithOpenRouter(prompt, { free: false }),
    },
    {
      name: 'gemini',
      tier: 'paid',
      ready: () => Boolean(process.env.GEMINI_API_KEY),
      run: () => generateWithGemini(prompt),
    },
  ];

  let chain;
  if (preferPaidFirst) {
    chain = [...paidChain, ...freeChain];
  } else if (allowPaid) {
    chain = [...freeChain, ...paidChain];
  } else {
    chain = freeChain;
    console.log('[aiService] Mode free — skip provider berbayar (hemat kredit)');
  }

  let lastError = null;

  for (const step of chain) {
    if (!step.ready()) {
      console.warn(`[aiService] Skip ${step.name}: key belum di-set`);
      continue;
    }

    try {
      console.log(`[aiService] Coba ${step.name} (${step.tier})`);
      const result = await step.run();
      console.log(`[aiService] Sukses pakai ${step.name}`);
      return result;
    } catch (err) {
      lastError = err;
      const quota = isQuotaOrLimitError(err);
      console.warn(
        `[aiService] ${step.name} gagal${quota ? ' [limit/kredit]' : ''}: ${errorPayload(err)}`
      );
      if (quota && step.tier === 'free') {
        console.warn(
          allowPaid
            ? '[aiService] Limit gratis → lanjut provider berikutnya'
            : '[aiService] Limit gratis → fallback lokal (mode free)'
        );
      }
    }
  }

  console.warn(
    '[aiService] Semua LLM gagal, pakai fallback teks lokal:',
    lastError ? errorPayload(lastError) : 'no provider'
  );
  return fallbackPostContent(snapshot);
}

/**
 * Tema visual dari nama ticker (meme coin sering literal: BabyCorn → jagung, dll).
 */
function visualThemeFromSymbol(symbol, chain) {
  const s = String(symbol || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hints = [];

  if (/corn|maize|cob/.test(s)) hints.push('cute baby corn cob mascot, yellow corn kernels, farm meme');
  else if (/cat|neko|meow|kitten|whisker/.test(s)) hints.push('cute cat mascot meme character');
  else if (/dog|inu|shib|doge|puppy|woof/.test(s)) hints.push('cute dog / shiba mascot meme');
  else if (/pepe|frog|toad/.test(s)) hints.push('green pepe frog meme mascot');
  else if (/moon|luna|rocket/.test(s)) hints.push('rocket flying to glowing moon');
  else if (/ai|gpt|bot|neural/.test(s)) hints.push('futuristic AI chip robot face');
  else if (/baby|kid|mini/.test(s)) hints.push('cute chibi baby mascot character');
  else if (/ape|monkey/.test(s)) hints.push('cool ape NFT style mascot');
  else if (/bear|bull/.test(s)) hints.push(`${/bear/.test(s) ? 'bear' : 'bull'} market animal mascot`);
  else if (/fire|hot|burn/.test(s)) hints.push('flames and heat energy');
  else if (/gold|rich|money|cash/.test(s)) hints.push('golden coins raining');
  else hints.push(`creative mascot inspired by the word "${symbol}"`);

  const chainHint =
    String(chain || '').toLowerCase() === 'solana'
      ? 'Solana purple-green gradient aura'
      : String(chain || '').toLowerCase() === 'base'
        ? 'Base blue network aura'
        : String(chain || '').toLowerCase() === 'arbitrum'
          ? 'Arbitrum blue neon aura'
          : 'multi-chain neon aura';

  hints.push(chainHint);
  return hints.join(', ');
}

/**
 * Ambil ticker koin dari judul/teks (untuk logo di gambar).
 */
function extractTickersFromText(...parts) {
  const { isRenderableTicker, normalizeTicker } = require('./imageComposeService');
  const text = parts.filter(Boolean).join(' ');
  const known = [
    'BTC', 'ETH', 'SOL', 'OKB', 'BNB', 'XRP', 'DOGE', 'PEPE', 'WIF', 'ADA',
    'AVAX', 'DOT', 'LINK', 'MATIC', 'POL', 'ATOM', 'UNI', 'APT', 'SUI', 'TIA',
    'USDT', 'USDC', 'TRX', 'LTC', 'BCH', 'NEAR', 'ARB', 'OP', 'SHIB', 'TON', 'BGB',
  ];
  const found = [];
  for (const t of known) {
    if (new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text)) {
      found.push(t);
    }
  }
  const dollars = text.match(/\$([A-Z][A-Z0-9]{1,9})/gi) || [];
  for (const d of dollars) {
    const sym = normalizeTicker(d.replace('$', ''));
    if (sym && isRenderableTicker(sym) && !found.includes(sym)) found.push(sym);
  }
  // Filter poin internal (CP dll) — tidak ada logo resmi
  return [...new Set(found)].filter((t) => isRenderableTicker(t)).slice(0, 6);
}

/** Teks overlay gambar — Latin bersih, tanpa emoji (model sering gagal render emoji). */
function cleanOverlayText(text, max = 48) {
  return clip(
    String(text || '')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/[*_`~#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    max
  );
}

/** Token major — boleh disebut di teks pasar, tapi JANGAN jadi logo tambahan di gambar spot. */
const MAJOR_CONTEXT_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'USDT', 'USDC', 'OKB', 'BGB',
]);

/**
 * Cari simbol dari universe yang disebut di teks.
 */
function findMentionedSymbols(text, universe) {
  const { normalizeTicker } = require('./imageComposeService');
  const body = String(text || '');
  const found = [];
  const sorted = [...new Set(universe.map((s) => normalizeTicker(s)).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  for (const sym of sorted) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${sym}([^A-Za-z0-9]|$)`, 'i');
    if (re.test(body) && !found.includes(sym)) found.push(sym);
  }
  return found;
}

/**
 * Aturan logo gambar (WAJIB):
 * 1) Default = HANYA token fokus (hot / judul utama).
 * 2) Multi-logo HANYA jika HOOK menyebut ≥2 token fokus (bukan sekadar konteks di info).
 * 3) Spot: sebutan BTC/ETH/SOL di info = konteks pasar, BUKAN alasan multi-logo.
 * 4) News: multi jika judul/hook resmi menyebut ≥2 koin event.
 */
function resolveFocusLogoEntries({
  focus,
  universe = [],
  content,
  imageUrlBySymbol = {},
  mode = 'spot',
} = {}) {
  const { normalizeTicker } = require('./imageComposeService');
  const focusSym = normalizeTicker(focus);
  let uni = universe.map((s) => normalizeTicker(s)).filter(Boolean);
  if (focusSym && !uni.includes(focusSym)) uni.unshift(focusSym);

  // Spot: universe logo = fokus + peer gainers saja (bukan majors/volume konteks)
  if (mode === 'spot') {
    uni = uni.filter(
      (s) => s === focusSym || !MAJOR_CONTEXT_TICKERS.has(s)
    );
  }

  // Multi hanya dari HOOK — info sering name-drop SOL/BTC sebagai konteks
  const hookMentions = findMentionedSymbols(content?.hook || '', uni).filter(
    (s) => mode !== 'spot' || s === focusSym || !MAJOR_CONTEXT_TICKERS.has(s)
  );

  let symbols;
  if (hookMentions.length >= 2) {
    symbols = hookMentions.slice(0, 5);
    if (focusSym) {
      symbols = [focusSym, ...symbols.filter((s) => s !== focusSym)].slice(0, 5);
    }
  } else if (focusSym) {
    symbols = [focusSym];
  } else if (hookMentions.length === 1) {
    symbols = hookMentions;
  } else {
    symbols = uni.slice(0, 1);
  }

  return symbols.map((symbol) => ({
    symbol,
    imageUrl: imageUrlBySymbol[symbol] || null,
  }));
}

/**
 * Meta overlay (judul, hook, logo) — teks/logo ditempel di Node, bukan di AI.
 */
function buildImageOverlayMeta(snapshot, content) {
  const { pickLayout } = require('./imageComposeService');

  if (snapshot.category === 'news') {
    const n = snapshot.hotNews;
    const kind = n?.typeLabel || 'NEWS / PROMO';
    const tickers = extractTickersFromText(n?.title, content?.hook, content?.info);
    // News: multi logo hanya jika teks resmi/AI menyebut ≥2 token
    const logoEntries =
      tickers.length >= 2
        ? tickers.map((symbol) => ({ symbol }))
        : tickers.slice(0, 1).map((symbol) => ({ symbol }));
    const meta = {
      title: cleanOverlayText(n?.title || 'OKX News', 64),
      hook: cleanOverlayText(content?.hook || kind, 56),
      tickers: logoEntries.map((e) => e.symbol),
      logoEntries,
      exchange: 'OKX',
      badge: cleanOverlayText(kind, 22),
    };
    meta.layout = pickLayout(meta);
    return meta;
  }

  const isAirdrop = snapshot.category === 'airdrop';

  if (isAirdrop) {
    const gems = Array.isArray(snapshot.gems) ? snapshot.gems : [];
    const hot = snapshot.hotGem || gems[0];
    const imageUrlBySymbol = {};
    const universe = [];
    for (const g of gems) {
      const sym = String(g?.symbol || '').toUpperCase();
      if (!sym) continue;
      universe.push(sym);
      if (g.imageUrl) imageUrlBySymbol[sym] = g.imageUrl;
    }
    const focus = hot?.symbol;
    if (hot?.imageUrl && focus) {
      imageUrlBySymbol[String(focus).toUpperCase()] = hot.imageUrl;
    }
    const logoEntries = resolveFocusLogoEntries({
      focus,
      universe,
      content,
      imageUrlBySymbol,
      mode: 'airdrop',
    });
    const symbol = String(hot?.symbol || logoEntries[0]?.symbol || '').toUpperCase();
    const meta = {
      title: cleanOverlayText(
        symbol ? `${symbol} · ${hot?.chain || 'DEX'}` : 'DEX Trending',
        48
      ),
      hook: cleanOverlayText(content?.hook || 'Early gem / airdrop radar', 56),
      tickers: logoEntries.map((e) => e.symbol),
      logoEntries,
      exchange: 'OKX',
      badge: 'AIRDROP / DEX',
    };
    meta.layout = pickLayout(meta);
    return meta;
  }

  // SPOT: default 1 logo (hot). Multi HANYA jika HOOK sebut ≥2 peer (bukan konteks BTC/SOL di info).
  const primary = snapshot.primary || {};
  const hot = snapshot.hotCoin || primary.hotCoin;
  const universe = [];
  const pushBase = (base) => {
    const symbol = String(base || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (symbol && !universe.includes(symbol)) universe.push(symbol);
  };
  if (hot?.base) pushBase(hot.base);
  // Peer untuk multi-logo: top gainers saja (bukan unusual volume / majors)
  for (const t of primary.topGainers || primary.gainers || []) pushBase(t.base);

  const logoEntries = resolveFocusLogoEntries({
    focus: hot?.base,
    universe,
    content,
    mode: 'spot',
  });

  const exchange = String(snapshot.primaryLabel || 'OKX')
    .toUpperCase()
    .includes('BITGET')
    ? 'BITGET'
    : 'OKX';
  const lead = hot?.base || logoEntries[0]?.symbol || '';
  const multi = logoEntries.length > 1;
  const peer = logoEntries.filter((e) => e.symbol !== String(lead).toUpperCase())[0];

  const meta = {
    title: cleanOverlayText(
      lead
        ? multi && peer
          ? `${lead} · ${peer.symbol}`
          : `${lead} · Top Move`
        : content?.hook || 'Market Pulse',
      48
    ),
    hook: cleanOverlayText(content?.hook || 'Spot gainers & volume', 56),
    tickers: logoEntries.map((e) => e.symbol),
    logoEntries,
    exchange,
    badge: 'SPOT',
  };
  meta.layout = pickLayout(meta);
  return meta;
}

/**
 * Prompt background SAJA — tanpa teks/logo (supaya AI tidak bikin tulisan acak).
 */
function buildImagePromptFromContent(snapshot, content) {
  if (snapshot.category === 'news') {
    const n = snapshot.hotNews;
    const kind = n?.typeLabel || 'Promo';
    const titleHint = cleanOverlayText(n?.title || '', 40);

    const motif =
      /jumpstart/i.test(kind) || /jumpstart/i.test(titleHint)
        ? 'blurred launchpad stage lights and rocket trail bokeh'
        : /listing/i.test(kind) || /listing|mencatatkan|me-listing/i.test(titleHint)
          ? 'abstract neon trading floor lights, blue gold glow'
          : /earn|loan|reward|flash/i.test(kind) ||
              /earn|reward|subscribe|flash/i.test(titleHint)
            ? 'soft golden coin bokeh vault atmosphere, dark navy'
            : /web3|dex/i.test(kind)
              ? 'abstract Web3 network nodes, purple blue glow'
              : 'premium dark fintech gradient, blue and gold light streaks';

    return [
      'Abstract crypto background only, no text, no letters, no logos, no watermark,',
      `${motif},`,
      'cinematic lighting, shallow depth of field, 16:9 landscape,',
      Math.random() > 0.5
        ? 'empty left third for logo placement,'
        : 'empty center space for overlay,',
      'professional marketing backdrop',
    ].join(' ');
  }

  const isAirdrop = snapshot.category === 'airdrop';
  const hot = isAirdrop
    ? snapshot.hotGem
    : snapshot.hotCoin || snapshot.primary?.hotCoin;
  const symbol = String(isAirdrop ? hot?.symbol : hot?.base || '')
    .trim()
    .slice(0, 24);
  const theme = symbol
    ? visualThemeFromSymbol(symbol, isAirdrop ? hot?.chain : null)
    : 'crypto market heat map';

  const change = isAirdrop
    ? hot?.change1h ?? hot?.change6h
    : hot?.changePct;
  const mood =
    change != null && Number(change) >= 0
      ? 'bullish green neon energy, rising light trails'
      : 'dramatic red market tension, cool dark tones';

  const spaceHint =
    ['empty left third for hero logo,', 'empty center for logo,', 'soft blur upper half for title,'][
      Math.abs(String(symbol || 'x').charCodeAt(0)) % 3
    ];

  return [
    'Abstract crypto background only, no text, no letters, no logos, no watermark,',
    `visual theme: ${theme},`,
    `${mood},`,
    isAirdrop ? 'early gem discovery atmosphere,' : 'spot trading heat map glow,',
    spaceHint,
    'cinematic bokeh, 16:9 landscape',
  ].join(' ');
}

/** Gambar gratis via Pollinations — tanpa API key. */
async function generateImageWithPollinations(prompt) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1_000_000);
  // nologo + enhance: kurangi watermark, prompt lebih dipatuhi
  const url =
    `https://image.pollinations.ai/prompt/${encoded}` +
    `?width=1024&height=576&seed=${seed}&nologo=true&enhance=true&model=flux`;

  console.log('[aiService] Pollinations image…');
  console.log('[aiService] Image prompt:', clip(prompt, 220));
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    headers: {
      'User-Agent': 'JFNetwork-Autopost/1.0',
    },
  });

  return Buffer.from(data);
}

/** Background solid jika Pollinations gagal — overlay tetap jalan. */
async function solidFallbackBackground(snapshot) {
  const isAirdrop = snapshot.category === 'airdrop';
  const isNews = snapshot.category === 'news';
  const color = isNews
    ? { r: 12, g: 24, b: 56 }
    : isAirdrop
      ? { r: 20, g: 16, b: 48 }
      : { r: 10, g: 28, b: 40 };
  const sharp = require('sharp');
  return sharp({
    create: {
      width: 1024,
      height: 576,
      channels: 3,
      background: color,
    },
  })
    .jpeg()
    .toBuffer();
}

async function generateMarketImage(snapshot, content) {
  const prompt = buildImagePromptFromContent(snapshot, content);
  const overlayMeta = buildImageOverlayMeta(snapshot, content);

  let bgBuffer = null;
  let provider = null;

  if (process.env.POLLINATIONS_ENABLED === 'false') {
    console.warn('[aiService] Pollinations dimatikan — pakai background solid');
    bgBuffer = await solidFallbackBackground(snapshot);
    provider = 'solid';
  } else {
    try {
      bgBuffer = await generateImageWithPollinations(prompt);
      provider = 'pollinations';
    } catch (err) {
      console.warn('[aiService] Pollinations gagal:', err.message);
      bgBuffer = await solidFallbackBackground(snapshot);
      provider = 'solid-fallback';
    }
  }

  try {
    console.log(
      `[aiService] Compose overlay: title="${clip(overlayMeta.title, 40)}" tickers=${(overlayMeta.tickers || []).join(',') || '-'}`
    );
    const buffer = await composePromoImage(bgBuffer, overlayMeta);
    return {
      buffer,
      prompt,
      provider: `${provider}+compose`,
      overlayMeta,
    };
  } catch (err) {
    console.warn('[aiService] Compose gagal:', err.message);
    return { buffer: bgBuffer, prompt, provider, overlayMeta };
  }
}

/**
 * Teks dulu (hemat kredit gratis), lalu gambar dari hasil teks (Pollinations gratis).
 */
async function generatePostAssets(snapshot) {
  const content = await generatePostContent(snapshot);
  const imageResult = await generateMarketImage(snapshot, content);

  return {
    content,
    imageBuffer: imageResult.buffer,
    imagePrompt: imageResult.prompt,
    imageProvider: imageResult.provider,
  };
}

module.exports = {
  LIMITS,
  generatePostAssets,
  generatePostContent,
  generateMarketImage,
  buildImagePromptFromContent,
  buildImageOverlayMeta,
  visualThemeFromSymbol,
  extractTickersFromText,
  cleanOverlayText,
  fallbackPostContent,
  fallbackAirdropContent,
  fallbackNewsContent,
  buildAirdropPrompt,
  buildNewsPrompt,
  isQuotaOrLimitError,
  clip,
  getGroqKey,
};
