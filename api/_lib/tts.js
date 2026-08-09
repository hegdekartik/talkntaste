import { SarvamAIClient } from 'sarvamai';

const client = new SarvamAIClient({
  apiSubscriptionKey: process.env.SARVAM_API_KEY,
});

/**
 * Language → speaker mapping for Bulbul v3 (from Sarvam's best-practice docs).
 * Female voices are used by default — warmer and clearer for a cooking guide.
 */
const SPEAKERS_BY_LANGUAGE = {
  'en-IN': 'ishita',
  'hi-IN': 'priya',
  'te-IN': 'neha',
  'kn-IN': 'neha',
  'bn-IN': 'roopa',
  'ta-IN': 'ishita',
  'od-IN': 'ritu',
  'ml-IN': 'pooja',
  'mr-IN': 'priya',
  'gu-IN': 'priya',
  'pa-IN': 'roopa',
};

const FALLBACK_LANGUAGE = 'hi-IN';
const FALLBACK_SPEAKER = 'priya';

/** Supported TTS language codes (Bulbul v3). */
const SUPPORTED_LANGUAGES = new Set(Object.keys(SPEAKERS_BY_LANGUAGE));

/** Lightweight cleanup so the model's reply reads naturally when spoken. */
function toSpokenText(text) {
  return String(text)
    .replace(/[*_#>`~]/g, '')          // markdown symbols
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // markdown links -> label
    .replace(/\s*\n\s*/g, ' ')         // newlines -> spaces
    .replace(/\s{2,}/g, ' ')           // collapse whitespace
    .trim();
}

/**
 * Convert a language code (as detected by STT) into a valid TTS language code.
 */
export function normalizeTtsLanguage(languageCode) {
  if (typeof languageCode === 'string' && SUPPORTED_LANGUAGES.has(languageCode)) {
    return languageCode;
  }
  if (typeof languageCode === 'string') {
    // Try a case-insensitive / dash-insensitive match.
    const norm = languageCode.replace(/-/g, '').toLowerCase();
    for (const code of SUPPORTED_LANGUAGES) {
      if (code.replace(/-/g, '').toLowerCase() === norm) return code;
    }
  }
  return FALLBACK_LANGUAGE;
}

/**
 * Synthesize speech for a reply using Sarvam Bulbul v3.
 *
 * @param {object} params
 * @param {string} params.text - Text to speak (kept under ~1200 chars for low latency).
 * @param {string} [params.language] - STT-detected language code (e.g. 'kn-IN').
 * @returns {Promise<{ audioBase64: string, contentType: string, language: string }>}
 */
export async function synthesizeSpeech({ text, language = FALLBACK_LANGUAGE }) {
  const ttsLanguage = normalizeTtsLanguage(language);
  const speaker = SPEAKERS_BY_LANGUAGE[ttsLanguage] || FALLBACK_SPEAKER;

  const spoken = toSpokenText(text);
  if (!spoken) {
    throw new Error('Cannot synthesize empty text');
  }
  if (spoken.length > 1200) {
    // Clip to a speakable length; the model is told to keep replies short anyway.
    const clipped = spoken.slice(0, 1180).trimEnd();
    const sentenceEnd = Math.max(
      clipped.lastIndexOf('.'),
      clipped.lastIndexOf('।'),
      clipped.lastIndexOf('!'),
      clipped.lastIndexOf('?'),
      clipped.lastIndexOf('…'),
    );
    return synthesizeSpeech({
      text: sentenceEnd > 400 ? clipped.slice(0, sentenceEnd + 1) : clipped + '…',
      language: ttsLanguage,
    });
  }

  const response = await client.textToSpeech.convert({
    text: spoken,
    model: 'bulbul:v3',
    speaker,
    target_language_code: ttsLanguage,
    pace: 1.0,
    temperature: 0.6,
    speech_sample_rate: 24000,
    output_audio_codec: 'mp3',
  });

  const audioBase64 = (response.audios || []).join('');
  if (!audioBase64) {
    throw new Error('Sarvam TTS returned empty audio');
  }

  return { audioBase64, contentType: 'audio/mpeg', language: ttsLanguage, speaker };
}