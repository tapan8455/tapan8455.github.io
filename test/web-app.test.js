const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Arrays built inside the vm sandbox come from another realm; copy them before comparing.
const eq = (actual, expected) => assert.deepStrictEqual(Array.from(actual), expected);

// Loads the real browser scripts (js/core.js + js/data.js) into a sandbox with minimal DOM stubs.
function loadApp({ href = 'http://localhost:3000/', storage = {} } = {}) {
  const url = new URL(href);
  const store = Object.assign({}, storage);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i],
    get length() { return Object.keys(store).length; }
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder, AbortSignal,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    escape, unescape, localStorage,
    location: { href, hostname: url.hostname, protocol: url.protocol, origin: url.origin, hash: '' },
    navigator: { userAgent: 'node' },
    document: { addEventListener() {}, querySelector: () => null, documentElement: { dataset: {} } }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/core.js', 'js/data.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  return { App: sandbox.App, store };
}

function seed(App) {
  App.Sources.add({ id: 's1', type: 'xtream', server: 'http://provider.example:8080', user: 'u1', pass: 'p@ss', counts: {} });
  App.User.load();
  App.Catalog.index({
    at: 1,
    live: { cats: [{ id: '1', name: 'SPORTS | CRICKET' }, { id: '2', name: 'NEWS' }], items: [
      { id: '10', type: 'live', name: 'Star Sports 1 HD', cat: '1', added: 5 },
      { id: '11', type: 'live', name: 'Sky News', cat: '2', added: 4 }
    ] },
    movie: { cats: [{ id: '5', name: 'ENGLISH | 4K' }, { id: '6', name: 'ENGLISH | FHD 2026' }, { id: '7', name: 'INDIAN | HINDI' }], items: [
      { id: '1', type: 'movie', name: 'Immortal (2026)', cat: '5', added: 100, ext: 'mkv' },
      { id: '2', type: 'movie', name: 'Immortal (2026)', cat: '6', added: 99, ext: 'mp4' },
      { id: '3', type: 'movie', name: 'Immortal (2026) 4K', cat: '5', added: 98, ext: 'mp4' },
      { id: '4', type: 'movie', name: 'Old Henry', cat: '6', added: 50, ext: 'mp4' },
      { id: '5', type: 'movie', name: 'Behadd (2026) (Gujarati)', cat: '7', added: 70, ext: 'mp4' }
    ] },
    series: { cats: [], items: [] }
  });
}

test('categories are grouped by the text before "|"', () => {
  const { App } = loadApp();
  seed(App);
  const groups = App.Catalog.groups('movie');
  eq(groups.map(g => g.name), ['ENGLISH', 'INDIAN']);
  eq(groups[0].cats.map(c => c.label), ['4K', 'FHD 2026']);
  assert.strictEqual(App.Catalog.groups('live')[1].cats[0].label, 'NEWS');
});

test('Fresh Arrivals is newest-first and de-duplicates the same title', () => {
  const { App } = loadApp();
  seed(App);
  const fresh = App.Catalog.freshArrivals('movie', 20).map(i => i.id);
  eq(fresh, ['1', '5', '4']);
});

test('search matches word prefixes and skips hidden or locked categories', () => {
  const { App } = loadApp();
  seed(App);
  eq(App.Catalog.search('imm').movie.map(i => i.id), ['1', '2', '3']);
  eq(App.Catalog.search('gujarati').movie.map(i => i.id), ['5']);
  App.User.setHidden('movie', '5', true);
  eq(App.Catalog.search('immortal').movie.map(i => i.id), ['2']);
  App.User.setLocked('movie', '6', true);
  assert.strictEqual(App.Catalog.search('immortal').movie.length, 0);
  App.unlocked = true;
  assert.strictEqual(App.Catalog.search('immortal').movie.length, 1);
});

