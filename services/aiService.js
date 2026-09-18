const axios = require('axios');
const {
  buildMarketSummaryText,
  buildAirdropSummaryText,
  buildNewsSummaryText,
  formatPrice,
  formatPct,
} = require('./cryptoService');

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

function buildAirdropPrompt(snapshot) {
  const summary = buildAirdropSummaryText(snapshot);
  const gem = snapshot.hotGem;

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat konten bertema "Airdrop / Early Gem Opportunity" dari data DEX trending di bawah.

WAJIB balas HANYA JSON valid (tanpa markdown), format:
{"hook":"...","info":"...","cta":"..."}

Aturan:
- Bahasa Indonesia natural, santai-profesional.
- Nada: peluang early / narasi airdrop atau gem on-chain, tapi JUJUR soal risiko.
- Wajib sebutkan ini HIGH RISK & DYOR (bukan saran investasi / bukan jaminan airdrop).
- Emoji secukupnya (1–3 per bagian).
- Fokus ke gem utama: ${gem ? `${gem.symbol} di ${gem.chain}` : 'token trending DEX'}.
- Sebut chain (Solana/Base/Arbitrum) + lonjakan volume singkat 1h/6h.
- Jangan klaim "pasti airdrop" atau "safe entry".

Panjang ketat:
- hook: maks ${LIMITS.hook} karakter
- info: maks ${LIMITS.info} karakter
- cta: maks ${LIMITS.cta} karakter (ajak cek di OKX Web3 DEX, tanpa link)

DATA:
${summary}`;
}

function fallbackAirdropContent(snapshot) {
  const g = snapshot.hotGem || (snapshot.gems || [])[0];
  if (!g) {
    return {
      hook: 'Early gem DEX scan',
      info: 'Belum ada kandidat volume spike. High risk, DYOR.',
      cta: 'Cek chart & entry di OKX Web3 DEX sekarang. Semoga untung!',
      provider: 'template-airdrop',
    };
  }

  return {
    hook: `${g.symbol} on ${g.chain}`,
    info: `1h ${formatPct(g.change1h)} | 6h ${formatPct(g.change6h)} | vol6h ${Math.round(g.volume6h || g.volume1h || 0)}`,
    cta: 'Cek chart & entry di OKX Web3 DEX sekarang. Semoga untung!',
    provider: 'template-airdrop',
  };
}

function fallbackNewsContent(snapshot) {
  const n = snapshot.hotNews || (snapshot.items || [])[0];
  if (!n) {
    return {
      hook: clip('📰 Belum ada promo OKX yang menonjol hari ini', LIMITS.hook),
      info: clip(
        'Pantau terus listing, event, Jumpstart, dan Earn di OKX. Selalu baca aturan resmi sebelum ikut. 💡',
        LIMITS.info
      ),
      cta: clip('👉 Cek peluang terbaru di OKX sekarang! 🚀', LIMITS.cta),
      provider: 'fallback-news',
    };
  }
  return {
    hook: clip(`✨ ${n.typeLabel} OKX nih!`, LIMITS.hook),
    info: clip(
      `📌 ${n.title} — peluang menarik, tapi baca syarat resmi dulu ya. Bukan saran investasi, DYOR. 🔍`,
      LIMITS.info
    ),
    cta: clip('👉 Baca detail & cek di OKX sekarang! Semoga untung 🚀', LIMITS.cta),
    provider: 'fallback-news',
  };
}

function buildNewsPrompt(snapshot) {
  const summary = buildNewsSummaryText(snapshot);
  const n = snapshot.hotNews;

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat rangkuman singkat pengumuman/promo OKX untuk mobile.

WAJIB balas HANYA JSON valid (tanpa markdown), format:
{"hook":"...","info":"...","cta":"..."}

Aturan WAJIB:
- Bahasa Indonesia 100% (jangan campur Inggris kecuali nama produk/token).
- Natural, santai-profesional, mudah dibaca.
- Emoji 1–3 per bagian (hook, info, cta) — jangan berlebihan.
- Bukan saran investasi; boleh sebut DYOR singkat di info.
- Jangan buat-buat angka reward jika tidak ada di data.
- Fokus jenis: ${n ? n.typeLabel : 'Update OKX'}.
- info = rangkuman isi pengumuman (bukan copy-paste judul mentah saja).

Panjang ketat (aman caption Telegram):
- hook: maks ${LIMITS.hook} karakter (1 kalimat pembuka menarik)
- info: maks ${LIMITS.info} karakter (rangkuman news/promo)
- cta: maks ${LIMITS.cta} karakter (ajak cek di OKX, tanpa URL)

DATA:
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
    ? `Fokus utama caption pada koin HOT/VIRAL: ${hot.base} (${hot.changePct?.toFixed?.(2)}%).`
    : 'Fokus pada top gainers altcoin (bukan BTC/ETH).';

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat ringkasan singkat untuk layout mobile (bukan paragraf panjang).

WAJIB balas HANYA JSON valid (tanpa markdown), format:
{"hook":"...","info":"...","cta":"..."}

Aturan:
- Bahasa Indonesia 100% natural, santai-profesional.
- Emoji 1–2 per bagian.
- Bukan saran investasi.
- ${hotHint}
- JANGAN ulangi nama token + % 24h di info (sudah ada di header template).
- info: 1–2 kalimat pendek soal konteks volume/momentum saja.
- cta: 1 kalimat ajak cek di ${exchange}, tanpa link.

Panjang ketat:
- hook: maks ${LIMITS.hook} karakter (1 kalimat pembuka)
- info: maks ${LIMITS.info} karakter
- cta: maks ${LIMITS.cta} karakter

DATA ${exchange}:
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
  const hot = hotCoin || primary.hotCoin;

  return {
    hook: clip(
      hot
        ? `${hot.base} lagi ramai dipantau di ${primaryLabel}.`
        : `Altcoin move terpantau di ${primaryLabel}.`,
      LIMITS.hook
    ),
    info: clip(
      'Volume & momentum naik — pantau likuiditas, jangan FOMO.',
      LIMITS.info
    ),
    cta: clip(`Cek peluang di ${primaryLabel} sekarang. Semoga untung! 🚀`, LIMITS.cta),
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
  'Balas HANYA JSON valid {"hook":"...","info":"...","cta":"..."} dalam Bahasa Indonesia. Wajib pakai beberapa emoji. Tanpa markdown, tanpa penjelasan lain.';

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
      temperature: 0.65,
      max_tokens: 220,
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
        temperature: 0.65,
        max_tokens: 220,
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
        temperature: 0.65,
        maxOutputTokens: 220,
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
  const text = parts.filter(Boolean).join(' ');
  const known = [
    'BTC', 'ETH', 'SOL', 'OKB', 'BNB', 'XRP', 'DOGE', 'PEPE', 'WIF', 'ADA',
    'AVAX', 'DOT', 'LINK', 'MATIC', 'POL', 'ATOM', 'UNI', 'APT', 'SUI', 'TIA',
    'USDT', 'USDC', 'CP', 'OKX',
  ];
  const found = [];
  for (const t of known) {
    if (new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text)) {
      found.push(t);
    }
  }
  const dollars = text.match(/\$([A-Z][A-Z0-9]{1,9})/gi) || [];
  for (const d of dollars) {
    const sym = d.replace('$', '').toUpperCase();
    if (sym && !found.includes(sym)) found.push(sym);
  }
  return [...new Set(found)].slice(0, 6);
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

/**
 * Prompt gambar: judul + logo ticker + hook terbaca (hindari teks acak/abstrak).
 */
function buildImagePromptFromContent(snapshot, content) {
  if (snapshot.category === 'news') {
    const n = snapshot.hotNews;
    const kind = n?.typeLabel || 'Promo';
    const titleOverlay = cleanOverlayText(n?.title || 'OKX News', 52);
    const hookOverlay = cleanOverlayText(content?.hook || kind, 40);
    const tickers = extractTickersFromText(n?.title, content?.hook, content?.info);
    const logoLine = tickers.length
      ? `row of clear circular coin logos labeled ${tickers.join(', ')},`
      : 'OKX coin and crypto coin logos,';

    const motif =
      /jumpstart/i.test(kind) || /jumpstart/i.test(titleOverlay)
        ? 'launchpad stage with rocket'
        : /listing/i.test(kind) || /listing|mencatatkan|me-listing/i.test(titleOverlay)
          ? 'new listing announcement board'
          : /earn|loan|reward|flash/i.test(kind) || /earn|reward|subscribe|flash/i.test(titleOverlay)
            ? 'reward vault with golden coins and gift boxes'
            : /web3|dex/i.test(kind)
              ? 'Web3 wallet and DEX interface'
              : 'OKX promo campaign podium';

    return [
      'Clean professional OKX crypto marketing poster, photorealistic UI style,',
      `TOP banner with large sharp readable Latin text exactly: "${titleOverlay}",`,
      `BOTTOM subtitle with readable Latin text exactly: "${hookOverlay}",`,
      logoLine,
      `${motif},`,
      'OKX blue and black brand colors, gold accents,',
      'centered composition, high contrast typography,',
      'NO gibberish text, NO alien script, NO surreal letters, NO watermark,',
      'NO pollinations branding, NO website URL, 16:9 landscape',
    ].join(' ');
  }

  const isAirdrop = snapshot.category === 'airdrop';
  const hot = isAirdrop
    ? snapshot.hotGem
    : snapshot.hotCoin || snapshot.primary?.hotCoin;
  const chainOrExchange = isAirdrop
    ? hot?.chain || 'DEX'
    : snapshot.primaryLabel || 'CEX';
  const symbol = String(isAirdrop ? hot?.symbol : hot?.base || '')
    .trim()
    .slice(0, 24);
  const theme = symbol
    ? visualThemeFromSymbol(symbol, isAirdrop ? hot?.chain : null)
    : 'crypto market heat map';
  const hookOverlay = cleanOverlayText(content?.hook || symbol || 'Market Pulse', 40);

  const change = isAirdrop
    ? hot?.change1h ?? hot?.change6h
    : hot?.changePct;
  const mood =
    change != null && Number(change) >= 0
      ? 'bullish green neon pump energy, rising candlesticks'
      : 'dramatic red market tension, falling candles';

  if (!symbol) {
    return [
      'Clean crypto trading poster,',
      `readable Latin headline: "${hookOverlay}",`,
      `${mood}, dark premium fintech aesthetic,`,
      `${chainOrExchange} HUD, no gibberish text, no watermark, 16:9`,
    ].join(' ');
  }

  return [
    `Clean crypto promotional poster for token ${symbol},`,
    `huge centered 3D coin logo with sharp readable ticker text "${symbol}",`,
    `subtitle readable Latin text: "${hookOverlay}",`,
    `visual theme: ${theme},`,
    `${mood},`,
    `${chainOrExchange} neon HUD background,`,
    isAirdrop ? 'early gem discovery vibe,' : 'spot trading heat map accents,',
    'NO gibberish text, NO alien script, NO watermark, NO pollinations branding, 16:9 landscape',
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

async function generateMarketImage(snapshot, content) {
  const prompt = buildImagePromptFromContent(snapshot, content);

  if (process.env.POLLINATIONS_ENABLED === 'false') {
    console.warn('[aiService] Pollinations dimatikan');
    return { buffer: null, prompt, provider: null };
  }

  try {
    const buffer = await generateImageWithPollinations(prompt);
    return { buffer, prompt, provider: 'pollinations' };
  } catch (err) {
    console.warn('[aiService] Pollinations gagal:', err.message);
    return { buffer: null, prompt, provider: null };
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
