const axios = require('axios');
const { buildMarketSummaryText, formatPrice, formatPct } = require('./cryptoService');

/** Batas ketat agar total caption (HTML+emoji) aman di channel gratis. */
const LIMITS = {
  hook: Number(process.env.MAX_HOOK_CHARS) || 60,
  info: Number(process.env.MAX_INFO_CHARS) || 220,
  cta: Number(process.env.MAX_CTA_CHARS) || 80,
};

const OPENROUTER_FREE_MODELS = (
  process.env.OPENROUTER_FREE_MODEL ||
  'qwen/qwen3.8-27b:free,openrouter/free,google/gemma-4-26b-a4b-it:free,meta-llama/llama-3-8b-instruct:free'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

function buildPostPrompt(snapshot) {
  const summary = buildMarketSummaryText(snapshot);
  const exchange = snapshot.primaryLabel;
  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const hotHint = hot
    ? `Fokus utama caption pada koin HOT/VIRAL: ${hot.base} (${hot.changePct?.toFixed?.(2)}%).`
    : 'Fokus pada top gainers altcoin (bukan BTC/ETH).';

  return `Kamu copywriter channel Telegram kripto Indonesia (@jfnetworknet).
Buat konten postingan singkat dari data ${exchange} di bawah.

WAJIB balas HANYA JSON valid (tanpa markdown, tanpa penjelasan), format:
{"hook":"...","info":"...","cta":"..."}

Aturan bahasa:
- Bahasa Indonesia natural, santai-profesional, bukan kaku.
- Emoji secukupnya (1–3 per bagian), jangan berlebihan.
- Bukan saran investasi.
- ${hotHint}
- Sebutkan singkat TOP gainers / unusual volume jika relevan.

Aturan panjang (ketat):
- hook: maksimal ${LIMITS.hook} karakter (1 kalimat pembuka menarik soal koin hot)
- info: maksimal ${LIMITS.info} karakter (hot coin + 1–2 gainer, boleh sebut BTC/ETH singkat)
- cta: maksimal ${LIMITS.cta} karakter (ajak cek peluang di ${exchange}, tanpa link)

DATA ${exchange}:
${summary}`;
}

function fallbackPostContent(snapshot) {
  const { primary, primaryLabel, hotCoin } = snapshot;
  const hot = hotCoin || primary.hotCoin;
  const btc = primary.majors.find((t) => t.base === 'BTC');
  const gainers = (primary.topGainers || primary.gainers || [])
    .slice(0, 2)
    .map((t) => `${t.base} ${formatPct(t.changePct)}`)
    .join(', ');

  return {
    hook: clip(
      hot
        ? `🚀 ${hot.base} lagi panas di ${primaryLabel}!`
        : `🚀 Altcoin move di ${primaryLabel}`,
      LIMITS.hook
    ),
    info: clip(
      hot
        ? `${hot.base} $${formatPrice(hot.last)} (${formatPct(hot.changePct)}). Top gainer: ${gainers || '—'}. BTC $${formatPrice(btc?.last)} (${formatPct(btc?.changePct)}). Pantau volume, jangan FOMO.`
        : `Top gainer: ${gainers || '—'}. BTC $${formatPrice(btc?.last)} (${formatPct(btc?.changePct)}). Pantau volume, jangan FOMO.`,
      LIMITS.info
    ),
    cta: clip(`👉 Cek peluang di ${primaryLabel} sekarang.`, LIMITS.cta),
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
  'Balas HANYA JSON valid {"hook":"...","info":"...","cta":"..."} dalam Bahasa Indonesia. Tanpa markdown, tanpa penjelasan lain.';

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
      max_tokens: 280,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
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
        max_tokens: 280,
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
          timeout: 45000,
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
        maxOutputTokens: 280,
        responseMimeType: 'application/json',
      },
    },
    { timeout: 30000 }
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
 * Cascade hemat kredit:
 * 1) Groq (gratis)
 * 2) OpenRouter free model
 * 3) OpenRouter paid / Gemini (berbayar) — hanya jika gratis habis/gagal
 * 4) Fallback teks lokal
 */
async function generatePostContent(snapshot) {
  const prompt = buildPostPrompt(snapshot);
  const preferPaidFirst = (process.env.AI_PROVIDER || '').toLowerCase() === 'paid';

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

  const chain = preferPaidFirst
    ? [...paidChain, ...freeChain]
    : [...freeChain, ...paidChain];

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
        console.warn('[aiService] Kredit gratis habis/limit → lanjut provider berikutnya');
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
 * Prompt gambar dari teks AI + data hot coin (Pollinations gratis).
 */
function buildImagePromptFromContent(snapshot, content) {
  const hot = snapshot.hotCoin || snapshot.primary?.hotCoin;
  const exchange = snapshot.primaryLabel;
  const mood =
    hot?.changePct != null && hot.changePct >= 0
      ? 'bullish neon green glow'
      : 'dramatic red market tension';

  const narrative = [content?.hook, content?.info].filter(Boolean).join('. ');

  return [
    'Cinematic crypto trading illustration, ultra detailed,',
    `${mood}, dark premium fintech aesthetic,`,
    hot ? `spotlight on ${hot.base} cryptocurrency price surge,` : 'altcoin market heat map,',
    `${exchange} style HUD dashboard, candlestick charts, holographic UI,`,
    narrative ? `visual mood inspired by: ${clip(narrative, 160)},` : '',
    'no readable logos, no watermark, 16:9',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Gambar gratis via Pollinations — tanpa API key. */
async function generateImageWithPollinations(prompt) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&seed=${seed}&nologo=true&model=flux`;

  console.log('[aiService] Pollinations image…');
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
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
  fallbackPostContent,
  isQuotaOrLimitError,
  clip,
  getGroqKey,
};
