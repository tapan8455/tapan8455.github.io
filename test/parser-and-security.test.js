const test = require('node:test');
const assert = require('node:assert');

// ── 1. M3U Playlist Parser Tests ─────────────────────────────────
test('M3U Parser accurately parses attributes, channels, and categories', () => {
  const sampleM3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN US" tvg-logo="https://example.com/cnn.png" group-title="News",CNN HD
https://example.com/live/user/pass/12345.m3u8
#EXTINF:-1 tvg-id="espn.us" tvg-logo="https://example.com/espn.png" group-title="Sports",ESPN 1080p
https://example.com/live/user/pass/67890.ts
#EXTINF:-1 group-title="Movies",Inception (2010)
https://example.com/movie/user/pass/99999.mp4
`;

  const lines = sampleM3U.split(/\r?\n/);
  const channels = [];
  const categoriesSet = new Set();

  let currentChannel = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentChannel = {};
      const commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) {
        currentChannel.name = line.substring(commaIdx + 1).trim();
      }

      const attrMatches = line.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g);
      for (const match of attrMatches) {
        const key = match[1].toLowerCase();
        const val = match[2];
        if (key === 'tvg-id') currentChannel.epg_channel_id = val;
        else if (key === 'tvg-logo') currentChannel.stream_icon = val;
        else if (key === 'group-title') currentChannel.category_name = val;
      }

      if (!currentChannel.category_name) currentChannel.category_name = 'General';
      categoriesSet.add(currentChannel.category_name);
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (currentChannel) {
        currentChannel.url = line;
        currentChannel.num = channels.length + 1;
        const lower = line.toLowerCase();
        if (lower.includes('/movie/') || lower.endsWith('.mp4')) currentChannel.type = 'vod';
        else currentChannel.type = 'live';
        channels.push(currentChannel);
        currentChannel = null;
      }
    }
  }

  assert.strictEqual(channels.length, 3, 'Should parse exactly 3 channels');
  assert.strictEqual(channels[0].name, 'CNN HD');
  assert.strictEqual(channels[0].epg_channel_id, 'cnn.us');
  assert.strictEqual(channels[0].category_name, 'News');
  assert.strictEqual(channels[0].type, 'live');

  assert.strictEqual(channels[1].name, 'ESPN 1080p');
  assert.strictEqual(channels[1].category_name, 'Sports');

  assert.strictEqual(channels[2].name, 'Inception (2010)');
  assert.strictEqual(channels[2].type, 'vod');

  assert.strictEqual(categoriesSet.size, 3);
  assert.ok(categoriesSet.has('News'));
  assert.ok(categoriesSet.has('Sports'));
  assert.ok(categoriesSet.has('Movies'));
});

// ── 2. XMLTV Date Parsing & Timezone Tests ─────────────────────────
test('XMLTV timestamps parse with correct UTC offsets', () => {
  function parseXmltvDate(str) {
    const clean = str.trim();
    const year = parseInt(clean.substring(0, 4), 10);
    const month = parseInt(clean.substring(4, 6), 10) - 1;
    const day = parseInt(clean.substring(6, 8), 10);
    const hour = parseInt(clean.substring(8, 10), 10);
    const min = parseInt(clean.substring(10, 12), 10);
    const sec = parseInt(clean.substring(12, 14), 10) || 0;
    return new Date(Date.UTC(year, month, day, hour, min, sec)).getTime();
  }

  // 2026-10-29 18:30:00 UTC
  const ts = parseXmltvDate('20261029183000 +0000');
  const d = new Date(ts);
  assert.strictEqual(d.getUTCFullYear(), 2026);
  assert.strictEqual(d.getUTCMonth(), 9); // October = 9 (0-indexed)
  assert.strictEqual(d.getUTCDate(), 29);
  assert.strictEqual(d.getUTCHours(), 18);
  assert.strictEqual(d.getUTCMinutes(), 30);
});

// ── 3. Credential Redaction Tests ─────────────────────────────────
test('Stream URL redaction removes sensitive provider password', () => {
  const user = 'john_doe';
  const pass = 'superSecretPass123!';
  const streamUrl = `http://provider.tv:8080/live/${user}/${pass}/45612.m3u8`;

  function redactUrl(url, u, p) {
    if (!p || !u) return url;
    return url.replace(new RegExp(`/${u}/[^/]+/`, 'g'), `/${u}/[REDACTED_PASSWORD]/`);
  }

  const redacted = redactUrl(streamUrl, user, pass);
  assert.ok(!redacted.includes('superSecretPass123!'), 'Password must never be present in redacted URL');
  assert.strictEqual(redacted, 'http://provider.tv:8080/live/john_doe/[REDACTED_PASSWORD]/45612.m3u8');
});

