// backend/src/queue.js - ПОВНА ВЕРСІЯ з метаданами

import pkg from 'bullmq';
const { Queue, Worker, QueueEvents } = pkg;
import IORedis from 'ioredis';
import Replicate from 'replicate';
import { createContent, recordBatch, db } from './db.js';
import { 
  getImageMetadata, 
  getVideoMetadata, 
  getAudioMetadata,
  generateDescription,
  buildGenerationParams
} from './utils/metadata_utils.js';
import { enhancePrompt } from './services/agent_service.js';

const connection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;

const inMemory = {
  jobs: new Map(),
};

export const queues = {};

// ✅ Конфігурація моделей з метаданими
const MODELS_CONFIG = {
  'seedream-4': {
    model: 'bytedance/seedream-4',
    name: 'Seedream 4',
    type: 'image',
    prepareInput: (prompt, params) => ({
      size: params.size || '2K',
      width: params.width || 2048,
      height: params.height || 2048,
      prompt: prompt,
      max_images: params.max_images || 1,
      image_input: params.image_input || [],
      aspect_ratio: params.aspect_ratio || '4:3',
      sequential_image_generation: params.sequential_image_generation || 'disabled',
    })
  },
  'flux-schnell': {
    model: 'black-forest-labs/flux-schnell',
    name: 'FLUX Schnell',
    type: 'image',
    prepareInput: (prompt, params) => ({
      prompt: prompt,
      num_outputs: params.num_outputs || 1,
      aspect_ratio: params.aspect_ratio || "1:1",
      output_format: "png",
      output_quality: params.output_quality || 80,
      num_inference_steps: params.num_inference_steps || 4,
      guidance_scale: params.guidance_scale || 0
    })
  },
  'flux-dev': {
    model: 'black-forest-labs/flux-dev',
    name: 'FLUX Dev',
    type: 'image',
    prepareInput: (prompt, params) => ({
      prompt: prompt,
      num_outputs: params.num_outputs || 1,
      aspect_ratio: params.aspect_ratio || "1:1",
      output_format: "png",
      output_quality: params.output_quality || 80,
      num_inference_steps: params.num_inference_steps || 28,
      guidance_scale: params.guidance_scale || 3.5
    })
  },
  'ltx-video': {
    model: 'lightricks/ltx-video:8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4',
    name: 'LTX Video',
    type: 'video',
    prepareInput: (prompt, params) => ({
      prompt: prompt,
      aspect_ratio: params.aspect_ratio || "16:9",
      negative_prompt: params.negative_prompt || "low quality, worst quality, deformed, distorted, watermark",
      num_frames: params.num_frames || 121,
      num_inference_steps: params.num_inference_steps || 30
    })
  },
  'lyria-2': {
    model: 'google/lyria-2',
    name: 'Google Lyria 2',
    type: 'audio',
    prepareInput: (prompt, params) => ({
      prompt: prompt,
      duration: params.duration || 10,
      temperature: params.temperature || 1.0
    })
  },
  'musicgen': {
    model: 'meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb',
    name: 'MusicGen',
    type: 'audio',
    prepareInput: (prompt, params) => ({
      prompt: prompt,
      model_version: params.model_version || "stereo-large",
      duration: params.duration || 8,
      temperature: params.temperature || 1.0,
      top_k: params.top_k || 250,
      top_p: params.top_p || 0,
      classifier_free_guidance: params.classifier_free_guidance || 3,
      output_format: "mp3",
      normalization_strategy: "peak"
    })
  }
};

function getModelConfig(modelIdentifier, type) {
  // Якщо модель не задана — вибираємо дефолт за типом
  if (!modelIdentifier) {
    if (type === 'video') return MODELS_CONFIG['ltx-video'];
    if (type === 'audio') return MODELS_CONFIG['lyria-2'];
    return MODELS_CONFIG['seedream-4']; // image/інші → Seedream 4
  }
  // Спроба знайти по ключу
  if (MODELS_CONFIG[modelIdentifier]) {
    return MODELS_CONFIG[modelIdentifier];
  }
  
  // Спроба знайти по повному імені моделі
  for (const [key, config] of Object.entries(MODELS_CONFIG)) {
    if (config.model === modelIdentifier || (typeof modelIdentifier === 'string' && modelIdentifier.includes(key))) {
      return config;
    }
  }
  
  // Fallback - створюємо базовий config
  return {
    model: modelIdentifier,
    name: modelIdentifier.split('/').pop().split(':')[0],
    type: type || 'image',
    prepareInput: (prompt, params) => ({ prompt, ...params })
  };
}

