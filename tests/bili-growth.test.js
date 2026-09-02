const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../youtube/growth-service.js');
const exporter = require('../bilibili-digest/obsidian-export.js');
function core() {
  assert.ok(fs.existsSync(path.join(__dirname, '../bilibili-digest/growth-core.js')), 'Bilibili growth context adapter must exist');
  return require('../bilibili-digest/growth-core.js');
}
const context = (page = 1) => ({ videoId: `BV1xx411c7mD_p${page}`, title: `学习方法 · P${page}`, url: `https://www.bilibili.com/video/BV1xx411c7mD?p=${page}`, transcript: '[0:00] 每天练习十分钟。', overview: '学习方法' });
const report = { summary: '明确目标', insights: ['从小实验开始'], actions: [{ priority: '高', action: '练习十分钟', deliverable: '实践记录', timeframe: '明天', successCriterion: '完成一次', obstacle: '忘记', alternative: '设置提醒' }], questions: ['效果如何？'] };
function fixture(complete = async () => '从一次练习开始。') {
  const data = {};
  const storage = { get: async key => ({ [key]: structuredClone(data[key]) }), set: async values => Object.assign(data, structuredClone(values)) };
  return { data, storage, api: service.create({ storage, complete, core: core(), storagePrefix: 'bili_growth_v1_' }) };
}
test('Bilibili context validates BV/part identity and copies a real Bilibili client prompt', () => {
  const c = core();
  assert.deepEqual(c.normalizeContext(context(2)), context(2));
  assert.match(c.buildClientPrompt(context(2), '如何应用？'), /bilibili.com\/video\/BV1xx411c7mD\?p=2/);
  for (const videoId of ['video12345', 'BV1xx411c7mD_p0', 'BV1xx411c7mD_p01', 'BV1xx411c7mD_p1/../x']) assert.throws(() => c.videoId(videoId), /视频|分 P/);
  for (const url of ['https://evil.test/video/BV1xx411c7mD?p=2', context(1).url, 'https://www.bilibili.com/video/BV2xx411c7mD?p=2']) assert.throws(() => c.normalizeContext({ ...context(2), url }), /链接/);
});
test('shared growth service isolates Bilibili parts and YouTube storage', async () => {
  const f = fixture();
  await f.api.send(context(1), '第一集如何实践？');
  assert.equal((await f.api.get(context(2).videoId)).turns.length, 0);
  await f.api.send(context(2), '第二集如何实践？');
  await f.api.clear(context(1).videoId);
  assert.equal((await f.api.get(context(2).videoId)).turns[0].user, '第二集如何实践？');
  assert.ok(Object.keys(f.data).every(key => key.startsWith('bili_growth_v1_')));
  const yt = service.create({ storage: f.storage, complete: async () => 'YouTube answer' });
  assert.equal((await yt.get('BV1xx411c7mD_p2')).turns.length, 0);
});
test('Bilibili imported sources alone do not generate a report; completed dialogue does and caches it', async () => {
  let calls = 0;
  const f = fixture(async ({ messages, responseFormat }) => {
    calls++;
    assert.match(messages[0].content, /简体中文/);
    return responseFormat ? JSON.stringify(report) : '先记录一次练习。';
  });
  await f.api.importSource(context().videoId, { title: '客户端分析', text: '每周只有两小时' });
  assert.equal(await f.api.prepareReport(context()), null);
  assert.equal(calls, 0);
  await f.api.send(context(), '如何开始？');
  const result = await f.api.prepareReport(context());
  assert.match(result.markdown, /bilibili.com\/video\/BV1xx411c7mD\?p=1/);
  assert.match(result.markdown, /如何开始？/);
  assert.match(result.markdown, /行动计划/);
  assert.match(result.markdown, /每周只有两小时/);
  assert.equal((await f.api.prepareReport(context())).markdown, result.markdown);
  assert.equal(calls, 2);
});
test('canceling a Bilibili reply prevents late persistence without clearing another part', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.api.send(context(), '问题');
  const rejected = assert.rejects(pending, /取消/);
  for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(finish);
  await f.api.cancel(context().videoId);
  finish('迟到答案');
  await rejected;
  assert.equal((await f.api.get(context().videoId)).turns.length, 0);
});
function exportFixture() {
  const calls = [], confirmations = [];
  const control = { failReport: false, existingReport: false, current: true };
  const send = async msg => {
    calls.push(msg);
    if (msg.type === 'get-settings') return { ok: true, settings: { noteFolder: 'B站', obsidianApiBaseUrl: 'http://localhost:27123', obsidianApiKey: 'synthetic-key' } };
    if (msg.type === 'obsidian-note-exists') return { ok: true, exists: control.existingReport && msg.filepath.includes('对话报告') };
    if (msg.type === 'write-obsidian-note') return { ok: !(control.failReport && msg.filepath.includes('对话报告')), error: 'HTTP 500' };
    throw new Error('unexpected request');
  };
  return { calls, control, dependencies: { send, confirm: text => { confirmations.push(text); return true; }, isCurrent: () => control.current }, confirmations };
}
const documentForExport = (reportText = null) => ({ bvid: 'BV1xx411c7mD', page: 2, title: 'A/B', markdown: '# 学习稿', conversationReport: reportText });
test('Bilibili no-dialogue save keeps its original single-file behavior', async () => {
  const f = exportFixture();
  await exporter.save(documentForExport(), f.dependencies);
  const writes = f.calls.filter(m => m.type === 'write-obsidian-note');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].content, '# 学习稿');
});
test('Bilibili saves a linked growth report in the same folder and preserves P2 in both names', async () => {
  const f = exportFixture();
  const result = await exporter.save(documentForExport('# 成长报告'), f.dependencies);
  const writes = f.calls.filter(m => m.type === 'write-obsidian-note');
  assert.equal(writes.length, 2);
  assert.match(writes[0].content, /成长对话报告/);
  assert.match(writes[1].filepath, /P2 - 学习稿 - 对话报告.md$/);
  assert.equal(writes[1].content, '# 成长报告');
  assert.equal(result.reportPath, writes[1].filepath);
});
test('rejecting an existing report overwrite leaves both files untouched', async () => {
  const f = exportFixture(); f.control.existingReport = true;
  const result = await exporter.save(documentForExport('# 报告'), { ...f.dependencies, confirm: () => false });
  assert.equal(result.canceled, true);
  assert.equal(f.calls.filter(m => m.type === 'write-obsidian-note').length, 0);
});
test('Bilibili report failure retries only the missing file with the same saver', async () => {
  assert.equal(typeof exporter.createSaver, 'function');
  const save = exporter.createSaver(), f = exportFixture();
  f.control.failReport = true;
  await assert.rejects(save(documentForExport('# 报告'), f.dependencies), /学习稿已保存.*报告/);
  f.calls.length = 0; f.control.failReport = false;
  await save(documentForExport('# 报告'), f.dependencies);
  const writes = f.calls.filter(m => m.type === 'write-obsidian-note');
  assert.equal(writes.length, 1);
  assert.match(writes[0].filepath, /对话报告/);
});
test('changed content invalidates partial-save progress', async () => {
  assert.equal(typeof exporter.createSaver, 'function');
  const save = exporter.createSaver(), f = exportFixture(); f.control.failReport = true;
  await assert.rejects(save(documentForExport('# 报告'), f.dependencies));
  f.calls.length = 0; f.control.failReport = false;
  await save(documentForExport('# 新报告'), f.dependencies);
  assert.equal(f.calls.filter(m => m.type === 'write-obsidian-note').length, 2);
});
test('Bilibili rejects malformed report before touching Obsidian', async () => {
  const f = exportFixture();
  await assert.rejects(exporter.save(documentForExport({ text: 'bad' }), f.dependencies), /报告/);
  assert.equal(f.calls.length, 0);
});
test('switching parts during preflight cancels before writing either file', async () => {
  const f = exportFixture();
  const send = async m => { const result = await f.dependencies.send(m); if (m.type === 'obsidian-note-exists') f.control.current = false; return result; };
  await assert.rejects(exporter.save(documentForExport('# 报告'), { ...f.dependencies, send }), /切换|取消/);
  assert.equal(f.calls.filter(m => m.type === 'write-obsidian-note').length, 0);
});

