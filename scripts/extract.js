/**
 * AURA IPTV Refactor Script
 * Extracts CSS + JS from monolith index.html into separate files.
 * Run: node scripts/extract.js
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

// ── 1. Extract <style> block content ──────────────────────────────────────────
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) { console.error('No <style> block found'); process.exit(1); }
const css = styleMatch[1];
fs.mkdirSync(path.join(__dirname, '..', 'src', 'css'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'src', 'css', 'aura.css'), css, 'utf8');
console.log('✓ Wrote src/css/aura.css (' + css.length + ' bytes)');

// ── 2. Extract ALL <script> blocks that are NOT external ──────────────────────
const scriptBlocks = [];
const scriptRe = /<script(\s[^>]*)?>[\s\S]*?<\/script>/gi;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const tag = m[0];
  const attrs = m[1] || '';
  if (/src=/i.test(attrs)) continue; // skip external scripts
  const inner = tag.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
  if (inner) scriptBlocks.push(inner);
}
const combinedJs = scriptBlocks.join('\n\n');
fs.mkdirSync(path.join(__dirname, '..', 'src', 'js'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'src', 'js', 'aura-app.js'), combinedJs, 'utf8');
console.log('✓ Wrote src/js/aura-app.js (' + combinedJs.length + ' bytes, ' + scriptBlocks.length + ' blocks merged)');

// ── 3. Extract body HTML (between <body...> and </body>) ──────────────────────
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) { console.error('No <body> found'); process.exit(1); }
const bodyContent = bodyMatch[1]
  // Remove all <style> blocks
  .replace(/<style>[\s\S]*?<\/style>/gi, '')
  // Remove all <script> blocks (external + inline)
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/^\s*\n/gm, '')  // collapse blank lines
  .trimEnd();

// Extract <head> non-style, non-tailwindconfig parts
const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
const head = headMatch ? headMatch[1]
  .replace(/<style>[\s\S]*?<\/style>/gi, '')
  .replace(/<script>[\s\S]*?<\/script>/gi, '')  // remove inline scripts (tailwind config goes back inline)
  .trim() : '';

// Get tailwind config script (needs to be inline before tailwind.js)
const twConfigMatch = html.match(/<script>\s*tailwind\.config[\s\S]*?<\/script>/);
const twConfig = twConfigMatch ? twConfigMatch[0] : '';

console.log('✓ Body + head extracted');
console.log('\nNow write the new index.html manually with this info.');
console.log('Head deps (non-tw):', head.match(/<link/g)?.length || 0, 'link tags,', head.match(/<script src/gi)?.length || 0, 'external scripts');
console.log('TW config found:', !!twConfig);
console.log('\nDone! Check src/css/aura.css and src/js/aura-app.js');
