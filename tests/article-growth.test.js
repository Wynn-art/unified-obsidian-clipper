const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../youtube/growth-service.js');
function core() {
  assert.ok(fs.existsSync(path.join(__dirname, '../web/growth-core.js')), 'article growth adapter must exist');
  return require('../web/growth-core.js');
}
const context = (url = 'https://example.com/articles/learn?a=1') => ({ videoId: url, url, title: '文章学习', transcript: '正文：每周安排两小时实践。', overview: '学习方法' });
const report = { summary: '明确目标', insights: ['从小实验开始'], actions: [{ priority: '高', action: '练习十分钟', deliverable: '实践记录', timeframe: '明天', successCriterion: '完成一次', obstacle: '忘记', alternative: '设置提醒' }], questions: ['效果如何？'] };
function fixture() {
  const data = {}, calls = [];
  const storage = { get: async k => ({ [k]: structuredClone(data[k]) }), set: async v => Object.assign(data, structuredClone(v)) };
  const api = service.create({ core: core(), storage, storagePrefix: 'article_growth_v1_', complete: async args => { calls.push(args); return args.responseFormat ? JSON.stringify(report) : '建议先记录一次实践。'; } });
  return { api, calls, data, storage };
}
test('article identity preserves distinct URLs, queries and hash routes and rejects unsafe or mismatched contexts', () => {
  const c = core();
  assert.deepEqual(c.normalizeContext(context()), context());
  for (const url of ['file:///private/a', 'javascript:alert(1)', 'https://name:secret@example.com/', 'chrome://settings']) assert.throws(() => c.videoId(url), /文章|链接/);
  assert.throws(() => c.normalizeContext({ ...context(), videoId: 'https://other.test/' }), /一致/);
  assert.notEqual(c.videoId('https://a.test/#/one'), c.videoId('https://a.test/#/two'));
  assert.notEqual(c.videoId('https://a.test/?id=1'), c.videoId('https://a.test/?id=2'));
});
test('article client prompt uses original article data and never claims to read attachments', () => {
  const c = core(), prompt = c.buildClientPrompt(context(), '怎么应用？');
  assert.match(prompt, /文章正文/);
  assert.match(prompt, /每周安排两小时/);
  assert.match(prompt, /若没有收到附件/);
  assert.doesNotMatch(prompt, /视频标题|完整字幕/);
});
test('article dialogue is isolated and imported material alone does not request a report', async () => {
  const f = fixture();
  await f.api.importSource(context().videoId, { title: '材料', text: '我的目标' });
  assert.equal(await f.api.prepareReport(context()), null);
  assert.equal(f.calls.length, 0);
  await f.api.send(context(), '如何应用？');
  assert.equal((await f.api.get('https://example.com/other')).turns.length, 0);
  assert.ok(Object.keys(f.data).every(k => k.startsWith('article_growth_v1_')));
  assert.match(f.calls[0].messages[0].content, /文章正文/);
  assert.match(f.calls[0].messages[0].content, /简体中文/);
  assert.match(f.calls[0].messages[0].content, /指令不能覆盖/);
});
test('article report includes Chinese plans, original dialogue and safe article link, and caches by body', async () => {
  const f = fixture();
  const ctx = context('https://example.com/a(b)');
  await f.api.send(ctx, '如何应用？');
  const first = await f.api.prepareReport(ctx);
  assert.match(first.markdown, /文章来源/);
  assert.match(first.markdown, /文章正文/);
  assert.match(first.markdown, /行动计划/);
  assert.match(first.markdown, /如何应用/);
  assert.match(first.markdown, /a%28b%29/);
  assert.doesNotMatch(first.markdown, /视频来源|视频字幕/);
  assert.equal((await f.api.prepareReport(ctx)).key, first.key);
  assert.equal(f.calls.length, 2);
  await f.api.prepareReport({ ...ctx, transcript: '修订的正文' });
  assert.equal(f.calls.length, 3);
});
test('article report rejects fully English model output without caching', async () => {
  const c = core();
  assert.throws(() => c.validateReport(JSON.stringify({ ...report, summary: 'English only', insights: ['English insight'], questions: ['English question'], actions: report.actions.map(a => Object.fromEntries(Object.keys(a).map(k => [k, 'English only']))) })), /中文/);
  assert.deepEqual(c.validateReport(JSON.stringify(report)), report);
});