test('live candidates honour the channel format and try the other scheme second on HTTP pages', () => {
  const { App } = loadApp();
  seed(App);
  const live = App.Catalog.item('live', '10');
  const urls = App.streamCandidates(live, 'live');
  assert.strictEqual(urls[0], 'http://provider.example:8080/live/u1/p%40ss/10.m3u8');
  assert.strictEqual(urls[1], 'http://provider.example:8080/live/u1/p%40ss/10.ts');
  assert.ok(urls.some(u => u.startsWith('https://')));
  App.Settings.set('channelFormat', 'ts');
  assert.ok(App.streamCandidates(live, 'live')[0].endsWith('/10.ts'));
});

test('on an HTTPS page without a proxy only https:// candidates are produced', () => {
  const { App } = loadApp({ href: 'https://someone.github.io/app/' });
  seed(App);
  const urls = App.streamCandidates(App.Catalog.item('movie', '1'), 'movie');
  assert.ok(urls.length > 0);
  assert.ok(urls.every(u => u.startsWith('https://')), urls.join(' '));
  assert.ok(urls[0].endsWith('/movie/u1/p%40ss/1.mkv'));
});

test('custom proxy wraps http media on HTTPS pages and unwrap reverses it', () => {
  const { App } = loadApp({ href: 'https://someone.github.io/', storage: { aura_custom_proxy: 'https://px.example.dev/?url=%s' } });
  const raw = 'http://provider.example:8080/live/u/p/1.m3u8';
  const wrapped = App.Net.media(raw);
  assert.strictEqual(wrapped, `https://px.example.dev/?url=${encodeURIComponent(raw)}`);
  assert.strictEqual(App.Net.unwrap(wrapped), raw);
  assert.strictEqual(App.Net.unwrap(`/stream?url=${encodeURIComponent(raw)}`), raw);
  assert.strictEqual(App.Net.blocked(raw), false);
  assert.strictEqual(App.Net.media('https://cdn.example/x.m3u8'), 'https://cdn.example/x.m3u8');
});

test('without a proxy an HTTPS page reports http:// URLs as blocked', () => {
  const { App } = loadApp({ href: 'https://someone.github.io/' });
  assert.strictEqual(App.Net.blocked('http://provider.example/x.ts'), true);
  assert.strictEqual(App.Net.blocked('https://provider.example/x.ts'), false);
});

test('credentials are redacted from stream URLs', () => {
  const { App } = loadApp();
  assert.strictEqual(App.redact('http://h:8080/movie/user/secret/1.mp4'), 'http://h:8080/movie/•••/•••/1.mp4');
  assert.strictEqual(App.redact('http://h/player_api.php?username=a&password=b'), 'http://h/player_api.php?username=•••&password=•••');
});

test('helpers: base64 EPG text, quality tags and progress percent', () => {
  const { App } = loadApp();
  assert.strictEqual(App.b64(Buffer.from('Café ☕').toString('base64')), 'Café ☕');
  assert.strictEqual(App.qualityOf('UK FHD : TNT Boxing'), 'FHD');
  assert.strictEqual(App.qualityOf('Bigg Boss 24X7 Hindi 4K'), '4K');
  assert.strictEqual(App.qualityOf('Bigg Boss Bangla'), '');
  assert.strictEqual(App.User.pct({ pos: 862, dur: 7779 }), 11);
  assert.strictEqual(App.fmtTime(7779), '2:09:39');
});

test('legacy single-provider config is migrated into a source', () => {
  const { App } = loadApp({ storage: { aura_config: JSON.stringify({ server: 'http://old.example:8080/', user: 'bob', pass: 'x' }), aura_favorites: JSON.stringify([{ id: 7, type: 'live', title: 'News' }]) } });
  assert.strictEqual(App.Sources.list.length, 1);
  assert.strictEqual(App.Sources.active.server, 'http://old.example:8080');
  App.User.load();
  assert.strictEqual(App.User.isFav('live', '7'), true);
});
