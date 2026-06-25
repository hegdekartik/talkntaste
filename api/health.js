/**
 * GET /api/health
 * Simple health check endpoint.
 */
export default function handler(_req, res) {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}
