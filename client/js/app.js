/**
 * app.js — Main application controller & state machine
 *
 * States: idle → recording → processing → result → editing
 */

import { AudioRecorder, formatTime } from './recorder.js';
import { processAudio, fetchRecipes, wakeUpBackend, saveRecipeToServer } from './api.js';
import { shareWhatsApp, shareTwitter, copyToClipboard } from './share.js';

// Wake up backend immediately to avoid cold start delays
wakeUpBackend();

// ============================================================
// DOM References
// ============================================================
const app = document.getElementById('app');
const usernameInput = document.getElementById('username-input');

// Input view
const micBtn = document.getElementById('mic-btn');
const micInstruction = document.getElementById('mic-instruction');
const timerDisplay = document.getElementById('timer-display');
const waveformCanvas = document.getElementById('waveform-canvas');
const audioUploadInput = document.getElementById('audio-upload');
const durationTip = document.getElementById('duration-tip');
const durationTipClose = document.getElementById('duration-tip-close');
const navRecordBtn = document.getElementById('nav-record-btn');
const navLibraryBtn = document.getElementById('nav-library-btn');

// Database view
const backToRecordBtn = document.getElementById('back-to-record-btn');
const recipeCarousel = document.getElementById('recipe-carousel');
const carouselProgress = document.getElementById('carousel-progress');
const filterChipsContainer = document.getElementById('filter-chips');

// Processing view
const stepTranscribe = document.getElementById('step-transcribe');
const stepTranscribeLabel = stepTranscribe?.querySelector('.processing-step__label');
const stepStructure = document.getElementById('step-structure');
const transcriptPreview = document.getElementById('transcript-preview');
const transcriptText = document.getElementById('transcript-text');

// Result view
const languageName = document.getElementById('language-name');
const recipeTitle = document.getElementById('recipe-title');
const recipeAuthor = document.getElementById('recipe-author');
const recipePrepTime = document.getElementById('recipe-prep-time');
const recipeServings = document.getElementById('recipe-servings');
const ingredientsList = document.getElementById('ingredients-list');
const ingredientsHeading = document.getElementById('ingredients-heading');
const stepsList = document.getElementById('steps-list');
const stepsHeading = document.getElementById('steps-heading');
const transcriptSection = document.getElementById('transcript-section');
const recipeTranscript = document.getElementById('recipe-transcript');
const addIngredientBtn = document.getElementById('add-ingredient-btn');
const addStepBtn = document.getElementById('add-step-btn');
const audioPlayerContainer = document.getElementById('audio-player-container');
const recipeAudio = document.getElementById('recipe-audio');

// Action buttons
const editBtn = document.getElementById('edit-btn');
const shareWhatsappBtn = document.getElementById('share-whatsapp-btn');
const shareTwitterBtn = document.getElementById('share-twitter-btn');
const copyBtn = document.getElementById('copy-btn');
const newRecipeBtn = document.getElementById('new-recipe-btn');
const retryBtn = document.getElementById('retry-btn');
const discardBtn = document.getElementById('discard-btn');
const publishBtn = document.getElementById('publish-btn');
const draftActions = document.getElementById('draft-actions');
const libraryActions = document.getElementById('library-actions');

// Search
const searchBtn = document.getElementById('search-btn');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');

// Error
const errorMessage = document.getElementById('error-message');

// Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');


// ============================================================
// Initialize
// ============================================================
const savedUsername = localStorage.getItem('talkntaste_username');
if (savedUsername) {
  usernameInput.value = savedUsername;
}

usernameInput.addEventListener('change', (e) => {
  localStorage.setItem('talkntaste_username', e.target.value.trim());
});

let currentState = 'idle';
let recorder = null;
let currentRecipe = null;
let isEditing = false;
let isDraft = false; // true when recipe came from recording (not library)
let draftMeta = null; // { transcript, language, audioPath, originalName, authorName }


// ============================================================
// State Machine
// ============================================================
function setState(newState) {
  currentState = newState;
  
  if (navRecordBtn && navLibraryBtn) {
    if (newState === 'database') {
      navRecordBtn.classList.remove('active');
      navLibraryBtn.classList.add('active');
    } else {
      navRecordBtn.classList.add('active');
      navLibraryBtn.classList.remove('active');
    }
  }

  if (!document.startViewTransition) {
    app.setAttribute('data-state', newState);
    routeFocus(newState);
    return;
  }
  
  const transition = document.startViewTransition(() => {
    app.setAttribute('data-state', newState);
  });
  
  transition.finished.finally(() => {
    routeFocus(newState);
  });
}

