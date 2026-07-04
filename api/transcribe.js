import fs from 'fs';
import { transcribeAudio } from './_lib/sarvam.js';
import { downloadAudio } from './_lib/supabase.js';
import { getRawBody } from './getRawBody.js';

export const config = {
  maxDuration: 120,
};

/**
 * POST /api/transcribe
 * Accepts JSON { storagePath, originalName }, downloads the file from Supabase, and returns raw transcript via Sarvam STT.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Client is out of date. Please hard refresh (Cmd/Ctrl + Shift + R) your browser to load the latest version.' });
  }

  let filePath;

  try {
    let body = req.body;
    if (!body) {
      body = await getRawBody(req);
    }
    if (body instanceof Buffer) body = body.toString('utf8');
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    const { storagePath, originalName } = body || {};

    if (!storagePath) {
      return res.status(400).json({ error: 'Missing storagePath' });
    }

    console.log(`[API] Transcribe request: ${originalName}, path: ${storagePath}`);

    filePath = await downloadAudio(storagePath);
    
    const result = await transcribeAudio(filePath, originalName);
    res.status(200).json(result);
  } catch (error) {
    console.error('[API] Transcribe error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {}
    }
  }
}
