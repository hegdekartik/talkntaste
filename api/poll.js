import { checkBatchJob } from './_lib/sarvam.js';
import { structureRecipe } from './_lib/openai.js';
import { saveRecipe } from './_lib/supabase.js';

/**
 * POST /api/poll
 * Polling endpoint for long audio processed via Sarvam Batch API.
 * Request body: { jobId, audioPath, originalName }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId, audioPath, originalName } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId' });
  }

  try {
    const jobResult = await checkBatchJob(jobId);

    if (jobResult.status === 'processing') {
      return res.status(202).json({ status: 'processing' });
    }

    const { transcript, language } = jobResult;

    if (!transcript) {
      return res.status(422).json({
        error: 'Could not extract any text from the audio. Please try again with clearer audio.',
      });
    }

    // Step 2: Structure
    const recipe = await structureRecipe(transcript, language);

    // Step 3: Save to Supabase (using the audioPath already uploaded in step 1)
    const recipeId = await saveRecipe({
      recipe,
      transcript,
      language,
      audioPath,
      originalName,
    });

    res.status(200).json({
      status: 'completed',
      transcript,
      detectedLanguage: language,
      recipe,
      recipeId: recipeId || null,
    });
  } catch (error) {
    console.error('[API] Poll error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
