# AURA IPTV — Stream & API Proxy Guide

This document explains the architecture, security guarantees, anti-abuse controls, and deployment options for the AURA IPTV proxy.

---

## 1. Why a Proxy is Needed

In modern web browsers, client-side IPTV players encounter two primary network limitations:
1. **Mixed Content Security**: A secure web application hosted over HTTPS (such as on Vercel) is forbidden by browser security policies from loading unencrypted `http://` video streams or API calls directly.
2. **CORS (Cross-Origin Resource Sharing)**: Many IPTV providers do not set `Access-Control-Allow-Origin: *` headers on their HLS manifests (`.m3u8`), MPEG-TS chunks (`.ts`), or Xtream Codes API endpoints (`player_api.php`). Without CORS headers, web browsers block media playback and API responses.

The AURA proxy resolves both challenges by:
- Relaying API queries with appropriate CORS headers (`Access-Control-Allow-Origin: *`).
- Proxifying media streams and rewriting `.m3u8` playlists so that segment references route through the secure proxy tunnel.

---

## 2. Privacy & Disclosure Notice

> [!IMPORTANT]
> **Privacy Guarantee**:
> - The proxy operates **strictly as a pass-through pipe**.
> - **Zero credential logging**: Usernames, passwords, and tokens are never written to logs, disk, or monitoring systems.
> - **Zero URL logging**: Full upstream target URLs with query parameters are scrubbed from server stdout.
> - **Zero media caching**: Media streams (`.ts`, `.m3u8`) are piped directly to the response socket without persisting to disk.

---

## 3. Anti-Abuse & SSRF Protections

To prevent the proxy from being exploited as an open relay or scanning internal networks, `server.js` enforces strict security boundaries:

1. **SSRF (Server-Side Request Forgery) Prevention**:
   The proxy rejects requests targeting private, loopback, or cloud-metadata IP ranges:
   - `127.0.0.0/8` (Localhost)
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private RFC-1918 networks)
   - `169.254.169.254` (Cloud Instance Metadata Service / AWS / GCP IMDS)
   - `::1` and IPv6 link-local addresses
2. **Scheme Restriction**:
   Only `http://` and `https://` upstream targets are permitted.
3. **Session & Stream Tracking**:
   Active streaming sessions can be explicitly halted via `/api/stop-stream` when switching channels or closing the player, saving upstream provider connection quotas.

---

## 4. Self-Hosting Options

### Option A: Local Node.js Server (Recommended for Desktop / Home Network)
AURA IPTV includes a zero-dependency streaming server in `server.js`:

```bash
# Clone the repository
git clone https://github.com/your-username/AURA-IPTV-universal-web-desktop-.git
cd AURA-IPTV-universal-web-desktop-

# Install any optional dev dependencies (optional)
npm install

# Run the proxy server
npm run serve
```
By default, the server listens at `http://0.0.0.0:3000`. You can change the port with the `PORT` environment variable:
```bash
PORT=8080 npm run serve
```

### Option B: Docker Container
Run AURA in an isolated container on your NAS, Raspberry Pi, or home server:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY server.js ./
COPY src/ ./src/
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t aura-iptv .
docker run -d -p 3000:3000 --name aura aura-iptv
```

### Option C: Cloud Deployment (Railway, Render, Fly.io)
Deploy `server.js` directly as a Node.js web service on any hosting platform that supports persistent HTTP connections for streaming media:
- **Build Command**: `echo 'Ready'`
- **Start Command**: `node server.js`
- **Port**: `3000` (or `$PORT`)

---

## 5. Connecting AURA Web Client to your Proxy

When hosting the static web app on Vercel or GitHub Pages, you can configure your self-hosted proxy in **Settings & Sources**:
1. Open **Settings & Sources** (`Cmd+,` or click the gear icon).
2. Enter your Provider Server URL. If your provider requires proxying, prepend your proxy address or configure the custom Proxy Gateway URL.
3. Click **Test** to verify connectivity, then click **Save & Connect**.
