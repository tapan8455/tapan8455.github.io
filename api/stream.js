import { URL } from 'url';
import { Readable } from 'stream';

function rewriteM3U8(content, baseUrl) {
  try {
    const base = new URL(baseUrl);
    return content.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          try {
            const resolved = /^https?:\/\//i.test(uri) ? uri : new URL(uri, base).href;
            return `URI="/stream?url=${encodeURIComponent(resolved)}"`;
          } catch (_) {
            return `URI="${uri}"`;
          }
        });
      }
      try {
        const resolved = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).href;
        return `/stream?url=${encodeURIComponent(resolved)}`;
      } catch (_) {
        return line;
      }
    }).join('\n');
  } catch (_) {
    return content;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const target = req.query.url;
  if (!target || !/^https?:/i.test(target)) {
    return res.status(400).send('Invalid or missing stream URL');
  }

  // SSRF Protection: Deny local/private network addresses
  try {
    const parsed = new URL(target);
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/i.test(parsed.hostname)) {
      return res.status(403).send('Restricted destination address');
    }
  } catch (_) {
    return res.status(400).send('Malformed stream target');
  }

  try {
    const headers = {
      'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': '*/*'
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(target, { headers, redirect: 'follow' });
    const finalUrl = upstream.url || target;
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isM3U8 = target.toLowerCase().includes('.m3u8') || contentType.includes('mpegurl');

    if (upstream.headers.get('content-range')) {
      res.setHeader('Content-Range', upstream.headers.get('content-range'));
    }
    if (upstream.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges'));
    }
    if (upstream.headers.get('content-length')) {
      res.setHeader('Content-Length', upstream.headers.get('content-length'));
    }

    if (isM3U8) {
      const rawManifest = await upstream.text();
      const rewritten = rewriteM3U8(rawManifest, finalUrl);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.status(upstream.status).send(rewritten);
    }

    res.setHeader('Content-Type', contentType || 'video/mp4');
    res.status(upstream.status);

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', () => { try { res.end(); } catch (_) {} });
      res.on('close', () => { try { nodeStream.destroy(); } catch (_) {} });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    return res.status(502).send(`Stream proxy error: ${err.message}`);
  }
}