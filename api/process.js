import { parseMultipart, cleanupFile } from './_lib/parseMultipart.js';
import { transcribeAudio } from './_lib/sarvam.js';
import { structureRecipe } from './_lib/openai.js';
import { saveRecipe } from './_lib/supabase.js';

/**
 * Vercel Serverless Function config:
 * - Disable the default body parser so we can handle multipart/form-data manually via busboy.
 * - Extend maxDuration to 120s to allow batch transcription polling for long audio (>30s).
 *   Requires Vercel Pro plan (Hobby is limited to 10s).
 */
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 120,
};

/**
 * POST /api/process
 * Full pipeline: audio file → transcript (Sarvam) → structured recipe JSON (OpenAI).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let filePath;

  try {
    const { filePath: tmpPath, originalName } = await parseMultipart(req);
    filePath = tmpPath;

    console.log(`[API] Full pipeline: ${originalName}`);

    // Step 1: Transcribe
    const { transcript, language } = await transcribeAudio(filePath, originalName);

    if (!transcript) {
      return res.status(422).json({
        error: 'Could not extract any text from the audio. Please try again with clearer audio.',
      });
    }

    // Step 2: Structure
    const recipe = await structureRecipe(transcript, language);

    // Step 3: Save to Supabase (fire-and-forget — don't block response)
    const recipeId = await saveRecipe({
      recipe,
      transcript,
      language,
      audioFilePath: filePath,
      originalName,
    });

    res.status(200).json({
      transcript,
      detectedLanguage: language,
      recipe,
      recipeId: recipeId || null,
    });
  } catch (error) {
    console.error('[API] Process error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupFile(filePath);
  }
}
