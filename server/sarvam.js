import { SarvamAIClient } from 'sarvamai';
import fs from 'fs';

const client = new SarvamAIClient({
  apiKey: process.env.SARVAM_API_KEY,
});

/**
 * Transcribe audio using Sarvam AI Saaras v3 model.
 *
 * @param {string} filePath - Path to the audio file on disk
 * @param {string} originalName - Original filename for logging
 * @returns {Promise<{ transcript: string, language: string }>}
 */
export async function transcribeAudio(filePath, originalName) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const response = await client.speechToText.transcribe({
      file: fileStream,
      model: 'saaras:v3',
    });

    // Extract transcript and language from response
    const transcript = response.transcript || response.text || '';
    const language = response.language_code || response.language || 'unknown';

    console.log(`[Sarvam] Transcribed ${originalName} | Language: ${language} | Length: ${transcript.length} chars`);

    return {
      transcript: transcript.trim(),
      language,
    };
  } catch (error) {
    console.error('[Sarvam] Transcription error:', error?.message || error);

    // If sync API fails due to length, provide guidance
    if (error?.message?.includes('duration') || error?.message?.includes('length') || error?.statusCode === 413) {
      throw new Error(
        'Audio file is too long for real-time processing. Please keep recordings under 3 minutes.'
      );
    }

    throw new Error(`Transcription failed: ${error?.message || 'Unknown error'}`);
  }
}
