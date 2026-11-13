'use strict';

const MAX_BYTES = 1_400_000;
function imageType(body) {
  if (!body || body.length < 12) return null;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (/^GIF8[79]a$/.test(body.toString('ascii', 0, 6))) return 'image/gif';
  if (body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function dataUrl(body) {
  const type = body.length <= MAX_BYTES && imageType(body);
  return type ? `data:${type};base64,${body.toString('base64')}` : null;
}
async function normalise(value, { baseUrl, fetchImpl, timeoutMs = 8000 } = {}) {
  if (!value) return null;
  if (value.type === 'Buffer' && Array.isArray(value.data)) return value.data.length <= MAX_BYTES ? dataUrl(Buffer.from(value.data)) : null;
  if (typeof value !== 'string' || value.length > 2_000_000) return null;
  const text = value.trim();
  if (/^https?:\/\//i.test(text) || text.startsWith('/')) {
    const base = new URL(baseUrl);
    let url = new URL(text, base);
    const allowed = (u) => ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password &&
      (u.origin === base.origin || (u.protocol === 'https:' && u.hostname === 'webapps.knust.edu.gh' && !u.port));
    for (let hop = 0; hop < 4; hop++) {
      if (!allowed(url)) return null;
      const res = await fetchImpl(url.href, { redirect: 'manual', headers: { accept: 'image/*' }, signal: AbortSignal.timeout(timeoutMs) });
      const location = res.headers?.get('location');
      if (res.status >= 300 && res.status < 400 && location) { url = new URL(location, url); continue; }
      if (!res.ok || Number(res.headers?.get('content-length')) > MAX_BYTES) return null;
      // Native fetch exposes a stream; stop reading oversized remote images.
      if (res.body?.getReader) {
        const reader = res.body.getReader(); const chunks = []; let size = 0;
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          size += chunk.length;
          if (size > MAX_BYTES) { await reader.cancel(); return null; }
          chunks.push(Buffer.from(chunk));
        }
        return dataUrl(Buffer.concat(chunks));
      }
      return dataUrl(Buffer.from(await res.arrayBuffer()));
    }
    return null;
  }
  const raw = text.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
  return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? dataUrl(Buffer.from(raw, 'base64')) : null;
}
module.exports = { normalise, imageType };
