tailwind.config = {
            theme: {
                extend: {
                    fontFamily: { sans: ['Inter', 'sans-serif'] },
                    colors: {
                        primary: '#E50914', // AURA Cinematic Red
                        sidebar: '#0A0A0A',
                        mainbg: '#141414',
                        panelbg: '#1A1A1A',
                    }
                }
            }
        }

// --- Web Bridge Polyfill for Cloud/Browser/Xbox Hosting ---
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
                        throw new Error(`Provider server error (${res.status}): ${errText || res.statusText}`);
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
                        const errText = await res.text().catch(() => '');
                        return { success: false, error: `Connection failed (${res.status}): ${errText || res.statusText}` };
                    }
                    return await res.json();
                },
                mediaProxy: (url) => {
                    if (!url) return '';
                    if (url.startsWith('/stream?url=') || url.startsWith('aura://stream?url=')) return url;
                    return `/stream?url=${encodeURIComponent(url)}`;
                },
                toggleFullScreen: () => {
                    if (!document.fullscreenElement) {
                        (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen || function(){}).call(document.documentElement).catch(() => {});
                    } else {
                        (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document).catch(() => {});
                    }
                },
                isFullScreen: async () => !!(document.fullscreenElement || document.webkitFullscreenElement),
                copyToClipboard: async (text) => {
                    try {
                        if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(text);
                        } else {
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                        }
                        return true;
                    } catch (_) {
                        return false;
                    }
                },
                openExternal: (url) => {
                    window.open(url, '_blank', 'noopener,noreferrer');
                }
            };
        }

        // --- Core Helpers & Polyfills ---
        const safeJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
        const safeArray = (k) => { const v = safeJSON(k, []); return Array.isArray(v) ? v : []; };
        const esc = (t) => String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        const jsEsc = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
        const encObj = (o) => encodeURIComponent(JSON.stringify(o)).replace(/'/g, '%27');

        // Toast notification
        let toastTimer = null;
        function showToast(msg, duration = 2500) {
            const el = document.getElementById('aura-toast');
            if (!el) return;
            el.textContent = msg;
            el.classList.add('show');
            announceA11y(msg);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('show'), duration);
        }

        // Accessibility Screen Reader Announcer
        function announceA11y(text) {
            const el = document.getElementById('a11y-status');
            if (!el) return;
            el.textContent = '';
            setTimeout(() => { el.textContent = text; }, 50);
        }

        // Keyboard & Remote Shortcuts Modal Toggle
        function toggleShortcutsModal() {
            const modal = document.getElementById('shortcuts-modal');
            if (!modal) return;
            const isHidden = modal.classList.contains('hidden');
            if (isHidden) {
                modal.classList.remove('hidden');
                void modal.offsetWidth;
                modal.classList.replace('opacity-0', 'opacity-100');
            } else {
                modal.classList.replace('opacity-100', 'opacity-0');
                setTimeout(() => modal.classList.add('hidden'), 300);
            }
        }

        // Aspect Ratio Cycling (Fit, Fill, 16:9, 4:3)
        const aspectModes = ['aspect-fit', 'aspect-fill', 'aspect-16-9', 'aspect-4-3'];
        const aspectLabels = ['FIT', 'FILL', '16:9', '4:3'];
        let currentAspectIdx = 0;
        function cycleAspectRatio() {
            const video = document.getElementById('video-player');
            if (!video) return;
            aspectModes.forEach(m => video.classList.remove(m));
            currentAspectIdx = (currentAspectIdx + 1) % aspectModes.length;
            video.classList.add(aspectModes[currentAspectIdx]);
            const label = document.getElementById('btn-aspect-label');
            if (label) label.textContent = aspectLabels[currentAspectIdx];
            showToast(`Aspect Ratio: ${aspectLabels[currentAspectIdx]}`);
        }

        // 10-Foot Remote Number Dialing (2-second timeout HUD)
        let dialBuffer = '';
        let dialTimeout = null;

        function handleNumberDial(digit) {
            dialBuffer += digit;
            const hud = document.getElementById('number-dial-hud');
            const valEl = document.getElementById('number-dial-value');
            if (hud && valEl) {
                valEl.textContent = dialBuffer;
                hud.classList.remove('hidden');
            }
            clearTimeout(dialTimeout);
            dialTimeout = setTimeout(() => {
                executeNumberDial(dialBuffer);
                dialBuffer = '';
                if (hud) hud.classList.add('hidden');
            }, 2000);
        }

        function executeNumberDial(buf) {
            const targetNum = parseInt(buf, 10);
            if (isNaN(targetNum) || targetNum <= 0) return;
            
            let target = null;
            if (state.currentPlaylist && state.currentPlaylist.length > 0) {
                target = state.currentPlaylist.find(c => parseInt(c.num || c.id, 10) === targetNum) || state.currentPlaylist[targetNum - 1];
            } else if (state.activeCategoryStreams && state.activeCategoryStreams.length > 0) {
                target = state.activeCategoryStreams.find(c => parseInt(c.num || c.id, 10) === targetNum) || state.activeCategoryStreams[targetNum - 1];
            }

            if (target) {
                showToast(`Zapping to CH ${targetNum}: ${target.title || target.name}`);
                executePlayerEngine(target);
            } else {
                showToast(`Channel ${targetNum} not found`);
            }
        }

        // Source Modal Tabs Switcher
        function switchSourceTab(tabId) {
            ['xc', 'm3u', 'file', 'privacy'].forEach(t => {
                const btn = document.getElementById(`tab-btn-${t}`);
                const panel = document.getElementById(`panel-source-${t}`);
                if (btn) {
                    if (t === tabId) {
                        btn.className = 'pb-3 border-b-2 border-primary text-primary flex-shrink-0';
                        btn.setAttribute('aria-selected', 'true');
                    } else {
                        btn.className = 'pb-3 border-b-2 border-transparent text-gray-400 hover:text-white transition-colors flex-shrink-0';
                        btn.setAttribute('aria-selected', 'false');
                    }
                }
                if (panel) panel.classList.toggle('hidden', t !== tabId);
            });
            const testBtn = document.getElementById('btn-test-conn');
            if (testBtn) testBtn.style.display = (tabId === 'xc') ? 'flex' : 'none';
        }

        // User Data Export & Wipe
        function exportAllUserData() {
            const backup = {
                app: 'AURA IPTV',
                version: '2.0.0',
                exportedAt: new Date().toISOString(),
                config: {
                    server: config.server || '',
                    user: config.user || ''
                    // Passwords omitted by default to protect credentials
                },
                favorites: state.favorites || [],
                history: state.history || [],
                tvPrefs: tvPrefs || {}
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `aura-iptv-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('User data exported successfully');
        }

        function eraseAllUserData() {
            if (!confirm('Are you sure you want to erase all data? This will clear all playlists, favorites, history, and local credentials.')) {
                return;
            }
            localStorage.clear();
            showToast('All local data cleared. Resetting...');
            setTimeout(() => location.reload(), 800);
        }

        // M3U URL Ingestion
        async function loadM3uUrlSource() {
            const urlInput = document.getElementById('m3u-url-input');
            const url = urlInput?.value?.trim();
            if (!url) {
                showToast('Please enter an M3U or M3U8 URL');
                return;
            }
            showToast('Fetching remote playlist...');
            try {
                const fetchUrl = window.auraNative?.mediaProxy ? window.auraNative.mediaProxy(url) : url;
                const res = await fetch(fetchUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                const content = await res.text();
                if (!content.includes('#EXTM3U')) {
                    throw new Error('Response is not a valid M3U playlist');
                }
                parseAndApplyM3u(content);
                closeProfileModal();
            } catch (err) {
                showToast(`Failed to load M3U: ${err.message}`);
            }
        }

        // Local File Ingestion
        function handleLocalFileUpload(event) {
            const file = event.target?.files?.[0];
            if (!file) return;
            showToast(`Reading ${file.name}...`);
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                parseAndApplyM3u(text);
                closeProfileModal();
            };
            reader.onerror = () => showToast('Error reading local file');
            reader.readAsText(file);
        }

        // Playlist Web Worker Runner
        function parseAndApplyM3u(content) {
            showToast('Parsing playlist in background worker...');
            try {
                const worker = new Worker('./js/playlist-worker.js');
                worker.postMessage({ type: 'PARSE_M3U', data: content });
                worker.onmessage = (e) => {
                    const msg = e.data;
                    if (msg.type === 'PROGRESS') {
                        const spinnerText = document.querySelector('#main-grid p');
                        if (spinnerText) spinnerText.textContent = `Parsing playlist: ${msg.progress}% (${msg.count} channels)...`;
                    } else if (msg.type === 'DONE_M3U') {
                        const { channels, categories, categoryMap } = msg;
                        state.categoryMap = categoryMap;
                        state.categories.live = categories;
                        state.allLiveCategories = categories;
                        state.streams = {};

                        channels.forEach(ch => {
                            const cat = categories.find(c => c.category_name === ch.category_name);
                            const catId = cat ? cat.category_id : 'cat_1';
                            if (!state.streams[catId]) state.streams[catId] = [];
                            state.streams[catId].push({
                                id: ch.stream_id,
                                name: ch.name || ch.title,
                                title: ch.name || ch.title,
                                stream_icon: ch.stream_icon || '',
                                stream_type: ch.type,
                                type: ch.type,
                                streamUrl: ch.url,
                                num: ch.num,
                                category_id: catId
                            });
                        });

                        tvPrefs.setupComplete = true;
                        tvPrefs.categories = categories.map(c => c.category_id);
                        localStorage.setItem('aura_tv_prefs', JSON.stringify(tvPrefs));

                        config.user = config.user || 'Local Playlist';
                        localStorage.setItem('aura_config', JSON.stringify(config));

                        const sUname = document.getElementById('sidebar-username');
                        if (sUname) sUname.textContent = config.user;
                        const sStatus = document.getElementById('sidebar-user-status');
                        if (sStatus) sStatus.textContent = `${channels.length} Channels`;

                        showToast(`Loaded ${channels.length} channels!`);
                        setTab('live');
                        worker.terminate();
                    } else if (msg.type === 'ERROR') {
                        showToast(`Parsing error: ${msg.error}`);
                        worker.terminate();
                    }
                };
            } catch (err) {
                console.error("Worker spawn error:", err);
                showToast("Worker error. Ingesting directly...");
            }
        }

        // Onboarding Screen for First Run
        function renderOnboardingCard() {
            const grid = document.getElementById('main-grid');
            if (!grid) return;
            grid.innerHTML = `
                <div class="col-span-full max-w-3xl mx-auto pt-10 pb-16 px-4">
                    <div class="text-center mb-10">
                        <div class="inline-flex items-center gap-2 bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-xs font-black tracking-widest uppercase mb-4">
                            <i class="fa-solid fa-play"></i> Welcome to AURA IPTV
                        </div>
                        <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3">Add a source to get started</h2>
                        <p class="text-gray-400 text-sm max-w-lg mx-auto leading-relaxed">
                            AURA is a high-performance, private, client-side IPTV player. Connect your provider account or import a playlist below.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                        <div onclick="openProfileModal('xc')" class="bg-panelbg border border-white/10 hover:border-primary/50 hover:bg-white/5 p-6 rounded-2xl cursor-pointer transition-all flex flex-col items-center text-center group">
                            <div class="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-2xl mb-4 group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-satellite-dish"></i>
                            </div>
                            <h3 class="text-base font-bold text-white mb-1">Xtream Codes</h3>
                            <p class="text-xs text-gray-400 leading-normal">Connect via Server URL, username, and password.</p>
                        </div>

                        <div onclick="openProfileModal('m3u')" class="bg-panelbg border border-white/10 hover:border-blue-500/50 hover:bg-white/5 p-6 rounded-2xl cursor-pointer transition-all flex flex-col items-center text-center group">
                            <div class="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-2xl mb-4 group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-link"></i>
                            </div>
                            <h3 class="text-base font-bold text-white mb-1">M3U Playlist URL</h3>
                            <p class="text-xs text-gray-400 leading-normal">Stream from any remote M3U or M3U8 playlist link.</p>
                        </div>

                        <div onclick="openProfileModal('file')" class="bg-panelbg border border-white/10 hover:border-green-500/50 hover:bg-white/5 p-6 rounded-2xl cursor-pointer transition-all flex flex-col items-center text-center group">
                            <div class="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 text-2xl mb-4 group-hover:scale-110 transition-transform">
                                <i class="fa-solid fa-file-arrow-up"></i>
                            </div>
                            <h3 class="text-base font-bold text-white mb-1">Local File</h3>
                            <p class="text-xs text-gray-400 leading-normal">Load .m3u, .m3u8, or XMLTV files directly from your disk.</p>
                        </div>
                    </div>

                    <div class="bg-black/30 border border-white/5 rounded-2xl p-4 text-xs text-gray-400 text-center flex items-center justify-center gap-2">
                        <i class="fa-solid fa-shield-halved text-green-400 text-sm"></i>
                        <span><b>Zero Telemetry</b>: Your sources and credentials stay strictly on your device.</span>
                    </div>
                </div>
            `;
        }

        // State Architecture
        let config = safeJSON('aura_config', { server: '', user: '', pass: '' });
        function getServer() { return (config.server || '').trim().replace(/\/+$/, ''); }

        let searchToken = 0, searchTimer = null, controlsTimer = null, playerBlobUrl = null, currentActiveMovie = null;
        let tvPrefs = safeJSON('aura_tv_prefs', { setupComplete: false, categories: [], customized: {} });
        let tempTvPrefs = null;

        const state = {
            currentActiveMovie: null,
            categories: { vod: [], live: [], series: [] },
            allLiveCategories: [], 
            categoryMap: {}, 
            streams: {}, 
            history: safeArray('aura_history'),
            favorites: safeArray('aura_favorites'),
            playerEngine: null,
            candidateWatchdog: null,
            playbackSessionId: 0,
            drawerSearch: '',
            drawerFilter: 'all',
            globalSearchCache: [], 
            isFetchingSearch: false,
            currentTab: 'vod', // Default to Movies
            currentPlaylist: [],
            currentIndex: -1,
            currentSeriesMovie: null,
            currentDetailMovie: null,
            currentSeriesEpisodes: [],
            seriesSeasons: [],
            playingSeries: false,
            activeCategoryStreams: [],
            currentSort: 'popular',
            currentFilterPill: 'all',
            searchFilterType: 'all',
            activeStreamUrl: ''
        };

        function isFavorite(id) {
            return state.favorites.some(f => String(f.id) === String(id));
        }

        function toggleFavorite(movie, event) {
            if (event) event.stopPropagation();
            if (typeof movie === 'string') {
                try {
                    movie = JSON.parse(decodeURIComponent(movie));
                } catch (e) {
                    console.error("toggleFavorite parse error:", e);
                    return;
                }
            }
            if (!movie || !movie.id) return;
            const id = String(movie.id);
            const idx = state.favorites.findIndex(f => String(f.id) === id);
            if (idx > -1) {
                state.favorites.splice(idx, 1);
                showToast(`Removed from Favorites`);
            } else {
                state.favorites.unshift(movie);
                showToast(`Added to Favorites`);
            }
            localStorage.setItem('aura_favorites', JSON.stringify(state.favorites));
            
            // Update heart icons across the UI
            document.querySelectorAll(`.fav-btn-${id}`).forEach(btn => {
                const fav = isFavorite(id);
                btn.innerHTML = fav ? '<i class="fa-solid fa-heart text-red-500"></i>' : '<i class="fa-regular fa-heart"></i>';
            });
            const detailFavBtn = document.getElementById('detail-fav-btn');
            if (detailFavBtn && state.currentDetailMovie && String(state.currentDetailMovie.id) === id) {
                detailFavBtn.innerHTML = isFavorite(id) ? '<i class="fa-solid fa-heart text-red-500"></i>' : '<i class="fa-regular fa-heart"></i>';
            }

            if (state.currentTab === 'favorites') {
                renderFavoritesView();
            }
        }

        function showCastInfo() {
            showToast("AirPlay / Cast: Open macOS Control Center > Screen Mirroring to cast to Apple TV or smart displays.");
        }

        function initLetterPills() {
            const container = document.getElementById('letter-pills');
            if (!container) return;
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
            container.innerHTML = letters.map(l => `
                <button onclick="applyFilterPill('${l}', this)" class="filter-pill px-2.5 py-1 bg-transparent text-gray-500 hover:text-white text-xs font-semibold rounded flex-shrink-0 transition-colors select-none" style="touch-action: manipulation;">${l}</button>
            `).join('');
        }

        // --- Initialization & UI Triggers ---
        document.addEventListener('DOMContentLoaded', async () => {
            initPlayerUX();
            initLetterPills();
            
            const uname = config.user || 'Guest User';
            const sUname = document.getElementById('sidebar-username');
            if (sUname) sUname.textContent = uname;
            const avatar = document.getElementById('sidebar-avatar');
            if (avatar) avatar.textContent = uname[0].toUpperCase();
            
            // Synchronously sync initial navigation tab state (Default: Movies)
            setTab(state.currentTab || 'vod');

            if (!getServer() || !config.user || config.user === 'guest') {
                setTimeout(openProfileModal, 500);
            }
            
            await loadDashboard();
        });

        // Mobile Sidebar Drawer Toggle
        function toggleSidebar() {
            const sb = document.getElementById('app-sidebar');
            const bd = document.getElementById('sidebar-backdrop');
            if (!sb) return;
            sb.classList.toggle('-translate-x-full');
            if (bd) {
                if (sb.classList.contains('-translate-x-full')) bd.classList.add('hidden');
                else bd.classList.remove('hidden');
            }
        }

        function triggerSeekRipple(dir) {
            const ripple = document.getElementById(`seek-ripple-${dir}`);
            if (!ripple) return;
            ripple.classList.add('active');
            setTimeout(() => ripple.classList.remove('active'), 400);
        }

        window.isStreamLive = function() {
            // 1. Most reliable: check the currently playing movie object
            const m = currentActiveMovie || state?.currentActiveMovie;
            if (m) {
                if (m.type === 'vod' || m.type === 'series' || m.type === 'episode') return false;
                if (m.type === 'live' || m.stream_type === 'live' || m.stream_type === 'live_stream') return true;
                // Title heuristic (e.g. "CRIC || WILLOW 2 HD LIVE")
                if (/\blive\b/i.test(m.title || '') || /\/live\//i.test(m.streamUrl || '')) return true;
            }
            // 2. Tab is live
            if (typeof state !== 'undefined' && state.currentTab === 'live') return true;
            // 3. HLS engine reports live
            if (typeof state !== 'undefined' && state.playerEngine) {
                if (state.playerEngine.liveSyncPosition !== null && state.playerEngine.liveSyncPosition !== undefined) return true;
                const curLevel = state.playerEngine.levels?.[state.playerEngine.currentLevel]?.details;
                if (curLevel && curLevel.live) return true;
                if (state.playerEngine.isLive) return true;
            }
            // 4. Video duration is Infinity (definitive live marker)
            const video = document.getElementById('video-player');
            if (video && video.duration === Infinity) return true;
            return false;
        };

        window.goToLiveEdge = function() {
            const video = document.getElementById('video-player');
            if (!video) return;
            try {
                if (state.playerEngine && typeof state.playerEngine.liveSyncPosition === 'number' && !isNaN(state.playerEngine.liveSyncPosition)) {
                    video.currentTime = state.playerEngine.liveSyncPosition;
                } else if (video.seekable && video.seekable.length > 0) {
                    const edge = video.seekable.end(video.seekable.length - 1);
                    video.currentTime = Math.max(0, edge - 0.5);
                } else if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
                    video.currentTime = Math.max(0, video.duration - 0.5);
                }
            } catch (e) {
                console.warn("goToLiveEdge error:", e);
            }
            if (video.paused) {
                video.play().catch(() => {});
            }
            const btn = document.getElementById('btn-go-live');
            if (btn) {
                btn.classList.add('scale-105', 'bg-red-500');
                setTimeout(() => btn.classList.remove('scale-105', 'bg-red-500'), 250);
            }
            window.showPlayerControls && window.showPlayerControls(true);
        };

        let lastControlsOpenedTime = 0;

        function togglePlayerControls() {
            const pc = document.getElementById('player-controls');
            const video = document.getElementById('video-player');
            if (!pc || !video) return;
            const isShowing = pc.classList.contains('!opacity-100');
            if (isShowing) {
                // If controls were opened very recently (< 1200ms ago), ignore toggle off
                if (Date.now() - lastControlsOpenedTime < 1200) {
                    window.showPlayerControls && window.showPlayerControls(true);
                    return;
                }
                // Never auto-dismiss while video is paused
                if (video.paused) {
                    window.showPlayerControls && window.showPlayerControls(true);
                    return;
                }
                pc.classList.remove('!opacity-100');
                pc.classList.add('opacity-0');
                clearTimeout(controlsTimer);
                document.body.style.cursor = 'none';
            } else {
                // Controls hidden: show them (do NOT pause/play)
                window.showPlayerControls && window.showPlayerControls(true);
            }
        }

        function initPlayerUX() {
            const pm = document.getElementById('player-modal'), pc = document.getElementById('player-controls');
            const video = document.getElementById('video-player');

            // Track whether a control button/input is being actively interacted with
            // so we can hold the auto-hide timer open while the user is using controls.
            let controlInteracting = false;
            let controlInteractTimer = null;

            const holdControls = () => {
                controlInteracting = true;
                clearTimeout(controlInteractTimer);
                controlInteractTimer = setTimeout(() => { controlInteracting = false; }, 3500);
            };

            const show = (extendForInteraction = false) => {
                const wasHidden = !pc.classList.contains('!opacity-100');
                pc.classList.remove('opacity-0');
                pc.classList.add('!opacity-100');
                if (wasHidden) {
                    lastControlsOpenedTime = Date.now();
                }
                document.body.style.cursor = 'default';
                clearTimeout(controlsTimer);
                // When the user just touched a button/slider, give a longer timeout so controls
                // don't vanish mid-interaction (volume drag, seek, channel switch, etc.)
                const delay = (extendForInteraction || controlInteracting) ? 5500 : 4500;
                controlsTimer = setTimeout(() => {
                    const drawer = document.getElementById('player-drawer');
                    const drawerClosed = !drawer || drawer.classList.contains('translate-x-full');
                    // Never auto-hide while paused, while interacting, or while drawer is open,
                    // or within 4s of the controls being first shown (protects against the
                    // "controls vanish instantly on stream start" bug on mobile)
                    const justOpened = (Date.now() - lastControlsOpenedTime) < 3500;
                    if (!video.paused && !controlInteracting && !justOpened &&
                        document.getElementById('player-error').classList.contains('hidden') && drawerClosed) {
                        pc.classList.remove('!opacity-100');
                        pc.classList.add('opacity-0');
                        document.body.style.cursor = 'none';
                    } else if (controlInteracting || !drawerClosed || video.paused || justOpened) {
                        // If still interacting or paused, reschedule
                        show(true);
                    }
                }, delay);
            };
            window.showPlayerControls = show;

            // Bind touch listeners on sliders & control bar to hold controls open
            const volBar = document.getElementById('volume-bar');
            const seekBar = document.getElementById('seek-bar');
            [volBar, seekBar].forEach(el => {
                if (!el) return;
                ['touchstart', 'touchmove', 'touchend', 'input', 'change'].forEach(ev => {
                    el.addEventListener(ev, () => {
                        holdControls();
                        show(true);
                    }, { passive: true });
                });
            });

            const bottomBar = pc.querySelector('.player-gradient');
            if (bottomBar) {
                bottomBar.addEventListener('touchstart', () => {
                    holdControls();
                    show(true);
                }, { passive: true });
            }

            // Mouse move on desktop shows controls
            pm.addEventListener('mousemove', () => show());

            // Mobile Touch Gestures: Single-tap toggles controls, Double-tap seeks +/-10s (VOD only), Vertical swipe on right side adjusts volume
            let touchStartX = 0;
            let touchStartY = 0;
            let isSwipingVolume = false;
            let initialVolume = 1;
            let lastTapTime = 0;
            let singleTapTimeout = null;

            pm.addEventListener('touchstart', (e) => {
                const isControlElement = e.target.closest('#player-drawer') ||
                    e.target.closest('#subtitles-modal') ||
                    e.target.closest('#quality-modal') ||
                    e.target.closest('button') ||
                    e.target.closest('input') ||
                    e.target.closest('#player-controls .player-gradient') ||
                    e.target.closest('#player-controls > div:first-child');

                if (isControlElement) {
                    // User touched a control — keep controls visible and extend timer
                    holdControls();
                    show(true);
                    return;
                }
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    isSwipingVolume = false;
                    initialVolume = video.volume;
                }
            }, { passive: true });

            pm.addEventListener('touchmove', (e) => {
                if (e.touches.length !== 1) return;
                const touchCurX = e.touches[0].clientX;
                const touchCurY = e.touches[0].clientY;
                const deltaX = touchCurX - touchStartX;
                const deltaY = touchCurY - touchStartY;
                const rect = video.getBoundingClientRect();

                // Check for vertical volume gesture on right half of video screen
                const isRightHalf = (touchStartX - rect.left) > (rect.width * 0.5);
                if (isRightHalf && Math.abs(deltaY) > 20 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
                    isSwipingVolume = true;
                    // Dragging up increases volume, dragging down decreases
                    const change = -deltaY / 220;
                    let newVol = Math.max(0, Math.min(1, Math.round((initialVolume + change) * 100) / 100));
                    video.volume = newVol;
                    video.muted = (newVol === 0);
                    localStorage.setItem('aura_volume', String(newVol));
                    syncVolumeUI(true);
                    show(true);
                }
            }, { passive: true });

            pm.addEventListener('touchend', (e) => {
                const isControlElement = e.target.closest('#player-drawer') ||
                    e.target.closest('#subtitles-modal') ||
                    e.target.closest('#quality-modal') ||
                    e.target.closest('button') ||
                    e.target.closest('input') ||
                    e.target.closest('#player-controls .player-gradient') ||
                    e.target.closest('#player-controls > div:first-child');

                if (isControlElement) {
                    // Touched a control element — refresh hold, do NOT toggle play/pause
                    holdControls();
                    show(true);
                    return;
                }

                if (isSwipingVolume) {
                    isSwipingVolume = false;
                    show(true);
                    return;
                }

                if (!e.changedTouches || e.changedTouches.length !== 1) return;
                const touchEndX = e.changedTouches[0].clientX;
                const touchEndY = e.changedTouches[0].clientY;
                if (Math.abs(touchEndX - touchStartX) > 25 || Math.abs(touchEndY - touchStartY) > 25) return;

                const now = Date.now();
                const rect = video.getBoundingClientRect();
                const x = touchEndX - rect.left;
                const width = rect.width;
                const live = (typeof window.isStreamLive === 'function') ? window.isStreamLive() : false;

                if (now - lastTapTime < 320) {
                    // Double Tap Detected!
                    clearTimeout(singleTapTimeout);
                    singleTapTimeout = null;
                    lastTapTime = 0;

                    if (!live && x < width * 0.38) {
                        // Rewind 10s (VOD only)
                        video.currentTime = Math.max(0, video.currentTime - 10);
                        triggerSeekRipple('left');
                        show(true);
                    } else if (!live && x > width * 0.62) {
                        // Fast Forward 10s (VOD only)
                        video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
                        triggerSeekRipple('right');
                        show(true);
                    } else {
                        // Center double tap: Fullscreen
                        toggleNativeFullScreen();
                    }
                } else {
                    lastTapTime = now;
                    singleTapTimeout = setTimeout(() => {
                        singleTapTimeout = null;
                        // Single tap on video surface: toggle controls visibility only.
                        // NEVER pause/play from a bare surface tap on mobile — too error-prone.
                        const isVisible = pc.classList.contains('!opacity-100');
                        if (!isVisible) {
                            show(false);
                        } else if (Date.now() - lastControlsOpenedTime >= 2000 && !controlInteracting) {
                            // Controls have been showing long enough — dismiss
                            pc.classList.remove('!opacity-100');
                            pc.classList.add('opacity-0');
                            clearTimeout(controlsTimer);
                            document.body.style.cursor = 'none';
                        } else {
                            // Keep visible — reset timer
                            show(false);
                        }
                    }, 280);
                }
            });

            // Smooth mouse wheel / trackpad volume scroll support
            const handleVolWheel = (e) => {
                if (e.target.closest('#drawer-list') || e.target.closest('#subtitles-track-list')) return;
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.04 : -0.04;
                let v = Math.round((video.volume + delta) * 100) / 100;
                v = Math.max(0, Math.min(1, v));
                video.volume = v;
                if (v > 0 && video.muted) video.muted = false;
                else if (v === 0) video.muted = true;
                localStorage.setItem('aura_volume', String(v));
                syncVolumeUI(true);
                show();
            };
            pm.addEventListener('wheel', handleVolWheel, { passive: false });
            
            // Desktop mouse click: single click shows controls, double click = fullscreen.
            // NEVER pauses or plays video from bare surface click — playback via playBtn/spacebar only.
            // On mobile, touchend fires first and sets lastTapTime; a subsequent synthetic click
            // within 800 ms is ignored to prevent double-toggle.
            let clickTimeout = null;
            let lastTouchEndTime = 0;
            pm.addEventListener('touchend', () => { lastTouchEndTime = Date.now(); }, { passive: true, capture: true });

            video.addEventListener('click', (e) => {
                // Block synthetic click generated by mobile touchend (within 800 ms)
                if (Date.now() - lastTouchEndTime < 800) { e.stopPropagation(); return; }
                if (Date.now() - lastTapTime < 600) return;
                if (clickTimeout) {
                    clearTimeout(clickTimeout);
                    clickTimeout = null;
                    toggleNativeFullScreen();
                } else {
                    clickTimeout = setTimeout(() => {
                        clickTimeout = null;
                        // Desktop single click: toggle controls — never pause/play
                        togglePlayerControls();
                    }, 250);
                }
            });

            document.addEventListener('keydown', (e) => {
                if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
                const playerOpen = !pm.classList.contains('hidden');
                
                if (e.key === 'Escape' || e.key === 'Backspace') {
                    if (e.key === 'Backspace' && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
                    if (!document.getElementById('shortcuts-modal').classList.contains('hidden')) toggleShortcutsModal();
                    else if (!document.getElementById('manage-tv-modal').classList.contains('hidden')) closeManageTV();
                    else if (!document.getElementById('profile-modal').classList.contains('hidden')) closeProfileModal();
                    else if (!document.getElementById('quality-modal').classList.contains('hidden')) toggleQualityModal();
                    else if (!document.getElementById('subtitles-modal').classList.contains('hidden')) document.getElementById('subtitles-modal').classList.add('hidden');
                    else if (!document.getElementById('player-drawer').classList.contains('translate-x-full')) togglePlayerDrawer();
                    else if (playerOpen) {
                        closePlayer();
                    }
                    else if (!document.getElementById('detail-overlay').classList.contains('hidden')) closeDetailView();
                } else if (playerOpen) {
                    show();
                    if (e.key === ' ') {
                        e.preventDefault();
                        video.paused ? video.play() : video.pause();
                    } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        video.currentTime += 10;
                    } else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        video.currentTime -= 10;
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (state.playingSeries || state.currentTab === 'live') changeChannel(1);
                        else { 
                            video.volume = Math.min(1, Math.round((video.volume + 0.05) * 100) / 100); 
                            if (video.muted) video.muted = false;
                            localStorage.setItem('aura_volume', String(video.volume));
                            syncVolumeUI(true); 
                        }
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (state.playingSeries || state.currentTab === 'live') changeChannel(-1);
                        else { 
                            video.volume = Math.max(0, Math.round((video.volume - 0.05) * 100) / 100); 
                            if (video.volume === 0) video.muted = true;
                            localStorage.setItem('aura_volume', String(video.volume));
                            syncVolumeUI(true); 
                        }
                    } else if (e.key.toLowerCase() === 'f') {
                        e.preventDefault();
                        toggleNativeFullScreen();
                    } else if (e.key.toLowerCase() === 'm') {
                        e.preventDefault();
                        toggleMute();
                    } else if (e.key.toLowerCase() === 'p') {
                        e.preventDefault();
                        togglePiP();
                    } else if (e.key.toLowerCase() === 'q') {
                        e.preventDefault();
                        toggleQualityModal();
                    } else if (e.key.toLowerCase() === 'a') {
                        e.preventDefault();
                        cycleAspectRatio();
                    } else if (e.key.toLowerCase() === 'c') {
                        e.preventDefault();
                        togglePlayerDrawer();
                    } else if (e.key.toLowerCase() === 'l' || (e.key === '0' && !dialBuffer)) {
                        // Recall Last Channel
                        if (state.lastWatchedMovie) {
                            e.preventDefault();
                            showToast(`Recalling: ${state.lastWatchedMovie.title || state.lastWatchedMovie.name}`);
                            executePlayerEngine(state.lastWatchedMovie);
                        }
                    } else if (e.key >= '0' && e.key <= '9') {
                        e.preventDefault();
                        handleNumberDial(e.key);
                    }
                } else {
                    // Global Hotkeys Outside Player
                    if (e.key === '?') {
                        e.preventDefault();
                        toggleShortcutsModal();
                    } else if (e.key === '/') {
                        e.preventDefault();
                        setTab('search');
                        setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
                    } else if (e.key.toLowerCase() === 't') {
                        e.preventDefault();
                        document.body.classList.toggle('tv-mode');
                        showToast(document.body.classList.contains('tv-mode') ? '10-Foot TV Mode: Enabled' : '10-Foot TV Mode: Disabled');
                    } else if (e.key >= '1' && e.key <= '9') {
                        handleNumberDial(e.key);
                    }
                }
            });
        }

        // --- Modals (Settings & Live TV Manage) ---
        function openProfileModal(initialTab = 'xc') {
            switchSourceTab(initialTab);
            const sInput = document.getElementById('prof-server');
            const uInput = document.getElementById('prof-user');
            const pInput = document.getElementById('prof-pass');
            if (sInput) sInput.value = config.server || '';
            if (uInput) uInput.value = config.user || '';
            if (pInput) pInput.value = config.pass || '';

            const statusEl = document.getElementById('conn-test-status');
            if (statusEl) {
                statusEl.className = 'hidden';
                statusEl.innerHTML = '';
            }
            const modal = document.getElementById('profile-modal');
            const content = document.getElementById('profile-content');
            if (modal) {
                modal.classList.remove('hidden', 'opacity-0');
                modal.classList.add('opacity-100');
            }
            if (content) {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }
            setTimeout(() => {
                if (initialTab === 'xc' && sInput) {
                    sInput.focus();
                    if (!sInput.value) sInput.select();
                } else if (initialTab === 'm3u') {
                    document.getElementById('m3u-url-input')?.focus();
                }
            }, 60);
        }

        function closeProfileModal() {
            const modal = document.getElementById('profile-modal');
            const content = document.getElementById('profile-content');
            if (modal) {
                modal.classList.remove('opacity-100');
                modal.classList.add('opacity-0');
            }
            if (content) {
                content.classList.remove('scale-100', 'opacity-100');
                content.classList.add('scale-95', 'opacity-0');
            }
            setTimeout(() => {
                if (modal) modal.classList.add('hidden');
            }, 300);
        }

        async function testConnection() {
            const statusEl = document.getElementById('conn-test-status');
            let s = document.getElementById('prof-server').value.trim().replace(/\/+$/, '');
            const u = document.getElementById('prof-user').value.trim();
            const p = document.getElementById('prof-pass').value.trim();
            
            if (!s || !u || !p) {
                statusEl.className = 'conn-status fail block text-center py-2';
                statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Please enter Server URL, Username, and Password';
                statusEl.classList.remove('hidden');
                return;
            }
            if (!/^https?:\/\//i.test(s)) s = `http://${s}`;

            // Mixed content check
            const isMixed = window.location.protocol === 'https:' && s.startsWith('http://') && !window.location.hostname.includes('localhost');

            statusEl.className = 'conn-status testing block text-center py-2';
            statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying provider account &amp; EPG...';
            statusEl.classList.remove('hidden');

            try {
                if (!window.auraNative?.testConnection) {
                    throw new Error("Native network bridge unavailable");
                }
                const res = await window.auraNative.testConnection({ server: s, user: u, pass: p });
                if (res.success && res.data) {
                    const ui = res.data.user_info || {};
                    const si = res.data.server_info || {};
                    const exp = ui.exp_date ? (ui.exp_date === 'null' || !parseInt(ui.exp_date) ? 'Never (Unlimited)' : new Date(parseInt(ui.exp_date) * 1000).toLocaleDateString()) : 'Active';
                    const hasEpg = si.url && si.url.includes('xmltv') || si.timezone;
                    
                    statusEl.className = 'conn-status ok block text-left p-3';
                    statusEl.innerHTML = `
                        <div class="flex items-center gap-2 font-bold mb-1"><i class="fa-solid fa-circle-check text-green-400"></i> Account Verified (200 OK)</div>
                        <div class="text-[11px] text-gray-300 space-y-0.5">
                            <div><b>Status:</b> <span class="text-green-400 uppercase font-bold">${esc(ui.status || 'Active')}</span> | <b>Max Streams:</b> ${esc(ui.max_connections || '1')}</div>
                            <div><b>Expires:</b> ${esc(exp)} | <b>EPG Timezone:</b> ${esc(si.timezone || 'UTC')}</div>
                            ${isMixed ? '<div class="text-yellow-400 mt-1 font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> Provider uses HTTP; stream proxy will be used for HTTPS browser compatibility.</div>' : ''}
                        </div>`;
                    showToast('Connection verified successfully!');
                } else {
                    let errReason = res.error || 'Authentication rejected by provider';
                    if (errReason.includes('401') || errReason.includes('403')) {
                        errReason = '401/403: Invalid username or password, or expired subscription';
                    } else if (errReason.includes('HTML')) {
                        errReason = 'Server returned HTML instead of Xtream JSON. Check domain & port.';
                    }
                    statusEl.className = 'conn-status fail block text-center py-2';
                    statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${esc(errReason)}`;
                }
            } catch (err) {
                let errMsg = err.message || 'Connection failed';
                if (isMixed && errMsg.toLowerCase().includes('failed to fetch')) {
                    errMsg = 'Mixed content / CORS blocked: Browser on HTTPS blocked HTTP request. Enable proxy or try https://';
                }
                statusEl.className = 'conn-status fail block text-center py-2';
                statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${esc(errMsg)}`;
            }
        }

        async function saveProfile() {
            let s = document.getElementById('prof-server').value.trim().replace(/\/+$/, '');
            const u = document.getElementById('prof-user').value.trim();
            const p = document.getElementById('prof-pass').value.trim();

            if (!s || !u || !p) {
                showToast('Please enter Server URL, Username, and Password');
                const statusEl = document.getElementById('conn-test-status');
                if (statusEl) {
                    statusEl.className = 'conn-status fail block text-center py-2';
                    statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Server, Username, and Password are required';
                    statusEl.classList.remove('hidden');
                }
                return;
            }

            if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
            
            config = {
                server: s,
                user: u,
                pass: p
            };
            localStorage.setItem('aura_config', JSON.stringify(config));
            
            document.getElementById('sidebar-username').textContent = config.user || 'Guest User';
            const avatar = document.getElementById('sidebar-avatar');
            if (avatar) avatar.textContent = (config.user || 'G')[0].toUpperCase();

            closeProfileModal();
            showToast('Credentials saved! Connecting to provider...');
            
            state.streams = {};
            state.globalSearchCache = [];
            state.categories = { vod: [], live: [], series: [] };
            state.allLiveCategories = [];
            state.categoryMap = {};
            tvPrefs = { setupComplete: false, categories: [], customized: {} };
            localStorage.removeItem('aura_tv_prefs');

            await loadDashboard();
        }

        function openManageTV() {
            if(!document.getElementById('profile-modal').classList.contains('hidden')) closeProfileModal();
            tempTvPrefs = JSON.parse(JSON.stringify(tvPrefs));
            const modal = document.getElementById('manage-tv-modal');
            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.replace('opacity-0', 'opacity-100');
            document.getElementById('manage-tv-search').value = '';
            renderManageCats();
        }

        function closeManageTV() {
            const modal = document.getElementById('manage-tv-modal');
            modal.classList.replace('opacity-100', 'opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }

        function saveManageTV() {
            tempTvPrefs.setupComplete = true;
            tvPrefs = JSON.parse(JSON.stringify(tempTvPrefs));
            localStorage.setItem('aura_tv_prefs', JSON.stringify(tvPrefs));
            closeManageTV();
            
            // Reversible filter update without data loss or hard page reload
            const activeCatIds = new Set((tvPrefs.categories || []).map(id => String(id)));
            state.categories.live = state.allLiveCategories.filter(c => activeCatIds.has(String(c.category_id)));
            
            const totalCats = state.allLiveCategories.length;
            const hiddenCount = Math.max(0, totalCats - state.categories.live.length);
            
            renderSidebarCategories();
            if (state.currentTab === 'live') {
                if (state.categories.live.length > 0) {
                    renderGridContent(state.categories.live[0].category_id);
                } else {
                    const grid = document.getElementById('main-grid');
                    if (grid) {
                        grid.innerHTML = `
                            <div class="col-span-full flex flex-col items-center justify-center pt-24 text-center px-4">
                                <i class="fa-solid fa-eye-slash text-4xl text-gray-500 mb-3" aria-hidden="true"></i>
                                <h3 class="text-lg font-bold text-white mb-1">All Live TV Categories are Hidden</h3>
                                <p class="text-xs text-gray-400 mb-4 max-w-sm">You have hidden all channels in your filter settings.</p>
                                <button onclick="restoreAllManageCats()" class="bg-primary hover:bg-red-700 text-white px-5 py-2 rounded-lg text-xs font-bold transition-colors">Restore All Categories</button>
                            </div>
                        `;
                    }
                }
            }
            showToast(hiddenCount > 0 ? `${hiddenCount} categories hidden (reversible)` : 'All categories visible');
        }

        function restoreAllManageCats() {
            tempTvPrefs.categories = state.allLiveCategories.map(c => String(c.category_id));
            saveManageTV();
        }

        function renderManageCats(query = '') {
            const list = document.getElementById('manage-tv-list');
            const q = query.toLowerCase();
            const filtered = state.allLiveCategories.filter(c => c.category_name.toLowerCase().includes(q));
            
            const hiddenEl = document.getElementById('manage-tv-hidden-count');
            if (hiddenEl) {
                const total = state.allLiveCategories.length;
                const visible = tempTvPrefs.categories.length;
                const hidden = Math.max(0, total - visible);
                if (hidden > 0) {
                    hiddenEl.textContent = `${hidden} hidden`;
                    hiddenEl.classList.remove('hidden');
                } else {
                    hiddenEl.classList.add('hidden');
                }
            }

            if (filtered.length === 0) { list.innerHTML = `<div class="text-center text-gray-500 py-10">No categories match.</div>`; return; }

            list.innerHTML = filtered.map(c => {
                const isSel = tempTvPrefs.categories.includes(String(c.category_id));
                const hasCust = tempTvPrefs.customized[c.category_id] !== undefined;
                return `
                    <div class="bg-panelbg border border-white/5 rounded-xl overflow-hidden transition-colors ${isSel ? 'border-primary/50 ring-1 ring-primary/30' : 'opacity-60'}">
                        <div class="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5" onclick="toggleManageCat('${jsEsc(c.category_id)}')">
                            <div class="flex items-center gap-4">
                                <div class="w-6 h-6 rounded-md border transition-colors ${isSel ? 'bg-primary border-primary flex items-center justify-center shadow-lg shadow-primary/30' : 'border-gray-600 bg-black/50'}">
                                    ${isSel ? '<i class="fa-solid fa-check text-white text-[10px]"></i>' : ''}
                                </div>
                                <div>
                                    <h4 class="font-bold text-white text-sm">${esc(c.category_name)}</h4>
                                    ${hasCust ? '<span class="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded mt-1 inline-block uppercase tracking-widest font-bold">Rules Applied</span>' : ''}
                                </div>
                            </div>
                            <button onclick="event.stopPropagation(); expandManageCat('${jsEsc(c.category_id)}')" class="text-xs bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-bold border border-white/5">
                                <i class="fa-solid fa-layer-group text-primary"></i> Channels
                            </button>
                        </div>
                        <div id="manage-cat-content-${esc(c.category_id)}" class="hidden bg-[#0A0A0A] border-t border-white/5 p-4"></div>
                    </div>
                `;
            }).join('');
        }

        function toggleManageCat(catId) {
            const idStr = String(catId);
            const idx = tempTvPrefs.categories.indexOf(idStr);
            if (idx > -1) tempTvPrefs.categories.splice(idx, 1);
            else tempTvPrefs.categories.push(idStr);
            renderManageCats(document.getElementById('manage-tv-search').value);
        }

        function selectAllManageCats() { tempTvPrefs.categories = state.allLiveCategories.map(c => String(c.category_id)); renderManageCats(); }
        function deselectAllManageCats() { tempTvPrefs.categories = []; renderManageCats(); }

        async function expandManageCat(catId) {
            const container = document.getElementById(`manage-cat-content-${catId}`);
            if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
            
            container.classList.remove('hidden');
            container.innerHTML = `<div class="flex justify-center py-6"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div></div>`;
            
            try {
                let streams = await fetchXC('get_live_streams', `&category_id=${catId}`);
                if (!Array.isArray(streams)) streams = Object.values(streams || {});
                if (streams.length === 0) { container.innerHTML = `<div class="text-gray-500 text-xs text-center py-4 font-bold uppercase tracking-widest">Empty Category</div>`; return; }

                streams = streams.map(s => ({ id: String(s.stream_id || s.id), name: s.name || s.title || "Unknown" }));
                container.dataset.allIds = JSON.stringify(streams.map(s => s.id));

                window[`renderChannels_${catId}`] = () => {
                    const selectedList = tempTvPrefs.customized[catId] || streams.map(s => s.id);
                    const html = streams.map(s => {
                        const isSel = selectedList.includes(s.id);
                        return `
                            <label class="flex items-center gap-3 p-2.5 hover:bg-white/5 rounded-lg cursor-pointer transition border border-transparent hover:border-white/5">
                                <div class="relative flex items-center justify-center">
                                    <input type="checkbox" ${isSel ? 'checked' : ''} onchange="toggleManageChannel('${jsEsc(catId)}', '${jsEsc(s.id)}')" class="peer appearance-none w-4 h-4 border border-gray-600 rounded bg-black/50 checked:bg-primary checked:border-primary transition-colors cursor-pointer">
                                    <i class="fa-solid fa-check absolute text-[9px] text-white opacity-0 peer-checked:opacity-100 pointer-events-none"></i>
                                </div>
                                <span class="text-xs text-gray-300 truncate font-semibold flex-1">${esc(s.name)}</span>
                            </label>
                        `;
                    }).join('');
                    
                    container.innerHTML = `
                        <div class="flex items-center justify-between mb-3 pb-3 border-b border-white/5">
                            <span class="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded uppercase tracking-wider">${selectedList.length}/${streams.length} Configured</span>
                            <div class="flex gap-2">
                                <button onclick="selectAllManageChannels('${jsEsc(catId)}')" class="text-[10px] font-bold text-gray-400 hover:text-white px-3 py-1.5 border border-white/10 rounded-md hover:bg-white/5 transition uppercase tracking-wider">All</button>
                                <button onclick="deselectAllManageChannels('${jsEsc(catId)}')" class="text-[10px] font-bold text-gray-400 hover:text-white px-3 py-1.5 border border-white/10 rounded-md hover:bg-white/5 transition uppercase tracking-wider">None</button>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 max-h-72 overflow-y-auto pr-2 custom-scroll">${html}</div>
                    `;
                };
                window[`renderChannels_${catId}`]();
            } catch (e) { container.innerHTML = `<div class="text-red-500 text-xs text-center py-4 font-bold">Failed to load channels.</div>`; }
        }

        function toggleManageChannel(catId, streamId) {
            const container = document.getElementById(`manage-cat-content-${catId}`);
            if (!tempTvPrefs.customized[catId]) tempTvPrefs.customized[catId] = [...JSON.parse(container.dataset.allIds || '[]')];
            const idx = tempTvPrefs.customized[catId].indexOf(streamId);
            if (idx > -1) tempTvPrefs.customized[catId].splice(idx, 1); else tempTvPrefs.customized[catId].push(streamId);
            window[`renderChannels_${catId}`]();
            if (!tempTvPrefs.categories.includes(catId)) { toggleManageCat(catId); renderManageCats(document.getElementById('manage-tv-search').value); }
        }

        function selectAllManageChannels(catId) { delete tempTvPrefs.customized[catId]; window[`renderChannels_${catId}`](); if (!tempTvPrefs.categories.includes(catId)) toggleManageCat(catId); }
        function deselectAllManageChannels(catId) { tempTvPrefs.customized[catId] = []; window[`renderChannels_${catId}`](); }

        // --- Data Fetching & Dashboard Logic ---
        async function fetchXC(action, params = '') {
            if (!config.user || !config.pass || !getServer()) throw new Error("No provider account configured");
            if (window.auraNative && window.auraNative.apiRequest) {
                return await window.auraNative.apiRequest({
                    server: getServer(), user: config.user, pass: config.pass, action, params
                });
            }
            throw new Error("Native network bridge unavailable");
        }

        async function loadDashboard() {
            if (!config.user || config.user === 'guest' || !getServer()) {
                renderOnboardingCard();
                return;
            }
            const grid = document.getElementById('main-grid');
            grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 w-full"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mb-4"></div><p class="text-gray-400 text-xs font-bold uppercase tracking-wider">Connecting to IPTV provider...</p></div>`;
            
            try {
                const [vodCats, liveCats, seriesCats] = await Promise.all([
                    fetchXC('get_vod_categories').catch(() => []),
                    fetchXC('get_live_categories').catch(() => []),
                    fetchXC('get_series_categories').catch(() => [])
                ]);

                const parseCats = (data) => {
                    let arr = Array.isArray(data) ? data : (typeof data === 'object' ? Object.values(data || {}) : []);
                    return arr.map(c => {
                        state.categoryMap[c.category_id] = c.category_name;
                        return c;
                    });
                };

                state.allLiveCategories = parseCats(liveCats);
                state.categories.vod = parseCats(vodCats);
                state.categories.series = parseCats(seriesCats);
                
                // Ensure Live TV categories are always populated and usable
                const savedCatIds = new Set((tvPrefs.categories || []).map(id => String(id)));
                if (!tvPrefs.setupComplete || savedCatIds.size === 0) {
                    tvPrefs.categories = state.allLiveCategories.map(c => String(c.category_id));
                    tvPrefs.setupComplete = true;
                    localStorage.setItem('aura_tv_prefs', JSON.stringify(tvPrefs));
                }
                const activeCatIds = new Set((tvPrefs.categories || []).map(id => String(id)));
                state.categories.live = state.allLiveCategories.filter(c => activeCatIds.has(String(c.category_id)));
                
                // Safety fallback: if filter resulted in 0 categories, enable all
                if (state.categories.live.length === 0 && state.allLiveCategories.length > 0) {
                    state.categories.live = [...state.allLiveCategories];
                    tvPrefs.categories = state.allLiveCategories.map(c => String(c.category_id));
                    localStorage.setItem('aura_tv_prefs', JSON.stringify(tvPrefs));
                }
                
                setTab(state.currentTab || 'vod');
                // Lazy-load search cache on demand rather than hammering provider on startup
            } catch (err) {
                grid.innerHTML = `
                    <div class="w-full flex flex-col items-center justify-center pt-32 text-center px-4">
                        <div class="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
                            <i class="fa-solid fa-shield-halved text-3xl text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]"></i>
                        </div>
                        <h2 class="text-2xl font-black text-white mb-2">Connection Blocked</h2>
                        <p class="text-gray-400 text-sm max-w-md mx-auto mb-6 leading-relaxed">${esc(err.message)}</p>
                        <button onclick="openProfileModal()" class="bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold py-2.5 px-6 rounded-lg transition-colors text-sm flex items-center gap-2 mx-auto"><i class="fa-solid fa-gear"></i> Verify Settings</button>
                    </div>`;
            }
        }

        async function preloadLibrary() {
            if (state.globalSearchCache.length > 0 || state.isFetchingSearch) return;
            state.isFetchingSearch = true;
            try {
                let all = [];
                const vod = await fetchXC('get_vod_streams').catch(err => {
                    console.warn('[AURA Search Cache] VOD catalog skipped:', err.message);
                    return [];
                });
                if (Array.isArray(vod)) all = all.concat(vod.map(s => normalizeStream(s, 'vod')));
                
                const live = await fetchXC('get_live_streams').catch(err => {
                    console.warn('[AURA Search Cache] Live catalog skipped:', err.message);
                    return [];
                });
                if (Array.isArray(live)) {
                    const activeCatIds = new Set((tvPrefs.categories || []).map(id => String(id)));
                    const selLive = live.filter(s => {
                        const sCatId = String(s.category_id);
                        if (activeCatIds.size > 0 && !activeCatIds.has(sCatId)) return false;
                        if (tvPrefs.customized && tvPrefs.customized[sCatId]) {
                            const allowed = tvPrefs.customized[sCatId].map(id => String(id));
                            if (!allowed.includes(String(s.stream_id))) return false;
                        }
                        return true;
                    });
                    all = all.concat(selLive.map(s => normalizeStream(s, 'live')));
                }
                
                const series = await fetchXC('get_series').catch(err => {
                    console.warn('[AURA Search Cache] Series catalog skipped:', err.message);
                    return [];
                });
                if (Array.isArray(series)) all = all.concat(series.map(s => normalizeStream(s, 'series')));
                
                state.globalSearchCache = all;
            } catch (e) {
                console.warn("Library preload caught:", e);
            } finally {
                state.isFetchingSearch = false;
            }
        }

        window.removeFromHistory = function(id) {
            state.history = state.history.filter(m => String(m.id) !== String(id));
            localStorage.setItem('aura_history', JSON.stringify(state.history));
            showToast('Removed from Continue Watching');
            
            // Optimistic local DOM mutation to prevent full-screen reload or resetting category feeds
            const targetCard = document.querySelector(`.media-card[data-history-id="${id}"]`);
            if (targetCard) {
                targetCard.style.transition = 'all 0.25s ease';
                targetCard.style.opacity = '0';
                targetCard.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    targetCard.remove();
                    const carousel = document.getElementById('continue-watching-carousel');
                    if (carousel && carousel.children.length === 0) {
                        const sec = document.getElementById('continue-watching-section');
                        if (sec) sec.remove();
                    }
                }, 250);
            }
        };

        window.clearAllHistory = function() {
            if (!confirm('Are you sure you want to clear all Continue Watching history?')) return;
            state.history = [];
            localStorage.removeItem('aura_history');
            showToast('Continue Watching cleared');
            
            // Optimistic local DOM mutation: remove continue watching section directly without re-fetching feeds
            const sec = document.getElementById('continue-watching-section');
            if (sec) {
                sec.style.transition = 'all 0.25s ease';
                sec.style.opacity = '0';
                setTimeout(() => sec.remove(), 250);
            }
        };

        function setTab(tab) {
            state.currentTab = tab;
            state.currentFilterPill = 'all';
            
            // UI Navigation Styling
            ['live', 'series', 'vod', 'favorites', 'search'].forEach(l => {
                const el = document.getElementById(`nav-${l}`);
                if (el) {
                    el.classList.remove('text-white', 'bg-white/10', 'font-bold', 'border-l-2', 'border-primary', 'shadow-sm');
                    el.classList.add('text-gray-400', 'font-semibold');
                }
                const mob = document.getElementById(`mob-nav-${l}`);
                if (mob) {
                    if (l === tab) {
                        mob.classList.remove('text-gray-400');
                        mob.classList.add('text-primary');
                    } else {
                        mob.classList.remove('text-primary');
                        mob.classList.add('text-gray-400');
                    }
                }
            });
            const activeLink = document.getElementById(`nav-${tab}`);
            if (activeLink) {
                activeLink.classList.remove('text-gray-400', 'font-semibold');
                activeLink.classList.add('text-white', 'bg-white/10', 'font-bold', 'border-l-2', 'border-primary', 'shadow-sm');
            }

            const searchView = document.getElementById('search-view');
            const mainGrid = document.getElementById('main-grid');
            const topBarSort = document.getElementById('hub-sort-tabs');
            const filterPills = document.getElementById('filter-pills');

            // Close mobile sidebar and backdrop if open
            if (window.innerWidth < 768) {
                const sb = document.getElementById('app-sidebar');
                if (sb) sb.classList.add('-translate-x-full');
                const bd = document.getElementById('sidebar-backdrop');
                if (bd) bd.classList.add('hidden');
                window.getSelection()?.removeAllRanges();
            }

            if (tab === 'search') {
                searchView.classList.remove('hidden'); searchView.classList.add('flex');
                mainGrid.classList.add('hidden');
                document.getElementById('hub-title').innerHTML = `<i class="fa-solid fa-search mr-2 text-yellow-400"></i> Global Search`;
                if (topBarSort) topBarSort.className = 'hidden';
                filterPills.classList.add('hidden');
                preloadLibrary();
                setTimeout(() => {
                    const input = document.getElementById('global-search-input');
                    if (input) input.focus();
                }, 100);
                return;
            }

            searchView.classList.add('hidden'); searchView.classList.remove('flex');
            mainGrid.classList.remove('hidden');

            if (tab === 'favorites') {
                if (topBarSort) topBarSort.className = 'hidden';
                filterPills.classList.add('hidden');
                document.getElementById('hub-title').innerHTML = `<i class="fa-solid fa-heart text-red-500 mr-2"></i> My Favorites`;
                document.getElementById('category-list').innerHTML = `
                    <div class="p-3 text-xs text-gray-400 font-semibold select-none">
                        <div class="px-2 py-1.5 rounded-lg bg-white/5 text-white font-bold mb-1">ALL FAVORITES (${state.favorites.length})</div>
                        <p class="text-[11px] text-gray-500 mt-2 px-2 leading-relaxed">Channels, movies, and series you have bookmarked for quick access.</p>
                    </div>`;
                renderFavoritesView();
                return;
            }

            // Desktop sort tabs: hidden on mobile (<1024px), flex on lg screens
            if (topBarSort) topBarSort.className = 'hidden lg:flex items-center bg-black/50 border border-white/10 rounded-lg p-1 select-none';
            filterPills.classList.remove('hidden');
            const titles = { live: 'TV Live', vod: 'Movies', series: 'Series' };
            document.getElementById('hub-title').innerHTML = titles[tab] || 'Movies';

            const cats = state.categories[tab] || [];
            if (tab === 'live') {
                let pillsHtml = '<button onclick="toggleSidebar()" class="md:hidden filter-pill px-3 py-1.5 bg-primary/20 text-primary border border-primary/40 text-xs font-bold rounded-lg flex-shrink-0 flex items-center gap-1.5 select-none" style="touch-action: manipulation;"><i class="fa-solid fa-list text-[10px]"></i> Categories (' + cats.length + ')</button>' +
                    '<button onclick="applyFilterPill(\'all\', this)" class="filter-pill px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg flex-shrink-0 shadow-md shadow-primary/20 select-none">All</button>' +
                    '<button onclick="applyFilterPill(\'4k\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">4K / UHD</button>' +
                    '<button onclick="applyFilterPill(\'fhd\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">FHD</button>';
                cats.slice(0, 10).forEach(c => {
                    pillsHtml += '<button onclick="renderGridContent(\'' + jsEsc(c.category_id) + '\', null, \'' + jsEsc(c.category_name) + '\')" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">' + esc(c.category_name) + '</button>';
                });
                filterPills.innerHTML = pillsHtml;
            } else if (tab === 'vod') {
                let pillsHtml = '<button onclick="toggleSidebar()" class="md:hidden filter-pill px-3 py-1.5 bg-primary/20 text-primary border border-primary/40 text-xs font-bold rounded-lg flex-shrink-0 flex items-center gap-1.5 select-none" style="touch-action: manipulation;"><i class="fa-solid fa-list text-[10px]"></i> Categories (' + cats.length + ')</button>' +
                    '<button onclick="applyFilterPill(\'all\', this)" class="filter-pill px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg flex-shrink-0 shadow-md shadow-primary/20 select-none">All</button>' +
                    '<button onclick="applyFilterPill(\'popular\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">Popular</button>' +
                    '<button onclick="applyFilterPill(\'year\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">Recent</button>' +
                    '<button onclick="applyFilterPill(\'4k\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">4K / UHD</button>';
                cats.slice(0, 10).forEach(c => {
                    pillsHtml += '<button onclick="renderGridContent(\'' + jsEsc(c.category_id) + '\', null, \'' + jsEsc(c.category_name) + '\')" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">' + esc(c.category_name) + '</button>';
                });
                filterPills.innerHTML = pillsHtml;
            } else {
                let pillsHtml = '<button onclick="toggleSidebar()" class="md:hidden filter-pill px-3 py-1.5 bg-primary/20 text-primary border border-primary/40 text-xs font-bold rounded-lg flex-shrink-0 flex items-center gap-1.5 select-none" style="touch-action: manipulation;"><i class="fa-solid fa-list text-[10px]"></i> Categories (' + cats.length + ')</button>' +
                    '<button onclick="applyFilterPill(\'all\', this)" class="filter-pill px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg flex-shrink-0 shadow-md shadow-primary/20 select-none">All</button>' +
                    '<button onclick="applyFilterPill(\'popular\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">Popular</button>' +
                    '<button onclick="applyFilterPill(\'year\', this)" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">Recent</button>';
                cats.slice(0, 10).forEach(c => {
                    pillsHtml += '<button onclick="renderGridContent(\'' + jsEsc(c.category_id) + '\', null, \'' + jsEsc(c.category_name) + '\')" class="filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none">' + esc(c.category_name) + '</button>';
                });
                filterPills.innerHTML = pillsHtml;
            }

            renderSidebarCategories();
            renderGridContent('all');
        }

        function renderFavoritesView() {
            const grid = document.getElementById('main-grid');
            if (state.favorites.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-500 w-full text-center px-4">
                        <div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <i class="fa-regular fa-heart text-3xl text-gray-500"></i>
                        </div>
                        <h3 class="text-white font-bold text-lg mb-1">No Favorites Added</h3>
                        <p class="text-xs text-gray-400 max-w-sm leading-relaxed">Click the heart icon on any live channel, movie, or series to pin it here for instant one-click streaming.</p>
                    </div>`;
                return;
            }

            const cardsHtml = state.favorites.map((s, i) => createCardHTML(s, i, false, s.type === 'live')).join('');
            grid.innerHTML = `
                <div class="flex flex-col w-full">
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-xs text-gray-400 uppercase tracking-wider font-bold">${state.favorites.length} Saved Titles</span>
                        <button onclick="if(confirm('Clear all favorites?')){state.favorites=[];localStorage.setItem('aura_favorites','[]');renderFavoritesView();}" class="text-xs text-gray-500 hover:text-red-400 transition-colors">Clear All</button>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6 content-start w-full">${cardsHtml}</div>
                </div>`;
        }

        function renderSidebarCategories(query = '') {
            const container = document.getElementById('category-list');
            let cats = state.categories[state.currentTab] || [];
            
            if (query) {
                const q = query.toLowerCase();
                cats = cats.filter(c => (c.category_name || '').toLowerCase().includes(q));
            }

            let html = `<button onclick="renderGridContent('all', this)" class="sidebar-cat-btn w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors bg-white/10 text-white shadow-sm border border-white/5">ALL CATEGORIES</button>`;
            
            html += cats.map(c => `
                <button onclick="renderGridContent('${jsEsc(c.category_id)}', this, '${jsEsc(c.category_name)}')" 
                        class="sidebar-cat-btn w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors line-clamp-1 border border-transparent">
                    ${esc(c.category_name)}
                </button>
            `).join('');
            
            container.innerHTML = html;
        }

        function applySort(type, btnEl) {
            state.currentSort = type;
            document.querySelectorAll('#hub-sort-tabs button').forEach(b => {
                b.className = 'px-4 py-1 rounded-md text-xs font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors';
            });
            if (btnEl) {
                btnEl.className = 'px-4 py-1 rounded-md text-xs font-bold text-white bg-white/10 shadow shadow-black/50 transition-colors';
            }
            renderActiveFilteredStreams();
        }

        function applyFilterPill(filter, btnEl) {
            state.currentFilterPill = filter;
            document.querySelectorAll('.filter-pill').forEach(b => {
                b.className = 'filter-pill px-3 py-1.5 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 text-xs font-semibold rounded-lg flex-shrink-0 transition-colors select-none';
            });
            if (btnEl) {
                btnEl.className = 'filter-pill px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg flex-shrink-0 shadow-md shadow-primary/20 select-none';
            }
            renderActiveFilteredStreams();
        }

        function renderActiveFilteredStreams() {
            const grid = document.getElementById('main-grid');
            let list = [...(state.activeCategoryStreams || [])];
            if (list.length === 0) return;

            // Apply Filter
            const f = state.currentFilterPill;
            if (f === '4k') {
                list = list.filter(s => /4k|uhd|2160p|hdr/i.test(s.title));
            } else if (f === 'fhd') {
                list = list.filter(s => /fhd|1080p/i.test(s.title));
            } else if (f === 'popular') {
                list.sort((a, b) => (b.ratingNum || 0) - (a.ratingNum || 0));
            } else if (f === 'year') {
                const curYear = new Date().getFullYear();
                list = list.filter(s => {
                    const y = parseInt(s.added);
                    return y && y >= curYear - 3;
                });
            } else if (f === 'top') {
                list = list.filter(s => (s.ratingNum || 0) >= 8.0);
            } else if (f === 'az') {
                list.sort((a, b) => a.title.localeCompare(b.title));
            } else if (/^[A-Z]$/.test(f)) {
                list = list.filter(s => s.title.trim().toUpperCase().startsWith(f));
            }

            // Apply Sort
            const s = state.currentSort;
            if (s === 'popular') {
                list.sort((a, b) => (b.ratingNum || 0) - (a.ratingNum || 0));
            } else if (s === 'new') {
                list.sort((a, b) => (parseInt(b.added) || 0) - (parseInt(a.added) || 0));
            } else if (s === 'az') {
                list.sort((a, b) => a.title.localeCompare(b.title));
            }

            if (list.length === 0) {
                grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-500 w-full"><i class="fa-solid fa-filter text-4xl mb-3 opacity-50"></i><p class="font-semibold">No content matches filter "${esc(f)}".</p></div>`;
                return;
            }

            const isLive = state.currentTab === 'live';
            const cardsHtml = list.map((item, idx) => createCardHTML(item, idx, false, isLive)).join('');
            grid.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6 content-start w-full">${cardsHtml}</div>`;
        }

        async function renderGridContent(catId, btnElement = null, catName = null) {
            const grid = document.getElementById('main-grid');
            
            if (btnElement) {
                document.querySelectorAll('.sidebar-cat-btn').forEach(b => {
                    b.classList.remove('bg-white/10', 'text-white', 'font-bold', 'border-white/5', 'shadow-sm');
                    b.classList.add('text-gray-400', 'font-medium', 'border-transparent');
                });
                btnElement.classList.add('bg-white/10', 'text-white', 'font-bold', 'border-white/5', 'shadow-sm');
                btnElement.classList.remove('text-gray-400', 'font-medium', 'border-transparent');
                
                if (catName) {
                    const titles = { live: 'TV Live', vod: 'Movies', series: 'Series' };
                    document.getElementById('hub-title').innerHTML = `<span class="text-gray-500 cursor-pointer hover:text-white transition-colors" onclick="setTab('${state.currentTab}')">${titles[state.currentTab]}</span> <i class="fa-solid fa-chevron-right text-[10px] mx-2 text-gray-600"></i> ${esc(catName)}`;
                }
            }

            grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 w-full"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mb-3"></div><p class="text-xs text-gray-400 font-bold uppercase tracking-wider">Loading titles...</p></div>`;
            
            let fetchAction = 'get_vod_streams';
            if (state.currentTab === 'live') fetchAction = 'get_live_streams';
            if (state.currentTab === 'series') fetchAction = 'get_series';

            let htmlPayload = '';
            let streams = [];

            if (catId === 'all') {
                // Secondary check: Exclude Live TV from Continue Watching in Movies/Series tabs
                const eligibleHistory = state.history.filter(m => {
                    if (m.type === 'live' || m.stream_type === 'live') return false;
                    if (state.currentTab === 'series') return m.type === 'series';
                    return m.type === 'vod' || !m.type || m.type === 'movie';
                });

                if (eligibleHistory.length > 0 && state.currentTab !== 'live') {
                    htmlPayload += `
                        <div id="continue-watching-section" class="w-full">
                            <div class="col-span-full flex items-center justify-between mb-4 mt-2">
                                <h2 class="font-bold text-white text-lg flex items-center gap-2">
                                    <i class="fa-solid fa-clock-rotate-left text-primary"></i> Continue Watching
                                </h2>
                                <button onclick="clearAllHistory()" class="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 transition-all font-medium">
                                    <i class="fa-regular fa-trash-can"></i> Clear History
                                </button>
                            </div>
                            <div id="continue-watching-carousel" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6 content-start w-full mb-8">
                                ${eligibleHistory.slice(0, 14).map((s, i) => createCardHTML(s, i, true, false)).join('')}
                            </div>
                            <div class="w-full h-px bg-white/5 my-6"></div>
                        </div>
                    `;
                }
                const cats = state.categories[state.currentTab] || [];
                // Look through categories (up to 25) until we find one with available streams
                for (let i = 0; i < Math.min(cats.length, 25); i++) {
                    const cat = cats[i];
                    if (!cat || !cat.category_id || !cat.category_name) continue;
                    // Skip divider labels like "--- 4K UHD ---"
                    if (/^[-=_s]+$/.test(cat.category_name) || /^[-s]{2,}/.test(cat.category_name)) continue;
                    const sList = await getCategoryStreams(fetchAction, cat.category_id);
                    if (sList && sList.length > 0) {
                        streams = sList;
                        const label = state.currentTab === 'live' ? `Live Channels in ${esc(cat.category_name)}` : `Popular in ${esc(cat.category_name)}`;
                        htmlPayload += `<h2 class="col-span-full font-bold text-white text-lg mb-4 flex items-center gap-2"><i class="fa-solid fa-fire text-orange-500"></i> ${label}</h2>`;
                        break;
                    }
                }
                // Fallback: If still empty, fetch all streams directly without category filter
                if (!streams || streams.length === 0) {
                    streams = await getCategoryStreams(fetchAction, 'all');
                }
            } else {
                streams = await getCategoryStreams(fetchAction, catId);
            }

            state.activeCategoryStreams = streams || [];

            if (streams && streams.length > 0) {
                const isLive = state.currentTab === 'live';
                const cardsHtml = streams.map((s, i) => createCardHTML(s, i, false, isLive)).join('');
                htmlPayload += `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4 md:gap-6 content-start w-full">${cardsHtml}</div>`;
                grid.innerHTML = `<div class="flex flex-col w-full">${htmlPayload}</div>`;
            } else {
                if (catId !== 'all') {
                    grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-500 w-full"><i class="fa-solid fa-folder-open text-4xl mb-3 opacity-50"></i><p class="font-semibold">No content available in this category.</p></div>`;
                } else {
                    if (htmlPayload) {
                        grid.innerHTML = `<div class="flex flex-col w-full">${htmlPayload}</div>`;
                    } else {
                        grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-500 w-full"><i class="fa-solid fa-folder-open text-4xl mb-3 opacity-50"></i><p class="font-semibold">No channels or movies available.</p></div>`;
                    }
                }
            }
        }

        function extractStreamYear(s) {
            const curYear = new Date().getFullYear();
            // 1. Check title/name for 4-digit year, e.g. "WORLD CUP CRICKET 2023 HIGHLIGHTS" -> "2023"
            const title = String(s.name || s.title || '');
            const titleMatch = title.match(/\b(19\d\d|20\d\d)\b/);
            if (titleMatch) {
                const y = parseInt(titleMatch[1]);
                if (y >= 1930 && y <= curYear + 1) return String(y);
            }

            // 2. Check explicit year property
            if (s.year) {
                const y = parseInt(s.year);
                if (y >= 1930 && y <= curYear + 1) return String(y);
            }

            // 3. Check release_date / releasedate
            const rel = String(s.release_date || s.releasedate || s.releaseDate || '');
            const relMatch = rel.match(/\b(19\d\d|20\d\d)\b/);
            if (relMatch) {
                const y = parseInt(relMatch[1]);
                if (y >= 1930 && y <= curYear + 1) return String(y);
            }

            // 4. Check added timestamp if valid unix seconds or 4-digit year
            const a = String(s.added || '');
            if (/^\d{9,}$/.test(a)) {
                const y = new Date(parseInt(a) * 1000).getFullYear();
                if (y >= 1990 && y <= curYear) return String(y);
            } else if (/^(19\d\d|20\d\d)$/.test(a)) {
                const y = parseInt(a);
                if (y >= 1930 && y <= curYear + 1) return String(y);
            }

            // Never fabricate a placeholder year like 2026
            return '';
        }

        function normalizeStream(s, type, catId = 'search') {
            const actualCatId = s.category_id || catId;
            const fallbackStr = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="100%" fill="#1A1A1A"/><text x="50%" y="50%" font-family="sans-serif" font-size="24" font-weight="bold" fill="#444" text-anchor="middle" dominant-baseline="middle" style="text-transform:uppercase;">${esc(s.name || s.title).substring(0, 15)}</text></svg>`)}`;
            
            let img = String(s.stream_icon || s.cover || s.img || '');
            if (img === 'null' || !img.trim()) img = fallbackStr;
            else if (img.startsWith('/')) img = getServer() + img;

            const r = parseFloat(s.rating), r5 = parseFloat(s.rating_5based);
            const ratingNum = r > 0 ? r : (r5 > 0 ? r5 * 2 : 0);
            const year = extractStreamYear(s);
            
            let cExt = s.container_extension;
            if (!cExt || cExt === 'null' || cExt === 'undefined' || cExt === '') cExt = 'mp4';

            const isLiveStream = (type === 'live' || s.stream_type === 'live' || s.stream_type === 'live_stream');
            const isSeriesStream = (!isLiveStream && (type === 'series' || s.stream_type === 'series'));

            return {
                id: s.stream_id || s.series_id || s.id,
                title: s.name || s.title || "Unknown Title",
                img, fallbackStr,
                rating: ratingNum ? `${ratingNum.toFixed(1)} ★` : "HD",
                ratingNum,
                added: year,
                ext: isLiveStream ? 'ts' : cExt,
                type: isLiveStream ? 'live' : (isSeriesStream ? 'series' : 'vod'),
                desc: s.plot || s.desc || s.description || "Dive into this immersive cinematic experience, available now on AURA.",
                category_id: actualCatId,
                category_name: state.categoryMap[actualCatId] || ""
            };
        }

        async function getCategoryStreams(action, catId) {
            const cacheKey = `${action}_${catId}`;
            if (state.streams[cacheKey]) return state.streams[cacheKey];

            const param = (catId && catId !== 'all') ? `&category_id=${catId}` : '';
            const rawData = await fetchXC(action, param).catch(() => []);
            if (!rawData) return [];
            
            let arr = Array.isArray(rawData) ? rawData : (typeof rawData === 'object' ? Object.values(rawData) : []);
            if (action === 'get_live_streams' && catId !== 'all' && tvPrefs.customized && tvPrefs.customized[catId]) {
                const allowed = tvPrefs.customized[catId].map(id => String(id));
                arr = arr.filter(s => allowed.includes(String(s.stream_id)));
            }

            let normalized = arr.map(s => normalizeStream(s, action.includes('live') ? 'live' : (action.includes('series') ? 'series' : 'vod'), catId)).slice(0, 300);
            state.streams[cacheKey] = normalized;
            return normalized;
        }

        function getStreamQualityTag(title) {
            if (!title) return null;
            if (/4k|uhd|2160p/i.test(title)) return { label: '4K', class: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
            if (/fhd|1080p/i.test(title)) return { label: 'FHD', class: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
            if (/hevc|h\.?265/i.test(title)) return { label: 'HEVC', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
            if (/50fps|60fps/i.test(title)) return { label: '60FPS', class: 'bg-purple-500/20 text-purple-300 border-purple-500/40' };
            if (/hd|720p/i.test(title)) return { label: 'HD', class: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
            return null;
        }

        function createCardHTML(movie, idx = 0, isHistory = false, isLive = false) {
            const actualLive = isLive || movie.type === 'live';
            const mStr = encObj(movie);
            const badgeHtml = (!isHistory && !actualLive && idx < 10) ? `<div class="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-black text-xs shadow-lg shadow-primary/40 z-30 border-2 border-[#141414]">#${idx + 1}</div>` : '';
            const aspect = actualLive ? 'aspect-video' : 'aspect-[2/3]';
            const progressHtml = isHistory ? `<div class="absolute bottom-0 left-0 w-full h-1 bg-gray-800 z-30"><div class="h-full bg-primary shadow-[0_0_10px_#e50914]" style="width: ${movie.progress || 10}%"></div></div>` : '';
            const favActive = isFavorite(movie.id);
            const qTag = getStreamQualityTag(movie.title);
            const qualityBadge = qTag ? `<span class="px-1 py-0.2 rounded border text-[8px] font-black tracking-wider ${qTag.class}">${qTag.label}</span>` : '';

            const removeBtn = isHistory ? `
                <button class="remove-history-btn absolute top-2 left-2 w-8 h-8 rounded-full bg-black/70 hover:bg-red-600 text-gray-300 hover:text-white flex items-center justify-center transition-all border border-white/10 backdrop-blur-sm z-30 shadow-md group/rbtn" onclick="event.stopPropagation(); removeFromHistory('${movie.id}')" title="Remove from Continue Watching">
                    <i class="fa-solid fa-xmark text-xs group-hover/rbtn:scale-110 transition-transform"></i>
                </button>
            ` : '';

            const favBtn = `<button class="fav-btn-${movie.id} absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-white/20 transition-colors border border-white/10 backdrop-blur-sm z-30" onclick="toggleFavorite('${mStr}', event)" title="${favActive ? 'Remove from favorites' : 'Add to favorites'}">
                ${favActive ? '<i class="fa-solid fa-heart text-red-500"></i>' : '<i class="fa-regular fa-heart"></i>'}
            </button>`;

            const clickAction = actualLive ? `playStream('${mStr}')` : `openDetailView('${mStr}')`;

            return `
                <div class="media-card relative group cursor-pointer flex flex-col gap-2 w-full" ${isHistory ? `data-history-id="${movie.id}"` : ''} onclick="${clickAction}">
                    <div class="${aspect} rounded-xl overflow-hidden relative shadow-lg bg-panelbg border border-white/5">
                        <img src="${movie.img}" data-fallback="${movie.fallbackStr}" loading="lazy" class="${actualLive ? 'w-3/4 h-3/4 object-contain absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : 'w-full h-full object-cover'}" onerror="this.onerror=null;this.src=this.dataset.fallback;">
                        
                        ${badgeHtml}
                        ${removeBtn}
                        ${progressHtml}
                        ${favBtn}

                        <!-- Hover Overlay -->
                        <div class="overlay absolute inset-0 bg-black/60 flex items-center justify-center gap-2.5 backdrop-blur-[2px]">
                            <button onclick="event.stopPropagation(); playStream('${mStr}')" class="w-12 h-12 rounded-full bg-white/20 hover:bg-primary flex items-center justify-center text-white border border-white/30 transform group-hover:scale-110 transition-all shadow-lg" title="Play">
                                <i class="fa-solid fa-play ml-1"></i>
                            </button>
                            ${isHistory ? `
                                <button onclick="event.stopPropagation(); removeFromHistory('${movie.id}')" class="w-10 h-10 rounded-full bg-black/60 hover:bg-red-600 flex items-center justify-center text-white border border-white/20 hover:border-red-500 transition-all shadow-lg" title="Remove from Continue Watching">
                                    <i class="fa-regular fa-trash-can text-sm"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="px-1 select-none">
                        <h3 class="font-bold text-gray-200 text-xs line-clamp-1 leading-tight tracking-wide group-hover:text-white transition-colors" title="${esc(movie.title)}">${esc(movie.title)}</h3>
                        <div class="flex items-center gap-1.5 text-[9px] text-gray-400 font-bold tracking-wider mt-1">
                            ${actualLive ? '<span class="bg-red-500/20 text-red-400 border border-red-500/30 px-1 rounded uppercase font-black">Live</span>' : `<span class="text-green-400 font-bold">${movie.rating}</span>${movie.added ? `<span>•</span><span>${movie.added}</span>` : ''}`}
                            ${qualityBadge}
                        </div>
                    </div>
                </div>
            `;
        }

        // Global Multi-Tab Search Logic
        function debouncedSearch(q) { clearTimeout(searchTimer); searchTimer = setTimeout(() => executeGlobalSearch(q), 300); }

        function clearSearch() {
            const input = document.getElementById('global-search-input');
            if (input) { input.value = ''; input.focus(); }
            executeGlobalSearch('');
        }

        function setSearchFilter(type, btnEl) {
            state.searchFilterType = type;
            document.querySelectorAll('.search-filter-tab').forEach(b => {
                b.className = 'search-filter-tab px-6 py-2 bg-panelbg text-gray-400 hover:text-white text-sm font-bold rounded-full transition-colors border border-white/5 hover:border-white/20';
            });
            if (btnEl) {
                btnEl.className = 'search-filter-tab px-6 py-2 bg-primary text-white text-sm font-bold rounded-full shadow-lg shadow-primary/20';
            }
            const input = document.getElementById('global-search-input');
            executeGlobalSearch(input ? input.value : '');
        }

        async function executeGlobalSearch(query) {
            const grid = document.getElementById('search-results-grid');
            if (!query || query.trim().length < 2) {
                grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-600 w-full"><i class="fa-solid fa-keyboard text-5xl mb-4 opacity-50"></i><p class="font-medium text-lg">Start typing to search...</p></div>`;
                return;
            }

            if (state.globalSearchCache.length === 0 && !state.isFetchingSearch) {
                preloadLibrary();
            }

            const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(t => t);
            const filterType = state.searchFilterType || 'all';
            
            // 1. Search Categories
            let catHtml = '';
            if (filterType === 'all') {
                ['live', 'vod', 'series'].forEach(type => {
                    if (!state.categories[type]) return;
                    state.categories[type].forEach(cat => {
                        const cName = (cat.category_name || '').toLowerCase();
                        if (searchTerms.every(t => cName.includes(t))) {
                            const icon = type === 'live' ? 'fa-tv text-blue-400' : type === 'vod' ? 'fa-film text-purple-400' : 'fa-layer-group text-green-400';
                            catHtml += `
                                <div onclick="setTab('${type}'); renderGridContent('${jsEsc(cat.category_id)}', null, '${jsEsc(cat.category_name)}')" class="col-span-2 sm:col-span-3 lg:col-span-2 p-4 bg-panelbg border border-white/5 rounded-xl hover:border-primary cursor-pointer transition-all group flex items-center gap-4">
                                    <div class="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0"><i class="fa-solid ${icon} text-xl"></i></div>
                                    <div class="overflow-hidden">
                                        <h3 class="text-white font-bold text-sm line-clamp-1">${esc(cat.category_name)}</h3>
                                        <span class="text-[9px] font-black uppercase tracking-widest text-gray-500">${type} Category</span>
                                    </div>
                                </div>`;
                        }
                    });
                });
            }

            // 2. Search Content
            let results = state.globalSearchCache.filter(s => {
                if (filterType !== 'all' && s.type !== filterType) return false;
                const title = (s.title || '').toLowerCase();
                const cName = (s.category_name || '').toLowerCase();
                return searchTerms.every(t => title.includes(t) || cName.includes(t));
            }).slice(0, 150);

            grid.innerHTML = '';
            
            if (catHtml) {
                grid.innerHTML += `<div class="col-span-full font-bold text-white text-lg mb-2 border-b border-white/10 pb-2 w-full">Matching Folders / Hubs</div>${catHtml}`;
                grid.innerHTML += `<div class="col-span-full h-4 w-full"></div>`;
            }

            if (results.length > 0) {
                grid.innerHTML += `<div class="col-span-full font-bold text-white text-lg mb-2 border-b border-white/10 pb-2 w-full">Matching Content (${results.length})</div>`;
                grid.innerHTML += results.map((s, i) => createCardHTML(s, i, false, s.type === 'live')).join('');
            }

            if (!catHtml && results.length === 0) {
                grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center pt-32 text-gray-500 w-full"><i class="fa-solid fa-magnifying-glass text-4xl mb-4 opacity-50"></i><p class="font-medium text-lg">No results found for "${esc(query)}"</p></div>`;
            }
        }

        // --- Details Hero Overlay Logic ---
        async function openDetailView(encMovie) {
            const movie = JSON.parse(decodeURIComponent(encMovie));
            state.currentDetailMovie = movie;
            state.currentSeriesMovie = movie; // Crucial fix for episode playback
            
            // Set Hero Data
            document.getElementById('detail-backdrop').src = movie.img;
            document.getElementById('detail-backdrop').onerror = function() { this.src = movie.fallbackStr; };
            document.getElementById('detail-title').textContent = movie.title;
            const dYear = document.getElementById('detail-year');
            if (dYear) {
                if (movie.added) {
                    dYear.textContent = movie.added;
                    dYear.classList.remove('hidden');
                } else {
                    dYear.textContent = '';
                    dYear.classList.add('hidden');
                }
            }
            document.getElementById('detail-rating').textContent = `${movie.rating}`;
            document.getElementById('detail-type').textContent = movie.type === 'live' ? 'LIVE TV' : (movie.type === 'series' ? 'SERIES' : 'MOVIE');
            document.getElementById('detail-type').className = movie.type === 'live' ? 'bg-red-600 px-2 py-0.5 rounded text-white font-bold' : 'bg-white/10 border border-white/10 px-2 py-0.5 rounded text-white';
            
            let desc = movie.desc || "Dive into this immersive cinematic experience, available now on AURA.";
            if (desc === "null" || desc.trim() === "") desc = "No description available for this title.";
            document.getElementById('detail-desc').textContent = desc;

            const favBtn = document.getElementById('detail-fav-btn');
            if (favBtn) {
                favBtn.innerHTML = isFavorite(movie.id) ? '<i class="fa-solid fa-heart text-red-500 text-lg"></i>' : '<i class="fa-regular fa-heart text-lg"></i>';
                favBtn.onclick = () => toggleFavorite(movie);
            }

            const playBtn = document.getElementById('detail-play-btn');
            const seriesContainer = document.getElementById('series-container');

            // Slide in View
            const overlay = document.getElementById('detail-overlay');
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
            void overlay.offsetWidth;
            overlay.classList.remove('translate-y-full');
            overlay.classList.add('translate-y-0');

            if (movie.type === 'series') {
                seriesContainer.classList.remove('hidden');
                document.getElementById('detail-play-text').textContent = "Loading...";
                playBtn.disabled = true;
                
                try {
                    const seriesData = await fetchXC('get_series_info', `&series_id=${movie.id}`);
                    state.currentSeriesEpisodes = [];
                    if (seriesData && seriesData.episodes) {
                        for (const season in seriesData.episodes) {
                            seriesData.episodes[season].forEach(ep => {
                                state.currentSeriesEpisodes.push({ ...ep, season: season, seriesTitle: movie.title });
                            });
                        }
                        state.currentSeriesEpisodes.sort((a, b) => (parseInt(a.season) - parseInt(b.season)) || (parseInt(a.episode_num) - parseInt(b.episode_num)));
                        state.seriesSeasons = [...new Set(state.currentSeriesEpisodes.map(ep => ep.season))].sort((a, b) => parseInt(a) - parseInt(b));
                    }
                    
                    if (state.currentSeriesEpisodes.length > 0) {
                        document.getElementById('detail-play-text').textContent = "Watch S01E01";
                        playBtn.disabled = false;
                        playBtn.onclick = () => { closeDetailView(); playStream(movie, true, 0); };
                        
                        const st = document.getElementById('season-tabs');
                        st.innerHTML = state.seriesSeasons.map((s, i) => `
                            <button onclick="renderEpisodesGrid('${s}', this)" class="season-btn text-sm font-bold uppercase tracking-wider pb-4 -mb-[17px] border-b-2 transition-colors ${i === 0 ? 'text-white border-primary' : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-white/50'}">Season ${s}</button>
                        `).join('');
                        renderEpisodesGrid(state.seriesSeasons[0]);
                    } else {
                        document.getElementById('detail-play-text').textContent = "No Episodes";
                    }
                } catch (e) {
                    document.getElementById('detail-play-text').textContent = "Error Loading";
                }
            } else {
                seriesContainer.classList.add('hidden');
                document.getElementById('detail-play-text').textContent = movie.type === 'live' ? "Watch Live" : "Watch Now";
                playBtn.disabled = false;
                playBtn.onclick = () => { closeDetailView(); playStream(movie); };
            }
        }

        function closeDetailView() {
            const overlay = document.getElementById('detail-overlay');
            if (!overlay) return;
            overlay.classList.remove('translate-y-0');
            overlay.classList.add('translate-y-full');
            setTimeout(() => { 
                overlay.classList.add('hidden'); 
                overlay.classList.remove('flex'); 
                overlay.scrollTop = 0; 
            }, 500);
        }

        function renderEpisodesGrid(seasonNum, btnEl = null) {
            if (btnEl) {
                document.querySelectorAll('.season-btn').forEach(b => {
                    b.classList.remove('text-white', 'border-primary');
                    b.classList.add('text-gray-500', 'border-transparent');
                });
                btnEl.classList.add('text-white', 'border-primary');
                btnEl.classList.remove('text-gray-500', 'border-transparent');
            }

            const grid = document.getElementById('episodes-grid');
            const eps = state.currentSeriesEpisodes.filter(e => e.season == seasonNum);
            document.getElementById('ep-count-badge').textContent = `${eps.length} Episodes`;

            grid.innerHTML = eps.map((ep) => {
                const globalIndex = state.currentSeriesEpisodes.findIndex(e => e.id === ep.id);
                let img = ep.info?.movie_image;
                if (!img || img.trim() === '') img = document.getElementById('detail-backdrop').src;
                
                return `
                <div class="bg-panelbg rounded-xl overflow-hidden hover:bg-white/5 transition-all border border-white/5 hover:border-white/20 group cursor-pointer flex flex-col shadow-lg" onclick="closeDetailView(); playStream(state.currentSeriesMovie, true, ${globalIndex})">
                    <div class="aspect-video bg-black relative flex-shrink-0">
                        <img src="${img}" loading="lazy" class="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity duration-300">
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/40 backdrop-blur-[1px]">
                            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white border border-white/30 transform scale-75 group-hover:scale-100 transition-transform shadow-lg">
                                <i class="fa-solid fa-play ml-1"></i>
                            </div>
                        </div>
                        <div class="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[9px] font-bold text-white shadow uppercase tracking-wider">${ep.info?.duration || '45m'}</div>
                    </div>
                    <div class="p-3 flex flex-col flex-1">
                        <h4 class="font-bold text-xs text-gray-200 line-clamp-1 mb-1 leading-tight">${ep.episode_num}. ${esc(ep.title)}</h4>
                        <p class="text-[10px] text-gray-500 line-clamp-2 leading-relaxed mt-auto font-medium">${esc(ep.info?.plot || 'No description available for this episode.')}</p>
                    </div>
                </div>
            `}).join('');
        }

        // --- Video Playback Engine & Native Player UX ---
        // NOTE: currentActiveMovie is declared at top-of-script (line ~889) to avoid TDZ.
        // Do NOT re-declare it here — that causes a SyntaxError that crashes the entire script.

        function showPlayerSpinner(show) {
            const el = document.getElementById('player-loading-spinner');
            if (el) el.classList.toggle('hidden', !show);
        }

        function hidePlayerError() {
            state.hasPlaybackError = false;
            const errBox = document.getElementById('player-error');
            if (errBox) errBox.classList.add('hidden');
        }

        function copyCurrentStreamUrl(includeCreds = false) {
            const rawUrl = state.activeStreamUrl;
            if (!rawUrl) return;
            
            let urlToCopy = rawUrl;
            if (!includeCreds && config.pass && config.user) {
                // Redact password from stream URL by default
                urlToCopy = rawUrl.replace(new RegExp(`/${config.user}/[^/]+/`, 'g'), `/${config.user}/[REDACTED_PASSWORD]/`);
            }

            if (window.auraNative?.copyToClipboard) {
                window.auraNative.copyToClipboard(urlToCopy);
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(urlToCopy);
            }
            showToast(includeCreds ? 'Full Stream URL copied (contains credentials)' : 'Stream URL copied (password redacted)');
        }

        function retryCurrentStream() {
            if (currentActiveMovie) {
                hidePlayerError();
                executePlayerEngine(currentActiveMovie);
            }
        }

        function syncFullscreenIcon(force) {
            const video = document.getElementById('video-player');
            const isFS = typeof force === 'boolean' ? force : !!(
                document.fullscreenElement || 
                document.webkitFullscreenElement || 
                (video && video.webkitDisplayingFullscreen)
            );
            const btn = document.getElementById('fullscreen-btn');
            if (btn) {
                btn.innerHTML = isFS 
                    ? '<i class="fa-solid fa-compress text-base sm:text-lg"></i>' 
                    : '<i class="fa-solid fa-expand text-base sm:text-lg"></i>';
            }
        }

        function updatePlayerOrientationLayout() {
            const pm = document.getElementById('player-modal');
            const pc = document.getElementById('player-controls');
            if (!pm || pm.classList.contains('hidden')) return;

            const w = window.innerWidth || document.documentElement.clientWidth;
            const h = window.innerHeight || document.documentElement.clientHeight;
            const isLandscape = (w > h) || (window.screen?.orientation?.type?.includes('landscape'));

            pm.style.width = '100vw';
            pm.style.height = '100vh';
            pm.style.width = '100dvw';
            pm.style.height = '100dvh';

            if (pc) {
                pc.style.width = '100%';
                pc.style.height = '100%';
                pc.style.top = '0';
                pc.style.left = '0';
                pc.style.right = '0';
                pc.style.bottom = '0';
            }

            if (isLandscape) {
                pm.classList.add('is-landscape');
                pm.classList.remove('is-portrait');
            } else {
                pm.classList.add('is-portrait');
                pm.classList.remove('is-landscape');
            }

            updateQualityBadgeUI();
        }

        window.addEventListener('resize', updatePlayerOrientationLayout);
        window.addEventListener('orientationchange', () => {
            setTimeout(updatePlayerOrientationLayout, 100);
        });
        if (window.screen?.orientation) {
            window.screen.orientation.addEventListener('change', () => {
                setTimeout(updatePlayerOrientationLayout, 100);
            });
        }
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updatePlayerOrientationLayout);
        }

        function toggleNativeFullScreen() {
            if (window.auraNative?.platform !== 'web' && window.auraNative?.toggleFullScreen) {
                window.auraNative.toggleFullScreen();
                return;
            }

            const video = document.getElementById('video-player');
            const pm = document.getElementById('player-modal');

            // 1. Mobile iOS Safari: Only the <video> element supports fullscreen on iPhone
            if (video && typeof video.webkitEnterFullscreen === 'function') {
                if (video.webkitDisplayingFullscreen) {
                    if (video.webkitExitFullscreen) video.webkitExitFullscreen();
                    return;
                }
                if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
                    try {
                        video.webkitEnterFullscreen();
                        return;
                    } catch (_) {}
                }
            }

            // 2. Standard HTML5 Fullscreen API (Android Chrome, iPads, Mac/PC/Xbox)
            const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
            if (!isFS) {
                const target = pm || document.documentElement;
                const rfs = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
                if (rfs) {
                    rfs.call(target).then(() => {
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(() => {});
                        }
                        updatePlayerOrientationLayout();
                    }).catch(() => {
                        if (video && video.webkitEnterFullscreen) {
                            try { video.webkitEnterFullscreen(); } catch (_) {}
                        }
                    });
                } else if (video && video.webkitEnterFullscreen) {
                    try { video.webkitEnterFullscreen(); } catch (_) {}
                }
            } else {
                const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
                if (efs) {
                    efs.call(document).then(() => {
                        if (screen.orientation && screen.orientation.unlock) {
                            screen.orientation.unlock().catch(() => {});
                        }
                        updatePlayerOrientationLayout();
                    }).catch(() => {});
                }
            }
        }

        document.addEventListener('fullscreenchange', () => syncFullscreenIcon());
        document.addEventListener('webkitfullscreenchange', () => syncFullscreenIcon());

        function togglePiP() {
            const video = document.getElementById('video-player');
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(() => {});
            } else if (video && video.requestPictureInPicture) {
                video.requestPictureInPicture().catch(() => showToast('Picture-in-Picture not supported for this stream'));
            }
        }

        let volumeHudTimer = null;
        function showVolumeHUD(effectiveVol, isMuted, pct) {
            const hud = document.getElementById('volume-hud');
            const icon = document.getElementById('volume-hud-icon');
            const bar = document.getElementById('volume-hud-bar');
            const text = document.getElementById('volume-hud-text');
            if (!hud || !bar || !text || !icon) return;

            if (isMuted) {
                icon.className = 'fa-solid fa-volume-xmark text-3xl text-primary';
                text.textContent = 'Muted';
                bar.style.width = '0%';
            } else {
                icon.className = effectiveVol < 0.4 ? 'fa-solid fa-volume-low text-3xl text-white' : 'fa-solid fa-volume-high text-3xl text-white';
                text.textContent = `${pct}%`;
                bar.style.width = `${pct}%`;
            }

            hud.classList.remove('opacity-0', 'scale-90');
            hud.classList.add('opacity-100', 'scale-100');

            clearTimeout(volumeHudTimer);
            volumeHudTimer = setTimeout(() => {
                hud.classList.remove('opacity-100', 'scale-100');
                hud.classList.add('opacity-0', 'scale-90');
            }, 1200);
        }

        function toggleMute() {
            const video = document.getElementById('video-player');
            if (!video) return;
            video.muted = !video.muted;
            if (!video.muted && video.volume === 0) {
                const saved = parseFloat(localStorage.getItem('aura_volume') || '0.8');
                video.volume = (saved > 0) ? saved : 0.8;
            }
            localStorage.setItem('aura_volume', String(video.volume));
            syncVolumeUI(true);
        }

        function syncVolumeUI(showHUD = false) {
            const video = document.getElementById('video-player');
            const muteBtn = document.getElementById('mute-btn');
            const volBar = document.getElementById('volume-bar');
            const volPct = document.getElementById('volume-pct');
            if (!video) return;

            const isMuted = video.muted || video.volume === 0;
            const effectiveVol = isMuted ? 0 : video.volume;
            const pct = Math.round(effectiveVol * 100);

            if (volBar) {
                volBar.value = effectiveVol;
                volBar.style.background = `linear-gradient(to right, #E50914 ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
            }
            if (volPct) {
                volPct.textContent = isMuted ? '0%' : `${pct}%`;
                volPct.className = `text-[11px] font-bold font-mono w-7 text-right select-none ${isMuted ? 'text-red-400' : 'text-gray-300'}`;
            }
            if (muteBtn) {
                let iconClass = 'fa-solid fa-volume-high text-sm text-white';
                if (isMuted) iconClass = 'fa-solid fa-volume-xmark text-sm text-primary';
                else if (effectiveVol < 0.4) iconClass = 'fa-solid fa-volume-low text-sm text-white';
                muteBtn.innerHTML = `<i class="${iconClass}"></i>`;
                muteBtn.title = isMuted ? 'Unmute (M)' : 'Mute (M)';
            }

            if (showHUD) {
                showVolumeHUD(effectiveVol, isMuted, pct);
            }
        }

        function toggleSubtitlesModal() {
            const sm = document.getElementById('subtitles-modal');
            if (!sm) return;
            const isHidden = sm.classList.contains('hidden');
            if (isHidden) {
                populateTracksList();
                sm.classList.remove('hidden');
                void sm.offsetWidth;
                sm.classList.replace('opacity-0', 'opacity-100');
                sm.classList.replace('translate-y-4', 'translate-y-0');
            } else {
                sm.classList.replace('opacity-100', 'opacity-0');
                sm.classList.replace('translate-y-0', 'translate-y-4');
                setTimeout(() => sm.classList.add('hidden'), 200);
            }
        }

        function populateTracksList() {
            const list = document.getElementById('subtitles-track-list');
            if (!list) return;
            const video = document.getElementById('video-player');
            
            let html = `
                <div>
                    <h5 class="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Subtitles</h5>
                    <label class="flex items-center gap-2.5 p-1.5 hover:bg-white/5 rounded cursor-pointer text-xs">
                        <input type="radio" name="sub-track" checked onchange="disableSubtitles()" class="accent-primary">
                        <span>Off</span>
                    </label>
                </div>`;

            if (state.playerEngine && state.playerEngine.subtitleTracks) {
                state.playerEngine.subtitleTracks.forEach((t, i) => {
                    html += `
                        <label class="flex items-center gap-2.5 p-1.5 hover:bg-white/5 rounded cursor-pointer text-xs">
                            <input type="radio" name="sub-track" onchange="selectSubtitleTrack(${i})" class="accent-primary">
                            <span>${esc(t.name || t.lang || `Track ${i + 1}`)}</span>
                        </label>`;
                });
            }

            if (state.playerEngine && state.playerEngine.audioTracks) {
                html += `
                    <div class="mt-3 pt-2 border-t border-white/10">
                        <h5 class="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Audio Language</h5>`;
                state.playerEngine.audioTracks.forEach((t, i) => {
                    const isCur = state.playerEngine.audioTrack === i;
                    html += `
                        <label class="flex items-center gap-2.5 p-1.5 hover:bg-white/5 rounded cursor-pointer text-xs">
                            <input type="radio" name="audio-track" ${isCur ? 'checked' : ''} onchange="selectAudioTrack(${i})" class="accent-primary">
                            <span>${esc(t.name || t.lang || `Audio ${i + 1}`)}</span>
                        </label>`;
                });
                html += `</div>`;
            }

            list.innerHTML = html;
        }

        function disableSubtitles() {
            if (state.playerEngine && state.playerEngine.subtitleTrack !== undefined) {
                state.playerEngine.subtitleTrack = -1;
            }
            const video = document.getElementById('video-player');
            for (let i = 0; i < video.textTracks.length; i++) {
                video.textTracks[i].mode = 'disabled';
            }
        }

        function selectSubtitleTrack(index) {
            if (state.playerEngine && state.playerEngine.subtitleTrack !== undefined) {
                state.playerEngine.subtitleTrack = index;
            }
        }

        function selectAudioTrack(index) {
            if (state.playerEngine && state.playerEngine.audioTrack !== undefined) {
                state.playerEngine.audioTrack = index;
            }
        }

        async function playStream(movie, isSeriesTrigger = false, epIndex = 0) {
            if (typeof movie === 'string') {
                try {
                    movie = JSON.parse(decodeURIComponent(movie));
                } catch (e) {
                    console.error("playStream JSON parse error:", e);
                    return;
                }
            }
            if (!movie) return;
            currentActiveMovie = movie;

            // Manage History Array (only track movies/episodes/vod - live channels are non-resumable linear streams)
            if (movie.id && movie.type !== 'live' && movie.stream_type !== 'live' && state.currentTab !== 'live') {
                state.history = state.history.filter(m => String(m.id) !== String(movie.id));
                state.history.unshift(movie);
                if (state.history.length > 30) state.history.pop();
                localStorage.setItem('aura_history', JSON.stringify(state.history));
            }

            // Open Modal
            const modal = document.getElementById('player-modal');
            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
            updatePlayerOrientationLayout();
            
            document.getElementById('player-main-title').textContent = movie.title;
            document.getElementById('player-sub-title').classList.add('hidden');
            hidePlayerError();
            showPlayerSpinner(true);
            
            const videoEl = document.getElementById('video-player');
            if (videoEl) {
                let savedVol = parseFloat(localStorage.getItem('aura_volume') || '1.0');
                if (isNaN(savedVol) || savedVol <= 0) savedVol = 1.0;
                videoEl.volume = savedVol;
                videoEl.muted = false;
            }
            if (window.showPlayerControls) window.showPlayerControls();
            syncVolumeUI(false);
            if (window.onStreamLiveDetected) window.onStreamLiveDetected();
            
            const btnDrawer = document.getElementById('btn-drawer');
            const drawer = document.getElementById('player-drawer');
            const btnPrevChan = document.getElementById('btn-prev-channel');
            const btnNextChan = document.getElementById('btn-next-channel');
            const btnNextEp = document.getElementById('btn-next-ep');
            
            btnDrawer.classList.add('hidden');
            drawer.classList.add('translate-x-full');

            if (isSeriesTrigger || movie.type === 'series') {
                state.playingSeries = true;
                state.currentSeriesMovie = movie;
                btnDrawer.classList.remove('hidden');
                btnNextEp.classList.remove('hidden');
                btnPrevChan.classList.add('hidden');
                btnNextChan.classList.add('hidden');
                document.getElementById('drawer-title').textContent = 'Episodes';
                
                if (state.currentSeriesEpisodes.length > 0) {
                    setupPlayerDrawerSeries();
                    playEpisodeLogic(epIndex);
                } else {
                    document.getElementById('player-main-title').textContent = "Loading Episodes...";
                    try {
                        const seriesData = await fetchXC('get_series_info', `&series_id=${movie.id}`);
                        state.currentSeriesEpisodes = [];
                        if (seriesData && seriesData.episodes) {
                            for (const season in seriesData.episodes) {
                                seriesData.episodes[season].forEach(ep => {
                                    state.currentSeriesEpisodes.push({ ...ep, season, seriesTitle: movie.title });
                                });
                            }
                            state.currentSeriesEpisodes.sort((a, b) => (parseInt(a.season) - parseInt(b.season)) || (parseInt(a.episode_num) - parseInt(b.episode_num)));
                            state.seriesSeasons = [...new Set(state.currentSeriesEpisodes.map(ep => ep.season))].sort((a, b) => parseInt(a) - parseInt(b));
                        }
                        if (state.currentSeriesEpisodes.length > 0) {
                            setupPlayerDrawerSeries();
                            playEpisodeLogic(0);
                        }
                    } catch (e) {
                        showPlayerError(movie, null);
                    }
                }
                return;
            }

            state.playingSeries = false;
            btnNextEp.classList.add('hidden');

            if (movie.type === 'live') {
                btnPrevChan.classList.remove('hidden');
                btnNextChan.classList.remove('hidden');
                btnDrawer.classList.remove('hidden');
                document.getElementById('drawer-title').textContent = 'Live Channels';
                
                let cacheKey = `get_live_streams_${movie.category_id}`;
                if (state.streams[cacheKey] && state.streams[cacheKey].length > 0) {
                    state.currentPlaylist = state.streams[cacheKey];
                } else if (state.activeCategoryStreams && state.activeCategoryStreams.length > 0) {
                    state.currentPlaylist = state.activeCategoryStreams;
                } else {
                    state.currentPlaylist = [movie];
                }
                state.currentIndex = state.currentPlaylist.findIndex(m => String(m.id) === String(movie.id));
                setupPlayerDrawerLiveChannels();
            } else {
                btnPrevChan.classList.add('hidden');
                btnNextChan.classList.add('hidden');
            }

            executePlayerEngine(movie);
        }

        function handleDrawerSearch(val) {
            state.drawerSearch = (val || '').trim().toLowerCase();
            const clearBtn = document.getElementById('drawer-search-clear');
            if (clearBtn) clearBtn.classList.toggle('hidden', !state.drawerSearch);
            setupPlayerDrawerLiveChannels();
        }

        function clearDrawerSearch() {
            state.drawerSearch = '';
            const inp = document.getElementById('drawer-search-input');
            if (inp) inp.value = '';
            const clearBtn = document.getElementById('drawer-search-clear');
            if (clearBtn) clearBtn.classList.add('hidden');
            setupPlayerDrawerLiveChannels();
        }

        function setDrawerFilter(filter, btn) {
            state.drawerFilter = filter;
            document.querySelectorAll('.drawer-chip').forEach(c => {
                c.className = 'drawer-chip px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0';
            });
            if (btn) {
                btn.className = 'drawer-chip px-2.5 py-1 rounded-md text-[11px] font-bold bg-primary text-white shadow-sm flex-shrink-0';
            }
            setupPlayerDrawerLiveChannels();
        }

        function setupPlayerDrawerLiveChannels() {
            const list = document.getElementById('drawer-list');
            const ss = document.getElementById('player-season-selector');
            const filterBar = document.getElementById('drawer-filter-bar');
            if (ss) ss.classList.add('hidden');
            if (filterBar) filterBar.classList.remove('hidden');

            const countEl = document.getElementById('drawer-count');
            let items = (state.currentPlaylist || []).map((ch, index) => ({ ch, originalIndex: index }));

            // Apply filter chips
            if (state.drawerFilter === 'fav') {
                items = items.filter(it => isFavorite(it.ch.id));
            } else if (state.drawerFilter === '4k') {
                items = items.filter(it => /4k|uhd|2160p/i.test(it.ch.title));
            } else if (state.drawerFilter === 'fhd') {
                items = items.filter(it => /fhd|1080p|60fps/i.test(it.ch.title));
            }

            // Apply search query
            if (state.drawerSearch) {
                const q = state.drawerSearch;
                items = items.filter(it => (it.ch.title || '').toLowerCase().includes(q));
            }

            if (countEl) {
                countEl.textContent = `${items.length} ${items.length === 1 ? 'channel' : 'channels'}`;
            }

            if (items.length === 0) {
                list.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-16 text-center text-gray-400">
                        <i class="fa-solid fa-tv text-3xl mb-3 opacity-30"></i>
                        <p class="text-xs font-semibold">No channels match filter</p>
                        ${state.drawerSearch ? `<button onclick="clearDrawerSearch()" class="mt-3 text-xs text-primary hover:underline">Clear search</button>` : ''}
                    </div>
                `;
                return;
            }

            list.innerHTML = items.map(({ ch, originalIndex }) => {
                const isActive = originalIndex === state.currentIndex;
                const fav = isFavorite(ch.id);
                const tag = getStreamQualityTag(ch.title);
                const enc = encObj(ch);

                return `
                    <div onclick="changeToChannel(${originalIndex})" class="drawer-item p-2.5 rounded-xl cursor-pointer transition-all duration-200 flex items-center gap-3 group ${isActive ? 'is-active-channel bg-primary/20 border border-primary/50 shadow-[0_0_15px_rgba(229,9,20,0.25)]' : 'bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-white/20'}">
                        
                        <!-- Channel Logo / Monogram -->
                        <div class="relative w-12 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-black/60 border border-white/10 flex items-center justify-center p-1 group-hover:border-white/30 transition-colors">
                            <img src="${ch.img}" data-fallback="${ch.fallbackStr}" class="w-full h-full object-contain" onerror="this.onerror=null;this.src=this.dataset.fallback;">
                            ${isActive ? `
                                <div class="absolute inset-0 bg-black/65 backdrop-blur-[1px] flex items-center justify-center">
                                    <div class="flex items-center gap-0.5 h-3">
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-1"></span>
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-2"></span>
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-3"></span>
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Channel Info -->
                        <div class="flex-1 overflow-hidden min-w-0">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] font-mono font-bold ${isActive ? 'text-primary' : 'text-gray-500'} flex-shrink-0">#${originalIndex + 1}</span>
                                <h4 class="text-xs font-bold truncate ${isActive ? 'text-white' : 'text-gray-200 group-hover:text-white'}">${esc(ch.title)}</h4>
                            </div>
                            <div class="flex items-center gap-1.5 mt-1">
                                <span class="text-[8px] font-black tracking-widest px-1 py-0.2 rounded bg-red-500/20 text-red-400 border border-red-500/30">LIVE</span>
                                ${tag ? `<span class="text-[8px] font-black tracking-wider px-1 py-0.2 rounded border ${tag.class}">${tag.label}</span>` : ''}
                            </div>
                        </div>

                        <!-- In-drawer Favorite Star Action -->
                        <button onclick="event.stopPropagation(); toggleFavorite('${enc}', event); setupPlayerDrawerLiveChannels();" class="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-red-500 hover:bg-white/10 transition-colors flex-shrink-0" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">
                            ${fav ? '<i class="fa-solid fa-heart text-red-500 text-xs"></i>' : '<i class="fa-regular fa-heart text-xs group-hover:text-gray-300"></i>'}
                        </button>
                    </div>
                `;
            }).join('');
        }

        function changeToChannel(index) {
            if (index < 0 || index >= state.currentPlaylist.length) return;
            state.currentIndex = index;
            const ch = state.currentPlaylist[index];
            currentActiveMovie = ch;
            state.currentActiveMovie = ch;
            document.getElementById('player-main-title').textContent = ch.title;
            executePlayerEngine(ch);
            setupPlayerDrawerLiveChannels();
        }

        function playEpisodeLogic(index) {
            state.currentIndex = index;
            const ep = state.currentSeriesEpisodes[index];
            if (!ep) return;
            
            document.getElementById('player-main-title').textContent = state.currentSeriesMovie ? state.currentSeriesMovie.title : ep.seriesTitle;
            document.getElementById('player-sub-title').textContent = `S${ep.season} E${ep.episode_num} - ${ep.title}`;
            document.getElementById('player-sub-title').classList.remove('hidden');
            
            const epId = ep.id || ep.stream_id;
            const epMovieObj = {
                id: epId,
                title: `${state.currentSeriesMovie ? state.currentSeriesMovie.title : ''} - ${ep.title}`,
                ext: ep.container_extension || 'mp4',
                type: 'episode',
                seriesTitle: state.currentSeriesMovie ? state.currentSeriesMovie.title : ''
            };
            
            executePlayerEngine(epMovieObj);
            setupPlayerDrawerSeries(ep.season);
        }

        function togglePlayerDrawer() {
            const drawer = document.getElementById('player-drawer');
            if (!drawer) return;
            const isClosed = drawer.classList.contains('translate-x-full');
            if (isClosed) {
                drawer.classList.remove('translate-x-full');
                if (state.playingSeries) {
                    setupPlayerDrawerSeries();
                } else {
                    setupPlayerDrawerLiveChannels();
                }
                setTimeout(() => {
                    const active = document.querySelector('#drawer-list .is-active-channel');
                    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }, 120);
            } else {
                drawer.classList.add('translate-x-full');
            }
        }

        function setupPlayerDrawerSeries(seasonFilter) {
            const list = document.getElementById('drawer-list');
            const filterBar = document.getElementById('drawer-filter-bar');
            if (filterBar) filterBar.classList.add('hidden');

            const currentSeason = seasonFilter || state.currentSeriesEpisodes[state.currentIndex]?.season || state.seriesSeasons[0];
            
            const countEl = document.getElementById('drawer-count');
            const epInSeason = state.currentSeriesEpisodes.filter(ep => ep.season == currentSeason);
            if (countEl) countEl.textContent = `${epInSeason.length} episodes`;

            const ss = document.getElementById('player-season-selector');
            ss.classList.remove('hidden');
            ss.innerHTML = state.seriesSeasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
            ss.value = currentSeason;
            ss.onchange = (e) => setupPlayerDrawerSeries(e.target.value);

            list.innerHTML = state.currentSeriesEpisodes.map((ep, index) => {
                if (ep.season != currentSeason) return ''; 
                const isActive = index === state.currentIndex;
                return `
                    <div onclick="playEpisodeLogic(${index})" class="drawer-item p-2.5 rounded-xl cursor-pointer transition-all duration-200 flex gap-3 ${isActive ? 'is-active-channel bg-primary/20 border border-primary/50 shadow-[0_0_15px_rgba(229,9,20,0.25)]' : 'bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-white/20'}">
                        <div class="relative w-20 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-black/60 border border-white/10 flex items-center justify-center text-xs text-gray-500 font-bold">
                            ${ep.info?.movie_image ? `<img src="${ep.info.movie_image}" class="w-full h-full object-cover">` : `S${ep.season}E${ep.episode_num}`}
                            ${isActive ? `
                                <div class="absolute inset-0 bg-black/65 backdrop-blur-[1px] flex items-center justify-center">
                                    <div class="flex items-center gap-0.5 h-3">
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-1"></span>
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-2"></span>
                                        <span class="w-0.5 bg-primary rounded-full eq-bar-3"></span>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="flex-1 overflow-hidden flex flex-col justify-center">
                            <h4 class="text-white text-xs font-bold line-clamp-2">${ep.episode_num}. ${esc(ep.title)}</h4>
                            <span class="text-[9px] text-gray-400 mt-1 uppercase font-bold tracking-wider">${ep.info?.duration || 'Episode'}</span>
                        </div>
                    </div>`;
            }).join('');
        }

        function toggleQualityModal() {
            const qm = document.getElementById('quality-modal');
            if (!qm) return;
            const isHidden = qm.classList.contains('hidden');
            if (isHidden) {
                const subModal = document.getElementById('subtitles-modal');
                if (subModal) subModal.classList.add('hidden');
                renderQualityList();
                qm.classList.remove('hidden');
                void qm.offsetWidth;
                qm.classList.remove('opacity-0', 'translate-y-4');
                qm.classList.add('opacity-100', 'translate-y-0');
            } else {
                qm.classList.remove('opacity-100', 'translate-y-0');
                qm.classList.add('opacity-0', 'translate-y-4');
                setTimeout(() => qm.classList.add('hidden'), 200);
            }
        }

        function renderQualityList() {
            const list = document.getElementById('quality-track-list');
            if (!list) return;
            const video = document.getElementById('video-player');
            const hls = (state.playerEngine && state.playerEngine.levels) ? state.playerEngine : null;
            const currentPref = localStorage.getItem('aura_quality_pref') || 'highest';
            
            let html = '';
            
            // Auto (Highest Quality Available) option
            const isHighest = currentPref === 'highest';
            html += `
                <div onclick="selectQualityLevel('highest')" class="p-2.5 rounded-xl cursor-pointer transition-colors flex items-center justify-between ${isHighest ? 'bg-primary/20 border border-primary/50' : 'bg-white/5 hover:bg-white/10 border border-white/5'}">
                    <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs border border-amber-500/30">
                            <i class="fa-solid fa-bolt"></i>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-white text-xs font-bold">Highest Quality (Auto-Lock)</span>
                            <span class="text-[10px] text-gray-400">Guarantees maximum bitrate & 4K/1080p stream</span>
                        </div>
                    </div>
                    ${isHighest ? '<i class="fa-solid fa-check text-primary text-xs font-bold"></i>' : ''}
                </div>
            `;

            if (hls && hls.levels && hls.levels.length > 1) {
                html += `<div class="pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Available Resolution Variants</div>`;
                hls.levels.forEach((lvl, idx) => {
                    const isSelected = (!isHighest && currentPref === String(idx)) || (hls.currentLevel === idx);
                    const height = lvl.height || 0;
                    const width = lvl.width || 0;
                    const mbps = lvl.bitrate ? (lvl.bitrate / 1000000).toFixed(1) + ' Mbps' : '';
                    const resLabel = height >= 2160 ? '4K UHD' : (height >= 1080 ? 'FHD 1080p' : (height >= 720 ? 'HD 720p' : `${height}p`));
                    
                    html += `
                        <div onclick="selectQualityLevel(${idx})" class="p-2.5 rounded-xl cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-white/15 border border-white/30' : 'bg-white/5 hover:bg-white/10 border border-white/5'}">
                            <div class="flex items-center gap-2">
                                <span class="text-white text-xs font-bold">${resLabel}</span>
                                ${width && height ? `<span class="text-[10px] text-gray-400 font-mono">${width}x${height}</span>` : ''}
                                ${mbps ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 font-mono">${mbps}</span>` : ''}
                            </div>
                            ${isSelected ? '<i class="fa-solid fa-check text-green-400 text-xs"></i>' : ''}
                        </div>
                    `;
                });
            } else {
                // Direct MPEG-TS or raw stream info
                const w = video?.videoWidth || 0;
                const h = video?.videoHeight || 0;
                const resText = h >= 2160 ? '4K Ultra HD (Broadcast Direct)' : (h >= 1080 ? 'Full HD 1080p (Broadcast Passthrough)' : (h >= 720 ? 'HD 720p (Broadcast Passthrough)' : (h > 0 ? `${w}x${h} Native Direct` : 'Direct Native Master Stream')));
                html += `
                    <div class="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
                        <div class="flex flex-col">
                            <span class="text-white text-xs font-bold flex items-center gap-1.5"><i class="fa-solid fa-circle-check text-green-400 text-xs"></i> ${resText}</span>
                            <span class="text-[10px] text-gray-400 mt-1">Raw uncompressed provider broadcast stream with full platform hardware decoding</span>
                        </div>
                    </div>
                `;
            }

            list.innerHTML = html;
        }

        function selectQualityLevel(lvl) {
            localStorage.setItem('aura_quality_pref', String(lvl));
            const hls = (state.playerEngine && state.playerEngine.levels) ? state.playerEngine : null;
            if (hls && hls.levels) {
                if (lvl === 'highest') {
                    let bestIndex = 0;
                    let maxScore = -1;
                    hls.levels.forEach((l, idx) => {
                        const score = (l.height || 0) * 1000000 + (l.bitrate || 0);
                        if (score > maxScore) { maxScore = score; bestIndex = idx; }
                    });
                    hls.currentLevel = bestIndex;
                    hls.loadLevel = bestIndex;
                } else {
                    const idx = parseInt(lvl);
                    if (!isNaN(idx)) {
                        hls.currentLevel = idx;
                        hls.loadLevel = idx;
                    }
                }
            }
            updateQualityBadgeUI(hls);
            toggleQualityModal();
        }

        function updateQualityBadgeUI(hlsInstance) {
            const badge = document.getElementById('stream-quality-badge');
            const badgeText = document.getElementById('stream-quality-text');
            const btnLabel = document.getElementById('btn-quality-label');
            const video = document.getElementById('video-player');
            if (!badge || !badgeText) return;

            let text = '';
            let colorClass = 'bg-primary/20 text-primary border-primary/30';

            const hls = hlsInstance || (state.playerEngine && state.playerEngine.levels ? state.playerEngine : null);
            if (hls && hls.levels && hls.currentLevel >= 0 && hls.levels[hls.currentLevel]) {
                const cur = hls.levels[hls.currentLevel];
                const h = cur.height || (video ? video.videoHeight : 0);
                if (h >= 2160) {
                    text = '4K UHD';
                    colorClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                } else if (h >= 1080) {
                    text = 'FHD 1080p';
                    colorClass = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                } else if (h >= 720) {
                    text = 'HD 720p';
                    colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                } else if (h > 0) {
                    text = `${h}p`;
                    colorClass = 'bg-white/10 text-gray-300 border-white/20';
                }
            } else if (video && video.videoHeight > 0) {
                const h = video.videoHeight;
                if (h >= 2160) {
                    text = '4K UHD';
                    colorClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                } else if (h >= 1080) {
                    text = 'FHD 1080p';
                    colorClass = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                } else if (h >= 720) {
                    text = 'HD 720p';
                    colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                } else {
                    text = `${h}p`;
                    colorClass = 'bg-white/10 text-gray-300 border-white/20';
                }
            }

            if (text) {
                badge.className = `px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase border flex items-center gap-1 shadow-sm ${colorClass}`;
                badgeText.textContent = text;
                badge.classList.remove('hidden');
                if (btnLabel) btnLabel.textContent = text;
            }
        }

        function cleanupPlayerResources(videoEl) {
            if (state.candidateWatchdog) {
                clearTimeout(state.candidateWatchdog);
                state.candidateWatchdog = null;
            }

            if (state.playerEngine) {
                try {
                    if (typeof state.playerEngine.stopLoad === 'function') state.playerEngine.stopLoad();
                    if (typeof state.playerEngine.unload === 'function') state.playerEngine.unload();
                    if (typeof state.playerEngine.detachMedia === 'function') state.playerEngine.detachMedia();
                    else if (typeof state.playerEngine.detachMediaElement === 'function') state.playerEngine.detachMediaElement();
                    state.playerEngine.destroy();
                } catch (_) {}
                state.playerEngine = null;
            }

            const el = videoEl || document.getElementById('video-player');
            if (el) {
                // Temporarily detach onerror while resetting src to prevent artificial onerror dispatch cascades
                const prevOnError = el.onerror;
                el.onerror = null;
                try {
                    el.pause();
                    el.removeAttribute('src');
                    el.srcObject = null;
                    el.load();
                } catch (_) {}
                // Restore onerror callback after synchronous reset
                setTimeout(() => {
                    if (el && el.onerror === null && prevOnError) el.onerror = prevOnError;
                }, 0);
            }
        }

        function executePlayerEngine(movie) {
            const video = document.getElementById('video-player');
            hidePlayerError();
            showPlayerSpinner(true);

            // Track previous movie for last channel recall (0 or L key)
            if (state.currentActiveMovie && String(state.currentActiveMovie.id) !== String(movie.id)) {
                state.lastWatchedMovie = state.currentActiveMovie;
            }
            currentActiveMovie = movie;
            state.currentActiveMovie = movie;
            announceA11y(`Now playing: ${movie.title || movie.name}`);

            // Invalidate any previous playback session and flush GPU video textures/buffers
            cleanupPlayerResources(video);
            state.playbackSessionId = (state.playbackSessionId || 0) + 1;
            const currentSession = state.playbackSessionId;

            // Restore volume preferences and ensure unmuted
            let savedVol = parseFloat(localStorage.getItem('aura_volume') || '1.0');
            if (isNaN(savedVol) || savedVol <= 0) savedVol = 1.0;
            video.volume = savedVol;
            video.muted = false;

            const serverClean = getServer();
            const u = encodeURIComponent(config.user);
            const p = encodeURIComponent(config.pass);
            const isLive = movie.type === 'live' || movie.stream_type === 'live' || state.currentTab === 'live';

            let urls = [];
            
            // If direct stream URL was provided (e.g. M3U playlist)
            if (movie.streamUrl) {
                urls.push(movie.streamUrl);
            }

            if (movie.type === 'episode') {
                if (serverClean) {
                    urls.push(`${serverClean}/series/${u}/${p}/${movie.id}.${movie.ext}`);
                    urls.push(`${serverClean}/series/${u}/${p}/${movie.id}.mp4`);
                    urls.push(`${serverClean}/series/${u}/${p}/${movie.id}.mkv`);
                }
            } else if (isLive) {
                if (serverClean) {
                    urls.push(`${serverClean}/live/${u}/${p}/${movie.id}.m3u8`);
                    urls.push(`${serverClean}/${u}/${p}/${movie.id}.m3u8`);
                    urls.push(`${serverClean}/live/${u}/${p}/${movie.id}.ts`);
                    urls.push(`${serverClean}/${u}/${p}/${movie.id}.ts`);
                    urls.push(`${serverClean}/${u}/${p}/${movie.id}`);
                }
            } else {
                if (serverClean) {
                    urls.push(`${serverClean}/movie/${u}/${p}/${movie.id}.${movie.ext}`);
                    urls.push(`${serverClean}/movie/${u}/${p}/${movie.id}.mp4`);
                    urls.push(`${serverClean}/movie/${u}/${p}/${movie.id}.mkv`);
                }
            }

            urls = [...new Set(urls)];
            let currentAttempt = 0;
            let isAttempting = false;

            const clearWatchdog = () => {
                if (state.candidateWatchdog) {
                    clearTimeout(state.candidateWatchdog);
                    state.candidateWatchdog = null;
                }
            };

            setupPlayerControls(video);
            // Update scrubber mode immediately based on currentActiveMovie type
            if (window.onStreamLiveDetected) window.onStreamLiveDetected();

            function attemptPlay() {
                if (state.playbackSessionId !== currentSession) return;
                if (isAttempting) return;
                isAttempting = true;
                clearWatchdog();

                if (currentAttempt >= urls.length) {
                    isAttempting = false;
                    showPlayerSpinner(false);
                    state.hasPlaybackError = true;
                    showPlayerError(movie, urls[0]);
                    return;
                }

                let streamUrl = urls[currentAttempt];
                currentAttempt++;
                state.activeStreamUrl = streamUrl;

                // Update connecting spinner text with candidate attempt info if multiple attempts
                const spinnerText = document.querySelector('#player-loading-spinner span');
                if (spinnerText) {
                    spinnerText.textContent = currentAttempt > 1 ? `Connecting (stream ${currentAttempt}/${urls.length})...` : 'Connecting to stream...';
                }

                const isM3U8 = streamUrl.includes('.m3u8');
                const proxiedUrl = window.auraNative?.mediaProxy ? window.auraNative.mediaProxy(streamUrl) : streamUrl;

                // Stop previous engine without forcing video element reset
                if (state.playerEngine) {
                    try {
                        if (typeof state.playerEngine.stopLoad === 'function') state.playerEngine.stopLoad();
                        state.playerEngine.destroy();
                    } catch (_) {}
                    state.playerEngine = null;
                }
                isAttempting = false;

                // If candidate doesn't begin playing in 6s, smoothly try next candidate
                state.candidateWatchdog = setTimeout(() => {
                    if (state.playbackSessionId !== currentSession) return;
                    if (video.paused || video.readyState < 2) {
                        console.warn(`Candidate ${streamUrl} timed out after 10s, trying next candidate...`);
                        cleanupPlayerResources(video);
                        attemptPlay();
                    }
                }, 10000);

                try {
                    // 1. If HLS (.m3u8), use Hls.js or Native Apple HLS
                    const canNativeHls = video.canPlayType && !!video.canPlayType('application/vnd.apple.mpegurl');
                    if (isM3U8) {
                        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                            const hls = new Hls({
                                enableWorker: true,
                                lowLatencyMode: false, // Standard IPTV streams need reliable buffer; false prevents underruns
                                backBufferLength: 30,
                                maxBufferLength: 30,
                                maxMaxBufferLength: 60,
                                liveSyncDurationCount: 3, // 3 segments sync distance provides stable continuous playback
                                liveMaxLatencyDurationCount: 8,
                                liveDurationInfinity: true,
                                capLevelToPlayerSize: false,
                                manifestLoadingTimeOut: 12000,
                                manifestLoadingMaxRetry: 3,
                                manifestLoadingRetryDelay: 1000,
                                fragLoadingTimeOut: 15000,
                                fragLoadingMaxRetry: 4,
                                fragLoadingRetryDelay: 1000,
                                startFragPrefetch: true
                            });
                            state.playerEngine = hls;
                            hls.loadSource(proxiedUrl);
                            hls.attachMedia(video);

                            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                                if (state.playbackSessionId !== currentSession) return;
                                
                                // Automatically lock to the HIGHEST available quality variant
                                if (hls.levels && hls.levels.length > 0) {
                                    let bestLevelIndex = 0;
                                    let maxScore = -1;
                                    hls.levels.forEach((lvl, idx) => {
                                        const score = (lvl.height || 0) * 1000000 + (lvl.bitrate || 0);
                                        if (score > maxScore) {
                                            maxScore = score;
                                            bestLevelIndex = idx;
                                        }
                                    });

                                    const userPref = localStorage.getItem('aura_quality_pref') || 'highest';
                                    if (userPref === 'highest') {
                                        hls.startLevel = bestLevelIndex;
                                        hls.currentLevel = bestLevelIndex;
                                        hls.loadLevel = bestLevelIndex;
                                    } else {
                                        const parsedIdx = parseInt(userPref);
                                        if (!isNaN(parsedIdx) && parsedIdx >= 0 && parsedIdx < hls.levels.length) {
                                            hls.currentLevel = parsedIdx;
                                            hls.loadLevel = parsedIdx;
                                        } else {
                                            hls.currentLevel = bestLevelIndex;
                                            hls.loadLevel = bestLevelIndex;
                                        }
                                    }
                                    updateQualityBadgeUI(hls);
                                }
                                video.play().catch(() => {});
                            });

                            hls.on(Hls.Events.LEVEL_SWITCHED, () => {
                                if (state.playbackSessionId !== currentSession) return;
                                updateQualityBadgeUI(hls);
                            });

                            hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
                                if (state.playbackSessionId !== currentSession) return;
                                if (data && data.details && data.details.live) {
                                    window.onStreamLiveDetected && window.onStreamLiveDetected(data.details);
                                }
                            });

                            hls.on(Hls.Events.ERROR, (event, data) => {
                                if (state.playbackSessionId !== currentSession) return;
                                if (data.details === 'manifestLoadError' ||
                                    data.details === 'manifestParsingError' ||
                                    data.details === 'manifestLoadTimeOut' ||
                                    (data.response && data.response.code >= 400)) {
                                    clearWatchdog();
                                    cleanupPlayerResources(video);
                                    attemptPlay();
                                    return;
                                }
                                if (!data.fatal) return;
                                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                    console.warn('HLS fatal network error, auto-recovering with startLoad()...');
                                    hls.startLoad();
                                    return;
                                }
                                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                    console.warn('HLS fatal media error, recovering...');
                                    hls.recoverMediaError();
                                    return;
                                }
                                clearWatchdog();
                                cleanupPlayerResources(video);
                                attemptPlay();
                            });
                            return;
                        } else if (canNativeHls) {
                            // Native Safari / iOS HLS
                            video.src = proxiedUrl;
                            const playPromise = video.play();
                            if (playPromise !== undefined) {
                                playPromise.catch((e) => {
                                    if (state.playbackSessionId !== currentSession) return;
                                    if (e.name !== 'NotAllowedError') {
                                        clearWatchdog();
                                        cleanupPlayerResources(video);
                                        attemptPlay();
                                    }
                                });
                            }
                            return;
                        }
                    }

                    // 2. If MPEG-TS or Live TS/Stream, use mpegts.js with type: 'mpegts'
                    if ((streamUrl.endsWith('.ts') || isLive) && typeof mpegts !== 'undefined' && mpegts.isSupported()) {
                        const player = mpegts.createPlayer({
                            type: 'mpegts',
                            isLive: isLive,
                            url: proxiedUrl
                        }, {
                            enableWorker: true,
                            lazyLoad: false,
                            liveBufferLatencyChasing: false,
                            autoCleanupSourceBuffer: true
                        });
                        state.playerEngine = player;
                        player.attachMediaElement(video);
                        player.load();

                        player.on(mpegts.Events.ERROR, () => {
                            if (state.playbackSessionId !== currentSession) return;
                            clearWatchdog();
                            cleanupPlayerResources(video);
                            attemptPlay();
                        });

                        const playPromise = player.play();
                        if (playPromise !== undefined) {
                            playPromise.catch((err) => {
                                if (state.playbackSessionId !== currentSession) return;
                                console.warn("mpegts play caught:", err);
                                video.play().catch(() => {});
                            });
                        }
                        return;
                    }

                    // 3. Fallback direct playback on video element
                    video.src = proxiedUrl;
                    const p = video.play();
                    if (p !== undefined) {
                        p.catch((e) => {
                            if (state.playbackSessionId !== currentSession) return;
                            if (e.name !== 'NotAllowedError') {
                                clearWatchdog();
                                cleanupPlayerResources(video);
                                attemptPlay();
                            }
                        });
                    }
                } catch (err) {
                    if (state.playbackSessionId !== currentSession) return;
                    clearWatchdog();
                    cleanupPlayerResources(video);
                    attemptPlay();
                }
            }

            video.onwaiting = () => {
                if (state.playbackSessionId !== currentSession) return;
                if (!video.paused && video.currentTime > 0) {
                    showPlayerSpinner(true);
                }
            };
            video.onplaying = () => {
                if (state.playbackSessionId !== currentSession) return;
                clearWatchdog();
                showPlayerSpinner(false);
                // Do not auto-dismiss error dialog if in persistent error state
                if (!state.hasPlaybackError) {
                    hidePlayerError();
                }
                updateQualityBadgeUI();
                if (window.onPlayerTimeUpdate) window.onPlayerTimeUpdate();
            };
            video.oncanplay = () => {
                if (state.playbackSessionId !== currentSession) return;
                clearWatchdog();
                showPlayerSpinner(false);
            };
            video.onerror = () => {
                if (state.playbackSessionId !== currentSession) return;
                clearWatchdog();
                cleanupPlayerResources(video);
                attemptPlay();
            };
            video.onended = () => {
                if (state.playbackSessionId !== currentSession) return;
                clearWatchdog();
                if (state.playingSeries && state.currentIndex < state.currentSeriesEpisodes.length - 1) {
                    changeChannel(1);
                }
            };

            attemptPlay();
        }

        function showPlayerError(movie, failedUrl, errorReason = null) {
            state.hasPlaybackError = true;
            showPlayerSpinner(false);
            const errBox = document.getElementById('player-error');
            if (errBox) errBox.classList.remove('hidden');

            const serverClean = getServer();
            let streamUrl = failedUrl || (movie.type === 'live' ? `${serverClean}/${config.user}/${config.pass}/${movie.id}` : `${serverClean}/movie/${config.user}/${config.pass}/${movie.id}.${movie.ext}`);
            state.activeStreamUrl = streamUrl;

            // Classify specific failure reason
            let title = 'Playback Issue';
            let desc = 'Stream codec or connection temporarily unresponsive.';
            const isMixed = window.location.protocol === 'https:' && (streamUrl.startsWith('http://') || failedUrl?.startsWith('http://')) && !window.location.hostname.includes('localhost');

            if (isMixed) {
                title = 'Mixed Content Blocked';
                desc = 'Browser on HTTPS blocked unencrypted HTTP stream. Stream through the AURA proxy or connect via HTTPS.';
            } else if (errorReason === 'cors') {
                title = 'CORS Blocked';
                desc = 'IPTV provider lacks CORS headers. Stream through the AURA proxy to bypass browser restriction.';
            } else if (errorReason === 'offline' || errorReason === '404') {
                title = 'Stream Offline (404)';
                desc = 'This channel or video is currently unavailable on provider servers.';
            } else if (errorReason === 'auth' || errorReason === '401' || errorReason === '403') {
                title = 'Authentication Error';
                desc = 'Account subscription may have expired or max connections reached.';
            }

            const titleEl = document.getElementById('player-error-title');
            const descEl = document.getElementById('player-error-desc');
            if (titleEl) titleEl.textContent = title;
            if (descEl) descEl.textContent = desc;
            announceA11y(`Playback error: ${title}. ${desc}`);
            
            const m3uContent = `#EXTM3U\n#EXTVLCOPT:http-user-agent=IPTVSmartersPro\n#EXTVLCOPT:http-referrer=${serverClean}/\n#EXTINF:-1,${String(movie.title).replace(/[\r\n]/g, ' ')}\n${streamUrl}`;
            const blob = new Blob([m3uContent], { type: "audio/mpegurl" });
            
            if (playerBlobUrl) URL.revokeObjectURL(playerBlobUrl);
            playerBlobUrl = URL.createObjectURL(blob);
            
            const vlcEl = document.getElementById('vlc-download');
            if (vlcEl) {
                vlcEl.href = playerBlobUrl;
                vlcEl.download = `${(movie.title || 'stream').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.m3u`;
            }
        }

        function changeChannel(direction) {
            if (state.playingSeries) {
                if (state.currentSeriesEpisodes.length === 0 || state.currentIndex === -1) return;
                let nextIndex = state.currentIndex + direction;
                if (nextIndex < 0) nextIndex = state.currentSeriesEpisodes.length - 1;
                if (nextIndex >= state.currentSeriesEpisodes.length) nextIndex = 0;
                playEpisodeLogic(nextIndex);
                return;
            }

            if (state.currentPlaylist.length === 0 || state.currentIndex === -1) return;
            let nextIndex = state.currentIndex + direction;
            if (nextIndex < 0) nextIndex = state.currentPlaylist.length - 1;
            if (nextIndex >= state.currentPlaylist.length) nextIndex = 0;
            changeToChannel(nextIndex);
        }

        function closePlayer() {
            clearTimeout(controlsTimer);
            try {
                if (navigator.sendBeacon) {
                    navigator.sendBeacon('/api/stop-stream');
                } else {
                    fetch('/api/stop-stream', { method: 'POST', keepalive: true }).catch(() => {});
                }
            } catch (_) {}
            // Invalidate session — all async callbacks (watchdog, HLS events) will see stale session
            state.playbackSessionId = (state.playbackSessionId || 0) + 1;
            // Clear the active movie so isStreamLive() returns false immediately
            currentActiveMovie = null;
            state.currentActiveMovie = null;
            const video = document.getElementById('video-player');
            if (video) {
                video.onwaiting = null;
                video.onplaying = null;
                video.oncanplay = null;
                video.onerror = null;
                video.onended = null;
            }
            cleanupPlayerResources(video);
            showPlayerSpinner(false);
            hidePlayerError();
            if (screen.orientation && screen.orientation.unlock) {
                try { screen.orientation.unlock(); } catch (_) {}
            }
            
            const drawer = document.getElementById('player-drawer');
            if (drawer) drawer.classList.add('translate-x-full');
            const subModal = document.getElementById('subtitles-modal');
            if (subModal) subModal.classList.add('hidden');
            const qualityModal = document.getElementById('quality-modal');
            if (qualityModal) qualityModal.classList.add('hidden');
            const qualityBadge = document.getElementById('stream-quality-badge');
            if (qualityBadge) qualityBadge.classList.add('hidden');
            
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document).catch(() => {});
            }
            if (video && video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
                try { video.webkitExitFullscreen(); } catch (_) {}
            }
            
            const pm = document.getElementById('player-modal');
            if (pm) {
                pm.classList.remove('opacity-100');
                pm.classList.add('opacity-0');
                setTimeout(() => pm.classList.add('hidden'), 300);
            }
            
            document.body.style.cursor = 'default';
            if (state.currentTab === 'favorites') renderFavoritesView();
        }

        function setupPlayerControls(video) {
            const playBtn = document.getElementById('play-pause-btn');
            const muteBtn = document.getElementById('mute-btn');
            const volBar = document.getElementById('volume-bar');
            const seekBar = document.getElementById('seek-bar');
            const timeCurrent = document.getElementById('time-current');
            const timeTotal = document.getElementById('time-total');

            const formatTime = (sec) => {
                if (isNaN(sec) || sec === Infinity) return "0:00";
                const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
                if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                return `${m}:${s.toString().padStart(2, '0')}`;
            };

            const isLiveStream = () => (typeof window.isStreamLive === 'function') ? window.isStreamLive() : false;

            let isSeeking = false;

            const updateScrubberMode = () => {
                const live = isLiveStream();
                const seekBarContainer = document.getElementById('seek-bar-container');
                const rewindBtn = document.getElementById('rewind-btn');
                const forwardBtn = document.getElementById('forward-btn');
                const liveBtn = document.getElementById('btn-go-live');

                if (live) {
                    // LIVE STREAM:
                    // 1. Hide seek bar container completely (no progress bar, no time displays)
                    if (seekBarContainer) seekBarContainer.style.display = 'none';
                    // 2. Hide Rewind & Forward buttons
                    if (rewindBtn) rewindBtn.style.display = 'none';
                    if (forwardBtn) forwardBtn.style.display = 'none';
                    // 3. Show LIVE button that takes user directly to live edge
                    if (liveBtn) liveBtn.style.display = 'inline-flex';
                } else {
                    // VOD / SERIES STREAM:
                    // 1. Show seek bar container
                    if (seekBarContainer) seekBarContainer.style.display = 'flex';
                    // 2. Show Rewind & Forward buttons
                    if (rewindBtn) rewindBtn.style.display = 'flex';
                    if (forwardBtn) forwardBtn.style.display = 'flex';
                    // 3. Hide LIVE button
                    if (liveBtn) liveBtn.style.display = 'none';

                    seekBar.min = 0;
                    if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
                        seekBar.max = video.duration;
                        timeTotal.textContent = formatTime(video.duration);
                    }
                    if (!isSeeking) {
                        seekBar.value = video.currentTime;
                        timeCurrent.textContent = formatTime(video.currentTime);
                        const pct = Math.min(100, Math.max(0, (seekBar.value / (seekBar.max || 1)) * 100));
                        seekBar.style.background = `linear-gradient(to right, #E50914 ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
                    }
                }
            };

            window.onStreamLiveDetected = () => updateScrubberMode();
            window.onPlayerTimeUpdate = () => updateScrubberMode();

            video.onplay = () => {
                playBtn.innerHTML = '<i class="fa-solid fa-pause text-lg sm:text-2xl md:text-3xl"></i>';
                // Keep controls visible briefly after play so user sees the state change
                window.showPlayerControls && window.showPlayerControls(false);
            };
            video.onpause = () => {
                playBtn.innerHTML = '<i class="fa-solid fa-play text-lg sm:text-2xl md:text-3xl ml-0.5"></i>';
                // Always show controls when paused — never auto-hide while paused
                window.showPlayerControls && window.showPlayerControls(false);
            };
            
            playBtn.onclick = (e) => {
                if (e) e.stopPropagation();
                if (video.paused) {
                    video.play().catch(() => {});
                } else {
                    video.pause();
                }
                // Refresh the auto-hide timer so controls stay visible after toggling
                window.showPlayerControls && window.showPlayerControls(true);
            };
            document.getElementById('rewind-btn').onclick = (e) => {
                e.stopPropagation();
                if (isLiveStream()) {
                    window.goToLiveEdge && window.goToLiveEdge();
                } else {
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    triggerSeekRipple('left');
                }
                window.showPlayerControls && window.showPlayerControls(true);
            };
            document.getElementById('forward-btn').onclick = (e) => {
                e.stopPropagation();
                if (isLiveStream()) {
                    window.goToLiveEdge && window.goToLiveEdge();
                } else {
                    video.currentTime = Math.min(video.duration || 999999, video.currentTime + 10);
                    triggerSeekRipple('right');
                }
                window.showPlayerControls && window.showPlayerControls(true);
            };

            muteBtn.onclick = (e) => {
                if (e) e.stopPropagation();
                toggleMute();
                window.showPlayerControls && window.showPlayerControls(true);
            };
            volBar.oninput = (e) => {
                video.volume = parseFloat(e.target.value);
                video.muted = (video.volume === 0);
                localStorage.setItem('aura_volume', String(video.volume));
                syncVolumeUI(true);
                window.showPlayerControls && window.showPlayerControls(true);
            };

            // Bind touches on sliders to prevent hiding while dragging
            [volBar, seekBar].forEach(el => {
                if (!el) return;
                ['touchstart', 'touchmove', 'touchend'].forEach(ev => {
                    el.addEventListener(ev, (e) => {
                        e.stopPropagation();
                        window.showPlayerControls && window.showPlayerControls(true);
                    }, { passive: true });
                });
            });

            syncVolumeUI(false);

            seekBar.value = 0;
            timeCurrent.textContent = '0:00';
            timeTotal.textContent = '0:00';
            updateScrubberMode();
            
            video.onloadedmetadata = () => {
                updateScrubberMode();
                updateQualityBadgeUI();
            };

            video.ondurationchange = () => {
                updateScrubberMode();
            };

            video.onresize = () => {
                updateQualityBadgeUI();
                updatePlayerOrientationLayout();
            };

            video.ontimeupdate = () => {
                updateScrubberMode();
            };

            seekBar.oninput = (e) => { 
                isSeeking = true;
                // While the user is dragging the seek bar, hold controls open
                window.showPlayerControls && window.showPlayerControls(true);
                timeCurrent.textContent = formatTime(e.target.value); 
                const val = (e.target.value / (e.target.max || 1)) * 100;
                seekBar.style.background = `linear-gradient(to right, #E50914 ${val}%, rgba(255,255,255,0.2) ${val}%)`;
            };
            
            seekBar.onchange = (e) => { 
                video.currentTime = parseFloat(e.target.value); 
                isSeeking = false;
                updateScrubberMode();
            };
            
            document.getElementById('fullscreen-btn').onclick = () => toggleNativeFullScreen();
        }

(() => {
        // macOS Global Shortcuts (⌘1: Live, ⌘2: Series, ⌘3: Movies, ⌘4: Favorites, ⌘K: Search, ⌘,: Settings)
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.key.toLowerCase() !== ',') return;
            if ((e.metaKey || e.ctrlKey)) {
                const k = e.key.toLowerCase();
                if (k === '1' || k === 'l') {
                    e.preventDefault();
                    if (typeof setTab === 'function') setTab('live');
                } else if (k === '2') {
                    e.preventDefault();
                    if (typeof setTab === 'function') setTab('series');
                } else if (k === '3' || k === 'm') {
                    e.preventDefault();
                    if (typeof setTab === 'function') setTab('vod');
                } else if (k === '4') {
                    e.preventDefault();
                    if (typeof setTab === 'function') setTab('favorites');
                } else if (k === 'k' || k === 'f') {
                    e.preventDefault();
                    if (typeof setTab === 'function') setTab('search');
                    setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
                } else if (k === ',') {
                    e.preventDefault();
                    if (typeof openProfileModal === 'function') openProfileModal();
                }
            }
        });
    })();

// Register PWA Service Worker (App shell only)
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('SW registration skipped:', err);
        });
    });
}