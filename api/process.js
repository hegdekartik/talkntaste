import fs from 'fs';
import { transcribeAudio } from './_lib/sarvam.js';
import { downloadAudio } from './_lib/supabase.js';
import { getRawBody } from './getRawBody.js';

export const config = {
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
    const { storagePath, originalName, languageHint } = body || {};

    if (!storagePath) {
      return res.status(400).json({ error: 'Missing storagePath' });
    }

    console.log(`[API] Full pipeline for ${originalName}, path: ${storagePath}${languageHint ? `, language hint: ${languageHint}` : ''}`);

    // Download audio from Supabase to local /tmp for Sarvam
    filePath = await downloadAudio(storagePath);

    // Transcribe
    const transcribeResult = await transcribeAudio(filePath, originalName, languageHint || null);

    if (transcribeResult.isBatch) {
      // For long audio, Vercel would timeout. We return 202 to trigger client polling.
      return res.status(202).json({
        status: 'processing',
        jobId: transcribeResult.jobId,
        audioPath: storagePath,
        originalName,
      });
    }

    const { transcript, language } = transcribeResult;

    if (!transcript) {
      return res.status(422).json({
        error: 'Could not extract any text from the audio. Please try again with clearer audio.',
        details: transcribeResult.debugData ? JSON.stringify(transcribeResult.debugData) : 'No debug data available.',
      });
    }

    res.status(200).json({
      status: 'completed',
      transcript,
      detectedLanguage: language,
      audioPath: storagePath,
      originalName,
    });
  } catch (error) {
    console.error('[API] Process error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
}
