import { structureRecipe } from './_lib/openai.js';

/**
 * POST /api/structure
 * Accepts a JSON body with { transcript, language }, returns structured recipe JSON via OpenAI.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript, language } = req.body;

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid transcript text' });
  }

  try {
    console.log(`[API] Structure request: ${transcript.substring(0, 80)}...`);

    const recipe = await structureRecipe(transcript, language);
    res.status(200).json(recipe);
  } catch (error) {
    console.error('[API] Structure error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