function routeFocus(state) {
  // Use setTimeout to ensure the new view is fully rendered/display:flex before focusing
  setTimeout(() => {
    if (state === 'result' || state === 'editing') {
      recipeTitle.setAttribute('tabindex', '-1');
      recipeTitle.focus();
    } else if (state === 'processing') {
      const pView = document.getElementById('processing-view');
      pView.setAttribute('tabindex', '-1');
      pView.focus();
    } else if (state === 'idle') {
      micBtn.focus();
    } else if (state === 'database') {
      const dView = document.getElementById('database-view');
      dView.setAttribute('tabindex', '-1');
      dView.focus();
    }
  }, 50); // slight delay to allow flexbox to render
}


// ============================================================
// Recording
// ============================================================
async function startRecording() {
  try {
    recorder = new AudioRecorder();

    recorder.onTimeUpdate = (seconds) => {
      timerDisplay.textContent = formatTime(seconds);
    };

    recorder.onWarning = (remaining) => {
      micInstruction.textContent = `${remaining}s remaining…`;
    };

    recorder.onMaxReached = async () => {
      await stopRecording();
    };

    await recorder.start();
    setState('recording');
    micInstruction.textContent = 'Tap to stop recording';

    // Start waveform visualization
    setupCanvas();
    recorder.startWaveform(waveformCanvas);
  } catch (error) {
    showError(error.message);
  }
}

async function stopRecording() {
  if (!recorder) return;

  // Null immediately to prevent double-stop race (onMaxReached + user click)
  const r = recorder;
  recorder = null;
  timerDisplay.textContent = '0:00';

  const result = await r.stop();

  if (result && result.blob) {
    // Pass recorded duration to processRecording for batch mode detection
    await processRecording(result.blob, result.duration);
  }
}

function handleMicClick() {
  if (currentState === 'idle') {
    startRecording();
  } else if (currentState === 'recording') {
    stopRecording();
  }
}


// ============================================================
// Database & Library Logic (Carousel)
// ============================================================
let cards = [];
let totalRecipes = 0;

navLibraryBtn.addEventListener('click', async () => {
  if (currentState === 'database') return;
  setState('processing');
  stepTranscribeLabel.textContent = 'Fetching library...';
  stepTranscribe.classList.add('active');
  stepStructure.classList.remove('active', 'done');
  
  try {
    const recipes = await fetchRecipes();
    renderDatabase(recipes);
    setState('database');
  } catch (error) {
    showError(error.message || 'Failed to load recipes');
  }
});

navRecordBtn.addEventListener('click', () => {
  if (currentState === 'idle') return;
  if (currentState !== 'database') {
    resetApp();
  } else {
    setState('idle');
  }
});

backToRecordBtn.addEventListener('click', () => {
  setState('idle');
});

let currentDatabaseRecipes = [];
let activeFilter = 'All';

function renderDatabase(recipes) {
  currentDatabaseRecipes = recipes;
  activeFilter = 'All';
  
  if (!recipes || recipes.length === 0) {
    if (filterChipsContainer) filterChipsContainer.innerHTML = '';
    recipeCarousel.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 2rem;">No recipes found yet.</p>';
    if (carouselProgress) carouselProgress.textContent = '';
    return;
  }
  
  // Extract all unique tags
  const tagCounts = {};
  recipes.forEach(r => {
    let rawTags = r.tags || [];
    let lang = r.language_name || 'Unknown';
    let uniqueTags = [lang];
    
    rawTags.forEach(tag => {
      if (tag.toLowerCase() !== lang.toLowerCase() && !uniqueTags.includes(tag)) {
        uniqueTags.push(tag);
      }
    });
    
    r._normalizedTags = uniqueTags; 
    
    uniqueTags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  // Sort tags by frequency
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  // Render chips
  if (filterChipsContainer) {
    filterChipsContainer.innerHTML = '';
    
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-chip active';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => applyFilter('All', allBtn));
    filterChipsContainer.appendChild(allBtn);
    
    // Top 10 tags
    sortedTags.slice(0, 10).forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'filter-chip';
      // Title case the tag for display
      const displayName = tag.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      btn.textContent = displayName;
      btn.addEventListener('click', () => applyFilter(tag, btn));
      filterChipsContainer.appendChild(btn);
    });
  }
  
  applyFilter('All', filterChipsContainer ? filterChipsContainer.firstChild : null);
}