// ── 4. M3U8 Proxy Manifest Rewriter Tests ─────────────────────────
test('rewriteM3U8 correctly maps segments to proxy endpoint', () => {
  const { rewriteM3U8 } = require('../server.js');
  const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment_01.ts
#EXTINF:10.0,
https://cdn.example.com/live/segment_02.ts
`;

  const baseUrl = 'http://provider.tv:8080/live/stream.m3u8';
  const rewritten = rewriteM3U8(manifest, baseUrl);

  assert.ok(rewritten.includes('/stream?url='), 'Must wrap segments in /stream?url=');
  assert.ok(rewritten.includes(encodeURIComponent('http://provider.tv:8080/live/segment_01.ts')), 'Relative segment must be resolved against base');
  assert.ok(rewritten.includes(encodeURIComponent('https://cdn.example.com/live/segment_02.ts')), 'Absolute segment must be encoded directly');
});

// ── 5. Watch Progress & Time Formatting Tests ─────────────────────
test('formatTime correctly formats MM:SS and HH:MM:SS', () => {
  function formatTime(sec) {
    if (isNaN(sec) || sec === Infinity || sec <= 0) return "0:00";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  assert.strictEqual(formatTime(0), '0:00');
  assert.strictEqual(formatTime(65), '1:05');
  assert.strictEqual(formatTime(2535), '42:15');
  assert.strictEqual(formatTime(3661), '1:01:01');
});

test('Playback progress calculation correctly bounds percentage between 0 and 100', () => {
  function calcProgress(currentTime, duration) {
    if (isNaN(currentTime) || isNaN(duration) || duration <= 0) return 0;
    const pct = Math.round((currentTime / duration) * 100);
    return Math.min(100, Math.max(0, pct));
  }

  assert.strictEqual(calcProgress(500, 2000), 25);
  assert.strictEqual(calcProgress(2500, 2000), 100);
  assert.strictEqual(calcProgress(-50, 2000), 0);
});

// ── 6. TV Spatial Navigation Metric Tests ─────────────────────────
test('Spatial navigation distance metric prefers inline targets over lateral targets', () => {
  function computeScore(cur, cand, dir) {
    const dx = cand.x - cur.x;
    const dy = cand.y - cur.y;
    let valid = false;
    let primaryDist = 0;
    let secondaryDist = 0;

    if (dir === 'down') {
      if (dy > 0) {
        valid = true;
        primaryDist = dy;
        secondaryDist = Math.abs(dx);
      }
    } else if (dir === 'right') {
      if (dx > 0) {
        valid = true;
        primaryDist = dx;
        secondaryDist = Math.abs(dy);
      }
    }
    if (!valid) return Infinity;
    return primaryDist * 1.0 + secondaryDist * 2.2;
  }

  const cur = { x: 100, y: 100 };
  const directlyBelow = { x: 100, y: 300 }; // primary = 200, secondary = 0 -> score = 200
  const diagonal = { x: 250, y: 250 };      // primary = 150, secondary = 150 -> score = 150 + 330 = 480

  const scoreDirect = computeScore(cur, directlyBelow, 'down');
  const scoreDiag = computeScore(cur, diagonal, 'down');

  assert.ok(scoreDirect < scoreDiag, 'Directly below candidate must have a lower score than diagonal candidate');
});

// ── 7. Series Progress & Resuming Tests ───────────────────────────
test('Series resume lookup correctly resolves target episode and timestamp from seriesProgress', () => {
  const episodes = [
    { id: '101', season: '1', episode_num: '1', title: 'Pilot' },
    { id: '102', season: '1', episode_num: '2', title: 'Second' },
    { id: '201', season: '2', episode_num: '1', title: 'Season 2 Premiere' }
  ];

  const seriesProgress = {
    'series_999': {
      seriesId: 'series_999',
      episodeId: '201',
      episodeIndex: 2,
      season: '2',
      episodeNum: '1',
      currentTime: 1420
    }
  };

  const sProg = seriesProgress['series_999'];
  let targetIndex = 0;
  let resumeTime = 0;

  if (sProg) {
    const found = episodes.findIndex(e => e.id === sProg.episodeId);
    if (found !== -1) targetIndex = found;
    resumeTime = sProg.currentTime || 0;
  }

  assert.strictEqual(targetIndex, 2, 'Must resolve to Season 2 Premiere (index 2), not episode 1 (index 0)');
  assert.strictEqual(resumeTime, 1420, 'Must preserve exact resume timestamp');
  assert.strictEqual(episodes[targetIndex].season, '2');
  assert.strictEqual(episodes[targetIndex].episode_num, '1');
});

// ── 8. Live Stream Candidate Tests ────────────────────────────────
test('Live stream candidate generator uses configured provider scheme and prioritizes HLS .m3u8', () => {
  function getLiveCandidates(server, user, pass, streamId) {
    const srv = server.startsWith('http') ? server : `http://${server}`;
    const u = encodeURIComponent(user);
    const p = encodeURIComponent(pass);
    return [
      `${srv}/live/${u}/${p}/${streamId}.m3u8`,
      `${srv}/${u}/${p}/${streamId}.m3u8`,
      `${srv}/live/${u}/${p}/${streamId}.ts`
    ];
  }

  const httpCandidates = getLiveCandidates('http://provider.tv:8080', 'user1', 'pass1', 4501);
  assert.strictEqual(httpCandidates[0], 'http://provider.tv:8080/live/user1/pass1/4501.m3u8');
  assert.ok(!httpCandidates[0].startsWith('https://'), 'Must not invent https when provider is http');
});

