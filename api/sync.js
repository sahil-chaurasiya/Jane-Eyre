/* Cloud sync endpoint (Vercel serverless function).
   Stores one JSON blob per sync id in a Redis database (Upstash / Vercel KV) through its REST API.
   The id is a SHA-256 hash made in the browser from the reader's private sync phrase; the phrase itself never leaves the device. */
const BASE = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const MAX_BYTES = 900 * 1024;

async function redis(cmd) {
  const r = await fetch(BASE(), { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}
function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BYTES + 1024) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async function handler(req, res) {
  try {
    if (!BASE() || !TOKEN()) return send(res, 503, { error: 'not-configured' });
    const url = new URL(req.url, 'http://x');
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-f]{64}$/.test(id)) return send(res, 400, { error: 'bad-id' });
    const key = 'jane-eyre:sync:' + id;
    if (req.method === 'GET') {
      const v = await redis(['GET', key]);
      return send(res, 200, { data: v ? JSON.parse(v) : null });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const raw = await readBody(req);
      if (raw.length > MAX_BYTES) return send(res, 413, { error: 'too-large' });
      const body = JSON.parse(raw);
      if (!body || typeof body.data !== 'object' || body.data === null) return send(res, 400, { error: 'bad-body' });
      await redis(['SET', key, JSON.stringify(body.data)]);
      return send(res, 200, { ok: true });
    }
    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'method' });
  } catch (e) {
    return send(res, 500, { error: 'server' });
  }
};