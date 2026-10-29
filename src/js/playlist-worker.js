/**
 * AURA IPTV — Playlist & EPG Worker
 * Parses massive M3U / M3U8 playlists and XMLTV files in chunks
 * without locking up the main browser thread.
 */

self.addEventListener('message', (event) => {
  const { type, data, options } = event.data;

  if (type === 'PARSE_M3U') {
    try {
      parseM3UChunked(data, options || {});
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  } else if (type === 'PARSE_XMLTV') {
    try {
      parseXMLTV(data);
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
});

function parseM3UChunked(content, options) {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const channels = [];
  const categoriesSet = new Set();
  const categoryMap = {};

  let currentChannel = null;
  const chunkSize = 2000;
  let processed = 0;

  for (let i = 0; i < totalLines; i++) {
    const rawLine = lines[i];
    const line = rawLine ? rawLine.trim() : '';
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentChannel = {};

      // Parse duration
      const commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) {
        currentChannel.name = line.substring(commaIdx + 1).trim();
      }

      // Parse attributes: key="value"
      const attrMatches = line.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g);
      for (const match of attrMatches) {
        const key = match[1].toLowerCase();
        const val = match[2];
        if (key === 'tvg-id') currentChannel.epg_channel_id = val;
        else if (key === 'tvg-name') currentChannel.tvg_name = val;
        else if (key === 'tvg-logo') currentChannel.stream_icon = val;
        else if (key === 'group-title') currentChannel.category_name = val;
        else if (key === 'tvg-shift') currentChannel.tvg_shift = val;
      }

      if (!currentChannel.category_name) {
        currentChannel.category_name = 'General';
      }
      categoriesSet.add(currentChannel.category_name);
    } else if (line.startsWith('#')) {
      // Other directive, ignore for stream URL
      continue;
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('/') || line.startsWith('rtmp://')) {
      if (currentChannel) {
        currentChannel.url = line;
        currentChannel.stream_id = `m3u_${channels.length + 1}`;
        currentChannel.num = channels.length + 1;
        currentChannel.title = currentChannel.name || `Channel ${currentChannel.num}`;
        
        // Determine type (live, vod, series)
        const lowerUrl = line.toLowerCase();
        if (lowerUrl.includes('/movie/') || lowerUrl.endsWith('.mp4') || lowerUrl.endsWith('.mkv')) {
          currentChannel.type = 'vod';
        } else if (lowerUrl.includes('/series/')) {
          currentChannel.type = 'series';
        } else {
          currentChannel.type = 'live';
        }

        channels.push(currentChannel);
        currentChannel = null;
      }
    }

    processed++;
    if (processed % chunkSize === 0 || i === totalLines - 1) {
      self.postMessage({
        type: 'PROGRESS',
        progress: Math.min(100, Math.round((i / totalLines) * 100)),
        count: channels.length
      });
    }
  }

  // Format categories
  const categories = Array.from(categoriesSet).map((catName, idx) => ({
    category_id: `cat_${idx + 1}`,
    category_name: catName
  }));

  categories.forEach(c => {
    categoryMap[c.category_id] = c.category_name;
  });

  self.postMessage({
    type: 'DONE_M3U',
    channels,
    categories,
    categoryMap
  });
}

function parseXMLTV(xmlString) {
  // Simple, fast regex-based XMLTV program extraction
  const programs = [];
  const progMatches = xmlString.matchAll(/<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g);

  for (const match of progMatches) {
    const startStr = match[1];
    const stopStr = match[2];
    const channelId = match[3];
    const inner = match[4];

    const titleMatch = inner.match(/<title[^>]*>([^<]+)<\/title>/);
    const descMatch = inner.match(/<desc[^>]*>([^<]+)<\/desc>/);

    programs.push({
      channel: channelId,
      start: parseXmltvDate(startStr),
      stop: parseXmltvDate(stopStr),
      title: titleMatch ? titleMatch[1].trim() : 'No Title',
      description: descMatch ? descMatch[1].trim() : ''
    });
  }

  self.postMessage({
    type: 'DONE_XMLTV',
    programs
  });
}

function parseXmltvDate(str) {
  // Format: YYYYMMDDHHMMSS +/-HHMM
  try {
    const clean = str.trim();
    const year = parseInt(clean.substring(0, 4), 10);
    const month = parseInt(clean.substring(4, 6), 10) - 1;
    const day = parseInt(clean.substring(6, 8), 10);
    const hour = parseInt(clean.substring(8, 10), 10);
    const min = parseInt(clean.substring(10, 12), 10);
    const sec = parseInt(clean.substring(12, 14), 10) || 0;
    return new Date(Date.UTC(year, month, day, hour, min, sec)).getTime();
  } catch (_) {
    return Date.now();
  }
}
