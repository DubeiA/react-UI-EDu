import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || null;
if (!SUPABASE_URL || !(SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY)) throw new Error('SUPABASE_URL and one of SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY are required');

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
export const db = { supabase }; // ✅ Експортуємо supabase через db для queue.js

export async function initDb() {
  // Create tables via SQL RPC if not exists (simple bootstrap)
  // Note: Supabase requires SQL via SQL editor; programmatic DDL is limited.
  // We'll upsert admin user if not exists in a simple way.
  await ensureAdmin();
}

async function ensureAdmin() {
  const { data, error } = await supabase.from('users').select('id').eq('username', 'admin').limit(1);
  if (error && error.code !== 'PGRST116') throw error;
  if (!data || data.length === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    await supabase.from('users').insert({ username: 'admin', password_hash: hash, role: 'admin' });
  }
}

export async function findUserByUsername(username) {
  const { data, error } = await supabase.from('users').select('*').eq('username', username).limit(1).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function touchSession(sessionId) {
  if (!sessionId) return;
  const now = new Date().toISOString();
  await supabase.from('sessions').upsert({ session_id: sessionId, last_seen_at: now }, { onConflict: 'session_id' });
}

// ✅ ВИПРАВЛЕНА функція recordBatch
export async function recordBatch({ 
  id, 
  prompt, 
  model, 
  count, 
  type = null,                    // ✅ ДОДАНО
  params = {},                    // ✅ ДОДАНО
  created_by_user_id = null,      // ✅ ДОДАНО
  agent_id = null,                // ✅ ДОДАНО
  status = 'processing'           // ✅ ДОДАНО
}) {
  try {
    const { data, error } = await supabase
      .from('batches')
      .upsert({
        id,
        prompt,
        model,
        type,                     // ✅ ДОДАНО
        params,                   // ✅ ДОДАНО
        count,
        created_by_user_id,       // ✅ ДОДАНО
        agent_id,                 // ✅ ДОДАНО
        status,                   // ✅ ДОДАНО
        created_at: new Date().toISOString()
      }, { 
        onConflict: 'id' 
      })
      .select()
      .single();

    if (error) {
      console.error('❌ recordBatch error:', error);
      throw error;
    }

    console.log('✅ Recorded batch:', data.id, '| type:', data.type, '| status:', data.status);
    return data;
  } catch (err) {
    console.error('❌ recordBatch exception:', err);
    throw err;
  }
}

// ✅ ВИПРАВЛЕНА функція createContent
export async function createContent({ 
  type, 
  title, 
  description, 
  text_body = null, 
  metadata = {}, 
  assets = [], 
  prompt = null, 
  model = null,
  batch_id = null,              // ✅ ДОДАНО
  generation_params = {},       // ✅ ДОДАНО
  original_prompt = null,       // ✅ ДОДАНО
  enhanced_prompt = null,       // ✅ ДОДАНО
  agent_id = null               // ✅ ДОДАНО
}) {
  // Try to persist prompt/model if columns exist; fall back to metadata-only if not
  const base = { 
    type, 
    title, 
    description, 
    text_body, 
    metadata 
  };
  
  if (prompt !== null && prompt !== undefined) base.prompt = prompt;
  if (model !== null && model !== undefined) base.model = model;
  if (batch_id !== null && batch_id !== undefined) base.batch_id = batch_id;              // ✅ ДОДАНО
  if (generation_params !== null && generation_params !== undefined) {
    base.generation_params = generation_params;                                           // ✅ ДОДАНО
  }
  if (original_prompt !== null && original_prompt !== undefined) base.original_prompt = original_prompt;
  if (enhanced_prompt !== null && enhanced_prompt !== undefined) base.enhanced_prompt = enhanced_prompt;
  if (agent_id !== null && agent_id !== undefined) base.agent_id = agent_id;

  let insertRes = await supabase.from('content').insert(base).select('*').single();
  if (insertRes.error) {
    // If schema lacks prompt/model columns, retry without them
    const errCode = insertRes.error?.code || insertRes.error?.hint || '';
    const errMsg = String(insertRes.error?.message || '').toLowerCase();
    const schemaMissing = errMsg.includes('column') && (errMsg.includes('prompt') || errMsg.includes('model') || errMsg.includes('batch_id') || errMsg.includes('generation_params') || errMsg.includes('original_prompt') || errMsg.includes('enhanced_prompt') || errMsg.includes('agent_id'));
    if (schemaMissing) {
      const fallback = { type, title, description, text_body, metadata };
      insertRes = await supabase.from('content').insert(fallback).select('*').single();
    }
  }
  const { data, error } = insertRes;
  if (error) throw error; 
  const contentId = data.id;
  
  // ✅ ВИПРАВЛЕНО: додаємо size_bytes, poster_url, ord
  for (const a of assets) {
    await supabase.from('assets').insert({ 
      content_id: contentId, 
      url: a.url, 
      mime: a.mime || null, 
      width: a.width || null, 
      height: a.height || null, 
      duration: a.duration || null,
      size_bytes: a.size_bytes || null,    // ✅ ДОДАНО
      poster_url: a.poster_url || null,    // ✅ ДОДАНО
      ord: a.ord || 0                      // ✅ ДОДАНО
    });
  }
  return getContentById(contentId);
}

export async function listContent({ page = 1, limit = 20 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, error } = await supabase.from('content').select('*').order('id', { ascending: false }).range(from, to);
  if (error) throw error;
  const items = [];
  for (const row of data) items.push(await hydrateContent(row));
  return items;
}

export async function countContent() {
  const { count, error } = await supabase.from('content').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function getContentById(id) {
  const { data, error } = await supabase.from('content').select('*').eq('id', id).single();
  if (error) return null;
  return hydrateContent(data);
}

export async function deleteContent(id) {
  await supabase.from('content').delete().eq('id', id);
}

export async function updateContent(id, data) {
  // Prepare update payload with optional prompt/model if provided
  const payload = {
    type: data.type,
    title: data.title,
    description: data.description,
    metadata: data.metadata,
  };
  if (Object.prototype.hasOwnProperty.call(data, 'prompt')) payload.prompt = data.prompt;
  if (Object.prototype.hasOwnProperty.call(data, 'model')) payload.model = data.model;
  if (Object.prototype.hasOwnProperty.call(data, 'batch_id')) payload.batch_id = data.batch_id;              // ✅ ДОДАНО
  if (Object.prototype.hasOwnProperty.call(data, 'generation_params')) payload.generation_params = data.generation_params;  // ✅ ДОДАНО
  if (Object.prototype.hasOwnProperty.call(data, 'original_prompt')) payload.original_prompt = data.original_prompt; // ✅ ДОДАНО
  if (Object.prototype.hasOwnProperty.call(data, 'enhanced_prompt')) payload.enhanced_prompt = data.enhanced_prompt; // ✅ ДОДАНО
  if (Object.prototype.hasOwnProperty.call(data, 'agent_id')) payload.agent_id = data.agent_id; // ✅ ДОДАНО

  let updateRes = await supabase.from('content').update(payload).eq('id', id).select('*').single();
  if (updateRes.error) {
    const msg = String(updateRes.error?.message || '').toLowerCase();
    const schemaMissing = msg.includes('column') && (
      msg.includes('prompt') || msg.includes('model') || msg.includes('batch_id') || msg.includes('generation_params') ||
      msg.includes('original_prompt') || msg.includes('enhanced_prompt') || msg.includes('agent_id')
    );
    if (schemaMissing) {
      // Retry without prompt/model/batch_id/generation_params keys
      const fallback = {
        type: data.type,
        title: data.title,
        description: data.description,
        metadata: data.metadata,
      };
      updateRes = await supabase.from('content').update(fallback).eq('id', id).select('*').single();
    }
  }
  const { data: updated, error } = updateRes;
  if (error) throw error; 
  if (Array.isArray(data.assets)) {
    await supabase.from('assets').delete().eq('content_id', id);
    for (const a of data.assets) {
      await supabase.from('assets').insert({ 
        content_id: id, 
        url: a.url, 
        mime: a.mime || null, 
        width: a.width || null, 
        height: a.height || null, 
        duration: a.duration || null,
        size_bytes: a.size_bytes || null,    // ✅ ДОДАНО
        poster_url: a.poster_url || null,    // ✅ ДОДАНО
        ord: a.ord || 0                      // ✅ ДОДАНО
      });
    }
  }
  return getContentById(id);
}

export async function recordRating({ contentId, rating, userId = null, sessionId = null, comment = '' }) {
  await supabase.from('ratings').insert({ content_id: contentId, user_id: userId, session_id: sessionId, rating, comment: comment || null });
  await recomputeScore(contentId);
}

export async function recomputeScore(contentId) {
  const { data, error } = await supabase.rpc('recompute_score', { p_content_id: contentId });
  if (error && error.code !== 'PGRST116') {
    // fallback if no RPC exists: compute client-side
    const agg = await supabase.from('ratings').select('rating').eq('content_id', contentId);
    if (!agg.error) {
      const ratings = agg.data.map(r => r.rating);
      const c = ratings.length;
      const avg = c ? ratings.reduce((a, b) => a + b, 0) / c : 0;
      await supabase.from('content').update({ score_mean: avg, score_count: c }).eq('id', contentId);
    }
  }
}

export async function getNextContent({ sessionId, userId = null, types = ['image','video','audio','text','combo'], order = 'desc' }) {
  const ratedBy = [];
  if (sessionId) {
    const r = await supabase.from('ratings').select('content_id').eq('session_id', sessionId);
    if (!r.error) ratedBy.push(...(r.data || []).map(x => x.content_id));
  }
  if (userId) {
    const r = await supabase.from('ratings').select('content_id').eq('user_id', userId);
    if (!r.error) ratedBy.push(...(r.data || []).map(x => x.content_id));
  }
  const exclude = Array.from(new Set(ratedBy));
  let query = supabase.from('content').select('*').in('type', types).order('id', { ascending: order === 'asc' });
  if (exclude.length) query = query.not('id', 'in', `(${exclude.join(',')})`);
  const { data, error } = await query.limit(1);
  if (error || !data || !data.length) return null;
  return hydrateContent(data[0]);
}

export async function getStats() {
  const totalContent = (await supabase.from('content').select('id', { count: 'exact', head: true })).count || 0;
  const totalRatings = (await supabase.from('ratings').select('id', { count: 'exact', head: true })).count || 0;
  const ratedDistinct = (await supabase.from('ratings').select('content_id', { count: 'exact', head: true, distinct: true })).count || 0;
  const pendingGlobal = Math.max(0, (totalContent || 0) - (ratedDistinct || 0));
  const top = (await supabase.from('content').select('*').gte('score_count', 1).order('score_mean', { ascending: false }).order('score_count', { ascending: false }).limit(5)).data || [];
  const worst = (await supabase.from('content').select('*').gte('score_count', 1).order('score_mean', { ascending: true }).order('score_count', { ascending: false }).limit(5)).data || [];
  const hydrateArr = async (arr) => Promise.all((arr || []).map(hydrateContent));
  return { totalContent, totalRatings, ratedDistinct, pendingGlobal, top: await hydrateArr(top), worst: await hydrateArr(worst) };
}

export async function getSummaryCounts({ sessionId, userId = null }) {
  const total = (await supabase.from('content').select('id', { count: 'exact', head: true })).count || 0;
  let rated = 0;
  if (userId && sessionId) {
    rated = (await supabase.from('ratings').select('content_id', { count: 'exact', head: true }).or(`user_id.eq.${userId},session_id.eq.${sessionId}`)).count || 0;
  } else if (userId) {
    rated = (await supabase.from('ratings').select('content_id', { count: 'exact', head: true }).eq('user_id', userId)).count || 0;
  } else if (sessionId) {
    rated = (await supabase.from('ratings').select('content_id', { count: 'exact', head: true }).eq('session_id', sessionId)).count || 0;
  }
  const pending = Math.max(0, (total || 0) - (rated || 0));
  return { total, rated, pending };
}

async function hydrateContent(row) {
  const assets = (await supabase.from('assets').select('*').eq('content_id', row.id).order('ord', { ascending: true })).data || [];
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    text_body: row.text_body,
    prompt: row.prompt ?? (row.metadata ? row.metadata.prompt : undefined),
    model: row.model ?? (row.metadata ? row.metadata.model : undefined),
    original_prompt: row.original_prompt ?? null,
    enhanced_prompt: row.enhanced_prompt ?? null,
    agent_id: row.agent_id ?? null,
    batch_id: row.batch_id,              // ✅ ДОДАНО
    generation_params: row.generation_params || {},  // ✅ ДОДАНО
    metadata: row.metadata || {},
    score_mean: row.score_mean,
    score_count: row.score_count,
    created_at: row.created_at,
    assets,
    url: assets?.[0]?.url,
  };
}
