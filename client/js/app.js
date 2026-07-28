/**
 * app.js — Main application controller & state machine
 *
 * States: idle → recording → processing → result → editing
 */

import { AudioRecorder, formatTime } from './recorder.js';
import { processAudio, fetchRecipes, wakeUpBackend, saveRecipeToServer, updateRecipeOnServer } from './api.js';
import { shareWhatsApp, shareTwitter, copyToClipboard } from './share.js';

// Wake up backend immediately to avoid cold start delays
wakeUpBackend();

// ============================================================
// DOM References
// ============================================================
const app = document.getElementById('app');

// Input view
const micBtn = document.getElementById('mic-btn');
const micInstruction = document.getElementById('mic-instruction');
const timerDisplay = document.getElementById('timer-display');
const waveformCanvas = document.getElementById('waveform-canvas');
const audioUploadInput = document.getElementById('audio-upload');
const durationTip = document.getElementById('duration-tip');
const navRecordBtn = document.getElementById('nav-record-btn');
const navLibraryBtn = document.getElementById('nav-library-btn');

// User preferences (stored from onboarding)
let userName = localStorage.getItem('talkntaste_username') || '';
let userLanguage = localStorage.getItem('talkntaste_language') || '';

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

// Transcript Review view
const reviewTranscriptText = document.getElementById('review-transcript-text');
const reviewAudioContainer = document.getElementById('review-audio-container');
const reviewRetryBtn = document.getElementById('review-retry-btn');
const reviewProceedBtn = document.getElementById('review-proceed-btn');

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
const backToLibraryBtn = document.getElementById('back-to-library-btn');

// Search
const searchBtn = document.getElementById('search-btn');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');

// Error
const errorMessage = document.getElementById('error-message');

// Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Onboarding
const onboardingOverlay = document.getElementById('onboarding-overlay');
const onboardingCardTour = document.getElementById('onboarding-card-tour');
const onboardingCardSetup = document.getElementById('onboarding-card-setup');
const onboardingStartBtn = document.getElementById('onboarding-start-btn');
const onboardingDemoBtn = document.getElementById('onboarding-demo-btn');
const onboardingNameInput = document.getElementById('onboarding-name-input');
const onboardingLangSelect = document.getElementById('onboarding-lang-select');
const onboardingDoneBtn = document.getElementById('onboarding-done-btn');

// Confetti
const confettiContainer = document.getElementById('confetti-container');

// Serving control
const servingControl = document.getElementById('serving-control');
const servingMinusBtn = document.getElementById('serving-minus-btn');
const servingPlusBtn = document.getElementById('serving-plus-btn');
const servingMultiplier = document.getElementById('serving-multiplier');

// Native share
const shareNativeBtn = document.getElementById('share-native-btn');


// ============================================================
// Initialize
// ============================================================
// User name & language are now stored from onboarding (variables above)

// ============================================================
// Theme Toggle (system-default, manual override)
// ============================================================
const themeToggleBtn = document.getElementById('theme-toggle-btn');

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// On load: restore manual preference or respect system
const savedTheme = localStorage.getItem('talkntaste_theme');
if (savedTheme === 'dark' || savedTheme === 'light') {
  applyTheme(savedTheme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Determine effective current mode
    const isDark = currentTheme === 'dark' || (!currentTheme && systemDark);
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('talkntaste_theme', next);
  });
}

// Listen for system theme changes and auto-apply if user hasn't overridden
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const manual = localStorage.getItem('talkntaste_theme');
  if (!manual) {
    document.documentElement.removeAttribute('data-theme');
  }
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
    if (newState === 'database' || ((newState === 'result' || newState === 'editing') && !isDraft)) {
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
    } else if (state === 'transcript-review') {
      reviewProceedBtn.focus();
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
    await processRecording(result.blob, result.duration, userLanguage);
  }
}

