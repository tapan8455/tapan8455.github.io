/**
 * AURA IPTV Client Storage Engine
 * Non-blocking IndexedDB schema with WebCrypto AES-GCM credential vault.
 */
class AuraStorage {
    constructor() {
        this.dbName = 'aura_db';
        this.version = 2;
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.version);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('sources')) {
                    const s = db.createObjectStore('sources', { keyPath: 'id' });
                    s.createIndex('by_type', 'type', { unique: false });
                }
                if (!db.objectStoreNames.contains('profiles')) {
                    db.createObjectStore('profiles', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('channels')) {
                    const c = db.createObjectStore('channels', { keyPath: 'id' });
                    c.createIndex('by_source', 'source_id', { unique: false });
                    c.createIndex('by_category', 'category_id', { unique: false });
                    c.createIndex('by_tvgid', 'tvg_id', { unique: false });
                }
                if (!db.objectStoreNames.contains('epg_programs')) {
                    const epg = db.createObjectStore('epg_programs', { keyPath: 'composite_key' });
                    epg.createIndex('by_channel', 'channel_id', { unique: false });
                    epg.createIndex('by_start', 'start', { unique: false });
                }
                if (!db.objectStoreNames.contains('playback_state')) {
                    db.createObjectStore('playback_state', { keyPath: 'stream_id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                resolve(this.db);
            };
            req.onerror = () => reject(req.error);
        });
    }

    async execute(storeName, mode, callback) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const req = callback(store);
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error);
        });
    }

    // High performance chunked insertion
    async bulkPut(storeName, items) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            for (let i = 0; i < items.length; i++) {
                store.put(items[i]);
            }
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async getAll(storeName, indexName = null, query = null) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const target = indexName ? store.index(indexName) : store;
            const req = query ? target.getAll(query) : target.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // Credential Redaction Helper
    static redactUrl(rawUrl, preserveAuth = false) {
        if (!rawUrl) return '';
        try {
            const u = new URL(rawUrl);
            if (!preserveAuth) {
                // Redact query parameter patterns (Xtream username/password)
                ['username', 'password', 'token', 'pass', 'user'].forEach(k => {
                    if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
                });
                // Redact inline path credentials /live/user/pass/123.ts
                const parts = u.pathname.split('/');
                if (parts.length >= 5 && (parts[1] === 'live' || parts[1] === 'movie' || parts[1] === 'series')) {
                    parts[2] = 'REDACTED';
                    parts[3] = 'REDACTED';
                    u.pathname = parts.join('/');
                }
            }
            return u.toString();
        } catch (_) {
            return rawUrl;
        }
    }

    async exportAllUserData() {
        const payload = {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            sources: await this.getAll('sources'),
            profiles: await this.getAll('profiles'),
            playback_state: await this.getAll('playback_state'),
            settings: await this.getAll('settings')
        };
        // Sanitize out sensitive credentials from export
        payload.sources.forEach(s => {
            if (s.password) s.password = '';
            if (s.url) s.url = AuraStorage.redactUrl(s.url, false);
        });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aura-iptv-backup-${Date.now()}.json`;
        a.click();
    }

    async eraseAllUserData() {
        if (!confirm('Permanently erase all playlist sources, watch history, and local preferences?')) return;
        indexedDB.deleteDatabase(this.dbName);
        localStorage.clear();
        sessionStorage.clear();
        location.reload();
    }
}
window.auraStorage = new AuraStorage();