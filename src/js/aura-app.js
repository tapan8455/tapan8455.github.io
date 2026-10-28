/**
 * AURA IPTV — Unified Application Coordinator
 */

// Native Electron / Web Bridge Polyfill
if (!window.auraNative) {
    window.auraNative = {
        platform: 'web',
        version: 'web-2.0.0',
        apiRequest: async (args) => {
            const res = await fetch('/api/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Provider error (${res.status}): ${errText || res.statusText}`);
            }
            const data = await res.json();
            if (data && data.error) throw new Error(data.error);
            return data;
        },
        testConnection: async (args) => {
            const res = await fetch('/api/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });
            if (!res.ok) {
                return { success: false, error: `HTTP ${res.status}: Connection failed` };
            }
            return await res.json();
        },
        mediaProxy: (url) => {
            if (!url) return '';
            if (url.startsWith('/stream?url=')) return url;
            return `/stream?url=${encodeURIComponent(url)}`;
        },
        toggleFullScreen: () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
        },
        copyToClipboard: async (text) => {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {
                return false;
            }
        }
    };
}

// Helpers
const safeJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } };
const safeArray = (k) => { const v = safeJSON(k, []); return Array.isArray(v) ? v : []; };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsEsc = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

let toastTimer = null;
function showToast(msg, duration = 2500) {
    const el = document.getElementById('aura-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('opacity-0', 'translate-y-2');
    el.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('opacity-100', 'translate-y-0');
        el.classList.add('opacity-0', 'translate-y-2');
    }, duration);
}

// State Management
let config = safeJSON('aura_config', { server: '', user: '', pass: '' });
function getServer() { return (config.server || '').trim().replace(/\/+$/, ''); }

const state = {
    currentTab: 'vod',
    categories: { vod: [], live: [], series: [] },
    allLiveCategories: [],
    categoryMap: {},
    streams: {},
    activeCategoryStreams: [],
    favorites: safeArray('aura_favorites'),
    history: safeArray('aura_history'),
    hiddenChannelIds: safeArray('aura_hidden_channels'),
    currentPlaylist: [],
    currentIndex: -1,
    activeStreamUrl: '',
    playerEngine: null,
    searchTimer: null
};

