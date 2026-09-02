const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Bilibili messages cannot invoke the identically named YouTube actions', async () => {
  const sent = [], tabSent = [], listeners = [];
  const context = { chrome: {
    runtime: {
      sendMessage: async message => { sent.push(message); return { success: true }; },
      onMessage: { addListener: fn => listeners.push(fn) },
    },
    tabs: { sendMessage: async (id, message) => tabSent.push([id, message]) },
  }};
  vm.runInNewContext(read('bilibili-digest/bridge.js'), context);
  const bridge = context.UNIFIED_BILI_BRIDGE;
  await bridge.sendMessage({ action: 'saveNote', bvid: 'BV1xx411c7mD' });
  await bridge.sendTabMessage(7, { action: 'seekTo', seconds: 12 });
  assert.equal(sent[0].action, 'bili-digest:saveNote');
  assert.equal(tabSent[0][1].action, 'bili-digest:seekTo');
  const received = [];
  bridge.onMessage(message => { received.push(message); return true; });
  assert.equal(listeners[0]({ action: 'saveNote', videoId: 'youtube' }), false);
  assert.equal(listeners[0]({ type: 'get-settings' }), false);
  assert.equal(listeners[0]({ action: 'bili-digest:saveNote', bvid: 'BV1xx411c7mD' }), true);
  assert.equal(received.length, 1);
  assert.equal(received[0].action, 'saveNote');
});

