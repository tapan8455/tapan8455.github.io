/* AURA IPTV — core: helpers, network bridge, storage, settings, sources, user data.
   Classic script (no modules) so it also loads from file:// inside Electron. */
'use strict';

const App = window.App = {};
App.BRAND = { first: 'AURA', second: 'IPTV' };

/* ------------------------------------------------------------------ helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const ic = (name, extra = '') => `<i class="fa-solid fa-${name} ${extra}" aria-hidden="true"></i>`;
const icr = (name, extra = '') => `<i class="fa-regular fa-${name} ${extra}" aria-hidden="true"></i>`;
const icb = (name, extra = '') => `<i class="fa-brands fa-${name} ${extra}" aria-hidden="true"></i>`;

function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}
function fmtHM(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}
function normText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, ' ').trim();
}
function b64(s) {
  if (!s) return '';
  try { return decodeURIComponent(escape(atob(s))); } catch (_) { try { return atob(s); } catch (__) { return s; } }
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function qualityOf(name) {
  const n = String(name || '').toUpperCase();
  if (/\b(4K|UHD|2160P?)\b/.test(n)) return '4K';
  if (/\b(FHD|1080P?)\b/.test(n)) return 'FHD';
  if (/\b(HD|720P?)\b/.test(n)) return 'HD';
  if (/\bSD\b/.test(n)) return 'SD';
  return '';
}
function yearOf(item) {
  if (item.year) return String(item.year);
  const m = String(item.name || '').match(/\((19|20)\d{2}\)/) || String(item.name || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0].replace(/[()]/g, '') : '';
}
async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return 'h' + hashStr(text) + '_' + hashStr(text.split('').reverse().join(''));
  }
}
function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }

Object.assign(App, { $, $$, esc, sleep, clamp, fmtNum, uid, debounce, ic, icr, icb, fmtTime, fmtClock, fmtDate, fmtHM, fmtBytes, normText, b64, hashStr, qualityOf, yearOf, sha256, haptic });

/* ------------------------------------------------------------- web bridge
   Electron exposes window.auraNative through preload.js. Everywhere else we
   polyfill it: same-origin server.js (/api/request, /stream) when available,
   otherwise direct provider calls with an optional user-configured CORS proxy
   (needed on GitHub Pages, which is HTTPS-only and has no backend). */
