export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function req(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText);
  return data;
}

const cache = new Map();
export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  // short-lived cache for read-mostly resources
  cached(p, ttl = 20000) {
    const c = cache.get(p);
    if (c && Date.now() - c.t < ttl) return c.v;
    const v = req('GET', p);
    cache.set(p, { t: Date.now(), v });
    v.catch(() => cache.delete(p));
    return v;
  },
  bust() { cache.clear(); },
  async uploadMedia(blob) {
    const res = await fetch('/api/media', { method: 'POST', body: blob });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data.error);
    return data;
  },
};

// Live feed of newly accepted records (SSE). Returns an unsubscribe function.
export function liveStream(onRecord) {
  let es;
  try {
    es = new EventSource('/api/stream');
    es.addEventListener('record', (e) => { try { onRecord(JSON.parse(e.data)); } catch { /* ignore */ } });
  } catch { /* SSE unavailable */ }
  return () => es?.close();
}
