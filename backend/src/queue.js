import pkg from 'bullmq';
const { Queue, Worker, QueueEvents } = pkg;
import IORedis from 'ioredis';
import Replicate from 'replicate';
import { createContent, recordBatch } from './db.js';

const connection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;

const inMemory = {
  jobs: new Map(),
};

export const queues = {};

async function generateContent(data) {
  const { prompt, count = 1, model, token, type = 'image', duration_seconds = null } = data;
  
  const batchId = 'bat-' + Date.now().toString();
  try { 
    await recordBatch({ id: batchId, prompt, model, count }); 
  } catch (err) {
    console.error('[Queue] Failed to record batch:', err);
  }
  
  const client = new Replicate({ auth: String(token) });
  const outputs = [];
  
  for (let i = 0; i < Math.min(count, 20); i++) {
    let usedModel = model;
    let input = {};
    
    if (type === 'video') {
      if (!usedModel) {
        usedModel = 'lightricks/ltx-video:8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4';
      }
      
      if (usedModel.includes('ltx-video')) {
        input = {
          prompt: prompt,
          aspect_ratio: "16:9",
          negative_prompt: "low quality, worst quality, deformed, distorted, watermark",
        };
      } else if (usedModel.includes('cogvideox')) {
        input = {
          prompt: prompt,
          num_inference_steps: 50,
          guidance_scale: 6.0,
          num_frames: 49,
        };
      } else if (usedModel.includes('stable-video-diffusion')) {
        const seed = Math.floor(Math.random() * 999999);
        input = {
          image: `https://picsum.photos/seed/${seed}/1024/576`,
          motion_bucket_id: 127,
          frames_per_second: 6,
          num_frames: 25,
        };
      } else {
        input = {
          prompt: prompt,
        };
      }
    } else if (type === 'audio') {
      // Default: Google Lyria 2 (найкраща для музики)
      if (!usedModel) {
        usedModel = 'google/lyria-2';
      }
      
      // Google Lyria 2 parameters
      if (usedModel.includes('lyria')) {
        input = {
          prompt: prompt,
        };
      }
      // MusicGen parameters
      else if (usedModel.includes('musicgen')) {
        input = {
          prompt: prompt,
          model_version: "stereo-large",
          duration: duration_seconds || 8,
          temperature: 1.0,
          top_k: 250,
          top_p: 0,
          classifier_free_guidance: 3,
        };
      }
      // Riffusion parameters
      else if (usedModel.includes('riffusion')) {
        input = {
          prompt_a: prompt,
          denoising: 0.75,
          alpha: 0.5,
        };
      } else {
        input = {
          prompt: prompt,
          duration: duration_seconds || 10,
        };
      }
    } else if (type === 'image') {
      if (!usedModel) {
        usedModel = 'black-forest-labs/flux-schnell';
      }
      
      input = {
        prompt: prompt,
        num_outputs: 1,
        aspect_ratio: "1:1",
        output_format: "png",
        output_quality: 80,
      };
    }

    console.log(`[Queue] Generating ${type} with model: ${usedModel}`);
    console.log(`[Queue] Input:`, JSON.stringify(input, null, 2));
    
    try {
      const result = await client.run(String(usedModel), { input });
      console.log(`[Queue] Raw result type:`, typeof result, Array.isArray(result));
      console.log(`[Queue] Raw result:`, result);
      
      // Обробка результату
      let urls = [];
      
      if (Array.isArray(result)) {
        for (const item of result) {
          if (typeof item === 'object' && item !== null && typeof item.url === 'function') {
            urls.push(item.url());
          } else if (typeof item === 'string') {
            urls.push(item);
          } else if (item?.url && typeof item.url === 'string') {
            urls.push(item.url);
          } else {
            console.warn('[Queue] Unknown array item format:', item);
            urls.push(String(item));
          }
        }
      } else if (typeof result === 'object' && result !== null && typeof result.url === 'function') {
        // FileOutput з методом .url()
        urls.push(result.url());
      } else if (typeof result === 'string') {
        urls.push(result);
      } else if (result?.output) {
        if (Array.isArray(result.output)) {
          for (const item of result.output) {
            if (typeof item === 'object' && item !== null && typeof item.url === 'function') {
              urls.push(item.url());
            } else {
              urls.push(String(item));
            }
          }
        } else if (typeof result.output === 'object' && typeof result.output.url === 'function') {
          urls.push(result.output.url());
        } else {
          urls.push(String(result.output));
        }
      } else {
        console.warn('[Queue] Unknown result format, trying to stringify');
        urls.push(String(result));
      }
      
      console.log(`[Queue] Extracted URLs:`, urls);
      
      for (const u of urls) {
        if (!u || u === '[object Object]' || u === 'undefined' || u === 'null') {
          console.warn('[Queue] Skipping invalid URL:', u);
          continue;
        }
        if (!u.startsWith('http')) {
          console.warn('[Queue] Skipping non-HTTP URL:', u);
          continue;
        }
        
        outputs.push(u);
        
        // Визначення MIME типу
        let mime;
        if (type === 'video') {
          mime = 'video/mp4';
        } else if (type === 'audio') {
          if (u.includes('.wav') || u.endsWith('.wav')) {
            mime = 'audio/wav';
          } else if (u.includes('.mp3') || u.endsWith('.mp3')) {
            mime = 'audio/mpeg';
          } else if (u.includes('.ogg') || u.endsWith('.ogg')) {
            mime = 'audio/ogg';
          } else {
            mime = 'audio/mpeg';
          }
        } else {
          mime = 'image/png';
        }
        
        const created = await createContent({ 
          type, 
          title: prompt, 
          description: null, 
          prompt, 
          model: usedModel, 
          metadata: { model: usedModel, batchId, prompt, duration_seconds }, 
          assets: [{ url: u, mime }] 
        });
        
        console.log(`[Queue] Created content #${created.id} with URL: ${u}`);
      }
    } catch (err) {
      console.error(`[Queue] Generation failed:`, {
        error: err.message,
        model: usedModel,
        prompt: prompt,
        stack: err.stack,
      });
      throw err;
    }
  }
  
  return { outputs, batchId };
}

export function initQueues() {
  if (!connection) {
    console.log('[Queue] Running in memory mode (no Redis)');
    return { type: 'memory' };
  }
  
  queues.generate = new Queue('generate', { connection });
  
  new Worker('generate', async (job) => {
    console.log(`[Queue Worker] Processing job ${job.id}`);
    return await generateContent(job.data);
  }, { connection });

  queues.generateEvents = new QueueEvents('generate', { connection });
  console.log('[Queue] Initialized with Redis');
  return { type: 'redis' };
}

export async function enqueueGenerate(data) {
  if (connection && queues.generate) {
    const job = await queues.generate.add('generate', data, { 
      removeOnComplete: 100, 
      removeOnFail: 100 
    });
    console.log(`[Queue] Enqueued job ${job.id} for ${data.type}`);
    return { id: job.id };
  }
  
  const id = Math.random().toString(36).slice(2);
  inMemory.jobs.set(id, { status: 'active' });
  console.log(`[Queue] Running in-memory job ${id} for ${data.type}`);
  
  ;(async () => {
    try {
      const result = await generateContent(data);
      inMemory.jobs.set(id, { status: 'completed', result });
      console.log(`[Queue] Job ${id} completed successfully`);
    } catch (err) {
      console.error(`[Queue] Job ${id} failed:`, {
        error: err.message,
        stack: err.stack,
        data: { prompt: data.prompt, type: data.type, model: data.model }
      });
      inMemory.jobs.set(id, { status: 'failed', result: { error: err?.message || 'Generation failed' } });
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
