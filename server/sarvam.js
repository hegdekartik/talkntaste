import { SarvamAIClient } from 'sarvamai';
import fs from 'fs';
import path from 'path';
import { parseFile } from 'music-metadata';

const client = new SarvamAIClient({
  apiKey: process.env.SARVAM_API_KEY,
});

const SARVAM_API_BASE = 'https://api.sarvam.ai';

// Duration thresholds (seconds)
const SYNC_MAX_DURATION = 30;
const ABSOLUTE_MAX_DURATION = 180; // 3 minutes

// Batch polling config
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes max wait

/**
 * Get the duration of an audio file in seconds.
 * Uses music-metadata for most formats, falls back to file-size heuristic for webm.
 *
 * @param {string} filePath
 * @returns {Promise<number|null>} duration in seconds, or null if unknown
 */
async function getAudioDuration(filePath) {
  try {
    const metadata = await parseFile(filePath);
    if (metadata.format.duration && metadata.format.duration > 0) {
      return metadata.format.duration;
    }
  } catch (err) {
    console.warn('[Sarvam] Could not parse audio metadata:', err.message);
  }

  // Fallback: estimate from file size
  // Browser-recorded WebM/Opus is typically 24–64kbps; we use 32kbps (4KB/s)
  // as a conservative estimate to avoid under-counting long recordings.
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const bytesPerSecond = ['.webm', '.ogg', '.opus'].includes(ext) ? (32 * 1024 / 8) : (128 * 1024 / 8);
    const estimatedDuration = stats.size / bytesPerSecond;
    console.log(`[Sarvam] Estimated duration from file size: ${estimatedDuration.toFixed(1)}s (assuming ${bytesPerSecond * 8 / 1024}kbps for ${ext || 'unknown'})`);
    return estimatedDuration;
  } catch {
    return null;
  }
}

/**
 * Transcribe audio using Sarvam AI — hybrid approach.
 *
 * - ≤30s: Synchronous REST API (instant response)
 * - 30s–3min: Batch API (async job with polling)
 * - >3min: Rejected with error
 *
 * @param {string} filePath - Path to the audio file on disk
 * @param {string} originalName - Original filename for logging
 * @returns {Promise<{ transcript: string, language: string }>}
 */
export async function transcribeAudio(filePath, originalName) {
  // Step 0: Get duration
  const duration = await getAudioDuration(filePath);

  if (duration !== null) {
    console.log(`[Sarvam] Audio duration: ${duration.toFixed(1)}s | File: ${originalName}`);

    if (duration > ABSOLUTE_MAX_DURATION) {
      throw new Error(
        `Audio is too long (${Math.round(duration)}s). Please keep recordings under 3 minutes.`
      );
    }
  }

  // Decide which path to take
  const useBatchApi = duration !== null && duration > SYNC_MAX_DURATION;

  if (useBatchApi) {
    console.log(`[Sarvam] Using BATCH API for ${originalName} (${duration.toFixed(1)}s > ${SYNC_MAX_DURATION}s)`);
    return transcribeBatch(filePath, originalName);
  }

  // Sync path — with automatic fallback to batch if sync rejects due to duration
  console.log(`[Sarvam] Using SYNC API for ${originalName}${duration === null ? ' (duration unknown — will fallback to batch if needed)' : ''}`);
  try {
    return await transcribeSync(filePath, originalName);
  } catch (syncError) {
    const msg = (syncError?.message || '').toLowerCase();
    const statusCode = syncError?.statusCode || syncError?.status;

    // Only fall back to batch for clear duration/length errors, NOT generic 'limit' errors
    const isDurationError =
      msg.includes('duration') ||
      msg.includes('too long') ||
      msg.includes('audio length') ||
      msg.includes('exceeds') ||
      statusCode === 413;

    console.log(`[Sarvam] Sync failed: "${syncError?.message}" | statusCode=${statusCode} | isDurationError=${isDurationError}`);

    if (isDurationError) {
      console.log(`[Sarvam] Sync API rejected (likely >30s) — falling back to BATCH API for ${originalName}`);
      return transcribeBatch(filePath, originalName);
    }

    throw syncError; // Re-throw non-duration errors
  }
}