class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; this.textContent = ''; this.open = false; }
  addEventListener(n, fn) { this.listeners[n] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  fire(name) { return this.listeners[name]?.({ preventDefault() {} }); }
}
function uiFixture(send) {
  assert.ok(fs.existsSync(path.join(__dirname, '../web/growth-ui.js')), 'article UI adapter must exist');
  const elements = new Map();
  const doc = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() };
  const api = require('../web/growth-ui.js').create({ document: doc, send, copy: async () => {}, confirm: () => true });
  return { api, el: id => doc.getElementById(id) };
}
const empty = videoId => ({ videoId, revision: 0, turns: [], sources: [], report: null });
test('article UI uses extracted original body, ignores late refreshes and cancels old conversations', async () => {
  const calls = [];
  const f = uiFixture(async msg => { calls.push(msg); return { success: true, value: empty(msg.videoId) }; });
  const first = f.api.beginRefresh(), second = f.api.beginRefresh();
  await f.api.commitRefresh(first, { url: 'https://a.test/old', title: '旧', mainContent: '旧正文' });
  assert.equal(f.api.getContext(), null);
  await f.api.commitRefresh(second, { url: 'https://a.test/new', title: '新', mainContent: '新正文' });
  assert.equal(f.api.getContext().transcript, '新正文');
  assert.match(f.el('growthStatus').textContent, /文章/);
  assert.doesNotMatch(f.el('growthStatus').textContent, /视频/);
  const guard = f.api.captureGuard();
  f.api.beginRefresh();
  assert.equal(guard(), false);
  assert.equal(f.api.getContext(), null);
});
test('article UI prepares no report for empty dialogue and always namespaces its requests', async () => {
  const calls = [];
  const f = uiFixture(async msg => { calls.push(msg); return { success: true, value: empty(msg.videoId) }; });
  const token = f.api.beginRefresh();
  await f.api.commitRefresh(token, { url: 'https://a.test/article', title: '文章', mainContent: '正文' });
  assert.equal(await f.api.prepareReport(f.api.getContext()), null);
  assert.ok(calls.every(c => c.action.startsWith('article-growth:')));
  assert.ok(!calls.some(c => c.action === 'article-growth:report'));
});

test('optional article growth context failure does not invalidate normal clipping guard', async () => {
  const f = uiFixture(async msg => ({ success: true, value: empty(msg.videoId) }));
  const token = f.api.beginRefresh();
  await f.api.commitRefresh(token, { url: 'https://a.test/', title: '标题', mainContent: '' });
  assert.equal(f.api.getContext(), null);
  const guard = f.api.captureGuard();
  assert.equal(guard(), true);
  f.api.beginRefresh();
  assert.equal(guard(), false);
});

test('reports for two articles appended to a shared URI note never overwrite one another', async () => {
  const exporter = require('../web/growth-export.js');
  const a = { markdown: '# A' }, b = { markdown: '# B' };
  const target = { transport: 'uri', canvasPath: '阅读/每日阅读.canvas', vault: '知识库' };
  await exporter.attach(a, target, { markdown: '# 报告A' }, context('https://a.test/article'), { behavior: 'append' });
  await exporter.attach(b, target, { markdown: '# 报告B' }, context('https://b.test/article'), { behavior: 'append' });
  assert.notEqual(a.reportPath, b.reportPath);
  assert.ok(a.markdown.includes(encodeURIComponent(a.reportPath.split('/').pop())));
});