// Storage API Namespace
window.auraStorage = {
    exportAllUserData: () => {
        const payload = {
            config: { ...config, pass: '' },
            favorites: state.favorites,
            history: state.history,
            hiddenChannels: state.hiddenChannelIds,
            exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aura-iptv-backup-${Date.now()}.json`;
        a.click();
    },
    eraseAllUserData: () => {
        if (!confirm('Permanently erase all playlist data, sources, and preferences?')) return;
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
    }
};

// Player API Namespace
window.auraPlayer = {
    togglePlay: () => {
        const video = document.getElementById('video-player');
        if (!video) return;
        video.paused ? video.play().catch(() => {}) : video.pause();
    },
    seekRelative: (sec) => {
        const video = document.getElementById('video-player');
        if (video) video.currentTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + sec));
    },
    toggleMute: () => {
        const video = document.getElementById('video-player');
        if (!video) return;
        video.muted = !video.muted;
        const muteBtn = document.getElementById('mute-btn');
        if (muteBtn) {
            muteBtn.innerHTML = video.muted
                ? '<i class="fa-solid fa-volume-xmark text-lg text-primary"></i>'
                : '<i class="fa-solid fa-volume-high text-lg"></i>';
        }
    },
    toggleFullscreen: () => window.auraNative.toggleFullScreen(),
    togglePip: () => {
        const video = document.getElementById('video-player');
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        } else if (video && video.requestPictureInPicture) {
            video.requestPictureInPicture().catch(() => showToast('PiP unavailable'));
        }
    },
    cycleAspectRatio: () => {
        const video = document.getElementById('video-player');
        const btn = document.getElementById('btn-aspect');
        if (!video) return;
        const modes = ['contain', 'cover', 'fill'];
        const current = video.style.objectFit || 'contain';
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        video.style.objectFit = next;
        if (btn) btn.textContent = next.toUpperCase();
    },
    toggleDrawer: () => {
        const drawer = document.getElementById('player-drawer');
        if (drawer) {
            drawer.classList.toggle('translate-x-full');
            renderPlayerDrawer();
        }
    },
    filterDrawer: (val) => {
        const q = (val || '').toLowerCase().trim();
        const rows = document.querySelectorAll('#player-drawer-list > div');
        rows.forEach(r => {
            const title = (r.getAttribute('data-title') || '').toLowerCase();
            r.style.display = title.includes(q) ? 'flex' : 'none';
        });
    },
    toggleStatsPanel: () => {
        const p = document.getElementById('stats-for-nerds-panel');
        if (!p) return;
        p.classList.toggle('hidden');
        if (!p.classList.contains('hidden')) updateStatsTelemetry();
    },
    copyStreamUrl: () => {
        if (state.activeStreamUrl) {
            window.auraNative.copyToClipboard(state.activeStreamUrl);
            showToast('Stream URL copied to clipboard');
        }
    },
    retry: () => {
        if (state.currentPlaylist[state.currentIndex]) {
            executePlayerEngine(state.currentPlaylist[state.currentIndex], false);
        }
    },
    retryWithProxy: () => {
        if (state.currentPlaylist[state.currentIndex]) {
            executePlayerEngine(state.currentPlaylist[state.currentIndex], true);
        }
    },
    stepChannel: (direction) => {
        if (state.currentPlaylist.length === 0) return;
        let next = state.currentIndex + direction;
        if (next < 0) next = state.currentPlaylist.length - 1;
        if (next >= state.currentPlaylist.length) next = 0;
        state.currentIndex = next;
        executePlayerEngine(state.currentPlaylist[next]);
    },
    goLiveEdge: () => {
        const video = document.getElementById('video-player');
        if (video && video.seekable && video.seekable.length > 0) {
            video.currentTime = video.seekable.end(video.seekable.length - 1) - 0.5;
            video.play().catch(() => {});
        }
    },
    close: () => closePlayer()
};

// Application API Namespace
window.auraApp = {
    setTab: (tab) => switchTab(tab),
    toggleSidebar: () => {
        const sb = document.getElementById('app-sidebar');
        const bd = document.getElementById('sidebar-backdrop');
        if (!sb) return;
        sb.classList.toggle('-translate-x-full');
        if (bd) bd.classList.toggle('hidden');
    },
    openSourceModal: (tabType = 'xtream') => {
        const modal = document.getElementById('source-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
        window.auraApp.setSourceTab(tabType);
        const s = document.getElementById('xtream-server');
        const u = document.getElementById('xtream-user');
        const p = document.getElementById('xtream-pass');
        if (s) s.value = config.server || '';
        if (u) u.value = config.user || '';
        if (p) p.value = config.pass || '';
    },
    closeSourceModal: () => {
        const modal = document.getElementById('source-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    },
    setSourceTab: (type) => {
        ['xtream', 'm3u', 'file'].forEach(t => {
            const form = document.getElementById(`form-src-${t}`);
            const tab = document.getElementById(`tab-src-${t}`);
            if (form) form.classList.toggle('hidden', t !== type);
            if (tab) {
                tab.className = t === type
                    ? 'pb-3 border-b-2 border-primary text-primary'
                    : 'pb-3 border-b-2 border-transparent text-gray-400';
            }
        });
    },
    testXtreamConnection: async () => {
        const resultEl = document.getElementById('src-test-result');
        const s = document.getElementById('xtream-server').value.trim();
        const u = document.getElementById('xtream-user').value.trim();
        const p = document.getElementById('xtream-pass').value.trim();

        if (!s || !u || !p) {
            resultEl.className = 'block p-3 rounded-lg text-xs bg-red-500/20 text-red-400 border border-red-500/30';
            resultEl.textContent = 'Server URL, Username, and Password are required.';
            return;
        }

        resultEl.className = 'block p-3 rounded-lg text-xs bg-white/5 text-gray-300';
        resultEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Testing connection...';

        const res = await window.auraNative.testConnection({ server: s, user: u, pass: p });
        if (res.success) {
            resultEl.className = 'block p-3 rounded-lg text-xs bg-green-500/20 text-green-300 border border-green-500/30';
            resultEl.innerHTML = `<i class="fa-solid fa-check mr-2"></i> Verified: Status <b>${res.data?.user_info?.status || 'Active'}</b>`;
        } else {
            resultEl.className = 'block p-3 rounded-lg text-xs bg-red-500/20 text-red-400 border border-red-500/30';
            resultEl.innerHTML = `<i class="fa-solid fa-xmark mr-2"></i> ${esc(res.error || 'Authentication rejected')}`;
        }
    },
    handleSourceSubmit: async (e, type) => {
        e.preventDefault();
        if (type === 'xtream') {
            const s = document.getElementById('xtream-server').value.trim();
            const u = document.getElementById('xtream-user').value.trim();
            const p = document.getElementById('xtream-pass').value.trim();
            config = { server: s, user: u, pass: p };
            localStorage.setItem('aura_config', JSON.stringify(config));
            window.auraApp.closeSourceModal();
            showToast('Account credentials saved');
            await loadDashboard();
        } else {
            showToast('Playlist source saved');
        }
    },
    openSettingsModal: () => document.getElementById('settings-modal')?.classList.remove('hidden'),
    closeSettingsModal: () => document.getElementById('settings-modal')?.classList.add('hidden'),
    openKeyboardShortcutsModal: () => document.getElementById('shortcuts-modal')?.classList.remove('hidden'),
    closeKeyboardShortcutsModal: () => document.getElementById('shortcuts-modal')?.classList.add('hidden'),
    handleCastTrigger: () => showToast('Screen Mirroring: Connect your browser or OS to an AirPlay / Cast receiver'),
    openProfilePicker: () => window.auraApp.openSourceModal(),
    restoreAllHiddenChannels: () => {
        state.hiddenChannelIds = [];
        localStorage.removeItem('aura_hidden_channels');
        document.getElementById('filter-hidden-banner')?.classList.add('hidden');
        renderActiveFilteredStreams();
    },
    debouncedSearch: (q) => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => executeSearch(q), 300);
    },
    clearSearch: () => {
        const inp = document.getElementById('global-search-input');
        if (inp) inp.value = '';
        executeSearch('');
    },
    applySort: (sortType, btn) => {
        document.querySelectorAll('[role="group"] button').forEach(b => {
            b.className = 'px-3.5 py-1 rounded-md text-xs font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors';
            b.setAttribute('aria-pressed', 'false');
        });
        if (btn) {
            btn.className = 'px-3.5 py-1 rounded-md text-xs font-bold text-white bg-white/10 transition-colors';
            btn.setAttribute('aria-pressed', 'true');
        }
        if (sortType === 'az') {
            state.activeCategoryStreams.sort((a, b) => a.title.localeCompare(b.title));
        } else if (sortType === 'new') {
            state.activeCategoryStreams.sort((a, b) => (parseInt(b.added) || 0) - (parseInt(a.added) || 0));
        } else {
            state.activeCategoryStreams.sort((a, b) => (b.ratingNum || 0) - (a.ratingNum || 0));
        }
        renderActiveFilteredStreams();
    },
    renderSidebarCategories: (filterText = '') => {
        const list = document.getElementById('category-list');
        if (!list) return;
        const currentCats = state.categories[state.currentTab] || [];
        const filtered = currentCats.filter(c => (c.category_name || '').toLowerCase().includes(filterText.toLowerCase()));

        list.innerHTML = `<button onclick="loadCategoryStreams('all')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-bold bg-white/10 text-white">ALL CATEGORIES</button>` +
            filtered.map(c => `
                <button onclick="loadCategoryStreams('${jsEsc(c.category_id)}', '${jsEsc(c.category_name)}')" class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 truncate">
                    ${esc(c.category_name)}
                </button>
            `).join('');
    },
    jumpEpgToNow: () => showToast('EPG timeline aligned to current broadcast slot')
};

// Global Routing
function switchTab(tab) {
    state.currentTab = tab;
    ['live', 'vod', 'series', 'favorites', 'search', 'epg'].forEach(t => {
        const nav = document.getElementById(`nav-${t}`);
        const mob = document.getElementById(`mob-nav-${t}`);
        const active = t === tab;
        if (nav) {
            nav.className = active
                ? 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-white bg-white/10'
                : 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition-colors';
        }
        if (mob) {
            mob.className = active
                ? 'flex flex-col items-center justify-center text-primary py-1 flex-1'
                : 'flex flex-col items-center justify-center text-gray-400 hover:text-white py-1 flex-1';
        }
    });

    const searchView = document.getElementById('search-view');
    const epgView = document.getElementById('epg-view');
    const mainGrid = document.getElementById('main-grid');

    if (searchView) searchView.classList.toggle('hidden', tab !== 'search');
    if (epgView) epgView.classList.toggle('hidden', tab !== 'epg');
    if (mainGrid) mainGrid.classList.toggle('hidden', tab === 'search' || tab === 'epg');

    const titles = { live: 'Live TV', vod: 'Movies', series: 'Series', favorites: 'Favorites', search: 'Search Library', epg: 'TV Guide' };
    updateHeaderTitle(titles[tab] || 'Live TV');

    if (tab === 'search') {
        document.getElementById('global-search-input')?.focus();
        return;
    }
    if (tab === 'favorites') {
        renderFavorites();
        return;
    }

    window.auraApp.renderSidebarCategories();
    loadCategoryStreams('all');
}

function updateHeaderTitle(baseTitle, catName = null) {
    const hubTitle = document.getElementById('hub-title');
    if (!hubTitle) return;
    if (catName) {
        hubTitle.innerHTML = `<span class="text-gray-400 hover:text-white cursor-pointer" onclick="switchTab('${state.currentTab}')">${baseTitle}</span> <span class="text-gray-600">/</span> <span>${esc(catName)}</span>`;
    } else {
        hubTitle.textContent = baseTitle;
    }
}

// Data Fetching
async function loadDashboard() {
    if (!config.user || !getServer()) {
        document.getElementById('grid-skeleton')?.classList.add('hidden');
        document.getElementById('onboarding-card')?.classList.remove('hidden');
        return;
    }

    document.getElementById('onboarding-card')?.classList.add('hidden');
    document.getElementById('grid-skeleton')?.classList.remove('hidden');

    try {
        const [liveCats, vodCats, seriesCats] = await Promise.all([
            window.auraNative.apiRequest({ server: getServer(), user: config.user, pass: config.pass, action: 'get_live_categories' }).catch(() => []),
            window.auraNative.apiRequest({ server: getServer(), user: config.user, pass: config.pass, action: 'get_vod_categories' }).catch(() => []),
            window.auraNative.apiRequest({ server: getServer(), user: config.user, pass: config.pass, action: 'get_series_categories' }).catch(() => [])
        ]);

        const normalize = (data) => Array.isArray(data) ? data : Object.values(data || {});
        state.categories.live = normalize(liveCats);
        state.categories.vod = normalize(vodCats);
        state.categories.series = normalize(seriesCats);

        document.getElementById('sidebar-username').textContent = config.user;
        document.getElementById('sidebar-avatar').textContent = config.user[0].toUpperCase();

        switchTab(state.currentTab);
    } catch (err) {
        showToast(`Connection error: ${err.message}`);
        document.getElementById('grid-skeleton')?.classList.add('hidden');
        document.getElementById('onboarding-card')?.classList.remove('hidden');
    }
}

async function loadCategoryStreams(catId, catName = null) {
    const grid = document.getElementById('main-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full flex justify-center py-24"><div class="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>';

    let action = 'get_live_streams';
    if (state.currentTab === 'vod') action = 'get_vod_streams';
    if (state.currentTab === 'series') action = 'get_series';

    const titles = { live: 'Live TV', vod: 'Movies', series: 'Series' };
    updateHeaderTitle(titles[state.currentTab], catName);

    const params = (catId && catId !== 'all') ? `&category_id=${catId}` : '';
    try {
        const data = await window.auraNative.apiRequest({
            server: getServer(),
            user: config.user,
            pass: config.pass,
            action,
            params
        });

        const items = Array.isArray(data) ? data : Object.values(data || {});
        state.activeCategoryStreams = items.map(s => {
            const r = parseFloat(s.rating || s.rating_5based || 0);
            return {
                id: s.stream_id || s.series_id || s.id,
                title: s.name || s.title || 'Untitled',
                img: s.stream_icon || s.cover || '',
                ext: s.container_extension || 'mp4',
                type: state.currentTab,
                ratingNum: r,
                rating: r > 0 ? r.toFixed(1) : '',
                added: s.added || s.year || ''
            };
        });

        renderActiveFilteredStreams();
    } catch (e) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-400">Failed to load content: ${esc(e.message)}</div>`;
    }
}

function renderActiveFilteredStreams() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;

    const visible = state.activeCategoryStreams.filter(item => !state.hiddenChannelIds.includes(String(item.id)));
    if (visible.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-24 text-gray-500 font-semibold">No titles found in this category.</div>`;
        return;
    }

    const isLive = state.currentTab === 'live';
    grid.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6">${
        visible.map((item, idx) => {
            const isFav = state.favorites.some(f => String(f.id) === String(item.id));
            return `
            <div class="group relative bg-panelbg border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:border-white/20 transition-all flex flex-col" onclick="playMediaItem(${idx})">
                <div class="${isLive ? 'aspect-video' : 'aspect-[2/3]'} bg-black/60 relative flex items-center justify-center overflow-hidden">
                    ${item.img ? `<img src="${item.img}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.style.display='none'">` : '<i class="fa-solid fa-play text-gray-700 text-3xl"></i>'}
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <div class="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white">
                            <i class="fa-solid fa-play ml-0.5 text-base"></i>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); toggleFavoriteItem('${item.id}')" class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/10 text-white hover:text-primary transition-colors">
                        <i class="${isFav ? 'fa-solid fa-heart text-red-500' : 'fa-regular fa-heart'} text-xs"></i>
                    </button>
                </div>
                <div class="p-2.5 flex-1 flex flex-col justify-between">
                    <h3 class="text-xs font-bold text-white truncate" title="${esc(item.title)}">${esc(item.title)}</h3>
                    <div class="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 font-medium">
                        ${item.rating ? `<span class="text-green-400 font-bold">${item.rating} ★</span>` : ''}
                        ${item.added ? `<span>${item.added}</span>` : ''}
                    </div>
                </div>
            </div>
            `;
        }).join('')
    }</div>`;
}

function toggleFavoriteItem(id) {
    const item = state.activeCategoryStreams.find(s => String(s.id) === String(id));
    if (!item) return;
    const idx = state.favorites.findIndex(f => String(f.id) === String(id));
    if (idx > -1) {
        state.favorites.splice(idx, 1);
        showToast('Removed from favorites');
    } else {
        state.favorites.unshift(item);
        showToast('Added to favorites');
    }
    localStorage.setItem('aura_favorites', JSON.stringify(state.favorites));
    renderActiveFilteredStreams();
}

function renderFavorites() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;
    if (state.favorites.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-24 text-gray-500 font-semibold">No favorites bookmarked yet. Click the heart icon on any channel or movie.</div>`;
        return;
    }
    state.activeCategoryStreams = [...state.favorites];
    renderActiveFilteredStreams();
}

