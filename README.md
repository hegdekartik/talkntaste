# 🍳 TalknTaste

> Speak a recipe in any Indian language. Get it structured instantly. Share it everywhere.

TalknTaste is a voice-first web app that converts spoken recipes into beautifully structured recipe cards — preserving the original language. Built for Indian home cooks who want to capture family recipes effortlessly and share them on WhatsApp, Twitter/X, or anywhere else.

## ✨ Features

- **🎙️ Voice Recording** — Tap the mic, speak your recipe (up to 3 minutes), and watch the waveform dance.
- **📁 File Upload** — Upload pre-recorded `.mp3`, `.wav`, `.webm` files.
- **🗣️ Indian Language Support** — Kannada, Hindi, Tamil, Telugu, Malayalam, Marathi, Bengali, Gujarati, Punjabi, English, and more.
- **🔤 Language Preservation** — Your recipe stays in the language you spoke it in.
- **📝 Structured Output** — AI extracts title, servings, prep time, ingredients, and numbered steps.
- **✏️ Inline Editing** — Tap to edit any field directly on the recipe card.
- **📱 Sharing** — One-tap share with emoji-rich formatting for WhatsApp or Twitter.
- **📚 Recipe Library** — Automatically saves your structured recipes to a database with a beautiful vibrant, block-based UI.
- **🧭 Bottom Navigation** — Intuitive mobile-first tab bar to seamlessly switch between Recording and your Library.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS + Vite |
| **Backend** | Vercel Serverless Functions (`/api/*`) |
| **Database & Storage** | [Supabase](https://supabase.com) (PostgreSQL + Blob Storage) |
| **Speech-to-Text** | [Sarvam AI](https://sarvam.ai) (Saaras v3) |
| **Recipe Structuring** | OpenAI GPT-4o-mini (Structured Outputs) |
| **Audio Recording** | Web MediaRecorder API |

## 📦 Project Structure

```text
talkntaste/
├── api/                  # Vercel Serverless Functions (Production & Local API)
│   ├── _lib/             # Shared utilities (supabase, sarvam, openai, parseMultipart)
│   ├── process.js        # POST /api/process (Audio processing pipeline)
│   └── ...
├── client/               # Vite frontend SPA
│   ├── index.html        # Main entry point with bottom navigation
│   ├── style.css         # Vibrant Block-based UI design system
│   ├── js/
│   │   ├── app.js        # Core state machine & UI controller
│   │   ├── api.js        # API communication logic
│   │   └── ...
├── vercel.json           # Vercel deployment configuration
├── .env.example
└── package.json
```

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Sarvam AI API key](https://docs.sarvam.ai)
- [OpenAI API key](https://platform.openai.com/api-keys)
- [Supabase Project](https://supabase.com) (URL and Anon Key)

### Setup

```bash
# Clone the repo
git clone https://github.com/hegdekartik/talkntaste.git
cd talkntaste

# Install dependencies (from the root, runs for both root and client)
npm install
cd client && npm install && cd ..

# Configure API keys
cp .env.example .env
# Edit .env with your actual keys for Sarvam, OpenAI, and Supabase
```

### Run Locally

Use Vercel CLI to run both the frontend and serverless functions locally:

```bash
npm run dev
```

This starts:
- **Frontend & API**: `http://localhost:3000` (Vercel dev server automatically proxies `/api` to the serverless functions).

### Deploy to Vercel

The project is fully configured to deploy to Vercel as a single app.

1. **Push** this repository to GitHub.
2. **Import** the project into Vercel.
3. Set the **Framework Preset** to **Vite**.
4. Add your **Environment Variables** (`SARVAM_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`) in the Vercel dashboard.
5. **Deploy**. Vercel will build the frontend and deploy the `api/` folder as serverless functions.

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload-url` | Generates a signed Supabase URL for direct client audio uploads |
| `POST` | `/api/process` | Handles audio processing, triggers Sarvam AI transcription |
| `POST` | `/api/poll` | Polls Sarvam AI for long-audio batch transcription results |
| `POST` | `/api/structure` | Converts raw transcripts into structured JSON recipes via OpenAI |
| `POST` | `/api/save` | Saves the structured recipe to Supabase PostgreSQL |
| `GET`  | `/api/recipes` | Fetches the user's recipe library from Supabase |

## 📄 License
MIT
