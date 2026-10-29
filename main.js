const { app, BrowserWindow, ipcMain, session, protocol, net, clipboard, shell } = require('electron');
const path = require('path');

// Ensure video/audio playback works unhindered with full codec and platform decoder support
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,AudioServiceOutOfProcess');
// Increase GPU and tile memory budget to prevent "tile memory limits exceeded" during stream transitions and high-res playback
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '4096');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow;

protocol.registerSchemesAsPrivileged([{
  scheme: 'aura',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: true
  }
}]);

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
            return `URI="aura://stream?url=${encodeURIComponent(resolved)}"`;
          } catch (_) {
            return `URI="${uri}"`;
          }
        });
      }
      try {
        const resolved = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).href;
        return `aura://stream?url=${encodeURIComponent(resolved)}`;
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

  // Generous timeout for large catalog payloads (60s), 30s for regular actions
  const isHeavy = action && (action.includes('streams') || action.includes('series') || !action);
  const timeoutMs = isHeavy ? 60000 : 30000;

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await net.fetch(url.toString(), {
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
        console.warn(`[AURA Provider API] Attempt ${attempt} interrupted (${err.message}). Retrying in 1.5s...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function handleMediaRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }
    });
  }

  let target;
  let parsed;
  try {
    parsed = new URL(request.url);
    target = parsed.searchParams.get('url');
  } catch (e) {
    return new Response('Invalid request URL', { status: 400 });
  }

  // If target is missing, check if this is a relative URL from a previous manifest request
  if (!target) {
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refUrl = new URL(referer);
        const refTarget = refUrl.searchParams.get('url');
        if (refTarget) {
          const resolved = new URL(parsed.pathname.replace(/^\/+stream\/?/, '') + parsed.search, refTarget);
          target = resolved.href;
        }
      } catch (_) {}
    }
  }

  if (!target || !/^https?:/i.test(target)) {
    return new Response('Invalid media URL', { status: 400 });
  }

  try {
    const targetUrl = new URL(target);
    const headers = {
      'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': '*/*',
      'Referer': `${targetUrl.origin}/`
    };

    const range = request.headers.get('range');
    if (range) {
      headers['Range'] = range;
    }

    const response = await net.fetch(targetUrl.toString(), {
      method: request.method || 'GET',
      headers,
      redirect: 'follow'
    });

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const finalUrlStr = response.url || targetUrl.toString();
    let finalPathname = '';
    try { finalPathname = new URL(finalUrlStr).pathname; } catch (_) {}

    const isM3U8 = targetUrl.pathname.endsWith('.m3u8') ||
                   finalPathname.endsWith('.m3u8') ||
                   contentType.includes('mpegurl') ||
                   contentType.includes('application/x-mpegurl');

    const outHeaders = new Headers(response.headers);
    outHeaders.set('Access-Control-Allow-Origin', '*');
    outHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    outHeaders.set('Access-Control-Allow-Headers', '*');
    outHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    outHeaders.set('Cache-Control', 'no-store');
    outHeaders.set('Accept-Ranges', 'bytes');

    if (isM3U8) {
      const text = await response.text();
      const rewritten = rewriteM3U8(text, finalUrlStr);
      outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders
      });
    }

    if (finalPathname.endsWith('.mp4') || targetUrl.pathname.endsWith('.mp4')) {
      outHeaders.set('Content-Type', 'video/mp4');
    } else if (finalPathname.endsWith('.mkv') || targetUrl.pathname.endsWith('.mkv')) {
      outHeaders.set('Content-Type', 'video/x-matroska');
    } else if (finalPathname.endsWith('.ts') || targetUrl.pathname.endsWith('.ts')) {
      outHeaders.set('Content-Type', 'video/mp2t');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders
    });
  } catch (error) {
    return new Response(`Media proxy error: ${error.message}`, { status: 502 });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    title: 'AURA IPTV',
    backgroundColor: '#141414',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Ignore self-signed or invalid SSL certificate errors from IPTV providers
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  protocol.handle('aura', handleMediaRequest);
  
  session.defaultSession.setCertificateVerifyProc((_request, callback) => {
    callback(0); // Accept all certs
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['*']
      }
    });
  });

  ipcMain.handle('aura:api-request', async (_event, args) => {
    try {
      return await requestJSON(args);
    } catch (err) {
      console.warn(`[AURA Provider API Error] Action "${args?.action || 'default'}": ${err.message}`);
      throw err;
    }
  });
  
  ipcMain.handle('aura:test-connection', async (_event, args) => {
    try {
      const result = await requestJSON({ ...args, action: '' });
      if (result && result.user_info) {
        if (result.user_info.auth === 0) {
          return { success: false, error: 'Invalid username or password' };
        }
        return { success: true, data: result };
      }
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('aura:toggle-fullscreen', () => {
    if (mainWindow) {
      const next = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(next);
      return next;
    }
    return false;
  });

  ipcMain.handle('aura:is-fullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

  ipcMain.handle('aura:copy-clipboard', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('aura:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('aura:download-file', async (_e, { url }) => {
    if (!mainWindow || !url) return false;
    mainWindow.webContents.downloadURL(url);
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
