import { structureRecipe } from './_lib/openai.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript, language } = req.body;

  if (!transcript) {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  try {
    const recipe = await structureRecipe(transcript, language);
    res.status(200).json({ recipe });
  } catch (error) {
    console.error('[API] Structure error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