function executeSearch(query) {
    const grid = document.getElementById('search-results-grid');
    if (!grid) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
        grid.innerHTML = `<div class="col-span-full text-center py-24 text-gray-500">Type at least 2 characters to search across current catalog...</div>`;
        return;
    }
    const results = state.activeCategoryStreams.filter(s => s.title.toLowerCase().includes(q));
    grid.innerHTML = results.length > 0
        ? results.map((item, idx) => `
            <div class="group bg-panelbg border border-white/5 rounded-xl p-3 cursor-pointer hover:border-white/20 transition-all flex items-center gap-3" onclick="playMediaItem(${idx})">
                <i class="fa-solid fa-play text-primary"></i>
                <h4 class="text-xs font-bold text-white truncate flex-1">${esc(item.title)}</h4>
            </div>
          `).join('')
        : `<div class="col-span-full text-center py-24 text-gray-500">No results found for "${esc(query)}"</div>`;
}

// Media Playback Engine
function playMediaItem(index) {
    state.currentPlaylist = state.activeCategoryStreams;
    state.currentIndex = index;
    const item = state.currentPlaylist[index];
    if (item) executePlayerEngine(item);
}

function executePlayerEngine(item, forceProxy = false) {
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('video-player');
    const spinner = document.getElementById('player-loading-spinner');
    const errBox = document.getElementById('player-error');

    if (!modal || !video) return;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('opacity-100');
    errBox.classList.add('hidden');
    spinner.classList.remove('hidden');

    document.getElementById('player-main-title').textContent = item.title;

    const isLive = item.type === 'live';
    const seekBarContainer = document.getElementById('seek-bar-container');
    const goLiveBtn = document.getElementById('btn-go-live');
    const liveBadge = document.getElementById('player-live-badge');
    
    if (seekBarContainer) seekBarContainer.style.display = isLive ? 'none' : 'flex';
    if (goLiveBtn) goLiveBtn.style.display = isLive ? 'inline-flex' : 'none';
    if (liveBadge) liveBadge.classList.toggle('hidden', !isLive);

    if (state.playerEngine) {
        try { state.playerEngine.destroy(); } catch (_) {}
        state.playerEngine = null;
    }

    const u = encodeURIComponent(config.user);
    const p = encodeURIComponent(config.pass);
    const serverClean = getServer();

    let rawUrl = '';
    if (item.type === 'live') {
        rawUrl = `${serverClean}/live/${u}/${p}/${item.id}.m3u8`;
    } else if (item.type === 'series') {
        rawUrl = `${serverClean}/series/${u}/${p}/${item.id}.${item.ext || 'mp4'}`;
    } else {
        rawUrl = `${serverClean}/movie/${u}/${p}/${item.id}.${item.ext || 'mp4'}`;
    }

    state.activeStreamUrl = rawUrl;

    // Mixed Content Guard: On HTTPS, plain HTTP provider URLs MUST be proxied
    const isHttpsApp = window.location.protocol === 'https:';
    const requiresProxy = forceProxy || (isHttpsApp && rawUrl.startsWith('http:'));
    const streamUrl = requiresProxy ? window.auraNative.mediaProxy(rawUrl) : rawUrl;

    setupVideoEventHandlers(video, item);

    if (streamUrl.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            manifestLoadingTimeOut: 12000,
            fragLoadingTimeOut: 15000
        });
        state.playerEngine = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            spinner.classList.add('hidden');
            video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                spinner.classList.add('hidden');
                showPlaybackFailure(item, `HLS decode error: ${data.details}. Try with proxy.`);
            }
        });
    } else {
        video.src = streamUrl;
        video.load();
        video.play().catch((err) => {
            if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
                showPlaybackFailure(item, 'Playback interrupted. Tap Use Proxy to bypass restrictions.');
            }
        });
    }
}

