# AURA IPTV — System Architecture & Codebase Map

## 1. System Overview & Deployment Targets

AURA IPTV is a high-performance, privacy-first, client-side IPTV player engineered for three deployment targets:
1. **Web / PWA**: Hosted on Vercel (`https://aura-iptv-universal-web-desktop.vercel.app/`), modern web browsers, mobile browsers (iOS/Android), and Smart TVs.
2. **Desktop (Electron)**: macOS, Windows, and Linux standalone application with native networking and window chrome integration.
3. **Self-Hosted / Cloud Server**: Containerized Docker image (`Dockerfile`) and Node.js server (`server.js`) deployable on Render, Railway, Fly.io, or VPS.

---

## 2. Codebase Layout & Directory Structure

```text
AURA-IPTV-universal-web-desktop/
├── src/
│   ├── index.html         # Application shell, accessible landmarks, modals, player UI
│   ├── css/
│   │   └── aura.css       # Unified design system tokens, landscape and mobile fixes, custom scrollbars
│   └── js/
│       └── aura-app.js    # Core client coordinator (state, player, catalog, events)
├── docs/
│   └── ARCHITECTURE.md    # This architectural specification
├── Dockerfile             # Alpine Linux Node.js container definition
├── main.js                # Electron main process (GPU flags, lifecycle, native network bridge)
├── preload.js             # Electron context isolation bridge exposing window.auraNative
├── server.js              # Standalone Node.js server with built-in CORS & M3U8 rewrite proxy
├── start.js               # Universal entrypoint selecting Electron or Node.js runtime
├── package.json           # Dependencies, scripts, and Electron builder configuration
└── render.yaml            # Render web service deployment configuration
```

---

## 3. State Management Architecture

The client state is managed in a centralized, top-level reactive state object within [`src/js/aura-app.js`](file:///c:/Users/dandawalat/Documents/GitHub/AURA-IPTV-universal-web-desktop-/src/js/aura-app.js):

```javascript
const state = {
    currentTab: 'vod',                 // Active main tab ('live' | 'vod' | 'series' | 'favorites' | 'search')
    currentSort: 'popular',             // Sorting strategy ('popular' | 'new' | 'az')
    currentFilterPill: 'all',          // Active filter pill ('all' | '4k' | 'fhd' | letter | custom)
    categories: {
        vod: [],                        // Normalized Movie categories
        live: [],                       // Normalized Live TV categories
        series: []                      // Normalized TV Series categories
    },
    allLiveCategories: [],             // Cached full category list for channel management
    categoryMap: {},                   // Fast ID -> Name category lookup table
    streams: {},                       // Stream cache indexed by category ID
    activeCategoryStreams: [],         // Currently active items rendered in the main grid
    history: [],                       // Watched streams with progress markers
    favorites: [],                     // Bookmarked channels and titles
    playerEngine: null,                // Active demuxer instance (Hls or mpegts Player)
    playbackSessionId: 0,              // Incremental counter to cancel in-flight stream segments
    currentActiveMovie: null,          // Currently playing media descriptor
    currentPlaylist: [],               // Channel/episode playlist for player drawer
    currentIndex: -1,                  // Current index within the active playlist
    globalSearchCache: [],             // Normalized search items across all categories
    isFetchingSearch: false,           // Lock for asynchronous search preloading
    activeStreamUrl: ''                // Raw or proxied stream URL in active playback
};
```

---

## 4. Networking & Bridge Abstraction

AURA utilizes a multi-layered bridge to safely route IPTV requests without triggering browser CORS blocks or exposing credentials:

1. **Native Bridge (`window.auraNative`)**:
   - In Electron, `preload.js` exposes IPC handlers (`aura:api-request`, `aura:test-connection`) with native Node.js network access, completely bypassing browser CORS and mixed-content restrictions.
   - Proxied media streams use the custom scheme `aura://stream?url=<encoded-url>`.
2. **Web Polyfill**:
   - When running in standard web browsers, `window.auraNative` polyfills API requests to `/api/request` and `/api/test-connection`.
   - Media streaming requests are routed through `/stream?url=<encoded-url>` when proxying is enabled or when running over HTTPS.
3. **Streaming & Manifest Rewriting (`server.js`)**:
   - Upstream HLS manifests (`.m3u8`) are parsed and rewritten so all `.ts` segments and nested playlists relay through the authenticated streaming proxy.
   - Provider HTTP User-Agent and Referer headers (`IPTVSmartersPro/1.0.0`) are consistently attached.

---

## 5. Player Engine Lifecycle

The media player supports adaptive streaming, direct playback, and recovery mechanisms:

1. **Engine Selection**:
   - **HLS (.m3u8)**: Demuxed using `hls.js` with bounded buffer size, low latency tuning, and automated recovery via `Hls.Events.ERROR`.
   - **MPEG-TS (.ts)**: Demuxed via `mpegts.js` (MSE) with lazy loading and cleanup.
   - **Native Direct (MP4, WebM)**: Decoded directly through the Chromium / WebKit HTML5 `<video>` pipeline.
2. **Session Cancellation & Memory Safety**:
   - Every channel switch increments `playbackSessionId` and calls `cleanupPlayerResources()`, immediately aborting active XHR/fetch pipelines and preventing memory leaks.
3. **Live Stream Detection**:
   - `isStreamLive()` inspects stream type, URL tokens, category metadata, and `hls.liveSyncPosition` to dynamically toggle live edge controls vs. VOD scrubbers.

---

## 6. Storage & Security Model

- **Current State**: Uses synchronous `localStorage` (`aura_config`, `aura_favorites`, `aura_history`, `aura_tv_prefs`).
- **Phase 2 Target**: Migration to asynchronous, non-blocking `IndexedDB` with optional WebCrypto encryption for provider credentials.
- **Credential Protection**:
  - Provider passwords are never appended to client-facing export URLs.
  - No credential logging in server metrics or browser console outputs.