function handleMicClick() {
  if (onboardingOverlay && !onboardingOverlay.classList.contains('hidden')) {
    hideOnboarding();
  }
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

  // Show database view immediately with skeleton cards
  setState('database');
  showSkeletonCards(4);

  try {
    const recipes = await fetchRecipes();
    renderDatabase(recipes);
  } catch (error) {
    recipeCarousel.innerHTML = `<p style="color:var(--text-dim); text-align:center; padding: 2rem 1rem;">
      Couldn't load recipes. Check your connection and try again.
    </p>`;
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

// Back to library from result view
if (backToLibraryBtn) {
  backToLibraryBtn.addEventListener('click', () => {
    if (isEditing) setEditMode(false);
    setState('database');
  });
}

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

function showSkeletonCards(count = 4) {
  recipeCarousel.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const skel = document.createElement('div');
    skel.className = 'rmc-skeleton';
    recipeCarousel.appendChild(skel);
  }
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
      authorStr = `<span class="rmc-author">${escapeHtml(recipe.author_name)}</span>`;
    }
    
    card.innerHTML = `
      <div class="rmc-accent"></div>
      <div class="rmc-content">
        <h3 class="rmc-title"><svg class="rmc-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M7 2v3h6V2"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="11" x2="12" y2="11"/><line x1="6" y1="14" x2="10" y2="14"/></svg> ${escapeHtml(recipe.title || 'Untitled')}</h3>
        <div class="rmc-meta">
          ${authorStr}${authorStr ? '<span class="rmc-meta-divider"></span>' : ''}
          <span class="rmc-meta-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="8" cy="8" r="6"/><polyline points="8 5 8 8 10 10"/></svg>
            ${escapeHtml(recipe.prep_time || '—')}
          </span>
          <span class="rmc-meta-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M10 2H6a1 1 0 0 0-1 1v2h6V3a1 1 0 0 0-1-1z"/><path d="M2 4v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4H2z"/></svg>
            ${escapeHtml(recipe.servings || '—')}
          </span>
          ${hasAudio ? '<span class="rmc-meta-item" title="Has Audio"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M12 5v6a4 4 0 0 1-8 0V5"/><line x1="8" y1="1" x2="8" y2="5"/></svg></span>' : ''}
        </div>
        <div class="rmc-tags">
          ${tagsHtml}
        </div>
      </div>
    `;
    
    // Store recipe data on the card element for tap handling
    card.recipeData = recipe;
    card.addEventListener('click', () => handleCardTap(recipe));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCardTap(recipe);
      }
    });
    
    cards.push(card);
    recipeCarousel.appendChild(card);
  });
}

// Scroll listener removed for vertical list