function setupVideoEventHandlers(video, item) {
    const spinner = document.getElementById('player-loading-spinner');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const seekBar = document.getElementById('seek-bar');
    const timeCurrent = document.getElementById('time-current');
    const timeTotal = document.getElementById('time-total');

    video.onwaiting = () => spinner.classList.remove('hidden');
    video.onplaying = () => {
        spinner.classList.add('hidden');
        document.getElementById('player-error')?.classList.add('hidden');
        if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fa-solid fa-pause text-base"></i>';
    };
    video.onpause = () => {
        if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fa-solid fa-play text-base ml-0.5"></i>';
    };
    video.oncanplay = () => spinner.classList.add('hidden');
    video.onerror = () => {
        spinner.classList.add('hidden');
        showPlaybackFailure(item, 'Network or codec failure. This provider stream requires proxy routing.');
    };

    video.ontimeupdate = () => {
        if (item.type === 'live' || !video.duration || !seekBar) return;
        seekBar.value = (video.currentTime / video.duration) * 100;
        if (timeCurrent) timeCurrent.textContent = formatSec(video.currentTime);
        if (timeTotal) timeTotal.textContent = formatSec(video.duration);
    };

    if (seekBar) {
        seekBar.oninput = () => {
            if (video.duration) {
                video.currentTime = (seekBar.value / 100) * video.duration;
            }
        };
    }
}

