/**
 * api.js — Backend API client for Talk2Taste
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Ping the server to wake it up (prevents cold starts).
 */
export function wakeUpBackend() {
  fetch(`${API_BASE}/health`)
    .catch(err => console.debug('[API] Wakeup ping failed', err));
}

/**
 * Process audio through the full pipeline (transcribe + structure).
 *
 * @param {Blob} audioBlob - Audio data blob
 * @param {{ onTranscribing?: () => void, onStructuring?: () => void }} callbacks
 * @param {string|null} authorName - Optional author name
 * @returns {Promise<{ transcript: string, detectedLanguage: string, recipe: object }>}
 */
export async function processAudio(audioBlob, callbacks = {}, authorName = null, languageHint = '') {
  const formData = new FormData();
  const ext = getExtension(audioBlob.type);
  formData.append('audio', audioBlob, `recording.${ext}`);

  if (callbacks.onTranscribing) callbacks.onTranscribing();

  // Step 1: Get Upload URL
  const uploadUrlRes = await fetch(`${API_BASE}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalName: `recording.${ext}` })
  });

  if (!uploadUrlRes.ok) {
    throw new Error('Network error: Could not get upload URL from server.');
  }

  const { uploadUrl, storagePath } = await uploadUrlRes.json();

  // Step 2: Direct Upload to Supabase Storage
  try {
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: audioBlob,
      headers: {
        'Content-Type': audioBlob.type || 'audio/webm'
      }
    });
    if (!uploadRes.ok) {
      throw new Error(`Upload failed with status ${uploadRes.status}`);
    }
  } catch (err) {
    console.error('[API] Direct upload error:', err);
    throw new Error('Network error: Failed to upload audio file. Please check your connection.');
  }

  // Step 3: Transcribe
  let processResponse;
  try {
    processResponse = await fetch(`${API_BASE}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storagePath,
        originalName: `recording.${ext}`,
        ...(languageHint ? { languageHint } : {}),
      }),
    });
  } catch (err) {
    console.error('[API] fetch /process error:', err);
    throw new Error('Network error: Connection failed while processing the audio.');
  }

  if (!processResponse.ok && processResponse.status !== 202) {
    const error = await processResponse.json().catch(() => ({ error: 'Server error' }));
    throw new Error(`${error.error || 'Server returned ' + processResponse.status}${error.details ? '\n\nDebug Info: ' + error.details : ''}`);
  }

  let data = await processResponse.json();

  // If the server returns 202 Accepted, it's processing in the background. Poll for result.
  if (processResponse.status === 202 || data.status === 'processing') {
    data = await pollForResult(data);
  }

  const { transcript, detectedLanguage, audioPath, originalName } = data;

  if (callbacks.onStructuring) callbacks.onStructuring();

  // Step 2: Structure
  let structureResponse;
  try {
    structureResponse = await fetch(`${API_BASE}/structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, language: detectedLanguage }),
    });
  } catch (err) {
    console.error('[API] fetch /structure error:', err);
    throw new Error('Network error: Could not connect to the server to structure the recipe.');
  }

  if (!structureResponse.ok) {
    const error = await structureResponse.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Failed to structure recipe: ${structureResponse.status}`);
  }

  const { recipe } = await structureResponse.json();

  // Don't auto-save — let the user review and explicitly Publish
  return {
    transcript,
    detectedLanguage,
    recipe,
    audioPath: storagePath,
    originalName: `recording.${ext}`,
  };
}

/**
 * Transcribe audio only (without structuring).
 *
 * @param {Blob} audioBlob
 * @param {string} languageHint
 * @returns {Promise<{ transcript: string, language: string }>}
 */
export async function transcribeAudio(audioBlob, languageHint = '') {
  const formData = new FormData();
  const ext = getExtension(audioBlob.type);

  // Step 1: Get Upload URL
  const uploadUrlRes = await fetch(`${API_BASE}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalName: `recording.${ext}` })
  });

  if (!uploadUrlRes.ok) {
    throw new Error('Network error: Could not get upload URL from server.');
  }

  const { uploadUrl, storagePath } = await uploadUrlRes.json();

  // Step 2: Direct Upload to Supabase Storage
  try {
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: audioBlob,
      headers: {
        'Content-Type': audioBlob.type || 'audio/webm'
      }
    });
    if (!uploadRes.ok) {
      throw new Error(`Upload failed with status ${uploadRes.status}`);
    }
  } catch (err) {
    console.error('[API] Direct upload error:', err);
    throw new Error('Network error: Failed to upload audio file. Please check your connection.');
  }

  // Step 3: Transcribe
  let response;
  try {
    response = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storagePath,
        originalName: `recording.${ext}`,
        ...(languageHint ? { languageHint } : {}),
      }),
    });
  } catch (err) {
    console.error('[API] fetch /transcribe error:', err);
    throw new Error('Network error: Connection failed while processing the audio.');
  }

  if (!response.ok && response.status !== 202) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(`${error.error || 'Server returned ' + response.status}${error.details ? '\n\nDebug Info: ' + error.details : ''}`);
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
  let response;
  try {
    response = await fetch(`${API_BASE}/structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, language }),
    });
  } catch (err) {
    console.error('[API] fetch /structure error:', err);
    throw new Error('Network error: Could not connect to the server to structure the recipe.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }

  return response.json();
}

/**
 * Save a reviewed recipe to the database (called on explicit Publish).
 *
 * @param {object} params
 * @param {object} params.recipe - Structured recipe JSON
 * @param {string} params.transcript - Raw transcript
 * @param {string} params.language - Detected language code
 * @param {string} params.audioPath - Storage path of uploaded audio
 * @param {string} params.originalName - Original filename
 * @param {string} params.authorName - Author name
 * @returns {Promise<{ recipeId: string }>}
 */
export async function saveRecipeToServer({ recipe, transcript, language, audioPath, originalName, authorName }) {
  const response = await fetch(`${API_BASE}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe, transcript, language, audioPath, originalName, authorName }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Failed to save recipe: ${response.status}`);
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
    
    let pollResponse;
    try {
      pollResponse = await fetch(`${API_BASE}/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId, audioPath, originalName }),
      });
    } catch (err) {
      console.error('[API] fetch /poll error:', err);
      throw new Error('Network error: Connection to the polling server failed.');
    }
    
    if (!pollResponse.ok && pollResponse.status !== 202) {
      const error = await pollResponse.json().catch(() => ({ error: 'Polling error' }));
      throw new Error(`${error.error || 'Server returned ' + pollResponse.status}${error.details ? '\n\nDebug Info: ' + error.details : ''}`);
    }
    
    data = await pollResponse.json();
    
    if (data.status === 'completed') {
      return data; // Done polling
    }
  }

  throw new Error('Processing is taking too long. Please try again with a shorter recording.');
}

/**
 * Fetch recent recipes from the database.
 * @returns {Promise<Array>}
 */
export async function fetchRecipes() {
  let response;
  try {
    response = await fetch(`${API_BASE}/recipes`, {
      method: 'GET',
    });
  } catch (err) {
    console.error('[API] fetch /recipes error:', err);
    throw new Error('Network error: Could not connect to the server to fetch recipes.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(error.error || `Failed to fetch recipes: ${response.status}`);
  }

  const { recipes } = await response.json();
  return recipes;
}