/**
 * ✅ ПОВНА ФУНКЦІЯ генерації з метаданими
 */
async function generateContent(data) {
  const { 
    prompt: originalPrompt, 
    count = 1, 
    model, 
    token, 
    type = 'image', 
    duration_seconds = null,
    user_id = null,
    agent_id = null,      // optional explicit agent
    use_agent = true,     // whether to use agent enhancement
    ...otherParams 
  } = data;
  
  console.log('🚀 Починаємо генерацію:', { originalPrompt, type, model, count, use_agent });

  // ✅ Enhance prompt via agent if enabled
  let enhancedPrompt = originalPrompt;
  let agentUsed = null;
  let techniques = [];

  if (use_agent) {
    try {
      console.log('🤖 Викликаємо агента для покращення промпту...');
      const enhancement = await enhancePrompt(originalPrompt, type, agent_id);
      enhancedPrompt = enhancement.enhanced_prompt;
      agentUsed = enhancement.agent_id;
      techniques = enhancement.techniques_used || [];
      console.log('✅ Агент покращив промпт:', {
        agent: enhancement.agent_name,
        original_length: originalPrompt?.length || 0,
        enhanced_length: enhancedPrompt?.length || 0,
        techniques
      });
    } catch (agentError) {
      console.error('⚠️ Агент не зміг покращити промпт, використовуємо оригінал:', agentError.message);
    }
  }

  // ✅ 1. Отримуємо конфігурацію моделі
  const modelConfig = getModelConfig(model, type);
  const usedModel = modelConfig.model;
  const contentType = modelConfig.type;

  console.log('📦 Model config:', {
    name: modelConfig.name,
    type: contentType,
    model: usedModel
  });

  // ✅ 2. Підготовка параметрів для генерації
  const generationParams = {
    ...otherParams,
    duration: duration_seconds,
  };

  const preparedInput = modelConfig.prepareInput(enhancedPrompt, generationParams);
  console.log('📤 Prepared input (з покращеним промптом):', preparedInput);

  // ✅ 3. Створюємо batch ПЕРЕД генерацією
  const batchId = 'bat-' + Date.now().toString();
  
  try { 
    await recordBatch({ 
      id: batchId, 
      prompt: enhancedPrompt, 
      model: model,
      type: contentType,  // ✅ Додано type!
      params: buildGenerationParams(preparedInput, modelConfig), // ✅ Повні параметри!
      count: Math.min(count, 500),
      created_by_user_id: user_id,
      agent_id: agentUsed,
      status: 'processing'
    }); 
    console.log('✅ Створено batch:', batchId);
  } catch (err) {
    console.error('❌ Failed to record batch:', err);
  }

  const client = new Replicate({ auth: String(token) });
  const outputs = [];
  
  // ✅ 4. Генерація контенту
  for (let i = 0; i < Math.min(count, 500); i++) {
    console.log(`[${i + 1}/${count}] Генеруємо з моделлю: ${usedModel}`);
    
    try {
      const result = await client.run(String(usedModel), { input: preparedInput });
      console.log(`✅ Replicate завершив генерацію #${i + 1}`);
      console.log('📦 Raw result type:', typeof result, Array.isArray(result));
      
      // ✅ 5. Обробка результату
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
            console.warn('⚠️ Unknown array item format:', item);
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
        console.warn('⚠️ Unknown result format, trying to stringify');
        urls.push(String(result));
      }
      
      console.log('📎 Extracted URLs:', urls);
      
      // ✅ 6. Збираємо метадані для кожного URL
      for (const url of urls) {
        if (!url || url === '[object Object]' || url === 'undefined' || url === 'null') {
          console.warn('⚠️ Skipping invalid URL:', url);
          continue;
        }
        if (!url.startsWith('http')) {
          console.warn('⚠️ Skipping non-HTTP URL:', url);
          continue;
        }
        
        outputs.push(url);
        
        // ✅ Збираємо метадані залежно від типу
        let assetMetadata = {};
        
        try {
          console.log('🔍 Збираємо метадані для:', url);
          
          if (contentType === 'image') {
            assetMetadata = await getImageMetadata(url);
          } else if (contentType === 'video') {
            assetMetadata = await getVideoMetadata(url);
            // Додаємо duration з параметрів
            const numFrames = preparedInput.num_frames || 121;
            const fps = 25; // default для LTX Video
            assetMetadata.duration = Math.round((numFrames / fps) * 10) / 10;
          } else if (contentType === 'audio') {
            assetMetadata = await getAudioMetadata(url);
            // Додаємо duration з параметрів
            assetMetadata.duration = preparedInput.duration || duration_seconds || 10;
          }
          
          console.log('✅ Метадані зібрано:', assetMetadata);
        } catch (metaError) {
          console.warn('⚠️ Не вдалось отримати metadata:', metaError.message);
          // Fallback метадані
          assetMetadata = {
            mime: contentType === 'image' ? 'image/png' : 
                  contentType === 'video' ? 'video/mp4' : 'audio/mpeg',
            width: contentType === 'image' ? 1024 : contentType === 'video' ? 1024 : null,
            height: contentType === 'image' ? 1024 : contentType === 'video' ? 576 : null,
            duration: contentType === 'video' ? 4.84 : contentType === 'audio' ? 10 : null,
            size_bytes: null
          };
        }
        
        // ✅ 7. Створюємо content з ПОВНИМИ даними
        const fullGenerationParams = buildGenerationParams(preparedInput, modelConfig);
        const description = generateDescription(enhancedPrompt, preparedInput, usedModel);
        
        try {
          const created = await createContent({ 
            type: contentType, 
            title: `${modelConfig.name} - ${originalPrompt?.substring(0, 50) || ''}${(originalPrompt && originalPrompt.length > 50) ? '...' : ''}`,
            description: description,
            text_body: null,
            // промпти
            prompt: enhancedPrompt,
            original_prompt: originalPrompt,
            enhanced_prompt: enhancedPrompt,
            // модель/агент
            model: model, 
            batch_id: batchId,
            agent_id: agentUsed,
            generation_params: { ...fullGenerationParams, agent_techniques: techniques },
            metadata: { 
              model_config: modelConfig.name,
              replicate_model: usedModel,
              content_type: contentType,
              generated_at: new Date().toISOString(),
              batchId,
              agent_used: agentUsed !== null
            }, 
            assets: [{
              url: url,
              mime: assetMetadata.mime,
              width: assetMetadata.width,
              height: assetMetadata.height,
              duration: assetMetadata.duration,
              size_bytes: assetMetadata.size_bytes,
              poster_url: assetMetadata.poster_url || null,
              ord: 0
            }] 
          });
          
          console.log(`✅ Створено content #${created.id} з повними метаданими`);
        } catch (createError) {
          console.error('❌ Failed to create content:', createError);
          throw createError;
        }
      }
    } catch (err) {
      console.error(`❌ Generation failed:`, {
        error: err.message,
        model: usedModel,
        prompt: enhancedPrompt,
        stack: err.stack,
      });
      
      // ✅ Оновлюємо batch status на failed
      try {
        await updateBatchStatus(batchId, 'failed', err.message);
      } catch (updateErr) {
        console.error('❌ Failed to update batch status:', updateErr);
      }
      
      throw err;
    }
  }
  
  // ✅ 8. Оновлюємо batch status на completed
  try {
    await updateBatchStatus(batchId, 'completed');
  } catch (updateErr) {
    console.error('❌ Failed to update batch status:', updateErr);
  }
  
  return { outputs, batchId, agent_used: agentUsed, original_prompt: originalPrompt, enhanced_prompt: enhancedPrompt };
}

/**
 * ✅ Оновлює статус batch
 */
async function updateBatchStatus(batchId, status, errorMessage = null) {
  try {
    const updateData = {
      status: status,
    };

    // Якщо є помилка - додаємо до params
    if (errorMessage) {
      updateData.params = {
        error: errorMessage,
        failed_at: new Date().toISOString()
      };
    }

    // Використовуємо db.supabase напряму
    if (db && db.supabase) {
      const { error } = await db.supabase
        .from('batches')
        .update(updateData)
        .eq('id', batchId);

      if (error) throw error;
    }

    console.log(`✅ Оновлено batch ${batchId} status:`, status);
  } catch (err) {
    console.error('❌ updateBatchStatus exception:', err);
  }
}

// ✅ Ініціалізація черг
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

// ✅ Додавання задачі в чергу
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

// ✅ Перевірка статусу задачі
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
