/**
 * AURA IPTV Secure Stream & API Proxy
 * Deployable to Vercel Serverless / Edge Functions or Node.js runtime.
 */
import { URL } from 'url';

// Private and Loopback IP ranges to block SSRF exploits
const BLOCKED_IP_PATTERNS = [
    /^127\./,                          // IPv4 Loopback
    /^10\./,                           // RFC1918 Private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // RFC1918 Private
    /^192\.168\./,                     // RFC1918 Private
    /^169\.254\./,                     // Link-local / Cloud Metadata (AWS/GCP/Azure)
    /^0\./,                            // Current network
    /^::1$/,                           // IPv6 Loopback
    /^fc00:/i,                         // IPv6 Unique local
    /^fe80:/i                          // IPv6 Link-local
];

function isPrivateHost(hostname) {
    if (hostname === 'localhost') return true;
    for (const pat of BLOCKED_IP_PATTERNS) {
        if (pat.test(hostname)) return true;
    }
    return false;
}

export default async function handler(req, res) {
    // CORS headers for client-side player ingestion
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, User-Agent');
    res.setHeader('X-Aura-Proxy', '1');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    const targetUrlStr = req.query.url;
    if (!targetUrlStr) {
        return res.status(400).send('Missing target url query parameter');
    }

    let targetUrl;
    try {
        targetUrl = new URL(targetUrlStr);
    } catch (_) {
        return res.status(400).send('Malformed target URL');
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return res.status(400).send('Invalid protocol. Only HTTP and HTTPS are permitted.');
    }

    // SSRF Prevention Filter
    if (isPrivateHost(targetUrl.hostname)) {
        return res.status(403).send('Target resolves to a restricted private or internal network address.');
    }

    const requestHeaders = {
        'User-Agent': 'IPTVSmartersPro/1.0.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': '*/*',
        'Referer': `${targetUrl.origin}/`
    };

    if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range;
    }

    try {
        const upstream = await fetch(targetUrl.toString(), {
            method: req.method,
            headers: requestHeaders,
            redirect: 'follow',
            signal: AbortSignal.timeout(20000)
        });

        // Forward status and streaming response headers
        res.status(upstream.status);
        const ct = upstream.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', ct);

        ['content-range', 'content-length', 'accept-ranges'].forEach(h => {
            const v = upstream.headers.get(h);
            if (v) res.setHeader(h, v);
        });

        // Rewrite M3U8 child segments and manifests through the proxy
        if (targetUrl.pathname.endsWith('.m3u8') || ct.includes('mpegurl')) {
            const text = await upstream.text();
            const baseUrl = upstream.url || targetUrl.toString();
            const rewritten = rewriteM3U8(text, baseUrl);
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
            return res.send(rewritten);
        }

        // Stream raw media binary (TS, MP4, AAC)
        const arrayBuffer = await upstream.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        return res.status(502).send(`Upstream provider error: ${err.message}`);
    }
}

function rewriteM3U8(manifest, baseUrl) {
    const base = new URL(baseUrl);
    return manifest.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => {
                const resolved = uri.startsWith('http') ? uri : new URL(uri, base).href;
                return `URI="/api/proxy?url=${encodeURIComponent(resolved)}"`;
            });
        }
        const resolved = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
        return `/api/proxy?url=${encodeURIComponent(resolved)}`;
    }).join('\n');
}