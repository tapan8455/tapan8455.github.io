/**
 * AURA IPTV Web Worker
 * Non-blocking, chunked M3U/M3U8 & XMLTV parser emitting batches of 1,000 items.
 */

self.onmessage = async (e) => {
    const { action, payload, sourceId } = e.data;
    if (action === 'parse_m3u') {
        parseM3U(payload, sourceId);
    } else if (action === 'parse_xmltv') {
        parseXMLTV(payload, sourceId);
    }
};

function parseM3U(content, sourceId) {
    const lines = content.split(/\r?\n/);
    const BATCH_SIZE = 1000;
    let batch = [];
    let currentItem = null;
    let totalFound = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentItem = parseExtInf(line, sourceId);
        } else if (!line.startsWith('#') && currentItem) {
            currentItem.url = line;
            currentItem.type = detectStreamType(line, currentItem.category_name);
            batch.push(currentItem);
            totalFound++;
            currentItem = null;

            if (batch.length >= BATCH_SIZE) {
                self.postMessage({ type: 'CHUNK', items: batch, count: totalFound });
                batch = [];
            }
        }
    }

    if (batch.length > 0) {
        self.postMessage({ type: 'CHUNK', items: batch, count: totalFound });
    }
    self.postMessage({ type: 'COMPLETE', total: totalFound });
}

function parseExtInf(header, sourceId) {
    const tvgId = (header.match(/tvg-id="([^"]*)"/i) || [])[1] || '';
    const tvgName = (header.match(/tvg-name="([^"]*)"/i) || [])[1] || '';
    const tvgLogo = (header.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
    const groupTitle = (header.match(/group-title="([^"]*)"/i) || [])[1] || 'Uncategorized';
    
    // Extract title after final comma
    const commaIdx = header.lastIndexOf(',');
    const title = commaIdx !== -1 ? header.substring(commaIdx + 1).trim() : (tvgName || 'Unknown Channel');

    return {
        id: `m3u_${sourceId}_${Math.random().toString(36).substr(2, 9)}`,
        source_id: sourceId,
        title,
        tvg_id: tvgId,
        tvg_name: tvgName,
        img: tvgLogo,
        category_name: groupTitle,
        category_id: groupTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')
    };
}

function detectStreamType(url, groupTitle = '') {
    const u = url.toLowerCase();
    const g = groupTitle.toLowerCase();
    if (u.includes('/movie/') || g.includes('movie') || g.includes('vod')) return 'vod';
    if (u.includes('/series/') || g.includes('series')) return 'series';
    return 'live';
}

function parseXMLTV(xmlString, sourceId) {
    // Regex-based fast streaming parser avoids DOMParser memory saturation on large XMLTV feeds
    const channelRegex = /<channel\s+id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?<\/channel>/gi;
    const programmeRegex = /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)">[\s\S]*?<title[^>]*>([^<]+)<\/title>([\s\S]*?)<\/programme>/gi;
    
    const BATCH_SIZE = 1000;
    let batch = [];
    let match;

    while ((match = programmeRegex.exec(xmlString)) !== null) {
        const startRaw = match[1];
        const stopRaw = match[2];
        const channelId = match[3];
        const title = match[4];
        const descMatch = match[5].match(/<desc[^>]*>([^<]+)<\/desc>/i);
        const desc = descMatch ? descMatch[1] : '';

        const startTimestamp = parseXmltvDate(startRaw);
        const stopTimestamp = parseXmltvDate(stopRaw);

        if (startTimestamp && stopTimestamp) {
            batch.push({
                composite_key: `${channelId}_${startTimestamp}`,
                channel_id: channelId,
                title,
                desc,
                start: startTimestamp,
                stop: stopTimestamp
            });
        }

        if (batch.length >= BATCH_SIZE) {
            self.postMessage({ type: 'EPG_CHUNK', items: batch });
            batch = [];
        }
    }

    if (batch.length > 0) {
        self.postMessage({ type: 'EPG_CHUNK', items: batch });
    }
    self.postMessage({ type: 'EPG_COMPLETE' });
}

function parseXmltvDate(dateStr) {
    // Standard format: YYYYMMDDhhmmss +ZZZZ
    const m = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!m) return null;
    const [_, Y, M, D, h, min, s, offset] = m;
    let iso = `${Y}-${M}-${D}T${h}:${min}:${s}`;
    if (offset) {
        iso += `${offset.substring(0, 3)}:${offset.substring(3)}`;
    } else {
        iso += 'Z';
    }
    return Math.floor(new Date(iso).getTime() / 1000);
}