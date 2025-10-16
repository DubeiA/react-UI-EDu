-- Enable required extension for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========================================
-- 1. ТАБЛИЦЯ АГЕНТІВ
-- ========================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- 'image', 'video', 'audio', 'text'
  description TEXT,
  model TEXT NOT NULL DEFAULT 'gpt-4o', -- LLM модель для агента
  system_prompt TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);

-- ========================================
-- 2. ТАБЛИЦЯ ПАМ'ЯТІ АГЕНТА (що він навчився)
-- ========================================
CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  content_id BIGINT REFERENCES content(id) ON DELETE SET NULL,
  original_prompt TEXT NOT NULL,
  enhanced_prompt TEXT NOT NULL,
  rating INTEGER,
  analysis JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_rating ON agent_memories(rating);

-- ========================================
-- 3. РОЗШИРЮЄМО CONTENT ТАБЛИЦЮ
-- ========================================
ALTER TABLE content 
ADD COLUMN IF NOT EXISTS original_prompt TEXT,
ADD COLUMN IF NOT EXISTS enhanced_prompt TEXT,
ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- ========================================
-- 4. SEED - Створюємо початкових агентів
-- (id автоматичні, дублікати по name не створюємо)
-- ========================================
INSERT INTO agents (name, type, description, model, system_prompt, config)
SELECT * FROM (
  VALUES
  (
    'Image Master Pro',
    'image',
    'Expert in crafting detailed, cinematic image prompts',
    'gpt-4o',
    'You are an expert prompt engineer for image generation (FLUX, Stable Diffusion).

Your task: Transform simple prompts into detailed, professional descriptions.

RULES:
- Maintain core subject and intent
- Add visual details: lighting, composition, style, mood
- Use cinematic/artistic terminology
- Keep it concise (100-150 words)
- Focus on what makes images visually stunning

EXAMPLE:
Input: "cat on a windowsill"
Output: "A fluffy orange tabby cat perched gracefully on a sunlit wooden windowsill, soft afternoon light streaming through vintage lace curtains, creating gentle shadows. The cat gazes contemplatively outside, whiskers backlit, creating a serene, nostalgic atmosphere. Shot with shallow depth of field, warm color palette, natural lighting, photorealistic detail."

Respond ONLY with the enhanced prompt, no explanations.',
    '{"temperature": 0.8, "max_tokens": 300}'::jsonb
  ),
  (
    'Video Director',
    'video',
    'Specializes in cinematic video prompts with motion and flow',
    'gpt-4o',
    'You are an expert prompt engineer for video generation (LTX Video, Runway).

Your task: Transform simple descriptions into cinematic video prompts with clear motion.

RULES:
- Describe camera movement and subject motion
- Include temporal flow (beginning → end)
- Add atmospheric and mood details
- Keep it focused (80-120 words)
- Emphasize what MOVES and HOW

EXAMPLE:
Input: "waves on beach"
Output: "Gentle ocean waves roll steadily toward a pristine sandy beach at golden hour, the camera slowly panning right along the shoreline. Foam spreads across wet sand as each wave recedes, leaving glistening patterns. Soft orange sunlight reflects off the water surface, creating a peaceful, meditative rhythm. The motion is continuous and calming, with subtle depth and natural lighting throughout."

Respond ONLY with the enhanced prompt, no explanations.',
    '{"temperature": 0.8, "max_tokens": 250}'::jsonb
  ),
  (
    'Audio Composer',
    'audio',
    'Creates rich audio and music generation prompts',
    'gpt-4o',
    'You are an expert prompt engineer for audio/music generation (Lyria-2, MusicGen).

Your task: Transform simple descriptions into detailed audio prompts.

RULES:
- Specify genre, instruments, tempo, mood
- Use musical terminology
- Describe sound textures and layers
- Keep it clear (60-100 words)
- Focus on auditory experience

EXAMPLE:
Input: "calm piano music"
Output: "Gentle solo piano piece in a minor key, slow tempo (60 BPM), with soft reverb creating an intimate atmosphere. Melodic phrases flow smoothly with occasional sustain pedal, evoking quiet contemplation and peaceful solitude. Minimal arrangement, warm tone, suitable for meditation or focus."

Respond ONLY with the enhanced prompt, no explanations.',
    '{"temperature": 0.7, "max_tokens": 200}'::jsonb
  )
) AS v(name, type, description, model, system_prompt, config)
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.name = v.name
);

-- ========================================
-- 5. ФУНКЦІЯ ДЛЯ ОТРИМАННЯ INSIGHTS АГЕНТА
-- ========================================
CREATE OR REPLACE FUNCTION get_agent_insights(p_agent_id UUID)
RETURNS TABLE (
  total_memories INTEGER,
  liked_count INTEGER,
  disliked_count INTEGER,
  common_liked_patterns TEXT[],
  common_disliked_patterns TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN rating = 1 THEN 1 END) as likes,
      COUNT(CASE WHEN rating = -1 THEN 1 END) as dislikes
    FROM agent_memories
    WHERE agent_id = p_agent_id
  ),
  liked_elements AS (
    SELECT DISTINCT jsonb_array_elements_text(analysis->'liked_elements') as element
    FROM agent_memories
    WHERE agent_id = p_agent_id AND rating = 1
    LIMIT 10
  ),
  disliked_elements AS (
    SELECT DISTINCT jsonb_array_elements_text(analysis->'disliked_elements') as element
    FROM agent_memories
    WHERE agent_id = p_agent_id AND rating = -1
    LIMIT 10
  )
  SELECT 
    s.total::INTEGER,
    s.likes::INTEGER,
    s.dislikes::INTEGER,
    ARRAY(SELECT element FROM liked_elements) as common_liked_patterns,
    ARRAY(SELECT element FROM disliked_elements) as common_disliked_patterns
  FROM stats s;
END;
$$ LANGUAGE plpgsql;


