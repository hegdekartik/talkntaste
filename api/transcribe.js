import { parseMultipart, cleanupFile } from './_lib/parseMultipart.js';
import { transcribeAudio } from './_lib/sarvam.js';

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
 * POST /api/transcribe
 * Accepts an audio file (multipart/form-data), returns raw transcript via Sarvam STT.
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

    console.log(`[API] Transcribe request: ${originalName}`);

    const result = await transcribeAudio(filePath, originalName);
    res.status(200).json(result);
  } catch (error) {
    console.error('[API] Transcribe error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupFile(filePath);
  }
}
