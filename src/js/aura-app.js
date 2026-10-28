/**
 * AURA IPTV — Unified Application Coordinator for Vercel
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
const encObj = (o) => encodeURIComponent(JSON.stringify(o)).replace(/'/g, '%27');

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

// State
let config = safeJSON('aura_config', { server: '', user: '', pass: '' });
function getServer() { return (config.server || '').trim().replace(/\/+$/, ''); }

const state = {
    currentTab: 'live',
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
    playbackSessionId: 0,
    searchTimer: null
};

// Storage Namespace
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
        if (!confirm('Permanently erase all playlist data and credentials?')) return;
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
    }
};

// Player Namespace
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
        document.getElementById('mute-btn').innerHTML = video.muted
            ? '<i class="fa-solid fa-volume-xmark text-lg text-primary"></i>'
            : '<i class="fa-solid fa-volume-high text-lg"></i>';
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
        if (drawer) drawer.classList.toggle('translate-x-full');
    },
    toggleStatsPanel: () => {
        const p = document.getElementById('stats-for-nerds-panel');
        if (p) p.classList.toggle('hidden');
    },
    copyStreamUrl: () => {
        if (state.activeStreamUrl) {
            window.auraNative.copyToClipboard(state.activeStreamUrl);
            showToast('Stream URL copied');
        }
    },
    retry: () => {
        if (state.currentPlaylist[state.currentIndex]) {
            executePlayerEngine(state.currentPlaylist[state.currentIndex]);
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

// App Namespace
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
            resultEl.innerHTML = `<i class="fa-solid fa-xmark mr-2"></i> ${esc(res.error || 'Authentication failed')}`;
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
            showToast('Alternative playlist formats will be parsed into local cache');
        }
    },
    openSettingsModal: () => document.getElementById('settings-modal')?.classList.remove('hidden'),
    closeSettingsModal: () => document.getElementById('settings-modal')?.classList.add('hidden'),
    openKeyboardShortcutsModal: () => document.getElementById('shortcuts-modal')?.classList.remove('hidden'),
    closeKeyboardShortcutsModal: () => document.getElementById('shortcuts-modal')?.classList.add('hidden'),
    handleCastTrigger: () => showToast('Screen casting requires a connected browser Cast display'),
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
    }
};

// View Management
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
    const hubTitle = document.getElementById('hub-title');
    if (hubTitle) hubTitle.textContent = titles[tab] || 'Live TV';

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
        showToast(`Connection failed: ${err.message}`);
        document.getElementById('grid-skeleton')?.classList.add('hidden');
        document.getElementById('onboarding-card')?.classList.remove('hidden');
    }
}

async function loadCategoryStreams(catId, catName) {
    const grid = document.getElementById('main-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full flex justify-center py-20"><div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>';

    let action = 'get_live_streams';
    if (state.currentTab === 'vod') action = 'get_vod_streams';
    if (state.currentTab === 'series') action = 'get_series';

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
        state.activeCategoryStreams = items.map(s => ({
            id: s.stream_id || s.series_id || s.id,
            title: s.name || s.title || 'Untitled',
            img: s.stream_icon || s.cover || '',
            ext: s.container_extension || 'mp4',
            type: state.currentTab,
            added: s.added || ''
        }));

        renderActiveFilteredStreams();
    } catch (e) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500">Failed to load content: ${esc(e.message)}</div>`;
    }
}

function renderActiveFilteredStreams() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;

    const visible = state.activeCategoryStreams.filter(item => !state.hiddenChannelIds.includes(String(item.id)));
    if (visible.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500">No channels match current filters.</div>`;
        return;
    }

    grid.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6">${
        visible.map((item, idx) => `
            <div class="group relative bg-panelbg border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:border-white/20 transition-all" onclick="playMediaItem(${idx})">
                <div class="aspect-[16/10] bg-black/40 relative flex items-center justify-center overflow-hidden">
                    ${item.img ? `<img src="${item.img}" loading="lazy" class="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform" onerror="this.remove()">` : ''}
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <i class="fa-solid fa-play text-white text-xl"></i>
                    </div>
                </div>
                <div class="p-2.5">
                    <h3 class="text-xs font-bold text-white truncate" title="${esc(item.title)}">${esc(item.title)}</h3>
                </div>
            </div>
        `).join('')
    }</div>`;
}

function renderFavorites() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;
    if (state.favorites.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500">No favorites saved. Click the heart icon on any channel or movie to add it here.</div>`;
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
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500">Type at least 2 characters to search...</div>`;
        return;
    }
    const results = state.activeCategoryStreams.filter(s => s.title.toLowerCase().includes(q));
    grid.innerHTML = results.length > 0
        ? results.map((item, idx) => `
            <div class="group bg-panelbg border border-white/5 rounded-xl p-3 cursor-pointer hover:border-white/20" onclick="playMediaItem(${idx})">
                <h4 class="text-xs font-bold text-white truncate">${esc(item.title)}</h4>
            </div>
          `).join('')
        : `<div class="col-span-full text-center py-20 text-gray-500">No results found for "${esc(query)}"</div>`;
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

    if (state.playerEngine) {
        try { state.playerEngine.destroy(); } catch (_) {}
        state.playerEngine = null;
    }

    const u = encodeURIComponent(config.user);
    const p = encodeURIComponent(config.pass);
    const rawUrl = item.type === 'live'
        ? `${getServer()}/live/${u}/${p}/${item.id}.m3u8`
        : `${getServer()}/movie/${u}/${p}/${item.id}.${item.ext || 'mp4'}`;

    state.activeStreamUrl = rawUrl;
    const streamUrl = forceProxy ? window.auraNative.mediaProxy(rawUrl) : rawUrl;

    if (streamUrl.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
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
                errBox.classList.remove('hidden');
                document.getElementById('player-error-message').textContent = `Stream decode failed (${data.details}). Try proxying.`;
                document.getElementById('btn-try-proxy')?.classList.remove('hidden');
            }
        });
    } else {
        video.src = streamUrl;
        video.oncanplay = () => {
            spinner.classList.add('hidden');
            video.play().catch(() => {});
        };
        video.onerror = () => {
            spinner.classList.add('hidden');
            errBox.classList.remove('hidden');
            document.getElementById('player-error-message').textContent = 'Playback interrupted. This provider may require proxy routing to bypass CORS.';
            document.getElementById('btn-try-proxy')?.classList.remove('hidden');
        };
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

// App Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
});