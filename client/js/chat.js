/**
 * chat.js — HelpMeCook: a voice-only, step-by-step cooking co-pilot.
 *
 * You ask a question by voice (tap the mic, speak, and pause). The assistant
 * replies in the same language, grounded in your saved recipe library, and
 * SPEAKS the answer. Tap the mic again while it's talking to interrupt
 * (barge-in) and ask the next thing — it automatically re-listens once the
 * reply has finished.
 */

import { transcribeAudio, speakText } from './api.js';
import { AudioRecorder } from './recorder.js';

const MAX_HISTORY_TURNS = 10;

// Silence-based "end of turn" detection (client-side VAD).
const SILENCE_END_MS = 1600;
const SPEECH_LEVEL = 18; // average byte value from the frequency analyser
const MIN_SPEECH_DURATION_MS = 450;

// DOM
const chatView = document.getElementById('chat-view');
const chatThread = document.getElementById('chat-thread');
const chatMicBtn = document.getElementById('chat-mic-btn');
const chatClearBtn = document.getElementById('chat-clear-btn');
const chatSuggestions = document.getElementById('chat-suggestions');
const chatStatus = document.getElementById('chat-status');

let history = [];          // [{ role, content }]
let lastLanguage = '';     // last STT-detected language (for TTS)
let mode = 'idle';         // 'idle' | 'listening' | 'thinking' | 'speaking'
let chatRecorder = null;
let silenceMonitor = null;
let chatAbort = null;      // AbortController for the in-flight chat request
let audioContext = null;
let currentSource = null;  // currently playing AudioBufferSourceNode

// ============================================================
// Thread rendering
// ============================================================

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatView?.scrollTo({ top: chatView.scrollHeight, behavior: 'smooth' });
  });
}

function appendBubble({ role, text, isTyping = false }) {
  const wrap = document.createElement('div');
  wrap.className = `chat-bubble chat-bubble--${role}`;

  const body = document.createElement('div');
  body.className = 'chat-bubble__body';

  if (isTyping) {
    body.classList.add('chat-bubble__body--typing');
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'chat-bubble__dot';
      body.appendChild(dot);
    }
  } else {
    body.textContent = text;
  }

  wrap.appendChild(body);
  chatThread.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function saveHistory() {
  try {
    sessionStorage.setItem('talkntaste_chat_history', JSON.stringify(history.slice(-MAX_HISTORY_TURNS)));
  } catch { /* non-fatal */ }
  try {
    if (lastLanguage) sessionStorage.setItem('talkntaste_chat_language', lastLanguage);
  } catch { /* non-fatal */ }
}

