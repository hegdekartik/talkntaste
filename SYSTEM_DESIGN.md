# TalknTaste - System Design & Implementation Guide

## 1. Overview
TalknTaste is a voice-first web application that allows users to speak a recipe in any Indian language and instantly get a structured, shareable recipe card. It relies on advanced Speech-to-Text (STT), Large Language Models (LLMs), and a robust Serverless architecture.

## 2. Tech Stack & Architecture

### Frontend (Client)
- **HTML/CSS/Vanilla JS**: A lightweight, dependency-free UI.
- **Vite**: Fast local development server and bundler.
- **Vibrant Design System**: A modern, block-based UI utilizing warm terracotta and fresh green aesthetics.
- **Bottom Navigation**: Intuitive mobile-first tabs separating the "Record" flow from the "Library".
- **MediaRecorder API**: For capturing microphone input.

### Backend (Serverless API)
- **Vercel Serverless Functions (`api/`)**: Scalable, zero-maintenance backend endpoints.
- **Node.js**: Execution runtime.

### Data & AI (Third-Party)
- **Supabase PostgreSQL**: Relational data store for the recipe library.
- **Supabase Storage**: Blob storage for persisting raw audio recordings (configured as Public bucket for playback).
- **Sarvam AI (Saaras v3)**: STT engine highly specialized for Indian language accuracy.
- **OpenAI (GPT-4o-mini)**: Uses strict Structured Outputs to reliably map raw, conversational transcripts into standard JSON recipe objects.

---

## 3. End-to-End Logic Flow

### Phase 1: Audio Capture & Upload
1. User taps the mic on the Record tab.
2. `client/js/recorder.js` captures chunks of audio via MediaRecorder up to a 3-minute limit.
3. **Signed URL generation**: `POST /api/upload-url` returns a secure Supabase URL.
4. **Direct Upload**: The client directly uploads the audio `Blob` to Supabase Storage. (This circumvents Vercel's 4.5MB payload limitations).

### Phase 2: Processing & Transcription
1. Client hits `POST /api/process` with the uploaded file's Supabase storage path.
2. The serverless function downloads the audio to the ephemeral `/tmp` directory.
3. Audio is evaluated for length:
   - **Sync Flow (<= 30s)**: Sent directly to Sarvam AI. Returns transcript immediately.
   - **Batch Flow (> 30s)**: Sent to Sarvam AI batch processing. Returns a `jobId` and `202 Accepted` to the client.
4. **Polling**: If batched, the client loops `POST /api/poll` until the transcript is ready, ensuring long processes do not trigger Vercel timeout limits.

### Phase 3: Structuring
1. Client sends the raw transcript to `POST /api/structure`.
2. `api/_lib/openai.js` calls GPT-4o-mini. The prompt enforces:
   - **Original Language Preservation**: JSON outputs must match the input language (e.g., Kannada audio yields Kannada text).
   - Inference of missing metadata (prep times, servings).
   - Segregation of ingredients (with quantities) from actionable steps.

### Phase 4: Database & Presentation
1. Client sends a fire-and-forget `POST /api/save` with the structured recipe.
2. `api/_lib/supabase.js` auto-generates tags and persists the record to PostgreSQL.
3. The UI presents the recipe on a Vibrant block card. Users can edit text inline or easily share to WhatsApp and Twitter via deep-linking.

---

## 4. API Endpoints

- **`POST /api/upload-url`**: Generates a signed Supabase Storage URL.
- **`POST /api/process`**: Downloads audio, initiates Sarvam transcription, handles Sync vs Batch routing.
- **`POST /api/poll`**: Checks Sarvam job status and fetches completed transcripts.
- **`POST /api/structure`**: Maps transcript to JSON via OpenAI.
- **`POST /api/save`**: Saves to Supabase PostgreSQL.
- **`GET /api/recipes`**: Retrieves the user's saved recipes for the Library tab.
