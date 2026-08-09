import OpenAI from 'openai';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_MODEL = 'sarvam-105b';

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
  return `You are the friendly cooking assistant for "TalknTaste" — a personal recipe library app. Users save their own recipes (often spoken in Indian languages) and they talk to YOU to explore, plan, and cook from that library.

The user has the following recipes saved in their library. Use ONLY these recipes as your source of truth about the user's recipes.

RECIPE LIBRARY:
${libraryContext}

RULES:
1. Answer in the SAME language the user writes in — if they write in Kannada, answer in Kannada; Hindi → Hindi; Tamil → Tamil; Hinglish/Kanglish code-mix → match their code-mixing; English → English. Never translate the recipe contents into a different language.
2. Give helpful, concise, practical answers: recommend what to cook, pick from the library, summarize a recipe, scale/simplify it, find substitutes, or plan a meal — always grounded in the recipes above.
3. Preserve exact recipe titles and author names when referring to specific recipes.
4. If the user asks about something NOT in the library, say so honestly and suggest the closest matching recipes from the library (or suggest they record the missing recipe).
5. You may use gentle emoji, formatted lists, and short paragraphs to make answers scannable. Keep responses reasonably short (aim under ~250 words unless the user asks for a full recipe walkthrough).
6. NEVER claim the user has a recipe that is not in the library, and do not claim you can search the internet.`;
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