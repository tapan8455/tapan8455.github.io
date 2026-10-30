/* AURA IPTV — playback engine (hls.js / mpegts.js / native) and the full-screen player UI. */
'use strict';
(function () {
  const { $, $$, esc, ic, icr, icb, fmtTime, Net, Settings, User, Bus, Catalog, UI, haptic, clamp } = App;

  /* ================================================================ Engine
     Tries each candidate URL in turn. A candidate fails over on fatal errors or when
     it has not started within the watchdog window. Live streams reconnect a bounded
     number of times with backoff, never in an infinite loop. */
  class Engine {
    constructor(video, hooks = {}) {
      this.video = video;
      this.hooks = hooks; // onStatus(status), onError(info), onLevels(), onLive(isLive)
      this.session = 0;
      this.inst = null;
      this.watchdog = null;
      this.stallTimer = null;
      this.reconnects = 0;
      this.lastError = null;
    }
    status(s, extra) { this.hooks.onStatus && this.hooks.onStatus(s, extra); }
    clearTimers() { clearTimeout(this.watchdog); clearTimeout(this.stallTimer); this.watchdog = this.stallTimer = null; }
    teardown() {
      this.clearTimers();
      if (this.inst) {
        try {
          if (this.inst.stopLoad) this.inst.stopLoad();
          if (this.inst.unload) this.inst.unload();
          if (this.inst.detachMedia) this.inst.detachMedia();
          else if (this.inst.detachMediaElement) this.inst.detachMediaElement();
          this.inst.destroy();
        } catch (_) {}
        this.inst = null;
      }
      const v = this.video;
      const onerr = v.onerror;
      v.onerror = null;
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
      v.onerror = onerr;
    }
    destroy() { this.session++; this.teardown(); this.detachEvents(); }

    load(candidates, { mode = 'smart', live = false, startAt = 0 } = {}) {
      this.teardown();
      const session = ++this.session;
      let list = candidates.slice();
      if (!Net.isElectron && !live) {
        const mp4s = list.filter(u => /\.mp4(\?|$)/i.test(u));
        const others = list.filter(u => !/\.mp4(\?|$)/i.test(u));
        list = mp4s.length ? [...mp4s, ...others] : list;
      }
      this.candidates = list;
      this.mode = mode; this.live = live; this.startAt = startAt; this.attempt = 0; this.reconnects = 0; this.lastError = null; this.started = false;
      this._fallbackTried = false;
      this._triedDirect = false;
      this.attachEvents(session);
      this.status('loading');
      if (!candidates.length) return this.fail({ reason: 'nourl' });
      this.next(session);
    }

    fail(info) {
      this.clearTimers();
      this.status('error');
      this.hooks.onError && this.hooks.onError(Object.assign({ url: this.candidates && this.candidates[0], lastError: this.lastError, mediaCode: this.video.error && this.video.error.code }, info));
    }

    next(session) {
      if (session !== this.session) return;
      this.teardown();
      if (this.attempt >= this.candidates.length) {
        if (!this._fallbackTried && this.candidates.length > 0) {
          this._fallbackTried = true;
          this.attempt = 0;
          this.mode = this.mode === 'smart' ? 'native' : 'smart';
          const url = this.candidates[this.attempt++];
          this.url = url;
          const failover = (why) => { if (session !== this.session) return; if (why) this.lastError = why; this.next(session); };
          try {
            if (this.mode === 'smart') {
              const isHls = /\.m3u8(\?|$)/i.test(url);
              const isTs = /\.ts(\?|$)/i.test(url) || (!/\.(mp4|mkv|webm|mov|avi|m4v)(\?|$)/i.test(url) && this.live);
              if (isHls && window.Hls && Hls.isSupported()) return this.playHls(url, session, failover);
              if (isTs && !isHls && window.mpegts && mpegts.getFeatureList().mseLivePlayback) return this.playTs(url, session, failover);
            }
            return this.playNative(url, session, failover);
          } catch (_) {}
        }
        return this.fail({ reason: this.lastError && this.lastError.reason });
      }
      const url = this.candidates[this.attempt++];
      this.url = url;
      this._triedDirect = false;
      this.status('loading', { attempt: this.attempt, total: this.candidates.length });
      this.lastError = null;
      const v = this.video;
      const failover = (why) => { if (session !== this.session) return; if (why) this.lastError = why; this.next(session); };
      const timeoutLimit = this.live ? 10000 : 7000;
      this.watchdog = setTimeout(() => {
        if (session === this.session && (v.readyState < 2 || (v.currentTime === 0 && !this.started))) {
          if (this.url && !this._triedDirect && Net.media(this.url) !== this.url && !Net.blocked(this.url)) {
            this._triedDirect = true;
            return this.playNative(this.url, session, failover, true);
          }
          this.lastError = this.lastError || { reason: 'timeout' };
          failover();
        }
      }, timeoutLimit);
      const isHls = /\.m3u8(\?|$)/i.test(url);
      const isTs = /\.ts(\?|$)/i.test(url) || (!/\.(mp4|mkv|webm|mov|avi|m4v)(\?|$)/i.test(url) && this.live);
      const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
      try {
        if (this.mode === 'smart' && isHls && window.Hls && Hls.isSupported()) return this.playHls(url, session, failover);
        if (this.mode === 'smart' && isTs && !isHls && window.mpegts && mpegts.getFeatureList().mseLivePlayback) return this.playTs(url, session, failover);
        if (isHls && !nativeHls && this.mode === 'native' && window.Hls && Hls.isSupported()) return this.playHls(url, session, failover);
        this.playNative(url, session, failover);
      } catch (e) {
        this.lastError = { reason: 'exception', msg: e.message };
        failover();
      }
    }

    playNative(url, session, failover, direct = false) {
      const v = this.video;
      const target = direct ? url : Net.media(url);
      v.src = target;
      if (this.startAt > 0) { const t = this.startAt; v.addEventListener('loadedmetadata', () => { if (session === this.session && v.duration > t) v.currentTime = t; }, { once: true }); }
      v.play().catch(e => {
        if (session !== this.session) return;
        if (e.name === 'NotAllowedError') {
          // iOS Safari blocks unmuted autoplay. Mute and retry so stream starts playing immediately.
          v.muted = true;
          v.play().then(() => hud('Muted for autoplay · Tap screen to unmute')).catch(() => this.status('paused'));
        } else if (e.name !== 'AbortError') {
          if (!direct && target !== url && !Net.blocked(url)) {
            this._triedDirect = true;
            return this.playNative(url, session, failover, true);
          }
          failover({ reason: 'media', msg: e.message });
        }
      });
      // Fast check: If loading via proxy, check if the proxy returned an HTTP error (like 401 or 522)
      if (!direct && target !== url) {
        fetch(target, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(3500) })
          .then(r => {
            if (session === this.session && !this.started && (r.status === 401 || r.status === 403 || r.status >= 500)) {
              if (!Net.blocked(url)) {
                this._triedDirect = true;
                this.playNative(url, session, failover, true);
              } else {
                failover({ reason: r.status === 401 || r.status === 403 ? 'auth' : 'network', code: r.status });
              }
            }
          })
          .catch(() => {});
      }
    }

    playHls(url, session, failover) {
      const v = this.video;
      const viaCustomProxy = !Net.hasServer && !Net.isElectron && !!Net.proxyTemplate() && ((Net.isHttpsPage && url.startsWith('http://')) || localStorage.getItem('aura_proxy_all') === '1');
      const hls = new Hls({
        enableWorker: true, lowLatencyMode: false, backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 60,
        liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, liveDurationInfinity: true,
        manifestLoadingTimeOut: 15000, manifestLoadingMaxRetry: 2, manifestLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 20000, fragLoadingMaxRetry: 6, fragLoadingRetryDelay: 1000,
        startPosition: this.startAt > 0 ? this.startAt : -1,
        // Relative segment URLs must resolve against the provider URL, so we load the raw
        // manifest URL and rewrite each request through the CORS proxy here.
        xhrSetup: viaCustomProxy ? (xhr, u) => { xhr.open('GET', Net.wrapCustom(Net.unwrap(u)), true); } : undefined
      });
      this.inst = hls;
      hls.loadSource(Net.media(url));
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (session !== this.session) return;
        const pref = localStorage.getItem('aura_quality_pref') || 'auto';
        if (pref !== 'auto' && hls.levels.length) {
          const idx = hls.levels.findIndex(l => String(l.height) === pref);
          if (idx > -1) hls.currentLevel = idx;
        }
        this.hooks.onLevels && this.hooks.onLevels();
        v.play().catch(e => {
          if (e && e.name === 'NotAllowedError') {
            v.muted = true;
            v.play().then(() => hud('Muted for autoplay · Tap screen to unmute')).catch(() => {});
          }
        });
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_, d) => { if (session === this.session && d && d.details) this.hooks.onLive && this.hooks.onLive(!!d.details.live); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (session === this.session) this.hooks.onLevels && this.hooks.onLevels(); });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.hooks.onLevels && this.hooks.onLevels());
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.hooks.onLevels && this.hooks.onLevels());
      let netRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (session !== this.session || !d.fatal) return;
        const code = d.response && d.response.code;
        if (d.details === 'manifestLoadError' || d.details === 'manifestParsingError' || d.details === 'manifestLoadTimeOut') {
          return failover({ reason: code === 401 || code === 403 ? 'auth' : code === 404 ? 'offline' : d.details === 'manifestParsingError' ? 'media' : 'network', code });
        }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netRecoveries < 3) { netRecoveries++; hls.startLoad(); return; }
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && netRecoveries < 3) { netRecoveries++; hls.recoverMediaError(); return; }
        failover({ reason: d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'network', code });
      });
    }

    playTs(url, session, failover) {
      const v = this.video;
      const player = mpegts.createPlayer({ type: 'mpegts', isLive: this.live, url: Net.media(url) }, {
        enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: this.live, liveBufferLatencyMaxLatency: 2.5, liveBufferLatencyMinRemain: 0.8,
        autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15
      });
      this.inst = player;
      player.attachMediaElement(v);
      player.load();
      player.on(mpegts.Events.ERROR, (type, detail, info) => {
        if (session !== this.session) return;
        const code = info && info.code;
        // Reconnect only streams that were actually playing; a stream that never started fails over.
        if (this.live && v.currentTime > 0 && this.reconnects < 5) return this.reconnect(session);
        failover({ reason: code === 401 || code === 403 ? 'auth' : code === 404 ? 'offline' : type === 'MediaError' ? 'media' : 'network', code });
      });
      const p = player.play();
      if (p && p.catch) p.catch(() => {});
    }

    reconnect(session) {
      if (session !== this.session) return;
      this.reconnects++;
      const delay = Math.min(8000, 1000 * Math.pow(2, this.reconnects - 1));
      this.status('reconnecting', { n: this.reconnects });
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        if (session !== this.session) return;
        if (this.inst && this.inst.unload) {
          try { this.inst.unload(); this.inst.load(); const p = this.inst.play(); if (p && p.catch) p.catch(() => {}); return; } catch (_) {}
        }
        if (this.inst && this.inst.startLoad) { try { this.inst.startLoad(); return; } catch (_) {} }
        this.attempt = Math.max(0, this.attempt - 1);
        this.next(session);
      }, delay);
    }

    attachEvents(session) {
      const v = this.video;
      this.detachEvents();
      const h = {
        waiting: () => {
          if (session !== this.session) return;
          this.status('buffering');
          if (this.live && !v.paused) {
            clearTimeout(this.stallTimer);
            this.stallTimer = setTimeout(() => {
              if (session === this.session && !v.paused && v.readyState < 3) {
                if (this.reconnects < 5) this.reconnect(session);
                else { this.lastError = { reason: 'stalled' }; this.next(session); }
              }
            }, 6000);
          } else if (!this.live && !v.paused && v.currentTime > 0) {
            clearTimeout(this.stallTimer);
            this.stallTimer = setTimeout(() => {
              if (session === this.session && !v.paused && v.readyState < 3) {
                const cur = v.currentTime;
                if (this.inst && this.inst.startLoad) {
                  try { this.inst.startLoad(); return; } catch (_) {}
                }
                this.startAt = cur;
                this.next(session);
              }
            }, 9000);
          }
        },
        playing: () => { if (session !== this.session) return; this.started = true; clearTimeout(this.watchdog); clearTimeout(this.stallTimer); this.reconnects = 0; this.status('playing'); },
        pause: () => { if (session === this.session && v.readyState >= 2) this.status('paused'); },
        canplay: () => { if (session === this.session) clearTimeout(this.watchdog); },
        error: () => {
          if (session !== this.session) return;
          const code = v.error ? v.error.code : 0;
          this.lastError = { reason: code === 4 ? 'codec' : code === 3 ? 'decode' : 'media', mediaCode: code };
          if (this.url && !this._triedDirect && Net.media(this.url) !== this.url && !Net.blocked(this.url)) {
            this._triedDirect = true;
            const failover = (why) => { if (session !== this.session) return; if (why) this.lastError = why; this.next(session); };
            return this.playNative(this.url, session, failover, true);
          }
          this._triedDirect = false;
          this.next(session);
        },
        ended: () => { if (session !== this.session) return; if (this.live && this.reconnects < 5) this.reconnect(session); else this.status('ended'); }
      };
      Object.entries(h).forEach(([k, f]) => v.addEventListener(k, f));
      this._h = h;
    }
    detachEvents() { if (this._h) Object.entries(this._h).forEach(([k, f]) => this.video.removeEventListener(k, f)); this._h = null; }

    // Track helpers
    levels() { return this.inst && this.inst.levels ? this.inst.levels : []; }
    audioTracks() {
      if (this.inst && this.inst.audioTracks && this.inst.audioTracks.length) return this.inst.audioTracks.map((t, i) => ({ i, label: t.name || t.lang || `Track ${i + 1}`, on: this.inst.audioTrack === i }));
      const at = this.video.audioTracks;
      return at ? Array.from(at).map((t, i) => ({ i, label: t.label || t.language || `Track ${i + 1}`, on: t.enabled })) : [];
    }
    setAudio(i) {
      if (this.inst && this.inst.audioTracks && this.inst.audioTracks.length) this.inst.audioTrack = i;
      else if (this.video.audioTracks) Array.from(this.video.audioTracks).forEach((t, j) => { t.enabled = j === i; });
    }
    textTracks() {
      if (this.inst && this.inst.subtitleTracks && this.inst.subtitleTracks.length) return this.inst.subtitleTracks.map((t, i) => ({ i, label: t.name || t.lang || `Subtitle ${i + 1}`, on: this.inst.subtitleTrack === i }));
      return Array.from(this.video.textTracks || []).map((t, i) => ({ i, label: t.label || t.language || `Subtitle ${i + 1}`, on: t.mode === 'showing' }));
    }
    setText(i) {
      if (this.inst && this.inst.subtitleTracks && this.inst.subtitleTracks.length) { this.inst.subtitleTrack = i; this.inst.subtitleDisplay = i >= 0; }
      else Array.from(this.video.textTracks || []).forEach((t, j) => { t.mode = j === i ? 'showing' : 'disabled'; });
    }
  }
  App.Engine = Engine;

  /* ================================================================ External (VLC) */
  const External = App.External = {
    vlc(url, title = 'stream') {
      const ua = navigator.userAgent;
      if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
        location.href = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;
        return;
      }
      if (/Android/.test(ua)) {
        const m = url.match(/^(https?):\/\/(.*)$/);
        if (m) { location.href = `intent://${m[2]}#Intent;scheme=${m[1]};package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(title)};end`; return; }
      }
      const s = App.Sources.active;
      const m3u = `#EXTM3U\n#EXTVLCOPT:http-user-agent=IPTVSmartersPro\n${s && s.server ? `#EXTVLCOPT:http-referrer=${s.server}/\n` : ''}#EXTINF:-1,${String(title).replace(/[\r\n]/g, ' ')}\n${url}\n`;
      const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${String(title).replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'stream'}.m3u`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      UI.toast('Playlist downloaded — open it with VLC', { icon: 'download' });
    }
  };

  /* ================================================================ Player UI */
  const P = App.Player = {
    open: false, item: null, kind: null, list: [], index: -1, series: null,
    mode: null, engine: null, entry: null, status: 'idle', isLive: false,
    aspect: 0, rate: 1, nextShown: false, nextDismissed: false
  };
  const SKIP_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 9.2A8 8 0 1 1 4 12"/><path d="M4.2 4.6v4.8H9"/></svg>';
  const ASPECTS = [['Fit', ''], ['Fill', 'fit-cover'], ['Stretch', 'fit-fill'], ['16:9', 'ar:16/9'], ['4:3', 'ar:4/3']];

  function build() {
    const el = document.createElement('div');
    el.id = 'player';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Video player');
    el.innerHTML = `
      <video playsinline webkit-playsinline x-webkit-airplay="allow" preload="auto"></video>
      <div class="p-ripple l"><span>${ic('rotate-left')}</span><span>10 seconds</span></div>
      <div class="p-ripple r"><span>${ic('rotate-right')}</span><span>10 seconds</span></div>
      <div class="p-chrome">
        <div class="p-top">
          <button class="back" data-p="close" aria-label="Back">${ic('chevron-left')}</button>
          <div class="p-title"><h2 class="trunc" data-title></h2><p class="trunc" data-sub></p></div>
          <button class="cbtn" data-p="pip" aria-label="Picture in Picture">${ic('clone')}</button>
          <button class="cbtn" data-p="switch" aria-label="Switch player">${ic('arrow-right-arrow-left')}</button>
          <button class="cbtn" data-p="aspect" aria-label="Aspect ratio">${ic('table-columns')}</button>
        </div>
        <div class="p-center">
          <button class="cbtn" data-p="prev" aria-label="Previous">${ic('backward-step')}</button>
          <button class="cbtn skip" data-p="back10" aria-label="Back 10 seconds">${SKIP_SVG}<span>10</span></button>
          <button class="pp" data-p="play" aria-label="Play or pause"></button>
          <button class="cbtn skip" data-p="fwd10" aria-label="Forward 10 seconds">${SKIP_SVG.replace('<svg', '<svg style="transform:scaleX(-1)"')}<span>10</span></button>
          <button class="cbtn" data-p="next" aria-label="Next">${ic('forward-step')}</button>
        </div>
        <div class="p-bottom">
          <div class="p-seek">
            <div class="seekbar" data-seek role="slider" aria-label="Seek" tabindex="0"><div class="track"><div class="buf"></div><div class="fill"></div></div><div class="thumb"></div><div class="hover-t"></div></div>
            <span class="time" data-time>0:00/0:00</span>
          </div>
          <div class="p-row">
            <div class="p-tools">
              <button data-p="speed" aria-label="Playback speed">${ic('gauge-high')}</button>
              <button data-p="tracks" aria-label="Subtitles, audio and quality">${icr('closed-captioning')}</button>
              <button data-p="cast" aria-label="Cast or AirPlay">${UI.airplayIcon}</button>
            </div>
            <button class="more-btn" data-p="more"><b data-more-label>More videos</b><span>${ic('circle-play')}</span></button>
          </div>
        </div>
      </div>
      <div class="p-hud"></div>`;
    document.body.appendChild(el);
    return el;
  }

  let root, video;
  function init() {
    root = build();
    video = $('video', root);
    video.volume = Settings.get('volume') ?? 1;
    P.engine = new Engine(video, {
      onStatus: (s, extra) => { P.status = s; renderPlayState(extra); if (s === 'playing') { hideError(); armIdle(); } },
      onError: (info) => showError(info),
      onLive: (live) => { if (live !== P.isLive && P.kind === 'live') { P.isLive = live; renderSeek(); } }
    });
    root.addEventListener('click', onClick);
    root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
    bindSeek();
    bindGestures();
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', renderSeek);
    video.addEventListener('progress', renderBuffered);
    video.addEventListener('volumechange', () => Settings.set('volume', video.volume));
    video.addEventListener('pause', () => { saveProgress(); renderPlayState(); });
    video.addEventListener('play', renderPlayState);
    video.addEventListener('ended', () => { if (P.kind === 'episode') playNextEpisode(); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', () => {});
    setInterval(() => { if (P.open && !video.paused) saveProgress(); }, 10000);
    window.addEventListener('pagehide', saveProgress);
  }

  /* ---------------------------------------------------------------- open / close */
  P.play = function (item, opts = {}) {
    const kind = opts.kind || (item.type === 'live' ? 'live' : item.type === 'episode' ? 'episode' : 'movie');
    const mode = opts.mode || Settings.get('player');
    if (mode === 'vlc' && !opts.forceInternal) {
      const url = App.streamCandidates(item, kind)[0];
      if (!url) return UI.toast('No stream URL for this item', { icon: 'triangle-exclamation' });
      External.vlc(url, item.name);
      return;
    }
    if (!root) init();
    if (App.EPG && App.EPG.stopMini) App.EPG.stopMini();
    saveProgress();
    Object.assign(P, { item, kind, mode, list: opts.list || [], index: -1, series: opts.series || (kind === 'episode' ? P.series : null), nextShown: false, nextDismissed: false, isLive: kind === 'live' });
    if (kind !== 'episode' && !opts.series) P.series = null;
    P.index = P.list.findIndex(x => String(x.id) === String(item.id));
    if (!P.open) {
      P.open = true;
      root.classList.add('open');
      document.body.classList.add('no-scroll');
      P.entry = UI.Overlay.push(teardown);
      enterImmersive();
    }
    let startAt = opts.startAt;
    if (startAt == null && kind !== 'live') {
      const pr = User.getProgress(kind, item.id);
      if (pr && pr.pos > 10 && User.pct(pr) < 95) { startAt = pr.pos; showResumeToast(pr.pos); }
    }
    P.startAt = startAt || 0;
    renderMeta();
    hideError();
    closeNextCard();
    P.aspect = 0; applyAspect();
    video.playbackRate = P.rate = 1;
    clearFailover();
    P.engine.load(App.streamCandidates(item, kind), { mode: mode === 'native' ? 'native' : 'smart', live: kind === 'live', startAt: P.startAt });
    renderSeek();
    wake();
    setMediaSession();
    if (kind === 'live') User.d.lastLive = item.id;
  };

  P.close = function () { if (P.open && P.entry) UI.Overlay.close(P.entry); };

  function teardown() {
    clearFailover();
    closeNextCard();
    saveProgress();
    P.engine.destroy();
    P.open = false;
    root.classList.remove('open', 'idle');
    $$('.more-ov, .p-err, .next-card, .p-toast', root).forEach(e => e.remove());
    if (!$('.sheet-layer')) document.body.classList.remove('no-scroll');
    exitImmersive();
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    Bus.emit('progress');
  }

  function enterImmersive() {
    const mobile = matchMedia('(pointer: coarse)').matches;
    if (!mobile) return;
    const de = document.documentElement;
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    if (req) {
      try {
        const r = req.call(de, { navigationUI: 'hide' });
        if (r && r.then) r.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      } catch (_) {}
    }
  }
  function exitImmersive() {
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (r && r.catch) r.catch(() => {}); } catch (_) {}
    }
  }

  /* ---------------------------------------------------------------- rendering */
  function renderMeta() {
    const it = P.item;
    let title = it.name, sub = '';
    if (P.kind === 'episode' && P.series) { title = P.series.name; sub = `S${it.season} · E${it.episode}${it.name && !/^episode \d+$/i.test(it.name) ? ` · ${it.name}` : ''}`; }
    if (P.kind === 'live') { const c = Catalog.cat('live', it.cat); sub = c ? c.name : ''; }
    $('[data-title]', root).textContent = title;
    $('[data-sub]', root).textContent = sub;
    $('[data-sub]', root).hidden = !sub;
    $('[data-more-label]', root).textContent = P.kind === 'live' ? 'More channels' : P.kind === 'episode' ? 'More episodes' : 'More videos';
    const hasList = P.kind === 'live' || P.kind === 'episode';
    $('[data-p="prev"]', root).disabled = !hasList || P.list.length < 2;
    $('[data-p="next"]', root).disabled = !hasList || P.list.length < 2;
    $('[data-p="pip"]', root).hidden = !(document.pictureInPictureEnabled || video.webkitSupportsPresentationMode);
  }
  function renderPlayState(extra) {
    const b = $('[data-p="play"]', root);
    if (!b) return;
    const busy = P.status === 'loading' || P.status === 'buffering' || P.status === 'reconnecting';
    b.innerHTML = busy ? UI.spinner() : (video.paused ? ic('play') : ic('pause'));
    b.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    if (P.status === 'reconnecting' && extra) hud(`Reconnecting… (${extra.n}/5)`);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
  }
  function renderSeek() {
    if (!root) return;
    const live = P.kind === 'live';
    const seek = $('.p-seek', root);
    $('[data-seek]', root).style.visibility = live ? 'hidden' : '';
    $('[data-p="back10"]', root).style.visibility = live ? 'hidden' : '';
    $('[data-p="fwd10"]', root).style.visibility = live ? 'hidden' : '';
    $('[data-time]', root).innerHTML = live ? '<span class="p-live">LIVE</span>' : `${fmtTime(video.currentTime)}/${fmtTime(isFinite(video.duration) ? video.duration : 0)}`;
    seek.style.justifyContent = live ? 'flex-end' : '';
    onTime();
  }
  function onTime() {
    if (!P.open) return;
    const d = video.duration, t = video.currentTime;
    if (P.kind !== 'live' && isFinite(d) && d > 0) {
      const pct = clamp(t / d * 100, 0, 100);
      if (!dragging) { $('.seekbar .fill', root).style.width = `${pct}%`; $('.seekbar .thumb', root).style.left = `${pct}%`; }
      $('[data-time]', root).textContent = `${fmtTime(dragging ? dragT : t)}/${fmtTime(d)}`;
      if (P.kind === 'episode' && d - t < 25 && d > 120 && !P.nextShown && !P.nextDismissed && nextEpisode()) showNextCard();
    }
  }
  function renderBuffered() {
    const d = video.duration;
    if (!isFinite(d) || !video.buffered.length) return;
    $('.seekbar .buf', root).style.width = `${clamp(video.buffered.end(video.buffered.length - 1) / d * 100, 0, 100)}%`;
  }
  let hudT;
  function hud(text) {
    const h = $('.p-hud', root);
    h.textContent = text; h.style.display = 'flex';
    clearTimeout(hudT); hudT = setTimeout(() => { h.style.display = 'none'; }, 1100);
  }
  function showResumeToast(pos) {
    if (!root) return;
    const t = document.createElement('div');
    t.className = 'p-toast';
    t.innerHTML = `<span>Resumed at ${fmtTime(pos)}</span><button>Start over</button>`;
    $('button', t).onclick = (e) => { e.stopPropagation(); video.currentTime = 0; P.startAt = 0; t.remove(); };
    root.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  /* ---------------------------------------------------------------- idle chrome */
  let idleT;
  function wake() { root.classList.remove('idle'); armIdle(); }
  function armIdle() {
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (P.open && !video.paused && P.status === 'playing' && !$('.more-ov, .p-err', root) && !$('.sheet-layer')) root.classList.add('idle'); }, 4000);
  }

  /* ---------------------------------------------------------------- progress */
  function saveProgress() {
    if (!P.open || !P.item || P.kind === 'live') return;
    const t = video.currentTime, d = video.duration;
    if (!isFinite(d) || d < 30 || t < 5) return;
    const it = P.item;
    if (P.kind === 'movie') {
      User.setProgress('movie', it.id, t, d, { type: 'movie', name: it.name, icon: it.icon, cat: it.cat });
    } else if (P.kind === 'episode' && P.series) {
      User.setProgress('episode', it.id, t, d, { type: 'episode', series: P.series.id });
      User.setSeriesProgress(P.series.id, { epId: it.id, season: it.season, episode: it.episode, epName: it.name, pos: Math.floor(t), dur: Math.floor(d), name: P.series.name, icon: P.series.icon, cat: P.series.cat });
    }
  }
  P.saveProgress = saveProgress;

  /* ---------------------------------------------------------------- navigation in lists */
  function nextEpisode() { return P.kind === 'episode' && P.index > -1 && P.index < P.list.length - 1 ? P.list[P.index + 1] : null; }
  function step(dir) {
    if (P.list.length < 2 || P.index < 0) return;
    let i = P.index + dir;
    if (P.kind === 'live') i = (i + P.list.length) % P.list.length;
    if (i < 0 || i >= P.list.length) return;
    P.play(P.list[i], { kind: P.kind, list: P.list, series: P.series, mode: P.mode, forceInternal: true, startAt: P.kind === 'live' ? 0 : undefined });
  }
  function playNextEpisode() { const n = nextEpisode(); if (n) P.play(n, { kind: 'episode', list: P.list, series: P.series, mode: P.mode, forceInternal: true }); }

  let nextTimer;
  function showNextCard() {
    P.nextShown = true;
    const n = nextEpisode();
    let left = 10;
    const card = document.createElement('div');
    card.className = 'next-card';
    card.innerHTML = `<small>Up next · S${n.season} E${n.episode}</small><b class="trunc">${esc(n.name)}</b>
      <div class="btn-row"><button class="btn secondary" data-n="cancel">Cancel</button><button class="btn" data-n="go">Play in <span>${left}</span></button></div>`;
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-n]');
      if (!b) return;
      closeNextCard();
      if (b.dataset.n === 'go') playNextEpisode(); else P.nextDismissed = true;
    });
    root.appendChild(card);
    nextTimer = setInterval(() => {
      left--;
      const s = $('.next-card span', root);
      if (s) s.textContent = left;
      if (left <= 0) { closeNextCard(); playNextEpisode(); }
    }, 1000);
  }
  function closeNextCard() { clearInterval(nextTimer); $$('.next-card', root || document).forEach(e => e.remove()); }

  /* ---------------------------------------------------------------- errors */
  let failoverTimer = null;
  function clearFailover() { if (failoverTimer) { clearInterval(failoverTimer); failoverTimer = null; } }
  function hideError() { clearFailover(); $$('.p-err', root || document).forEach(e => e.remove()); }
  function showError(info) {
    hideError();
    const url = P.engine.url || info.url || '';
    const reason = info.reason || (info.mediaCode === 4 ? 'codec' : '');
    const isMkv = /\.(mkv|avi)(\?|$)/i.test(url) || (P.item && (P.item.ext === 'mkv' || P.item.ext === 'avi'));
    const isLive = P.kind === 'live';
    const mixed = reason === 'mixed';
    let title = "This stream couldn't be played", desc = 'The provider did not respond with a playable stream. It may be offline or busy.';
    if (reason === 'auth') {
      title = 'Access denied by provider';
      desc = 'The provider rejected playback with HTTP 401 (auth: 0). Your account subscription may have expired or is in use on another device.';
    } else if (isMkv || reason === 'codec') {
      title = 'Format not supported by browser';
      desc = 'Web browsers cannot play MKV or AVI files directly. Tap "Open in VLC" below to watch this title in VLC with full video and audio.';
    } else if (reason === 'media' && !isLive) {
      title = 'Format not supported by browser';
      desc = 'This movie uses an audio or video codec that web browsers cannot decode. Tap "Open in VLC" to watch.';
    } else if (mixed) {
      title = 'Insecure stream blocked';
      desc = 'This site runs on HTTPS, so the browser blocked your provider\'s http:// stream. Open in VLC, or run locally (npm run serve).';
    } else if (reason === 'offline') {
      title = 'Stream offline';
      desc = 'This channel or video is not available on the provider right now.';
    } else if (reason === 'timeout') {
      title = 'Stream timed out';
      desc = 'The stream did not start within 7 seconds. Try again or switch player.';
    }
    const other = P.mode === 'native' ? 'Smart Player' : 'Native Player';

    const isLive = P.kind === 'live';
    const hasNextLive = isLive && P.list && P.list.length > 1;
    const nextEp = P.kind === 'episode' ? nextEpisode() : null;

    // Graceful auto-continuation for playlists: tolerate errors and keep playing!
    if (hasNextLive || nextEp) {
      let left = isLive ? 3 : 4;
      const targetLabel = isLive ? 'next channel' : `next episode (S${nextEp.season} E${nextEp.episode})`;
      const card = document.createElement('div');
      card.className = 'p-err';
      card.innerHTML = `<div class="box" role="alertdialog" aria-label="${esc(title)}">
        <div class="tile c-orange">${ic('forward-step')}</div>
        <h3>Stream issue · Continuing playback</h3>
        <p>${esc(title)}. Auto-recovering to avoid playback interruption.</p>
        <div class="banner blue" style="margin:14px 0;font-size:15px">
          ${ic('rotate')} <span>Switching to <b>${esc(targetLabel)}</b> in <b data-sec>${left}</b>s…</span>
        </div>
        <div class="acts">
          <button class="btn" data-e="proceed">${ic('forward-step')} Switch now</button>
          <button class="btn secondary" data-e="cancel">${ic('hand')} Pause &amp; options</button>
          <button class="btn secondary" data-e="retry">${ic('rotate-right')} Retry stream</button>
          <button class="btn secondary" data-e="close">${ic('xmark')} Exit</button>
        </div>
      </div>`;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('[data-e]');
        if (!b) return;
        clearFailover();
        const act = b.dataset.e;
        if (act === 'proceed') {
          hideError();
          if (isLive) step(1);
          else playNextEpisode();
        } else if (act === 'cancel') {
          renderErrorBox(info, title, desc, url, reason, mixed, other);
        } else if (act === 'retry') {
          hideError();
          P.play(P.item, { kind: P.kind, list: P.list, series: P.series, mode: P.mode, forceInternal: true, startAt: P.startAt });
        } else {
          P.close();
        }
      });

      root.classList.remove('idle');
      root.appendChild(card);

      failoverTimer = setInterval(() => {
        left--;
        const sec = $('[data-sec]', card);
        if (sec) sec.textContent = left;
        if (left <= 0) {
          clearFailover();
          hideError();
          if (isLive) step(1);
          else playNextEpisode();
        }
      }, 1000);
      return;
    }

    renderErrorBox(info, title, desc, url, reason, mixed, other);
  }

  function renderErrorBox(info, title, desc, url, reason, mixed, other) {
    hideError();
    const box = document.createElement('div');
    box.className = 'p-err';
    box.innerHTML = `<div class="box" role="alertdialog" aria-label="${esc(title)}">
      <div class="tile c-red">${ic('triangle-exclamation')}</div>
      <h3>${esc(title)}</h3><p>${esc(desc)}</p>
      <details><summary>Technical details</summary>${esc(App.redact(url))}<br>reason: ${esc(reason || 'unknown')}${info.code ? ` · HTTP ${info.code}` : ''}${info.mediaCode ? ` · media error ${info.mediaCode}` : ''}</details>
      <div class="acts">
        <button class="btn" data-e="retry">${ic('rotate-right')} Retry</button>
        <button class="btn secondary" data-e="switch">${ic('arrow-right-arrow-left')} ${esc(other)}</button>
        <button class="btn secondary" data-e="vlc">${ic('arrow-up-right-from-square')} Open in VLC</button>
        ${mixed ? `<button class="btn secondary" data-e="proxy">${ic('shield-halved')} Set up proxy</button>` : `<button class="btn secondary" data-e="close">${ic('xmark')} Close</button>`}
      </div></div>`;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-e]');
      if (!b) return;
      const a = b.dataset.e;
      if (a === 'retry') P.play(P.item, { kind: P.kind, list: P.list, series: P.series, mode: P.mode, forceInternal: true, startAt: P.startAt });
      else if (a === 'switch') P.play(P.item, { kind: P.kind, list: P.list, series: P.series, mode: P.mode === 'native' ? 'smart' : 'native', forceInternal: true, startAt: P.startAt });
      else if (a === 'vlc') External.vlc(App.streamCandidates(P.item, P.kind)[0], P.item.name);
      else if (a === 'proxy') { P.close(); setTimeout(() => App.Views.openAdvanced('connection'), 350); }
      else P.close();
    });
    root.classList.remove('idle');
    root.appendChild(box);
  }

  /* ---------------------------------------------------------------- controls */
  function togglePlay() {
    if (video.muted) { video.muted = false; hud('Unmuted'); }
    if (video.paused) { video.play().catch(() => {}); } else video.pause();
    haptic();
  }
  function seekBy(s) {
    if (P.kind === 'live' || !isFinite(video.duration)) return;
    video.currentTime = clamp(video.currentTime + s, 0, video.duration - 1);
    const r = $(`.p-ripple.${s < 0 ? 'l' : 'r'}`, root);
    r.classList.add('show'); clearTimeout(r._t); r._t = setTimeout(() => r.classList.remove('show'), 500);
  }
  function applyAspect() {
    root.classList.remove('fit-cover', 'fit-fill');
    video.style.cssText = '';
    const [, v] = ASPECTS[P.aspect];
    if (v.startsWith('ar:')) {
      const [w, h] = v.slice(3).split('/').map(Number);
      root.classList.add('fit-fill');
      video.style.cssText = `width:min(100vw, calc(100vh * ${w / h}));height:min(100vh, calc(100vw * ${h / w}));inset:0;margin:auto;`;
    } else if (v) root.classList.add(v);
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    } catch (e) { UI.toast('Picture in Picture is not available for this stream', { icon: 'clone' }); }
  }

  function onClick(e) {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    e.stopPropagation();
    wake();
    switch (b.dataset.p) {
      case 'close': P.close(); break;
      case 'play': togglePlay(); break;
      case 'back10': seekBy(-10); break;
      case 'fwd10': seekBy(10); break;
      case 'prev': step(-1); break;
      case 'next': step(1); break;
      case 'pip': togglePip(); break;
      case 'aspect': P.aspect = (P.aspect + 1) % ASPECTS.length; applyAspect(); hud(ASPECTS[P.aspect][0]); break;
      case 'switch': switchSheet(); break;
      case 'speed': speedSheet(); break;
      case 'tracks': tracksSheet(); break;
      case 'cast': castSheet(); break;
      case 'more': moreVideos(); break;
    }
  }

  // Tap toggles the chrome; double-tap on the left/right third seeks ±10s.
  function bindGestures() {
    let lastTap = 0, tapT;
    root.addEventListener('click', (e) => {
      if (e.target.closest('button, .seekbar, .p-err, .more-ov, .next-card, .p-toast')) return;
      const now = Date.now();
      const x = e.clientX / innerWidth;
      if (now - lastTap < 280 && (x < .38 || x > .62)) {
        clearTimeout(tapT);
        seekBy(x < .5 ? -10 : 10);
        lastTap = 0;
        return;
      }
      lastTap = now;
      clearTimeout(tapT);
      tapT = setTimeout(() => {
        if (root.classList.contains('idle')) wake();
        else if (!video.paused && P.status === 'playing') root.classList.add('idle');
      }, 260);
    });
  }

  let dragging = false, dragT = 0;
  function bindSeek() {
    const bar = $('[data-seek]', root);
    const tip = $('.hover-t', bar);
    const at = (e) => { const r = bar.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
    bar.addEventListener('pointerdown', (e) => {
      if (!isFinite(video.duration)) return;
      dragging = true; bar.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e) => {
      const f = at(e);
      if (isFinite(video.duration)) {
        tip.style.display = 'block'; tip.style.left = `${f * 100}%`; tip.textContent = fmtTime(f * video.duration);
      }
      if (!dragging) return;
      dragT = f * video.duration;
      $('.seekbar .fill', root).style.width = `${f * 100}%`;
      $('.seekbar .thumb', root).style.left = `${f * 100}%`;
      $('[data-time]', root).textContent = `${fmtTime(dragT)}/${fmtTime(video.duration)}`;
      wake();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerleave', () => { if (!dragging) tip.style.display = 'none'; });
    bar.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; tip.style.display = 'none'; video.currentTime = dragT; });
    bar.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { seekBy(-10); e.preventDefault(); } if (e.key === 'ArrowRight') { seekBy(10); e.preventDefault(); } });
  }

  let dial = '', dialT;
  function onKey(e) {
    if (!P.open || e.target.closest('input, textarea') || $('.sheet-layer')) return;
    const k = e.key;
    wake();
    if (k === ' ' || k === 'k') { togglePlay(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { seekBy(-10); e.preventDefault(); }
    else if (k === 'ArrowRight') { seekBy(10); e.preventDefault(); }
    else if (k === 'ArrowUp') { video.volume = clamp(video.volume + .1, 0, 1); video.muted = false; hud(`Volume ${Math.round(video.volume * 100)}%`); e.preventDefault(); }
    else if (k === 'ArrowDown') { video.volume = clamp(video.volume - .1, 0, 1); hud(`Volume ${Math.round(video.volume * 100)}%`); e.preventDefault(); }
    else if (k === 'm') { video.muted = !video.muted; hud(video.muted ? 'Muted' : 'Sound on'); }
    else if (k === 'f') window.auraNative.toggleFullScreen();
    else if (k === 'p') togglePip();
    else if (k === 'n' || k === 'PageDown' || k === 'ChannelDown') step(1);
    else if (k === 'b' || k === 'PageUp' || k === 'ChannelUp') step(-1);
    else if (k === 'Escape' && !document.fullscreenElement) P.close();
    else if (/^\d$/.test(k) && P.kind === 'live') {
      dial += k; hud(`Channel ${dial}`);
      clearTimeout(dialT);
      dialT = setTimeout(() => {
        const n = Number(dial); dial = '';
        const target = P.list.find(c => c.num === n) || P.list[n - 1];
        if (target) P.play(target, { kind: 'live', list: P.list, mode: P.mode, forceInternal: true });
      }, 1300);
    }
  }

  /* ---------------------------------------------------------------- sheets inside the player */
  function playerSheet(opts) { return UI.sheet(Object.assign({ center: true, dark: true }, opts)); }

  function switchSheet() {
    const cur = App.PLAYERS.find(p => p.id === P.mode) || App.PLAYERS[0];
    playerSheet({
      label: 'Player',
      html: `${UI.sheetHeader({ icon: 'arrow-right-arrow-left', title: 'Player', sub: `${cur.name} active`, dark: true })}
        <div class="sheet-body">${App.PLAYERS.map(p => `<button class="dev-row${p.id === P.mode ? ' on' : ''}" data-mode="${p.id}">
          <span class="tile">${ic(p.icon)}</span><span class="grow"><h4>${esc(p.name)}</h4><p>${esc(p.sub)}</p></span>${p.id === P.mode ? `<span class="ok">${ic('check')}</span>` : ''}</button>`).join('')}</div>`,
      mount(ctx) {
        ctx.el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-mode]');
          if (!b) return;
          const mode = b.dataset.mode;
          const t = video.currentTime;
          ctx.close(() => {
            if (mode === 'vlc') External.vlc(App.streamCandidates(P.item, P.kind)[0], P.item.name);
            else if (mode !== P.mode) P.play(P.item, { kind: P.kind, list: P.list, series: P.series, mode, forceInternal: true, startAt: P.kind === 'live' ? 0 : t });
          });
        });
      }
    });
  }

  function speedSheet() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    playerSheet({
      label: 'Playback speed',
      html: `${UI.sheetHeader({ icon: 'gauge-high', title: 'Playback speed', sub: `${video.playbackRate}×`, dark: true })}
        <div class="sheet-body">${speeds.map(s => `<button class="track-opt${video.playbackRate === s ? ' on' : ''}" data-s="${s}">${s === 1 ? 'Normal (1×)' : `${s}×`}${video.playbackRate === s ? ic('check') : ''}</button>`).join('')}</div>`,
      mount(ctx) { ctx.el.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { video.playbackRate = P.rate = Number(b.dataset.s); ctx.close(); } }); }
    });
  }

  function tracksSheet() {
    const eng = P.engine;
    const levels = eng.levels();
    const auto = !eng.inst || !eng.inst.levels || eng.inst.autoLevelEnabled;
    const audio = eng.audioTracks();
    const subs = eng.textTracks();
    const sec = (t, body) => `<p class="caption" style="margin:18px 4px 10px">${t}</p>${body}`;
    const html = `${UI.sheetHeader({ icon: 'closed-captioning', title: 'Audio & subtitles', sub: P.item.name, dark: true })}<div class="sheet-body">
      ${levels.length > 1 ? sec('Quality', `<button class="track-opt${auto ? ' on' : ''}" data-q="-1">Auto${auto ? ic('check') : ''}</button>` + levels.map((l, i) => `<button class="track-opt${!auto && eng.inst.currentLevel === i ? ' on' : ''}" data-q="${i}">${l.height ? `${l.height}p` : `Level ${i + 1}`}${l.bitrate ? ` · ${(l.bitrate / 1e6).toFixed(1)} Mbps` : ''}${!auto && eng.inst.currentLevel === i ? ic('check') : ''}</button>`).join('')) : ''}
      ${sec('Audio', audio.length ? audio.map(a => `<button class="track-opt${a.on ? ' on' : ''}" data-a="${a.i}">${esc(a.label)}${a.on ? ic('check') : ''}</button>`).join('') : '<p class="muted" style="margin:0 4px">Only one audio track in this stream.</p>')}
      ${sec('Subtitles', `<button class="track-opt${!subs.some(s => s.on) ? ' on' : ''}" data-t="-1">Off${!subs.some(s => s.on) ? ic('check') : ''}</button>` + subs.map(s => `<button class="track-opt${s.on ? ' on' : ''}" data-t="${s.i}">${esc(s.label)}${s.on ? ic('check') : ''}</button>`).join(''))}
    </div>`;
    playerSheet({
      label: 'Audio and subtitles', html,
      mount(ctx) {
        ctx.el.addEventListener('click', (e) => {
          const q = e.target.closest('[data-q]'), a = e.target.closest('[data-a]'), t = e.target.closest('[data-t]');
          if (q) { const i = Number(q.dataset.q); eng.inst.currentLevel = i; localStorage.setItem('aura_quality_pref', i < 0 ? 'auto' : String(levels[i].height || 'auto')); }
          if (a) eng.setAudio(Number(a.dataset.a));
          if (t) eng.setText(Number(t.dataset.t));
          if (q || a || t) ctx.close();
        });
      }
    });
  }

  function castMedia() {
    let url = App.streamCandidates(P.item, P.kind)[0];
    if (Net.hasServer && url.startsWith('http://') && location.protocol === 'https:') url = `${location.origin}/stream?url=${encodeURIComponent(url)}`;
    return url;
  }
  function castSheet() {
    const airplay = typeof video.webkitShowPlaybackTargetPicker === 'function';
    const castFw = window.cast && window.cast.framework && window.chrome && window.chrome.cast;
    const remote = video.remote && typeof video.remote.prompt === 'function';
    let castRow;
    if (castFw) {
      const ctxCast = cast.framework.CastContext.getInstance();
      const st = ctxCast.getCastState();
      const sess = ctxCast.getCurrentSession();
      const name = sess && sess.getCastDevice ? sess.getCastDevice().friendlyName : '';
      castRow = st === 'CONNECTED'
        ? `<div class="dev-row"><span class="tile">${ic('tv')}</span><span class="grow"><h4>${esc(name || 'Cast device')}</h4><p>Connected</p></span><button class="pill-btn" data-c="disconnect">Disconnect</button></div>`
        : st === 'NO_DEVICES_AVAILABLE'
          ? `<div class="dev-row"><span class="tile">${ic('tv')}</span><span class="grow"><h4>No Cast devices found</h4><p>Make sure your TV is on the same Wi-Fi</p></span><button class="pill-btn" data-c="cast">Scan</button></div>`
          : `<div class="dev-row"><span class="tile">${ic('tv')}</span><span class="grow"><h4>Chromecast &amp; Google TV</h4><p>Available</p></span><button class="pill-btn" data-c="cast">Connect</button></div>`;
    } else if (remote) {
      castRow = `<div class="dev-row"><span class="tile">${ic('tv')}</span><span class="grow"><h4>Nearby screens</h4><p>Cast from this browser</p></span><button class="pill-btn" data-c="remote">Connect</button></div>`;
    } else {
      castRow = `<div class="dev-row"><span class="tile">${ic('tv')}</span><span class="grow"><h4>Chromecast</h4><p>Open this site in Chrome to cast</p></span></div>`;
    }
    playerSheet({
      label: 'Cast',
      html: `${UI.sheetHeader({ iconHTML: `<span style="width:30px;height:30px;display:flex">${UI.airplayIcon}</span>`, title: 'Cast', sub: 'Pick an AirPlay or Cast device', dark: true })}
        <div class="sheet-body">
          <p class="caption" style="margin:4px 4px 12px">AirPlay</p>
          <div class="dev-row"><span class="tile"><span style="width:26px;height:26px;display:flex">${UI.airplayIcon}</span></span><span class="grow"><h4>AirPlay</h4><p>${airplay ? 'Apple TV or AirPlay device nearby' : 'Available in Safari on Apple devices'}</p></span>${airplay ? '<button class="pill-btn" data-c="airplay">Select</button>' : ''}</div>
          <p class="caption" style="margin:22px 4px 12px">Chromecast</p>
          ${castRow}
        </div>`,
      mount(ctx) {
        ctx.el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-c]');
          if (!b) return;
          const a = b.dataset.c;
          if (a === 'airplay') { try { video.webkitShowPlaybackTargetPicker(); } catch (_) {} ctx.close(); }
          else if (a === 'remote') { video.remote.prompt().catch(() => {}); ctx.close(); }
          else if (a === 'disconnect') { cast.framework.CastContext.getInstance().endCurrentSession(true); ctx.close(); UI.toast('Disconnected', { icon: 'tv' }); }
          else if (a === 'cast') { ctx.close(); startCast(); }
        });
      }
    });
  }
  function startCast() {
    const ctxCast = cast.framework.CastContext.getInstance();
    const load = (session) => {
      const url = castMedia();
      const info = new chrome.cast.media.MediaInfo(url, /\.m3u8/i.test(url) ? 'application/x-mpegurl' : /\.ts(\?|$)/i.test(url) ? 'video/mp2t' : 'video/mp4');
      info.streamType = P.kind === 'live' ? chrome.cast.media.StreamType.LIVE : chrome.cast.media.StreamType.BUFFERED;
      info.metadata = new chrome.cast.media.GenericMediaMetadata();
      info.metadata.title = P.series ? `${P.series.name} · S${P.item.season}E${P.item.episode}` : P.item.name;
      const img = (P.series && P.series.icon) || P.item.icon;
      if (img) info.metadata.images = [new chrome.cast.Image(img)];
      const req = new chrome.cast.media.LoadRequest(info);
      if (P.kind !== 'live' && video.currentTime > 0) req.currentTime = video.currentTime;
      session.loadMedia(req).then(() => { video.pause(); UI.toast(`Playing on ${session.getCastDevice().friendlyName}`, { icon: 'tv' }); })
        .catch(() => UI.toast('The Cast device could not load this stream', { icon: 'triangle-exclamation' }));
    };
    const s = ctxCast.getCurrentSession();
    if (s) load(s);
    else ctxCast.requestSession().then(() => { const n = ctxCast.getCurrentSession(); if (n) load(n); }).catch(() => {});
  }

  function moreVideos() {
    let items = [], title = 'More videos';
    if (P.kind === 'live') { items = P.list; title = 'More channels'; }
    else if (P.kind === 'episode') { items = P.list; title = 'More episodes'; }
    else items = Catalog.items('movie', P.item.cat).slice(0, 60);
    const ov = document.createElement('div');
    ov.className = 'more-ov';
    const card = (it) => {
      const cur = String(it.id) === String(P.item.id);
      const name = it.type === 'episode' ? `E${it.episode} · ${it.name}` : it.name;
      const sub = it.type === 'episode' ? (it.durStr || `Season ${it.season}`) : it.type === 'live' ? 'Live' : 'Movie';
      const icon = it.icon || (it.type === 'episode' && P.series ? P.series.icon : '');
      return `<div class="more-item${it.type === 'live' ? ' live' : ''}${cur ? ' cur' : ''}" data-mi="${esc(it.id)}">
        <div class="poster" data-ph="poster" data-name="">${icon ? UI.img(icon, '') : `<div class="ph">${ic('circle-play')}</div>`}<span class="go">${cur ? ic('play') : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'}</span></div>
        <h4 class="trunc">${esc(name)}</h4><p>${esc(sub)}</p></div>`;
    };
    ov.innerHTML = `<div class="hd"><h2>${title}</h2><button class="cbtn xl" data-mclose aria-label="Close">${ic('xmark')}</button></div><div class="rail scroll-x" data-mrail></div>`;
    root.appendChild(ov);
    const rail = $('[data-mrail]', ov);
    rail.style.display = 'flex';
    UI.chunked(rail, items, card, { chunk: 30, root: rail });
    const cur = $('.more-item.cur', ov);
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
    ov.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('[data-mclose]')) return ov.remove();
      const m = e.target.closest('[data-mi]');
      if (!m) return;
      const it = items.find(x => String(x.id) === m.dataset.mi);
      ov.remove();
      if (!it || String(it.id) === String(P.item.id)) return;
      if (P.kind === 'movie') P.play(it, { kind: 'movie', mode: P.mode, forceInternal: true, list: [] });
      else P.play(it, { kind: P.kind, list: P.list, series: P.series, mode: P.mode, forceInternal: true, startAt: P.kind === 'live' ? 0 : undefined });
    });
  }

  /* ---------------------------------------------------------------- media session */
  function setMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const art = (P.series && P.series.icon) || P.item.icon;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: P.series ? `${P.series.name} · S${P.item.season}E${P.item.episode}` : P.item.name,
        artist: `${App.BRAND.first} ${App.BRAND.second}`,
        artwork: art ? [{ src: Net.image(art), sizes: '512x512' }] : []
      });
      navigator.mediaSession.setActionHandler('play', () => video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      navigator.mediaSession.setActionHandler('previoustrack', P.list.length > 1 ? () => step(-1) : null);
      navigator.mediaSession.setActionHandler('nexttrack', P.list.length > 1 ? () => step(1) : null);
    } catch (_) {}
  }
})();
