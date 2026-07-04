import { generateUploadUrl } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (body instanceof Buffer) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  }
  const { originalName } = body || {};

  try {
    const { uploadUrl, storagePath } = await generateUploadUrl(originalName);
    res.status(200).json({ uploadUrl, storagePath });
  } catch (error) {
    console.error('[API] Upload URL error:', error.message);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}