function applyFilter(filterTag, activeBtn) {
  activeFilter = filterTag;
  
  if (filterChipsContainer) {
    // Update active class on chips
    Array.from(filterChipsContainer.children).forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
  }
  
  // Filter recipes
  let filteredRecipes = currentDatabaseRecipes;
  if (filterTag !== 'All') {
    filteredRecipes = currentDatabaseRecipes.filter(r => 
      r._normalizedTags && r._normalizedTags.some(t => t.toLowerCase() === filterTag.toLowerCase())
    );
  }
  
  renderFilteredCards(filteredRecipes);
}

function renderFilteredCards(recipes) {
  recipeCarousel.innerHTML = '';
  cards = [];
  
  if (!recipes || recipes.length === 0) {
    recipeCarousel.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 2rem;">No recipes found for this filter.</p>';
    if (carouselProgress) carouselProgress.textContent = '';
    return;
  }
  
  totalRecipes = recipes.length;
  if (carouselProgress) carouselProgress.textContent = `1 / ${totalRecipes}`;
  recipeCarousel.scrollLeft = 0;
  
  recipes.forEach((recipe, index) => {
    const card = document.createElement('div');
    card.className = 'recipe-mini-card';
    card.tabIndex = 0;
    
    const uniqueTags = recipe._normalizedTags || [];
    const visibleTags = uniqueTags.slice(0, 3);
    const hiddenCount = uniqueTags.length - visibleTags.length;
    
    let tagsHtml = visibleTags.map(tag => {
      const displayTag = tag.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      return `<span class="rmc-tag">${displayTag}</span>`;
    }).join('');
    
    if (hiddenCount > 0) {
      tagsHtml += `<span class="rmc-tag">+${hiddenCount}</span>`;
    }

    const hasAudio = !!(recipe.audio_url || recipe.audio_path);
    let authorStr = '';
    if (recipe.author_name && !recipe.author_name.startsWith('Anon-')) {
      authorStr = `<p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">By ${recipe.author_name}</p>`;
    }
    
    // Use a static food image for all recipes
    const staticImageUrl = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    
    card.innerHTML = `
      <div class="rmc-header">
        <img src="${staticImageUrl}" alt="Food" class="rmc-image" />
      </div>
      <div class="rmc-content">
        <h3 class="rmc-title">${recipe.title || 'Untitled'}</h3>
        ${authorStr}
        <div class="rmc-meta">
          <span class="rmc-meta-item">⏱️ ${recipe.prep_time || '--'}</span>
          <span class="rmc-meta-item">👥 ${recipe.servings || '--'}</span>
          ${hasAudio ? '<span title="Has Audio">🎙️</span>' : ''}
        </div>
        <div class="rmc-tags-wrapper">
          <div class="rmc-tags">
            ${tagsHtml}
          </div>
        </div>
      </div>
    `;
    
    // Store recipe data on the card element for tap handling
    card.recipeData = recipe;
    card.addEventListener('click', () => handleCardTap(recipe));
    
    cards.push(card);
    recipeCarousel.appendChild(card);
  });
}

// Scroll listener removed for vertical list

function handleCardTap(recipe) {
  currentRecipe = {
    title: recipe.title,
    prepTime: recipe.prep_time,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    languageName: recipe.language_name,
    language: recipe.language,
    authorName: recipe.author_name,
    transcript: recipe.transcript
  };
  
  isDraft = false;
  draftMeta = null;
  renderRecipe(currentRecipe);
  
  if (recipe.audio_url) {
    audioPlayerContainer.innerHTML = '<audio id="recipe-audio" controls style="width:100%; border-radius: 8px;"></audio>';
    document.getElementById('recipe-audio').src = recipe.audio_url;
    audioPlayerContainer.style.display = 'block';
  } else {
    audioPlayerContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;"><em>No audio available for this recipe</em></p>';
    audioPlayerContainer.style.display = 'block';
  }
  
  setState('result');
}


// ============================================================
// File Upload
// ============================================================

