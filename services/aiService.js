const axios = require('axios');
const { buildMarketSummaryText, formatPrice, formatPct } = require('./cryptoService');

/** Batas ketat agar total caption (HTML+emoji) aman di channel gratis. */
const LIMITS = {
  hook: Number(process.env.MAX_HOOK_CHARS) || 60,
  info: Number(process.env.MAX_INFO_CHARS) || 220,
  cta: Number(process.env.MAX_CTA_CHARS) || 80,
};

function getProvider() {
  return (process.env.AI_PROVIDER || 'gemini').toLowerCase();
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
    raw.includes('payment required')
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

async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum di-set');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const { data } = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 280,
        responseMimeType: 'application/json',
      },
    },
    { timeout: 30000 }
  );

  // Gemini kadang balas error di body tanpa throw HTTP
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

async function generateWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY belum di-set');

  const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
  const { data } = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [
        {
          role: 'system',
          content:
            'Balas hanya JSON {"hook","info","cta"} dalam Bahasa Indonesia. Tanpa markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.75,
      max_tokens: 280,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://t.me/jfnetworknet',
        'X-Title': 'JF Network AutoPost',
      },
      timeout: 30000,
    }
  );

  if (data?.error) {
    const err = new Error(data.error.message || 'OpenRouter API error');
    err.response = { status: data.error.code || 400, data: data.error };
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenRouter tidak mengembalikan konten');
  return parsePostJson(text, 'openrouter');
}

/**
 * Cascade: primary → secondary (Gemini habis/limit → OpenRouter) → teks fallback.
 */
async function generatePostContent(snapshot) {
  const prompt = buildPostPrompt(snapshot);
  const preferred = getProvider();

  const chain =
    preferred === 'openrouter'
      ? [
          { name: 'openrouter', run: () => generateWithOpenRouter(prompt) },
          { name: 'gemini', run: () => generateWithGemini(prompt) },
        ]
      : [
          { name: 'gemini', run: () => generateWithGemini(prompt) },
          { name: 'openrouter', run: () => generateWithOpenRouter(prompt) },
        ];

  let lastError = null;

  for (const step of chain) {
    const hasKey =
      step.name === 'gemini'
        ? Boolean(process.env.GEMINI_API_KEY)
        : Boolean(process.env.OPENROUTER_API_KEY);

    if (!hasKey) {
      console.warn(`[aiService] Skip ${step.name}: API key belum di-set`);
      continue;
    }

    try {
      console.log(`[aiService] Coba provider: ${step.name}`);
      const result = await step.run();
      console.log(`[aiService] Sukses pakai ${step.name}`);
      return result;
    } catch (err) {
      lastError = err;
      const quota = isQuotaOrLimitError(err);
      console.warn(
        `[aiService] ${step.name} gagal${quota ? ' (kuota/kredit/limit)' : ''}: ${errorPayload(err)}`
      );
      if (quota) {
        console.warn(`[aiService] Ganti provider berikutnya karena limit kredit LLM`);
      }
    }
  }

  console.warn(
    '[aiService] Semua LLM gagal, pakai fallback teks lokal:',
    lastError ? errorPayload(lastError) : 'no provider'
  );
  return fallbackPostContent(snapshot);
}

function buildImagePrompt(snapshot) {
  const btc = snapshot.primary.majors.find((t) => t.base === 'BTC');
  const top = snapshot.primary.gainers[0];
  const mood =
    btc?.changePct != null && btc.changePct >= 0 ? 'bullish green neon' : 'bearish red neon';

  return [
    'Cinematic crypto market dashboard illustration,',
    `${mood} lighting, dark premium fintech aesthetic,`,
    `${snapshot.primaryLabel} market board,`,
    `Bitcoin ${btc ? `$${btc.last}` : ''},`,
    top ? `spotlight on ${top.base} gainer,` : '',
    'candlestick charts, holographic HUD, no watermark, 16:9',
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateImageWithPollinations(prompt) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&seed=${seed}&nologo=true&model=flux`;

  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  return Buffer.from(data);
}

async function generateImageWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY belum di-set');

  const model =
    process.env.OPENROUTER_IMAGE_MODEL || 'black-forest-labs/flux-1-schnell';

  const { data } = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://t.me/jfnetworknet',
        'X-Title': 'JF Network AutoPost',
      },
      timeout: 90000,
    }
  );

  const message = data?.choices?.[0]?.message;
  const imagePart =
    message?.images?.[0] ||
    message?.content?.find?.((c) => c.type === 'image_url' || c.image_url);

  const dataUrl =
    imagePart?.image_url?.url ||
    imagePart?.imageUrl ||
    (typeof message?.content === 'string' && message.content.startsWith('data:image')
      ? message.content
      : null);

  if (!dataUrl || !String(dataUrl).startsWith('data:image')) {
    throw new Error('OpenRouter tidak mengembalikan gambar');
  }

  return Buffer.from(String(dataUrl).split(',')[1], 'base64');
}

async function generateMarketImage(snapshot) {
  const prompt = buildImagePrompt(snapshot);
  const pollinationsEnabled = process.env.POLLINATIONS_ENABLED !== 'false';

  // Gambar: Pollinations dulu (gratis), lalu OpenRouter jika perlu
  if (pollinationsEnabled) {
    try {
      return { buffer: await generateImageWithPollinations(prompt), prompt, provider: 'pollinations' };
    } catch (err) {
      console.warn('[aiService] Pollinations gagal:', err.message);
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      return {
        buffer: await generateImageWithOpenRouter(prompt),
        prompt,
        provider: 'openrouter',
      };
    } catch (err) {
      console.warn('[aiService] OpenRouter image gagal:', errorPayload(err));
    }
  }

  return { buffer: null, prompt, provider: null };
}

async function generatePostAssets(snapshot) {
  const [content, imageResult] = await Promise.all([
    generatePostContent(snapshot),
    generateMarketImage(snapshot),
  ]);

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
};
