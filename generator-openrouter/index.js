import 'dotenv/config';
import axios from 'axios';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.GPT_CREATOT || '';
const INGEST_URL = process.env.INGEST_URL || 'http://localhost:3001/api/content/ingest';
const SHARED_INGEST_TOKEN = process.env.SHARED_INGEST_TOKEN || '';

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY (or GPT_CREATOT)');
  process.exit(1);
}
if (!SHARED_INGEST_TOKEN) {
  console.error('Missing SHARED_INGEST_TOKEN');
  process.exit(1);
}

async function generateText(prompt) {
  const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You generate short, creative prompts or descriptions for AI content (image, video, audio, text).' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.8,
    max_tokens: 200
  }, {
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'Tinder AI Generator'
    }
  });
  return resp.data?.choices?.[0]?.message?.content?.trim() || '';
}

async function ingestTextContent(text, meta = {}) {
  const body = {
    type: 'text',
    title: text.slice(0, 80),
    description: text,
    metadata: { source: 'openrouter', ...meta },
    assets: []
  };
  await axios.post(INGEST_URL, body, {
    headers: { Authorization: `Bearer ${SHARED_INGEST_TOKEN}` }
  });
}

async function main() {
  const prompt = process.argv.slice(2).join(' ') || 'Generate 1 short creative product idea';
  const text = await generateText(prompt);
  if (!text) {
    console.error('No text generated');
    process.exit(1);
  }
  await ingestTextContent(text, { prompt, model: 'openrouter/gpt-4o-mini' });
  console.log('Ingested text content');
}

main().catch((e) => { console.error(e); process.exit(1); });


