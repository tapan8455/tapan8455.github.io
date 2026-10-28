/**
 * AURA Spatial Remote & 10-Foot Keyboard Navigation
 * Supports D-Pad Arrow navigation, numeric channel dialing, and TV layout modes.
 */
class AuraTvNav {
    constructor() {
        this.numberBuffer = '';
        this.dialTimeout = null;
        this.is10FootMode = false;
        this.init();
    }

    init() {
        this.detectTvEnvironment();
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    detectTvEnvironment() {
        const ua = navigator.userAgent.toLowerCase();
        const isTvUA = ua.includes('smart-tv') || ua.includes('appletv') || ua.includes('googletv') || 
                        ua.includes('tizen') || ua.includes('webos') || ua.includes('crkey') || ua.includes('xbox');
        const isBigScreen = window.innerWidth >= 1920 && window.matchMedia('(pointer: coarse)').matches;
        
        if (isTvUA || isBigScreen) {
            this.enable10FootMode();
        }
    }

    enable10FootMode() {
        this.is10FootMode = true;
        document.documentElement.classList.add('tv-mode');
        // Announce to accessibility tree
        const liveRegion = document.getElementById('a11y-status');
        if (liveRegion) liveRegion.textContent = '10-foot TV mode enabled. Use arrow keys to navigate.';
    }

    handleKeyDown(e) {
        // Bypass if typing in text inputs
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        const isPlayerOpen = !document.getElementById('player-modal').classList.contains('hidden');

        // Number Key Channel Dialing (2-second timeout window)
        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            this.numberBuffer += e.key;
            this.showDialHUD(this.numberBuffer);
            clearTimeout(this.dialTimeout);
            this.dialTimeout = setTimeout(() => {
                const channelNum = parseInt(this.numberBuffer, 10);
                window.auraPlayer.jumpToChannelNumber(channelNum);
                this.numberBuffer = '';
            }, 2000);
            return;
        }

        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowLeft':
            case 'ArrowUp':
            case 'ArrowDown':
                if (!isPlayerOpen) {
                    e.preventDefault();
                    this.navigateSpatial(e.key);
                }
                break;
            case 'Enter':
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.click();
                }
                break;
            case 'Escape':
            case 'Backspace':
                if (isPlayerOpen) {
                    e.preventDefault();
                    window.auraPlayer.close();
                }
                break;
            case ' ':
                if (isPlayerOpen) {
                    e.preventDefault();
                    window.auraPlayer.togglePlay();
                }
                break;
            case 'f':
            case 'F':
                if (isPlayerOpen) window.auraPlayer.toggleFullscreen();
                break;
            case 'm':
            case 'M':
                if (isPlayerOpen) window.auraPlayer.toggleMute();
                break;
            case '/':
                e.preventDefault();
                window.auraApp.setTab('search');
                break;
            case '?':
                e.preventDefault();
                window.auraApp.openKeyboardShortcutsModal();
                break;
        }
    }

    navigateSpatial(direction) {
        const focusable = Array.from(document.querySelectorAll(
            'button, [href], input, select, [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null && !el.disabled);

        const current = document.activeElement;
        if (!current || !focusable.includes(current)) {
            if (focusable.length > 0) focusable[0].focus();
            return;
        }

        const curRect = current.getBoundingClientRect();
        let bestCandidate = null;
        let minDistance = Infinity;

        for (const target of focusable) {
            if (target === current) continue;
            const targetRect = target.getBoundingClientRect();

            let isDirectionalMatch = false;
            if (direction === 'ArrowRight') isDirectionalMatch = targetRect.left >= curRect.right - 10;
            if (direction === 'ArrowLeft') isDirectionalMatch = targetRect.right <= curRect.left + 10;
            if (direction === 'ArrowDown') isDirectionalMatch = targetRect.top >= curRect.bottom - 10;
            if (direction === 'ArrowUp') isDirectionalMatch = targetRect.bottom <= curRect.top + 10;

            if (isDirectionalMatch) {
                const dist = Math.hypot(
                    targetRect.left + targetRect.width / 2 - (curRect.left + curRect.width / 2),
                    targetRect.top + targetRect.height / 2 - (curRect.top + curRect.height / 2)
                );
                if (dist < minDistance) {
                    minDistance = dist;
                    bestCandidate = target;
                }
            }
        }

        if (bestCandidate) {
            bestCandidate.focus();
            bestCandidate.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    showDialHUD(digits) {
        let hud = document.getElementById('dial-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'dial-hud';
            hud.className = 'fixed top-12 right-12 bg-black/90 text-primary border-2 border-primary/50 text-4xl font-black font-mono px-6 py-3 rounded-2xl z-[900] shadow-2xl';
            document.body.appendChild(hud);
        }
        hud.textContent = `Channel: ${digits}`;
        hud.style.display = 'block';
        clearTimeout(this.hudTimer);
        this.hudTimer = setTimeout(() => { hud.style.display = 'none'; }, 2200);
    }
}
window.auraTvNav = new AuraTvNav();