import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file); else files.push(file);
  }
}
walk(root);
const errors = [];
function requireFile(file, owner) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push(`${owner}: missing ${path.relative(root, file)}`);
}
for (const file of [
  manifest.background.service_worker, manifest.action.default_popup, manifest.side_panel.default_path, manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap(entry => [...entry.js || [], ...entry.css || []]),
  ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
]) requireFile(path.join(root, file), 'manifest.json');
for (const file of files) {
  const relative = path.relative(root, file);
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) errors.push(`${relative}: ${result.stderr || result.error}`);
  }
  if (file.endsWith('.html')) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      requireFile(path.resolve(path.dirname(file), match[1].split(/[?#]/)[0]), relative);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Checked ${files.filter(file => /\.(?:js|mjs)$/.test(file)).length} JavaScript files, manifest assets and HTML script/style references.`);