/** Max audio duration in seconds */
const MAX_AUDIO_DURATION = 180; // 3 minutes

/**
 * Get the duration of an audio Blob/File using Web Audio API.
 * @param {Blob|File} blob
 * @returns {Promise<number|null>} duration in seconds, or null if undetectable
 */
async function getAudioDuration(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();
    return audioBuffer.duration;
  } catch {
    return null;
  }
}

async function handleFileUpload(file) {
  if (!file) return;

  if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|webm|m4a|ogg|flac)$/i)) {
    showToast('Please upload an audio file (.mp3, .wav, etc.)');
    return;
  }

  // Client-side duration check
  const duration = await getAudioDuration(file);
  if (duration !== null && duration > MAX_AUDIO_DURATION) {
    showToast(`Audio is too long (${Math.round(duration)}s). Please keep it under 3 minutes.`);
    return;
  }

  processRecording(file, duration);
}


// ============================================================
// Processing Pipeline
// ============================================================
async function processRecording(audioBlob, knownDuration = null) {
  setState('processing');
  resetProcessingView();

  // Show batch mode messaging if audio is long
  const isBatchMode = knownDuration !== null && knownDuration > 30;
  if (isBatchMode && stepTranscribeLabel) {
    stepTranscribeLabel.textContent = 'Processing longer audio…';
  }

  try {
    // Activate first step indicator
    stepTranscribe.classList.add('active');
    
    // Save user name if modified just before recording
    let authorName = usernameInput.value.trim();
    if (!authorName) {
      authorName = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
    } else {
      localStorage.setItem('talkntaste_username', authorName);
    }

    const result = await processAudio(audioBlob, {
      onTranscribing: () => {
        stepTranscribe.classList.add('active');
      },
      onStructuring: () => {
        stepTranscribe.classList.remove('active');
        stepTranscribe.classList.add('done');
        stepStructure.classList.add('active');
      },
    }, authorName);

    // Show transcript preview
    if (result.transcript) {
      transcriptText.textContent = result.transcript;
      transcriptPreview.classList.add('visible');
    }

    // Mark transcription as done
    stepTranscribe.classList.remove('active');
    stepTranscribe.classList.add('done');

    // Mark structuring as done
    stepStructure.classList.remove('active');
    stepStructure.classList.add('done');

    // Short delay for visual feedback before showing result
    await delay(600);

    // Render the recipe as a draft (not yet saved)
    currentRecipe = result.recipe;
    isDraft = true;
    draftMeta = {
      transcript: result.transcript,
      language: result.detectedLanguage,
      audioPath: result.audioPath,
      originalName: result.originalName,
      authorName,
    };
    renderRecipe(result.recipe);
    
    // Display local audio for draft
    const localAudioUrl = URL.createObjectURL(audioBlob);
    audioPlayerContainer.innerHTML = '<audio id="recipe-audio" controls style="width:100%; border-radius: 8px;"></audio>';
    document.getElementById('recipe-audio').src = localAudioUrl;
    audioPlayerContainer.style.display = 'block';

    setState('result');

  } catch (error) {
    console.error('Processing error:', error);
    showError(error.message || 'Something went wrong. Please try again.');
  }
}

function resetProcessingView() {
  stepTranscribe.classList.remove('active', 'done');
  stepStructure.classList.remove('active', 'done');
  transcriptPreview.classList.remove('visible');
  transcriptText.textContent = '';
  // Reset transcribe label
  if (stepTranscribeLabel) {
    stepTranscribeLabel.textContent = 'Transcribing your recipe…';
  }
}


