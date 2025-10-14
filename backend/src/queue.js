import pkg from 'bullmq';
const { Queue, Worker, QueueEvents } = pkg;
import IORedis from 'ioredis';
import Replicate from 'replicate';
import { createContent, recordBatch } from './db.js';

const connection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;

// In-memory fallback if Redis is not configured
const inMemory = {
  jobs: new Map(),
};

export const queues = {};

export function initQueues() {
  if (!connection) {
    return { type: 'memory' };
  }
  queues.generate = new Queue('generate', { connection });
  new Worker('generate', async (job) => {
    const { prompt, count = 1, model, token, type = 'image', duration_seconds = null } = job.data;
    // record batch
    const batchId = 'bat-' + Date.now().toString();
    try { await recordBatch({ id: batchId, prompt, model, count }); } catch {}
    const client = new Replicate({ auth: String(token) });
    const outputs = [];
    for (let i = 0; i < Math.min(count, 20); i++) {
      let usedModel = model;
      let input = { prompt };
      if (type === 'video' && !usedModel) {
        // Example video model slug; replace with your chosen one
        usedModel = 'anotherjesse/zeroscope-v2-xl';
        input = { prompt };
      } else if (type === 'audio' && !usedModel) {
        // Example audio model slug; replace with your chosen one
        usedModel = 'riffusion/riffusion';
        input = { prompt, duration: duration_seconds || 10 };
      } else if (type === 'image' && !usedModel) {
        usedModel = 'black-forest-labs/flux-schnell';
        input = { prompt };
      }

      const result = await client.run(String(usedModel), { input });
      const out = Array.isArray(result) ? result : (result?.output || result);
      const urls = Array.isArray(out) ? out.map(String) : [String(out)] ;
      for (const u of urls) {
        outputs.push(u);
        const mime = type === 'video' ? 'video/mp4' : (type === 'audio' ? 'audio/mpeg' : 'image/png');
        await createContent({ type, title: prompt, description: null, prompt, model: usedModel, metadata: { model: usedModel, batchId, prompt, duration_seconds }, assets: [{ url: u, mime }] });
      }
    }
    return { outputs, batchId };
  }, { connection });

  queues.generateEvents = new QueueEvents('generate', { connection });
  return { type: 'redis' };
}

export async function enqueueGenerate(data) {
  if (connection && queues.generate) {
    const job = await queues.generate.add('generate', data, { removeOnComplete: 100, removeOnFail: 100 });
    return { id: job.id };
  }
  // in-memory fallback
  const id = Math.random().toString(36).slice(2);
  inMemory.jobs.set(id, { status: 'active' });
  ;(async () => {
    try {
      const batchId = 'bat-' + Date.now().toString();
      try { await recordBatch({ id: batchId, prompt: data.prompt, model: data.model, count: data.count || 1 }); } catch {}
      const client = new Replicate({ auth: String(data.token) });
      const outputs = [];
      for (let i = 0; i < Math.min(data.count || 1, 20); i++) {
        let usedModel = data.model;
        let input = { prompt: data.prompt };
        if (data.type === 'video' && !usedModel) {
          usedModel = 'anotherjesse/zeroscope-v2-xl';
          input = { prompt: data.prompt };
        } else if (data.type === 'audio' && !usedModel) {
          usedModel = 'riffusion/riffusion';
          input = { prompt: data.prompt, duration: data.duration_seconds || 10 };
        } else if (data.type === 'image' && !usedModel) {
          usedModel = 'black-forest-labs/flux-schnell';
          input = { prompt: data.prompt };
        }
        const result = await client.run(String(usedModel), { input });
        const out = Array.isArray(result) ? result : (result?.output || result);
        const urls = Array.isArray(out) ? out.map(String) : [String(out)] ;
        for (const u of urls) {
          outputs.push(u);
          const mime = data.type === 'video' ? 'video/mp4' : (data.type === 'audio' ? 'audio/mpeg' : 'image/png');
          await createContent({ type: data.type || 'image', title: data.prompt, description: null, prompt: data.prompt, model: usedModel, metadata: { model: usedModel, batchId, prompt: data.prompt, duration_seconds: data.duration_seconds }, assets: [{ url: u, mime }] });
        }
      }
      inMemory.jobs.set(id, { status: 'completed', result: { outputs, batchId } });
    } catch (err) {
      inMemory.jobs.set(id, { status: 'failed', result: { error: err?.message || 'failed' } });
    }
  })();
  return { id };
}

export async function getJobStatus(id) {
  if (connection && queues.generate) {
    const job = await queues.generate.getJob(id);
    if (!job) return { status: 'notfound' };
    const state = await job.getState();
    if (state === 'completed') return { status: 'completed', result: job.returnvalue };
    if (state === 'failed') return { status: 'failed', result: { error: job.failedReason } };
    return { status: state };
  }
  return inMemory.jobs.get(id) || { status: 'notfound' };
}


