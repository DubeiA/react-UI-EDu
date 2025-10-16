import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pino from 'pino';
import { initDb, touchSession, listContent, createContent, deleteContent, updateContent, getNextContent, recordRating, getStats, getContentById, getSummaryCounts, findUserByUsername, countContent } from './db.js';
import Replicate from 'replicate';
import { initQueues, enqueueGenerate, getJobStatus } from './queue.js';
import { supabase } from './db_supabase.js';
import { 
  getAllActiveAgents, 
  enhancePrompt, 
  analyzeRatingFeedback,
  generateMultipleVariants 
} from './services/agent_service.js';

const app = express();
const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

initDb();
initQueues();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN || '' });
const ENABLE_EMBEDDED_GENERATE = (process.env.ENABLE_EMBEDDED_GENERATE === 'true') || !!process.env.REPLICATE_API_TOKEN;
const SHARED_INGEST_TOKEN = process.env.SHARED_INGEST_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Models configuration for frontend selection (no secrets exposed)
const MODELS_CONFIG = {
  image: {
    'seedream-4': {
      name: 'Seedream 4',
      price: '$0.03',
      speed: 'Середньо (~1 хв)',
      replicateId: 'bytedance/seedream-4',
    },
    'flux-schnell': {
      name: 'FLUX Schnell',
      price: '$0.003',
      speed: 'Швидко (~30 сек)',
      replicateId: 'black-forest-labs/flux-schnell',
    },
    'flux-dev': {
      name: 'FLUX Dev',
      price: '$0.025',
      speed: 'Повільно (~2 хв)',
      replicateId: 'black-forest-labs/flux-dev',
    },
    'sdxl': {
      name: 'Stable Diffusion XL',
      price: '$0.008',
      speed: 'Середньо (~1 хв)',
      replicateId: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
    },
  },
  video: {
    'ltx-video': {
      name: 'LTX Video (рекомендовано)',
      price: '$0.05',
      speed: '~1-2 хв',
      replicateId: 'lightricks/ltx-video:8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4',
    },
    'cogvideox': {
      name: 'CogVideoX-5B',
      price: '$0.03',
      speed: '~2-3 хв',
      replicateId: 'fofr/cogvideox-5b:4b245eb6225de6a2fd444ff752ee93dcfb49088c53249d61b4ca3f1e9e8b5b99',
    },
    'svd': {
      name: 'Stable Video Diffusion',
      price: '$0.08',
      speed: '~3-4 хв',
      replicateId: 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438',
    },
  },
  audio: {
    'lyria-2': {
      name: 'Google Lyria 2 (рекомендовано)',
      price: '$0.03',
      speed: '~30-60 сек',
      replicateId: 'google/lyria-2',
    },
    'musicgen': {
      name: 'MusicGen (Meta)',
      price: '$0.05',
      speed: '~1-2 хв',
      replicateId: 'meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb',
    },
    'riffusion': {
      name: 'Riffusion',
      price: '$0.03',
      speed: '~30-60 сек',
      replicateId: 'riffusion/riffusion:8cf61ea6c56afd61d8f5b9ffd14d7c216c0a93844ce2d82ac1c9ecc9c7f24e05',
    },
  },
};

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== role && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Simple in-memory rate limit for /api/rate per session_id (MVP)
const rateWindowMs = 60_000; // 1 min
const rateMax = 30; // 30 ratings per minute per session
const rateBuckets = new Map(); // key: session_id -> array of timestamps

function rateLimitRatings(req, res, next) {
  const now = Date.now();
  const sessionId = (req.body?.session_id || req.query?.session_id || '').toString();
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
  const arr = rateBuckets.get(sessionId) || [];
  const pruned = arr.filter(ts => now - ts < rateWindowMs);
  pruned.push(now);
  rateBuckets.set(sessionId, pruned);
  if (pruned.length > rateMax) return res.status(429).json({ error: 'Too many ratings, slow down' });
  next();
}

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public: list available models for UI selection
app.get('/api/models', (req, res) => {
  const modelsInfo = {};
  for (const [type, models] of Object.entries(MODELS_CONFIG)) {
    modelsInfo[type] = Object.entries(models).map(([key, cfg]) => ({
      value: key,
      label: `${cfg.name} (${cfg.price}, ${cfg.speed})`,
      replicateId: cfg.replicateId,
    }));
  }
  res.json(modelsInfo);
});

// Auth (login)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  const user = await findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// Content feed: next content
app.get('/api/next-content', async (req, res) => {
  const { types = 'image,text,audio,video,combo', order = 'desc', session_id } = req.query;
  if (session_id) await touchSession(session_id);
  const userId = (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : (req.user?.id)) || null;
  // Завжди віддаємо за зростанням id, щоб нові партії не перекривали попередні
  const next = await getNextContent({ sessionId: session_id, userId, types: String(types).split(','), order: 'asc' });
  if (!next) return res.status(404).json({ error: 'No content' });
  return res.json(next);
});