/**
 * Synchronous transcription via Sarvam SDK (≤30s audio).
 */
async function transcribeSync(filePath, originalName) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const response = await client.speechToText.transcribe({
      file: fileStream,
      model: 'saaras:v3',
    });

    const transcript = response.transcript || response.text || '';
    const language = response.language_code || response.language || 'unknown';

    console.log(`[Sarvam] Sync transcribed ${originalName} | Language: ${language} | Length: ${transcript.length} chars`);

    return {
      transcript: transcript.trim(),
      language,
    };
  } catch (error) {
    console.error('[Sarvam] Sync transcription error:', error?.message || error);
    // Let the caller (transcribeAudio) handle fallback logic
    throw error;
  }
}

/**
 * Batch transcription via Sarvam REST API (30s–3min audio).
 *
 * Workflow:
 * 1. Create job
 * 2. Get upload URL
 * 3. Upload file to signed URL
 * 4. Start job
 * 5. Poll status until complete
 * 6. Download results
 */
async function transcribeBatch(filePath, originalName) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error('SARVAM_API_KEY is not configured');
  }

  const headers = {
    'api-subscription-key': apiKey,
    'Content-Type': 'application/json',
  };

  try {
    // Step 1: Create a batch job
    console.log('[Sarvam Batch] Creating job...');
    const createRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_parameters: {
          model: 'saaras:v3',
        },
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`Failed to create batch job: ${createRes.status} — ${errBody}`);
    }

    const createData = await createRes.json();
    const jobId = createData.job_id;
    console.log(`[Sarvam Batch] Job created: ${jobId}`);

    // Step 2: Get upload URL
    const fileName = path.basename(originalName || 'recording.webm');
    console.log('[Sarvam Batch] Getting upload URL...');
    const uploadUrlRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/upload-files`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_id: jobId,
        files: [fileName],
      }),
    });

    if (!uploadUrlRes.ok) {
      const errBody = await uploadUrlRes.text();
      throw new Error(`Failed to get upload URL: ${uploadUrlRes.status} — ${errBody}`);
    }

    const uploadUrlData = await uploadUrlRes.json();

    // Sarvam returns upload_urls as an object keyed by filename:
    //   { "recording.webm": { "file_url": "https://...", "file_metadata": null } }
    let uploadUrl;
    if (uploadUrlData.upload_urls && typeof uploadUrlData.upload_urls === 'object') {
      const firstFile = uploadUrlData.upload_urls[fileName] || Object.values(uploadUrlData.upload_urls)[0];
      uploadUrl = firstFile?.file_url || firstFile?.url || firstFile;
      // If firstFile is a string URL directly
      if (typeof firstFile === 'string') uploadUrl = firstFile;
    }
    // Fallback: maybe it's an array
    if (!uploadUrl) {
      uploadUrl = uploadUrlData.urls?.[0];
    }

    if (!uploadUrl) {
      console.error('[Sarvam Batch] Upload URL response was:', JSON.stringify(uploadUrlData, null, 2));
      throw new Error(`No upload URL returned from Sarvam batch API. Full response: ${JSON.stringify(uploadUrlData)}`);
    }

    console.log(`[Sarvam Batch] Got upload URL for ${fileName}`);

    // Step 3: Upload file to signed URL (Azure Blob Storage)
    console.log('[Sarvam Batch] Uploading audio file...');
    const fileBuffer = fs.readFileSync(filePath);
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBuffer,
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-ms-blob-type': 'BlockBlob', // Required by Azure Blob Storage
      },
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      throw new Error(`Failed to upload file: ${uploadRes.status} — ${errBody}`);
    }

    // Step 4: Start the job
    console.log('[Sarvam Batch] Starting job...');
    const startRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ job_id: jobId }),
    });

    if (!startRes.ok) {
      const errBody = await startRes.text();
      throw new Error(`Failed to start batch job: ${startRes.status} — ${errBody}`);
    }

    // Step 5: Poll for completion
    console.log('[Sarvam Batch] Polling for completion...');
    const startTime = Date.now();

    while (true) {
      const statusRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/${jobId}/status`, {
        method: 'GET',
        headers: {
          'api-subscription-key': apiKey,
        },
      });

      if (!statusRes.ok) {
        const errBody = await statusRes.text();
        throw new Error(`Failed to check job status: ${statusRes.status} — ${errBody}`);
      }

      const statusData = await statusRes.json();
      const jobStatus = (statusData.status || '').toLowerCase();

      console.log(`[Sarvam Batch] Job status: ${jobStatus}`);

      if (jobStatus === 'completed' || jobStatus === 'finished' || jobStatus === 'done') {
        break;
      }

      if (jobStatus === 'failed' || jobStatus === 'error') {
        throw new Error(`Batch transcription job failed: ${statusData.error || statusData.message || 'Unknown error'}`);
      }

      // Timeout check
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        throw new Error('Batch transcription timed out. Please try again with a shorter recording.');
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Step 6: Download results
    // Sarvam batch outputs are numbered files — for a single-file job, request "0.json".
    // We also try without the files array as a fallback for API version differences.
    console.log('[Sarvam Batch] Downloading results...');
    let downloadData;

    // Try with explicit files array first (per Sarvam docs)
    const downloadRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/download-files`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ job_id: jobId, files: ['0.json'] }),
    });

    if (downloadRes.ok) {
      downloadData = await downloadRes.json();
    } else {
      // Fallback: try without files array
      console.log('[Sarvam Batch] Retrying download without files array...');
      const fallbackRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/download-files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ job_id: jobId }),
      });

      if (!fallbackRes.ok) {
        const errBody = await fallbackRes.text();
        throw new Error(`Failed to download results: ${fallbackRes.status} — ${errBody}`);
      }

      downloadData = await fallbackRes.json();
    }

    // Sarvam returns download_urls as an object keyed by filename (similar to upload_urls)
    let downloadUrl;
    if (downloadData.download_urls && typeof downloadData.download_urls === 'object') {
      if (Array.isArray(downloadData.download_urls)) {
        downloadUrl = downloadData.download_urls[0];
      } else {
        const firstFile = Object.values(downloadData.download_urls)[0];
        downloadUrl = firstFile?.file_url || firstFile?.url || firstFile;
        if (typeof firstFile === 'string') downloadUrl = firstFile;
      }
    }
    if (!downloadUrl) {
      downloadUrl = downloadData.urls?.[0];
    }

    if (!downloadUrl) {
      console.error('[Sarvam Batch] Download response:', JSON.stringify(downloadData, null, 2));
      throw new Error('No download URL returned from Sarvam batch API');
    }

    // Step 7: Fetch the transcript from the signed URL
    const resultRes = await fetch(downloadUrl);
    if (!resultRes.ok) {
      throw new Error(`Failed to fetch transcript result: ${resultRes.status}`);
    }

    // The result may be a JSON file or plain text
    const resultText = await resultRes.text();
    let resultData;
    try {
      resultData = JSON.parse(resultText);
    } catch {
      // If the result is plain text (not JSON), treat it as the transcript
      console.log('[Sarvam Batch] Result was plain text, not JSON');
      return {
        transcript: resultText.trim(),
        language: 'unknown',
      };
    }

    // Extract transcript — batch results may have different structures
    const transcript = resultData.transcript
      || resultData.text
      || (resultData.segments && resultData.segments.map((s) => s.text || s.transcript).join(' '))
      || '';

    const language = resultData.language_code || resultData.language || 'unknown';

    console.log(`[Sarvam Batch] Transcribed ${originalName} | Language: ${language} | Length: ${transcript.length} chars`);

    return {
      transcript: transcript.trim(),
      language,
    };
  } catch (error) {
    console.error('[Sarvam Batch] Error:', error.message);
    throw new Error(`Batch transcription failed: ${error.message}`);
  }
}
