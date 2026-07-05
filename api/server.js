import express from 'express';
import cors from 'cors';

// Import existing Vercel-style handlers
import healthHandler from './health.js';
import uploadUrlHandler from './upload-url.js';
import transcribeHandler from './transcribe.js';
import processHandler from './process.js';
import pollHandler from './poll.js';
import structureHandler from './structure.js';
import saveHandler from './save.js';
import recipesHandler from './recipes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// CORS — allow the Vercel-hosted frontend (and localhost for dev)
const allowedOrigins = [
  'http://localhost:5173',   // Vite dev server
  'http://localhost:4173',   // Vite preview
];

// If a production frontend URL is set, add it
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    // In production, be strict. In dev, be permissive.
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Parse JSON bodies (replaces Vercel's automatic body parsing)
app.use(express.json({ limit: '50mb' }));

// ---------------------------------------------------------------------------
// Routes — each handler uses the Vercel (req, res) signature, so we can
// mount them directly as Express route handlers.
// ---------------------------------------------------------------------------

app.get('/api/health', healthHandler);
app.get('/api/recipes', recipesHandler);
app.post('/api/upload-url', uploadUrlHandler);
app.post('/api/transcribe', transcribeHandler);
app.post('/api/process', processHandler);
app.post('/api/poll', pollHandler);
app.post('/api/structure', structureHandler);
app.post('/api/save', saveHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[Server] talkntaste API running on http://localhost:${PORT}`);
});