// ============================================================
// Recipe Rendering
// ============================================================
function renderRecipe(recipe) {
  // Language badge
  languageName.textContent = recipe.languageName || recipe.language || 'Detected';

  // Title & Author
  recipeTitle.textContent = recipe.title;
  
  if (recipe.authorName && !recipe.authorName.startsWith('Anon-')) {
    recipeAuthor.textContent = `By ${recipe.authorName}`;
    recipeAuthor.classList.add('visible');
  } else {
    recipeAuthor.textContent = '';
    recipeAuthor.classList.remove('visible');
  }

  // Meta
  recipePrepTime.textContent = recipe.prepTime || '—';
  recipeServings.textContent = recipe.servings ? `${recipe.servings}` : '—';

  // Section headings (localized)
  const langLabels = getLocalizedLabels(recipe.language);
  ingredientsHeading.textContent = langLabels.ingredients;
  stepsHeading.textContent = langLabels.steps;

  // Ingredients
  ingredientsList.innerHTML = '';
  for (const ing of recipe.ingredients) {
    ingredientsList.appendChild(createIngredientItem(ing));
  }

  // Steps
  stepsList.innerHTML = '';
  for (const step of recipe.steps) {
    stepsList.appendChild(createStepItem(step));
  }

  // Enable inline text editing by default on steps and ingredients
  ingredientsList.querySelectorAll('.ingredient-item__text').forEach(el => {
    el.contentEditable = 'true';
  });
  stepsList.querySelectorAll('.step-item__text').forEach(el => {
    el.contentEditable = 'true';
  });

  // Show contextual action bar
  if (isDraft) {
    draftActions.style.display = 'flex';
    libraryActions.style.display = 'none';
  } else {
    draftActions.style.display = 'none';
    libraryActions.style.display = 'flex';
  }

  // Reset edit mode (for add/remove controls)
  setEditMode(false);

  // Transcript
  const transcriptToDisplay = recipe.transcript || (draftMeta ? draftMeta.transcript : null);
  if (transcriptToDisplay) {
    recipeTranscript.textContent = transcriptToDisplay;
    transcriptSection.style.display = 'block';
  } else {
    recipeTranscript.textContent = '';
    transcriptSection.style.display = 'none';
  }
}

function createIngredientItem(ingredient) {
  const li = document.createElement('li');
  li.className = 'ingredient-item';

  let text = `${ingredient.quantity} ${ingredient.name}`;
  if (ingredient.notes) text += ` (${ingredient.notes})`;

  li.innerHTML = `
    <span class="ingredient-item__bullet">▸</span>
    <span class="ingredient-item__text" contenteditable="false">${escapeHtml(text)}</span>
    <button class="ingredient-item__remove" aria-label="Remove ingredient">×</button>
  `;

  // Remove button
  li.querySelector('.ingredient-item__remove').addEventListener('click', () => {
    li.remove();
    syncRecipeFromDOM();
  });

  return li;
}

function createStepItem(step) {
  const li = document.createElement('li');
  li.className = 'step-item';

  li.innerHTML = `
    <span class="step-item__number">${step.stepNumber}</span>
    <span class="step-item__text" contenteditable="false">${escapeHtml(step.instruction)}</span>
    <div class="step-item__controls">
      <button class="step-item__move step-item__move--up" aria-label="Move step up" title="Move up">↑</button>
      <button class="step-item__move step-item__move--down" aria-label="Move step down" title="Move down">↓</button>
      <button class="step-item__remove" aria-label="Remove step">×</button>
    </div>
  `;

  // Remove button
  li.querySelector('.step-item__remove').addEventListener('click', () => {
    li.remove();
    renumberSteps();
    syncRecipeFromDOM();
  });

  // Move up
  li.querySelector('.step-item__move--up').addEventListener('click', () => {
    const prev = li.previousElementSibling;
    if (prev) {
      stepsList.insertBefore(li, prev);
      renumberSteps();
      syncRecipeFromDOM();
    }
  });

  // Move down
  li.querySelector('.step-item__move--down').addEventListener('click', () => {
    const next = li.nextElementSibling;
    if (next) {
      stepsList.insertBefore(next, li);
      renumberSteps();
      syncRecipeFromDOM();
    }
  });

  return li;
}


// ============================================================
// Edit Mode
// ============================================================
function toggleEditMode() {
  isEditing = !isEditing;
  setEditMode(isEditing);
}

function setEditMode(editing) {
  isEditing = editing;

  if (editing) {
    setState('editing');
    editBtn.classList.add('active');
    editBtn.querySelector('span').textContent = 'Done';
  } else {
    setState('result');
    editBtn.classList.remove('active');
    editBtn.querySelector('span').textContent = 'Edit';
    syncRecipeFromDOM();
  }

  // Toggle contenteditable on all fields
  const editableFields = [
    recipeTitle,
    recipePrepTime,
    recipeServings,
  ];

  for (const el of editableFields) {
    el.contentEditable = editing ? 'true' : 'false';
  }

  // Show/hide add buttons and step controls
  addIngredientBtn.style.display = editing ? 'block' : 'none';
  addStepBtn.style.display = editing ? 'block' : 'none';

  // Show/hide step move and remove controls
  const stepControls = stepsList.querySelectorAll('.step-item__controls');
  stepControls.forEach(c => c.style.display = editing ? 'flex' : 'none');
  const removeButtons = ingredientsList.querySelectorAll('.ingredient-item__remove');
  removeButtons.forEach(b => b.style.display = editing ? 'flex' : 'none');
}

