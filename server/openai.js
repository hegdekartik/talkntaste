import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * The JSON schema for structured recipe output.
 * GPT-4o-mini will strictly adhere to this schema.
 */
const recipeSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Recipe title in the ORIGINAL language of the transcript',
    },
    language: {
      type: 'string',
      description: 'ISO 639-1 language code detected from the transcript (e.g., kn, hi, en, ta, te)',
    },
    languageName: {
      type: 'string',
      description: 'Human-readable language name (e.g., Kannada, Hindi, English, Tamil, Telugu)',
    },
    servings: {
      type: 'integer',
      description: 'Number of servings. Infer from context if not explicitly stated.',
    },
    prepTime: {
      type: 'string',
      description: 'Preparation/cooking time in the original language (e.g., "45 ನಿಮಿಷ", "45 मिनट", "45 minutes")',
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Ingredient name in the ORIGINAL language',
          },
          quantity: {
            type: 'string',
            description: 'Quantity with unit in the ORIGINAL language',
          },
          notes: {
            type: 'string',
            description: 'Optional preparation notes in the ORIGINAL language (e.g., "ತೊಳೆದು", "कटा हुआ")',
          },
        },
        required: ['name', 'quantity'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepNumber: {
            type: 'integer',
          },
          instruction: {
            type: 'string',
            description: 'Step instruction in the ORIGINAL language of the transcript',
          },
        },
        required: ['stepNumber', 'instruction'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'language', 'languageName', 'servings', 'prepTime', 'ingredients', 'steps'],
  additionalProperties: false,
};

const systemPrompt = `You are a recipe structuring assistant. Given a spoken recipe transcript, extract and organize it into a structured JSON format.

CRITICAL RULES:
1. PRESERVE THE ORIGINAL LANGUAGE — If the transcript is in Kannada, keep ALL fields in Kannada. If Hindi, keep in Hindi. If Tamil, keep in Tamil. NEVER translate to English unless the original speech was in English.
2. For code-mixed speech (e.g., Hinglish, Kanglish), preserve the code-mixing as spoken.
3. Clean up speech artifacts: remove filler words (um, uh, hmm, ಅಂದ್ರೆ, मतलब), false starts, and repetitions. But keep the natural phrasing.
4. If the speaker doesn't mention servings or prep time, make a reasonable inference based on the recipe type and ingredients.
5. Break instructions into clear, numbered steps. Each step should be a single cooking action.
6. Extract ALL ingredients mentioned, including oils, water, salt, and garnishes.
7. Include preparation notes for ingredients where mentioned (e.g., "chopped", "soaked overnight").
8. Keep quantities as spoken — don't convert between metric and imperial.`;

/**
 * Structure a raw transcript into a recipe JSON using GPT-4o-mini.
 *
 * @param {string} transcript - Raw transcript text from Sarvam STT
 * @param {string} [languageHint] - Optional language hint from Sarvam
 * @returns {Promise<object>} Structured recipe JSON
 */
export async function structureRecipe(transcript, languageHint) {
  try {
    let userMessage = `Here is a spoken recipe transcript. Structure it into a recipe.\n\nTranscript:\n"${transcript}"`;

    if (languageHint && languageHint !== 'unknown') {
      userMessage += `\n\n(Detected language from audio: ${languageHint})`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'recipe',
          strict: true,
          schema: recipeSchema,
        },
      },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const recipe = JSON.parse(response.choices[0].message.content);

    console.log(`[OpenAI] Structured recipe: "${recipe.title}" | ${recipe.ingredients.length} ingredients | ${recipe.steps.length} steps`);

    return recipe;
  } catch (error) {
    console.error('[OpenAI] Structuring error:', error?.message || error);
    throw new Error(`Recipe structuring failed: ${error?.message || 'Unknown error'}`);
  }
}
