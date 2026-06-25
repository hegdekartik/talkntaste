# 🍳 TalknTaste

> Speak a recipe in any Indian language. Get it structured instantly. Share it everywhere.

TalknTaste is a voice-first web app that converts spoken recipes into beautifully structured recipe cards — preserving the original language. Built for Indian home cooks who want to capture family recipes effortlessly and share them on WhatsApp, Twitter/X, or anywhere else.

## ✨ Features

- **🎙️ Voice Recording** — Tap the mic, speak your recipe (up to 3 minutes), and watch the waveform dance
- **📁 File Upload** — Drag-and-drop or upload pre-recorded `.mp3`, `.wav`, `.webm` files
- **🗣️ Indian Language Support** — Kannada, Hindi, Tamil, Telugu, Malayalam, Marathi, Bengali, Gujarati, Punjabi, English, and more
- **🔤 Language Preservation** — Your recipe stays in the language you spoke it in — no forced English translation
- **📝 Structured Output** — AI extracts title, servings, prep time, ingredients (with quantities & notes), and numbered steps
- **✏️ Inline Editing** — Tap to edit any field — title, ingredients, steps — directly on the recipe card
- **📱 WhatsApp Sharing** — One-tap share with emoji-rich formatting that looks beautiful in chat
- **🐦 Twitter/X Sharing** — Auto-condensed format with hashtags
- **📋 Clipboard Copy** — Formatted recipe text copied with a single tap
- **🌙 Dark Theme** — Warm saffron accent on deep charcoal, designed for readability

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS + Vite |
| **Backend** | Node.js + Express |
| **Speech-to-Text** | [Sarvam AI](https://sarvam.ai) (Saaras v3) |
| **Recipe Structuring** | OpenAI GPT-4o-mini (Structured Outputs) |
| **Audio Recording** | Web MediaRecorder API |
| **Sharing** | Web Share API + WhatsApp/Twitter deeplinks |

## 📦 Project Structure

```
talkntaste/
├── server/
│   ├── index.js          # Express API server
│   ├── sarvam.js         # Sarvam AI STT service
│   ├── openai.js         # OpenAI recipe structuring
│   └── package.json
├── client/
│   ├── index.html        # SPA shell (mobile-first)
│   ├── style.css         # Design system
│   ├── js/
│   │   ├── app.js        # State machine controller
│   │   ├── recorder.js   # Mic recording + waveform
│   │   ├── api.js        # Backend API client
│   │   └── share.js      # Social share formatting
│   ├── vite.config.js
│   └── package.json
├── .env.example
├── .gitignore
└── package.json
```

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Sarvam AI API key](https://docs.sarvam.ai) (free ₹1,000 credits on signup)
- [OpenAI API key](https://platform.openai.com/api-keys)

### Setup

```bash
# Clone the repo
git clone https://github.com/your-username/talkntaste.git
cd talkntaste

# Install dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Configure API keys
cp .env.example server/.env
# Edit server/.env with your actual keys
```

### Run

```bash
npm run dev
```

This starts both servers concurrently:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

### Test on Mobile

Use the Network URL shown by Vite (e.g., `http://192.168.x.x:5173`) to test on your phone — same Wi-Fi required.

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/process` | Full pipeline: audio → transcript → structured recipe |
| `POST` | `/api/transcribe` | Audio → raw transcript only |
| `POST` | `/api/structure` | Transcript text → structured recipe JSON |
| `GET` | `/api/health` | Health check |

### Recipe JSON Schema

```json
{
  "title": "ಬಿಸಿಬೇಳೆ ಬಾತ್",
  "language": "kn",
  "languageName": "Kannada",
  "servings": 4,
  "prepTime": "45 ನಿಮಿಷ",
  "ingredients": [
    { "name": "ತೊಗರಿ ಬೇಳೆ", "quantity": "1 ಕಪ್", "notes": "ತೊಳೆದು" }
  ],
  "steps": [
    { "stepNumber": 1, "instruction": "ತೊಗರಿ ಬೇಳೆ ಮತ್ತು ಅಕ್ಕಿಯನ್ನು ಕುಕ್ಕರ್‌ನಲ್ಲಿ ಬೇಯಿಸಿ" }
  ]
}
```

## 💰 Cost

| Service | Cost |
|---------|------|
| Sarvam AI | ₹30/hr of audio (free ₹1,000 credits) |
| OpenAI GPT-4o-mini | ~$0.001 per recipe |
| **Total for prototype** | **Effectively $0** |

## 📱 Share Format Preview

**WhatsApp:**
```
🍳 *ಬಿಸಿಬೇಳೆ ಬಾತ್*
⏱️ 45 ನಿಮಿಷ · 👥 4

📝 *ಪದಾರ್ಥಗಳು*
▸ 1 ಕಪ್ ತೊಗರಿ ಬೇಳೆ (ತೊಳೆದು)
▸ 1 ಕಪ್ ಅಕ್ಕಿ

👨‍🍳 *ವಿಧಾನ*
1️⃣ ಕುಕ್ಕರ್‌ನಲ್ಲಿ ಬೇಯಿಸಿ
2️⃣ ಒಗ್ಗರಣೆ ಮಾಡಿ

✨ Made with TalknTaste
```

## 📄 License

MIT

---

Built with ❤️ for Indian home cooks everywhere.