test('study mode survives tab refresh and returns to chat without replacing web panels', async () => {
  const { createPanelController } = require('../bilibili-digest/panel-controller.js');
  const calls = [], storage = {};
  const chrome = {
    storage: { session: { get: async () => storage, set: async values => Object.assign(storage, values) } },
    tabs: { get: async id => ({ id, windowId: 2, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }) },
    action: { setPopup: async options => calls.push(['popup', options]) },
    sidePanel: { setOptions: async options => calls.push(['set', options]), open: async options => calls.push(['open', options]) },
  };
  const controller = createPanelController(chrome);
  await controller.open(7, 'study');
  assert.ok(calls.some(([type, options]) => type === 'set' && options.path === 'bilibili-digest/sidepanel.html'));
  calls.length = 0;
  await controller.configure({ id: 7, url: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  assert.equal(calls.filter(([type]) => type === 'set').length, 0, 'unchanged path must not reload an in-flight study panel');
  const restarted = createPanelController(chrome);
  await restarted.configure({ id: 7, url: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  assert.equal(calls.find(([type]) => type === 'set')[1].path, 'bilibili-digest/sidepanel.html');
  await restarted.open(7, 'chat');
  assert.equal(calls.filter(([type]) => type === 'set').at(-1)[1].path, 'bilibili/sidepanel.html');
  const count = calls.length;
  assert.equal(await restarted.configure({ id: 8, url: 'https://example.com' }), false);
  assert.equal(calls.length, count);
  await assert.rejects(() => restarted.open(7, 'invalid'), /mode/i);
});

test('study exports reuse the configured folder, keep part identity and block traversal', () => {
  const { buildPath } = require('../bilibili-digest/obsidian-export.js');
  assert.equal(buildPath({ folder: 'Clippings/Bilibili', title: 'A/B', bvid: 'BV1xx411c7mD', page: 2 }), 'Clippings/Bilibili/A-B - BV1xx411c7mD - P2 - 学习稿.md');
  assert.throws(() => buildPath({ folder: '../secret', title: 'x', bvid: 'BV1xx411c7mD' }), /目录/);
  assert.throws(() => buildPath({ folder: 'notes', title: 'x', bvid: 'unknown' }), /视频/);
});

test('upload-date folders use publication metadata and never silently substitute today', () => {
  const api = require('../bilibili-digest/lib/bili-api.js');
  const { buildPath } = require('../bilibili-digest/obsidian-export.js');
  const info = api.normalizeVideoInfo({ bvid: 'BV1xx411c7mD', pubdate: 1788134400 });
  assert.equal(info.publishedAt, 1788134400);
  assert.equal(buildPath({ folder: '{{upload_date}}/{{author}}', uploadDate: '2026-08-24', author: 'A/B', title: 'Demo', bvid: 'BV1xx411c7mD' }), '2026-08-24/A-B/Demo - BV1xx411c7mD - P1 - 学习稿.md');
  assert.throws(() => buildPath({ folder: '{{upload_date}}', title: 'Demo', bvid: 'BV1xx411c7mD' }), /发布日期/);
});

test('declining overwrite never writes and preserves the existing note', async () => {
  const { save } = require('../bilibili-digest/obsidian-export.js');
  const calls = [];
  const send = async message => {
    calls.push(message);
    if (message.type === 'get-settings') return { ok: true, settings: { noteFolder: 'notes', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'fixture' } };
    if (message.type === 'obsidian-note-exists') return { ok: true, exists: true };
    throw new Error('must not write');
  };
  const result = await save({ title: 'Example', bvid: 'BV1xx411c7mD', page: 1, markdown: '# Example' }, { send, confirm: () => false });
  assert.equal(result.canceled, true);
  assert.equal(calls.some(m => m.type === 'write-obsidian-note'), false);
});

test('successful study export writes the exact Markdown, and HTTP errors propagate', async () => {
  const { save } = require('../bilibili-digest/obsidian-export.js');
  const writes = [];
  let fail = false;
  const send = async message => {
    if (message.type === 'get-settings') return { ok: true, settings: { noteFolder: 'notes', obsidianApiBaseUrl: 'http://localhost:27123', obsidianApiKey: 'fixture' } };
    if (message.type === 'obsidian-note-exists') return { ok: true, exists: false };
    writes.push(message);
    return fail ? { ok: false, error: 'HTTP 401' } : { ok: true };
  };
  const doc = { title: 'Example', bvid: 'BV1xx411c7mD', page: 3, markdown: '# Exact\n\ntext' };
  const result = await save(doc, { send, confirm: () => true });
  assert.equal(result.path, 'notes/Example - BV1xx411c7mD - P3 - 学习稿.md');
  assert.equal(writes[0].content, '# Exact\n\ntext');
  assert.equal(writes[0].baseUrl, 'http://localhost:27123');
  fail = true;
  await assert.rejects(() => save(doc, { send, confirm: () => true }), /401/);
});

for (const view of ['loading', 'error', 'idle']) {
  test(`study export refuses stale subtitles while the new video is ${view}`, async () => {
    let click;
    const button = { disabled: false, addEventListener: (_event, listener) => { click = listener; } };
    const status = { textContent: '' };
    let calls = 0;
    const context = {
      document: { getElementById: id => id === 'unifiedSaveStudy' ? button : status },
      state: { view, bvid: 'BV1xx411c7mD', page: 2, data: { videoInfo: { title: 'Old video A' } }, analysis: null },
      currentTranscriptExport: () => ({ segments: [{ display: 'Old video A content' }] }),
      structuredClone, AbortController, setTimeout, clearTimeout,
      sendToBackground: async () => { calls++; return { success: true, notes: [] }; },
      BILI_LEARNING_STORE: { learningAsMarkdown: () => '# old video' },
      UNIFIED_BILI_EXPORT: { save: async () => { calls++; return { path: 'wrong-note.md' }; } },
      chrome: { runtime: { sendMessage() {} } }, window: { confirm: () => true },
    };
    vm.runInNewContext(read('bilibili-digest/integration-ui.js'), context);
    await click();
    assert.equal(calls, 0, 'loading/error state must never reach export or write');
    assert.match(status.textContent, /字幕/);
    assert.equal(button.disabled, false);
  });
}

test('switching Bilibili parts while notes load prevents the study integration from writing', async () => {
  let click, finishNotes;
  const button = { disabled: false, addEventListener: (_event, fn) => { click = fn; } }, status = { textContent: '' };
  let writes = 0;
  const state = { view: 'ready', bvid: 'BV1xx411c7mD', page: 1, data: { videoInfo: { title: 'Part 1' } }, analysis: null };
  const context = {
    document: { getElementById: id => id === 'unifiedSaveStudy' ? button : status }, state, structuredClone, AbortController, setTimeout, clearTimeout,
    currentTranscriptExport: () => ({ segments: [{ display: '第一集字幕' }] }),
    sendToBackground: () => new Promise(resolve => { finishNotes = resolve; }),
    BILI_LEARNING_STORE: { learningAsMarkdown: () => '# 第一集' },
    UNIFIED_BILI_EXPORT: { save: async () => { writes++; return { path: 'wrong.md' }; } },
    chrome: { runtime: { sendMessage() {} } }, window: { confirm: () => true },
  };
  vm.runInNewContext(read('bilibili-digest/integration-ui.js'), context);
  const saving = click();
  state.page = 2;
  finishNotes({ success: true, notes: [] });
  await saving;
  assert.equal(writes, 0);
  assert.match(status.textContent, /分 P 已切换/);
  assert.equal(button.disabled, false);
});