function handleCardTap(recipe) {
  currentRecipe = {
    id: recipe.id,
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
  
  // Show back-to-library button (library context)
  if (backToLibraryBtn) backToLibraryBtn.style.display = 'flex';
  
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
const MAX_AUDIO_DURATION = 300; // 5 minutes

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

  const isImageOrVideo = file.type.startsWith('image/') || file.type.startsWith('video/');
  const isAudioExt = file.name.match(/\.(mp3|wav|webm|m4a|ogg|flac|aac|opus)$/i);
  const isAudioMime = file.type.startsWith('audio/');

  if (isImageOrVideo || (!isAudioMime && !isAudioExt)) {
    showToast('Please select an audio file (MP3, WAV, M4A, WEBM, OGG, FLAC)');
    return;
  }

  // Client-side duration check
  const duration = await getAudioDuration(file);
  if (duration !== null && duration > MAX_AUDIO_DURATION) {
    showToast(`Audio is too long (${Math.round(duration)}s). Please keep it under 5 minutes.`);
    return;
  }

  processRecording(file, duration, userLanguage);
}


// ============================================================
// Processing Pipeline
// ============================================================
import { transcribeAudio, structureRecipe } from './api.js';

let pendingAudioBlob = null;
let pendingLanguageHint = '';
let pendingAuthorName = '';
let pendingTranscriptionData = null;

async function processRecording(audioBlob, knownDuration = null, languageHint = '') {
  setState('processing');
  resetProcessingView();
  
  pendingAudioBlob = audioBlob;
  pendingLanguageHint = languageHint;

  // Show batch mode messaging if audio is long
  const isBatchMode = knownDuration !== null && knownDuration > 30;
  if (isBatchMode && stepTranscribeLabel) {
    stepTranscribeLabel.textContent = 'Processing longer audio…';
  }

  try {
    // Activate first step indicator
    stepTranscribe.classList.add('active');
    
    pendingAuthorName = userName || `Anon-${Math.floor(1000 + Math.random() * 9000)}`;

    const data = await transcribeAudio(audioBlob, languageHint);

    if (!data.transcript) {
      throw new Error('Could not extract any text from the audio. Please try again with clearer audio.');
    }

    // Transition immediately to structuring
    stepTranscribe.classList.add('done');
    stepTranscribe.classList.remove('active');
    stepStructure.classList.add('active');

    const recipeData = await structureRecipe(data.transcript, data.detectedLanguage || data.language);

    draftMeta = {
      transcript: data.transcript,
      language: data.detectedLanguage || data.language,
      audioPath: data.audioPath,
      originalName: data.originalName,
      authorName: pendingAuthorName,
    };

    currentRecipe = recipeData.recipe;
    isDraft = true;

    // Create local object URL for instant playback
    const localAudioUrl = URL.createObjectURL(audioBlob);
    audioPlayerContainer.innerHTML = '<audio id="recipe-audio" controls style="width:100%; border-radius: 8px;"></audio>';
    document.getElementById('recipe-audio').src = localAudioUrl;
    audioPlayerContainer.style.display = 'block';

    renderRecipe(currentRecipe);
    setState('result');

  } catch (error) {
    console.error('Processing error:', error);
    showError(error.message || 'Something went wrong. Please try again.');
    setState('idle');
  }
}

// Wire up Transcript Review actions
if (reviewRetryBtn) {
  reviewRetryBtn.addEventListener('click', () => {
    setState('idle');
  });
}

if (reviewProceedBtn) {
  reviewProceedBtn.addEventListener('click', async () => {
    if (!pendingTranscriptionData) return;

    setState('processing');
    
    // Mark transcription as done, activate structuring
    stepTranscribe.classList.remove('active');
    stepTranscribe.classList.add('done');
    stepStructure.classList.add('active');

    // Show transcript preview in processing view
    transcriptText.textContent = pendingTranscriptionData.transcript;
    transcriptPreview.classList.add('visible');

    try {
      const data = pendingTranscriptionData;
      const structureRes = await structureRecipe(data.transcript, data.detectedLanguage || data.language);

      // Mark structuring as done
      stepStructure.classList.remove('active');
      stepStructure.classList.add('done');

      // Short delay for visual feedback before showing result
      await new Promise(resolve => setTimeout(resolve, 600));

      // Render the recipe as a draft (not yet saved)
      currentRecipe = structureRes.recipe;
      isDraft = true;
      draftMeta = {
        transcript: data.transcript,
        language: data.detectedLanguage || data.language,
        audioPath: data.audioPath,
        originalName: data.originalName,
        authorName: pendingAuthorName,
      };
      renderRecipe(currentRecipe);
      
      // Display local audio for draft
      const localAudioUrl = URL.createObjectURL(pendingAudioBlob);
      audioPlayerContainer.innerHTML = '<audio id="recipe-audio" controls style="width:100%; border-radius: 8px;"></audio>';
      document.getElementById('recipe-audio').src = localAudioUrl;
      audioPlayerContainer.style.display = 'block';

      // Hide back-to-library button (draft context)
      if (backToLibraryBtn) backToLibraryBtn.style.display = 'none';

      setState('result');

    } catch (error) {
      console.error('Structuring error:', error);
      showError(error.message || 'Something went wrong during structuring. Please try again.');
    }
  });
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
  resetServingMultiplier();

  // Store original ingredient data for serving scaling
  if (recipe.ingredients) {
    originalIngredients = recipe.ingredients.map(ing => ({
      name: ing.name,
      quantity: ing.quantity || '',
      notes: ing.notes || '',
    }));
  }

  // Show serving control if at least one ingredient has a numeric quantity
  const hasNumericQty = originalIngredients.some(ing => {
    const qty = parseFloat(ing.quantity);
    return !isNaN(qty);
  });
  if (servingControl) {
    servingControl.style.display = hasNumericQty ? 'inline-flex' : 'none';
  }

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

  // Show contextual action bar
  if (isDraft) {
    draftActions.style.display = 'flex';
    libraryActions.style.display = 'none';
  } else {
    draftActions.style.display = 'none';
    libraryActions.style.display = 'flex';
  }

  // Additional Info
  const additionalInfoText = recipe.additionalInfo || recipe.additional_info;
  const additionalInfoSection = document.getElementById('additional-info-section');
  const additionalInfoEl = document.getElementById('recipe-additional-info');
  
  if (additionalInfoText) {
    additionalInfoEl.textContent = additionalInfoText;
    additionalInfoSection.style.display = 'block';
  } else {
    additionalInfoEl.textContent = '';
    additionalInfoSection.style.display = 'none';
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

  let text = `${ingredient.quantity} ${ingredient.name}`.trim();
  if (ingredient.notes) text += ` (${ingredient.notes})`;

  li.innerHTML = `
    <span class="ingredient-item__bullet" aria-hidden="true">✓</span>
    <span class="ingredient-item__text" contenteditable="false">${escapeHtml(text)}</span>
    <button class="ingredient-item__remove" aria-label="Remove ingredient">×</button>
  `;

  // Remove button
  li.querySelector('.ingredient-item__remove').addEventListener('click', () => {
    li.remove();
    syncRecipeFromDOM();
  });

  // Click-to-check logic
  li.addEventListener('click', (e) => {
    if (isEditing) return;
    if (e.target.closest('.ingredient-item__remove')) return;
    li.classList.toggle('checked');
  });

  // Swipe-to-check logic
  let touchStartX = 0;
  let touchEndX = 0;
  
  li.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, {passive: true});
  
  li.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    if (isEditing) return;
    if (Math.abs(touchStartX - touchEndX) > 40) {
      li.classList.toggle('checked');
    }
  }, {passive: true});

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
  const wasEditing = isEditing;
  isEditing = editing;

  if (editing) {
    setState('editing');
    editBtn.classList.add('active');
    editBtn.querySelector('span').textContent = 'Done';
  } else {
    setState('result');
    editBtn.classList.remove('active');
    editBtn.querySelector('span').textContent = 'Edit';
    if (wasEditing) {
      syncRecipeFromDOM();
      handleRecipeEditSaved();
    }
  }

  // Toggle contenteditable on all header fields
  const editableFields = [
    recipeTitle,
    recipePrepTime,
    recipeServings,
  ];

  for (const el of editableFields) {
    el.contentEditable = editing ? 'true' : 'false';
  }

  // Toggle contenteditable on ingredients and steps
  ingredientsList.querySelectorAll('.ingredient-item__text').forEach(el => {
    el.contentEditable = editing ? 'true' : 'false';
  });
  stepsList.querySelectorAll('.step-item__text').forEach(el => {
    el.contentEditable = editing ? 'true' : 'false';
  });

  // Show/hide add buttons and step controls
  addIngredientBtn.style.display = editing ? 'block' : 'none';
  addStepBtn.style.display = editing ? 'block' : 'none';

  // Show/hide step move and remove controls
  const stepControls = stepsList.querySelectorAll('.step-item__controls');
  stepControls.forEach(c => c.style.display = editing ? 'flex' : 'none');
  const removeButtons = ingredientsList.querySelectorAll('.ingredient-item__remove');
  removeButtons.forEach(b => b.style.display = editing ? 'flex' : 'none');
}

