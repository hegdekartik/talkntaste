import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// Initialize Supabase client with service role key (server-side only)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

function getSupabase() {
  if (!supabase) {
    if (!supabaseUrl || !supabaseKey) {
      console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — recipe saving disabled');
      return null;
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

/**
 * Auto-generate tags from recipe content using keyword heuristics.
 *
 * @param {object} recipe - Structured recipe JSON
 * @param {string} transcript - Raw transcript text
 * @returns {string[]} Array of tag strings
 */
export function generateTags(recipe, transcript = '') {
  const tags = [];
  const allText = [
    recipe.title,
    transcript,
    ...(recipe.ingredients || []).map((i) => `${i.name} ${i.notes || ''}`),
    ...(recipe.steps || []).map((s) => s.instruction),
  ]
    .join(' ')
    .toLowerCase();

  // --- Dietary ---
  const nonVegKeywords = [
    'chicken', 'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'egg', 'meat', 'pork', 'beef',
    'கோழி', 'மீன்', 'முட்டை', 'இறால்',
    'चिकन', 'मटन', 'मछली', 'अंडा', 'अंडे', 'झींगा', 'मांस',
    'ಕೋಳಿ', 'ಮೀನು', 'ಮೊಟ್ಟೆ', 'ಮಾಂಸ',
    'చికెన్', 'మటన్', 'చేప', 'గుడ్డు',
  ];

  if (nonVegKeywords.some((kw) => allText.includes(kw))) {
    tags.push('non-vegetarian');
  } else {
    tags.push('vegetarian');
  }

  // --- Cuisine ---
  const southIndianKeywords = ['dosa', 'idli', 'sambar', 'sambhar', 'chutney', 'rasam', 'upma', 'uttapam', 'vada', 'appam', 'puttu', 'avial', 'ದೋಸೆ', 'ಇಡ್ಲಿ', 'ಸಾಂಬಾರ್', 'சாம்பார்', 'தோசை', 'இட்லி'];
  const northIndianKeywords = ['roti', 'naan', 'paratha', 'dal', 'paneer', 'biryani', 'pulao', 'rajma', 'chole', 'aloo', 'gobi', 'रोटी', 'नान', 'पराठा', 'दाल', 'पनीर', 'बिरयानी'];
  const snackKeywords = ['pakoda', 'pakora', 'bhaji', 'bhajji', 'samosa', 'bajji', 'ಪಕೋಡ', 'ಬಜ್ಜಿ', 'पकोड़ा', 'समोसा'];
  const dessertKeywords = ['sweet', 'halwa', 'kheer', 'payasam', 'laddu', 'ladoo', 'jalebi', 'barfi', 'gulab jamun', 'ಪಾಯಸ', 'हलवा', 'खीर', 'லட்டு', 'பாயசம்'];

  if (southIndianKeywords.some((kw) => allText.includes(kw))) tags.push('south-indian');
  if (northIndianKeywords.some((kw) => allText.includes(kw))) tags.push('north-indian');
  if (snackKeywords.some((kw) => allText.includes(kw))) tags.push('snack');
  if (dessertKeywords.some((kw) => allText.includes(kw))) tags.push('dessert');

  // --- Speed ---
  const prepTimeStr = (recipe.prepTime || '').toLowerCase();
  const timeMatch = prepTimeStr.match(/(\d+)/);
  if (timeMatch) {
    const minutes = parseInt(timeMatch[1], 10);
    if (minutes <= 15) tags.push('quick');
    else if (minutes <= 30) tags.push('under-30-min');
    else if (minutes >= 60) tags.push('slow-cook');
  }

  // --- Language tag ---
  if (recipe.languageName) {
    tags.push(recipe.languageName.toLowerCase());
  }

  return [...new Set(tags)]; // deduplicate
}

/**
 * Upload audio file to Supabase Storage.
 *
 * @param {string} filePath - Path to the audio file on disk (e.g. /tmp/...)
 * @param {string} originalName - Original filename
 * @returns {Promise<string|null>} Storage path or null on failure
 */
async function uploadAudio(filePath, originalName) {
  const sb = getSupabase();
  if (!sb || !filePath) return null;

  try {
    const ext = path.extname(originalName || 'recording.webm') || '.webm';
    const storagePath = `${randomUUID()}${ext}`;
    const fileBuffer = fs.readFileSync(filePath);

    const { error } = await sb.storage
      .from('recipe-audio')
      .upload(storagePath, fileBuffer, {
        contentType: 'audio/webm',
        upsert: false,
      });

    if (error) {
      console.error('[Supabase Storage] Upload error:', error.message);
      return null;
    }

    console.log(`[Supabase Storage] Uploaded: ${storagePath}`);
    return storagePath;
  } catch (err) {
    console.error('[Supabase Storage] Upload failed:', err.message);
    return null;
  }
}

/**
 * Save a recipe to Supabase.
 * This is fire-and-forget — errors are logged but don't break the pipeline.
 *
 * @param {object} params
 * @param {object} params.recipe - Structured recipe JSON from OpenAI
 * @param {string} params.transcript - Raw transcript from Sarvam
 * @param {string} params.language - Detected language code
 * @param {string} [params.audioFilePath] - Path to audio file on disk (for upload)
 * @param {string} [params.originalName] - Original audio filename
 * @returns {Promise<string|null>} Recipe UUID or null on failure
 */
export async function saveRecipe({ recipe, transcript, language, audioFilePath, originalName }) {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[Supabase] Client not initialized — skipping save');
    return null;
  }

  try {
    // Upload audio to storage (non-blocking if it fails)
    const audioPath = await uploadAudio(audioFilePath, originalName);

    // Generate tags
    const tags = generateTags(recipe, transcript);

    // Insert into recipes table
    const { data, error } = await sb
      .from('recipes')
      .insert({
        title: recipe.title,
        language: recipe.language || language || 'unknown',
        language_name: recipe.languageName || 'Unknown',
        servings: recipe.servings || null,
        prep_time: recipe.prepTime || null,
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || [],
        transcript: transcript || null,
        tags,
        audio_path: audioPath,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Supabase] Insert error:', error.message);
      return null;
    }

    console.log(`[Supabase] Recipe saved: ${data.id} | Tags: [${tags.join(', ')}]`);
    return data.id;
  } catch (err) {
    console.error('[Supabase] Save failed:', err.message);
    return null;
  }
}