function restoreHistory() {
  try {
    const raw = sessionStorage.getItem('talkntaste_chat_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    }
  } catch { history = []; }
  try {
    lastLanguage = sessionStorage.getItem('talkntaste_chat_language') || '';
  } catch { lastLanguage = ''; }
}

function showEmptyState() {
  chatThread.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chat-bubble chat-bubble--assistant chat-bubble--welcome';
  const body = document.createElement('div');
  body.className = 'chat-bubble__body';
  body.textContent = 'Namaste! I am Head Chef. Tap the mic and ask me what to cook — I will help you step by step, in your own language.';
  wrap.appendChild(body);
  chatThread.appendChild(wrap);
  chatSuggestions?.classList.remove('hidden');
}

function renderHistory() {
  chatThread.innerHTML = '';
  if (!history.length) {
    showEmptyState();
    return;
  }
  chatSuggestions?.classList.add('hidden');
  history.forEach((m) => appendBubble({ role: m.role, text: m.content }));
}

function showChatHint(message, duration = 2200) {
  const hint = document.createElement('div');
  hint.className = 'chat-bubble chat-bubble--assistant chat-bubble--hint';
  hint.textContent = message;
  chatThread.appendChild(hint);
  setTimeout(() => hint.remove(), duration);
  scrollToBottom();
}

function setStatus(message) {
  if (chatStatus) chatStatus.textContent = message;
  if (chatMicBtn) chatMicBtn.setAttribute('aria-label', message || 'Talk to the chef');
}

function setMicVisual(state) {
  if (!chatMicBtn) return;
  chatMicBtn.classList.toggle('recording', state === 'listening');
  chatMicBtn.classList.toggle('speaking', state === 'speaking');
}

// ============================================================
// Audio playback (Web Audio API) — instant stop for barge-in
// ============================================================

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function stopSpeaking() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function speakReply(text, language = '') {
  stopSpeaking();
  const ctx = ensureAudioContext();

  const { audioBase64 } = await speakText(text, language);
  const arrayBuffer = base64ToArrayBuffer(audioBase64);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  currentSource = source;

  setStatus('Speaking…');
  setMicVisual('speaking');

  return new Promise((resolve) => {
    const onEnd = () => {
      if (source === currentSource) {
        currentSource = null;
      }
      source.onended = null;
      resolve();
    };
    source.onended = onEnd;
    source.start();
  });
}

// ============================================================
// Recording with silence-based auto-stop
// ============================================================

function stopSilenceMonitor() {
  if (silenceMonitor) {
    clearInterval(silenceMonitor);
    silenceMonitor = null;
  }
}

function startSilenceMonitor(recorder) {
  let voiced = false;
  let speechStart = null;
  let silentSince = null;

  silenceMonitor = setInterval(() => {
    const data = recorder.getFrequencyData();
    if (!data) return;

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    const speaking = avg > SPEECH_LEVEL;

    if (speaking) {
      if (!voiced) speechStart = Date.now();
      voiced = true;
      silentSince = null;
      return;
    }

    if (!voiced) return; // never spoke yet — keep waiting

    if (silentSince === null) {
      silentSince = Date.now();
      return;
    }

    const spokeLongEnough = (speechStart !== null && Date.now() - speechStart >= MIN_SPEECH_DURATION_MS);
    if (spokeLongEnough && Date.now() - silentSince >= SILENCE_END_MS) {
      stopSilenceMonitor();
      stopListening();
    }
  }, 120);
}

async function startListening() {
  if (mode === 'listening') return;

  // Barge-in / interrupt paths: stop whatever we're doing first.
  if (mode === 'thinking') {
    chatAbort?.abort();
    chatAbort = null;
    chatThread.lastElementChild?.remove();
  }
  if (mode === 'speaking') {
    stopSpeaking();
  }

  try {
    chatRecorder = new AudioRecorder();
    chatRecorder.maxDuration = 60; // long rambling questions, then auto-send
    chatRecorder.warningDuration = 50;
    chatRecorder.onMaxReached = () => stopListening();
    await chatRecorder.start();
    mode = 'listening';

    // Warm up the audio context inside this user gesture (autoplay policy).
    ensureAudioContext();

    setStatus('Listening…');
    setMicVisual('listening');
    chatClearBtn?.setAttribute('disabled', 'true');

    startSilenceMonitor(chatRecorder);
  } catch (error) {
    console.error('[HelpMeCook] mic start error:', error);
    chatRecorder = null;
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Microphone unavailable — tap to retry');
  }
}

async function stopListening() {
  if (!chatRecorder || mode !== 'listening') return;

  const rec = chatRecorder;
  chatRecorder = null;
  stopSilenceMonitor();
  chatClearBtn?.removeAttribute('disabled');

  const result = await rec.stop();
  const blob = result?.blob;
  const duration = result?.duration || 0;

  if (duration < 0.4 || !blob) {
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    return;
  }

  setStatus('Understanding you…');
  setMicVisual('idle');

  try {
    const data = await transcribeAudio(blob, '');
    const transcript = data?.transcript?.trim();
    lastLanguage = data?.language || lastLanguage || '';

    if (!transcript) {
      mode = 'idle';
      setStatus('Tap to talk');
      showChatHint('Could not hear that — please try again.');
      return;
    }

    await handleTurn(transcript);
  } catch (error) {
    console.error('[HelpMeCook] transcribe error:', error);
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    showChatHint('Sorry, I did not catch that. Please try once more.');
  }
}

// ============================================================
// Conversation turn
// ============================================================

async function handleTurn(userText) {
  const text = userText.trim();
  if (!text) {
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    return;
  }

  chatSuggestions?.classList.add('hidden');

  history.push({ role: 'user', content: text });
  appendBubble({ role: 'user', text });
  saveHistory();

  appendBubble({ role: 'assistant', isTyping: true });
  mode = 'thinking';
  setStatus('Hmm, let me check your recipes…');
  setMicVisual('idle');

  chatAbort = new AbortController();
  let reply = '';
  try {
    const data = await fetchChat(chatAbort.signal);
    reply = data.reply || '';
  } catch (error) {
    if (error?.name === 'AbortError') return; // user barged in
    console.error('[HelpMeCook] chat error:', error);
    chatThread.lastElementChild?.remove();
    showChatHint('Sorry, I could not reach your recipe library. Please try again.');
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    return;
  } finally {
    chatAbort = null;
  }

  if (!reply.trim()) {
    chatThread.lastElementChild?.remove();
    showChatHint('I got nothing from the pantry — please ask again.');
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    return;
  }

  history.push({ role: 'assistant', content: reply });
  chatThread.lastElementChild?.remove();
  appendBubble({ role: 'assistant', text: reply });
  saveHistory();

  // Speak the reply; then auto-relisten for the next step.
  mode = 'speaking';
  setStatus('Speaking…');
  setMicVisual('speaking');
  try {
    await speakReply(reply, lastLanguage);
  } catch (error) {
    console.error('[HelpMeCook] TTS error:', error);
    showChatHint('(Speech unavailable — please tap the mic to continue.)', 3000);
  }

  // If the user didn't barge in during/after playback, start listening again.
  if (mode === 'speaking' && !chatRecorder) {
    mode = 'idle';
    setMicVisual('idle');
    setStatus('Tap to talk');
    startListening();
  }
}

async function fetchChat(signal) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: history,
      ...(lastLanguage ? { language: lastLanguage } : {}),
    }),
    signal,
  });
  return response.json();
}

