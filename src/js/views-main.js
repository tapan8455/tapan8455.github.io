/* AURA IPTV — screens: Playlists, Add source/import, Home, Categories, Category grid, Detail, Search. */
'use strict';
(function () {
  const { $, $$, esc, ic, icr, fmtNum, fmtDate, fmtClock, fmtTime, Sources, Catalog, Api, User, Settings, Bus, Net, UI, Router, haptic, normText, yearOf, qualityOf } = App;
  const V = App.Views = App.Views || {};
  const brand = () => `${App.BRAND.first} ${App.BRAND.second}`;
  App.homeType = Settings.get('homeType') || 'movie';

  /* ================================================================ shared actions */
  App.findItem = function (type, id) {
    const hit = Catalog.item(type, id);
    if (hit) return hit;
    const f = User.d.favorites.find(x => x.type === type && String(x.id) === String(id))
      || User.d.recents.find(x => x.type === type && String(x.id) === String(id));
    if (f) return { id: String(f.id), type, name: f.name, icon: f.icon, cat: f.cat, ext: 'mp4' };
    const p = type === 'movie' && User.getProgress('movie', id);
    if (p) return { id: String(id), type, name: p.name, icon: p.icon, cat: p.cat, ext: 'mp4' };
    const sp = type === 'series' && User.getSeriesProgress(id);
    if (sp) return { id: String(id), type, name: sp.name, icon: sp.icon, cat: sp.cat };
    return null;
  };

  App.liveList = function (catId) {
    const list = Catalog.items('live', catId).slice();
    const sort = Settings.get('liveSort');
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'za') list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'new') list.sort((a, b) => b.added - a.added);
    return list;
  };

  App.playItem = function (item, opts = {}) {
    if (item.type === 'live') return App.Player.play(item, Object.assign({ kind: 'live', list: App.liveList(item.cat) }, opts));
    if (item.type === 'series') return App.playSeries(item, opts);
    return App.Player.play(item, Object.assign({ kind: 'movie' }, opts));
  };

  // Resume a series: last watched episode (or next one when it was finished), else S1E1.
  App.playSeries = async function (series, { epId, startAt, season } = {}) {
    if (series.url) return App.Player.play(Object.assign({}, series, { type: 'movie' }), { kind: 'movie' });
    let info;
    try { info = await Api.seriesInfo(series.id); } catch (e) { return UI.toast(`Could not load episodes: ${e.message}`, { icon: 'triangle-exclamation' }); }
    if (!info || !info.seasons) return UI.toast('Could not parse series information', { icon: 'triangle-exclamation' });
    const seasonList = info.seasonList || Object.keys(info.seasons || {});
    const all = seasonList.flatMap(s => (info.seasons && info.seasons[s]) || []);
    if (!all.length) return UI.toast('No episodes available for this series', { icon: 'triangle-exclamation' });
    let ep = epId && all.find(e => e.id === String(epId));
    if (!ep && !season) {
      const sp = User.getSeriesProgress(series.id);
      if (sp) {
        const i = all.findIndex(e => e.id === String(sp.epId));
        if (i > -1) ep = sp.dur && sp.pos / sp.dur > 0.95 && all[i + 1] ? all[i + 1] : all[i];
      }
    }
    if (!ep && season) ep = info.seasons[season] && info.seasons[season][0];
    ep = ep || all[0];
    const list = (info.seasons && info.seasons[String(ep.season)]) || (info.seasons && seasonList.find(s => info.seasons[s] && info.seasons[s].includes(ep)) && info.seasons[seasonList.find(s => info.seasons[s] && info.seasons[s].includes(ep))]) || all;
    const meta = { id: series.id, name: series.name || (info.info && info.info.name) || 'Series', icon: series.icon || (info.info && info.info.cover) || '', cat: series.cat };
    App.Player.play(ep, { kind: 'episode', list, series: meta, startAt });
  };

  App.download = function (item, kind, extra = {}) {
    if (kind === 'live') return UI.toast('Live channels cannot be downloaded', { icon: 'circle-info' });
    const url = App.streamCandidates(item, kind)[0];
    if (!url) return UI.toast('No download link for this title', { icon: 'triangle-exclamation' });
    const ext = item.ext || 'mp4';
    const filename = `${(extra.title || item.name || 'video').replace(/[/\\?%*:|"<>]/g, '_')}.${ext}`;
    User.d.downloads = User.d.downloads.filter(d => !(d.kind === kind && d.id === String(item.id)));
    User.d.downloads.unshift({ id: String(item.id), kind, name: extra.title || item.name, icon: extra.icon || item.icon || '', series: extra.series || null, ext, at: Date.now() });
    User.save();
    window.auraNative.downloadFile({ url, filename });
    UI.toast(Net.isElectron ? 'Downloading to your Downloads folder' : 'Download started in your browser', { icon: 'download' });
    Bus.emit('downloads');
  };

  App.openTrailer = function (raw) {
    const id = (String(raw).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(raw) ? raw : '');
    if (!id) return UI.toast('Trailer not available', { icon: 'circle-info' });
    UI.sheet({
      center: true, dark: true, label: 'Trailer',
      html: `${UI.sheetHeader({ icon: 'film', title: 'Trailer', dark: true })}<div class="sheet-body"><div style="aspect-ratio:16/9;border-radius:20px;overflow:hidden;background:#000">
        <iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Trailer"></iframe></div></div>`
    });
  };

  // Average poster color for the Continue Playing card tint (needs a CORS-enabled image host).
  const tintCache = new Map();
  // Sets `prop` on `el` to the poster's average colour ("r, g, b"), scaled by `k`.
  UI.tint = function (el, url, prop = '--tint', k = 0.55) {
    const key = `${url}|${k}`;
    const fallback = () => { const h = App.hashStr(url || '') % 360; el.style.setProperty(prop, hsl(h)); };
    const hsl = (h) => { const c = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.32 - 0.22 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return `${c(0)}, ${c(8)}, ${c(4)}`; };
    if (!url) return fallback();
    if (tintCache.has(key)) return el.style.setProperty(prop, tintCache.get(key));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
        const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        const v = `${Math.min(255, Math.round(r / n * k))}, ${Math.min(255, Math.round(g / n * k))}, ${Math.min(255, Math.round(b / n * k))}`;
        tintCache.set(key, v); el.style.setProperty(prop, v);
      } catch (_) { fallback(); }
    };
    img.onerror = fallback;
    img.src = Net.image(url);
  };

  /* ================================================================ Playlists (sources) */
  Router.routes.sources = function (el) {
    const render = () => {
      const list = Sources.list;
      const tot = list.reduce((a, s) => { const c = s.counts || {}; a.live += c.live || 0; a.movie += c.movie || 0; a.series += c.series || 0; return a; }, { live: 0, movie: 0, series: 0 });
      const active = Sources.active;
      el.innerHTML = `<div class="screen no-tabbar narrow">
        <div class="src-hdr">
          ${active && Catalog.ready ? `<button class="cbtn lg" data-go-home aria-label="Back to home">${ic('chevron-left')}</button>` : ''}
          <h1 class="trunc">${esc(brand())}</h1>
          <button class="cbtn lg" data-add aria-label="Add playlist">${ic('plus')}</button>
          <button class="cbtn lg" data-settings aria-label="Settings">${ic('gear')}</button>
        </div>
        <div class="stats-strip">
          <div><b>${fmtNum(list.length)}</b><small><span class="dot c-green"></span>SOURCES</small></div>
          <div><b>${fmtNum(tot.live)}</b><small><span class="dot c-blue"></span>LIVE</small></div>
          <div><b>${fmtNum(tot.movie)}</b><small><span class="dot c-orange"></span>MOVIES</small></div>
          <div><b>${fmtNum(tot.series)}</b><small><span class="dot c-purple"></span>SERIES</small></div>
        </div>
        <h2 class="title2" style="margin-bottom:18px">Active Playlists</h2>
        ${list.length ? list.map(s => card(s, active && s.id === active.id)).join('') : UI.empty({
          icon: ic('layer-group'), title: 'Add your first playlist',
          msg: 'Connect an Xtream Codes account or an M3U playlist. Everything stays on this device.',
          action: `<button class="btn" data-add>${ic('plus')} Add playlist</button>`
        })}
      </div>`;
    };
    const card = (s, active) => {
      const c = s.counts || {};
      const host = Sources.hostOf(s);
      return `<article class="pl-card${active ? ' active' : ''}" data-src="${s.id}" role="button" tabindex="0" aria-label="${esc(s.name || host)}">
        <div class="row-flex" style="gap:18px">
          <div class="pl-icon">${ic('layer-group')}</div>
          <div class="grow">
            <h3 class="pl-name trunc">${esc(s.name || host)}</h3>
            <div class="pl-sub"><span class="badge">${s.type === 'm3u' ? 'M3U' : 'XTREAM'}</span><span class="trunc">${esc(host)}${s.user ? ` • ${esc(s.user)}` : ''}</span></div>
          </div>
          <button class="cbtn lg" data-menu="${s.id}" aria-label="Playlist options">${ic('ellipsis')}</button>
        </div>
        <div class="pl-stats">
          <div><small>${ic('tower-broadcast')} Live</small><b>${fmtNum(c.live)}</b></div>
          <div><small>${ic('film')} Movies</small><b>${fmtNum(c.movie)}</b></div>
          <div><small>${ic('clone')} Series</small><b>${fmtNum(c.series)}</b></div>
        </div>
        <div class="pl-foot"><span>${ic('link')} ${s.type === 'm3u' ? 'M3U Playlist' : 'Xtream Codes API'}</span><span>${icr('clock')} ${esc(fmtDate(s.lastRefreshed || s.createdAt))}</span>${ic('chevron-right')}</div>
      </article>`;
    };
    render();
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-add]')) return V.addSource();
      if (e.target.closest('[data-settings]')) return V.openAdvanced();
      if (e.target.closest('[data-go-home]')) return Router.go('home');
      const m = e.target.closest('[data-menu]');
      if (m) {
        e.stopPropagation();
        const s = Sources.byId(m.dataset.menu);
        const isActive = Sources.active && Sources.active.id === s.id;
        return UI.menu(m, [
          { label: 'Refresh library', icon: 'rotate-right', onClick: () => V.importFlow(s) },
          !isActive && { label: 'Set as active', icon: 'circle-check', onClick: () => V.activate(s.id) },
          { label: 'Edit', icon: 'pen', onClick: () => V.addSource(s) },
          { label: 'Rename', icon: 'i-cursor', onClick: async () => { const n = await UI.prompt({ title: 'Rename playlist', value: s.name }); if (n) { Sources.update(s.id, { name: n }); render(); } } },
          { sep: true },
          { label: 'Delete', icon: 'trash-can', danger: true, onClick: async () => {
            if (!await UI.confirm({ title: 'Delete playlist?', msg: `${s.name} and its watch history will be removed from this device.`, ok: 'Delete', danger: true })) return;
            const wasActive = isActive;
            await Sources.remove(s.id);
            if (wasActive) await V.loadActive();
            Router.markDirty();
            render();
          } }
        ].filter(Boolean), { width: '270px' });
      }
      const c = e.target.closest('[data-src]');
      if (c) V.activate(c.dataset.src);
    });
    return { onShow: render };
  };

  V.loadActive = async function () {
    User.load();
    Bus.emit('source');
    const ok = await Catalog.load(Sources.active);
    Router.markDirty('home', 'epg', 'saved', 'profile', 'search');
    return ok;
  };

  V.activate = async function (id) {
    const changed = !Sources.active || Sources.active.id !== id;
    Sources.setActive(id);
    if (changed || !Catalog.ready) {
      const ok = await V.loadActive();
      if (!ok) return V.importFlow(Sources.active);
    }
    Router.go('home');
  };

  /* ---------------------------------------------------------------- add / edit source */
  V.addSource = function (existing) {
    let tab = existing ? (existing.type === 'm3u' ? (existing.m3uUrl ? 'm3u' : 'file') : 'xtream') : 'xtream';
    let fileText = null, fileName = '';
    const proxyHint = () => Net.isHttpsPage && !Net.hasServer && !Net.isElectron && !Net.proxyTemplate();
    const body = () => `
      <div class="seg2" role="tablist">
        <button class="${tab === 'xtream' ? 'on' : ''}" data-tab="xtream">Xtream Codes</button>
        <button class="${tab === 'm3u' ? 'on' : ''}" data-tab="m3u">M3U URL</button>
        <button class="${tab === 'file' ? 'on' : ''}" data-tab="file">File</button>
      </div>
      <form data-form autocomplete="off">
        <label class="label">Name (optional)</label>
        <div class="field">${ic('tag')}<input name="name" value="${esc(existing ? existing.name : '')}" placeholder="My provider"></div>
        ${tab === 'xtream' ? `
          <label class="label">Server URL</label>
          <div class="field">${ic('server')}<input name="server" inputmode="url" value="${esc(existing ? existing.server : '')}" placeholder="http://provider.com:8080" required></div>
          <label class="label">Username</label>
          <div class="field">${ic('user')}<input name="user" value="${esc(existing ? existing.user : '')}" autocapitalize="off" required></div>
          <label class="label">Password</label>
          <div class="field">${ic('key')}<input name="pass" type="password" value="${esc(existing ? existing.pass : '')}" required><button type="button" class="muted" data-eye aria-label="Show password">${ic('eye')}</button></div>`
        : tab === 'm3u' ? `
          <label class="label">Playlist URL</label>
          <div class="field">${ic('link')}<input name="url" inputmode="url" value="${esc(existing ? existing.m3uUrl || '' : '')}" placeholder="https://example.com/playlist.m3u" required></div>
          <label class="label">EPG / XMLTV URL (optional)</label>
          <div class="field">${ic('calendar')}<input name="epg" inputmode="url" value="${esc(existing ? existing.epgUrl || '' : '')}" placeholder="https://example.com/epg.xml"></div>`
        : `
          <label class="label">Playlist file</label>
          <label class="field" style="cursor:pointer">${ic('file-arrow-up')}<span class="grow trunc" data-fname>${esc(fileName || 'Choose an .m3u or .m3u8 file')}</span><input type="file" name="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/x-mpegurl" hidden></label>
          <label class="label">EPG / XMLTV URL (optional)</label>
          <div class="field">${ic('calendar')}<input name="epg" inputmode="url" placeholder="https://example.com/epg.xml"></div>`}
        <div data-err></div>
        ${proxyHint() && tab !== 'file' ? `<div class="banner blue">${ic('shield-halved')}<span>This site is served over <b>HTTPS</b>. Browsers block plain <code>http://</code> providers here, so add a CORS proxy in <a href="#" data-proxy>Connection settings</a> if your provider has no HTTPS. See <code>docs/PROXY.md</code>.</span></div>` : ''}
        <button class="btn" style="margin-top:22px" data-submit>${ic('plug')} ${existing ? 'Save & reconnect' : 'Connect'}</button>
        <p class="muted" style="text-align:center;font-size:14px;margin:16px 0 0">${ic('shield-halved')} Credentials stay on this device. Nothing is sent anywhere except your provider.</p>
      </form>`;
    const sheet = UI.sheet({
      full: true, label: 'Add playlist',
      html: `${UI.sheetHeader({ icon: 'plus', title: existing ? 'Edit playlist' : 'Add playlist', sub: 'Xtream Codes account, M3U link or file' })}<div class="sheet-body" data-body>${body()}</div>`,
      mount(ctx) {
        const host = $('[data-body]', ctx.el);
        host.addEventListener('click', (e) => {
          const t = e.target.closest('[data-tab]');
          if (t) { tab = t.dataset.tab; host.innerHTML = body(); return; }
          if (e.target.closest('[data-eye]')) { const i = $('input[name=pass]', host); i.type = i.type === 'password' ? 'text' : 'password'; }
          if (e.target.closest('[data-proxy]')) { e.preventDefault(); V.connectionSheet(); }
        });
        host.addEventListener('change', (e) => {
          if (e.target.name !== 'file') return;
          const f = e.target.files[0];
          if (!f) return;
          fileName = f.name;
          $('[data-fname]', host).textContent = f.name;
          const r = new FileReader();
          r.onload = () => { fileText = r.result; };
          r.readAsText(f);
        });
        host.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          const err = $('[data-err]', host);
          const btn = $('[data-submit]', host);
          const showErr = (msg, code) => {
            err.innerHTML = `<div class="banner red">${ic('triangle-exclamation')}<span style="white-space:pre-line">${esc(msg)}${code === 'mixed' || code === 'cors' ? ` <a href="#" data-proxy>Set up a proxy</a>.` : ''}</span></div>`;
            btn.disabled = false; btn.innerHTML = `${ic('plug')} ${existing ? 'Save & reconnect' : 'Connect'}`;
          };
          btn.disabled = true; btn.innerHTML = `${UI.spinner()} Connecting…`;
          let src;
          if (tab === 'xtream') {
            let server = f.server.value.trim().replace(/\/(player_api\.php|get\.php|c\/?)?(\?.*)?$/i, '').replace(/\/+$/, '');
            if (!/^https?:\/\//i.test(server)) server = `${Net.isHttpsPage ? 'https' : 'http'}://${server}`;
            const user = f.user.value.trim(), pass = f.pass.value;
            let res;
            const attempts = [];
            // An HTTPS page cannot use http:// at all, so try the provider's HTTPS address first.
            if (Net.blocked(server)) {
              btn.innerHTML = `${UI.spinner()} Trying secure connection…`;
              const up = await App.upgradeServer(server, user, pass, attempts);
              if (up) { server = up.server; res = { success: true, data: up.data }; }
            }
            if (!res) res = await window.auraNative.testConnection({ server, user, pass });
            if (!res.success && attempts.length) res.error = `Could not connect securely. Tried:\n${attempts.join('\n')}`;
            if (!res.success) return showErr(res.error || 'Could not connect', res.code);
            const ui = res.data.user_info || {};
            if (ui.status && !/active/i.test(ui.status)) return showErr(`Account status: ${ui.status}${ui.exp_date ? ` (expired ${new Date(ui.exp_date * 1000).toLocaleDateString()})` : ''}`);
            src = Object.assign(existing || { id: App.newSourceId(), createdAt: Date.now(), counts: { live: 0, movie: 0, series: 0 } }, {
              type: 'xtream', server, user, pass, account: { at: Date.now(), user: ui, server: res.data.server_info || {} }
            });
          } else if (tab === 'm3u') {
            const url = f.url.value.trim();
            if (!/^https?:\/\//i.test(url)) return showErr('Enter a full http(s):// playlist URL');
            src = Object.assign(existing || { id: App.newSourceId(), createdAt: Date.now(), counts: {} }, { type: 'm3u', m3uUrl: url, epgUrl: f.epg.value.trim() || '' });
          } else {
            if (!fileText) return showErr('Choose a playlist file first');
            src = Object.assign(existing || { id: App.newSourceId(), createdAt: Date.now(), counts: {} }, { type: 'm3u', m3uUrl: '', fileName, m3uText: fileText, epgUrl: f.epg.value.trim() || '' });
          }
          src.name = f.name.value.trim() || (tab === 'file' ? fileName.replace(/\.(m3u8?|txt)$/i, '') : Sources.hostOf(src));
          if (!existing) Sources.add(src); else { Sources.update(src.id, src); Sources.setActive(src.id); }
          ctx.close(() => V.importFlow(src, { isNew: !existing }));
        });
      }
    });
    return sheet;
  };

  /* ---------------------------------------------------------------- import progress */
  V.importFlow = async function (src, { isNew = false } = {}) {
    if (src.type === 'm3u' && !src.m3uUrl && !src.m3uText) {
      UI.toast('File playlists are refreshed by importing the file again', { icon: 'circle-info' });
      return V.addSource(src);
    }
    const ov = document.createElement('div');
    ov.className = 'full-ov';
    const steps = { live: { label: 'Live channels', state: 'wait', count: 0 }, movie: { label: 'Movies', state: 'wait', count: 0 }, series: { label: 'Series', state: 'wait', count: 0 } };
    const icon = (s) => s === 'done' ? ic('circle-check') : s === 'error' ? ic('circle-exclamation') : s === 'loading' ? `<span style="display:inline-block;transform:scale(.5);margin:-12px">${UI.spinner()}</span>` : icr('circle');
    const render = (msg = '') => {
      ov.innerHTML = `<div class="import-box">
        <div class="pl-icon">${ic('layer-group')}</div>
        <h1 class="title1">${isNew ? 'Importing your library' : 'Refreshing library'}</h1>
        <p class="muted" style="margin:8px 0 18px">${esc(src.name || Sources.hostOf(src))}</p>
        ${Object.entries(steps).filter(([t]) => src.type !== 'm3u' || t === 'live').map(([t, s]) => `<div class="import-step ${s.state}"><span class="st">${icon(s.state)}</span><b>${src.type === 'm3u' ? 'Channels & videos' : s.label}</b><span>${s.count ? fmtNum(s.count) : ''}</span></div>`).join('')}
        ${msg}</div>`;
    };
    render();
    document.body.appendChild(ov);
    try {
      if (Sources.active && Sources.active.id === src.id) User.load();
      await Catalog.sync(src, (p) => { Object.assign(steps[p.type], { state: p.state, count: p.count }); render(); });
      Sources.setActive(src.id);
      await V.loadActive();
      haptic(20);
      render(`<p style="margin-top:20px;color:var(--green);font-weight:700">${ic('circle-check')} Ready</p>`);
      await App.sleep(500);
      ov.remove();
      Router.go('home');
      Bus.emit('sources');
    } catch (e) {
      const needsProxy = e.code === 'mixed' || e.code === 'cors';
      render(`${needsProxy ? `<div class="banner" style="margin-top:18px">${ic('shield-halved')}<span><b>${e.code === 'mixed' ? 'Your provider only works over http://' : 'Your provider blocks browser requests'}</b>, and this site runs on HTTPS, so the browser refuses to connect. Add a free proxy once (about 3 minutes) in <b>Connection settings</b>, or open the app from a local server (<code>npm run serve</code>) or the desktop app.</span></div>` : `<div class="banner red" style="margin-top:18px">${ic('triangle-exclamation')}<span>${esc(e.message)}</span></div>`}
        <div class="btn-row" style="margin-top:18px"><button class="btn secondary" data-x="back">Back</button><button class="btn" data-x="retry">Retry</button></div>
        ${e.code === 'mixed' || e.code === 'cors' ? `<button class="btn ghost" style="margin-top:12px" data-x="proxy">${ic('shield-halved')} Connection settings</button>` : ''}`);
      ov.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-x]');
        if (!b) return;
        ov.remove();
        if (b.dataset.x === 'retry') V.importFlow(src, { isNew });
        else if (b.dataset.x === 'proxy') V.connectionSheet();
        else Router.go('sources');
      }, { once: true });
    }
  };

  App.backgroundRefresh = async function () {
    const s = Sources.active;
    if (!s || !Catalog.ready || !Catalog.needsRefresh(s) || (s.type === 'm3u' && !s.m3uUrl)) return;
    const b = document.createElement('div');
    b.className = 'top-banner';
    b.innerHTML = `<span style="transform:scale(.45);margin:-14px -10px;display:inline-block;color:var(--accent)">${UI.spinner()}</span> Refreshing library…`;
    document.body.appendChild(b);
    try { await Catalog.sync(s); Router.markDirty('home', 'epg', 'search'); Bus.emit('sources'); } catch (e) { console.warn('[refresh]', e.message); }
    b.remove();
  };

  /* ================================================================ Home */
  Router.routes.home = function (el) {
    const type = App.homeType;
    const typeIcon = { live: 'tv', movie: 'film', series: 'layer-group' }[type];
    el.innerHTML = `<div class="ambient" aria-hidden="true"></div><header class="home-hdr"><div class="home-hdr-inner">
        <h1 class="home-title d-only grow">${App.TYPE_LABEL[type] === 'Live' ? 'Live TV' : App.TYPE_LABEL[type]}</h1>
        <div class="grow m-only"><span class="wordmark">${esc(App.BRAND.first)} ${esc(App.BRAND.second)}<svg viewBox="0 0 100 14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 4 Q50 16 92 5"/><path d="M84 2 L93 5 L87 11"/></svg></span></div>
        <button class="pill-btn d-only" data-h="cats">${ic('table-cells-large')} Categories</button>
        <button class="cbtn lg m-only" data-h="swap" aria-label="Switch playlist">${ic('right-left')}</button>
        <button class="type-pill m-only" data-h="type" aria-label="Content type: ${App.TYPE_LABEL[type]}" aria-haspopup="menu">${ic(typeIcon)}${ic('chevron-down')}</button>
      </div></header>
      <div data-home></div>`;
    const host = $('[data-home]', el);
    const hdr = $('.home-hdr', el);
    const onScroll = () => hdr.classList.toggle('scrolled', window.scrollY > 8);

    if (!Catalog.ready) {
      host.innerHTML = `<div class="screen">${UI.empty({ icon: ic('layer-group'), title: 'Library not loaded', msg: 'Import your playlist to start browsing.', action: `<button class="btn" data-h="import">${ic('rotate-right')} Import now</button>` })}</div>`;
    } else if (type === 'live') renderLive(host);
    else renderVod(host, type);

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-h]');
      if (!b) return;
      const a = b.dataset.h;
      if (a === 'swap') Router.go('sources');
      else if (a === 'import') V.importFlow(Sources.active);
      else if (a === 'cats') V.categoriesSheet(type);
      else if (a === 'type') {
        UI.menu(b, [
          { label: 'Live', icon: 'tower-broadcast', tile: 'c-blue', on: type === 'live', onClick: () => setType('live') },
          { label: 'Movies', icon: 'film', tile: 'c-orange', on: type === 'movie', onClick: () => setType('movie') },
          { label: 'Series', icon: 'layer-group', tile: 'c-green', on: type === 'series', onClick: () => setType('series') },
          { sep: true },
          { label: 'Manage Categories', icon: 'sliders', tile: 'c-gray', chevron: true, onClick: () => V.manageCategories(type) }
        ], { width: 'min(320px, calc(100vw - 32px))' });
      }
    });

    let heroTimer = null;
    return {
      onShow() {
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        const hero = $('.hero', el);
        clearInterval(heroTimer);
        if (hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          let touched = 0;
          hero.addEventListener('pointerdown', () => { touched = Date.now(); }, { passive: true });
          heroTimer = setInterval(() => {
            if (el.hidden || Date.now() - touched < 8000 || App.Player.open) return;
            const cards = $$('.hero-card', hero);
            if (cards.length < 2) return;
            const w = cards[1].offsetLeft - cards[0].offsetLeft;
            const i = Math.round(hero.scrollLeft / w);
            hero.scrollTo({ left: ((i + 1) % cards.length) * w, behavior: 'smooth' });
          }, 6000);
        }
      },
      onHide() { clearInterval(heroTimer); window.removeEventListener('scroll', onScroll); }
    };
  };
  function setType(t) { App.homeType = t; Router.markDirty('home'); }
  V.setHomeType = setType;

  function renderVod(host, type) {
    const parts = [];
    if (Settings.get('heroCarousel')) {
      const picks = Catalog.heroPicks(type);
      if (picks.length) parts.push(`<div class="hero" role="list" aria-label="Featured">${picks.map(it => {
        const meta = [App.TYPE_ONE[type], type === 'movie' && it.ext ? it.ext.toUpperCase() : '', it.rating ? `★ ${Number(it.rating).toFixed(1)}` : ''].filter(Boolean).join(' • ');
        return `<div class="hero-card" role="listitem" data-act="open" data-type="${type}" data-id="${esc(it.id)}" data-ph="poster" data-name="${esc(it.name)}">${UI.img(it.icon, it.name)}${UI.img(it.icon, '', 'hero-fg')}
          <div class="hero-info"><div class="grow"><h2 class="clamp2">${esc(it.name)}</h2><p>• ${esc(meta)}</p></div>
          <button class="hero-play" data-act="play" data-type="${type}" data-id="${esc(it.id)}" aria-label="Play ${esc(it.name)}">${ic('play')}<span class="d-only">Play</span></button></div></div>`;
      }).join('')}</div>`);
    }
    if (Settings.get('freshArrivals')) {
      const fresh = Catalog.freshArrivals(type, 20);
      if (fresh.length) parts.push(`<section class="section"><div class="section-hdr"><h2 class="section-title">Fresh Arrivals</h2><span class="rail-arrows d-only"><button data-rail="-1" aria-label="Scroll left">${ic('chevron-left')}</button><button data-rail="1" aria-label="Scroll right">${ic('chevron-right')}</button></span></div>
        <div class="rank-rail scroll-x">${fresh.map((it, i) => `<div class="rank-item" data-act="open" data-type="${type}" data-id="${esc(it.id)}"><span class="rank-num">${i + 1}</span>${UI.poster(it, { act: 'none' })}</div>`).join('')}</div></section>`);
    }
    const cont = Settings.get('continuePlaying') ? continueItems(type) : [];
    if (cont.length) parts.push(`<section class="section" data-cont><div class="section-hdr">${ic('circle-play')}<h2 class="section-title">Continue Playing</h2><span class="rail-arrows d-only"><button data-rail="-1" aria-label="Scroll left">${ic('chevron-left')}</button><button data-rail="1" aria-label="Scroll right">${ic('chevron-right')}</button></span></div>
      <div class="rail scroll-x">${cont.map(c => `<div class="cont-card" data-cont-id="${esc(c.id)}" data-tint="${esc(c.icon || '')}" role="button" tabindex="0" aria-label="Continue ${esc(c.name)}">
        <div class="poster" data-ph="poster" data-name="${esc(c.name)}">${c.icon ? UI.img(c.icon, '') : `<div class="ph">${ic('film')}</div>`}<span class="play-ov">${ic('play')}</span></div>
        <div class="info"><span class="type-chip">${ic(type === 'series' ? 'layer-group' : 'film')} ${App.TYPE_LABEL[type]}</span><h3 class="clamp2">${esc(c.name)}</h3>
        <span class="muted">${c.sub}</span><div class="bar"><i style="width:${c.pct}%"></i></div></div>
        <button class="cbtn kebab" data-cont-menu="${esc(c.id)}" aria-label="More options">${ic('ellipsis-vertical')}</button></div>`).join('')}</div></section>`);
    parts.push('<div data-rails></div>');
    host.innerHTML = parts.join('');
    $$('[data-tint]', host).forEach(card => UI.tint(card, card.dataset.tint));
    // Ambient glow behind the header follows the poster currently shown in the hero.
    const heroEl = $('.hero', host);
    if (heroEl) {
      const glow = () => {
        const cards = $$('.hero-card', heroEl);
        if (!cards.length) return;
        const step = cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : 0;
        const card = step > 0 ? cards[Math.min(cards.length - 1, Math.max(0, Math.round(heroEl.scrollLeft / step)))] : cards[0];
        if (!card) return;
        const it = Catalog.item(type, card.dataset.id);
        if (it && it.icon) UI.tint(host.parentElement, it.icon, '--amb', 1.15);
      };
      glow();
      heroEl.addEventListener('scroll', App.debounce(glow, 160), { passive: true });
    }
    host.addEventListener('click', (e) => {
      const menuBtn = e.target.closest('[data-cont-menu]');
      const card = e.target.closest('[data-cont-id]');
      if (!card) return;
      const c = cont.find(x => String(x.id) === card.dataset.contId);
      if (menuBtn) { e.stopPropagation(); return contMenu(menuBtn, type, c); }
      if (type === 'series') App.playSeries(c.item);
      else App.Player.play(c.item, { kind: 'movie' });
    });
    // Category rails load progressively as the user scrolls.
    const cats = Catalog.cats(type).filter(c => c.count > 0);
    const railsHost = $('[data-rails]', host);
    if (!cats.length) { railsHost.innerHTML = `<div class="screen" style="padding-top:20px">${UI.empty({ icon: ic('eye-slash'), title: 'No categories to show', msg: 'All categories are hidden or locked. Use Manage Categories to show them.' })}</div>`; return; }
    UI.chunked(railsHost, cats, (c) => {
      const items = Catalog.items(type, c.id).slice(0, 30);
      return `<section class="section"><div class="section-hdr" data-act="cat" data-type="${type}" data-id="${esc(c.id)}" role="button" tabindex="0"><h2 class="section-title trunc">${esc(c.name)}</h2><span class="rail-arrows d-only"><button data-rail="-1" aria-label="Scroll left">${ic('chevron-left')}</button><button data-rail="1" aria-label="Scroll right">${ic('chevron-right')}</button></span>${ic('chevron-right')}</div>
        <div class="rail scroll-x">${items.map(it => UI.poster(it)).join('')}</div></section>`;
    }, { chunk: 4 });
  }

  function continueItems(type) {
    const out = [];
    if (type === 'movie') {
      Object.entries(User.d.progress).forEach(([k, p]) => {
        if (!k.startsWith('movie:')) return;
        const pct = User.pct(p);
        if (pct < 1 || pct >= 95) return;
        const id = k.slice(6);
        if (Catalog.item('movie', id) && !Catalog.catVisible('movie', Catalog.item('movie', id).cat)) return;
        const item = Catalog.item('movie', id) || { id, type: 'movie', name: p.name, icon: p.icon, cat: p.cat, ext: 'mp4' };
        out.push({ id, item, name: item.name, icon: item.icon, pct, sub: `${pct}% watched`, at: p.at });
      });
    } else if (type === 'series') {
      Object.entries(User.d.seriesProgress).forEach(([id, p]) => {
        const pct = p.dur ? Math.round(p.pos / p.dur * 100) : 0;
        const it = Catalog.item('series', id);
        if (it && !Catalog.catVisible('series', it.cat)) return;
        const item = it || { id, type: 'series', name: p.name, icon: p.icon, cat: p.cat };
        out.push({ id, item, name: item.name, icon: item.icon || p.icon, pct, sub: `S${p.season} E${p.episode} · ${pct}% watched`, at: p.at });
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 20);
  }

  function contMenu(anchor, type, c) {
    UI.menu(anchor, [
      { label: 'Play from beginning', icon: 'backward-fast', onClick: () => {
        if (type === 'series') { const sp = User.getSeriesProgress(c.id); App.playSeries(c.item, { epId: sp && sp.epId, startAt: 0 }); }
        else App.Player.play(c.item, { kind: 'movie', startAt: 0 });
      } },
      { label: 'Mark as watched', icon: 'circle-check', onClick: () => {
        if (type === 'series') { const sp = User.getSeriesProgress(c.id); if (sp) { sp.pos = sp.dur; User.save(); } }
        else { const p = User.getProgress('movie', c.id); if (p) { p.pos = p.dur; User.save(); } }
        Router.markDirty('home');
      } },
      { label: 'Remove from Continue Playing', icon: 'xmark', onClick: () => {
        if (type === 'series') { delete User.d.seriesProgress[c.id]; User.save(); } else User.clearProgress('movie', c.id);
        Router.markDirty('home');
      } },
      { label: 'Go to details', icon: 'circle-info', onClick: () => Router.go(`detail/${type}/${c.id}`) }
    ], { width: '300px' });
  }

  function renderLive(host) {
    const cats = Catalog.cats('live').filter(c => c.count > 0);
    if (!cats.length) { host.innerHTML = `<div class="screen">${UI.empty({ icon: ic('tv'), title: 'No live channels', msg: 'This playlist has no visible live categories.' })}</div>`; return; }
    let cur = cats.find(c => c.id === User.d.liveCat) || cats[0];
    const sortLabel = { provider: 'Provider', az: 'A–Z', za: 'Z–A', new: 'Newest' };
    host.innerHTML = `<div class="screen" style="padding-top:4px">
      <div class="chips scroll-x" data-chips>${cats.map(c => `<button class="chip${c.id === cur.id ? ' on' : ''}" data-chip="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="live-hdr"><div class="grow"><h2 class="clamp2" data-cat-name></h2><p data-cat-count></p></div>
        <button class="pill-btn" data-sort aria-label="Sort channels">${ic('arrow-down-up-across-line')} <span data-sort-label>${sortLabel[Settings.get('liveSort')] || 'Provider'}</span></button>
        <span class="live-pill">LIVE</span></div>
      <div class="ch-grid" data-grid></div></div>`;
    let lazy;
    const fill = () => {
      lazy && lazy.disconnect();
      const list = App.liveList(cur.id);
      $('[data-cat-name]', host).textContent = cur.name;
      $('[data-cat-count]', host).textContent = `${fmtNum(list.length)} channels`;
      const grid = $('[data-grid]', host);
      grid.innerHTML = '';
      lazy = UI.chunked(grid, list, UI.channel, { chunk: 48 });
    };
    fill();
    const chip = $(`[data-chip="${CSS.escape(cur.id)}"]`, host);
    if (chip) setTimeout(() => chip.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
    host.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]');
      if (c) {
        cur = Catalog.cat('live', c.dataset.chip);
        User.d.liveCat = cur.id; User.save();
        $$('[data-chip]', host).forEach(b => b.classList.toggle('on', b === c));
        c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        fill();
      }
      if (e.target.closest('[data-sort]')) {
        const order = ['provider', 'az', 'za', 'new'];
        const next = order[(order.indexOf(Settings.get('liveSort')) + 1) % order.length];
        Settings.set('liveSort', next);
        $('[data-sort-label]', host).textContent = sortLabel[next];
        fill();
      }
    });
    V.selectLiveCat = (id) => { const b = $(`[data-chip="${CSS.escape(id)}"]`, host); if (b) b.click(); };
  }

  /* ---------------------------------------------------------------- categories sheet (floating button) */
  V.categoriesSheet = function (type = App.homeType) {
    const groups = Catalog.groups(type, { includeHidden: true }).map(g => ({ name: g.name, cats: g.cats.filter(c => !User.isHidden(type, c.id) && c.count > 0) })).filter(g => g.cats.length);
    const total = groups.reduce((a, g) => a + g.cats.length, 0);
    const selected = type === 'live' ? User.d.liveCat : App.lastCat && App.lastCat[type];
    const openGroup = (groups.find(g => g.cats.some(c => c.id === selected)) || groups[0] || {}).name;
    let q = '';
    const list = () => {
      const nq = normText(q);
      const gs = groups.map(g => ({ name: g.name, cats: nq ? g.cats.filter(c => normText(c.name).includes(nq)) : g.cats })).filter(g => g.cats.length);
      if (!gs.length) return `<p class="muted" style="text-align:center;padding:30px 0">No categories match “${esc(q)}”.</p>`;
      return gs.map(g => `<div class="grp${nq || g.name === openGroup || gs.length === 1 || g.cats.length === 1 ? ' open' : ''}${g.cats.length === 1 ? ' single' : ''}">
        ${g.cats.length === 1 ? '' : `<button class="grp-hdr" data-grp>${ic('chevron-down')}<b class="grow trunc">${esc(g.name)}</b><span class="count-pill">${g.cats.length}</span></button>`}
        <div class="grp-items">${g.cats.map(c => {
          const vis = Catalog.visual(c, type);
          const locked = User.isLocked(type, c.id) && !App.unlocked;
          const on = c.id === selected;
          return `<button class="cat-item${on ? ' on' : ''}" data-cat="${esc(c.id)}"><span class="tile grad" style="--g1:${vis.g1};--g2:${vis.g2}">${ic(vis.icon)}</span>
            <b class="trunc">${esc(g.cats.length > 1 ? c.label : c.name)}</b>${locked ? `<span class="go">${ic('lock')}</span>` : on ? `<span class="ok">${ic('check')}</span>` : `<span class="go">${ic('chevron-right')}</span>`}</button>`;
        }).join('')}</div></div>`).join('');
    };
    UI.sheet({
      label: `${App.TYPE_LABEL[type]} categories`,
      html: `${UI.sheetHeader({ icon: { live: 'tv', movie: 'film', series: 'layer-group' }[type], title: `${App.TYPE_LABEL[type]} Categories`, sub: `${fmtNum(total)} categories` })}
        <div class="sheet-body flush-top"><div class="field" style="margin-bottom:18px">${ic('magnifying-glass')}<input type="search" placeholder="Search categories" data-q aria-label="Search categories"></div><div data-list>${list()}</div></div>`,
      mount(ctx) {
        ctx.el.style.height = 'min(78dvh, 900px)';
        $('[data-q]', ctx.el).addEventListener('input', (e) => { q = e.target.value; $('[data-list]', ctx.el).innerHTML = list(); });
        ctx.el.addEventListener('click', async (e) => {
          const g = e.target.closest('[data-grp]');
          if (g) return g.parentElement.classList.toggle('open');
          const c = e.target.closest('[data-cat]');
          if (!c) return;
          const id = c.dataset.cat;
          if (User.isLocked(type, id) && !App.unlocked && !await UI.Pin.unlockSession()) return;
          App.lastCat = Object.assign(App.lastCat || {}, { [type]: id });
          ctx.close(() => {
            if (type === 'live') { User.d.liveCat = id; User.save(); if (V.selectLiveCat) V.selectLiveCat(id); Router.markDirty('home'); }
            else Router.go(`category/${type}/${id}`);
          });
        });
      }
    });
  };

  /* ================================================================ Category grid */
  Router.routes.category = function (el, type, catId) {
    const cat = Catalog.cat(type, catId);
    if (!cat) { el.innerHTML = `<div class="screen no-tabbar">${UI.empty({ icon: ic('folder-open'), title: 'Category not found', msg: 'It may have been removed by your provider.' })}</div>`; return; }
    if (!Catalog.catVisible(type, catId)) {
      el.innerHTML = `<div class="screen no-tabbar">${UI.empty({ icon: ic('lock'), title: 'This category is locked', msg: 'Enter your Content PIN to view it.', action: `<button class="btn" data-unlock>${ic('unlock')} Unlock</button>` })}</div>`;
      $('[data-unlock]', el).onclick = async () => { if (await UI.Pin.unlockSession()) Router.markDirty(); };
      return;
    }
    App.lastCat = Object.assign(App.lastCat || {}, { [type]: catId });
    let sort = 'provider';
    const sorts = { provider: 'Provider order', new: 'Newest first', az: 'A–Z', rating: 'Top rated' };
    el.innerHTML = `<div class="screen no-tabbar" style="padding-top:0">
      <div class="sticky-top"><div class="page-hdr" style="margin:0">
        <button class="cbtn lg" data-back aria-label="Back">${ic('chevron-left')}</button>
        <div class="grow"><h1 class="trunc">${esc(cat.name)}</h1><p class="muted" style="margin:2px 0 0" data-count></p></div>
        <button class="cbtn lg" data-sort aria-label="Sort">${ic('arrow-down-wide-short')}</button></div></div>
      <div class="${type === 'live' ? 'ch-grid' : 'poster-grid'}" data-grid style="margin-top:18px"></div></div>`;
    let lazy;
    const fill = () => {
      let list = type === 'live' ? App.liveList(catId) : Catalog.items(type, catId).slice();
      if (sort === 'new') list.sort((a, b) => b.added - a.added);
      else if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
      else if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      $('[data-count]', el).textContent = `${fmtNum(list.length)} ${type === 'live' ? 'channels' : 'titles'}`;
      const grid = $('[data-grid]', el);
      grid.innerHTML = '';
      lazy && lazy.disconnect();
      lazy = UI.chunked(grid, list, type === 'live' ? UI.channel : (it) => UI.poster(it, { title: true }), { chunk: 60 });
    };
    fill();
    $('[data-back]', el).onclick = () => Router.back();
    $('[data-sort]', el).onclick = (e) => UI.menu(e.currentTarget, Object.entries(sorts).filter(([k]) => type !== 'live' || k !== 'rating').map(([k, label]) => ({ label, icon: k === sort ? 'check' : '', on: k === sort, check: false, onClick: () => { sort = k; fill(); } })), { width: '240px' });
  };

  /* ================================================================ Detail */
  Router.routes.detail = function (el, type, id) {
    const item = App.findItem(type, id);
    if (!item) { el.innerHTML = `<div class="screen no-tabbar">${UI.empty({ icon: ic('film'), title: 'Title not found', msg: 'It is no longer in your playlist.', action: `<button class="btn" data-back>${ic('chevron-left')} Back</button>` })}</div>`; $('[data-back]', el).onclick = () => Router.back(); return; }
    if (type === 'live') { App.playItem(item); Router.back(); return; }
    const isSeries = type === 'series' && !item.url;
    const fav = () => User.isFav(type, item.id);
    el.innerHTML = `<div class="detail-top"><button class="cbtn lg glass" data-back aria-label="Back">${ic('chevron-left')}</button>
        <button class="cbtn lg glass" data-fav aria-label="Watchlist">${fav() ? ic('heart', 'accent') : icr('heart')}</button></div>
      <div class="detail-hero" data-hero data-ph="none">${item.icon ? UI.img(item.icon, '') : ''}</div>
      <div class="detail-head"><div class="meta-chips" data-chips></div><h1 class="detail-title">${esc(item.name)}</h1></div>
      <div class="detail-body screen no-tabbar" style="padding-top:0" data-body>${UI.skeletonRail(1, 600, 64).replace('rail scroll-x', '')}</div>`;
    $('[data-back]', el).onclick = () => Router.back();
    $('[data-fav]', el).onclick = (e) => {
      const on = User.toggleFav(item);
      e.currentTarget.innerHTML = on ? ic('heart', 'accent') : icr('heart');
      UI.toast(on ? 'Added to Watchlist' : 'Removed from Watchlist', { icon: 'heart' });
      haptic();
    };
    const body = $('[data-body]', el);
    const chips = $('[data-chips]', el);
    const setHero = (url) => { if (!url) return; const h = $('[data-hero]', el); h.innerHTML = UI.img(url, ''); };
    const genreChips = (genre, rating) => {
      const gs = String(genre || '').split(/[,/|]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
      const q = qualityOf(item.name) || qualityOf((Catalog.cat(type, item.cat) || {}).name);
      const r = Number(rating) || item.rating;
      const all = gs.map(g => `<span>${esc(g)}</span>`);
      if (q) all.push(`<span>${q}</span>`);
      if (r > 0) all.push(`<span>${ic('star')} ${Number(r).toFixed(r % 1 ? 1 : 0)}</span>`);
      return all.length ? `<div class="genre-row scroll-x">${all.join('')}</div>` : '';
    };
    const langCount = (info) => {
      const raw = info.language || info.languages || (info.audio && info.audio.tags && info.audio.tags.language) || '';
      const n = String(raw).split(/[,/|+&]/).map(s => s.trim()).filter(Boolean).length;
      const m = item.name.match(/(\d+)\s*(?:languages|langs|audio)/i);
      return n || (m ? Number(m[1]) : 0);
    };
    const facts = (pairs) => {
      const rows = pairs.filter(([, v]) => v && String(v).trim());
      return rows.length ? `<div class="facts">${rows.map(([k, v]) => `<div class="kv"><span>${k}</span><span>${esc(String(v).trim())}</span></div>`).join('')}</div>` : '';
    };
    const plotBlock = (plot) => plot ? `<p class="plot clamp3" data-plot>${esc(plot)}</p><button class="plot-more" data-more>More</button>` : '';
    const wirePlot = () => {
      const p = $('[data-plot]', body), m = $('[data-more]', body);
      if (!p || !m) return;
      requestAnimationFrame(() => { if (p.scrollHeight <= p.clientHeight + 2) m.remove(); });
      m.onclick = () => { p.classList.toggle('clamp3'); m.textContent = p.classList.contains('clamp3') ? 'More' : 'Less'; };
    };
    const dlCard = (kind, it, extra) => {
      const d = User.d.downloads.find(x => x.kind === kind && x.id === String(it.id));
      return `<button class="dl-card" data-dl><span class="tile solid c-accent round">${ic(d ? 'check' : 'arrow-down')}</span>
        <span class="grow"><h3>${d ? 'Downloaded' : `Download ${extra || 'Movie'}`}</h3><p>${d ? 'Saved to your device · Download again' : 'Save for offline viewing'}</p></span><span class="muted">${ic('chevron-right')}</span></button>`;
    };

    if (!isSeries) {
      const kind = 'movie';
      const render = (info = {}) => {
        const prog = User.getProgress(kind, item.id);
        const pct = User.pct(prog);
        const resumable = prog && prog.pos > 10 && pct < 95;
        const year = (String(info.releasedate || info.release_date || '').match(/\d{4}/) || [yearOf(item)])[0];
        const dur = info.duration || (info.duration_secs ? fmtClock(info.duration_secs) : '');
        const langs = langCount(info);
        chips.innerHTML = [year, dur, langs ? `${langs} Language${langs > 1 ? 's' : ''}` : ''].filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('');
        body.innerHTML = `
          <div class="btn-row"><button class="btn" data-play>${ic('play')} ${resumable ? 'Continue' : 'Play Now'}</button>
          ${info.youtube_trailer ? `<button class="btn secondary" data-trailer>${App.icb('youtube')} Trailer</button>` : ''}</div>
          ${genreChips(info.genre, info.rating)}
          ${resumable ? `<div class="prog-row"><div class="bar"><i style="width:${pct}%"></i></div><span>${pct}% watched • ${fmtTime(prog.pos)} / ${fmtTime(prog.dur)}</span></div><button class="restart-link" data-restart>${ic('backward-fast')} Play from beginning</button>` : ''}
          ${plotBlock(info.plot || info.description)}
          ${facts([['Director', info.director], ['Cast', info.cast || info.actors], ['Released', info.releasedate || info.release_date], ['Country', info.country]])}
          ${dlCard(kind, item)}`;
        wirePlot();
        $('[data-play]', body).onclick = () => App.Player.play(item, { kind });
        const rs = $('[data-restart]', body); if (rs) rs.onclick = () => App.Player.play(item, { kind, startAt: 0 });
        const tr = $('[data-trailer]', body); if (tr) tr.onclick = () => App.openTrailer(info.youtube_trailer);
        $('[data-dl]', body).onclick = () => { App.download(item, kind); render(info); };
      };
      render();
      if (App.Sources.active.type === 'xtream') {
        Api.vodInfo(item.id).then(d => {
          const info = (d && d.info) || {};
          if (d && d.movie_data && d.movie_data.container_extension) item.ext = d.movie_data.container_extension;
          setHero((Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path) || info.cover_big || info.movie_image || item.icon);
          render(info);
        }).catch(() => {});
      }
      const off = Bus.on('progress', () => { if (!el.hidden) Router.markDirty(Router.current.key); });
      return { onHide: off };
    }

    // ----- series
    let info = null, season = null;
    const renderSeries = () => {
      const sp = User.getSeriesProgress(item.id);
      const i = info ? info.info : {};
      const nSeasons = info ? info.seasonList.length : 0;
      const year = (String(i.releaseDate || i.release_date || '').match(/\d{4}/) || [item.year || yearOf(item)])[0];
      const langs = langCount(i);
      chips.innerHTML = [year, nSeasons ? `${nSeasons} Season${nSeasons > 1 ? 's' : ''}` : '', langs ? `${langs} Language${langs > 1 ? 's' : ''}` : ''].filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('');
      if (!info) return;
      const eps = info.seasons[season] || [];
      body.innerHTML = `
        <div class="btn-row"><button class="btn" data-play>${ic('play')} ${sp ? `Continue S${sp.season} E${sp.episode}` : 'Play Now'}</button>
          ${i.youtube_trailer ? `<button class="btn secondary" data-trailer>${ic('circle-play')} Trailer</button>` : ''}</div>
        ${genreChips(i.genre, i.rating)}
        ${plotBlock(i.plot)}
        ${facts([['Director', i.director], ['Cast', i.cast], ['Released', i.releaseDate || i.release_date]])}
        <div class="ep-hdr"><h2>Episode${eps.length === 1 ? '' : 's'}</h2>${info.seasonList.length ? `<button class="season-btn" data-season>Season ${esc(season)} ${ic('chevron-down')}</button>` : ''}</div>
        <div data-eps>${eps.length ? eps.map(ep => {
          const p = User.getProgress('episode', ep.id);
          const pct = User.pct(p);
          const d = User.d.downloads.find(x => x.kind === 'episode' && x.id === ep.id);
          return `<div class="ep" data-ep="${esc(ep.id)}" role="button" tabindex="0">
            <div class="ep-thumb" data-ph="none">${ep.icon ? UI.img(ep.icon, '') : ''}<span class="pl">${ic('play')}</span><span class="eb">E${ep.episode}</span>
              ${pct >= 95 ? `<span class="done">${ic('check')}</span>` : pct > 0 ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
            <div class="ep-info"><h3 class="trunc">Episode ${ep.episode}</h3>
              <div class="dur">${icr('clock')} ${esc(ep.durStr || (ep.dur ? fmtClock(ep.dur) : '—'))}</div>
              <p class="clamp2">${esc(ep.plot || (ep.name && !/^episode \d+$/i.test(ep.name) ? ep.name : ''))}</p></div>
            <button class="cbtn lg" data-epdl="${esc(ep.id)}" aria-label="Download episode ${ep.episode}">${d ? ic('check') : ic('arrow-down')}</button></div>`;
        }).join('') : '<p class="muted">No episodes in this season.</p>'}</div>`;
      wirePlot();
      $('[data-play]', body).onclick = () => App.playSeries(Object.assign({}, item, { name: item.name || i.name, icon: item.icon || i.cover }));
      const tr = $('[data-trailer]', body); if (tr) tr.onclick = () => App.openTrailer(i.youtube_trailer);
      const sb = $('[data-season]', body);
      if (sb) sb.onclick = () => UI.menu(sb, info.seasonList.map(s => ({ label: `Season ${s}`, on: s === season, check: false, icon: s === season ? 'check' : '', onClick: () => { season = s; renderSeries(); } })), { width: '220px' });
      $('[data-eps]', body).onclick = (e) => {
        const dl = e.target.closest('[data-epdl]');
        const card = e.target.closest('[data-ep]');
        if (!card) return;
        const ep = eps.find(x => x.id === card.dataset.ep);
        const meta = { id: item.id, name: item.name || i.name, icon: item.icon || i.cover, cat: item.cat };
        if (dl) { e.stopPropagation(); App.download(ep, 'episode', { title: `${meta.name} S${ep.season}E${ep.episode}`, icon: ep.icon || meta.icon, series: meta.id }); renderSeries(); return; }
        App.Player.play(ep, { kind: 'episode', list: eps, series: meta });
      };
    };
    renderSeries();
    const fetchEpisodes = () => {
      Api.seriesInfo(item.id).then(d => {
        info = d;
        const sp = User.getSeriesProgress(item.id);
        season = sp && d.seasons[String(sp.season)] ? String(sp.season) : d.seasonList[0];
        const i = d.info || {};
        setHero((Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path) || i.cover || item.icon);
        renderSeries();
      }).catch(e => {
        body.innerHTML = `<div class="banner red" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
          <div>${ic('triangle-exclamation')} <span>Could not load episodes: ${esc(e.message)}</span></div>
          <button class="btn sm secondary" data-retry-series>${ic('rotate-right')} Retry</button>
        </div>`;
        const rb = $('[data-retry-series]', body);
        if (rb) rb.onclick = () => { body.innerHTML = `${UI.skeletonRail(1, 600, 64).replace('rail scroll-x', '')}`; fetchEpisodes(); };
      });
    };
    fetchEpisodes();
    const off = Bus.on('progress', () => { if (!el.hidden && info) renderSeries(); });
    return { onHide: off };
  };

  /* ================================================================ Search */
  Router.routes.search = function (el) {
    el.innerHTML = `<div class="screen narrow">
      <h1 class="large-title">Search</h1>
      <div class="field dark" style="margin-top:18px">${ic('magnifying-glass')}<input type="search" data-q placeholder="Search movies, series, channels…" aria-label="Search" enterkeyhint="search"><button class="muted hidden" data-clear aria-label="Clear">${ic('circle-xmark')}</button></div>
      <div data-res></div></div>`;
    const input = $('[data-q]', el);
    const res = $('[data-res]', el);
    const recentHTML = () => {
      const r = User.d.recents;
      if (!r.length) return `<div class="empty" style="padding-top:10vh"><div class="big">${ic('magnifying-glass')}</div><h2>Find anything</h2><p>Search across ${fmtNum(Catalog.counts().movie)} movies, ${fmtNum(Catalog.counts().series)} series and ${fmtNum(Catalog.counts().live)} channels.</p></div>`;
      return `<div class="recent-hdr"><span class="tile round c-accent">${ic('clock-rotate-left')}</span><h2>Recent Searches</h2><button class="pill-btn tint" data-clear-recents>Clear</button></div>
        ${r.map(x => `<div class="recent" data-rec="${x.type}:${esc(x.id)}" role="button" tabindex="0"><div class="thumb${x.type === 'live' ? ' live' : ''}" data-ph="none">${x.icon ? UI.img(x.icon, '') : ''}</div>
          <div class="grow"><h3 class="clamp2">${esc(x.name)}</h3><span class="ty">${ic(App.TYPE_ICON[x.type])} ${App.TYPE_LABEL[x.type]}</span></div>
          <button class="cbtn" data-rm="${x.type}:${esc(x.id)}" aria-label="Remove">${ic('xmark')}</button></div>`).join('')}`;
    };
    const run = () => {
      const q = input.value.trim();
      $('[data-clear]', el).classList.toggle('hidden', !q);
      if (!q) { res.innerHTML = recentHTML(); return; }
      const r = Catalog.search(q);
      const sec = (type, html) => r[type].length ? `<section class="res-sec"><div class="section-hdr"><h2 class="section-title">${App.TYPE_LABEL[type]} <span class="muted" style="font-weight:500">${fmtNum(r[type].total)}</span></h2></div>${html}</section>` : '';
      const out = sec('movie', `<div class="rail scroll-x">${r.movie.map(it => UI.poster(it, { title: true, act: 'result' })).join('')}</div>`)
        + sec('series', `<div class="rail scroll-x">${r.series.map(it => UI.poster(it, { title: true, act: 'result' })).join('')}</div>`)
        + sec('live', `<div class="ch-list">${r.live.slice(0, 30).map(it => `<div class="recent" data-act="result" data-type="live" data-id="${esc(it.id)}" role="button" tabindex="0"><div class="thumb live" data-ph="none">${it.icon ? UI.img(it.icon, '') : ''}</div><div class="grow"><h3 class="trunc">${esc(it.name)}</h3><span class="ty">${ic('tower-broadcast')} ${esc((Catalog.cat('live', it.cat) || {}).name || 'Live')}</span></div></div>`).join('')}</div>`);
      res.innerHTML = out || `<div class="empty" style="padding-top:10vh"><div class="big">${ic('face-meh')}</div><h2>No results</h2><p>Nothing matches “${esc(q)}”. Try another spelling or fewer words.</p></div>`;
    };
    input.addEventListener('input', App.debounce(run, 250));
    $('[data-clear]', el).onclick = () => { input.value = ''; run(); input.focus(); };
    res.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-recents]')) { User.d.recents = []; User.save(); return run(); }
      const rm = e.target.closest('[data-rm]');
      if (rm) { e.stopPropagation(); const [t, id] = rm.dataset.rm.split(':'); User.d.recents = User.d.recents.filter(x => !(x.type === t && x.id === id)); User.save(); return run(); }
      const rec = e.target.closest('[data-rec]');
      if (rec) { const [t, ...rest] = rec.dataset.rec.split(':'); const it = App.findItem(t, rest.join(':')); if (it) { User.addRecent(it); App.openItem(it); } }
    });
    run();
    return { onShow() { run(); if (!matchMedia('(pointer: coarse)').matches || !input.value) setTimeout(() => input.focus({ preventScroll: true }), 80); } };
  };

  App.openItem = function (it) {
    if (it.type === 'live') App.playItem(it);
    else Router.go(`detail/${it.type}/${encodeURIComponent(it.id)}`);
  };
})();
