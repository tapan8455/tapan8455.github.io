/* AURA IPTV — boot, global chrome (tab bar, floating buttons) and delegated actions. */
'use strict';
(function () {
  const { $, ic, icr, Settings, Sources, Catalog, User, Net, UI, Router, Bus } = App;

  function buildChrome() {
    const wrap = document.createElement('div');
    wrap.id = 'tabbar-wrap';
    wrap.className = 'away';
    wrap.innerHTML = `<nav id="tabbar" aria-label="Main">
        <span class="hl" aria-hidden="true"></span>
        <button data-tab="home">${ic('house')}<span>Home</span></button>
        <button data-tab="epg">${ic('tv')}<span>EPG</span></button>
        <button data-tab="saved">${icr('heart')}<span>Saved</span></button>
        <button data-tab="profile">${icr('circle-user')}<span>Profile</span></button>
      </nav>
      <button id="search-fab" aria-label="Search">${ic('magnifying-glass')}</button>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) {
        if (Router.current && Router.current.name === b.dataset.tab) window.scrollTo({ top: 0, behavior: 'smooth' });
        else Router.go(b.dataset.tab);
      }
      if (e.target.closest('#search-fab')) Router.go('search');
    });
    const fab = document.createElement('button');
    fab.className = 'fab-cats hidden';
    fab.setAttribute('aria-label', 'Browse categories');
    fab.innerHTML = UI.gridIcon;
    fab.onclick = () => App.Views.categoriesSheet(App.homeType);
    document.body.appendChild(fab);
    const sb = document.createElement('aside');
    sb.id = 'sidebar';
    sb.setAttribute('aria-label', 'Main');
    const item = (key, icon, label, reg) => `<button class="sb-item" data-sb="${key}">${reg ? icr(icon) : ic(icon)}<span>${label}</span></button>`;
    sb.innerHTML = `<div class="sb-drag"></div>
      <div class="sb-brand">${App.esc(App.BRAND.first)} <span class="accent">${App.esc(App.BRAND.second)}</span></div>
      ${item('home:movie', 'film', 'Movies')}${item('home:series', 'layer-group', 'Series')}${item('home:live', 'tower-broadcast', 'Live TV')}
      ${item('epg', 'tv', 'TV Guide')}${item('search', 'magnifying-glass', 'Search')}
      <div class="sb-label">Library</div>
      ${item('saved', 'heart', 'Watchlist', true)}${item('cats', 'table-cells-large', 'Categories')}
      <div class="sb-spacer"></div>
      ${item('profile', 'circle-user', 'Profile', true)}${item('settings', 'gear', 'Settings')}
      <button class="sb-src" data-sb-src aria-label="Switch playlist"></button>`;
    sb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sb], [data-sb-src]');
      if (!b) return;
      const k = b.dataset.sb;
      if (b.hasAttribute('data-sb-src')) return Router.go('sources');
      if (k.startsWith('home:')) {
        const t = k.slice(5);
        if (App.homeType !== t) { App.homeType = t; Router.markDirty('home'); }
        if (!Router.current || Router.current.name !== 'home') Router.go('home'); else UI.syncTabbar('home');
        window.scrollTo({ top: 0 });
      } else if (k === 'cats') App.Views.categoriesSheet(App.homeType);
      else if (k === 'settings') App.Views.openAdvanced();
      else Router.go(k);
    });
    document.body.appendChild(sb);
    if (Net.isElectron && /darwin/.test(window.auraNative.platform || '')) document.documentElement.classList.add('electron-mac');
    const toast = document.createElement('div');
    toast.id = 'toast-root';
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }

  // One delegated handler for posters, channel tiles, hearts and category headers everywhere.
  function onAction(e) {
    const rail = e.target.closest('[data-rail]');
    if (rail) {
      e.stopPropagation();
      const sc = rail.closest('.section').querySelector('.scroll-x');
      if (sc) sc.scrollBy({ left: Number(rail.dataset.rail) * sc.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    let t = e.target.closest('[data-act]');
    while (t && t.dataset.act === 'none') t = t.parentElement && t.parentElement.closest('[data-act]');
    if (!t || t.closest('#player')) return;
    const { act, type, id } = t.dataset;
    if (act === 'fav') {
      e.stopPropagation();
      const item = App.findItem(type, id) || { id, type, name: '' };
      const on = User.toggleFav(item);
      document.querySelectorAll(`[data-act="fav"][data-type="${type}"][data-id="${CSS.escape(id)}"]`).forEach(b => { b.classList.toggle('on', on); b.innerHTML = on ? ic('heart') : icr('heart'); });
      UI.toast(on ? 'Added to Watchlist' : 'Removed from Watchlist', { icon: 'heart' });
      App.haptic();
      return;
    }
    if (act === 'cat') return Router.go(`category/${type}/${encodeURIComponent(id)}`);
    const item = App.findItem(type, id);
    if (!item) return UI.toast('This item is no longer in your playlist', { icon: 'triangle-exclamation' });
    if (act === 'play') { e.stopPropagation(); return App.playItem(item); }
    if (act === 'result') User.addRecent(item);
    App.openItem(item);
  }

  async function boot() {
    Settings.applyTheme();
    await Net.init();
    buildChrome();
    document.addEventListener('click', onAction);
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('[role="button"][tabindex]')) { e.preventDefault(); t.click(); }
      if (e.key === '/' && !t.closest('input, textarea') && !(App.Player && App.Player.open) && Sources.active) { e.preventDefault(); Router.go('search'); }
      if (e.key === 'Escape' && !(App.Player && App.Player.open)) {
        const close = document.querySelectorAll('.sheet-layer:not(.closing) [data-close]');
        if (close.length) close[close.length - 1].click();
      }
    });
    Bus.on('progress', () => Router.markDirty('home'));
    Bus.on('relock', () => Router.markDirty('home', 'epg', 'search', 'saved'));
    Bus.on('favorites', () => Router.markDirty('saved'));

    await UI.Bio.lockScreen();
    if (Sources.active) {
      User.load();
      await Catalog.load(Sources.active);
    }
    $('#boot') && $('#boot').remove();
    if (!location.hash) history.replaceState(null, '', Sources.active ? '#/home' : '#/sources');
    Router.render();
    if (Sources.active && !Catalog.ready) App.Views.importFlow(Sources.active);
    else setTimeout(App.backgroundRefresh, 4000);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !Net.isElectron) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  window.__onGCastApiAvailable = function (ok) {
    if (!ok || !window.cast || !cast.framework) return;
    try {
      cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
    } catch (e) { console.warn('[cast]', e); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
