import { saveRecipe } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipe, transcript, language, audioPath, originalName } = req.body;

  if (!recipe || !transcript) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  try {
    const recipeId = await saveRecipe({
      recipe,
      transcript,
      language,
      audioPath,
      originalName,
    });
    res.status(200).json({ recipeId });
  } catch (error) {
    console.error('[API] Save error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
