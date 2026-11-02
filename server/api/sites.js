// AR Statue App — shared site packages.
// GET  /api/sites?id=<id>   -> public site package JSON (anyone)
// POST /api/sites           -> publish/update a package (needs x-admin-passphrase matching env ADMIN_PASSPHRASE_SCRYPT)
// POST /api/sites?check=1   -> passphrase check only, writes nothing
// DELETE /api/sites?id=<id> -> unpublish a site (needs passphrase)
import { put, head, del } from '@vercel/blob';
import { timingSafeEqual, createHash, randomBytes, scryptSync } from 'node:crypto';

const ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const MAX_BYTES = 900_000;
const ALLOWED_ORIGINS = ['https://newperspectivellc.github.io', 'http://127.0.0.1:8977', 'http://localhost:8977'];

function cors(req, res) {
  const o = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-admin-passphrase');
  res.setHeader('Access-Control-Max-Age', '600');
}
const sha = s => createHash('sha256').update(String(s)).digest();
// ADMIN_PASSPHRASE_SCRYPT = "scrypt$N$r$p$<salt b64>$<hash b64>" (only a salted hash is stored server-side)
function passOK(given) {
  const rec = process.env.ADMIN_PASSPHRASE_SCRYPT;
  if (!rec || !given) return false;
  const [k, N, r, p, salt, hash] = rec.split('$');
  if (k !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(String(given), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(got, want);
}
const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const b64 = (s, max) => typeof s === 'string' && s.length <= max && /^[A-Za-z0-9+/=]*$/.test(s);
const fpOK = f => f && num(f.w, 16, 2000) && num(f.h, 16, 2000) && num(f.n, 8, 2000) && b64(f.kp, 20000) && b64(f.d, 120000);
const thumbOK = t => typeof t === 'string' && t.length < 120000 && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(t);
function validate(p) {
  if (!p || p.v !== 1) return 'bad version';
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) return 'bad name';
  const z = p.zone; if (!z || !num(z.lat, -90, 90) || !num(z.lon, -180, 180) || !num(z.radius, 10, 5000)) return 'bad zone';
  if (!Array.isArray(p.room?.views) || p.room.views.length < 1 || p.room.views.length > 6) return 'bad room views';
  for (const v of p.room.views) { if (!fpOK(v.fp) || !thumbOK(v.thumb)) return 'bad room view'; }
  if (!Array.isArray(p.corner?.refs) || p.corner.refs.length < 1 || p.corner.refs.length > 4) return 'bad corner refs';
  for (const f of p.corner.refs) if (!fpOK(f)) return 'bad corner ref';
  if (!thumbOK(p.corner.thumb)) return 'bad corner thumb';
  return null;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const id = String(req.query.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' });
    try {
      const meta = await head(`sites/${id}.json`);
      const r = await fetch(meta.url + '?t=' + Date.now());
      if (!r.ok) return res.status(404).json({ error: 'not found' });
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(await r.text());
    } catch { return res.status(404).json({ error: 'not found' }); }
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    if (!process.env.ADMIN_PASSPHRASE_SCRYPT) return res.status(503).json({ error: 'publishing not configured' });
    if (!passOK(req.headers['x-admin-passphrase'])) { await new Promise(r => setTimeout(r, 1200)); return res.status(401).json({ error: 'wrong passphrase' }); }
    if (req.method === 'POST' && req.query.check) return res.status(200).json({ ok: true });
    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' });
      try { const meta = await head(`sites/${id}.json`); await del(meta.url); return res.status(200).json({ deleted: id }); }
      catch { return res.status(404).json({ error: 'not found' }); }
    }
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BYTES) return res.status(413).json({ error: 'package too large' });
    const p = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const err = validate(p); if (err) return res.status(400).json({ error: err });
    let id = typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : null;
    if (!id) id = (p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'site') + '-' + randomBytes(3).toString('hex');
    const pkg = { v: 1, id, name: p.name.trim(), created: p.created || new Date().toISOString(), updated: new Date().toISOString(),
                  zone: p.zone, room: { views: p.room.views }, corner: p.corner };
    const json = JSON.stringify(pkg);
    if (json.length > MAX_BYTES) return res.status(413).json({ error: 'package too large' });
    await put(`sites/${id}.json`, json, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
    return res.status(200).json({ id, bytes: json.length, share: `https://newperspectivellc.github.io/ar-statue-app/?site=${id}` });
  }
  res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
  return res.status(405).json({ error: 'method not allowed' });
}