const Net = App.Net = {
  hasServer: false,
  isGitHubPages: location.hostname.endsWith('github.io'),
  get isElectron() { return !!(window.auraNative && window.auraNative.platform && window.auraNative.platform !== 'web'); },
  get isHttpsPage() { return location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname); },
  proxyTemplate() { return (localStorage.getItem('aura_custom_proxy') || '').trim(); },
  wrapCustom(url) {
    const p = this.proxyTemplate();
    if (!p) return url;
    return p.includes('%s') ? p.replace('%s', encodeURIComponent(url)) : `${p.replace(/\/+$/, '')}/${encodeURIComponent(url)}`;
  },
  // Undo a previous proxy wrapping (server.js rewrites HLS segments to /stream?url=...).
  unwrap(url) {
    const s = String(url);
    const m = s.match(/(?:\/stream|aura:\/\/stream)\?url=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    const p = this.proxyTemplate();
    if (p) {
      const pre = p.includes('%s') ? p.split('%s')[0] : `${p.replace(/\/+$/, '')}/`;
      if (pre && s.startsWith(pre)) { try { return decodeURIComponent(s.slice(pre.length).split('&')[0]); } catch (_) {} }
    }
    return s;
  },
  // Media URL as the <video>/MSE engine should request it.
  media(url) {
    if (!url) return '';
    if (/^(blob:|data:)/.test(url)) return url;
    if (this.isElectron && window.auraNative.mediaProxy) return window.auraNative.mediaProxy(this.unwrap(url));
    const raw = this.unwrap(url);
    if (this.hasServer) return `/stream?url=${encodeURIComponent(raw)}`;
    if (this.proxyTemplate() && (this.isHttpsPage && raw.startsWith('http://') || localStorage.getItem('aura_proxy_all') === '1')) return this.wrapCustom(raw);
    return raw;
  },
  // True when the browser will refuse this URL outright (mixed content, no proxy available).
  blocked(url) {
    return this.isHttpsPage && String(url).startsWith('http://') && !this.hasServer && !this.isElectron && !this.proxyTemplate();
  },
  image(url) {
    if (!url) return '';
    if (this.isHttpsPage && url.startsWith('http://')) {
      if (this.hasServer) return `/stream?url=${encodeURIComponent(url)}`;
      if (this.proxyTemplate() && localStorage.getItem('aura_proxy_images') === '1') return this.wrapCustom(url);
      return url.replace(/^http:/, 'https:');
    }
    return url;
  },
  async init() {
    if (this.isElectron || this.isGitHubPages || location.protocol === 'file:') return;
    try {
      const r = await fetch('/health', { signal: AbortSignal.timeout(2500), cache: 'no-store' });
      this.hasServer = r.ok;
    } catch (_) { this.hasServer = false; }
  },
  async fetchJSON(url, timeout = 20000) {
    const attempts = [];
    if (!this.blocked(url)) attempts.push(url);
    if (this.proxyTemplate()) attempts.push(this.wrapCustom(url));
    if (!attempts.length) throw Object.assign(new Error('Blocked: this HTTPS page cannot reach an http:// provider without a proxy.'), { code: 'mixed' });
    let lastErr;
    for (const u of attempts) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(timeout) });
        if (!r.ok) throw Object.assign(new Error(`Provider returned HTTP ${r.status}`), { status: r.status });
        const text = await r.text();
        try { return JSON.parse(text); } catch (_) { throw new Error('Provider did not return JSON'); }
      } catch (e) { lastErr = e; if (e.status === 401 || e.status === 403) break; }
    }
    if (lastErr && /Failed to fetch|NetworkError|Load failed/i.test(lastErr.message)) {
      lastErr = Object.assign(new Error(this.isHttpsPage && url.startsWith('http://') ? 'The browser blocked this http:// provider on an HTTPS page.' : 'Network error or the provider blocks browser requests (CORS).'), { code: this.isHttpsPage && url.startsWith('http://') ? 'mixed' : 'cors' });
    }
    throw lastErr;
  },
  async fetchText(url, timeout = 60000) {
    const target = this.hasServer || this.isElectron ? this.media(url) : url;
    const attempts = [];
    if (!this.blocked(target)) attempts.push(target);
    if (!this.hasServer && !this.isElectron && this.proxyTemplate()) attempts.push(this.wrapCustom(url));
    let lastErr = Object.assign(new Error('Blocked by HTTPS mixed-content rules. Configure a proxy.'), { code: 'mixed' });
    for (const u of attempts) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(timeout) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.text();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
};

if (!window.auraNative) {
  window.auraNative = {
    platform: 'web',
    version: 'web-3.0.0',
    async apiRequest(args) {
      if (Net.hasServer) {
        const res = await fetch('/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(args.timeout || 120000) });
        const data = await res.json().catch(() => null);
        if (!res.ok || (data && data.error)) throw new Error((data && data.error) || `HTTP ${res.status}`);
        return data;
      }
      const srv = (args.server || '').trim().replace(/\/+$/, '');
      const url = `${srv}/player_api.php?username=${encodeURIComponent(args.user || '')}&password=${encodeURIComponent(args.pass || '')}${args.action ? `&action=${encodeURIComponent(args.action)}` : ''}${args.params || ''}`;
      const data = await Net.fetchJSON(url, args.timeout || 20000);
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    async testConnection(args) {
      try {
        const data = await window.auraNative.apiRequest({ ...args, timeout: 20000 });
        if (data && data.user_info && Number(data.user_info.auth) === 0) return { success: false, error: 'Invalid username or password' };
        if (!data || !data.user_info) return { success: false, error: 'This server did not answer like an Xtream Codes panel.' };
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message, code: e.code };
      }
    },
    mediaProxy: (url) => Net.media(url),
    toggleFullScreen() {
      const d = document;
      if (!(d.fullscreenElement || d.webkitFullscreenElement)) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
      else (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
    },
    isFullScreen: async () => !!(document.fullscreenElement || document.webkitFullscreenElement),
    async copyToClipboard(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
    },
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    async downloadFile({ url, filename }) {
      const a = document.createElement('a');
      a.href = Net.hasServer ? `/stream?url=${encodeURIComponent(url)}&download=1` : url;
      a.download = filename || 'video.mp4';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
      return { success: true };
    }
  };
}

/* ------------------------------------------------------------- storage */
const LS = App.LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('[storage] write failed', k, e.message); } },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};

