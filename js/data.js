/* AURA IPTV — catalog sync (Xtream Codes + M3U), indexes, search, EPG, stream URLs. */
'use strict';
(function () {
  const { Sources, User, IDB, Net, Bus, Settings, normText, b64, qualityOf, uid } = App;

  const TYPES = ['live', 'movie', 'series'];
  const TYPE_LABEL = { live: 'Live', movie: 'Movies', series: 'Series' };
  const TYPE_ONE = { live: 'Channel', movie: 'Movie', series: 'Series', episode: 'Episode' };
  const TYPE_ICON = { live: 'tower-broadcast', movie: 'film', series: 'layer-group', episode: 'circle-play' };
  App.TYPES = TYPES; App.TYPE_LABEL = TYPE_LABEL; App.TYPE_ONE = TYPE_ONE; App.TYPE_ICON = TYPE_ICON;

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const catOf = (s) => String(s.category_id ?? (Array.isArray(s.category_ids) ? s.category_ids[0] : '') ?? '');

  function normLive(s) {
    return { id: String(s.stream_id), type: 'live', name: String(s.name || '').trim(), icon: s.stream_icon || '', cat: catOf(s), added: num(s.added), num: num(s.num), epg: s.epg_channel_id || '', archive: num(s.tv_archive) };
  }
  function normVod(s) {
    return { id: String(s.stream_id), type: 'movie', name: String(s.name || '').trim(), icon: s.stream_icon || '', cat: catOf(s), added: num(s.added), rating: num(s.rating) || num(s.rating_5based) * 2, ext: s.container_extension || 'mp4', num: num(s.num) };
  }
  function normSeries(s) {
    return { id: String(s.series_id), type: 'series', name: String(s.name || '').trim(), icon: s.cover || '', cat: catOf(s), added: num(s.last_modified) || num(s.added), rating: num(s.rating) || num(s.rating_5based) * 2, num: num(s.num), year: (String(s.releaseDate || s.release_date || '').match(/\d{4}/) || [''])[0] };
  }
  const NORM = { live: normLive, movie: normVod, series: normSeries };
  const ACTIONS = {
    live: ['get_live_categories', 'get_live_streams'],
    movie: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series']
  };

  function splitCat(name) {
    const n = String(name || '').trim();
    const i = n.indexOf('|');
    if (i > 0 && i < n.length - 1) return { group: n.slice(0, i).trim().toUpperCase(), label: n.slice(i + 1).trim() };
    return { group: n.toUpperCase(), label: n };
  }

  const GRADS = [['#ff9f43', '#ee5a24'], ['#ff6b9d', '#c44569'], ['#a29bfe', '#6c5ce7'], ['#4facfe', '#2563eb'], ['#43e97b', '#16a34a'], ['#f093fb', '#c026d3'], ['#fda085', '#f6416c'], ['#5ee7df', '#0e7490'], ['#f6d365', '#e67e22'], ['#667eea', '#4338ca']];
  function catVisual(cat, type) {
    const n = (cat.name || '').toUpperCase();
    let icon = type === 'live' ? 'tv' : type === 'series' ? 'layer-group' : 'film';
    let g = GRADS[App.hashStr(cat.name || '') % GRADS.length];
    if (/4K|UHD|2160/.test(n)) { icon = 'crown'; g = GRADS[0]; }
    else if (/SPORT|CRICKET|FOOTBALL|SOCCER|NBA|NFL|UFC|F1|TENNIS|GOLF/.test(n)) icon = 'futbol';
    else if (/NEWS/.test(n)) icon = 'newspaper';
    else if (/KID|CARTOON|ANIM/.test(n)) icon = 'child-reaching';
    else if (/MUSIC|SONG/.test(n)) icon = 'music';
    else if (/DOC|NATURE|DISCOVERY|GEO/.test(n)) icon = 'earth-americas';
    else if (/PPV|EVENT/.test(n)) icon = 'ticket';
    else if (/24X7|24\/7/.test(n)) icon = 'tower-broadcast';
    else if (/RELIGI|DEVOTION/.test(n)) icon = 'hands-praying';
    else if (/ADULT|XXX|18\+/.test(n)) icon = 'lock';
    return { icon, g1: g[0], g2: g[1] };
  }

  // Same output shape as the PARSE_M3U worker message.
  function parseM3UInline(text) {
    const channels = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        cur = {};
        const comma = line.lastIndexOf(',');
        if (comma !== -1) cur.name = line.slice(comma + 1).trim();
        for (const m of line.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
          const k = m[1].toLowerCase();
          if (k === 'tvg-id') cur.epg_channel_id = m[2];
          else if (k === 'tvg-logo') cur.stream_icon = m[2];
          else if (k === 'group-title') cur.category_name = m[2];
        }
      } else if (!line.startsWith('#') && cur && /^(https?|rtmp):\/\//i.test(line)) {
        const lower = line.toLowerCase();
        cur.url = line;
        cur.type = lower.includes('/series/') ? 'series' : (lower.includes('/movie/') || /\.(mp4|mkv|avi)(\?|$)/.test(lower)) ? 'vod' : 'live';
        channels.push(cur);
        cur = null;
      }
    }
    return { channels };
  }

  /* ---------------------------------------------------------------- catalog */
  const Catalog = App.Catalog = {
    src: null,
    data: null, // { live: {cats, items, byCat, byId}, movie: {...}, series: {...}, at }
    ready: false,

    empty() { return { at: 0, live: { cats: [], items: [] }, movie: { cats: [], items: [] }, series: { cats: [], items: [] } }; },

    async load(src) {
      this.src = src;
      this.ready = false;
      const raw = src ? await IDB.get(`catalog:${src.id}`) : null;
      this.index(raw || this.empty());
      this.ready = !!raw;
      return this.ready;
    },

    index(raw) {
      const out = { at: raw.at || 0 };
      for (const t of TYPES) {
        const block = raw[t] || { cats: [], items: [] };
        const cats = (block.cats || []).map(c => Object.assign({ type: t }, c, splitCat(c.name)));
        const byCatId = new Map(cats.map(c => [c.id, c]));
        const byCat = new Map();
        const byId = new Map();
        for (const it of block.items) {
          it.s = normText(it.name);
          byId.set(it.id, it);
          if (!byCat.has(it.cat)) byCat.set(it.cat, []);
          byCat.get(it.cat).push(it);
        }
        // Items whose category is missing from the category list still need a home.
        for (const catId of byCat.keys()) {
          if (!byCatId.has(catId)) {
            const c = Object.assign({ type: t, id: catId, name: catId ? `Category ${catId}` : 'Uncategorized' }, splitCat(catId ? `Category ${catId}` : 'Uncategorized'));
            cats.push(c); byCatId.set(catId, c);
          }
        }
        cats.forEach(c => { c.count = (byCat.get(c.id) || []).length; });
        out[t] = { cats: cats.filter(c => c.count > 0 || t === 'live'), items: block.items, byCat, byId, byCatId };
      }
      this.data = out;
      Bus.emit('catalog');
    },

    counts() { return { live: this.data.live.items.length, movie: this.data.movie.items.length, series: this.data.series.items.length }; },

    catVisible(type, catId) {
      if (User.isHidden(type, catId)) return false;
      if (User.isLocked(type, catId) && !App.unlocked) return false;
      return true;
    },
    cats(type, { includeHidden = false } = {}) {
      const list = this.data[type].cats;
      return includeHidden ? list : list.filter(c => this.catVisible(type, c.id));
    },
    cat(type, id) { return this.data[type].byCatId.get(String(id)); },
    items(type, catId) {
      if (catId == null) return this.data[type].items.filter(i => this.catVisible(type, i.cat));
      return this.catVisible(type, catId) ? (this.data[type].byCat.get(String(catId)) || []) : [];
    },
    item(type, id) { return this.data[type].byId.get(String(id)); },
    groups(type, opts) {
      const map = new Map();
      for (const c of this.cats(type, opts)) {
        if (!map.has(c.group)) map.set(c.group, []);
        map.get(c.group).push(c);
      }
      return Array.from(map, ([name, cats]) => ({ name, cats }));
    },
    visual: catVisual,

    freshArrivals(type, n = 20) {
      const seen = new Set();
      const out = [];
      const sorted = this.items(type).slice().sort((a, b) => b.added - a.added);
      for (const it of sorted) {
        const key = it.s.replace(/\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|hevc|x265)\b/g, '').replace(/\s+/g, ' ').trim();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
        if (out.length >= n) break;
      }
      return out;
    },
    heroPicks(type, n = 10) {
      const pool = this.items(type).filter(i => i.icon).sort((a, b) => b.added - a.added).slice(0, 300);
      const seed = new Date().toDateString() + type;
      const picked = [];
      const used = new Set();
      let h = App.hashStr(seed);
      while (picked.length < Math.min(n, pool.length)) {
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        const i = h % pool.length;
        if (used.has(i)) continue;
        used.add(i); picked.push(pool[i]);
      }
      return picked;
    },

    search(q, limit = 60) {
      const terms = normText(q).split(' ').filter(Boolean);
      const res = { movie: [], series: [], live: [] };
      if (!terms.length) return res;
      for (const t of ['movie', 'series', 'live']) {
        const arr = this.data[t].items;
        const hits = [];
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          let ok = true;
          for (const term of terms) { if (!(it.s.startsWith(term) || it.s.includes(' ' + term))) { ok = false; break; } }
          if (ok && this.catVisible(t, it.cat)) {
            hits.push(it);
            if (hits.length >= 400) break;
          }
        }
        const first = terms[0];
        hits.sort((a, b) => (b.s.startsWith(first) - a.s.startsWith(first)) || (b.added - a.added));
        res[t] = hits.slice(0, limit);
        res[t].total = hits.length;
      }
      return res;
    },

    /* ----------------------------------------------------------- sync */
    async sync(src, onProgress = () => {}) {
      if (src.type === 'm3u') return this.syncM3U(src, onProgress);
      const raw = this.empty();
      const api = (action, params = '', timeout = 30000) => window.auraNative.apiRequest({ server: src.server, user: src.user, pass: src.pass, action, params, timeout });
      const errors = {};
      for (const t of TYPES) {
        onProgress({ type: t, state: 'loading', count: 0 });
        try {
          const [catAction, streamAction] = ACTIONS[t];
          const cats = await api(catAction);
          raw[t].cats = (Array.isArray(cats) ? cats : Object.values(cats || {})).map(c => ({ id: String(c.category_id), name: String(c.category_name || '').trim(), parent: c.parent_id || 0 }));
          let items = null;
          try {
            const all = await api(streamAction, '', 180000);
            const arr = Array.isArray(all) ? all : Object.values(all || {});
            if (arr.length) items = arr;
          } catch (e) { console.warn(`[sync] full ${t} list failed, falling back per category:`, e.message); }
          if (!items) {
            items = [];
            const queue = raw[t].cats.slice();
            const worker = async () => {
              while (queue.length) {
                const c = queue.shift();
                try {
                  const part = await api(streamAction, `&category_id=${encodeURIComponent(c.id)}`, 60000);
                  (Array.isArray(part) ? part : Object.values(part || {})).forEach(x => { if (x.category_id == null) x.category_id = c.id; items.push(x); });
                  onProgress({ type: t, state: 'loading', count: items.length });
                } catch (_) {}
              }
            };
            await Promise.all([worker(), worker(), worker(), worker()]);
          }
          const norm = NORM[t];
          const seen = new Set();
          raw[t].items = [];
          for (const x of items) {
            if (!x || typeof x !== 'object') continue;
            const it = norm(x);
            if (!it.id || it.id === 'undefined' || seen.has(it.id)) continue;
            seen.add(it.id);
            raw[t].items.push(it);
          }
          onProgress({ type: t, state: 'done', count: raw[t].items.length });
        } catch (e) {
          errors[t] = e.message;
          onProgress({ type: t, state: 'error', count: 0, error: e.message });
        }
      }
      if (errors.live && errors.movie && errors.series) throw new Error(errors.live);
      raw.at = Date.now();
      await IDB.set(`catalog:${src.id}`, raw);
      Sources.update(src.id, { lastRefreshed: raw.at, counts: { live: raw.live.items.length, movie: raw.movie.items.length, series: raw.series.items.length } });
      if (Sources.active && Sources.active.id === src.id) { this.src = Sources.active; this.index(raw); this.ready = true; }
      return raw;
    },

    async syncM3U(src, onProgress) {
      onProgress({ type: 'live', state: 'loading', count: 0 });
      const text = src.m3uText || await Net.fetchText(src.m3uUrl);
      if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 5000))) throw new Error('This file is not an M3U playlist.');
      const head = text.slice(0, 2000).split(/\r?\n/)[0];
      const tvg = (head.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i) || [])[1];
      const parsed = await new Promise((resolve, reject) => {
        let worker;
        try { worker = new Worker('./js/playlist-worker.js'); } catch (e) { return resolve(parseM3UInline(text)); }
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'PROGRESS') onProgress({ type: 'live', state: 'loading', count: m.count });
          else if (m.type === 'DONE_M3U') { worker.terminate(); resolve(m); }
          else if (m.type === 'ERROR') { worker.terminate(); reject(new Error(m.error)); }
        };
        // Workers can be refused (e.g. file:// in Electron); parse on the main thread instead.
        worker.onerror = (e) => { e.preventDefault && e.preventDefault(); worker.terminate(); try { resolve(parseM3UInline(text)); } catch (err) { reject(err); } };
        worker.postMessage({ type: 'PARSE_M3U', data: text });
      });
      const raw = this.empty();
      const catIds = { live: new Map(), movie: new Map(), series: new Map() };
      parsed.channels.forEach((ch, i) => {
        const t = ch.type === 'vod' ? 'movie' : ch.type === 'series' ? 'series' : 'live';
        const cname = ch.category_name || 'General';
        if (!catIds[t].has(cname)) {
          const id = `${t[0]}${catIds[t].size + 1}`;
          catIds[t].set(cname, id);
          raw[t].cats.push({ id, name: cname });
        }
        raw[t].items.push({ id: `m${i + 1}`, type: t, name: String(ch.name || ch.title || `Channel ${i + 1}`).trim(), icon: ch.stream_icon || '', cat: catIds[t].get(cname), added: 0, num: i + 1, epg: ch.epg_channel_id || '', url: ch.url, ext: (ch.url.match(/\.(mp4|mkv|avi|m3u8|ts|webm|mov)(\?|$)/i) || [, 'mp4'])[1] });
      });
      ['live', 'movie', 'series'].forEach(t => onProgress({ type: t, state: 'done', count: raw[t].items.length }));
      raw.at = Date.now();
      await IDB.set(`catalog:${src.id}`, raw);
      const patch = { lastRefreshed: raw.at, counts: { live: raw.live.items.length, movie: raw.movie.items.length, series: raw.series.items.length } };
      if (tvg && !src.epgUrl) patch.epgUrl = tvg;
      delete src.m3uText;
      Sources.update(src.id, patch);
      if (Sources.active && Sources.active.id === src.id) { this.src = Sources.active; this.index(raw); this.ready = true; }
      return raw;
    },

    needsRefresh(src) {
      const opt = App.REFRESH.find(r => r.id === Settings.get('autoRefresh'));
      if (!opt || !opt.ms || !src) return false;
      return !src.lastRefreshed || Date.now() - src.lastRefreshed > opt.ms;
    }
  };

  /* ---------------------------------------------------------------- provider API */
  const cache = new Map();
  const Api = App.Api = {
    call(action, params = '', timeout = 30000) {
      const s = Sources.active;
      if (!s || s.type !== 'xtream') return Promise.reject(new Error('No Xtream source'));
      return window.auraNative.apiRequest({ server: s.server, user: s.user, pass: s.pass, action, params, timeout });
    },
    async cached(key, ttl, fn) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttl) return hit.v;
      const v = await fn();
      cache.set(key, { v, at: Date.now() });
      return v;
    },
    vodInfo(id) { return this.cached(`vod:${id}`, 36e5, () => this.call('get_vod_info', `&vod_id=${encodeURIComponent(id)}`)); },
    async seriesInfo(id) {
      return this.cached(`series:${id}`, 36e5, async () => {
        const d = await this.call('get_series_info', `&series_id=${encodeURIComponent(id)}`);
        const seasons = {};
        const eps = d && d.episodes ? (Array.isArray(d.episodes) ? { 1: d.episodes.flat() } : d.episodes) : {};
        Object.keys(eps).forEach(k => {
          seasons[k] = (eps[k] || []).map((e, i) => ({
            id: String(e.id), type: 'episode', season: Number(e.season || k), episode: Number(e.episode_num || i + 1),
            name: e.title || `Episode ${e.episode_num || i + 1}`, ext: e.container_extension || 'mp4',
            plot: (e.info && e.info.plot) || '', dur: (e.info && (e.info.duration_secs || 0)) || 0, durStr: (e.info && e.info.duration) || '',
            icon: (e.info && (e.info.movie_image || e.info.cover_big)) || ''
          })).sort((a, b) => a.episode - b.episode);
        });
        return { info: d.info || {}, seasons, seasonList: Object.keys(seasons).sort((a, b) => Number(a) - Number(b)) };
      });
    },
    async account(force) {
      const s = Sources.active;
      if (!s || s.type !== 'xtream') return null;
      if (!force && s.account && Date.now() - (s.account.at || 0) < 6e5) return s.account;
      const d = await window.auraNative.apiRequest({ server: s.server, user: s.user, pass: s.pass, timeout: 20000 });
      const account = { at: Date.now(), user: d.user_info || {}, server: d.server_info || {} };
      Sources.update(s.id, { account });
      return account;
    },
    async shortEpg(item) {
      const s = Sources.active;
      if (!s) return [];
      if (s.type === 'm3u') return Epg.forChannel(item);
      return this.cached(`epg:${item.id}`, 15 * 6e4, async () => {
        const d = await this.call('get_short_epg', `&stream_id=${encodeURIComponent(item.id)}&limit=16`, 20000);
        return ((d && d.epg_listings) || []).map(p => ({
          title: b64(p.title), desc: b64(p.description),
          start: Number(p.start_timestamp) * 1000 || Date.parse(String(p.start).replace(' ', 'T')),
          end: Number(p.stop_timestamp) * 1000 || Date.parse(String(p.end || p.stop).replace(' ', 'T'))
        })).filter(p => p.start && p.end && p.end > p.start).sort((a, b) => a.start - b.start);
      });
    }
  };

  /* XMLTV for M3U sources (url-tvg or user-provided EPG URL), parsed in the worker. */
  const Epg = App.Epg = {
    byChannel: null, loading: null,
    async ensure() {
      const s = Sources.active;
      if (!s || !s.epgUrl) return null;
      if (this.byChannel) return this.byChannel;
      if (!this.loading) {
        this.loading = (async () => {
          const xml = await Net.fetchText(s.epgUrl, 120000);
          const progs = await new Promise((resolve, reject) => {
            const w = new Worker('./js/playlist-worker.js');
            w.onmessage = (e) => { if (e.data.type === 'DONE_XMLTV') { w.terminate(); resolve(e.data.programs); } else if (e.data.type === 'ERROR') { w.terminate(); reject(new Error(e.data.error)); } };
            w.postMessage({ type: 'PARSE_XMLTV', data: xml });
          });
          const map = new Map();
          progs.forEach(p => { if (!map.has(p.channel)) map.set(p.channel, []); map.get(p.channel).push({ title: p.title, desc: p.description, start: p.start, end: p.stop }); });
          map.forEach(list => list.sort((a, b) => a.start - b.start));
          this.byChannel = map;
          return map;
        })().catch(e => { this.loading = null; throw e; });
      }
      return this.loading;
    },
    async forChannel(item) {
      const map = await this.ensure().catch(() => null);
      return map && item.epg ? (map.get(item.epg) || []) : [];
    },
    reset() { this.byChannel = null; this.loading = null; }
  };
  Bus.on('source', () => Epg.reset());

  /* ---------------------------------------------------------------- stream URLs */
  App.streamCandidates = function (item, kind) {
    const s = Sources.active;
    if (item.url) return [item.url];
    if (!s || s.type !== 'xtream') return [];
    let base = s.server.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
    const u = encodeURIComponent(s.user), p = encodeURIComponent(s.pass);
    const alt = base.startsWith('https://') ? base.replace(/^https:/i, 'http:') : base.replace(/^http:/i, 'https:');
    // When the page cannot load http:// at all, only https candidates can work.
    const bases = Net.blocked(base) ? [alt] : [base, alt];
    const urls = [];
    for (const b of bases) {
      if (kind === 'live') {
        const hls = `${b}/live/${u}/${p}/${item.id}.m3u8`, ts = `${b}/live/${u}/${p}/${item.id}.ts`;
        if (Settings.get('channelFormat') === 'ts') urls.push(ts, hls); else urls.push(hls, ts);
        urls.push(`${b}/${u}/${p}/${item.id}`);
      } else if (kind === 'episode') {
        urls.push(`${b}/series/${u}/${p}/${item.id}.${item.ext || 'mp4'}`);
        if ((item.ext || 'mp4') !== 'mp4') urls.push(`${b}/series/${u}/${p}/${item.id}.mp4`);
      } else {
        urls.push(`${b}/movie/${u}/${p}/${item.id}.${item.ext || 'mp4'}`);
        if ((item.ext || 'mp4') !== 'mp4') urls.push(`${b}/movie/${u}/${p}/${item.id}.mp4`);
      }
    }
    return [...new Set(urls)];
  };
  App.redact = (url) => String(url || '').replace(/(\/(?:live|movie|series))\/[^/]+\/[^/]+\//, '$1/•••/•••/').replace(/(username|password)=[^&]+/g, '$1=•••');

  App.newSourceId = uid;
})();
