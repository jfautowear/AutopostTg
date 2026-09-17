const fs = require('fs');
const path = require('path');
const { getMarketSnapshot } = require('./cryptoService');
const { generatePostAssets } = require('./aiService');
const { postToChannel, postToTestChat } = require('./telegramService');
const { markPostedSlot } = require('./scheduleService');

function applyRuntimeEnv() {
  try {
    const runtimePath = path.join(__dirname, '..', 'config', 'runtime.json');
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (runtime.exchangeSource && !process.env.EXCHANGE_SOURCE_OVERRIDE) {
      process.env.EXCHANGE_SOURCE = runtime.exchangeSource;
    }
  } catch {
    // ignore
  }
}

/**
 * Pipeline: fetch → AI → kirim ke channel atau test chat.
 */
async function runPipeline({ target = 'channel', slot = null } = {}) {
  applyRuntimeEnv();
  const startedAt = new Date().toISOString();
  console.log(`[pipeline] Mulai ${startedAt} | target=${target}`);

  console.log('[pipeline] Fetch OKX & Bitget...');
  const snapshot = await getMarketSnapshot();
  const hot = snapshot.hotCoin;
  console.log(
    `[pipeline] ${snapshot.primaryLabel} | gainers=${(snapshot.primary.topGainers || []).length} | unusual=${(snapshot.primary.unusualVolume || []).length} | hot=${hot ? hot.base : '-'}`
  );

  console.log('[pipeline] Generate AI...');
  const { content, imageBuffer } = await generatePostAssets(snapshot);
  console.log(
    `[pipeline] AI=${content.provider} | chars h/i/c=${content.hook.length}/${content.info.length}/${content.cta.length} | img=${Boolean(imageBuffer)}`
  );

  const payload = { snapshot, content, imageBuffer };
  const result =
    target === 'test'
      ? await postToTestChat(payload)
      : await postToChannel(payload);

  console.log(
    `[pipeline] OK → ${result.chatId}#${result.messageId} | ${result.captionLength} chars`
  );

  if (slot && target === 'channel') markPostedSlot(slot);
  return { ...result, snapshot, content };
}

module.exports = { runPipeline, applyRuntimeEnv };