// Tiny IndexedDB key/value store for the big catalog payloads (100k+ items do not fit localStorage).
const IDB = App.IDB = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open('aura-iptv', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._db;
  },
  async get(key) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    } catch (_) { return undefined; }
  },
  async set(key, val) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { console.warn('[idb] write failed', e && e.message); }
  },
  async del(key) {
    try {
      const db = await this.open();
      await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = res; tx.onerror = res; });
    } catch (_) {}
  },
  async clear() {
    try {
      const db = await this.open();
      await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = res; tx.onerror = res; });
    } catch (_) {}
  }
};

/* ------------------------------------------------------------- event bus */
const Bus = App.Bus = {
  _h: {},
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); },
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); },
  emit(ev, data) { (this._h[ev] || []).slice().forEach(f => { try { f(data); } catch (e) { console.error(e); } }); }
};

/* ------------------------------------------------------------- settings */
const THEMES = App.THEMES = [
  { id: 'blue', name: 'Stream Blue', sub: 'Clean IPTV blue', icon: 'check', cls: 'c-blue' },
  { id: 'red', name: 'Cinema Red', sub: 'Bold streaming red', icon: 'film', cls: 'c-red' },
  { id: 'gold', name: 'Prime Gold', sub: 'Warm premium gold', icon: 'crown', cls: 'c-gold' },
  { id: 'purple', name: 'Neon Purple', sub: 'Arcade streaming glow', icon: 'wand-magic-sparkles', cls: 'c-purple' },
  { id: 'pink', name: 'Cinema Pink', sub: 'Modern poster pink', icon: 'masks-theater', cls: 'c-pink' },
  { id: 'emerald', name: 'Emerald', sub: 'Fresh sports green', icon: 'circle-play', cls: 'c-green' }
];
const PLAYERS = App.PLAYERS = [
  { id: 'smart', name: 'Smart Player', sub: 'Default engine • plays most formats', icon: 'circle-play', recommended: true },
  { id: 'native', name: 'Native Player', sub: 'Browser player • Picture in Picture', icon: 'display', brand: '' },
  { id: 'vlc', name: 'VLC Player', sub: 'External app • plays every format', icon: 'arrow-up-right-from-square' }
];
const REFRESH = App.REFRESH = [
  { id: 'off', label: 'Never', ms: 0 },
  { id: '1d', label: 'Every 1 Day', ms: 864e5 },
  { id: '3d', label: 'Every 3 Days', ms: 3 * 864e5 },
  { id: '1w', label: 'Every 1 Week', ms: 7 * 864e5 },
  { id: '2w', label: 'Every 2 Weeks', ms: 14 * 864e5 },
  { id: '1m', label: 'Every 1 Month', ms: 30 * 864e5 }
];
const DEFAULT_SETTINGS = {
  theme: 'blue', homeType: 'movie', player: 'smart', autoRefresh: '1w',
  freshArrivals: true, continuePlaying: true, heroCarousel: true,
  channelFormat: 'm3u8', biometric: false, biometricCred: null, pinHash: null,
  volume: 1, liveSort: 'provider'
};
const Settings = App.Settings = {
  data: Object.assign({}, DEFAULT_SETTINGS, LS.get('aura3_settings', {})),
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; LS.set('aura3_settings', this.data); Bus.emit('settings', { k, v }); if (k === 'theme') this.applyTheme(); },
  applyTheme() {
    document.documentElement.dataset.theme = this.data.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = '#000000';
  }
};

/* ------------------------------------------------------------- sources */
const Sources = App.Sources = {
  list: LS.get('aura3_sources', []),
  activeId: LS.get('aura3_active', null),
  save() { LS.set('aura3_sources', this.list); LS.set('aura3_active', this.activeId); },
  get active() { return this.list.find(s => s.id === this.activeId) || this.list[0] || null; },
  byId(id) { return this.list.find(s => s.id === id); },
  add(src) { this.list.push(src); this.activeId = src.id; this.save(); return src; },
  update(id, patch) { const s = this.byId(id); if (s) { Object.assign(s, patch); this.save(); } return s; },
  async remove(id) {
    this.list = this.list.filter(s => s.id !== id);
    if (this.activeId === id) this.activeId = this.list[0] ? this.list[0].id : null;
    this.save();
    await IDB.del(`catalog:${id}`);
    LS.del(`aura3_user_${id}`);
  },
  setActive(id) { this.activeId = id; this.save(); },
  hostOf(s) { try { return new URL(s.server || s.m3uUrl).hostname; } catch (_) { return s.name || 'Playlist'; } }
};