function showPlaybackFailure(item, msg) {
    const errBox = document.getElementById('player-error');
    const msgEl = document.getElementById('player-error-message');
    const tryProxyBtn = document.getElementById('btn-try-proxy');
    if (!errBox) return;

    errBox.classList.remove('hidden');
    if (msgEl) msgEl.textContent = msg;
    if (tryProxyBtn) tryProxyBtn.classList.remove('hidden');
}

function formatSec(sec) {
    if (isNaN(sec) || sec === Infinity) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderPlayerDrawer() {
    const list = document.getElementById('player-drawer-list');
    if (!list) return;
    list.innerHTML = state.currentPlaylist.map((ch, idx) => {
        const isActive = idx === state.currentIndex;
        return `
            <div data-title="${esc(ch.title)}" onclick="playMediaItem(${idx})" class="p-2.5 rounded-lg flex items-center gap-3 cursor-pointer transition-all ${isActive ? 'bg-primary/20 border border-primary/40 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-300'}">
                <i class="fa-solid fa-tv text-xs ${isActive ? 'text-primary' : 'text-gray-500'}"></i>
                <span class="text-xs font-semibold truncate flex-1">${esc(ch.title)}</span>
            </div>
        `;
    }).join('');
}

function updateStatsTelemetry() {
    const video = document.getElementById('video-player');
    if (!video) return;
    const resEl = document.getElementById('stat-resolution');
    const engEl = document.getElementById('stat-engine');
    const bufEl = document.getElementById('stat-buffer');
    if (resEl) resEl.textContent = `${video.videoWidth || '--'} x ${video.videoHeight || '--'}`;
    if (engEl) engEl.textContent = state.playerEngine ? 'Hls.js Adaptive Demuxer' : 'HTML5 Native Direct';
    if (bufEl) {
        const buf = video.buffered.length > 0 ? (video.buffered.end(video.buffered.length - 1) - video.currentTime).toFixed(1) : '0';
        bufEl.textContent = `${buf} seconds`;
    }
}

function closePlayer() {
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('video-player');
    if (state.playerEngine) {
        try { state.playerEngine.destroy(); } catch (_) {}
        state.playerEngine = null;
    }
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('opacity-100');
    }
}

// Global Keyboard Navigation
window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const isPlayerOpen = !document.getElementById('player-modal')?.classList.contains('hidden');

    if (e.key === 'Escape' || e.key === 'Backspace') {
        if (isPlayerOpen) {
            e.preventDefault();
            closePlayer();
        } else {
            window.auraApp.closeSourceModal();
            window.auraApp.closeSettingsModal();
            window.auraApp.closeKeyboardShortcutsModal();
        }
    } else if (isPlayerOpen) {
        if (e.key === ' ') {
            e.preventDefault();
            window.auraPlayer.togglePlay();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            window.auraPlayer.seekRelative(10);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            window.auraPlayer.seekRelative(-10);
        } else if (e.key.toLowerCase() === 'm') {
            e.preventDefault();
            window.auraPlayer.toggleMute();
        } else if (e.key.toLowerCase() === 'f') {
            e.preventDefault();
            window.auraPlayer.toggleFullscreen();
        }
    }
});

// App Startup
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});