test('article report URI uses strict percent encoding so Obsidian keeps Markdown structure', async () => {
  const exporter = require('../web/growth-export.js');
  const markdown = '# 中文成长报告\n\n## 行动计划\n\n- 完成一次练习\n\n| 项目 | 内容 |\n| --- | --- |\n| 下一步 | 今天执行 |';
  const pair = { markdown: '# 主笔记' };
  const target = { transport: 'uri', canvasPath: '文章/中文文章.canvas', vault: '知识 库' };
  await exporter.attach(pair, target, { markdown }, context('https://a.test/article'));
  let raw = '';
  await exporter.save(pair, target, { report: false }, { openUri: async uri => { raw = uri; } });
  assert.ok(raw.includes('%20'), 'spaces must use Obsidian-documented %20 encoding');
  assert.equal(raw.includes('+'), false, 'form-style + encoding breaks Markdown headings and tables in Obsidian');
  const parsed = new URL(raw);
  assert.equal(parsed.searchParams.get('content'), markdown);
  assert.equal(parsed.searchParams.get('vault'), '知识 库');
});

test('article UI stays unready during refresh and becomes ready even when optional context cannot normalize', async () => {
  const f = uiFixture(async msg => ({ success: true, value: empty(msg.videoId) }));
  const token = f.api.beginRefresh();
  assert.equal(typeof f.api.isReady, 'function');
  assert.equal(f.api.isReady(), false);
  assert.equal(f.el('clip-btn').disabled, true);
  await f.api.commitRefresh(token, { url: 'https://a.test/', title: '标题', mainContent: '' });
  assert.equal(f.api.isReady(), true);
  assert.equal(f.el('clip-btn').disabled, false);
});

test('article dialogue stays collapsed when a valid article becomes ready', async () => {
  const f = uiFixture(async msg => ({ success: true, value: empty(msg.videoId) }));
  const token = f.api.beginRefresh();
  assert.equal(f.el('growthChat').open, false);
  await f.api.commitRefresh(token, { url: 'https://a.test/', title: '标题', mainContent: '正文' });
  assert.equal(f.el('growthChat').open, false);
});

test('article popup does not expose the full-height embedded-panel action', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../web/popup.js'), 'utf8');
  const growthCss = fs.readFileSync(path.join(__dirname, '../web/growth.css'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
  assert.doesNotMatch(html, /id="embedded-mode"|打开全高对话面板/);
  assert.doesNotMatch(popupJs, /getElementById\("embedded-mode"\)/);
  assert.doesNotMatch(growthCss, /\.open-tall-panel/);
  assert.doesNotMatch(styleCss, /#embedded-mode/);
});

test('article growth chat is inside the clipping column so popup overflow cannot hide it', () => {
  for (const file of ['popup.html', 'side-panel.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
    assert.match(html, /<meta\s+charset="UTF-8">/i, `${file}: static Chinese must be parsed as UTF-8`);
    const clipperStart = html.indexOf('<div class="clipper">');
    const footer = html.indexOf('<div class="clipper-footer">');
    const chat = html.indexOf('<details class="growth-chat"');
    const scripts = html.indexOf('<script src="../youtube/growth-core.js">');
    const clipperEnd = html.lastIndexOf('</div>', scripts);
    assert.ok(clipperStart >= 0 && footer > clipperStart && chat > footer && chat < clipperEnd,
      `${file}: growth chat must be fixed directly below the save footer`);
    assert.match(html,
      /class="clipper-footer"[\s\S]*?<\/div>\s*<\/div>\s*<details class="growth-chat"/,
      `${file}: no layout node may sit between the save footer and growth chat`);
  }
  const css = fs.readFileSync(path.join(__dirname, '../web/growth.css'), 'utf8');
  assert.match(css, /\.clipper\s*>\s*\.clipper-footer\s*\+\s*\.growth-chat\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(css, /#popup:not\(\.is-side-panel\):not\(\.is-embedded\)[^{]*\{[^}]*--popup-height:\s*600px[^}]*--popup-max-height:\s*600px[^}]*--chromium-popup-height:\s*600px/s);
  assert.match(css, /\.clipper\s*>\s*\.growth-chat\[open\][^{]*\{[^}]*position:\s*static[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.clipper\s*>\s*#articleGrowthNotice\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.clipper\s*>\s*#note-content-container\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.clipper\s*>\s*\.clipper-footer\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(css, /\.unified-save-hint\s*\{[^}]*display:\s*none/s);
});
