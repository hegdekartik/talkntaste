import fs from 'fs';
import { transcribeAudio } from './_lib/sarvam.js';
import { downloadAudio } from './_lib/supabase.js';

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

  let filePath;

  try {
    const { storagePath, originalName } = req.body || {};

    if (!storagePath) {
      return res.status(400).json({ error: 'Missing storagePath' });
    }

    console.log(`[API] Full pipeline for ${originalName}, path: ${storagePath}`);

    // Download audio from Supabase to local /tmp for Sarvam
    filePath = await downloadAudio(storagePath);

    // Transcribe
    const transcribeResult = await transcribeAudio(filePath, originalName);

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