function syncRecipeFromDOM() {
  if (!currentRecipe) return;

  currentRecipe.title = recipeTitle.textContent.trim();
  currentRecipe.prepTime = recipePrepTime.textContent.trim();
  currentRecipe.servings = parseInt(recipeServings.textContent.trim()) || currentRecipe.servings;

  // Sync ingredients
  currentRecipe.ingredients = [];
  for (const li of ingredientsList.querySelectorAll('.ingredient-item')) {
    const text = li.querySelector('.ingredient-item__text').textContent.trim();
    currentRecipe.ingredients.push({ name: text, quantity: '', notes: '' });
  }

  // Sync steps
  currentRecipe.steps = [];
  let stepNum = 1;
  for (const li of stepsList.querySelectorAll('.step-item')) {
    const text = li.querySelector('.step-item__text').textContent.trim();
    currentRecipe.steps.push({ stepNumber: stepNum++, instruction: text });
  }
}

function renumberSteps() {
  const steps = stepsList.querySelectorAll('.step-item');
  steps.forEach((step, index) => {
    step.querySelector('.step-item__number').textContent = index + 1;
  });
}


// ============================================================
// Sharing
// ============================================================
function handleShareWhatsApp() {
  if (!currentRecipe) return;
  syncRecipeFromDOM();
  shareWhatsApp(currentRecipe);
}

function handleShareTwitter() {
  if (!currentRecipe) return;
  syncRecipeFromDOM();
  shareTwitter(currentRecipe);
}

async function handleCopy() {
  if (!currentRecipe) return;
  syncRecipeFromDOM();
  const success = await copyToClipboard(currentRecipe);
  showToast(success ? 'Recipe copied to clipboard! 📋' : 'Could not copy. Please try manually.');
}


// ============================================================
// Error Handling
// ============================================================
function showError(message) {
  errorMessage.textContent = message;
  setState('error');
}


// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, duration = 2500) {
  toastMessage.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}


// ============================================================
// Utility
// ============================================================
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  waveformCanvas.width = 300 * dpr;
  waveformCanvas.height = 300 * dpr;
  const ctx = waveformCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
}

function getLocalizedLabels(langCode) {
  const labels = {
    kn: { ingredients: 'ಪದಾರ್ಥಗಳು', steps: 'ವಿಧಾನ' },
    hi: { ingredients: 'सामग्री', steps: 'विधि' },
    ta: { ingredients: 'பொருட்கள்', steps: 'செய்முறை' },
    te: { ingredients: 'పదార్థాలు', steps: 'విధానం' },
    ml: { ingredients: 'ചേരുവകൾ', steps: 'രീതി' },
    mr: { ingredients: 'साहित्य', steps: 'कृती' },
    bn: { ingredients: 'উপকরণ', steps: 'পদ্ধতি' },
    gu: { ingredients: 'સામગ્રી', steps: 'રીત' },
    pa: { ingredients: 'ਸਮੱਗਰੀ', steps: 'ਵਿਧੀ' },
    en: { ingredients: 'Ingredients', steps: 'Steps' },
  };
  return labels[langCode] || labels.en;
}

newRecipeBtn.addEventListener('click', () => {
  currentRecipe = null;
  isEditing = false;
  isDraft = false;
  draftMeta = null;
  audioPlayerContainer.style.display = 'none';
  setState('idle');
});

function resetApp() {
  currentRecipe = null;
  isEditing = false;
  isDraft = false;
  draftMeta = null;
  timerDisplay.textContent = '0:00';
  micInstruction.textContent = 'Tap to start recording';
  ingredientsList.innerHTML = '';
  stepsList.innerHTML = '';
  recipeTitle.textContent = '';
  recipePrepTime.textContent = '';
  recipeServings.textContent = '';
  audioPlayerContainer.style.display = 'none';
  audioPlayerContainer.innerHTML = '';
  transcriptSection.style.display = 'none';
  recipeTranscript.textContent = '';
  resetProcessingView();
  setState('idle');
}