// One-time migration from the previous AURA client (single provider in aura_config).
(function migrateLegacy() {
  if (Sources.list.length || LS.get('aura3_migrated', false)) return;
  LS.set('aura3_migrated', true);
  const cfg = LS.get('aura_config', null);
  if (!cfg || !cfg.server || !cfg.user) return;
  const src = { id: uid(), type: 'xtream', server: cfg.server.replace(/\/+$/, ''), user: cfg.user, pass: cfg.pass || '', createdAt: Date.now(), lastRefreshed: 0, counts: { live: 0, movie: 0, series: 0 } };
  src.name = Sources.hostOf(src);
  Sources.add(src);
  const fav = LS.get('aura_favorites', []);
  const prog = LS.get('aura_playback_progress', {});
  const u = { favorites: [], progress: {}, seriesProgress: LS.get('aura_series_progress', {}), recents: [], hidden: {}, locked: {}, downloads: [] };
  fav.forEach(f => f && f.id && u.favorites.push({ id: String(f.id), type: f.type === 'live' ? 'live' : f.type === 'series' ? 'series' : 'movie', name: f.title || f.name || '', icon: f.img || f.stream_icon || '', at: Date.now() }));
  Object.entries(prog).forEach(([id, p]) => { u.progress[id] = { pos: p.currentTime, dur: p.duration, at: p.updatedAt || Date.now(), type: 'movie' }; });
  LS.set(`aura3_user_${src.id}`, u);
})();

/* ------------------------------------------------------------- per-source user data */
const User = App.User = {
  d: null,
  load() {
    const s = Sources.active;
    this.d = Object.assign({ favorites: [], progress: {}, seriesProgress: {}, recents: [], hidden: {}, locked: {}, downloads: [], liveCat: null }, s ? LS.get(`aura3_user_${s.id}`, {}) : {});
    return this.d;
  },
  save() { const s = Sources.active; if (s) LS.set(`aura3_user_${s.id}`, this.d); },
  // favorites
  isFav(type, id) { return this.d.favorites.some(f => f.type === type && String(f.id) === String(id)); },
  toggleFav(item) {
    const id = String(item.id);
    const i = this.d.favorites.findIndex(f => f.type === item.type && String(f.id) === id);
    if (i > -1) this.d.favorites.splice(i, 1);
    else this.d.favorites.unshift({ id, type: item.type, name: item.name, icon: item.icon || '', cat: item.cat, at: Date.now() });
    this.save();
    Bus.emit('favorites');
    return i === -1;
  },
  // progress: movies & episodes keyed by `${kind}:${id}`
  getProgress(kind, id) { return this.d.progress[`${kind}:${id}`] || null; },
  setProgress(kind, id, pos, dur, meta = {}) {
    if (!isFinite(pos) || !isFinite(dur) || dur <= 0) return;
    this.d.progress[`${kind}:${id}`] = Object.assign({ pos: Math.floor(pos), dur: Math.floor(dur), at: Date.now() }, meta);
    this.save();
  },
  clearProgress(kind, id) { delete this.d.progress[`${kind}:${id}`]; this.save(); },
  pct(p) { return p && p.dur ? clamp(Math.round(p.pos / p.dur * 100), 0, 100) : 0; },
  // series progress: last episode watched per series
  setSeriesProgress(seriesId, data) { this.d.seriesProgress[String(seriesId)] = Object.assign({ at: Date.now() }, data); this.save(); },
  getSeriesProgress(seriesId) { return this.d.seriesProgress[String(seriesId)] || null; },
  // recents
  addRecent(item) {
    this.d.recents = this.d.recents.filter(r => !(r.type === item.type && String(r.id) === String(item.id)));
    this.d.recents.unshift({ id: String(item.id), type: item.type, name: item.name, icon: item.icon || '' });
    this.d.recents = this.d.recents.slice(0, 20);
    this.save();
  },
  // category prefs
  isHidden(type, catId) { return !!this.d.hidden[`${type}:${catId}`]; },
  isLocked(type, catId) { return !!this.d.locked[`${type}:${catId}`]; },
  setHidden(type, catId, v) { if (v) this.d.hidden[`${type}:${catId}`] = 1; else delete this.d.hidden[`${type}:${catId}`]; this.save(); },
  setLocked(type, catId, v) { if (v) this.d.locked[`${type}:${catId}`] = 1; else delete this.d.locked[`${type}:${catId}`]; this.save(); }
};

/* Session-only unlock of PIN-locked categories (cleared when the tab is hidden for a while). */
App.unlocked = false;
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 120000) { App.unlocked = false; Bus.emit('relock'); }
});