test('switching parts while a note write settles reports partial success and never starts its report', async () => {
  const f = exportFixture();
  const send = async m => {
    const result = await f.dependencies.send(m);
    if (m.type === 'write-obsidian-note') f.control.current = false;
    return result;
  };
  await assert.rejects(exporter.save(documentForExport('# 报告'), { ...f.dependencies, send }), /学习稿已保存.*报告/);
  assert.equal(f.calls.filter(m => m.type === 'write-obsidian-note').length, 1);
});

class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  fire(name) { return this.listeners[name]?.({}); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
function uiFixture(send) {
  const ui = require('../bilibili-digest/growth-ui.js');
  const elements = new Map(), copies = [];
  const document = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() };
  const state = { view: 'ready', bvid: 'BV1xx411c7mD', page: 1, analysis: null,
    data: { videoInfo: { title: '学习方法' }, segments: [{ start: 12, text: '带时间戳的原文' }] } };
  const controller = ui.create({ document, getState: () => state, send, copy: async text => copies.push(text), confirm: () => true });
  return { state, copies, controller, el: id => document.getElementById(id) };
}
const emptyState = videoId => ({ videoId, revision: 0, turns: [], sources: [], report: null });
test('Bilibili UI sends only its namespace and copies current part with original timestamped subtitles', async () => {
  const calls = [];
  const f = uiFixture(async message => { calls.push(message); return { success: true, value: emptyState(message.videoId) }; });
  await f.controller.sync();
  f.el('growthQuestion').value = '如何实践？';
  await f.el('growthCopyClient').fire('click');
  assert.match(f.copies[0], /\[0:12\] 带时间戳的原文/);
  assert.match(f.copies[0], /bilibili.com\/video\/BV1xx411c7mD\?p=1/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'bili-growth:get');
});
test('switching Bilibili parts rejects pending report and sends cancellation to the previous part', async () => {
  let finish;
  const calls = [];
  const f = uiFixture(message => {
    calls.push(message);
    if (message.action === 'bili-growth:report') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ success: true, value: { ...emptyState(message.videoId), revision: 1, turns: [{ user: '问', assistant: '答' }] } });
  });
  await f.controller.sync();
  const pending = f.controller.prepareReport(f.controller.getContext());
  const rejected = assert.rejects(pending, /切换|取消/);
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  assert.ok(finish);
  f.state.page = 2;
  await f.controller.sync();
  finish({ success: true, value: { markdown: '# 旧分P报告' } });
  await rejected;
  assert.ok(calls.some(m => m.action === 'bili-growth:cancel' && m.videoId === 'BV1xx411c7mD_p1'));
  assert.equal(f.el('growthReportText').textContent, '');
});
