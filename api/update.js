import { updateRecipe } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.setHeader('Allow', ['POST', 'PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, recipe } = req.body || {};

  if (!id || !recipe) {
    return res.status(400).json({ error: 'Missing recipe id or recipe payload' });
  }

  try {
    await updateRecipe(id, { recipe });
    res.status(200).json({ success: true, recipeId: id });
  } catch (error) {
    console.error('[API] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
