/* AURA IPTV — screens: EPG, Saved, Profile, Advanced setting, Manage Categories, Connection, data. */
'use strict';
(function () {
  const { $, $$, esc, ic, icr, fmtNum, fmtDate, fmtHM, Sources, Catalog, Api, User, Settings, Bus, Net, UI, Router, haptic, normText } = App;
  const V = App.Views;

  /* ================================================================ EPG */
  const EPG = App.EPG = { engine: null, cur: null };
  EPG.stopMini = function () { if (EPG.engine) EPG.engine.destroy(); };

  Router.routes.epg = function (el) {
    if (!Catalog.ready) { el.innerHTML = `<div class="screen">${UI.empty({ icon: ic('tv'), title: 'No guide yet', msg: 'Import a playlist to see the program guide.' })}</div>`; return; }
    const PPM = 6, HOURS = 12;
    const winStart = (() => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return d.getTime() - 3600e3; })();
    const winEnd = winStart + HOURS * 3600e3;
    const W = HOURS * 60 * PPM;
    const x = (t) => (Math.max(winStart, Math.min(winEnd, t)) - winStart) / 6e4 * PPM;
    const cats = Catalog.cats('live').filter(c => c.count > 0);
    let catId = EPG.catId && (EPG.catId === 'all' || cats.some(c => c.id === EPG.catId)) ? EPG.catId : (cats.find(c => c.id === User.d.liveCat) || cats[0] || {}).id;
    if (!catId) catId = 'all';
    el.innerHTML = `<div class="screen" style="padding-bottom:0">
      <div class="mini-player" data-mini>
        <video playsinline muted></video>
        <div class="state" data-state></div>
        <div class="ch-label trunc" data-chlabel></div>
        <button class="cbtn lg glass vol" data-mute aria-label="Toggle sound">${ic('volume-xmark')}</button>
        <button class="cbtn xl glass pp" data-pp aria-label="Play or pause">${ic('play')}</button>
      </div>
      <div class="epg-hdr"><div><div class="eyebrow">EPG</div><h1 class="title2" style="font-size:30px">Program Guide</h1></div>
        <div class="clock-pill" aria-live="off"><span class="dot"></span><b data-clock></b><span data-date></span></div></div>
      <div class="chips scroll-x" data-chips><button class="chip${catId === 'all' ? ' on' : ''}" data-chip="all">All</button>${cats.map(c => `<button class="chip${c.id === catId ? ' on' : ''}" data-chip="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="guide" data-guide style="--ppm:${PPM}px"><div class="g-inner" data-inner></div></div>
    </div>`;
    const guide = $('[data-guide]', el), inner = $('[data-inner]', el);
    const video = $('video', el);
    const stateEl = $('[data-state]', el);
    EPG.engine = EPG.engine || null;
    const mini = new App.Engine(video, {
      onStatus: (s) => {
        const busy = s === 'loading' || s === 'buffering' || s === 'reconnecting';
        stateEl.className = 'state';
        stateEl.innerHTML = busy ? `${UI.spinner()}<span>CONNECTING...</span>` : '';
        $('[data-pp]', el).innerHTML = video.paused && !busy ? ic('play') : ic('pause');
      },
      onError: () => { stateEl.className = 'state err'; stateEl.innerHTML = `${ic('triangle-exclamation')}<span>Preview unavailable. Tap to open the player.</span>`; $('[data-pp]', el).innerHTML = ic('play'); }
    });
    EPG.engine = mini;
    let list = [];
    const selectChannel = (ch, autoplay = true) => {
      EPG.cur = ch;
      $$('.g-row.sel', inner).forEach(r => r.classList.remove('sel'));
      const row = $(`.g-row[data-row="${CSS.escape(ch.id)}"]`, inner);
      if (row) row.classList.add('sel');
      $('[data-chlabel]', el).textContent = ch.name;
      if (autoplay) mini.load(App.streamCandidates(ch, 'live'), { live: true, mode: Settings.get('player') === 'native' ? 'native' : 'smart' });
    };
    const buildRuler = () => {
      let t = '';
      for (let m = 0; m <= HOURS * 60; m += 30) {
        const ts = winStart + m * 6e4;
        t += `<span class="${new Date(ts).getMinutes() === 0 ? 'hr' : ''}" style="left:${m * PPM}px">${fmtHM(ts)}</span>`;
      }
      return `<div class="g-ruler"><button class="g-corner" data-now title="Jump to now" aria-label="Jump to now">GUIDE</button><div class="g-times" style="width:${W}px">${t}</div></div>`;
    };
    const rowHTML = (ch, i) => {
      const q = App.qualityOf(ch.name);
      return `<div class="g-row" data-row="${esc(ch.id)}">
        <button class="g-ch" data-ch="${esc(ch.id)}" aria-label="${esc(ch.name)}">
          <span class="g-logo" data-ph="letter" data-name="${esc(ch.name)}">${ch.icon ? UI.img(ch.icon, '') : `<span class="letter">${esc(ch.name.charAt(0).toUpperCase())}</span>`}<span class="g-num">${String(ch.num || i + 1).padStart(3, '0')}</span></span>
          <span class="g-chname"><span class="clamp2">${esc(ch.name)}</span>${q ? `<span class="qbadge-outline">${q}</span>` : ''}</span>
        </button>
        <div class="g-progs" data-progs="${esc(ch.id)}" style="width:${W}px"><div class="g-prog none" style="left:2px;width:${W - 4}px"><span style="position:sticky;left:calc(var(--col) + 12px)">Loading…</span></div></div></div>`;
    };
    // EPG requests run 4 at a time, only for rows that are visible.
    const queue = [];
    let active = 0;
    const pump = () => {
      while (active < 4 && queue.length) {
        const ch = queue.shift();
        active++;
        Api.shortEpg(ch).then(progs => paint(ch, progs)).catch(() => paint(ch, [])).finally(() => { active--; pump(); });
      }
    };
    const paint = (ch, progs) => {
      const host = $(`[data-progs="${CSS.escape(ch.id)}"]`, inner);
      if (!host) return;
      const now = Date.now();
      const vis = progs.filter(p => p.end > winStart && p.start < winEnd);
      if (!vis.length) { host.innerHTML = `<div class="g-prog none" style="left:2px;width:${W - 4}px"><span style="position:sticky;left:calc(var(--col) + 12px)">No program information</span></div>`; return; }
      host.innerHTML = vis.map((p, i) => {
        const l = x(p.start), w = Math.max(24, x(p.end) - l - 4);
        const isNow = p.start <= now && p.end > now;
        const pct = isNow ? Math.round((now - p.start) / (p.end - p.start) * 100) : 0;
        return `<button class="g-prog${isNow ? ' now' : ''}" data-prog="${i}" style="left:${l + 2}px;width:${w}px;${isNow ? `--p:${pct}%` : ''}"><div style="position:sticky;left:calc(var(--col) + 10px);max-width:100%"><b>${esc(p.title || 'Untitled')}</b><small>${fmtHM(p.start)} – ${fmtHM(p.end)}</small></div></button>`;
      }).join('');
      host._progs = vis;
    };
    const io = new IntersectionObserver((ents) => {
      ents.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const ch = list.find(c => c.id === e.target.dataset.row);
        if (ch) { queue.push(ch); pump(); }
      });
    }, { root: guide, rootMargin: '300px 0px' });
    let lazy;
    const build = (autoplay) => {
      list = catId === 'all' ? Catalog.items('live') : App.liveList(catId);
      inner.style.width = `calc(var(--col) + ${W}px)`;
      inner.innerHTML = buildRuler() + `<div class="g-now" data-nowline></div>`;
      lazy && lazy.disconnect();
      queue.length = 0;
      if (!list.length) { inner.insertAdjacentHTML('beforeend', `<p class="muted" style="padding:30px">No channels in this category.</p>`); return; }
      let idx = 0;
      lazy = UI.chunked(inner, list, (ch) => rowHTML(ch, idx++), { chunk: 30, root: guide });
      const obs = new MutationObserver(() => $$('.g-row:not([data-obs])', inner).forEach(r => { r.dataset.obs = 1; io.observe(r); }));
      obs.observe(inner, { childList: true });
      $$('.g-row', inner).forEach(r => { r.dataset.obs = 1; io.observe(r); });
      placeNow(true);
      const first = EPG.cur && list.find(c => c.id === EPG.cur.id) || list[0];
      selectChannel(first, autoplay);
    };
    const placeNow = (scroll) => {
      const line = $('[data-nowline]', inner);
      if (!line) return;
      const col = parseFloat(getComputedStyle(guide).getPropertyValue('--col')) || 140;
      const nx = x(Date.now());
      line.style.left = `${col + nx}px`;
      if (scroll) guide.scrollLeft = Math.max(0, nx - (guide.clientWidth - col) * 0.25);
    };
    const tick = () => {
      const d = new Date();
      $('[data-clock]', el).textContent = fmtHM(d);
      $('[data-date]', el).textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '').toUpperCase();
      placeNow(false);
    };
    build(false);
    tick();
    const offProg = Bus.on('progress', () => { if (el.isConnected && !el.hidden && EPG.cur && !App.Player.open) selectChannel(EPG.cur); });
    el.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        catId = EPG.catId = chip.dataset.chip;
        $$('[data-chip]', el).forEach(b => b.classList.toggle('on', b === chip));
        chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        guide.scrollTop = 0;
        EPG.cur = null;
        build(true);
        return;
      }
      const chb = e.target.closest('[data-ch]');
      if (chb) { const ch = list.find(c => c.id === chb.dataset.ch); if (ch) { if (EPG.cur && EPG.cur.id === ch.id) openFull(); else selectChannel(ch); } return; }
      const pb = e.target.closest('[data-prog]');
      if (pb) {
        const row = pb.closest('[data-progs]');
        const ch = list.find(c => c.id === row.dataset.progs);
        return programSheet(ch, row._progs[Number(pb.dataset.prog)]);
      }
      if (e.target.closest('[data-mute]')) { video.muted = !video.muted; $('[data-mute]', el).innerHTML = video.muted ? ic('volume-xmark') : ic('volume-high'); return; }
      if (e.target.closest('[data-pp]')) {
        if (!mini.url || mini.session === 0 || !video.currentSrc && !mini.inst) return EPG.cur && selectChannel(EPG.cur);
        if (video.paused) video.play().catch(() => {}); else video.pause();
        $('[data-pp]', el).innerHTML = video.paused ? ic('play') : ic('pause');
        return;
      }
      if (e.target.closest('[data-now]')) return placeNow(true);
      if (e.target.closest('[data-mini]')) openFull();
    });
    const openFull = () => { if (EPG.cur) { mini.destroy(); App.Player.play(EPG.cur, { kind: 'live', list }); } };
    const programSheet = (ch, p) => {
      const now = Date.now();
      const live = p.start <= now && p.end > now;
      const future = p.start > now;
      UI.sheet({
        label: p.title,
        html: `${UI.sheetHeader({ icon: 'tv', title: p.title || 'Program', sub: `${ch.name} · ${fmtHM(p.start)} – ${fmtHM(p.end)} · ${new Date(p.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` })}
          <div class="sheet-body"><p class="plot" style="margin-top:0">${esc(p.desc || 'No description available.')}</p>
          <div class="btn-row" style="margin-top:22px"><button class="btn" data-watch>${ic('play')} Watch ${live ? 'live' : 'channel'}</button>
          ${future ? `<button class="btn secondary" data-remind>${ic('bell')} Remind me</button>` : ''}</div></div>`,
        mount(ctx) {
          $('[data-watch]', ctx.el).onclick = () => ctx.close(() => { mini.destroy(); App.Player.play(ch, { kind: 'live', list }); });
          const r = $('[data-remind]', ctx.el);
          if (r) r.onclick = async () => {
            try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (_) {}
            const ms = p.start - Date.now() - 60000;
            setTimeout(() => {
              const msg = `${p.title} starts now on ${ch.name}`;
              if ('Notification' in window && Notification.permission === 'granted') new Notification(`${App.BRAND.first} ${App.BRAND.second}`, { body: msg });
              UI.toast(msg, { icon: 'bell', ms: 8000 });
            }, Math.max(0, ms));
            UI.toast('Reminder set — keep this tab open', { icon: 'bell' });
            ctx.close();
          };
        }
      });
    };
    let clock;
    return {
      onShow() {
        tick(); clearInterval(clock); clock = setInterval(tick, 15000);
        if (EPG.cur && !App.Player.open) selectChannel(EPG.cur);
      },
      onHide() { clearInterval(clock); mini.destroy(); if (!el.isConnected) offProg(); }
    };
  };

  /* ================================================================ Saved */
  App.savedTab = 'watchlist';
  App.savedFilter = null;
  Router.routes.saved = function (el) {
    const render = () => {
      const favs = User.d.favorites;
      const tab = App.savedTab;
      const counts = { movie: 0, series: 0, live: 0 };
      favs.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
      let content = '';
      if (tab === 'watchlist') {
        const filt = App.savedFilter;
        content = `<div class="filter3">
          <button class="${filt === 'movie' ? 'on' : ''}" data-f="movie"><span class="dot c-orange"></span>${counts.movie} Movies</button>
          <button class="${filt === 'series' ? 'on' : ''}" data-f="series"><span class="dot c-green"></span>${counts.series} Series</button>
          <button class="${filt === 'live' ? 'on' : ''}" data-f="live"><span class="dot c-blue"></span>${counts.live} Live</button></div>`;
        const shown = favs.filter(f => !filt || f.type === filt);
        if (!shown.length) {
          content += UI.empty({ icon: icr('heart'), title: filt ? `No ${App.TYPE_LABEL[filt].toLowerCase()} saved` : 'Your watchlist is empty', msg: 'Tap the heart on movies, series or channels and they will appear here.' });
        } else {
          for (const t of ['movie', 'series', 'live']) {
            const items = shown.filter(f => f.type === t).map(f => Catalog.item(t, f.id) || { id: f.id, type: t, name: f.name, icon: f.icon, cat: f.cat });
            if (!items.length) continue;
            content += `${!filt ? `<h2 class="section-title" style="margin:8px 0 14px">${App.TYPE_LABEL[t]}</h2>` : ''}
              <div class="${t === 'live' ? 'ch-grid' : 'poster-grid'}" style="margin-bottom:28px">${items.map(it => t === 'live' ? UI.channel(it) : `<div class="poster-wrap" style="position:relative">${UI.poster(it)}<button class="saved-rm" data-rm="${t}:${esc(it.id)}" aria-label="Remove from watchlist">${ic('heart')}</button><p class="poster-title trunc">${esc(it.name)}</p></div>`).join('')}</div>`;
          }
        }
      } else {
        const dl = User.d.downloads;
        content = dl.length ? `<div class="banner blue" style="margin:0 0 18px">${ic('circle-info')}<span>Downloads are saved by your ${Net.isElectron ? 'computer' : 'browser'} to this device's <b>Downloads</b> folder. Open them with VLC or any video player to watch offline.</span></div>
          ${dl.map(d => `<div class="dl-row"><div class="poster" data-ph="poster" data-name="">${d.icon ? UI.img(d.icon, '') : `<div class="ph">${ic('film')}</div>`}</div>
            <div class="grow"><h4 class="clamp2">${esc(d.name)}</h4><p>${d.kind === 'episode' ? 'Episode' : 'Movie'} · ${esc((d.ext || 'mp4').toUpperCase())} · ${esc(fmtDate(d.at))}</p></div>
            <button class="cbtn" data-dlplay="${d.kind}:${esc(d.id)}" aria-label="Play online">${ic('play')}</button>
            <button class="cbtn" data-dlrm="${d.kind}:${esc(d.id)}" aria-label="Remove">${ic('trash-can')}</button></div>`).join('')}`
          : UI.empty({ icon: ic('arrow-down'), title: 'No downloads yet', msg: 'Downloaded movies, series or live channels will appear here.' });
      }
      el.innerHTML = `<div class="bg-navy"><div class="screen">
        <h1 class="large-title">${tab === 'watchlist' ? 'Watchlist' : 'Downloads'}</h1>
        <p class="large-sub">${tab === 'watchlist' ? 'Your saved movies, series and live channels.' : 'Movies, series and live channels saved offline.'}</p>
        <div class="seg-big" role="tablist">
          <button class="${tab === 'watchlist' ? 'on' : ''}" data-tab="watchlist" role="tab"><span class="tile w">${ic('heart')}</span><span class="grow"><b>Watchlist</b><small>${favs.length} saved</small></span></button>
          <button class="${tab === 'downloads' ? 'on' : ''}" data-tab="downloads" role="tab"><span class="tile d">${ic('arrow-down')}</span><span class="grow"><b>Downloads</b><small>Saved locally</small></span></button>
        </div>${content}</div></div>`;
    };
    render();
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { App.savedTab = t.dataset.tab; return render(); }
      const f = e.target.closest('[data-f]');
      if (f) { App.savedFilter = App.savedFilter === f.dataset.f ? null : f.dataset.f; return render(); }
      const rm = e.target.closest('[data-rm]');
      if (rm) { e.stopPropagation(); const [type, ...id] = rm.dataset.rm.split(':'); User.toggleFav({ type, id: id.join(':') }); UI.toast('Removed from Watchlist', { icon: 'heart' }); return render(); }
      const dr = e.target.closest('[data-dlrm]');
      if (dr) { const [k, ...id] = dr.dataset.dlrm.split(':'); User.d.downloads = User.d.downloads.filter(d => !(d.kind === k && d.id === id.join(':'))); User.save(); return render(); }
      const dp = e.target.closest('[data-dlplay]');
      if (dp) {
        const [k, ...rest] = dp.dataset.dlplay.split(':');
        const d = User.d.downloads.find(x => x.kind === k && x.id === rest.join(':'));
        if (k === 'movie') App.Player.play(App.findItem('movie', d.id) || { id: d.id, type: 'movie', name: d.name, icon: d.icon, ext: d.ext }, { kind: 'movie' });
        else if (d.series) App.playSeries(App.findItem('series', d.series) || { id: d.series, type: 'series', name: d.name }, { epId: d.id });
      }
    });
    const offs = [Bus.on('favorites', () => { if (el.isConnected) render(); }), Bus.on('downloads', () => { if (el.isConnected) render(); })];
    return { onShow: render, onHide() {}, _offs: offs };
  };

  /* ================================================================ Profile */
  Router.routes.profile = function (el) {
    const s = Sources.active;
    const render = () => {
      const acc = s.account || {};
      const ui = acc.user || {}, si = acc.server || {};
      const c = Catalog.counts();
      const active = !ui.status || /active/i.test(ui.status);
      const formats = (ui.allowed_output_formats || ['m3u8', 'ts']).map(f => f === 'm3u8' ? 'HLS (.m3u8)' : f === 'ts' ? 'MPEG-TS (.ts)' : f.toUpperCase());
      const fmt = Settings.get('channelFormat') === 'ts' ? 'MPEG-TS (.ts)' : 'HLS (.m3u8)';
      const exp = ui.exp_date ? new Date(Number(ui.exp_date) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unlimited';
      const url = s.type === 'xtream' ? s.server : (s.m3uUrl || s.fileName || 'Local file');
      el.innerHTML = `<div class="screen">
        <div class="acct-card">
          <div class="acct-top"><div class="avatar">${ic('circle-user')}</div>
            <div class="grow"><div class="acct-name"><h2 class="trunc">${esc(s.name || Sources.hostOf(s))}</h2><span class="status-pill${active ? '' : ' bad'}">${esc(s.type === 'm3u' ? 'M3U' : ui.status || 'Active')}</span></div>
              <p class="acct-user trunc">${esc(s.user || 'Playlist')}</p><p class="acct-url trunc">${esc(App.redact(url))}</p></div></div>
          <div class="stat3"><div><b>${fmtNum(c.live)}</b><small><span class="dot c-blue"></span>Live</small></div><div><b>${fmtNum(c.movie)}</b><small><span class="dot c-orange"></span>Movies</small></div><div><b>${fmtNum(c.series)}</b><small><span class="dot c-green"></span>Series</small></div></div>
        </div>
        <div class="settings-card">
          <div class="hd"><span class="tile c-blue">${ic('sliders')}</span><h2>Account Settings</h2><span class="dot c-blue"></span></div>
          ${s.type === 'xtream' ? `<button class="acct-row" data-a="format"><span class="tile c-green">${ic('circle-play')}</span><span class="grow"><h3>Channel format</h3><p>${fmt}</p></span><span class="end">${ic('up-down')}</span></button>` : ''}
          <button class="acct-row" data-a="refresh"><span class="tile c-orange">${ic('rotate-right')}</span><span class="grow"><h3>Refresh ${s.type === 'xtream' ? 'Xtream' : 'playlist'} now</h3><p data-refresh-sub>Last refreshed ${esc(fmtDate(s.lastRefreshed))}</p></span><span class="end" data-refresh-ic>${ic('arrow-right')}</span></button>
          <div class="acct-row" data-bio-row><span class="tile c-purple">${ic('fingerprint')}</span><span class="grow"><h3>Enable ${esc(UI.Bio.label())}</h3><p class="trunc" data-bio-sub>Protect your ${s.type === 'xtream' ? 'Xtream' : ''} dashboard and account privacy.</p></span>
            <label class="toggle"><input type="checkbox" data-bio ${Settings.get('biometric') ? 'checked' : ''} aria-label="Enable ${esc(UI.Bio.label())}"><span></span></label></div>
          <button class="acct-row" data-a="advanced"><span class="tile c-blue">${ic('gears')}</span><span class="grow"><h3>Advanced setting</h3><p>Home and ${s.type === 'xtream' ? 'Xtream' : 'playlist'} content customization</p></span><span class="end">${ic('arrow-right')}</span></button>
        </div>
        ${s.type === 'xtream' ? `
        ${coll('acct', 'c-green', 'id-card', 'Provider Account', `${esc(s.user)} - ${esc(ui.status || 'Active')}`, [
          ['Username', s.user], ['Status', ui.status || '—'], ['Expires', exp], ['Created', ui.created_at ? new Date(Number(ui.created_at) * 1000).toLocaleDateString() : '—'],
          ['Connections', `${ui.active_cons ?? '—'} active of ${ui.max_connections ?? '—'}`], ['Trial', ui.is_trial === '1' || ui.is_trial === 1 ? 'Yes' : 'No']
        ], `<div class="btn-row" style="margin-top:16px"><button class="btn secondary sm" style="flex:1" data-a="switch">${ic('right-left')} Switch playlist</button><button class="btn danger sm" style="flex:1" data-a="logout">${ic('right-from-bracket')} Log out</button></div>`)}
        ${coll('api', 'c-blue', 'circle-play', 'Playback API', `${fmt} preferred - ${formats.join(', ')}`, [
          ['Preferred', fmt], ['Allowed formats', formats.join(', ')], ['Protocol', si.server_protocol || '—'], ['HTTP port', si.port || '—'], ['HTTPS port', si.https_port || '—'], ['RTMP port', si.rtmp_port || '—']
        ])}
        ${coll('server', 'c-blue', 'server', 'Server', Sources.hostOf(s), [
          ['URL', s.server], ['Timezone', si.timezone || '—'], ['Server time', si.time_now || '—'], ['Connection', Net.isElectron ? 'Desktop app (direct)' : Net.hasServer ? 'Built-in proxy server' : Net.proxyTemplate() ? 'Custom CORS proxy' : 'Direct from browser']
        ], `<button class="btn secondary sm" style="margin-top:16px" data-a="test">${ic('signal')} Test connection</button> <span class="muted" data-test-res style="margin-left:10px"></span>`)}`
        : coll('pl', 'c-green', 'list', 'Playlist', s.fileName || Sources.hostOf(s), [['Source', s.m3uUrl ? App.redact(s.m3uUrl) : s.fileName], ['EPG', s.epgUrl || 'None'], ['Channels', fmtNum(c.live)], ['Videos', fmtNum(c.movie + c.series)]],
          `<div class="btn-row" style="margin-top:16px"><button class="btn secondary sm" style="flex:1" data-a="epg">${ic('calendar')} Set EPG URL</button><button class="btn secondary sm" style="flex:1" data-a="switch">${ic('right-left')} Switch playlist</button></div>`)}
        <p class="muted" style="text-align:center;font-size:13px;margin-top:28px">${esc(App.BRAND.first)} ${esc(App.BRAND.second)} · ${Net.isElectron ? 'Desktop' : 'Web'} ${esc(window.auraNative.version || '')} · <a href="#" data-a="shortcuts">Keyboard shortcuts</a></p>
      </div>`;
      UI.Bio.available().then(ok => {
        if (!ok && !Settings.get('biometric')) {
          const inp = $('[data-bio]', el); if (inp) inp.disabled = true;
          const sub = $('[data-bio-sub]', el); if (sub) sub.textContent = 'Not available in this browser or device.';
        }
      });
    };
    const coll = (id, color, icon, title, sub, rows, extra = '') => `<div class="coll" data-coll="${id}">
      <button class="coll-hdr" data-toggle><span class="tile ${color}">${ic(icon)}</span><span class="grow"><h3>${esc(title)}</h3><p class="trunc">${sub}</p></span>${ic('chevron-down')}</button>
      <div class="coll-body">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}${extra}</div></div>`;
    if (!s) return;
    render();
    el.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-bio]')) return;
      const on = e.target.checked;
      e.target.checked = !on;
      try {
        if (on) { await UI.Bio.enroll(); UI.toast(`${UI.Bio.label()} enabled`, { icon: 'fingerprint' }); }
        else { await UI.Bio.verify(); Settings.set('biometric', false); Settings.set('biometricCred', null); UI.toast(`${UI.Bio.label()} disabled`, { icon: 'fingerprint' }); }
        e.target.checked = on;
      } catch (err) { UI.toast(`${UI.Bio.label()} was not confirmed`, { icon: 'triangle-exclamation' }); }
    });
    el.addEventListener('click', async (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) return tg.parentElement.classList.toggle('open');
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.tagName === 'A') e.preventDefault();
      const a = b.dataset.a;
      if (a === 'advanced') V.openAdvanced();
      else if (a === 'switch') Router.go('sources');
      else if (a === 'shortcuts') V.shortcuts();
      else if (a === 'format') {
        const allowed = (s.account && s.account.user && s.account.user.allowed_output_formats) || ['m3u8', 'ts'];
        UI.menu(b, [['m3u8', 'HLS (.m3u8)'], ['ts', 'MPEG-TS (.ts)']].filter(([k]) => allowed.includes(k) || !allowed.length).map(([k, label]) => ({ label, on: Settings.get('channelFormat') === k, check: false, icon: Settings.get('channelFormat') === k ? 'check' : '', onClick: () => { Settings.set('channelFormat', k); render(); } })), { width: '240px' });
      } else if (a === 'refresh') {
        if (b.dataset.busy) return;
        if (s.type === 'm3u' && !s.m3uUrl) return V.addSource(s);
        b.dataset.busy = 1;
        $('[data-refresh-ic]', b).innerHTML = `<span style="display:inline-block;transform:scale(.5);margin:-12px">${UI.spinner()}</span>`;
        const label = { live: 'live', movie: 'movies', series: 'series' };
        try {
          await Catalog.sync(s, (p) => { const sub = $('[data-refresh-sub]', el); if (sub) sub.textContent = `Refreshing ${label[p.type]}… ${p.count ? fmtNum(p.count) : ''}`; });
          haptic(20);
          UI.toast('Library refreshed', { icon: 'circle-check' });
          Router.markDirty('home', 'epg', 'search');
          render();
        } catch (err) {
          UI.toast(`Refresh failed: ${err.message}`, { icon: 'triangle-exclamation', ms: 5000 });
          render();
        }
      } else if (a === 'logout') {
        if (await UI.confirm({ title: 'Log out?', msg: 'This playlist, its library cache and watch history will be removed from this device.', ok: 'Log out', danger: true })) {
          await Sources.remove(s.id);
          if (Sources.active) await V.loadActive();
          Router.markDirty();
          Router.go('sources');
        }
      } else if (a === 'test') {
        const out = $('[data-test-res]', el);
        out.textContent = 'Testing…';
        const t0 = performance.now();
        try { await Api.account(true); out.textContent = `OK · ${Math.round(performance.now() - t0)} ms`; render(); $('[data-coll="server"]', el).classList.add('open'); }
        catch (err) { out.textContent = `Failed: ${err.message}`; }
      } else if (a === 'epg') {
        const v = await UI.prompt({ title: 'EPG / XMLTV URL', value: s.epgUrl || '', placeholder: 'https://example.com/epg.xml' });
        if (v != null) { Sources.update(s.id, { epgUrl: v }); App.Epg.reset(); Router.markDirty('epg'); render(); }
      }
    });
    return {
      onShow() {
        if (s.type === 'xtream') Api.account().then(() => { if (!el.hidden) render(); }).catch(() => {});
        else render();
      }
    };
  };

  /* ================================================================ Advanced setting */
  V.openAdvanced = function (focus) {
    const hiddenCount = () => Object.keys(User.d.hidden || {}).length;
    const lockedCount = () => Object.keys(User.d.locked || {}).length;
    const catSub = () => !hiddenCount() && !lockedCount() ? 'All categories visible' : [hiddenCount() && `${hiddenCount()} hidden`, lockedCount() && `${lockedCount()} locked`].filter(Boolean).join(' · ');
    const body = () => {
      const st = Settings.data;
      return `
      <div class="set-card"><button class="set-row" data-s="cats"><span class="tile c-teal">${ic('table-cells-large')}</span><span class="grow"><h3>Manage Categories</h3><p>${catSub()}</p></span><span class="chev">${ic('chevron-right')}</span></button></div>
      <div class="set-card"><button class="set-row" data-s="pin"><span class="tile c-red">${ic(UI.Pin.isSet ? 'lock' : 'lock-open')}</span><span class="grow"><h3>Content PIN</h3><p>${UI.Pin.isSet ? 'On — locked categories need your PIN' : 'Off — set a PIN to lock categories'}</p></span><span class="chev">${ic('chevron-right')}</span></button></div>
      <div class="set-card"><div class="set-row"><span class="tile c-accent">${ic('palette')}</span><span class="grow"><h3>App theme</h3><p>Apply a bold entertainment color across the UI.</p></span></div>
        <div class="theme-grid">${App.THEMES.map(t => `<button class="opt${st.theme === t.id ? ' on' : ''}" data-th="${t.id}"><span class="tile solid ${t.cls}">${ic(st.theme === t.id ? 'check' : t.icon)}</span><span class="grow" style="min-width:0"><h4 class="trunc">${t.name}</h4><p class="trunc">${t.sub}</p></span></button>`).join('')}</div></div>
      <div class="set-card"><div class="set-row"><span class="tile c-orange">${ic('wand-magic-sparkles')}</span><span class="grow"><h3>Allow Fresh Arrivals</h3><p>Show the latest 20 movies or series below the hero.</p></span>${tog('freshArrivals')}</div></div>
      <div class="set-card"><div class="set-row"><span class="tile c-blue">${ic('house-chimney')}</span><span class="grow"><h3>Load content by default</h3><p>Choose the Home tab type that opens first.</p></span></div>
        <div class="seg3" style="margin-top:16px">${[['live', 'Live'], ['movie', 'Movies'], ['series', 'Series']].map(([k, l]) => `<button class="${st.homeType === k ? 'on' : ''}" data-home="${k}">${l}</button>`).join('')}</div></div>
      <div class="set-card"><div class="set-row"><span class="tile c-blue">${ic('photo-film')}</span><span class="grow"><h3>Default player</h3><p>Pick the player used every time you watch.</p></span></div>
        <div class="opt-list">${App.PLAYERS.map(p => `<button class="opt${st.player === p.id ? ' on' : ''}" data-player="${p.id}"><span class="tile ${st.player === p.id ? 'solid c-accent' : 'c-gray'}">${ic(st.player === p.id ? 'check' : p.icon)}</span><span class="grow"><h4>${p.name}${p.recommended ? ' <span class="badge pill" style="height:24px;font-size:12px">Recommended</span>' : ''}</h4><p>${p.sub}</p></span></button>`).join('')}</div></div>
      <div class="set-card"><button class="set-row" data-s="refresh"><span class="tile c-blue">${ic('arrows-rotate')}</span><span class="grow"><h3>Auto refresh in</h3><p>${(App.REFRESH.find(r => r.id === st.autoRefresh) || App.REFRESH[3]).label}</p></span><span class="chev">${ic('up-down')}</span></button></div>
      <div class="set-card"><div class="set-row"><span class="tile c-blue">${ic('clone')}</span><span class="grow"><h3>Show currently playing</h3><p>Show your in-progress content row when watch progress exists.</p></span>${tog('continuePlaying')}</div></div>
      <div class="set-card"><div class="set-row"><span class="tile c-magenta">${ic('layer-group')}</span><span class="grow"><h3>Hero carousel</h3><p>Keep the large poster carousel on the Home tab.</p></span>${tog('heroCarousel')}</div></div>
      <div class="set-card" data-section="connection"><button class="set-row" data-s="connection"><span class="tile c-green">${ic('shield-halved')}</span><span class="grow"><h3>Connection</h3><p>${Net.isElectron ? 'Desktop app — direct provider access' : Net.hasServer ? 'Built-in proxy server detected' : Net.proxyTemplate() ? 'Custom CORS proxy configured' : 'Direct from browser · add a proxy for http:// providers'}</p></span><span class="chev">${ic('chevron-right')}</span></button></div>
      <div class="set-card"><button class="set-row" data-s="data"><span class="tile c-gray">${ic('database')}</span><span class="grow"><h3>Backup &amp; data</h3><p>Export, import or erase everything on this device</p></span><span class="chev">${ic('chevron-right')}</span></button></div>
      <div class="set-card"><button class="set-row" data-s="playlists"><span class="tile c-blue">${ic('list')}</span><span class="grow"><h3>Playlists</h3><p>${Sources.list.length} source${Sources.list.length === 1 ? '' : 's'} · add or switch</p></span><span class="chev">${ic('chevron-right')}</span></button></div>`;
    };
    const tog = (k) => `<label class="toggle"><input type="checkbox" data-tog="${k}" ${Settings.get(k) ? 'checked' : ''} aria-label="${k}"><span></span></label>`;
    UI.sheet({
      full: true, label: 'Advanced setting',
      html: `<div class="grabber"></div><div class="sheet-hdr" style="padding-bottom:12px"><div class="grow"><h2 class="title1">Advanced setting</h2><p>Customize how ${Sources.active && Sources.active.type === 'xtream' ? 'Xtream' : 'your'} Home and content sections appear.</p></div><button class="cbtn lg" data-close aria-label="Close">${ic('xmark')}</button></div><div class="sheet-body" data-body>${body()}</div>`,
      mount(ctx) {
        const host = $('[data-body]', ctx.el);
        const rerender = () => { const y = host.scrollTop; host.innerHTML = body(); host.scrollTop = y; };
        if (focus) setTimeout(() => { const t = $(`[data-section="${focus}"]`, host); if (t) t.scrollIntoView({ block: 'center' }); if (focus === 'connection') V.connectionSheet(); }, 350);
        host.addEventListener('change', (e) => {
          const k = e.target.dataset.tog;
          if (!k) return;
          Settings.set(k, e.target.checked); haptic();
          Router.markDirty('home');
        });
        host.addEventListener('click', async (e) => {
          const th = e.target.closest('[data-th]');
          if (th) { Settings.set('theme', th.dataset.th); haptic(); return rerender(); }
          const hm = e.target.closest('[data-home]');
          if (hm) { Settings.set('homeType', hm.dataset.home); App.homeType = hm.dataset.home; Router.markDirty('home'); haptic(); return rerender(); }
          const pl = e.target.closest('[data-player]');
          if (pl) { Settings.set('player', pl.dataset.player); haptic(); return rerender(); }
          const s = e.target.closest('[data-s]');
          if (!s) return;
          const a = s.dataset.s;
          if (a === 'cats') V.manageCategories(App.homeType, rerender);
          else if (a === 'pin') { await V.pinSettings(); rerender(); }
          else if (a === 'refresh') UI.menu(s, App.REFRESH.map(r => ({ label: r.label, on: Settings.get('autoRefresh') === r.id, check: false, icon: Settings.get('autoRefresh') === r.id ? 'check' : '', onClick: () => { Settings.set('autoRefresh', r.id); rerender(); } })), { width: '240px' });
          else if (a === 'connection') V.connectionSheet(rerender);
          else if (a === 'data') V.dataSheet();
          else if (a === 'playlists') ctx.close(() => Router.go('sources'));
        });
      }
    });
  };

  V.pinSettings = async function () {
    if (!UI.Pin.isSet) return UI.Pin.setup();
    return new Promise((resolve) => {
      UI.sheet({
        center: true, label: 'Content PIN',
        html: `${UI.sheetHeader({ icon: 'lock', title: 'Content PIN', sub: 'Locked categories need this PIN' })}<div class="sheet-body">
          <button class="dev-row" data-p="change"><span class="tile">${ic('key')}</span><span class="grow"><h4>Change PIN</h4><p>Set a new 4-digit PIN</p></span></button>
          <button class="dev-row" data-p="off"><span class="tile c-red">${ic('lock-open')}</span><span class="grow"><h4>Turn off PIN</h4><p>Also unlocks all locked categories</p></span></button></div>`,
        mount(ctx) {
          ctx.el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-p]');
            if (!b) return;
            ctx.close(async () => {
              if (!await UI.Pin.verify('Enter your current PIN')) return resolve();
              if (b.dataset.p === 'change') await UI.Pin.setup();
              else { Settings.set('pinHash', null); User.d.locked = {}; User.save(); App.unlocked = false; Router.markDirty('home', 'epg', 'search'); UI.toast('Content PIN is off', { icon: 'lock-open' }); }
              resolve();
            });
          });
        },
        onClose: () => setTimeout(resolve, 600)
      });
    });
  };

  /* ---------------------------------------------------------------- manage categories */
  V.manageCategories = function (startType = App.homeType, onDone) {
    let type = startType, q = '';
    const open = new Set();
    let changed = false;
    const summary = () => {
      const cats = Catalog.data[type].cats;
      const hidden = cats.filter(c => User.isHidden(type, c.id)).length;
      const locked = cats.filter(c => User.isLocked(type, c.id)).length;
      return `${fmtNum(cats.length - hidden)} shown · ${hidden} hidden · ${locked} locked`;
    };
    const list = () => {
      const nq = normText(q);
      const groups = Catalog.groups(type, { includeHidden: true }).map(g => ({ name: g.name, cats: nq ? g.cats.filter(c => normText(c.name).includes(nq)) : g.cats })).filter(g => g.cats.length);
      if (!groups.length) return `<p class="muted" style="text-align:center;padding:30px 0">No categories${q ? ` match “${esc(q)}”` : ''}.</p>`;
      return groups.map(g => {
        const allHidden = g.cats.every(c => User.isHidden(type, c.id));
        const someHidden = g.cats.some(c => User.isHidden(type, c.id));
        const allLocked = g.cats.every(c => User.isLocked(type, c.id));
        const isOpen = open.has(g.name) || !!nq;
        return `<div class="mg${isOpen ? ' open' : ''}${allHidden ? ' dim' : ''}" data-g="${esc(g.name)}">
          <div class="mg-row"><button data-exp>${ic('chevron-right')}<span class="grow" style="min-width:0"><h4 class="trunc">${esc(g.name)}</h4><p>${g.cats.length} categor${g.cats.length === 1 ? 'y' : 'ies'}${someHidden && !allHidden ? ' · some hidden' : ''}</p></span></button>
            <button class="cbtn${allHidden ? ' off-eye' : ''}" data-geye aria-label="${allHidden ? 'Show' : 'Hide'} ${esc(g.name)}">${ic(allHidden ? 'eye-slash' : 'eye')}</button>
            <button class="cbtn${allLocked ? ' on-lock' : ''}" data-glock aria-label="${allLocked ? 'Unlock' : 'Lock'} ${esc(g.name)}">${ic(allLocked ? 'lock' : 'lock-open')}</button></div>
          <div class="mg-subs">${g.cats.map(c => {
            const h = User.isHidden(type, c.id), l = User.isLocked(type, c.id);
            return `<div class="mg-sub${h ? ' dim' : ''}" data-c="${esc(c.id)}"><h5 class="trunc">${esc(c.label || c.name)} <span class="muted" style="font-size:14px">${fmtNum(c.count)}</span></h5>
              <button class="cbtn${h ? ' off-eye' : ''}" data-ceye aria-label="${h ? 'Show' : 'Hide'} ${esc(c.name)}">${ic(h ? 'eye-slash' : 'eye')}</button>
              <button class="cbtn${l ? ' on-lock' : ''}" data-clock aria-label="${l ? 'Unlock' : 'Lock'} ${esc(c.name)}">${ic(l ? 'lock' : 'lock-open')}</button></div>`;
          }).join('')}</div></div>`;
      }).join('');
    };
    const shell = () => `
      <div class="tabs3">${[['live', 'tv', 'Live'], ['movie', 'film', 'Movies'], ['series', 'layer-group', 'Series']].map(([k, i, l]) => `<button class="${type === k ? 'on' : ''}" data-type="${k}">${ic(i)} ${l}</button>`).join('')}</div>
      <div class="field" style="margin-bottom:18px">${ic('magnifying-glass')}<input type="search" placeholder="Search categories" data-q value="${esc(q)}" aria-label="Search categories"></div>
      <p class="muted" style="font-size:17px;margin:0 2px 16px" data-sum>${summary()}</p><div data-list>${list()}</div>`;
    UI.sheet({
      full: true, label: 'Manage Categories',
      html: `<div class="grabber"></div><div class="sheet-hdr"><div class="grow"><h2 class="title1">Manage Categories</h2><p>Hide what you never watch, lock what others shouldn't see.</p></div><button class="cbtn lg" data-close aria-label="Close">${ic('xmark')}</button></div><div class="sheet-body" data-body>${shell()}</div>`,
      mount(ctx) {
        const host = $('[data-body]', ctx.el);
        const refresh = () => { const y = host.scrollTop; $('[data-list]', host).innerHTML = list(); $('[data-sum]', host).textContent = summary(); host.scrollTop = y; };
        host.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; refresh(); } });
        const needPinToLock = async () => UI.Pin.isSet || await UI.Pin.setup();
        host.addEventListener('click', async (e) => {
          const t = e.target.closest('[data-type]');
          if (t) { type = t.dataset.type; open.clear(); host.innerHTML = shell(); return; }
          const g = e.target.closest('[data-g]');
          if (!g) return;
          const group = Catalog.groups(type, { includeHidden: true }).find(x => x.name === g.dataset.g);
          if (e.target.closest('[data-exp]')) { open.has(group.name) ? open.delete(group.name) : open.add(group.name); g.classList.toggle('open'); return; }
          const sub = e.target.closest('[data-c]');
          const targets = sub ? [sub.dataset.c] : group.cats.map(c => c.id);
          if (e.target.closest('[data-geye], [data-ceye]')) {
            const hide = sub ? !User.isHidden(type, sub.dataset.c) : !group.cats.every(c => User.isHidden(type, c.id));
            targets.forEach(id => User.setHidden(type, id, hide));
          } else if (e.target.closest('[data-glock], [data-clock]')) {
            const lock = sub ? !User.isLocked(type, sub.dataset.c) : !group.cats.every(c => User.isLocked(type, c.id));
            if (lock && !await needPinToLock()) return;
            if (!lock && !await UI.Pin.verify('Enter your PIN to unlock')) return;
            targets.forEach(id => User.setLocked(type, id, lock));
          } else return;
          haptic(); changed = true; refresh();
        });
      },
      onClose: () => { if (changed) { Router.markDirty('home', 'epg', 'search', 'saved'); } onDone && onDone(); }
    });
  };

  /* ---------------------------------------------------------------- connection / proxy */
  V.connectionSheet = function (onDone) {
    const env = Net.isElectron ? 'Desktop app — the provider is reached directly, no proxy needed.'
      : Net.hasServer ? 'Built-in proxy server detected (server.js) — streams and API calls are relayed automatically.'
        : Net.isGitHubPages ? 'GitHub Pages — static HTTPS hosting with no server. http:// providers need a CORS proxy.'
          : `${location.protocol === 'https:' ? 'HTTPS' : 'HTTP'} static hosting with no proxy server detected.`;
    UI.sheet({
      full: true, label: 'Connection',
      html: `${UI.sheetHeader({ icon: 'shield-halved', title: 'Connection', sub: 'How this app reaches your provider' })}<div class="sheet-body">
        <div class="banner blue" style="margin-top:0">${ic('circle-info')}<span>${esc(env)}</span></div>
        <label class="label">CORS proxy URL</label>
        <div class="field">${ic('link')}<input data-proxy value="${esc(Net.proxyTemplate())}" placeholder="https://my-proxy.workers.dev/?url=%s" inputmode="url" autocomplete="off"></div>
        <p class="muted" style="font-size:14px;line-height:1.5;margin:10px 4px 0">Use <code>%s</code> where the encoded target URL goes, or give a prefix and the URL is appended. Deploy your own free proxy with <code>docs/cloudflare-worker-proxy.js</code> or run <code>server.js</code> — see <code>docs/PROXY.md</code>. Your credentials pass through this proxy, so only use one you control.</p>
        <div class="set-card" style="margin-top:18px"><div class="set-row"><span class="tile c-blue">${ic('image')}</span><span class="grow"><h3>Proxy posters &amp; logos</h3><p>Load http:// artwork through the proxy</p></span><label class="toggle"><input type="checkbox" data-pimg ${localStorage.getItem('aura_proxy_images') === '1' ? 'checked' : ''}><span></span></label></div></div>
        <div class="set-card"><div class="set-row"><span class="tile c-orange">${ic('route')}</span><span class="grow"><h3>Proxy all streams</h3><p>Also relay https:// streams (for providers without CORS)</p></span><label class="toggle"><input type="checkbox" data-pall ${localStorage.getItem('aura_proxy_all') === '1' ? 'checked' : ''}><span></span></label></div></div>
        <div class="btn-row" style="margin-top:8px"><button class="btn secondary" data-test>${ic('signal')} Test</button><button class="btn" data-save>Save</button></div>
        <p class="muted" data-res style="margin-top:14px;text-align:center"></p></div>`,
      mount(ctx) {
        const save = () => {
          const v = $('[data-proxy]', ctx.el).value.trim();
          if (v) localStorage.setItem('aura_custom_proxy', v); else localStorage.removeItem('aura_custom_proxy');
          localStorage.setItem('aura_proxy_images', $('[data-pimg]', ctx.el).checked ? '1' : '0');
          localStorage.setItem('aura_proxy_all', $('[data-pall]', ctx.el).checked ? '1' : '0');
        };
        $('[data-test]', ctx.el).onclick = async () => {
          save();
          const res = $('[data-res]', ctx.el);
          const s = Sources.active;
          res.textContent = 'Testing…';
          try {
            if (s && s.type === 'xtream') { await Api.account(true); res.innerHTML = `<span style="color:var(--green)">${ic('circle-check')} Provider reachable</span>`; }
            else if (Net.proxyTemplate()) { const r = await fetch(Net.wrapCustom('https://example.com/'), { signal: AbortSignal.timeout(10000) }); res.innerHTML = r.ok ? `<span style="color:var(--green)">${ic('circle-check')} Proxy responded</span>` : `Proxy returned HTTP ${r.status}`; }
            else res.textContent = 'Add a proxy URL or a playlist to test.';
          } catch (e) { res.innerHTML = `<span style="color:#ff6b61">${ic('triangle-exclamation')} ${esc(e.message)}</span>`; }
        };
        $('[data-save]', ctx.el).onclick = () => { save(); UI.toast('Connection settings saved', { icon: 'shield-halved' }); Router.markDirty(); ctx.close(); };
      },
      onClose: () => onDone && onDone()
    });
  };

  /* ---------------------------------------------------------------- backup & data */
  V.dataSheet = function () {
    UI.sheet({
      center: true, label: 'Backup & data',
      html: `${UI.sheetHeader({ icon: 'database', title: 'Backup & data', sub: 'Everything is stored only in this browser' })}<div class="sheet-body">
        <button class="dev-row" data-d="export"><span class="tile">${ic('file-export')}</span><span class="grow"><h4>Export backup</h4><p>Playlists, settings, watchlist and progress (.json)</p></span></button>
        <label class="dev-row" style="cursor:pointer"><span class="tile">${ic('file-import')}</span><span class="grow"><h4>Import backup</h4><p>Restore from an exported .json file</p></span><input type="file" accept="application/json,.json" data-d-import hidden></label>
        <button class="dev-row" data-d="erase"><span class="tile c-red">${ic('trash-can')}</span><span class="grow"><h4 style="color:#ff6b61">Erase everything</h4><p>Remove all playlists, cache and history</p></span></button></div>`,
      mount(ctx) {
        ctx.el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-d]');
          if (!b) return;
          if (b.dataset.d === 'export') {
            const dump = {};
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^aura/.test(k)) dump[k] = localStorage.getItem(k); }
            const blob = new Blob([JSON.stringify({ app: 'aura-iptv', v: 3, at: Date.now(), data: dump }, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `aura-iptv-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            UI.toast('Backup exported — it contains your provider passwords, keep it private', { icon: 'file-export', ms: 4500 });
          } else if (b.dataset.d === 'erase') {
            if (!await UI.confirm({ title: 'Erase everything?', msg: 'All playlists, cached libraries, settings, watchlist and progress will be deleted from this browser.', ok: 'Erase', danger: true })) return;
            Object.keys(localStorage).filter(k => /^aura/.test(k)).forEach(k => localStorage.removeItem(k));
            await App.IDB.clear();
            location.hash = '';
            location.reload();
          }
        });
        $('[data-d-import]', ctx.el).addEventListener('change', (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = async () => {
            try {
              const j = JSON.parse(r.result);
              if (j.app !== 'aura-iptv' || !j.data) throw new Error('Not an AURA backup file');
              if (!await UI.confirm({ title: 'Restore backup?', msg: 'Current settings and playlists will be replaced. Libraries are re-imported after restore.', ok: 'Restore' })) return;
              Object.entries(j.data).forEach(([k, v]) => localStorage.setItem(k, v));
              await App.IDB.clear();
              location.reload();
            } catch (err) { UI.toast(err.message, { icon: 'triangle-exclamation' }); }
          };
          r.readAsText(f);
        });
      }
    });
  };

  V.shortcuts = function () {
    const rows = [['Space / K', 'Play or pause'], ['← / →', 'Seek 10 seconds'], ['↑ / ↓', 'Volume'], ['M', 'Mute'], ['F', 'Full screen'], ['P', 'Picture in Picture'], ['N / Page Down', 'Next channel or episode'], ['B / Page Up', 'Previous channel or episode'], ['0–9', 'Jump to channel number (live)'], ['Esc', 'Close player or sheet'], ['/', 'Search']];
    UI.sheet({ center: true, label: 'Keyboard shortcuts', html: `${UI.sheetHeader({ icon: 'keyboard', title: 'Keyboard shortcuts' })}<div class="sheet-body"><div class="kbd-list">${rows.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div></div>` });
  };
})();
