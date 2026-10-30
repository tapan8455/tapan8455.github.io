/**
 * AURA IPTV — minimal CORS proxy for Cloudflare Workers (free tier).
 *
 * Why: GitHub Pages is HTTPS-only and static. Browsers block http:// IPTV
 * providers from an HTTPS page (mixed content) and many providers send no CORS
 * headers. This worker relays the request over HTTPS and adds CORS headers.
 *
 * Deploy:
 *   1. dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker.
 *   2. Replace the code with this file and Deploy.
 *   3. In the app: Profile → Advanced setting → Connection → CORS proxy URL:
 *        https://<your-worker>.<you>.workers.dev/?url=%s
 *
 * Optional hardening (Settings → Variables):
 *   ALLOWED_ORIGIN = https://<you>.github.io      (only your site may use it)
 *   ALLOWED_HOSTS  = provider.com,cdn.provider.com (only these upstreams)
 *
 * Your provider credentials travel through this worker. Deploy your own; never
 * use a public proxy you do not control. Nothing is logged or cached here.
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin === '*' ? '*' : allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (allowedOrigin !== '*' && origin !== allowedOrigin) return new Response('Forbidden origin', { status: 403, headers: cors });

    const self = new URL(request.url);
    const target = self.searchParams.get('url') || (self.pathname.length > 1 && self.pathname.startsWith('/http') ? decodeURIComponent(self.pathname.slice(1)) : null);
    if (!target || target === '%s' || target === 'undefined') {
      return new Response(
        'AURA IPTV CORS Proxy is active and running!\n\n' +
        'To use this proxy in the AURA app, set the CORS proxy URL in Profile → Advanced setting to:\n' +
        self.origin + '/?url=%s\n',
        { status: 200, headers: Object.assign({}, cors, { 'Content-Type': 'text/plain; charset=utf-8' }) }
      );
    }
    let upstream;
    try { upstream = new URL(target); } catch (_) { return new Response('Bad url: ' + target, { status: 400, headers: cors }); }
    if (!/^https?:$/.test(upstream.protocol)) return new Response('Only http(s) targets', { status: 400, headers: cors });
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(upstream.hostname)) return new Response('Private address blocked', { status: 403, headers: cors });
    if (env.ALLOWED_HOSTS) {
      const hosts = env.ALLOWED_HOSTS.split(',').map(s => s.trim().toLowerCase());
      if (!hosts.some(h => upstream.hostname === h || upstream.hostname.endsWith(`.${h}`))) return new Response('Host not allowed', { status: 403, headers: cors });
    }

    const headers = { 'User-Agent': 'IPTVSmartersPro', 'Accept': '*/*' };
    const range = request.headers.get('Range');
    if (range) headers.Range = range;
    const res = await fetch(upstream.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      cache: 'no-store'
    });

    const out = new Headers(cors);
    ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Cache-Control'].forEach(h => { const v = res.headers.get(h); if (v) out.set(h, v); });
    if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes');

    // Force proper MIME type for video streaming (providers often return generic application/octet-stream).
    const targetPath = (upstream.pathname || '').toLowerCase();
    const rawCt = (res.headers.get('Content-Type') || '').toLowerCase();
    if (/\.(mp4|m4v)(\?|$)/i.test(targetPath) || ((rawCt === 'application/octet-stream' || !rawCt) && !/\.(m3u8|json)(\?|$)/i.test(targetPath))) {
      out.set('Content-Type', 'video/mp4');
    } else if (/\.ts(\?|$)/i.test(targetPath)) {
      out.set('Content-Type', 'video/mp2t');
    }

    // Rewrite HLS playlists so every segment / key / child playlist also goes through this worker.
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    const finalUrl = res.url || upstream.toString();
    if (ct.includes('mpegurl') || /\.m3u8(\?|$)/i.test(finalUrl)) {
      const text = await res.text();
      if (/^\s*#EXTM3U/i.test(text)) {
        const wrap = (u) => `${self.origin}/?url=${encodeURIComponent(new URL(u, finalUrl).toString())}`;
        const body = text.split(/\r?\n/).map(line => {
          if (!line || !line.trim()) return line;
          const trimmed = line.trim();
          if (trimmed.startsWith('#')) return line.replace(/URI="?([^",\s]+)"?/g, (_, u) => `URI="${wrap(u)}"`);
          return wrap(trimmed);
        }).join('\n');
        out.set('Content-Type', 'application/vnd.apple.mpegurl');
        out.delete('Content-Length');
        return new Response(body, { status: res.status, headers: out });
      }
      return new Response(text, { status: res.status, headers: out });
    }
    return new Response(res.body, { status: res.status, headers: out });
  }
};
