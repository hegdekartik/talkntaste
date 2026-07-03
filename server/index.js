import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkBatchJob, transcribeAudio } from './sarvam.js';
import { structureRecipe } from './openai.js';
import { saveRecipe, uploadAudio } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for audio file uploads (max 10MB)
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'audio/webm', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg',
      'audio/flac', 'video/webm', 'audio/x-m4a', 'audio/aac',
    ];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/transcribe
 * Accepts audio file, returns raw transcript via Sarvam STT.
 */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    console.log(`[API] Transcribe request: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    const result = await transcribeAudio(req.file.path, req.file.originalname);
    res.json(result);
  } catch (error) {
    console.error('[API] Transcribe error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    // Clean up uploaded file
    cleanupFile(req.file.path);
  }
});

/**
 * POST /api/structure
 * Accepts transcript text, returns structured recipe JSON via OpenAI.
 */
app.post('/api/structure', async (req, res) => {
  const { transcript, language } = req.body;

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid transcript text' });
  }

  try {
    console.log(`[API] Structure request: ${transcript.substring(0, 80)}...`);

    const recipe = await structureRecipe(transcript, language);
    res.json(recipe);
  } catch (error) {
    console.error('[API] Structure error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/process
 * Full pipeline: audio file → transcript → structured recipe JSON.
 */
app.post('/api/process', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    console.log(`[API] Full pipeline: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

    // Step 1: Transcribe
    const transcribeResult = await transcribeAudio(req.file.path, req.file.originalname);

    if (transcribeResult.isBatch) {
      // For long audio, we upload to storage now before Vercel kills this function.
      // The frontend will poll /api/poll to get the final result.
      const audioPath = await uploadAudio(req.file.path, req.file.originalname);
      
      return res.status(202).json({
        status: 'processing',
        jobId: transcribeResult.jobId,
        audioPath,
        originalName: req.file.originalname,
      });
    }

    const { transcript, language } = transcribeResult;

    if (!transcript) {
      return res.status(422).json({ error: 'Could not extract any text from the audio. Please try again with clearer audio.' });
    }

    // Step 2: Structure
    const recipe = await structureRecipe(transcript, language);

    // Step 3: Save to Supabase (fire-and-forget — don't block response)
    const recipeId = await saveRecipe({
      recipe,
      transcript,
      language,
      audioFilePath: req.file.path,
      originalName: req.file.originalname,
    });

    res.json({
      status: 'completed',
      transcript,
      detectedLanguage: language,
      recipe,
      recipeId: recipeId || null,
    });
  } catch (error) {
    console.error('[API] Process error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    cleanupFile(req.file?.path);
  }
});

/**
 * POST /api/poll
 * Polling endpoint for long audio processed via Sarvam Batch API.
 */
app.post('/api/poll', async (req, res) => {
  const { jobId, audioPath, originalName } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId' });
  }

  try {
    const jobResult = await checkBatchJob(jobId);

    if (jobResult.status === 'processing') {
      return res.status(202).json({ status: 'processing' });
    }

    const { transcript, language } = jobResult;

    if (!transcript) {
      return res.status(422).json({ error: 'Could not extract any text from the audio. Please try again with clearer audio.' });
    }

    // Step 2: Structure
    const recipe = await structureRecipe(transcript, language);

    // Step 3: Save to Supabase (using the audioPath already uploaded in step 1)
    const recipeId = await saveRecipe({
      recipe,
      transcript,
      language,
      audioPath,
      originalName,
    });

    res.json({
      status: 'completed',
      transcript,
      detectedLanguage: language,
      recipe,
      recipeId: recipeId || null,
    });
  } catch (error) {
    console.error('[API] Poll error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Error handling for multer
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Audio file is too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

/** Remove uploaded temp file */
function cleanupFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.warn('[Cleanup] Failed to remove temp file:', filePath);
      }
    });
  }
}

app.listen(PORT, () => {
  console.log(`\n🍳 TalknTaste server running at http://localhost:${PORT}`);
  console.log(`   Sarvam API key: ${process.env.SARVAM_API_KEY ? '✅ configured' : '❌ MISSING'}`);
  console.log(`   OpenAI API key: ${process.env.OPENAI_API_KEY ? '✅ configured' : '❌ MISSING'}\n`);
});