// ============================================================
// Drag & Drop
// ============================================================
function setupDragDrop() {
  let dragCounter = 0;

  app.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    app.classList.add('dragover');
  });

  app.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      app.classList.remove('dragover');
    }
  });

  app.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  app.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    app.classList.remove('dragover');

    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  });
}


// ============================================================
// Event Listeners
// ============================================================
function init() {
  // Mic button
  micBtn.addEventListener('click', handleMicClick);

  // File upload
  audioUploadInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files?.[0]);
    audioUploadInput.value = ''; // Reset for re-upload
  });

  // Edit mode
  editBtn.addEventListener('click', toggleEditMode);

  // Add ingredient
  addIngredientBtn.addEventListener('click', () => {
    const newIng = { name: '', quantity: '', notes: '' };
    const li = createIngredientItem(newIng);
    ingredientsList.appendChild(li);
    const textEl = li.querySelector('.ingredient-item__text');
    textEl.contentEditable = 'true';
    textEl.focus();
  });

  // Add step
  addStepBtn.addEventListener('click', () => {
    const stepCount = stepsList.querySelectorAll('.step-item').length;
    const newStep = { stepNumber: stepCount + 1, instruction: '' };
    const li = createStepItem(newStep);
    stepsList.appendChild(li);
    const textEl = li.querySelector('.step-item__text');
    textEl.contentEditable = 'true';
    textEl.focus();
  });

  // Share buttons
  shareWhatsappBtn.addEventListener('click', handleShareWhatsApp);
  shareTwitterBtn.addEventListener('click', handleShareTwitter);
  copyBtn.addEventListener('click', handleCopy);

  // New recipe
  newRecipeBtn.addEventListener('click', resetApp);

  // Retry
  retryBtn.addEventListener('click', resetApp);

  // Drag & drop
  setupDragDrop();

  // Duration tip dismiss
  if (durationTipClose) {
    durationTipClose.addEventListener('click', () => {
      durationTip.classList.add('hidden');
    });
  }

  // Set initial state
  setState('idle');

  console.log('🍳 TalknTaste initialized');
}

// ============================================================
// Discard / Publish
// ============================================================
discardBtn.addEventListener('click', () => {
  showToast('Recipe discarded');
  resetApp();
});

publishBtn.addEventListener('click', async () => {
  if (!currentRecipe || !draftMeta) return;

  syncRecipeFromDOM();
  publishBtn.disabled = true;
  publishBtn.querySelector('span').textContent = 'Publishing…';

  try {
    await saveRecipeToServer({
      recipe: currentRecipe,
      transcript: draftMeta.transcript,
      language: draftMeta.language,
      audioPath: draftMeta.audioPath,
      originalName: draftMeta.originalName,
      authorName: draftMeta.authorName,
    });
    showToast('Recipe published! 🎉');
    isDraft = false;
    draftMeta = null;
    // Switch to library actions
    draftActions.style.display = 'none';
    libraryActions.style.display = 'flex';
  } catch (error) {
    console.error('Publish error:', error);
    showToast('Failed to publish. Please try again.');
  } finally {
    publishBtn.disabled = false;
    publishBtn.querySelector('span').textContent = 'Publish';
  }
});

// ============================================================
// Search in Library
// ============================================================
searchBtn.addEventListener('click', () => {
  const isHidden = searchBar.classList.contains('hidden');
  searchBar.classList.toggle('hidden');
  if (isHidden) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    // Reset to show all (respecting current tag filter)
    applyFilter(activeFilter, filterChipsContainer?.querySelector('.filter-chip.active'));
  }
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  let base = currentDatabaseRecipes;

  // Apply tag filter first
  if (activeFilter !== 'All') {
    base = base.filter(r =>
      r._normalizedTags && r._normalizedTags.some(t => t.toLowerCase() === activeFilter.toLowerCase())
    );
  }

  // Then apply text search
  if (query) {
    base = base.filter(r =>
      (r.title || '').toLowerCase().includes(query) ||
      (r.author_name || '').toLowerCase().includes(query)
    );
  }

  renderFilteredCards(base);
});

// Boot the app
init();
