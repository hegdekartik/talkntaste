import { getRecipes } from './_lib/supabase.js';

/**
 * GET /api/recipes
 * Returns the 50 most recent recipes.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const recipes = await getRecipes();
    res.status(200).json({ recipes });
  } catch (error) {
    console.error('[API] GET /recipes error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
