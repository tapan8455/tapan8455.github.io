# AURA IPTV — Ultimate macOS Edition

AURA IPTV is a macOS desktop IPTV client built around the supplied AURA HTML client, with a native Electron shell and a dedicated provider/media network bridge.

## What this edition fixes

- Native Electron networking for Xtream-style provider API requests.
- Native `aura://stream` media proxy for HLS, MPEG-TS and direct media URLs.
- No public CORS-proxy dependency.
- HLS recovery for network and media errors.
- MPEG-TS/MSE playback with lazy loading and a bounded buffer.
- Direct MP4/WebM playback through Chromium when supported.
- Automatic alternate URL attempts for common provider URL layouts.
- macOS hidden-inset title bar and traffic-light placement.
- Keyboard shortcuts and full-screen player behavior.
- Existing AURA Live TV, Movies, Series, Search, History, Favorites/My List and episode drawer functionality retained.

## Important media note

No application can honestly guarantee playback of *every* possible IPTV stream: providers can send unsupported codecs, encrypted/DRM media, broken manifests, malformed transport streams, or server-side failures. This build is designed to make ordinary authorized IPTV streams recoverable and smooth, while exposing a clean architecture for adding a native libmpv/FFmpeg backend later if you want broader codec coverage.

DRM-protected or unauthorized content is not bypassed.

## Run on macOS

Requirements:

- macOS 12 or newer recommended
- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm start
```

Build installers:

```bash
npm run dist
```

For Apple Silicon:

```bash
npm run dist:arm64
```

For Intel Macs:

```bash
npm run dist:x64
```

## Provider setup

Open **Menu / Sources** inside AURA and enter the provider/server URL, username and password supplied by your authorized IPTV provider.

Do not ship real provider credentials inside the source code.

## Playback design

The renderer asks the native preload bridge for a proxied URL:

`aura://stream?url=<encoded-provider-url>`

Electron resolves that URL through its native networking stack and returns the response stream to the player. This avoids relying on browser CORS behavior and lets the app consistently attach a desktop user-agent/referrer.

HLS playback uses hls.js recovery paths for recoverable network/media errors. MPEG-TS streams use mpegts.js MSE playback when available. Direct media falls back to the Chromium video element.

## Next native-media upgrade

For maximum codec coverage, the next optional backend is libmpv/FFmpeg. That can cover formats/codecs Chromium does not natively decode (for example certain MKV/HEVC/AC-3 combinations). A production release should ship properly licensed, signed macOS binaries for both Apple Silicon and Intel rather than copying Linux binaries into the app.

## Project layout

```text
AURA IPTV/
├── main.js                 # Electron main process + native network/media bridge
├── preload.js              # Safe renderer bridge
├── package.json
├── src/
│   └── index.html          # AURA UI + IPTV logic + player UI
└── README.md
```
