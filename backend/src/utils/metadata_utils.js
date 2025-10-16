// backend/src/utils/metadata_utils.js - ES Modules версія

import axios from 'axios';
import probe from 'probe-image-size';

/**
 * Отримує повні метадані для image URL
 * @param {string} url - URL зображення
 * @returns {Promise<Object>} - { width, height, mime, size_bytes }
 */
export async function getImageMetadata(url) {
  try {
    console.log('🔍 Аналізую image:', url);

    // 1. Отримуємо розміри через probe-image-size (швидко, без завантаження)
    const dimensions = await probe(url);

    // 2. Отримуємо size через HEAD request
    const headResponse = await axios.head(url, { timeout: 5000 });
    const sizeBytes = parseInt(headResponse.headers['content-length']) || null;

    return {
      width: dimensions.width,
      height: dimensions.height,
      mime: dimensions.mime || 'image/png',
      size_bytes: sizeBytes
    };
  } catch (error) {
    console.warn('⚠️ Не вдалось отримати image metadata:', error.message);
    // Fallback - повертаємо хоча б MIME type
    return {
      width: null,
      height: null,
      mime: guessMimeFromUrl(url),
      size_bytes: null
    };
  }
}

/**
 * Отримує метадані для video URL
 * @param {string} url - URL відео
 * @returns {Promise<Object>} - { width, height, duration, mime, size_bytes, poster_url }
 */
export async function getVideoMetadata(url) {
  try {
    console.log('🔍 Аналізую video:', url);

    // Отримуємо розмір файлу
    const headResponse = await axios.head(url, { timeout: 5000 });
    const sizeBytes = parseInt(headResponse.headers['content-length']) || null;

    // Для відео - використовуємо дефолтні значення якщо не можемо отримати точні
    // (для точного аналізу потрібно завантажувати файл і використовувати ffprobe)
    return {
      width: 1024, // default для LTX Video
      height: 576, // default для LTX Video
      duration: null, // заповниться з generation_params
      mime: 'video/mp4',
      size_bytes: sizeBytes,
      poster_url: null // можна згенерувати через Replicate або Cloudinary
    };
  } catch (error) {
    console.warn('⚠️ Не вдалось отримати video metadata:', error.message);
    return {
      width: 1024,
      height: 576,
      duration: null,
      mime: 'video/mp4',
      size_bytes: null,
      poster_url: null
    };
  }
}

/**
 * Отримує метадані для audio URL
 * @param {string} url - URL аудіо
 * @returns {Promise<Object>} - { duration, mime, size_bytes }
 */
export async function getAudioMetadata(url) {
  try {
    console.log('🔍 Аналізую audio:', url);

    // Отримуємо розмір файлу
    const headResponse = await axios.head(url, { timeout: 5000 });
    const sizeBytes = parseInt(headResponse.headers['content-length']) || null;

    return {
      duration: null, // заповниться з generation_params
      mime: guessMimeFromUrl(url, 'audio'),
      size_bytes: sizeBytes
    };
  } catch (error) {
    console.warn('⚠️ Не вдалось отримати audio metadata:', error.message);
    return {
      duration: null,
      mime: 'audio/mpeg',
      size_bytes: null
    };
  }
}

/**
 * Визначає MIME type з URL
 */
export function guessMimeFromUrl(url, defaultType = 'image') {
  const lowerUrl = url.toLowerCase();

  // Images
  if (lowerUrl.includes('.png')) return 'image/png';
  if (lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg')) return 'image/jpeg';
  if (lowerUrl.includes('.webp')) return 'image/webp';
  if (lowerUrl.includes('.gif')) return 'image/gif';

  // Videos
  if (lowerUrl.includes('.mp4')) return 'video/mp4';
  if (lowerUrl.includes('.webm')) return 'video/webm';
  if (lowerUrl.includes('.mov')) return 'video/quicktime';

  // Audio
  if (lowerUrl.includes('.mp3')) return 'audio/mpeg';
  if (lowerUrl.includes('.wav')) return 'audio/wav';
  if (lowerUrl.includes('.ogg')) return 'audio/ogg';
  if (lowerUrl.includes('.m4a')) return 'audio/mp4';

  // Defaults
  if (defaultType === 'image') return 'image/png';
  if (defaultType === 'video') return 'video/mp4';
  if (defaultType === 'audio') return 'audio/mpeg';

  return 'application/octet-stream';
}

/**
 * Генерує детальний description на основі промпту та параметрів
 */
export function generateDescription(prompt, params, model) {
  const parts = [prompt];

  if (params.aspect_ratio) {
    parts.push(`Aspect ratio: ${params.aspect_ratio}`);
  }

  if (params.num_inference_steps) {
    parts.push(`Steps: ${params.num_inference_steps}`);
  }

  if (params.guidance_scale) {
    parts.push(`Guidance: ${params.guidance_scale}`);
  }

  if (params.num_frames) {
    parts.push(`Frames: ${params.num_frames}`);
  }

  if (params.duration) {
    parts.push(`Duration: ${params.duration}s`);
  }

  if (model) {
    const modelName = model.split('/').pop().split(':')[0];
    parts.push(`Model: ${modelName}`);
  }

  return parts.join(' | ');
}

/**
 * Створює повний об'єкт generation_params
 */
export function buildGenerationParams(inputParams, modelConfig) {
  return {
    // Параметри з input
    ...inputParams,
    
    // Додаємо model info
    model_version: modelConfig.model,
    model_name: modelConfig.name || modelConfig.model.split('/')[1],
    
    // Timestamp генерації
    generated_at: new Date().toISOString(),
    
    // Replicate metadata (якщо доступно)
    replicate_version: modelConfig.model.split(':')[1] || 'latest'
  };
}