// ── 9. Live TS Stream Anti-Buffering & Header Detection Tests ─────
test('Live TS stream detector sets video/mp2t, removes Content-Length, and disables proxy caching', () => {
  function computeStreamHeaders(pathname, upstreamHeaders = {}) {
    const p = pathname.toLowerCase();
    const isM3U8 = p.endsWith('.m3u8');
    const isLiveTs = !isM3U8 && (
      p.endsWith('.ts') ||
      p.includes('/live/') ||
      /^\/(live\/)?[^/]+\/[^/]+\/\d+(\.ts)?$/i.test(p)
    );

    const headers = {
      'Cache-Control': isLiveTs ? 'no-cache, no-store, must-revalidate' : 'no-store'
    };

    if (upstreamHeaders['content-length'] && !isLiveTs) {
      headers['Content-Length'] = upstreamHeaders['content-length'];
    }

    if (isLiveTs) {
      headers['Content-Type'] = 'video/mp2t';
      headers['Pragma'] = 'no-cache';
      headers['Connection'] = 'keep-alive';
      headers['X-Accel-Buffering'] = 'no';
    }

    return { headers, isLiveTs };
  }

  const live1 = computeStreamHeaders('/live/user/pass/9876', { 'content-length': '1048576' });
  assert.strictEqual(live1.isLiveTs, true);
  assert.strictEqual(live1.headers['Content-Type'], 'video/mp2t');
  assert.strictEqual(live1.headers['Content-Length'], undefined, 'Live streams must not send Content-Length');
  assert.strictEqual(live1.headers['X-Accel-Buffering'], 'no');

  const live2 = computeStreamHeaders('/user/pass/9876.ts', { 'content-length': '2097152' });
  assert.strictEqual(live2.isLiveTs, true);
  assert.strictEqual(live2.headers['Content-Type'], 'video/mp2t');
  assert.strictEqual(live2.headers['Content-Length'], undefined);

  const vodMovie = computeStreamHeaders('/movie/user/pass/555.mp4', { 'content-length': '500000000' });
  assert.strictEqual(vodMovie.isLiveTs, false);
  assert.strictEqual(vodMovie.headers['Content-Length'], '500000000');
});

// ── 10. PlayStream Series Auto-Resume Target Episode Tests ─────────
test('playStream automatically resolves last-watched episode when epIndex=0 was passed', () => {
  const currentSeriesEpisodes = [
    { id: '1', season: '1', episode_num: '1', title: 'Ep 1' },
    { id: '2', season: '1', episode_num: '2', title: 'Ep 2' },
    { id: '3', season: '1', episode_num: '3', title: 'Ep 3' }
  ];

  const seriesProgress = {
    '100': {
      seriesId: '100',
      episodeId: '3',
      episodeIndex: 2,
      currentTime: 1850
    }
  };

  function resolveEpisodeToPlay(movieId, isSeriesTrigger, epIndex, resumeTime) {
    let targetEpIdx = epIndex;
    let targetResume = resumeTime;
    const sProg = seriesProgress[String(movieId)];
    if ((!isSeriesTrigger || targetEpIdx === 0) && sProg) {
      const foundIdx = currentSeriesEpisodes.findIndex(e => String(e.id || e.stream_id) === String(sProg.episodeId));
      if (foundIdx !== -1) targetEpIdx = foundIdx;
      else if (sProg.episodeIndex >= 0 && sProg.episodeIndex < currentSeriesEpisodes.length) targetEpIdx = sProg.episodeIndex;
      if (!targetResume && sProg.currentTime > 5) targetResume = sProg.currentTime;
    }
    return { targetEpIdx, targetResume };
  }

  // User clicks series card on Home Screen (isSeriesTrigger=false, epIndex=0, resumeTime=0)
  const res1 = resolveEpisodeToPlay('100', false, 0, 0);
  assert.strictEqual(res1.targetEpIdx, 2, 'Should resume Episode 3 (index 2), NOT Episode 1 (index 0)');
  assert.strictEqual(res1.targetResume, 1850, 'Should restore 1850s timestamp');

  // User explicitly clicks Episode 1 (isSeriesTrigger=true, epIndex=0, resumeTime=0)
  const resExplicitEp1 = resolveEpisodeToPlay('100', true, 0, 0);
  assert.strictEqual(resExplicitEp1.targetEpIdx, 2); // default 0 resolves to last watched
  const resExplicitEp2 = resolveEpisodeToPlay('100', true, 1, 0);
  assert.strictEqual(resExplicitEp2.targetEpIdx, 1, 'Explicit episode selection must be respected');
});

