import OpenAI from 'openai';
import { supabase } from '../db_supabase.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

export async function getAgentByType(contentType) {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('type', contentType)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (error) {
    console.warn(`⚠️ Agent not found for type ${contentType}, using fallback`);
    return null;
  }

  return data;
}

export async function getAllActiveAgents() {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('is_active', true)
    .order('type', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function enhancePrompt(originalPrompt, contentType, agentId = null) {
  try {
    console.log(`🤖 Enhancing prompt for type: ${contentType}`);

    let agent;
    if (agentId) {
      const { data } = await supabase.from('agents').select('*').eq('id', agentId).single();
      agent = data;
    } else {
      agent = await getAgentByType(contentType);
    }

    if (!agent) {
      console.warn('⚠️ No agent found, using original prompt');
      return {
        enhanced_prompt: originalPrompt,
        agent_id: null,
        techniques_used: []
      };
    }

    const insights = await getAgentInsights(agent.id);
    const contextPrompt = buildContextFromInsights(insights, originalPrompt);

    console.log('📚 Agent insights:', {
      total_memories: insights?.total_memories || 0,
      liked_count: insights?.liked_count || 0
    });

    const messages = [
      { role: 'system', content: agent.system_prompt }
    ];

    if (contextPrompt) {
      messages.push({ role: 'system', content: contextPrompt });
    }

    messages.push({ role: 'user', content: originalPrompt });

    const config = agent.config || {};
    const completion = await openai.chat.completions.create({
      model: agent.model || 'gpt-4o',
      messages,
      temperature: config.temperature || 0.7,
      max_tokens: config.max_tokens || 300
    });

    const enhancedPrompt = completion.choices[0].message.content.trim();

    console.log('✅ Prompt enhanced:', {
      original_length: originalPrompt.length,
      enhanced_length: enhancedPrompt.length,
      agent: agent.name
    });

    return {
      enhanced_prompt: enhancedPrompt,
      agent_id: agent.id,
      agent_name: agent.name,
      techniques_used: extractTechniques(originalPrompt, enhancedPrompt)
    };

  } catch (error) {
    console.error('❌ Error enhancing prompt:', error);
    return {
      enhanced_prompt: originalPrompt,
      agent_id: null,
      techniques_used: [],
      error: error.message
    };
  }
}

async function getAgentInsights(agentId) {
  try {
    const { data, error } = await supabase
      .rpc('get_agent_insights', { p_agent_id: agentId });

    if (error) {
      console.warn('⚠️ Could not fetch agent insights:', error.message);
      return null;
    }

    return data?.[0] || null;
  } catch (err) {
    console.warn('⚠️ Error fetching insights:', err.message);
    return null;
  }
}

function buildContextFromInsights(insights, originalPrompt) {
  if (!insights || insights.total_memories === 0) {
    return null;
  }

  const parts = ['\n--- LEARNING CONTEXT ---'];
  parts.push(`You have generated ${insights.total_memories} prompts before.`);
  parts.push(`Success rate: ${insights.liked_count} liked, ${insights.disliked_count} disliked.`);

  if (insights.common_liked_patterns?.length > 0) {
    parts.push('\nUSERS LIKED when you used:');
    insights.common_liked_patterns.slice(0, 5).forEach(pattern => {
      parts.push(`- ${pattern}`);
    });
  }

  if (insights.common_disliked_patterns?.length > 0) {
    parts.push('\nUSERS DISLIKED when you used:');
    insights.common_disliked_patterns.slice(0, 5).forEach(pattern => {
      parts.push(`- ${pattern}`);
    });
  }

  parts.push('\nApply this learning to the current prompt.');

  return parts.join('\n');
}

function extractTechniques(original, enhanced) {
  const techniques = [];
  if (enhanced.length > original.length * 2) {
    techniques.push('detailed_expansion');
  }
  const keywords = [
    { pattern: /cinematic|camera|shot|angle/i, name: 'cinematic_language' },
    { pattern: /light|lighting|glow|illuminat/i, name: 'lighting_details' },
    { pattern: /atmospher|mood|feeling|emotion/i, name: 'emotional_tone' },
    { pattern: /color|palette|hue|tone/i, name: 'color_description' },
    { pattern: /texture|detail|surface/i, name: 'texture_details' },
    { pattern: /motion|movement|flowing|moving/i, name: 'motion_description' }
  ];
  keywords.forEach(({ pattern, name }) => {
    if (pattern.test(enhanced) && !pattern.test(original)) {
      techniques.push(name);
    }
  });
  return techniques;
}

export async function analyzeRatingFeedback(contentId, rating, userId = null) {
  try {
    console.log(`🔍 Analyzing feedback for content ${contentId}, rating: ${rating}`);

    const { data: content, error: contentError } = await supabase
      .from('content')
      .select('*, assets(*)')
      .eq('id', contentId)
      .single();

    if (contentError || !content?.agent_id) {
      console.warn('⚠️ No agent_id in content, skipping analysis');
      return;
    }

    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('id', content.agent_id)
      .single();

    if (!agent) return;

    const analysis = await analyzePromptEffectiveness(
      content.original_prompt || content.prompt,
      content.enhanced_prompt || content.prompt,
      rating,
      agent
    );

    console.log('📊 Analysis result:', analysis);

    await supabase.from('agent_memories').insert({
      agent_id: agent.id,
      content_id: contentId,
      original_prompt: content.original_prompt || content.prompt,
      enhanced_prompt: content.enhanced_prompt || content.prompt,
      rating: rating,
      analysis: analysis
    });

    console.log('✅ Agent learned from feedback');

  } catch (error) {
    console.error('❌ Error analyzing feedback:', error);
  }
}

async function analyzePromptEffectiveness(originalPrompt, enhancedPrompt, rating, agent) {
  try {
    const ratingText = rating === 1 ? 'LIKED (positive)' : 'DISLIKED (negative)';

    const analysisPrompt = `Analyze this prompt engineering result:

ORIGINAL PROMPT: "${originalPrompt}"

ENHANCED PROMPT: "${enhancedPrompt}"

USER RATING: ${ratingText}

Task: Identify what worked well or poorly in the enhancement.

Respond in JSON format:
{
  "liked_elements": ["element1", "element2"],
  "disliked_elements": ["element1", "element2"],
  "techniques_used": ["technique1", "technique2"],
  "improvement_notes": "brief note about what to improve"
}

Focus on specific words, phrases, or techniques that likely influenced the rating.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert at analyzing prompt engineering effectiveness.' },
        { role: 'user', content: analysisPrompt }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const analysisText = completion.choices[0].message.content;
    return JSON.parse(analysisText);

  } catch (error) {
    console.error('❌ Error in LLM analysis:', error);
    return {
      liked_elements: rating === 1 ? ['effective enhancement'] : [],
      disliked_elements: rating === -1 ? ['ineffective enhancement'] : [],
      techniques_used: [],
      improvement_notes: 'Automatic analysis failed'
    };
  }
}

export async function generateMultipleVariants(originalPrompt, contentType, count = 5) {
  const agent = await getAgentByType(contentType);
  if (!agent) {
    return Array(count).fill(originalPrompt);
  }
  const variants = [];
  for (let i = 0; i < count; i++) {
    const { enhanced_prompt } = await enhancePrompt(originalPrompt, contentType, agent.id);
    variants.push(enhanced_prompt);
  }
  return variants;
}


