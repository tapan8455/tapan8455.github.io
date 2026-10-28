// Allow connections to IPTV providers with self-signed or unverified SSL certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

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

async function requestJSON({ server, user, pass, action, params = '' }) {
  let base = String(server || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('No provider server specified');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;

  const url = new URL(`${base}/player_api.php`);
  url.searchParams.set('username', user || '');
  url.searchParams.set('password', pass || '');
  if (action) url.searchParams.set('action', action);
  if (params) {
    const extra = new URLSearchParams(String(params).replace(/^&/, ''));
    for (const [k, v] of extra) url.searchParams.set(k, v);
  }

  const isHeavy = action && (action.includes('streams') || action.includes('series') || !action);
  const timeoutMs = isHeavy ? 60000 : 30000;

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'application/json, text/plain, */*'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Provider returned HTTP ${response.status} (${response.statusText || 'Error'})`);
      }

      const text = await response.text();
      if (/^\s*</.test(text)) {
        throw new Error('Provider returned HTML instead of JSON. Check server URL or credentials.');
      }

      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error('Invalid JSON response from provider');
      }
    } catch (err) {
      lastError = err;
      const isAbort = err.name === 'AbortError' || err.code === 'ABORT_ERR' || (err.message && err.message.includes('aborted'));
      const isPremature = (err.cause && err.cause.code === 'ERR_STREAM_PREMATURE_CLOSE') || (err.message && err.message.includes('Premature close'));

      if (attempt < 2 && (isAbort || isPremature)) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function handleStreamProxy(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let target = reqUrl.searchParams.get('url');

  if (!target) {
    const referer = req.headers['referer'];
    if (referer) {
      try {
        const refUrl = new URL(referer);
        const refTarget = refUrl.searchParams.get('url');
        if (refTarget) {
          const resolved = new URL(reqUrl.pathname.replace(/^\/+stream\/?/, '') + reqUrl.search, refTarget);
          target = resolved.href;
        }
      } catch (_) {}
    }
  }

  if (!target || !/^https?:/i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Invalid or missing stream target URL');
    return;
  }

  try {
    const targetUrl = new URL(target);
    const headers = {
      'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': '*/*',
      'Referer': `${targetUrl.origin}/`
    };

    if (req.headers['range']) {
      headers['Range'] = req.headers['range'];
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: req.method || 'GET',
      headers,
      redirect: 'follow'
    });

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const finalUrlStr = upstream.url || targetUrl.toString();
    let finalPathname = '';
    try { finalPathname = new URL(finalUrlStr).pathname; } catch (_) {}

    const isM3U8 = targetUrl.pathname.endsWith('.m3u8') ||
                   finalPathname.endsWith('.m3u8') ||
                   contentType.includes('mpegurl') ||
                   contentType.includes('application/x-mpegurl');

    const outHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes'
    };

    if (upstream.headers.get('content-range')) {
      outHeaders['Content-Range'] = upstream.headers.get('content-range');
    }
    if (upstream.headers.get('content-length')) {
      outHeaders['Content-Length'] = upstream.headers.get('content-length');
    }

    if (isM3U8) {
      const text = await upstream.text();
      const rewritten = rewriteM3U8(text, finalUrlStr);
      outHeaders['Content-Type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
      delete outHeaders['Content-Length'];
      res.writeHead(upstream.status, outHeaders);
      res.end(rewritten);
      return;
    }

    if (finalPathname.endsWith('.mp4') || targetUrl.pathname.endsWith('.mp4')) {
      outHeaders['Content-Type'] = 'video/mp4';
    } else if (finalPathname.endsWith('.mkv') || targetUrl.pathname.endsWith('.mkv')) {
      outHeaders['Content-Type'] = 'video/x-matroska';
    } else if (finalPathname.endsWith('.ts') || targetUrl.pathname.endsWith('.ts')) {
      outHeaders['Content-Type'] = 'video/mp2t';
    } else if (contentType) {
      outHeaders['Content-Type'] = contentType;
    }

    res.writeHead(upstream.status, outHeaders);

    if (upstream.body) {
      const { Readable } = require('stream');
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end(`Stream proxy error: ${err.message}`);
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Body payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // Health check
  if (pathname === '/health' || pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', app: 'AURA IPTV Web Server', time: new Date().toISOString() }));
    return;
  }

  // Stream proxy route
  if (pathname.startsWith('/stream')) {
    await handleStreamProxy(req, res);
    return;
  }

  // API Request endpoint
  if (pathname === '/api/request' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const actionName = body?.action || 'default';
      console.log(`[AURA API] Request action: "${actionName}" for user: "${body?.user || 'none'}"`);
      const result = await requestJSON(body);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`[AURA API Error]: ${err.message}`);
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API Test Connection endpoint
  if (pathname === '/api/test-connection' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log(`[AURA Test Connection] Server: ${body?.server} | User: ${body?.user}`);
      const result = await requestJSON({ ...body, action: '' });
      if (result && result.user_info) {
        if (result.user_info.auth === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Invalid username or password' }));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      console.error(`[AURA Test Connection Error]: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Static File Serving
  let filePath = pathname === '/' ? '/index.html' : pathname;
  let safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  let fullPath = path.join(__dirname, 'src', safePath);

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html (SPA)
      fullPath = path.join(__dirname, 'src', 'index.html');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n========================================`);
  console.log(`  AURA IPTV Web Server Running!`);
  console.log(`  Local URL:   http://localhost:${PORT}`);
  console.log(`  Network URL: http://${HOST === '0.0.0.0' ? 'your-ip' : HOST}:${PORT}`);
  console.log(`========================================\n`);
});
