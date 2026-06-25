/**
 * share.js — Social sharing with platform-optimized formatting
 * Preserves the original language of the recipe.
 */

/**
 * Number emoji map for step numbers
 */
const stepEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * Format recipe for WhatsApp (rich emojis, bold markers)
 * @param {object} recipe
 * @returns {string}
 */
export function formatWhatsApp(recipe) {
  let text = `🍳 *${recipe.title}*\n`;

  // Meta info
  const metaParts = [];
  if (recipe.prepTime) metaParts.push(`⏱️ ${recipe.prepTime}`);
  if (recipe.servings) metaParts.push(`👥 ${recipe.servings}`);
  if (metaParts.length > 0) {
    text += `${metaParts.join(' · ')}\n`;
  }

  // Ingredients
  text += `\n📝 *${getLocalizedLabel('ingredients', recipe.language)}*\n`;
  for (const ing of recipe.ingredients) {
    let line = `▸ ${ing.quantity} ${ing.name}`;
    if (ing.notes) line += ` (${ing.notes})`;
    text += `${line}\n`;
  }

  // Steps
  text += `\n👨‍🍳 *${getLocalizedLabel('steps', recipe.language)}*\n`;
  for (const step of recipe.steps) {
    const emoji = stepEmojis[step.stepNumber - 1] || `${step.stepNumber}.`;
    text += `${emoji} ${step.instruction}\n`;
  }

  text += `\n✨ Made with TalknTaste`;

  return text;
}

/**
 * Format recipe for Twitter/X (condensed, within character limits)
 * @param {object} recipe
 * @returns {string}
 */
export function formatTwitter(recipe) {
  let text = `🍳 ${recipe.title}\n\n`;

  // Condensed ingredients (just names)
  const ingredientNames = recipe.ingredients.map((i) => i.name).join(', ');
  text += `📝 ${ingredientNames}\n\n`;

  // Condensed steps
  for (const step of recipe.steps) {
    const instruction = step.instruction.length > 60
      ? step.instruction.substring(0, 57) + '...'
      : step.instruction;
    text += `${step.stepNumber}. ${instruction}\n`;
  }

  text += `\n#TalknTaste #Recipe`;

  // Twitter limit is 280 chars — truncate if needed
  if (text.length > 280) {
    text = text.substring(0, 276) + '...';
  }

  return text;
}

/**
 * Format recipe for clipboard (clean text, similar to WhatsApp)
 * @param {object} recipe
 * @returns {string}
 */
export function formatClipboard(recipe) {
  return formatWhatsApp(recipe);
}

/**
 * Share via WhatsApp
 * @param {object} recipe
 */
export function shareWhatsApp(recipe) {
  const text = formatWhatsApp(recipe);
  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
}

/**
 * Share via Twitter/X
 * @param {object} recipe
 */
export function shareTwitter(recipe) {
  const text = formatTwitter(recipe);
  const encoded = encodeURIComponent(text);
  window.open(`https://twitter.com/intent/tweet?text=${encoded}`, '_blank');
}

/**
 * Copy recipe to clipboard with fallback
 * @param {object} recipe
 * @returns {Promise<boolean>} true if successful
 */
export async function copyToClipboard(recipe) {
  const text = formatClipboard(recipe);

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

/**
 * Share via native Web Share API (mobile)
 * @param {object} recipe
 * @returns {Promise<boolean>}
 */
export async function shareNative(recipe) {
  if (!navigator.share) return false;

  const text = formatWhatsApp(recipe);

  try {
    await navigator.share({
      title: `🍳 ${recipe.title}`,
      text,
    });
    return true;
  } catch (err) {
    // User cancelled
    if (err.name === 'AbortError') return false;
    throw err;
  }
}

/**
 * Get localized section labels based on recipe language.
 * Falls back to English for unknown languages.
 */
function getLocalizedLabel(section, langCode) {
  const labels = {
    ingredients: {
      kn: 'ಪದಾರ್ಥಗಳು',
      hi: 'सामग्री',
      ta: 'பொருட்கள்',
      te: 'పదార్థాలు',
      ml: 'ചേരുവകൾ',
      mr: 'साहित्य',
      bn: 'উপকরণ',
      gu: 'સામગ્રી',
      pa: 'ਸਮੱਗਰੀ',
      en: 'Ingredients',
    },
    steps: {
      kn: 'ವಿಧಾನ',
      hi: 'विधि',
      ta: 'செய்முறை',
      te: 'విధానం',
      ml: 'രീതി',
      mr: 'कृती',
      bn: 'পদ্ধতি',
      gu: 'રીત',
      pa: 'ਵਿਧੀ',
      en: 'Steps',
    },
  };

  return labels[section]?.[langCode] || labels[section]?.en || section;
}
