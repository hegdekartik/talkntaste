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
  const ext = getExtension(audioBlob.type);
  formData.append('audio', audioBlob, `recording.${ext}`);

  if (callbacks.onTranscribing) callbacks.onTranscribing();

  // Step 1: Transcribe
  const processResponse = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    body: formData,
  });

  if (!processResponse.ok && processResponse.status !== 202) {
    const error = await processResponse.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${processResponse.status}`);
  }

  let data = await processResponse.json();

  // If the server returns 202 Accepted, it's processing in the background. Poll for result.
  if (processResponse.status === 202 || data.status === 'processing') {
    data = await pollForResult(data);
  }

  const { transcript, detectedLanguage, audioPath, originalName } = data;

  if (callbacks.onStructuring) callbacks.onStructuring();

  // Step 2: Structure
  const structureResponse = await fetch(`${API_BASE}/structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language: detectedLanguage }),
  });

  if (!structureResponse.ok) {
    const error = await structureResponse.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Failed to structure recipe: ${structureResponse.status}`);
  }

  const { recipe } = await structureResponse.json();

  // Step 3: Save (fire-and-forget, but we await to get ID)
  fetch(`${API_BASE}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe, transcript, language: detectedLanguage, audioPath, originalName }),
  }).catch(err => console.error('[API] Failed to save recipe to database:', err));

  return {
    transcript,
    detectedLanguage,
    recipe,
  };
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

  if (!response.ok && response.status !== 202) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }

  let data = await response.json();

  // Handle batch polling for transcribe-only flow
  if (response.status === 202 || data.isBatch || data.status === 'processing') {
    data = await pollForResult(data);
  }

  return data;
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

/**
 * Poll the server for the result of a batch job.
 * 
 * @param {object} initialData - The response data containing jobId
 * @returns {Promise<object>} The final completed data
 */
async function pollForResult(initialData) {
  let data = initialData;
  const { jobId, audioPath, originalName } = data;
  
  const MAX_POLLS = 40; // 40 × 3s = 2 minutes max wait
  let polls = 0;

  while (polls++ < MAX_POLLS) {
    // Wait 3 seconds before polling
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const pollResponse = await fetch(`${API_BASE}/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId, audioPath, originalName }),
    });
    
    if (!pollResponse.ok && pollResponse.status !== 202) {
      const error = await pollResponse.json().catch(() => ({ error: 'Polling error' }));
      throw new Error(error.error || `Server returned ${pollResponse.status}`);
    }
    
    data = await pollResponse.json();
    
    if (data.status === 'completed') {
      return data; // Done polling
    }
  }

  throw new Error('Processing is taking too long. Please try again with a shorter recording.');
}
