import 'dotenv/config';

async function testBatch() {
  const apiKey = process.env.SARVAM_API_KEY;
  const SARVAM_API_BASE = 'https://api.sarvam.ai';
  const headers = {
    'api-subscription-key': apiKey,
    'Content-Type': 'application/json',
  };

  try {
    const createRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_parameters: {
          model: 'saaras:v3',
        },
      }),
    });
    
    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error('Create failed body:', errBody);
      throw new Error('Create failed');
    }
    const createData = await createRes.json();
    console.log('Create Data:', createData);
    const jobId = createData.job_id;

    const uploadUrlRes = await fetch(`${SARVAM_API_BASE}/speech-to-text/job/v1/upload-files`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_id: jobId,
        files: ['recording.webm'],
      }),
    });
    
    const uploadUrlData = await uploadUrlRes.json();
    console.log('Upload URL Data:', JSON.stringify(uploadUrlData, null, 2));

  } catch (err) {
    console.error(err);
  }
}

testBatch();
