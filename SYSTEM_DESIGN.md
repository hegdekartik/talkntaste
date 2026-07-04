# TalknTaste - System Design & Implementation Guide

## 1. Overview
TalknTaste is a web application that allows users to speak a recipe in any Indian language and instantly get a structured, shareable recipe card. It uses advanced Speech-to-Text (STT) and Large Language Models (LLMs) to transcribe spoken audio, structure it into a clean JSON recipe format (while preserving the original language), and save it to a database.

## 2. Tech Stack & Architecture

### Frontend
- **HTML/CSS/Vanilla JS**: Keeps the client lightweight and performant.
- **Vite**: Build tool for local development and bundling.
- **MediaRecorder API**: For capturing audio from the microphone.
- **State Machine**: Custom state management (`app.js`) handling UI transitions (`idle` → `recording` → `processing` → `result` ↔ `editing`).

### Backend (Serverless API)
- **Vercel Serverless Functions**: Hosts the API routes (`/api/...`). Configured with `maxDuration: 120` to allow for longer processing.
- **Node.js**: Runtime for backend logic.

### Third-Party Integrations
- **Sarvam AI (saaras:v3)**: Specialized STT for Indian languages. Used for transcribing audio.
- **OpenAI (GPT-4o-mini)**: Used for structuring raw, unstructured transcripts into strict JSON formats (Recipe Schema).
- **Supabase**: 
  - **PostgreSQL Database**: Stores the structured recipes and metadata.
  - **Blob Storage**: Stores the recorded audio files.

---

## 3. End-to-End Logic Flow

### Phase 1: Audio Capture & Upload (Client)
1. User taps the mic button (`client/js/app.js`).
2. `AudioRecorder` initializes the MediaRecorder API (`client/js/recorder.js`).
3. Audio is recorded in chunks and exported as a `Blob` (usually `audio/webm`).
4. Alternatively, the user can upload an audio file via drag-and-drop or file input.
5. Client enforces a 3-minute max duration limit.
6. **Upload URL Generation**: Client calls `POST /api/upload-url` to get a signed Supabase upload URL and a unique `storagePath`.
7. **Direct Upload**: Client directly uploads the audio blob to Supabase Storage using the signed URL via `PUT`. This bypasses Vercel's 4.5MB request payload limit.

### Phase 2: Processing & Transcription (Backend)
1. Client sends a `POST /api/process` request containing `{ storagePath, originalName }` as JSON.
2. **Download**: `api/process.js` downloads the audio file from Supabase Storage into the serverless environment's `/tmp` directory.
3. **Transcription**: Sends the downloaded local file to Sarvam AI (`api/_lib/sarvam.js`).
4. **Hybrid Transcription Strategy (Sarvam)**:
   - **<= 30 seconds (Sync)**: Sends audio directly to the synchronous REST endpoint.
   - **> 30 seconds (Batch)**: Creates a batch job, uploads to Sarvam's Azure Blob Storage, starts the job, and returns a `jobId`.
   - If a batch job is initiated, `/api/process` returns `202 Accepted` with a `jobId`.
5. **Polling (If Batch)**:
   - Client detects the `202` response and begins polling `POST /api/poll` every 3 seconds (`client/js/api.js`).
   - Backend checks the job status on Sarvam. When completed, it downloads the transcript result file and returns it.

### Phase 3: Structuring (Backend)
1. Once the client has the raw `transcript` and `detectedLanguage`, it sends a `POST /api/structure` request.
2. `api/_lib/openai.js` calls the OpenAI API (GPT-4o-mini) using strict Structured Outputs (`response_format: { type: 'json_schema' }`).
3. **Prompt Rules**: The LLM is instructed to:
   - **Preserve the original language** (e.g., if spoken in Kannada, output Kannada text).
   - Clean up speech artifacts (um, uh, repetitions).
   - Infer servings and prep time if not explicitly stated.
   - Extract ingredients and organize steps logically.
4. Returns the structured JSON recipe (title, prep time, servings, ingredients, steps).

### Phase 4: Result & Saving (Client & Backend)
1. Client receives the structured recipe and renders it on the UI (`client/js/app.js`).
2. Client fires an asynchronous, fire-and-forget `POST /api/save` request.
3. **Auto-Tagging**: `api/_lib/supabase.js` scans the transcript and recipe for keywords to auto-generate tags (e.g., `vegetarian`, `south-indian`, `quick`, `snack`).
4. Recipe, tags, audio storage path, and transcript are inserted into the Supabase `recipes` table.
5. User can now edit the recipe on the UI, copy it to clipboard, or share it via WhatsApp/Twitter (`client/js/share.js`).

---

## 4. API Endpoints

- **`POST /api/upload-url`**
  - **Input**: `JSON` `{ originalName }`
  - **Logic**: Generates a signed Supabase Storage upload URL and unique path.
  - **Output**: `{ uploadUrl, storagePath }`

- **`POST /api/process`**
  - **Input**: `JSON` `{ storagePath, originalName }`
  - **Logic**: Downloads audio from Supabase to `/tmp`, then initiates transcription to Sarvam.
  - **Output**: `{ status, transcript, detectedLanguage, audioPath, jobId (if batch) }`

- **`POST /api/poll`**
  - **Input**: `JSON` `{ jobId, audioPath, originalName }`
  - **Logic**: Checks Sarvam batch job status. Downloads transcript if completed.
  - **Output**: `{ status, transcript, detectedLanguage }`

- **`POST /api/structure`**
  - **Input**: `JSON` `{ transcript, language }`
  - **Logic**: Prompts GPT-4o-mini to convert the transcript into a JSON recipe.
  - **Output**: `{ recipe }`

- **`POST /api/save`**
  - **Input**: `JSON` `{ recipe, transcript, language, audioPath, originalName }`
  - **Logic**: Generates tags and saves all data to Supabase PostgreSQL.
  - **Output**: `{ recipeId }`

- **`GET /api/health`**
  - Simple health check endpoint returning `200 OK`.

---

## 5. Error Handling & Edge Cases
- **Vercel Payload Limits**: Vercel limits serverless function payloads to 4.5MB. We bypass this by offloading the actual file upload directly to Supabase Storage from the client-side using a signed URL. The Vercel function then downloads the file internally (where limits are much higher) for processing.
- **Audio Length Limits**: Client restricts uploads to 3 minutes. Sarvam integration performs metadata checks to firmly reject >3 min audio, preventing API timeouts.
- **Fallback Logic**: If Sarvam's sync API rejects a file for being slightly over the internal 30s limit (yielding a 422 or 413 error), the backend automatically falls back to the Batch API without failing the user's request.
- **Cleanup**: Downloaded `/tmp` files are robustly cleaned up in `finally` blocks to prevent disk space leaks in the serverless environment.
