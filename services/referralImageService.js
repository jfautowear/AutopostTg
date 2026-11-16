/**
 * Gambar promo referral — mirip banner yang user berikan.
 * Mode: reference (pakai aset) | ai (Pollinations) | hybrid (default).
 */
const fs = require('fs');
const path = require('path');

const REF_DIR = path.join(__dirname, '..', 'assets', 'referrals');

/** Deskripsi gaya visual per proyek (dari contoh banner user). */
const STYLE_GUIDES = {
  honeygain: {
    brand: 'HONEYGAIN',
    style:
      'High-energy Honeygain DePIN promo banner like modern crypto ads, warm golden yellow and royal blue cyber aesthetic, cute 3D bees, honeycomb, Wi-Fi icons, desktop monitor dashboard mockup on the right, floating dollar coins and rockets, bold Indonesian marketing headline space on the left, cinematic 3D render, 16:9',
  },
  grass: {
    brand: 'GRASS',
    style:
      'Grass DePIN promo banner, deep forest cyber-green and neon lime glow, smartphone wallet mockup on the right showing blank UI, floating SOL USDC coins leaves network nodes rockets, bold left-side headline space, cinematic 3D marketing, 16:9',
  },
  chainers: {
    brand: 'CHAINERS',
    style:
      'Chainers GameFi promo banner, vibrant purple golden harvest playful 3D voxel farm aesthetic, tablet withdraw history mockup on the right, voxel farmer cow pig characters, POL BNB CFB coins floating, NO OKX logo, bold left headline space, cinematic 3D, 16:9',
  },
  beincom: {
    brand: 'BEINCOM',
    style:
      'Beincom airdrop SocialFi promo banner, futuristic violet magenta glowing silver Web3 aesthetic, smartphone BIC wallet mockup on the right, gold BIC coins purple tokens rockets stars, celebratory energy beams, bold left headline space, NO exchange logos, 16:9',
  },
  okx_bot: {
    brand: 'OKX',
    style:
      'OKX Spot Grid Trading Bot promo banner, sleek obsidian black neon emerald green metallic silver fintech aesthetic, tablet trading bots dashboard on the right with green profit arrows, BTC ETH USDT coins circuit lines, OKX brand lighting allowed, bold left headline space, 16:9',
  },
};

function listReferenceFiles(projectId) {
  const id = String(projectId || '').toLowerCase();
  if (!id || !fs.existsSync(REF_DIR)) return [];
  return fs
    .readdirSync(REF_DIR)
    .filter((f) => f.toLowerCase().startsWith(`${id}-`) && /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => path.join(REF_DIR, f));
}

function pickReferenceBuffer(projectId, variant = 0) {
  const files = listReferenceFiles(projectId);
  if (!files.length) return null;
  const idx = Math.abs(Number(variant) || 0) % files.length;
  const file = files[idx];
  console.log(`[referralImage] Pakai referensi: ${path.basename(file)}`);
  return fs.readFileSync(file);
}

function buildReferralStylePrompt(snapshot, content = {}) {
  const id = snapshot.projectId || snapshot.project?.id || 'honeygain';
  const guide = STYLE_GUIDES[id] || STYLE_GUIDES.honeygain;
  const headline = String(content.image_headline || content.hook || guide.brand)
    .replace(/[^\w\sÀ-ÿ%+./\-]/gi, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');

  return [
    guide.style,
    `project branding for ${guide.brand} only,`,
    headline ? `conceptual headline vibe: ${headline},` : '',
    'split composition left text area empty-ish dark gradient, right device mockup and 3D props,',
    'professional Telegram channel marketing quality,',
    'no OKX logo unless project is OKX Bot,',
    'no Bitget logo, no random exchange watermarks,',
    'no readable tiny UI numbers that look fake, no wallet addresses,',
    'Strictly mask any wallet strings as 0x814••••••••••013,',
    'leave bottom-right corner clear for T.me/jfnetworknet,',
    `variation seed ${snapshot.variant || 0}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * hybrid (default): 65% referensi user, 35% AI style-match
 * reference: selalu aset
 * ai: selalu Pollinations
 */
function shouldUseReference(snapshot) {
  const mode = String(process.env.REFERRAL_IMAGE_MODE || 'hybrid').toLowerCase();
  if (mode === 'reference' || mode === 'ref') return true;
  if (mode === 'ai') return false;
  const v = Number(snapshot.variant) || 0;
  return v % 100 < 65;
}

module.exports = {
  REF_DIR,
  STYLE_GUIDES,
  listReferenceFiles,
  pickReferenceBuffer,
  buildReferralStylePrompt,
  shouldUseReference,
};
