/**
 * api.js — Backend API client for Talk2Taste
 */

const API_BASE = '/api';

/**
 * Process audio through the full pipeline (transcribe + structure).
 *
 * @param {Blob} audioBlob - Audio data blob
 * @param {{ onTranscribing?: () => void, onStructuring?: () => void }} callbacks
 * @returns {Promise<{ transcript: string, detectedLanguage: string, recipe: object }>}
 */
export async function processAudio(audioBlob, callbacks = {}) {
  const formData = new FormData();

  // Determine file extension from mime type
  const ext = getExtension(audioBlob.type);
  formData.append('audio', audioBlob, `recording.${ext}`);

  if (callbacks.onTranscribing) callbacks.onTranscribing();

  const response = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok && response.status !== 202) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }

  let data = await response.json();

  // If the server returns 202 Accepted, it means it's processing a long audio file in the background.
  // We need to poll the server for the result.
  if (response.status === 202 || data.status === 'processing') {
    const { jobId, audioPath, originalName } = data;
    
    while (true) {
      // Wait 3 seconds before polling
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const pollResponse = await fetch(`${API_BASE}/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId, audioPath, originalName }),
      });
      
      if (!pollResponse.ok) {
        const error = await pollResponse.json().catch(() => ({ error: 'Polling error' }));
        throw new Error(error.error || `Server returned ${pollResponse.status}`);
      }
      
      data = await pollResponse.json();
      
      if (data.status === 'completed') {
        break; // Done polling
      }
      // Otherwise, it's still processing, so loop again
    }
  }

  if (callbacks.onStructuring) callbacks.onStructuring();

  return data;
}

/**
 * Transcribe audio only (without structuring).
 *
 * @param {Blob} audioBlob
 * @returns {Promise<{ transcript: string, language: string }>}
 */
export async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  const ext = getExtension(audioBlob.type);
  formData.append('audio', audioBlob, `recording.${ext}`);

  const response = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }

  return response.json();
}

/**
 * Structure a transcript into a recipe.
 *
 * @param {string} transcript
 * @param {string} [language]
 * @returns {Promise<object>}
 */
export async function structureRecipe(transcript, language) {
  const response = await fetch(`${API_BASE}/structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }

  return response.json();
}

/** Map mime types to file extensions */
function getExtension(mimeType) {
  const map = {
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
    'audio/ogg': 'ogg',
    'audio/ogg;codecs=opus': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  };
  return map[mimeType] || 'webm';
}
