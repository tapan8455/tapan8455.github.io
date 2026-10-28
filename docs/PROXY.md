# AURA IPTV — Proxy Architecture & Deployment Guide

## Overview
AURA IPTV is designed as a direct client player. By default, your browser contacts your IPTV provider directly. However, two common real-world conditions prevent direct browser playback:
1. **Mixed Content Blockades:** When AURA is served over secure HTTPS (e.g. `https://aura-iptv.vercel.app`), modern browsers disallow loading insecure `http://` video streams.
2. **Missing CORS Headers:** Most IPTV providers do not send `Access-Control-Allow-Origin: *` headers, which causes browser fetch requests for HLS manifests to be rejected.

The AURA proxy is an optional, opt-in component that relays requests, rewrites M3U8 playlist paths, and safely supplies CORS headers.

---

## Security & Anti-Abuse Measures
The included proxy engine strictly enforces the following rules:
- **Zero Logging of Credentials:** Provider authentication details (usernames, passwords, stream tokens) are never recorded in log files or metrics.
- **SSRF Subnet Whitelist:** Requests attempting to resolve loopback addresses (`127.0.0.1`), LAN private subnets (`192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`), or cloud provider metadata endpoints (`169.254.169.254`) are immediately rejected with HTTP 403.
- **Rate-Limiting:** IP-based token bucket limiting prevents the proxy from being exploited as an open relay.
- **Header Disclosure:** Injected `X-Aura-Proxy: 1` headers clearly identify proxied streams.

---

## Deployment Options

### Option 1: Vercel Serverless (Recommended for Web)
The repository includes a serverless endpoint under `/api/proxy.js`.
1. Deploy the repository to Vercel.
2. The proxy will be automatically available at `https://your-vercel-domain.vercel.app/api/proxy?url=...`.
3. In AURA Settings, enable **CORS / Insecure Stream Proxy**.

### Option 2: Docker Self-Hosted Container
For high-bandwidth streaming or self-hosting on a home server (Unraid, Synology, TrueNAS):

```bash
docker run -d \
  --name aura-proxy \
  -p 3000:3000 \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  --restart unless-stopped \
  node:20-alpine sh -c "npx --yes http-proxy"