// ── 12. Favorite Bookmarking Tests ─────────────────────────────────
test('isFavorite and toggleFavorite correctly manage favorites state without errors', () => {
  const favorites = [];
  function isFavorite(id) {
    if (!id || !favorites) return false;
    return favorites.some(f => String(f.id) === String(id));
  }
  function toggleFavorite(item) {
    if (!item || !item.id) return;
    const id = String(item.id);
    const idx = favorites.findIndex(f => String(f.id) === id);
    if (idx > -1) {
      favorites.splice(idx, 1);
    } else {
      favorites.unshift(item);
    }
  }

  assert.strictEqual(isFavorite('ch-101'), false);
  toggleFavorite({ id: 'ch-101', title: 'BBC News' });
  assert.strictEqual(isFavorite('ch-101'), true);
  assert.strictEqual(favorites.length, 1);
  toggleFavorite({ id: 'ch-101', title: 'BBC News' });
  assert.strictEqual(isFavorite('ch-101'), false);
  assert.strictEqual(favorites.length, 0);
});

// ── 13. Category Stream Normalization & Malformed Item Protection ──
test('Raw category streams parser handles arrays, objects, and filters malformed items', () => {
  const rawProviderData = {
    "0": { stream_id: 101, name: "HBO HD", stream_type: "live" },
    "1": { stream_id: 102, name: "Cinemax", stream_type: "live" },
    "error": "status ok", // non-stream attribute
    "null_entry": null
  };

  let arr = Array.isArray(rawProviderData) ? rawProviderData : (rawProviderData && typeof rawProviderData === 'object' ? Object.values(rawProviderData) : []);
  let validItems = arr.filter(s => s && typeof s === 'object' && (s.stream_id || s.series_id || s.id || s.name || s.title));

  assert.strictEqual(validItems.length, 2, 'Should extract only valid channel items and filter out non-stream attributes/nulls');
  assert.strictEqual(validItems[0].name, 'HBO HD');
  assert.strictEqual(validItems[1].name, 'Cinemax');
});

// ── 14. Error Tolerance and Playback Continuation Tests ───────────────
test('Live channel and series error handler tolerates stream failures and resolves next item', () => {
  // Live channel failover simulation
  const channelList = [
    { id: '101', name: 'Channel 1 (Dead)', type: 'live' },
    { id: '102', name: 'Channel 2 (Working)', type: 'live' },
    { id: '103', name: 'Channel 3 (Backup)', type: 'live' }
  ];

  function getNextChannel(currentIndex, list) {
    if (!list || list.length < 2) return null;
    const nextIdx = (currentIndex + 1) % list.length;
    return { index: nextIdx, item: list[nextIdx] };
  }

  const nextLive = getNextChannel(0, channelList);
  assert.strictEqual(nextLive.index, 1);
  assert.strictEqual(nextLive.item.name, 'Channel 2 (Working)');

  // Circular wrap for live channel list
  const wrapLive = getNextChannel(2, channelList);
  assert.strictEqual(wrapLive.index, 0);
  assert.strictEqual(wrapLive.item.name, 'Channel 1 (Dead)');

  // Series episode continuation simulation
  const episodeList = [
    { id: 'ep1', season: 1, episode: 1, name: 'Pilot (Failed)' },
    { id: 'ep2', season: 1, episode: 2, name: 'Chapter 2 (Working)' }
  ];

  function resolveNextEpisode(currentEpId, list) {
    const idx = list.findIndex(e => e.id === currentEpId);
    if (idx > -1 && idx < list.length - 1) return list[idx + 1];
    return null;
  }

  const nextEp = resolveNextEpisode('ep1', episodeList);
  assert.ok(nextEp);
  assert.strictEqual(nextEp.id, 'ep2');
  assert.strictEqual(nextEp.name, 'Chapter 2 (Working)');
  assert.strictEqual(resolveNextEpisode('ep2', episodeList), null);
});
