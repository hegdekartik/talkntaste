import OpenAI from 'openai';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
// "conversations" variant is post-trained for real-time dialogue / voice-agent workloads.
const SARVAM_MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations';

const MAX_CONTEXT_RECIPES = 50;

/**
 * Compact a recipe into a small, token-friendly text block for the model.
 */
function compactRecipe(recipe) {
  const parts = [];

  const title = recipe.title || 'Untitled recipe';
  const lang = recipe.language_name || recipe.language || 'unknown';
  const author = recipe.author_name && !recipe.author_name.startsWith('Anon-')
    ? recipe.author_name
    : null;

  const metaBits = [];
  if (recipe.servings) metaBits.push(`servings: ${recipe.servings}`);
  if (recipe.prep_time) metaBits.push(`prep time: ${recipe.prep_time}`);
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  if (tags.length) metaBits.push(`tags: ${tags.join(', ')}`);

  const header = `«${title}» (${lang})${author ? ` by ${author}` : ''}`;
  parts.push(`${header}${metaBits.length ? ` — ${metaBits.join(' · ')}` : ''}`);

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length) {
    const ingText = ingredients
      .map((i) => {
        let t = `${i.name || ''}`;
        if (i.quantity) t = `${i.quantity} ${t}`.trim();
        if (i.notes) t = `${t} (${i.notes})`;
        return t;
      })
      .join(', ');
    parts.push(`Ingredients: ${ingText}`);
  }

  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  if (steps.length) {
    const stepText = steps
      .map((s) => `${s.stepNumber || ''}. ${s.instruction || ''}`)
      .join(' ');
    parts.push(`Steps: ${stepText}`);
  }

  if (recipe.additional_info) {
    parts.push(`Story/notes: ${recipe.additional_info}`);
  }

  return parts.join('\n');
}

/**
 * Serialize the full recipe library into a compact context block.
 */
function serializeLibrary(recipes) {
  if (!recipes || recipes.length === 0) {
    return 'The user\'s recipe library is currently empty.';
  }

  const blocks = recipes.slice(0, MAX_CONTEXT_RECIPES).map(compactRecipe);
  return blocks.map((b, i) => `${i + 1}. ${b}`).join('\n\n');
}

function buildSystemPrompt(libraryContext) {
  return `You are "Head Chef", the friendly cooking co-pilot for TalknTaste — a personal recipe library app. Users save their own recipes (often spoken in Indian languages) and they talk to YOU by voice while they cook. Your job is to guide them step by step, out loud, like a kind chef standing beside them in the kitchen.

The user has the following recipes saved in their library. Use ONLY these recipes as your source of truth about the user's recipes.

RECIPE LIBRARY:
${libraryContext}

RULES:
1. Answer in the SAME language the user speaks — Kannada → Kannada, Hindi → Hindi, Tamil → Tamil, Bangla → Bangla, Hinglish/Kanglish code-mix → match their code-mixing, English → English. Never switch the recipe contents to another language.
2. YOUR RESPONSES ARE SPOKEN OUT LOUD BY A TEXT-TO-SPEECH ENGINE. Write for the ear, not the eye:
   - Use short, breathable sentences.
   - NO markdown (no asterisks, bold, bullets, hashes, or code blocks).
   - NO emojis.
   - In math symbols are fine, but avoid decorative symbols.
   - Use natural pauses — commas, full stops, and occasionally an ellipsis (…) for gentle hesitancy.
3. When the user asks how to make a dish (e.g. "paneer bhurji"): start warmly and announce the plan, then give the ingredients FIRST, like this: "I will be helping you to prepare it. First, here are the things you will need..." then list them, then continue step by step on request.
4. Break long instructions into separate turns. After giving a short chunk (e.g. the ingredients or step one), pause and ask a follow-up like "Ready for the next step?" or "Should I move on?" — guiding the cook through ONE step at a time.
5. You may also help with practical kitchen questions: ingredient substitutes, quantities, cook times, quick meal plans, scaling recipes, or picking what to cook — always grounded in the recipes above.
6. Preserve exact recipe titles and author names when referring to specific recipes.
7. If the user asks about something NOT in the library, say so honestly and suggest the closest matching recipes from the library (or suggest they record the missing recipe).
8. NEVER claim the user has a recipe that is not in the library, and do not claim you can search the internet.
9. Keep each reply around 3 to 6 short spoken sentences (fewer than ~140 words) unless the user explicitly asks for the full walkthrough.`;
}

/**
 * Send a chat message grounded in the recipe library.
 *
 * @param {object} params
 * @param {object[]} params.messages - Chat history: [{role, content}, ...]
 * @param {Array} params.recipes - Recipe rows from Supabase
 * @returns {Promise<{ reply: string, provider: string }>}
 */
export async function chatWithLibrary({ messages, recipes }) {
  const libraryContext = serializeLibrary(recipes);
  const systemMessage = { role: 'system', content: buildSystemPrompt(libraryContext) };

  // Keep the last 12 turns of history to bound token usage.
  const history = Array.isArray(messages) ? messages.slice(-12) : [];
  const payload = [systemMessage, ...history];

  // ---- Primary: Sarvam ----
  try {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': SARVAM_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: SARVAM_MODEL,
        messages: payload,
        temperature: 0.4,
        max_tokens: 4096,
        reasoning_effort: null,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam chat API error: ${response.status} - ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply || !reply.trim()) {
      throw new Error('Sarvam chat returned empty content');
    }

    return { reply: reply.trim(), provider: 'sarvam' };
  } catch (sarvamError) {
    console.warn('[Chat] Sarvam failed, falling back to OpenAI.', sarvamError.message);
    return chatWithOpenAIFallback(payload);
  }
}

/**
 * Fallback chat via OpenAI (GPT-4o-mini), mirroring the recipe pipeline's fallback pattern.
 */
async function chatWithOpenAIFallback(payload) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: payload,
    temperature: 0.4,
    max_tokens: 2048,
  });

  const reply = response.choices?.[0]?.message?.content;
  if (!reply || !reply.trim()) {
    throw new Error('OpenAI chat returned empty content');
  }
  return { reply: reply.trim(), provider: 'openai' };
}