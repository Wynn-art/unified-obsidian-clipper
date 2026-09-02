const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('manifest does not repeat required hosts as optional permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal('optional_host_permissions' in manifest, false);
});

test('legacy YouTube worker does not start an uncaught side-panel behavior request', () => {
  const source = fs.readFileSync(path.join(root, 'youtube/background.js'), 'utf8');
  assert.doesNotMatch(source, /chrome\.sidePanel\.setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/);
});
