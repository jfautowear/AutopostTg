require('dotenv').config();
const axios = require('axios');

(async () => {
  const groq = process.env.GROQ_API_KEY || process.env.QROQ_API_KEY;
  if (groq) {
    try {
      const { data } = await axios.get('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groq}` },
        timeout: 15000,
      });
      const ids = (data.data || [])
        .map((m) => m.id)
        .filter((id) => /llama|gemma|mixtral|qwen|gpt/i.test(id))
        .slice(0, 20);
      console.log('GROQ_MODELS', ids.join(' | '));
    } catch (e) {
      console.log('GROQ_LIST_ERR', e.response?.status, e.message);
    }
  }

  const or = process.env.OPENROUTER_API_KEY;
  if (!or) return;

  const tries = [
    'meta-llama/llama-3.3-8b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'openrouter/free',
  ];

  for (const model of tries) {
    const { data, status } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: 'Say hi in one word' }],
        max_tokens: 8,
      },
      {
        headers: {
          Authorization: `Bearer ${or}`,
          'HTTP-Referer': 'https://t.me/jfnetworknet',
          'X-Title': 'model-probe',
        },
        timeout: 25000,
        validateStatus: () => true,
      }
    );
    if (data?.choices?.[0]?.message?.content) {
      console.log('OR_OK', model);
    } else {
      console.log('OR_FAIL', model, status, (data?.error?.message || '').slice(0, 100));
    }
  }
})();
