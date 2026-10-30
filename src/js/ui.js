/* AURA IPTV — UI framework: router, overlays (sheets/menus) with back-button support,
   toasts, shared renderers, PIN pad, device-biometric lock. */
'use strict';
(function () {
  const { $, $$, esc, ic, icr, Settings, Bus, User, Net, haptic } = App;
  const UI = App.UI = {};

  /* ---------------------------------------------------------------- toast */
  UI.toast = function (msg, { icon = 'circle-info', ms = 2600 } = {}) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${ic(icon)}<span>${esc(msg)}</span>`;
    root.appendChild(el);
    while (root.children.length > 3) root.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
  };

  /* ---------------------------------------------------------------- overlay history */
  // Every sheet / the player pushes a history entry so the Android back button and the
  // iOS edge-swipe close the top overlay instead of leaving the app.
  const stack = [];
  let afterPop = [];
  const Overlay = UI.Overlay = {
    push(closeFn) {
      const entry = { closeFn };
      stack.push(entry);
      try { history.pushState({ aura: 'ov', n: stack.length }, ''); } catch (_) {}
      return entry;
    },
    // Close via UI: go back one entry; popstate performs the actual close.
    close(entry, then) {
      if (then) afterPop.push(then);
      if (stack[stack.length - 1] === entry) history.back();
      else {
        const i = stack.indexOf(entry);
        if (i > -1) { stack.splice(i, 1); entry.closeFn(); }
        const fns = afterPop; afterPop = []; fns.forEach(f => f());
      }
    },
    get depth() { return stack.length; },
    closeAll() { while (stack.length) { const e = stack.pop(); e.closeFn(); } }
  };
  window.addEventListener('popstate', () => {
    if (stack.length) {
      const e = stack.pop();
      e.closeFn();
      const fns = afterPop; afterPop = [];
      setTimeout(() => fns.forEach(f => f()), 0);
    }
  });

  /* ---------------------------------------------------------------- sheets */
  UI.sheetHeader = function ({ icon, iconHTML, title, sub, close = true, dark = false }) {
    return `<div class="grabber"></div>
      <div class="sheet-hdr">
        ${icon || iconHTML ? `<div class="cbtn xl" style="background:${dark ? '#2a2a2e' : 'var(--s3)'}">${iconHTML || ic(icon)}</div>` : ''}
        <div class="grow"><h2 class="title1" style="font-size:${icon || iconHTML ? 30 : 32}px">${esc(title)}</h2>${sub ? `<p data-sub>${esc(sub)}</p>` : ''}</div>
        ${close ? `<button class="cbtn lg" data-close aria-label="Close">${ic('xmark')}</button>` : ''}
      </div>`;
  };

  UI.sheet = function ({ html = '', full = false, center = false, dark = false, onClose, mount, label = 'Dialog' } = {}) {
    const layer = document.createElement('div');
    layer.className = `sheet-layer${center ? ' center' : ''}`;
    layer.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet${full ? ' full' : ''}${dark ? ' dark' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
    document.body.appendChild(layer);
    document.body.classList.add('no-scroll');
    const panel = $('.sheet', layer);
    let closed = false;
    const ctx = {
      el: panel, layer,
      close(then) { if (!closed) Overlay.close(entry, then); else if (then) then(); },
      set(html2) { panel.innerHTML = html2; }
    };
    const entry = Overlay.push(() => {
      closed = true;
      layer.classList.add('closing');
      setTimeout(() => { layer.remove(); if (!$('.sheet-layer') && !$('#player.open')) document.body.classList.remove('no-scroll'); }, 260);
      onClose && onClose();
    });
    layer.addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-close]')) ctx.close();
    });
    // Drag the grabber/header down to dismiss.
    let y0 = null, dy = 0;
    panel.addEventListener('pointerdown', (e) => { if (e.target.closest('.grabber, .sheet-hdr') && !e.target.closest('button')) { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; } });
    window.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
    window.addEventListener('pointerup', () => { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 110) ctx.close(); else panel.style.transform = ''; });
    mount && mount(ctx);
    const focusable = panel.querySelector('input:not([type=hidden]), button:not([data-close])');
    if (focusable && !('ontouchstart' in window)) setTimeout(() => focusable.focus({ preventScroll: true }), 60);
    return ctx;
  };

  UI.confirm = function ({ title, msg, ok = 'Confirm', danger = false, cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      let result = false;
      UI.sheet({
        center: true, label: title,
        html: `<div style="padding:26px 24px 22px">
          <h2 class="title2" style="margin-bottom:10px">${esc(title)}</h2>
          <p class="muted" style="margin:0 0 22px;line-height:1.45">${esc(msg)}</p>
          <div class="btn-row"><button class="btn secondary" data-close style="height:52px;font-size:17px">${esc(cancel)}</button>
          <button class="btn ${danger ? 'danger' : ''}" data-ok style="height:52px;font-size:17px">${esc(ok)}</button></div></div>`,
        mount(ctx) { $('[data-ok]', ctx.el).onclick = () => { result = true; ctx.close(); }; },
        onClose: () => resolve(result)
      });
    });
  };

  UI.prompt = function ({ title, value = '', placeholder = '', ok = 'Save' }) {
    return new Promise((resolve) => {
      let result = null;
      UI.sheet({
        center: true, label: title,
        html: `<form style="padding:26px 24px 22px">
          <h2 class="title2" style="margin-bottom:16px">${esc(title)}</h2>
          <div class="field"><input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></div>
          <div class="btn-row" style="margin-top:18px"><button type="button" class="btn secondary" data-close style="height:52px;font-size:17px">Cancel</button>
          <button class="btn" style="height:52px;font-size:17px">${esc(ok)}</button></div></form>`,
        mount(ctx) { $('form', ctx.el).onsubmit = (e) => { e.preventDefault(); result = e.target.v.value.trim(); ctx.close(); }; },
        onClose: () => resolve(result)
      });
    });
  };

  /* ---------------------------------------------------------------- menus */
  UI.menu = function (anchor, items, { align = 'right', width } = {}) {
    const layer = document.createElement('div');
    layer.className = 'menu-layer';
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    if (width) menu.style.width = width;
    menu.innerHTML = items.map((it, i) => it.sep ? '<div class="menu-sep"></div>' : `
      <button class="menu-item${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}">
        ${it.tile ? `<span class="tile ${it.tile}">${ic(it.icon)}</span>` : it.icon ? `<span class="ic">${ic(it.icon)}</span>` : ''}
        <span class="grow trunc">${esc(it.label)}</span>
        ${it.on && it.check !== false ? `<span class="check" style="${it.checkColor ? `--c:${it.checkColor}` : ''}">${ic('check')}</span>` : ''}
        ${it.chevron ? `<span class="muted">${ic('chevron-right')}</span>` : ''}
      </button>`).join('');
    layer.appendChild(menu);
    document.body.appendChild(layer);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let top = r.bottom + 10;
    if (top + mh > innerHeight - 10) top = Math.max(10, r.top - mh - 10);
    let left = align === 'right' ? r.right - mw : r.left;
    left = Math.max(12, Math.min(left, innerWidth - mw - 12));
    menu.style.top = `${top}px`; menu.style.left = `${left}px`;
    const close = () => { layer.remove(); document.removeEventListener('keydown', onKey); anchor.classList.remove('open'); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    anchor.classList.add('open');
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      close();
      if (b) { const it = items[+b.dataset.i]; haptic(); it.onClick && it.onClick(); }
    });
    return { close };
  };

  /* ---------------------------------------------------------------- shared renderers */
  UI.img = function (url, alt = '', cls = '') {
    if (!url) return '';
    return `<img src="${esc(Net.image(url))}" alt="${esc(alt)}" class="${cls}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="App.UI.imgErr(this)">`;
  };
  UI.imgErr = function (img) {
    const box = img.parentElement;
    const kind = box && box.dataset.ph;
    img.remove();
    if (box && kind === 'letter') box.insertAdjacentHTML('afterbegin', `<span class="letter">${esc((box.dataset.name || '?').trim().charAt(0).toUpperCase())}</span>`);
    else if (box && kind !== 'none') box.insertAdjacentHTML('afterbegin', `<div class="ph">${ic(kind === 'episode' ? 'circle-play' : 'film')}${box.dataset.name ? `<span class="clamp3">${esc(box.dataset.name)}</span>` : ''}</div>`);
  };
  UI.poster = function (item, { prog = 0, title = false, cls = '', act = 'open' } = {}) {
    const inner = item.icon ? UI.img(item.icon, item.name) : `<div class="ph">${ic(item.type === 'series' ? 'layer-group' : 'film')}<span class="clamp3">${esc(item.name)}</span></div>`;
    const p = `<div class="poster ${cls}" data-act="${act}" data-type="${item.type}" data-id="${esc(item.id)}" data-ph="poster" data-name="${esc(item.name)}" role="button" tabindex="0" aria-label="${esc(item.name)}">
      ${inner}${prog ? `<div class="prog"><i style="width:${prog}%"></i></div>` : ''}</div>`;
    return title ? `<div class="poster-wrap">${p}<p class="poster-title trunc">${esc(item.name)}</p></div>` : p;
  };
  UI.channel = function (item) {
    const fav = User.isFav('live', item.id);
    const q = App.qualityOf(item.name);
    return `<div class="ch" data-act="play" data-type="live" data-id="${esc(item.id)}" role="button" tabindex="0" aria-label="${esc(item.name)}">
      <div class="ch-tile" data-ph="letter" data-name="${esc(item.name)}">
        ${item.icon ? UI.img(item.icon, '') : `<span class="letter">${esc(item.name.trim().charAt(0).toUpperCase() || '?')}</span>`}
        <button class="fav${fav ? ' on' : ''}" data-act="fav" data-type="live" data-id="${esc(item.id)}" aria-label="${fav ? 'Remove from' : 'Add to'} watchlist">${fav ? ic('heart') : icr('heart')}</button>
        ${q ? `<span class="qbadge">${q}</span>` : ''}
      </div>
      <p class="ch-name trunc">${esc(item.name)}</p></div>`;
  };
  UI.empty = function ({ icon, title, msg, action }) {
    return `<div class="empty"><div class="big">${icon}</div><h2>${esc(title)}</h2><p>${esc(msg)}</p>${action || ''}</div>`;
  };
  UI.skeletonRail = (n = 6, w = 170, h = 255) => `<div class="rail scroll-x">${Array.from({ length: n }, () => `<div class="sk" style="flex:0 0 ${w}px;height:${h}px;border-radius:20px"></div>`).join('')}</div>`;
  UI.spinner = () => `<div class="spinner">${Array.from({ length: 8 }, (_, i) => `<i style="transform:rotate(${i * 45}deg);animation-delay:${-1 + i / 8}s"></i>`).join('')}</div>`;
  UI.airplayIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><path d="m12 15 5 6H7z" fill="currentColor"/></svg>`;
  UI.gridIcon = `<svg viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="7.5" height="18" rx="2.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.4" opacity=".8"/></svg>`;

  /* Lazy chunked list rendering: renders `chunk` items at a time as the sentinel scrolls into view. */
  UI.chunked = function (container, items, renderFn, { chunk = 60, root = null } = {}) {
    let i = 0;
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:1px;grid-column:1/-1';
    const more = () => {
      const frag = items.slice(i, i + chunk).map(renderFn).join('');
      i += chunk;
      sentinel.insertAdjacentHTML('beforebegin', frag);
      if (i >= items.length) { io.disconnect(); sentinel.remove(); }
    };
    const io = new IntersectionObserver((ents) => { if (ents.some(e => e.isIntersecting)) more(); }, { root, rootMargin: '900px' });
    container.appendChild(sentinel);
    more();
    if (sentinel.isConnected) io.observe(sentinel);
    return { disconnect: () => io.disconnect() };
  };

  /* ---------------------------------------------------------------- router (keep-alive tab views) */
  const TAB_ROUTES = ['home', 'epg', 'saved', 'profile', 'search', 'sources'];
  const views = new Map(); // key -> { el, scrollY, dirty }
  let current = null;
  const Router = App.Router = {
    routes: {},
    get current() { return current; },
    parse() {
      const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
      return { name: parts[0] || '', args: parts.slice(1) };
    },
    go(path, { replace = false } = {}) {
      const h = `#/${path}`;
      if (location.hash === h) return this.render();
      if (replace) { history.replaceState(history.state, '', h); this.render(); }
      else location.hash = h;
    },
    back(fallback = 'home') {
      if (window.__navCount > 0) history.back();
      else this.go(fallback, { replace: true });
    },
    markDirty(...keys) {
      (keys.length ? keys : Array.from(views.keys())).forEach(k => { const v = views.get(k); if (v) v.dirty = true; });
      if (current && views.get(current.key) && views.get(current.key).dirty) this.render(true);
    },
    render(soft = false) {
      let { name, args } = this.parse();
      if (!App.Sources.active && name !== 'sources') { history.replaceState(history.state, '', '#/sources'); name = 'sources'; args = []; }
      if (!this.routes[name]) { name = App.Sources.active ? 'home' : 'sources'; history.replaceState(history.state, '', `#/${name}`); args = []; }
      const key = TAB_ROUTES.includes(name) ? name : `${name}/${args.join('/')}`;
      if (current && views.get(current.key)) {
        const prev = views.get(current.key);
        prev.scrollY = window.scrollY;
        if (current.key !== key) { prev.el.hidden = true; prev.onHide && prev.onHide(); }
      }
      let v = views.get(key);
      const fresh = !v || v.dirty;
      if (!v) {
        v = { el: document.createElement('section'), scrollY: 0 };
        v.el.dataset.view = key;
        $('#view').appendChild(v.el);
        views.set(key, v);
      }
      // Non-tab pages are cheap and transient: drop any others to keep the DOM small.
      views.forEach((vv, k) => { if (k !== key && !TAB_ROUTES.includes(k)) { vv.onHide && vv.onHide(); vv.el.remove(); views.delete(k); } });
      v.el.hidden = false;
      current = { key, name, args };
      if (fresh) {
        // Re-render into a brand-new element so listeners from the previous render are dropped.
        if (v.onHide && v.el.isConnected && !v.el.hidden) { try { v.onHide(); } catch (_) {} }
        if (v.el.childNodes.length) {
          const nel = document.createElement('section');
          nel.dataset.view = key;
          v.el.replaceWith(nel);
          v.el = nel;
        }
        v.dirty = false;
        const keepY = soft ? window.scrollY : 0;
        const r = this.routes[name](v.el, ...args) || {};
        v.onShow = r.onShow; v.onHide = r.onHide;
        window.scrollTo(0, keepY);
      } else {
        window.scrollTo(0, v.scrollY || 0);
      }
      v.onShow && v.onShow();
      UI.syncTabbar(name);
      Bus.emit('route', current);
    }
  };
  window.__navCount = 0;
  window.addEventListener('hashchange', () => { window.__navCount++; if (!App.UI.Overlay.depth) Router.render(); else { App.UI.Overlay.closeAll(); Router.render(); } });

  /* ---------------------------------------------------------------- tab bar */
  UI.syncTabbar = function (name) {
    const wrap = $('#tabbar-wrap');
    const show = ['home', 'epg', 'saved', 'profile', 'search'].includes(name);
    wrap.classList.toggle('away', !show);
    const btns = $$('#tabbar button');
    btns.forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('#search-fab').classList.toggle('on', name === 'search');
    const hl = $('#tabbar .hl');
    const on = btns.find(b => b.dataset.tab === name);
    if (on) { hl.style.opacity = 1; hl.style.width = `${on.offsetWidth}px`; hl.style.transform = `translateX(${on.offsetLeft - 6}px)`; }
    else hl.style.opacity = 0;
    $$('.fab-cats').forEach(f => f.classList.toggle('hidden', name !== 'home'));
  };
  window.addEventListener('resize', App.debounce(() => current && UI.syncTabbar(current.name), 120));

  /* ---------------------------------------------------------------- PIN */
  const Pin = UI.Pin = {
    ask({ title = 'Enter PIN', sub = '' } = {}) {
      return new Promise((resolve) => {
        let val = '', result = null;
        const dots = () => `<div class="pin-dots" data-dots>${[0, 1, 2, 3].map(i => `<i class="${i < val.length ? 'f' : ''}"></i>`).join('')}</div>`;
        UI.sheet({
          label: title,
          html: `${UI.sheetHeader({ icon: 'lock', title, sub })}<div class="sheet-body" style="padding-bottom:36px">
            ${dots()}
            <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="blank"></button><button data-n="0">0</button><button class="fn" data-del aria-label="Delete">${ic('delete-left')}</button></div></div>`,
          mount(ctx) {
            const upd = () => { $('[data-dots]', ctx.el).outerHTML = dots(); };
            const press = (n) => {
              if (val.length >= 4) return;
              val += n; haptic(); upd();
              if (val.length === 4) { result = val; setTimeout(() => ctx.close(), 140); }
            };
            ctx.el.addEventListener('click', (e) => {
              const b = e.target.closest('[data-n]');
              if (b) press(b.dataset.n);
              if (e.target.closest('[data-del]')) { val = val.slice(0, -1); upd(); }
            });
            const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') { val = val.slice(0, -1); upd(); } };
            document.addEventListener('keydown', onKey);
            ctx.cleanup = () => document.removeEventListener('keydown', onKey);
            ctx.layer.addEventListener('transitionend', () => {});
            Pin._ctx = ctx;
          },
          onClose: () => { Pin._ctx && Pin._ctx.cleanup && Pin._ctx.cleanup(); resolve(result); }
        });
      });
    },
    get isSet() { return !!Settings.get('pinHash'); },
    async verify(reason = 'Enter your Content PIN') {
      if (!this.isSet) return true;
      for (let tries = 0; tries < 3; tries++) {
        const v = await this.ask({ title: 'Content PIN', sub: tries ? 'Wrong PIN, try again' : reason });
        if (v == null) return false;
        if (await App.sha256(`aura:${v}`) === Settings.get('pinHash')) return true;
        haptic(60);
      }
      UI.toast('Too many wrong attempts', { icon: 'triangle-exclamation' });
      return false;
    },
    async setup() {
      const a = await this.ask({ title: 'Set a PIN', sub: 'Choose 4 digits to lock categories' });
      if (a == null) return false;
      const b = await this.ask({ title: 'Confirm PIN', sub: 'Enter the same 4 digits again' });
      if (b == null) return false;
      if (a !== b) { UI.toast('PINs did not match', { icon: 'triangle-exclamation' }); return false; }
      Settings.set('pinHash', await App.sha256(`aura:${a}`));
      UI.toast('Content PIN is on', { icon: 'lock' });
      return true;
    },
    async unlockSession() {
      if (App.unlocked) return true;
      if (await this.verify('Unlock locked categories for this session')) { App.unlocked = true; Bus.emit('relock'); return true; }
      return false;
    }
  };

  /* ---------------------------------------------------------------- device biometric lock (WebAuthn) */
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const Bio = UI.Bio = {
    label() {
      const ua = navigator.userAgent;
      if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID';
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'Face ID';
      if (/Macintosh/.test(ua)) return 'Touch ID';
      if (/Windows/.test(ua)) return 'Windows Hello';
      if (/Android/.test(ua)) return 'Fingerprint';
      return 'Device Lock';
    },
    async available() {
      try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (_) { return false; }
    },
    async enroll() {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: `${App.BRAND.first} ${App.BRAND.second}` },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'aura-user', displayName: 'AURA user' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000
      } });
      Settings.set('biometricCred', toB64(cred.rawId));
      Settings.set('biometric', true);
    },
    async verify() {
      const id = Settings.get('biometricCred');
      if (!id) return true;
      await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(id) }],
        userVerification: 'required', timeout: 60000
      } });
      return true;
    },
    async lockScreen() {
      if (!Settings.get('biometric')) return;
      const ov = document.createElement('div');
      ov.className = 'full-ov lock-ov';
      ov.innerHTML = `<div class="tile c-purple">${ic('fingerprint')}</div>
        <h1 class="title1">${esc(App.BRAND.first)} ${esc(App.BRAND.second)} is locked</h1>
        <p class="muted" style="margin:10px 0 28px">Unlock with ${esc(this.label())} to continue.</p>
        <button class="btn" style="max-width:320px">${ic('unlock')} Unlock</button>
        <p class="muted" data-err style="margin-top:16px;font-size:14px"></p>`;
      document.body.appendChild(ov);
      await new Promise((resolve) => {
        const go = async () => {
          try { await this.verify(); ov.remove(); resolve(); }
          catch (e) { $('[data-err]', ov).textContent = 'Not verified. Try again.'; }
        };
        $('button', ov).onclick = go;
        go();
      });
    }
  };
  // Privacy cover in the app switcher when the device lock is enabled.
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('privacy-blur', document.hidden && !!Settings.get('biometric'));
  });
})();
