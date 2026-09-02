const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createSaver } = require('../bilibili-digest/obsidian-export.js');
const canvas = { nodes: [{ id: 'root', type: 'text', text: '中文脑图', x: 0, y: 0, width: 300, height: 100 }, { id: 'child', type: 'text', text: '具体行动', x: 420, y: 0, width: 280, height: 90 }], edges: [{ id: 'edge', fromNode: 'root', toNode: 'child', fromSide: 'right', toSide: 'left' }] };
const doc = { title: '学习方法', bvid: 'BV1xx411c7mD', page: 2, markdown: '# 学习稿', canvas };
function fixture() {
  const calls = [], controls = { fail: '', exists: '', current: true };
  const dependencies = { confirm: () => true, isCurrent: () => controls.current, send: async m => {
    calls.push(m);
    if (m.type === 'get-settings') return { ok: true, settings: { noteFolder: 'B站', obsidianApiBaseUrl: 'http://localhost:27123', obsidianApiKey: 'synthetic' } };
    if (m.type === 'obsidian-note-exists') return { ok: true, exists: m.filepath.endsWith(controls.exists) && Boolean(controls.exists) };
    return { ok: !(controls.fail && m.filepath.endsWith(controls.fail)), error: 'HTTP 500' };
  } };
  return { calls, controls, dependencies, writes: () => calls.filter(m => m.type === 'write-obsidian-note') };
}
test('B study saves Markdown + same-base Canvas without any conversation', async () => {
  const f = fixture(), result = await createSaver()(doc, f.dependencies);
  assert.equal(f.writes().length, 2);
  assert.equal(result.canvasPath, result.path.replace(/\.md$/, '.canvas'));
  assert.equal(f.writes()[1].contentType, 'application/json');
  assert.deepEqual(JSON.parse(f.writes()[1].content), canvas);
  assert.match(f.writes()[0].content, /\.canvas/);
  assert.match(f.writes()[0].content, /思维脑图/);
});
test('B study saves optional growth report after the two required artifacts', async () => {
  const f = fixture(), result = await createSaver()({ ...doc, conversationReport: '# 成长报告' }, f.dependencies);
  assert.equal(f.writes().length, 3);
  assert.equal(result.files.canvas, true);
  assert.equal(result.files.report, true);
  assert.match(f.writes()[2].filepath, /对话报告.md$/);
});
test('canvas failure preserves note success and retry writes only Canvas and report', async () => {
  const f = fixture(), save = createSaver(), input = { ...doc, conversationReport: '# 报告' };
  f.controls.fail = '.canvas';
  await assert.rejects(save(input, f.dependencies), /脑图/);
  assert.equal(f.writes().length, 2);
  f.calls.length = 0; f.controls.fail = '';
  await save(input, f.dependencies);
  assert.equal(f.writes().length, 2);
  assert.match(f.writes()[0].filepath, /\.canvas$/);
  assert.match(f.writes()[1].filepath, /对话报告/);
});
test('report failure after Canvas retry does not repeat either successful artifact', async () => {
  const f = fixture(), save = createSaver(), input = { ...doc, conversationReport: '# 报告' };
  f.controls.fail = '对话报告.md';
  await assert.rejects(save(input, f.dependencies), /报告/);
  f.calls.length = 0; f.controls.fail = '';
  await save(input, f.dependencies);
  assert.equal(f.writes().length, 1);
  assert.match(f.writes()[0].filepath, /对话报告/);
});
test('declining existing Canvas replacement prevents all writes', async () => {
  const f = fixture(); f.controls.exists = '.canvas';
  const result = await createSaver()(doc, { ...f.dependencies, confirm: () => false });
  assert.equal(result.canceled, true);
  assert.equal(f.writes().length, 0);
});
test('malformed Canvas fails before settings or Obsidian I/O', async () => {
  for (const value of [{}, { nodes: [], edges: [] }, { ...canvas, edges: [{ id: 'e', fromNode: 'root', toNode: 'missing' }] }, { ...canvas, nodes: [{ ...canvas.nodes[0], width: -1 }] }]) {
    const f = fixture();
    await assert.rejects(createSaver()({ ...doc, canvas: value }, f.dependencies), /脑图/);
    assert.equal(f.calls.length, 0);
  }
});
test('real B study save integration requests and passes a Canvas alongside optional report', async () => {
  let click; const calls = [], written = [];
  const button = { disabled: false, addEventListener: (_event, fn) => { click = fn; } }, status = { textContent: '' };
  const state = { view: 'ready', bvid: doc.bvid, page: 2, data: { videoInfo: { title: doc.title } }, analysis: null };
  const context = { state, structuredClone, AbortController, setTimeout, clearTimeout,
    document: { getElementById: id => id === 'unifiedSaveStudy' ? button : status }, window: { confirm: () => true },
    currentTranscriptExport: () => ({ segments: [{ start: 12, source: '原文字幕', display: 'Visible translation' }] }),
    sendToBackground: async () => ({ success: true, notes: [] }),
    BILI_LEARNING_STORE: { learningAsMarkdown: () => '# 原学习稿' },
    UNIFIED_BILI_EXPORT: { createSaver: () => async input => { written.push(input); return { path: 'x.md', canvasPath: 'x.canvas' }; } },
    chrome: { runtime: { sendMessage: async m => { calls.push(m); return { ok: true, value: { markdown: '## 中文学习总结\n', canvas } }; } } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bilibili-digest/integration-ui.js'), 'utf8'), context);
  await click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'learning:prepare');
  assert.equal(calls[0].payload.document.metadata.learningMode, 'bili-study');
  assert.match(calls[0].payload.document.mainContent, /原文字幕/);
  assert.doesNotMatch(calls[0].payload.document.mainContent, /Visible translation/);
  assert.deepEqual(written[0].canvas, canvas);
  assert.match(written[0].markdown, /原学习稿/);
  assert.match(status.textContent, /x.canvas/);
});

for (const interruption of ['part-change', 'stop', 'timeout']) test(`${interruption} during a stalled Canvas request releases controls and rejects late writes`, async () => {
  let click, finishLearning, growthSaving = false;
  let stop;
  const timers = [];
  const stopButton = { addEventListener: (_event, fn) => { stop = fn; } };
  const button = { disabled: false, addEventListener: (_event, fn) => { click = fn; } }, status = { textContent: '' };
  const state = { view: 'ready', bvid: doc.bvid, page: 1, data: { videoInfo: { title: doc.title } }, analysis: null };
  const writes = [];
  const context = { state, structuredClone, AbortController, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return fn; }, clearTimeout() {},
    document: { getElementById: id => id === 'unifiedSaveStudy' ? button : id === 'unifiedStudySaveStop' ? stopButton : status }, window: { confirm: () => true },
    BILI_GROWTH_UI: { create: () => ({ sync() {}, isBusy: () => false, getContext: () => null, captureGuard: () => () => true, setSaving: value => { growthSaving = value; } }) },
    currentTranscriptExport: () => ({ segments: [{ start: 0, source: '中文原文' }] }),
    sendToBackground: async () => ({ success: true, notes: [] }), BILI_LEARNING_STORE: { learningAsMarkdown: () => '# 原学习稿' },
    UNIFIED_BILI_EXPORT: { createSaver: () => async input => { writes.push(input); return { path: 'x.md', canvasPath: 'x.canvas' }; } },
    chrome: { runtime: { sendMessage: () => new Promise(resolve => { finishLearning = resolve; }) } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bilibili-digest/integration-ui.js'), 'utf8'), context);
  const saving = click();
  for (let i = 0; i < 20 && !finishLearning; i++) await Promise.resolve();
  assert.ok(finishLearning);
  if (interruption === 'part-change') { state.page = 2; context.syncBiliGrowthContext(); }
  if (interruption === 'stop') stop();
  if (interruption === 'timeout') { assert.ok(timers.at(-1).ms <= 180000); timers.at(-1).fn(); }
  await new Promise(resolve => setImmediate(resolve));
  const unlocked = !button.disabled && !growthSaving;
  finishLearning({ ok: true, value: { markdown: '# 旧内容', canvas } });
  await saving;
  assert.equal(unlocked, true, 'new video must not wait on the stale model response');
  assert.equal(writes.length, 0);
});

for (const interruption of ['stop', 'timeout']) test(`${interruption} invalidates the real growth panel before delayed report-state loading can start a model`, async () => {
  class Element {
    constructor() { this.value = ''; this.children = []; this.listeners = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {}
  }
  const elements = new Map();
  const document = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() };
  const full = { videoId: 'BV1xx411c7mD_p1', revision: 1, turns: [{ user: '问题', assistant: '答案' }], sources: [], report: null };
  const actions = [], timers = []; let gets = 0, finishGet;
  const send = async m => {
    actions.push(m.action || m.type);
    if (m.action === 'bili-growth:get' && ++gets === 2) return new Promise(resolve => { finishGet = resolve; });
    return { success: true, value: structuredClone(full) };
  };
  const state = { view: 'ready', bvid: doc.bvid, page: 1, data: { videoInfo: { title: doc.title }, segments: [{ start: 0, text: '中文原文' }] }, analysis: null };
  const context = { state, document, structuredClone, AbortController, setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout() {},
    window: { confirm: () => true }, BILI_GROWTH_UI: require('../bilibili-digest/growth-ui.js'),
    currentTranscriptExport: () => ({ segments: [{ start: 0, source: '中文原文' }] }),
    sendToBackground: async () => ({ success: true, notes: [] }), BILI_LEARNING_STORE: { learningAsMarkdown: () => '# 原学习稿' },
    UNIFIED_BILI_EXPORT: { createSaver: () => async () => { throw new Error('must not write'); } },
    chrome: { runtime: { sendMessage: send } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bilibili-digest/integration-ui.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const saving = document.getElementById('unifiedSaveStudy').listeners.click();
  for (let i = 0; i < 20 && !finishGet; i++) await Promise.resolve();
  assert.ok(finishGet);
  if (interruption === 'stop') document.getElementById('unifiedStudySaveStop').listeners.click();
  else timers.at(-1)();
  await saving;
  finishGet({ success: true, value: full });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(actions.includes('bili-growth:report'), false, 'no new paid report may start after Stop');
  assert.equal(actions.includes('learning:prepare'), false);
});
