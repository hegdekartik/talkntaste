import { structureRecipe as openaiFallback } from './openai.js';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const MODEL = "sarvam-105b";

const systemPrompt = `You are an expert culinary assistant specializing in Indian cuisine. Given a raw spoken transcript of an Indian food recipe, extract and organize it into a structured JSON format.

CRITICAL RULES:
1. PRESERVE THE ORIGINAL LANGUAGE — If the transcript is in Kannada, keep ALL fields in Kannada. If Hindi, keep in Hindi. If Tamil, keep in Tamil. NEVER translate to English unless the original speech was in English.
Example: "Tomato chutney maadoke, 3 tomato togondi" -> Output MUST be in Kannada/Kanglish exactly as spoken.
2. For code-mixed speech (e.g., Hinglish, Kanglish), preserve the conversational code-mixing exactly as spoken.
3. Clean up speech artifacts: remove filler words (um, uh, hmm, ಅಂದ್ರೆ, मतलब), false starts, and repetitions. But keep the natural instructional flow.
4. Break instructions into clear, numbered steps. Each step should be a single distinct cooking action.
5. Extract ALL ingredients mentioned. Include preparation states in notes where mentioned (e.g., "ಸಣ್ಣಗೆ ಹೆಚ್ಚಿದ" (finely chopped)).
6. TAGS: Select exactly 3 to 5 tags from this predefined set: vegetarian, non-vegetarian, vegan, south-indian, north-indian, snack, dessert, breakfast, lunch, dinner, quick, under-30-min, slow-cook, rice, bread, curry, chutney, pickle, beverage, salad.

Output EXACTLY AND ONLY valid JSON matching this schema, with NO markdown formatting, NO code blocks, and NO additional text:
{
  "title": "Recipe title in ORIGINAL language",
  "language": "ISO 639-1 language code (e.g., kn, hi, en, ta, te)",
  "languageName": "Human-readable language name (e.g., Kannada, Hindi, English)",
  "servings": 2, // integer
  "prepTime": "Prep time in original language",
  "ingredients": [
    { "name": "Ingredient name in ORIGINAL language", "quantity": "Quantity in ORIGINAL language", "notes": "Notes in ORIGINAL language or empty string" }
  ],
  "steps": [
    { "stepNumber": 1, "instruction": "Step instruction in ORIGINAL language" }
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`;

/**
 * Clean markdown wrapping from LLM output.
 */
function cleanJSON(str) {
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '');
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '');
  if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '');
  return cleaned.trim();
}

/**
 * Structure a raw transcript into a recipe JSON using Sarvam LLM,
 * with fallback to OpenAI if parsing fails.
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

    const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Sarvam LLM] API error: ${response.status} - ${errText}`);
      throw new Error("Sarvam LLM API failed");
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error("Sarvam LLM returned empty content");
    }

    content = cleanJSON(content);
    const recipe = JSON.parse(content);
    
    // Basic validation
    if (!recipe.title || !recipe.ingredients || !recipe.steps) {
        throw new Error("Parsed JSON missing required fields");
    }

    console.log(`[Sarvam LLM] Structured recipe: "${recipe.title}" | ${recipe.ingredients.length} ingredients | ${recipe.steps.length} steps`);
    return recipe;
    
  } catch (error) {
    console.warn('[Sarvam LLM] Structuring failed or invalid JSON returned. Falling back to OpenAI.', error.message);
    
    try {
      // Fallback to OpenAI
      return await openaiFallback(transcript, languageHint);
    } catch (fallbackError) {
      console.error('[OpenAI Fallback] also failed:', fallbackError);
      throw new Error(`Recipe structuring failed in both Sarvam and OpenAI. Last error: ${fallbackError.message}`);
    }
  }
}
