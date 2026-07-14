# Deployment Architecture: TalknTaste

This document outlines the deployment architecture for the **TalknTaste** application, detailing how the frontend and serverless APIs are deployed on **Vercel** and how data is managed via **Supabase**.

---

## 1. Monolithic Serverless Architecture

TalknTaste uses a unified hosting approach on **Vercel**, backed by **Supabase** for persistence.

### Vercel (Frontend & Backend)
Vercel handles the entire application lifecycle in a single deployment:
1. **Frontend (`client/`)**: Vercel builds the Vite static application and serves it via its Global Edge CDN. This ensures blazing fast UI loading worldwide.
2. **Backend API (`api/`)**: Any file inside the `api/` folder is automatically deployed as a **Serverless Node.js Function**. This handles all the secure logic (calling Sarvam AI for transcription and LLM structuring, plus managing OpenAI fallbacks) without the need for a dedicated, always-on Express server.

### Supabase (Database & Storage)
Supabase acts as the Backend-as-a-Service (BaaS) for data persistence:
1. **PostgreSQL**: Stores the structured recipe JSON, tags, language metadata, and timestamps.
2. **Blob Storage**: Hosts the uploaded audio recordings (configured as a Public bucket for playback).

---

## 2. Handling Serverless Constraints

Serverless functions on platforms like Vercel have limitations (e.g., maximum execution timeouts and payload size limits). TalknTaste employs several architectural patterns to seamlessly bypass these constraints:

### Payload Limits (The 4.5MB Problem)
Vercel serverless functions strictly limit incoming HTTP request bodies to 4.5MB, which is easily exceeded by a 3-minute audio recording.
**Solution:**
- The frontend requests a short-lived **Signed Upload URL** from Supabase via `POST /api/upload-url`.
- The frontend uploads the audio file directly to Supabase Storage, entirely bypassing Vercel's payload limits.
- The frontend then sends only the lightweight *storage path* to `/api/process`.

### Timeout Limits (Long Processing)
Vercel functions on the Hobby tier timeout after 10 seconds (or 60s on Pro). AI transcription can sometimes exceed this.
**Solution:**
- The backend utilizes Sarvam AI's **Batch API** for audio exceeding 30 seconds. 
- `/api/process` immediately returns a `202 Accepted` status alongside a `jobId`.
- The frontend transitions to a polling state, hitting `/api/poll` every 3 seconds to check job completion. This keeps individual serverless invocations well under the timeout limit while supporting long-running background AI tasks.

---

## 3. Deployment Workflow

Deploying TalknTaste requires zero configuration files beyond the standard `vercel.json` provided in the repository.

1. **Environment Variables**: Ensure `SARVAM_API_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are securely added to the Vercel project settings. The `OPENAI_API_KEY` is also recommended as a safety fallback in case the Sarvam LLM fails.
2. **Build Settings**: Vercel automatically detects the Vite framework. `npm run build` within the client directory generates the static frontend.
3. **CORS**: Because the frontend and the `/api` routes share the same domain (e.g., `talkntaste.vercel.app`), there are zero Cross-Origin Resource Sharing (CORS) issues, making API requests natively secure.

---

## 4. Future Scalability

As TalknTaste scales, this architecture will scale seamlessly:
- Vercel's Edge CDN will easily handle high frontend traffic.
- Supabase's managed Postgres handles thousands of concurrent reads for the Recipe Library.
- If audio transcription processing times grow longer, the robust polling architecture (`/api/poll`) ensures users never face 504 Gateway Timeout errors.
