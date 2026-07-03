import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { startBatchJob, checkBatchJob } from './sarvam.js';

async function run() {
  const testFile = path.resolve('./server/test-audio.webm');
  
  // Create a dummy file if it doesn't exist
  if (!fs.existsSync(testFile)) {
    console.log('Creating dummy audio file...');
    fs.writeFileSync(testFile, 'dummy content');
  }

  console.log('--- STARTING BATCH JOB ---');
  let jobId;
  try {
    jobId = await startBatchJob(testFile, 'test-audio.webm');
    console.log(`Job started with ID: ${jobId}`);
  } catch (err) {
    console.error('Failed to start job:', err);
    return;
  }

  console.log('--- POLLING JOB ---');
  let attempt = 0;
  while (true) {
    attempt++;
    console.log(`[Attempt ${attempt}] Checking status...`);
    try {
      const res = await checkBatchJob(jobId);
      console.log('Status result:', res);
      
      if (res.status === 'completed') {
        console.log('Job completed successfully!');
        break;
      }
    } catch (err) {
      console.error('Failed to check job:', err);
      break;
    }
    
    // Wait 3s
    await new Promise(r => setTimeout(r, 3000));
    
    if (attempt > 20) {
      console.log('Polling too long, aborting script.');
      break;
    }
  }
}

run();