// ============================================================
// Init / public API
// ============================================================

function resetChat() {
  stopSpeaking();
  stopSilenceMonitor();
  chatAbort?.abort();
  chatAbort = null;
  if (chatRecorder && mode === 'listening') {
    chatRecorder.stop().catch?.(() => {});
  }
  chatRecorder = null;
  mode = 'idle';
  history = [];
  lastLanguage = '';
  try { sessionStorage.removeItem('talkntaste_chat_history'); } catch { /* noop */ }
  try { sessionStorage.removeItem('talkntaste_chat_language'); } catch { /* noop */ }
  showEmptyState();
  setMicVisual('idle');
  setStatus('Tap to talk');
  if (chatMicBtn) {
    chatMicBtn.classList.remove('recording', 'speaking');
    chatMicBtn.setAttribute('aria-label', 'Talk to the chef');
  }
}

export function initChat() {
  restoreHistory();
  renderHistory();

  if (chatMicBtn) {
    chatMicBtn.addEventListener('click', () => {
      if (mode === 'listening') {
        stopListening();
      } else {
        startListening();
      }
    });
  }
  if (chatClearBtn) chatClearBtn.addEventListener('click', resetChat);

  if (chatSuggestions) {
    chatSuggestions.addEventListener('click', (e) => {
      const chip = e.target.closest('.chat-suggestion');
      if (chip?.dataset.prompt) handleTurn(chip.dataset.prompt);
    });
  }
}

/** Called whenever the HelpMeCook nav tab becomes active. */
export function activateChat() {
  if (!history.length && !chatThread.children.length) {
    showEmptyState();
  } else {
    renderHistory();
  }
  setStatus(mode === 'listening' ? 'Listening…' : mode === 'speaking' ? 'Speaking…' : 'Tap to talk');
}