/**
 * chat.js — Chat with your saved recipe library
 *
 * Text + voice input, assistant replies grounded in the user's recipe library
 * (via /api/chat). Conversation history is kept in memory and the last few
 * turns are sent with each request.
 */

import { sendChatMessage, transcribeAudio } from './api.js';
import { AudioRecorder } from './recorder.js';

const MAX_HISTORY_TURNS = 10;

// DOM
const chatView = document.getElementById('chat-view');
const chatThread = document.getElementById('chat-thread');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatMicBtn = document.getElementById('chat-mic-btn');
const chatClearBtn = document.getElementById('chat-clear-btn');
const chatSuggestions = document.getElementById('chat-suggestions');

let history = []; // [{ role, content }]
let isSending = false;
let chatRecorder = null;

/**
 * Append a message bubble to the thread.
 * @param {object} opts
 */
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

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatView?.scrollTo({ top: chatView.scrollHeight, behavior: 'smooth' });
  });
}

/** Persist history to sessionStorage so it survives soft reloads. */
function saveHistory() {
  try {
    sessionStorage.setItem('talkntaste_chat_history', JSON.stringify(history.slice(-MAX_HISTORY_TURNS)));
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
}

function showEmptyState() {
  chatThread.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chat-bubble chat-bubble--assistant chat-bubble--welcome';
  const body = document.createElement('div');
  body.className = 'chat-bubble__body';
  body.textContent = 'Hi! Ask me anything about the recipes you\'ve saved — what to cook tonight, ingredient swaps, or a quick plan for a meal.';
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

function setBusy(busy) {
  isSending = busy;
  if (chatSendBtn) chatSendBtn.disabled = busy;
  if (chatInput) chatInput.disabled = busy;
}

function focusInput() {
  chatInput?.focus({ preventScroll: true });
}

async function handleSend(rawText) {
  const text = (rawText ?? chatInput.value).trim();
  if (!text || isSending) return;

  if (chatInput) chatInput.value = '';
  chatSuggestions?.classList.add('hidden');

  history.push({ role: 'user', content: text });
  appendBubble({ role: 'user', text });
  chatView?.scrollTo({ top: chatView.scrollHeight });

  appendBubble({ role: 'assistant', isTyping: true });
  setBusy(true);

  try {
    const { reply } = await sendChatMessage(history);
    history.push({ role: 'assistant', content: reply });
    chatThread.lastElementChild?.remove();
    appendBubble({ role: 'assistant', text: reply });
    saveHistory();
  } catch (error) {
    console.error('[Chat] send error:', error);
    chatThread.lastElementChild?.remove();
    appendBubble({
      role: 'assistant',
      text: `Sorry, I couldn't reach the kitchen right now. ${error.message || ''}`,
    });
  } finally {
    setBusy(false);
  }
}

// ============================================================
// Voice input — reuse the app's recorder + Sarvam transcription
// ============================================================
async function startVoiceInput() {
  if (chatRecorder) return;

  try {
    chatRecorder = new AudioRecorder();
    chatRecorder.maxDuration = 60; // short queries
    chatRecorder.warningDuration = 45;
    chatRecorder.onWarning = () => showChatHint('Almost time — wrap up!');
    chatRecorder.onMaxReached = () => stopVoiceInput();
    await chatRecorder.start();
    chatMicBtn.classList.add('recording');
    chatMicBtn.setAttribute('aria-label', 'Stop listening');
    showChatHint('Listening… ask away!');
  } catch (error) {
    console.error('[Chat] mic start error:', error);
    chatRecorder = null;
    chatMicBtn.classList.remove('recording');
    showChatHint('Microphone unavailable');
  }
}

async function stopVoiceInput() {
  if (!chatRecorder) return;
  const rec = chatRecorder;
  chatRecorder = null;
  chatMicBtn.classList.remove('recording');
  chatMicBtn.setAttribute('aria-label', 'Speak your question');

  const result = await rec.stop();
  if (!result?.blob) return;

  appendBubble({ role: 'assistant', isTyping: true });
  setBusy(true);
  try {
    const data = await transcribeAudio(result.blob, '');
    chatThread.lastElementChild?.remove();
    if (data?.transcript) {
      handleSend(data.transcript);
    } else {
      showChatHint('Couldn\'t hear that — please try again.');
    }
  } catch (error) {
    console.error('[Chat] voice transcribe error:', error);
    chatThread.lastElementChild?.remove();
    showChatHint('Voice failed — try typing instead.');
  } finally {
    setBusy(false);
  }
}

function showChatHint(message) {
  const hint = document.createElement('div');
  hint.className = 'chat-bubble chat-bubble--assistant chat-bubble--hint';
  hint.textContent = message;
  chatThread.appendChild(hint);
  setTimeout(() => hint.remove(), 2000);
  scrollToBottom();
}

function resetChat() {
  history = [];
  try { sessionStorage.removeItem('talkntaste_chat_history'); } catch { /* noop */ }
  showEmptyState();
  focusInput();
}

// ============================================================
// Init / public API
// ============================================================
export function initChat() {
  restoreHistory();
  renderHistory();

  if (chatSendBtn) chatSendBtn.addEventListener('click', () => handleSend());
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        handleSend();
      }
    });
  }
  if (chatMicBtn) {
    chatMicBtn.addEventListener('click', () => {
      if (chatRecorder) stopVoiceInput();
      else startVoiceInput();
    });
  }
  if (chatClearBtn) chatClearBtn.addEventListener('click', resetChat);

  if (chatSuggestions) {
    chatSuggestions.addEventListener('click', (e) => {
      const chip = e.target.closest('.chat-suggestion');
      if (chip?.dataset.prompt) handleSend(chip.dataset.prompt);
    });
  }
}

/** Called whenever the Ask nav tab becomes active. */
export function activateChat() {
  if (!history.length && !chatThread.children.length) {
    showEmptyState();
  } else {
    renderHistory();
  }
  focusInput();
}