async function handleRecipeEditSaved() {
  if (!currentRecipe) return;

  if (currentRecipe.id) {
    try {
      await updateRecipeOnServer(currentRecipe.id, currentRecipe);
      showToast('Recipe updated! ✏️');
    } catch (err) {
      console.error('[App] Failed to update recipe on server:', err);
      showToast('Could not save changes to server.');
    }

    // Update local cache of database recipes
    const idx = currentDatabaseRecipes.findIndex(r => r.id === currentRecipe.id);
    if (idx !== -1) {
      currentDatabaseRecipes[idx] = {
        ...currentDatabaseRecipes[idx],
        title: currentRecipe.title,
        prep_time: currentRecipe.prepTime,
        servings: currentRecipe.servings,
        ingredients: currentRecipe.ingredients,
        steps: currentRecipe.steps,
      };
    }

    // Re-render filtered cards on recipe tab / database view
    const activeChip = filterChipsContainer?.querySelector('.filter-chip.active');
    applyFilter(activeFilter, activeChip);
  }
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

  // Sync additional info / story
  const additionalInfoEl = document.getElementById('recipe-additional-info');
  if (additionalInfoEl) {
    currentRecipe.additionalInfo = additionalInfoEl.textContent.trim();
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
function showToast(message, duration = 2500, action = null) {
  toastMessage.textContent = message;
  toast.classList.add('show');
  toast.classList.remove('toast--undo');

  // Remove any existing action button
  const existingAction = toast.querySelector('.toast__action');
  if (existingAction) existingAction.remove();

  if (action) {
    toast.classList.add('toast--undo');
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast__action';
    actionBtn.textContent = action.label;
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.onClick();
      toast.classList.remove('show');
    });
    toast.appendChild(actionBtn);
  }

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
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
  resetServingMultiplier();
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
  if (backToLibraryBtn) backToLibraryBtn.style.display = 'none';
  resetProcessingView();
  resetServingMultiplier();
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
// ============================================================
// Onboarding
// ============================================================
function showOnboarding() {
  if (onboardingCardTour) onboardingCardTour.classList.remove('hidden');
  if (onboardingCardSetup) onboardingCardSetup.classList.add('hidden');
  if (onboardingOverlay) onboardingOverlay.classList.remove('hidden');
}
function hideOnboarding() {
  if (onboardingOverlay) onboardingOverlay.classList.add('hidden');
  localStorage.setItem('talkntaste_onboarding_seen', 'true');
}
function showSetupStep() {
  if (onboardingCardTour) onboardingCardTour.classList.add('hidden');
  if (onboardingCardSetup) onboardingCardSetup.classList.remove('hidden');
  // Pre-fill saved values
  if (onboardingNameInput && userName) onboardingNameInput.value = userName;
  if (onboardingLangSelect && userLanguage) onboardingLangSelect.value = userLanguage;
}
function completeSetup() {
  const name = onboardingNameInput ? onboardingNameInput.value.trim() : '';
  const lang = onboardingLangSelect ? onboardingLangSelect.value : '';
  if (name) {
    userName = name;
    localStorage.setItem('talkntaste_username', name);
  } else {
    userName = '';
    localStorage.removeItem('talkntaste_username');
  }
  if (lang) {
    userLanguage = lang;
    localStorage.setItem('talkntaste_language', lang);
  } else {
    userLanguage = '';
    localStorage.removeItem('talkntaste_language');
  }
  hideOnboarding();
}

async function showDemoRecipe() {
  hideOnboarding();
  const demoRecipe = {
    title: 'Masala Dosa',
    prepTime: '30 mins',
    servings: '4',
    languageName: 'Kannada',
    language: 'kn',
    ingredients: [
      { name: 'rice (parboiled)', quantity: '2 cups', notes: 'soaked 4hrs' },
      { name: 'urad dal', quantity: '½ cup', notes: 'soaked 4hrs' },
      { name: 'fenugreek seeds', quantity: '1 tsp' },
      { name: 'salt', quantity: 'to taste' },
      { name: 'potatoes', quantity: '4 medium', notes: 'boiled' },
      { name: 'onion', quantity: '1 large', notes: 'finely chopped' },
      { name: 'green chilies', quantity: '2-3', notes: 'chopped' },
      { name: 'mustard seeds', quantity: '1 tsp' },
      { name: 'curry leaves', quantity: 'few' },
      { name: 'turmeric', quantity: '¼ tsp' },
    ],
    steps: [
      { stepNumber: 1, instruction: 'Grind soaked rice and urad dal with fenugreek seeds to a smooth batter. Ferment overnight.' },
      { stepNumber: 2, instruction: 'For the filling, mash boiled potatoes. Heat oil, add mustard seeds, curry leaves, onion, and green chilies. Add turmeric, salt, and mashed potatoes. Mix well.' },
      { stepNumber: 3, instruction: 'Heat a non-stick tawa. Pour a ladle of batter and spread in a circular motion. Drizzle oil around the edges.' },
      { stepNumber: 4, instruction: 'Place a spoonful of potato filling in the center. Fold the dosa over it.' },
      { stepNumber: 5, instruction: 'Cook until golden brown. Serve hot with coconut chutney and sambar.' },
    ],
    transcript: 'To make masala dosa, first soak 2 cups of parboiled rice and half cup urad dal with 1 teaspoon fenugreek seeds for 4 hours. Grind to a smooth batter and ferment overnight. For the potato filling, boil 4 medium potatoes. In a pan, heat oil, add mustard seeds, curry leaves, chopped onion, and green chilies. Add turmeric powder, salt, and mashed potatoes. Mix well. Heat a tawa, pour a ladle of batter and spread thin. Drizzle oil. Place the filling in the center and fold. Cook till golden. Serve with chutney and sambar.',
    additionalInfo: 'This is my grandmother\'s recipe — she made the crispiest dosas in our neighborhood. The key is the fermentation time; in colder weather, let the batter ferment for a full 24 hours.',
  };
  currentRecipe = demoRecipe;
  isDraft = false;
  draftMeta = null;
  renderRecipe(demoRecipe);
  if (backToLibraryBtn) backToLibraryBtn.style.display = 'none';
  audioPlayerContainer.style.display = 'none';
  setState('result');
}


// ============================================================
// Confetti
// ============================================================
function fireConfetti(count = 40) {
  if (!confettiContainer) return;
  const colors = ['#2563EB', '#3B82F6', '#60A5FA', '#059669', '#34D399', '#6EE7B7', '#93C5FD'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 10;
    piece.style.width = size + 'px';
    piece.style.height = size + 'px';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (2 + Math.random() * 3) + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    confettiContainer.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}


// ============================================================
// Serving Multiplier
// ============================================================
let servingMultiplierValue = 1;
let originalIngredients = [];

function updateServingMultiplier(delta) {
  const newVal = servingMultiplierValue + delta;
  if (newVal < 0.5 || newVal > 8) return;
  servingMultiplierValue = newVal;
  servingMultiplier.textContent = servingMultiplierValue;

  // Recalculate ingredient quantities
  const items = ingredientsList.querySelectorAll('.ingredient-item');
  items.forEach((item, i) => {
    const textEl = item.querySelector('.ingredient-item__text');
    if (i < originalIngredients.length) {
      const orig = originalIngredients[i];
      let newText = '';
      if (orig.quantity) {
        const qty = parseFloat(orig.quantity);
        if (!isNaN(qty)) {
          const scaled = (qty * servingMultiplierValue).toFixed(
            qty % 1 === 0 ? 0 : qty < 1 ? 2 : 1
          );
          const unit = orig.quantity.replace(/[\d.\s]+/g, '').trim();
          newText = `${scaled}${unit ? ' ' + unit : ''} ${orig.name}`.trim();
        } else {
          newText = `${orig.quantity} ${orig.name}`.trim();
        }
      } else {
        newText = orig.name;
      }
      if (orig.notes) newText += ` (${orig.notes})`;
      textEl.textContent = newText;
    }
  });
}

function resetServingMultiplier() {
  servingMultiplierValue = 1;
  originalIngredients = [];
  if (servingMultiplier) servingMultiplier.textContent = '1';
  if (servingControl) servingControl.style.display = 'none';
}


// ============================================================
// Init
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

  // Duration tip auto-dismiss after 6s
  if (durationTip) {
    setTimeout(() => durationTip.classList.add('hidden'), 6000);
  }

  // Onboarding
  if (onboardingStartBtn) {
    onboardingStartBtn.addEventListener('click', showSetupStep);
  }
  if (onboardingDemoBtn) {
    onboardingDemoBtn.addEventListener('click', showDemoRecipe);
  }
  if (onboardingDoneBtn) {
    onboardingDoneBtn.addEventListener('click', completeSetup);
  }
  if (onboardingLangSelect) {
    onboardingLangSelect.addEventListener('change', (e) => {
      userLanguage = e.target.value;
      localStorage.setItem('talkntaste_language', userLanguage);
    });
  }

  // Check onboarding
  const onboardingSeen = localStorage.getItem('talkntaste_onboarding_seen');
  if (!onboardingSeen) {
    setTimeout(showOnboarding, 400);
  }

  // Prevent dismissing setup by clicking overlay — user must tap Done
  if (onboardingOverlay && onboardingCardSetup) {
    onboardingOverlay.addEventListener('click', (e) => {
      if (e.target === onboardingOverlay && !onboardingCardSetup.classList.contains('hidden')) return;
      if (e.target === onboardingOverlay) hideOnboarding();
    });
    document.addEventListener('keydown', function onOboardKey(e) {
      if (e.key === 'Escape' && !onboardingOverlay.classList.contains('hidden')) {
        if (!onboardingCardSetup.classList.contains('hidden')) return;
        hideOnboarding();
      }
    });
  }

  // Native share
  if (shareNativeBtn && navigator.share) {
    shareNativeBtn.style.display = 'flex';
    shareNativeBtn.addEventListener('click', async () => {
      if (!currentRecipe) return;
      syncRecipeFromDOM();
      const { shareNative } = await import('./share.js');
      const ok = await shareNative(currentRecipe);
      if (!ok) showToast('Share cancelled');
    });
  }

  // Serving controls
  if (servingMinusBtn) {
    servingMinusBtn.addEventListener('click', () => updateServingMultiplier(-0.5));
  }
  if (servingPlusBtn) {
    servingPlusBtn.addEventListener('click', () => updateServingMultiplier(0.5));
  }

  // Set initial state
  setState('idle');

  console.log('🍳 TalknTaste initialized');
}

// ============================================================
// Discard / Publish
// ============================================================
discardBtn.addEventListener('click', () => {
  const discardedRecipe = currentRecipe;
  const discardedMeta = draftMeta;
  resetApp();
  showToast('Recipe discarded', 4000, {
    label: 'Undo',
    onClick: () => {
      currentRecipe = discardedRecipe;
      draftMeta = discardedMeta;
      isDraft = true;
      renderRecipe(discardedRecipe);
      draftActions.style.display = 'flex';
      libraryActions.style.display = 'none';
      if (backToLibraryBtn) backToLibraryBtn.style.display = 'none';
      if (discardedMeta && discardedMeta.audioPath) {
        audioPlayerContainer.style.display = 'block';
      }
      setState('result');
      showToast('Recipe restored');
    },
  });
});

publishBtn.addEventListener('click', async () => {
  if (!currentRecipe || !draftMeta) return;

  syncRecipeFromDOM();
  publishBtn.disabled = true;
  publishBtn.querySelector('span').textContent = 'Publishing…';

  try {
    const res = await saveRecipeToServer({
      recipe: currentRecipe,
      transcript: draftMeta.transcript,
      language: draftMeta.language,
      audioPath: draftMeta.audioPath,
      originalName: draftMeta.originalName,
      authorName: draftMeta.authorName,
    });

    if (res && res.recipeId) {
      currentRecipe.id = res.recipeId;
    }

    fireConfetti(50);
    isDraft = false;

    const publishedId = currentRecipe.id;
    showToast('Published!', 4000, {
      label: 'Undo',
      onClick: () => {
        currentDatabaseRecipes = currentDatabaseRecipes.filter(r => r.id !== publishedId);
        renderDatabase(currentDatabaseRecipes);
        isDraft = true;
        showToast('Removed from library');
      },
    });

    // Insert newly published recipe to local database recipes list
    const newDbRecipe = {
      id: currentRecipe.id,
      title: currentRecipe.title,
      prep_time: currentRecipe.prepTime,
      servings: currentRecipe.servings,
      ingredients: currentRecipe.ingredients,
      steps: currentRecipe.steps,
      language: draftMeta.language,
      language_name: currentRecipe.languageName,
      author_name: draftMeta.authorName,
      transcript: draftMeta.transcript,
      audio_path: draftMeta.audioPath,
    };
    currentDatabaseRecipes.unshift(newDbRecipe);
    renderDatabase(currentDatabaseRecipes);

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
