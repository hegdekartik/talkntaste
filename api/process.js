import { parseMultipart, cleanupFile } from './_lib/parseMultipart.js';
import { transcribeAudio } from './_lib/sarvam.js';
import { uploadAudio } from './_lib/supabase.js';

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
    const { filePath: tmpPath, originalName } = await parseMultipart(req);
    filePath = tmpPath;

    console.log(`[API] Full pipeline: ${originalName}`);

    // Step 1: Transcribe & Upload in parallel
    // (Uploading early saves 1-2s of execution time, crucial for 10s Vercel Hobby limits)
    const [transcribeResult, audioPath] = await Promise.all([
      transcribeAudio(filePath, originalName),
      uploadAudio(filePath, originalName)
    ]);

    if (transcribeResult.isBatch) {
      // For long audio, Vercel would timeout. We return 202 to trigger client polling.
      return res.status(202).json({
        status: 'processing',
        jobId: transcribeResult.jobId,
        audioPath,
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
      audioPath,
      originalName,
    });
  } catch (error) {
    console.error('[API] Process error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupFile(filePath);
  }
}
