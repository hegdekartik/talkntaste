import { synthesizeSpeech } from './_lib/tts.js';

export const config = {
  maxDuration: 60,
};

/**
 * POST /api/tts
 * Synthesize a chat reply into speech (Sarvam Bulbul v3, mp3).
 *
 * Request body: { "text": "...", "language": "kn-IN" }
 * Response:    { "audioBase64": "...", "contentType": "audio/mpeg", "language": "kn-IN" }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const language = typeof req.body?.language === 'string' ? req.body.language : '';

  if (!text) {
    return res.status(400).json({ error: 'Request must include a "text" string.' });
  }

  try {
    const result = await synthesizeSpeech({ text, language });
    console.log(`[API] /tts synthesized (${result.language}, speaker ${result.speaker}, ${(result.audioBase64.length * 3) / 4} bytes)`);
    res.status(200).json(result);
  } catch (error) {
    console.error('[API] /tts error:', error.message);
    res.status(500).json({ error: error.message });
  }
}