// Admin list (used by frontend getAllContent)
app.get('/api/admin/data', authMiddleware, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);
  const [data, total] = await Promise.all([
    listContent({ page, limit }),
    countContent(),
  ]);
  res.json({ data, total, page, limit });
});

// Content CRUD
app.post('/api/content', authMiddleware, requireRole('admin'), async (req, res) => {
  const created = await createContent(req.body || {});
  res.json(created);
});

app.put('/api/content/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const updated = await updateContent(id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

app.delete('/api/admin/data/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const exists = await getContentById(id);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  await deleteContent(id);
  res.json({ ok: true });
});

// Ratings
app.post('/api/rate', rateLimitRatings, async (req, res) => {
  try {
    const { content_id, direction, comment = '', session_id } = req.body || {};
    if (!content_id || !direction) return res.status(400).json({ error: 'Missing content_id or direction' });
    if (session_id) await touchSession(session_id);
    const rating = parseInt(direction, 10);
    if (![-2, -1, 1, 2].includes(rating)) return res.status(400).json({ error: 'Invalid rating' });
    const userId = req.user?.id || null; // if rated while authenticated
    await recordRating({ contentId: content_id, rating, userId, sessionId: session_id, comment });
    // Fire-and-forget: analyze feedback for agent learning
    analyzeRatingFeedback(content_id, rating, userId).catch((e) => console.error('Feedback analysis failed', e));
    res.json({ ok: true, analyzed: true });
  } catch (e) {
    console.error('Error recording rating:', e);
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

// Stats
app.get('/api/stats', authMiddleware, async (req, res) => {
  const stats = await getStats();
  res.json(stats);
});

// User/session scoped counters
app.get('/api/stats/summary', async (req, res) => {
  const sessionId = req.query.session_id || null;
  let userId = null;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try { const u = jwt.verify(token, JWT_SECRET); userId = u.id; } catch {}
  }
  const { total, rated, pending } = await getSummaryCounts({ sessionId, userId });
  return res.json({ total, rated, pending });
});

// Generate async (queue-backed with in-memory fallback) — feature-flagged
app.post('/api/generate', async (req, res) => {
  if (!ENABLE_EMBEDDED_GENERATE) return res.status(503).json({ error: 'Embedded generation disabled' });
  try {
    const { 
      prompt, 
      count = 10, 
      model = null, 
      type = 'image', 
      duration_seconds = null, 
      replicate_token = '',
      agent_id = null,
      use_agent = true,
      ...rest
    } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const token = (replicate_token || req.headers['x-replicate-token'] || process.env.REPLICATE_API_TOKEN || '').toString();
    if (!token) return res.status(400).json({ error: 'Missing Replicate token' });
    const job = await enqueueGenerate({ prompt, count, model, token, type, duration_seconds, agent_id, use_agent, ...rest });
    res.json({ ok: true, jobId: job.id, agentEnhanced: !!use_agent });
  } catch (e) {
    console.error('Error starting generation:', e);
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

// ========================================
// AGENTS ENDPOINTS
// ========================================

app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAllActiveAgents();
    res.json({ agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agents/enhance', async (req, res) => {
  try {
    const { prompt, type, agent_id } = req.body || {};
    if (!prompt || !type) return res.status(400).json({ error: 'prompt and type are required' });
    const result = await enhancePrompt(prompt, type, agent_id);
    res.json({
      original_prompt: prompt,
      enhanced_prompt: result.enhanced_prompt,
      agent_id: result.agent_id,
      agent_name: result.agent_name,
      techniques_used: result.techniques_used
    });
  } catch (error) {
    console.error('Error enhancing prompt:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agents/variants', async (req, res) => {
  try {
    const { prompt, type, count = 5 } = req.body || {};
    if (!prompt || !type) return res.status(400).json({ error: 'prompt and type are required' });
    console.log(`🎲 Generating ${count} variants for: "${prompt}"`);
    const variants = await generateMultipleVariants(prompt, type, count);
    res.json({ original_prompt: prompt, variants, count: variants.length });
  } catch (error) {
    console.error('Error generating variants:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agents/:id/insights', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('get_agent_insights', { p_agent_id: id });
    if (error) throw error;
    res.json({ insights: data?.[0] || null });
  } catch (error) {
    console.error('Error fetching agent insights:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agents/:id/memories', async (req, res) => {
  try {
    const { id } = req.params;
    const pageLimit = parseInt(String(req.query.limit || '20'), 10);
    const pageOffset = parseInt(String(req.query.offset || '0'), 10);
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .eq('agent_id', id)
      .order('created_at', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit - 1);
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (error) {
    console.error('Error fetching agent memories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Public job status
app.get('/api/generate/:id', async (req, res) => {
  const id = req.params.id;
  const status = await getJobStatus(id);
  res.json(status);
});

// Generate text via OpenRouter and insert into DB
app.post('/api/generate/openrouter', async (req, res) => {
  const { prompt, count = 1, model = 'openai/gpt-4o-mini' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (!OPENROUTER_API_KEY) return res.status(503).json({ error: 'OpenRouter key not configured' });
  const ids = [];
  try {
    for (let i = 0; i < Math.min(Number(count) || 1, 10); i++) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Title': 'Tinder AI Generator',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Generate a short, high-quality content snippet for human rating.' },
            { role: 'user', content: String(prompt) }
          ],
          temperature: 0.9,
          max_tokens: 220,
        }),
      });
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const created = await createContent({
        type: 'text',
        title: String(prompt).slice(0, 100),
        description: text,
        metadata: { source: 'openrouter', model, prompt },
        assets: [],
      });
      ids.push(created.id);
    }
    return res.json({ ok: true, ids });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'openrouter failed' });
  }
});

// Universal generator (text/image/video/audio/combo) using OpenRouter as planner and placeholder assets
app.post('/api/generate/universal', async (req, res) => {
  const { prompt, type = 'text', count = 1, durationSeconds } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const createdIds = [];
  const n = Math.min(Number(count) || 1, 10);
  try {
    // try to infer seconds from prompt if provided
    const inferSeconds = () => {
      if (Number.isFinite(Number(durationSeconds))) return Math.max(1, Math.min(30, Number(durationSeconds)));
      const m = String(prompt).toLowerCase().match(/(\d{1,2})\s*(sec|сек|seconds|second|секунд|секунди)/);
      const v = m ? parseInt(m[1], 10) : null;
      if (!v || !Number.isFinite(v)) return 10;
      return Math.max(1, Math.min(30, v));
    };
    const reqSecs = inferSeconds();

    const audioPool = [
      { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3', mime: 'audio/mpeg' },
      { url: 'https://www.w3schools.com/html/horse.mp3', mime: 'audio/mpeg' },
    ];
    const videoPool = [
      { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', mime: 'video/mp4', width: 1280, height: 720 },
      { url: 'https://www.w3schools.com/html/mov_bbb.mp4', mime: 'video/mp4', width: 1280, height: 720 },
    ];

    for (let i = 0; i < n; i++) {
      const seed = Math.abs((prompt + '|' + Date.now() + '|' + i).split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
      const assets = [];
      if (type === 'image') {
        assets.push({ url: `https://picsum.photos/seed/${seed}/1024/1024`, mime: 'image/jpeg', width: 1024, height: 1024 });
      } else if (type === 'video') {
        const pick = videoPool[i % videoPool.length];
        assets.push({ url: pick.url, mime: pick.mime, width: pick.width, height: pick.height, duration: reqSecs });
      } else if (type === 'audio') {
        const pick = audioPool[i % audioPool.length];
        assets.push({ url: pick.url, mime: pick.mime, duration: reqSecs });
      } else if (type === 'combo') {
        assets.push({ url: `https://picsum.photos/seed/${seed}/1024/1024`, mime: 'image/jpeg', width: 1024, height: 1024 });
        const vpick = videoPool[i % videoPool.length];
        const apick = audioPool[i % audioPool.length];
        assets.push({ url: vpick.url, mime: vpick.mime, width: vpick.width, height: vpick.height, duration: reqSecs });
        assets.push({ url: apick.url, mime: apick.mime, duration: reqSecs });
      }

      if (type === 'text') {
        // optionally enhance via OpenRouter
        let text = prompt;
        try {
          if (OPENROUTER_API_KEY) {
            const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Tinder AI Generator' },
              body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [ { role: 'system', content: 'Rewrite into a concise, engaging snippet for human rating.' }, { role: 'user', content: String(prompt) } ], temperature: 0.9, max_tokens: 200 })
            });
            const data = await resp.json();
            text = data?.choices?.[0]?.message?.content || prompt;
          }
        } catch {}
        const c = await createContent({ type: 'text', title: String(prompt).slice(0, 100), description: text, metadata: { source: 'universal', prompt }, assets: [] });
        createdIds.push(c.id);
      } else {
        const c = await createContent({ type, title: String(prompt).slice(0, 100), description: null, metadata: { source: 'universal-placeholder', prompt, requestedDurationSec: reqSecs }, assets });
        createdIds.push(c.id);
      }
    }
    return res.json({ ok: true, ids: createdIds });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'universal generate failed' });
  }
});

// Ingest endpoint: external generators push content here
function authenticateGenerator(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!SHARED_INGEST_TOKEN || token !== SHARED_INGEST_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/content/ingest', authenticateGenerator, async (req, res) => {
  const { type, title = null, assets = [], metadata = {}, prompt = null, model = null, batch_id = null, description = null, text_body = null } = req.body || {};
  if (!type || !Array.isArray(assets) || assets.length === 0) {
    return res.status(400).json({ error: 'Missing type or assets' });
  }
  try {
    const created = await createContent({ type, title, description, metadata: { ...(metadata || {}), batch_id, prompt, model }, assets, });
    // attach top-level fields for convenience if supported by db layer
    if (prompt || model || text_body) {
      try { await updateContent(created.id, { prompt: prompt || created.prompt, model: model || created.model, description, metadata: { ...(created.metadata || {}), batch_id, prompt, model }, assets: created.assets }); } catch {}
    }
    return res.json({ ok: true, id: created.id });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'ingest failed' });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  logger.info({ port }, 'API server started');
});


