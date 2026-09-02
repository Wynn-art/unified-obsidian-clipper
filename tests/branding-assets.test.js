const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function pngSize(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20), data[25]];
}

test('all pages use the square PNG brand logo', () => {
  const files = [
    'status.html', 'web/popup.html', 'web/side-panel.html', 'web/settings.html',
    'youtube/sidepanel.html', 'youtube/options.html',
    'bilibili/popup.html', 'bilibili/sidepanel.html', 'bilibili/options.html',
    'bilibili-digest/sidepanel.html', 'bilibili-digest/options.html',
  ];
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /branding\/logo\.png/);
    assert.doesNotMatch(html, /branding\/logo\.jpeg/);
  }
});

test('master logo and extension icons are square PNG files', () => {
  assert.deepEqual(pngSize(path.join(root, 'branding/logo.png')), [1254, 1254, 6]);
  for (const size of [16, 32, 48, 128]) {
    assert.deepEqual(pngSize(path.join(root, `branding/icon${size}.png`)), [size, size, 6]);
  }
});
