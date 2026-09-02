const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '../web/popup.js'), 'utf8');
// Execute production functions from the shipped bundle. Explicit neighboring
// boundaries avoid reimplementing the save flow or loading unrelated popup UI.
function section(start, end) {
  const from = bundle.indexOf(start);
  assert.notEqual(from, -1, `missing production boundary: ${start}`);
  const to = bundle.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing production boundary: ${end}`);
  return bundle.slice(from, to);
}
const production = [
  section('var obsidian_note_creator_awaiter=', 'function obsidian_note_creator_generateFrontmatter'),
  'var popup_awaiter=obsidian_note_creator_awaiter; var pendingArticleLearningSave=null,articleSaveInFlight=null,lastSelectedVault="";',
  section('function sanitizeFileName', 'function formatDuration'),
  section('function resolveLearningPairTarget', 'var index_full='),
  section('function runArticleClipSave', '({template:popup_currentTemplate'),
].join('\n');

function fixture({ behavior = 'create', name = '中文文章.md', failWrite, aiFailure, clipboard = false } = {}) {
  const uris = [], requests = [], analyses = [], errors = [], stats = [];
  let closes = 0;
  const settings = { obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'fixture-only' };
  const storage = { sync: { get: async () => settings }, local: { get: async () => settings } };
  const context = {
    URL, Error, Promise, setTimeout, clearTimeout, navigator: { platform: 'MacIntel' },
    console: { log() {}, error() {} },
    DAILY_CONFIGURATION_ERROR: 'Daily configuration invalid',
    generalSettings: { legacyMode: !clipboard, silentOpen: true },
    utils_browser_polyfill: { storage },
    openObsidianUrl: async uri => {
      const parsed = new URL(uri);
      uris.push(parsed);
      if (failWrite?.(parsed.searchParams.get('file'), uris.length)) throw new Error('write rejected');
    },
    copyToClipboard: async () => false,
    getMessage: () => 'clipboard unavailable',
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (options.method === 'GET') return { status: 307, headers: { get: () => '/vault/Diary/2026-08-31.md' } };
      return { ok: !failWrite?.(decodeURIComponent(new URL(url).pathname), requests.length), status: 503 };
    },
    browser_polyfill_min_default: () => ({ runtime: { sendMessage: async message => {
      analyses.push(message);
      if (aiFailure) return { ok: false, error: 'Analysis unavailable' };
      return { ok: true, value: { markdown: '## 中文学习摘要\n\n', canvas: { nodes: [{ id: 'root', type: 'text', text: '中文主题', x: 0, y: 0, width: 200, height: 100 }], edges: [] } } };
    } } }),
    obsidian_note_creator_generateFrontmatter: async () => '---\ntitle: 示例\n---\n',
    incrementStat: async (...args) => stats.push(args),
    setLocalStorage: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(production, context);
  const input = {
    template: { id: 'article', name: 'Article', behavior },
    variables: { '{{title}}': '中文文章', '{{author}}': '作者' },
    vaultField: { value: '知识库' }, noteContentField: { value: '\n## 原文\n原文内容' },
    noteNameField: { value: name }, pathField: { value: '文章' }, documentTitle: 'Example',
    getProperties: () => [], completeInterpreter: async () => {},
    getTabInfo: async () => ({ url: 'https://example.com/article', title: '中文文章' }),
    showError: message => errors.push(message), close: () => { closes++; }, saveControl: { disabled: false },
  };
  return { context, input, uris, requests, analyses, errors, stats, settings, get closes() { return closes; }, run: () => context.runArticleClipSave(input) };
}

for (const name of ['中文文章', '中文文章.md', '中文文章.MD']) {
  test(`article pair uses the same basename for ${name}`, async () => {
    const f = fixture({ name });
    await f.run();
    assert.equal(f.uris[0].searchParams.get('file'), '文章/中文文章.canvas');
    assert.equal(f.uris[1].searchParams.get('file'), `文章/${name}`);
    assert.equal(JSON.parse(f.uris[0].searchParams.get('content')).nodes[0].text, '中文主题');
  });
}

test('article keeps frontmatter, Chinese analysis and original body, and links the actual Canvas', async () => {
  const f = fixture();
  await f.run();
  const markdown = f.uris[1].searchParams.get('content');
  assert.ok(markdown.startsWith('---\ntitle: 示例\n---\n'));
  assert.ok(markdown.includes('## 中文学习摘要'));
  assert.ok(markdown.includes('## 原文\n原文内容'));
  assert.ok(markdown.includes('[思维导图](<%E4%B8%AD%E6%96%87%E6%96%87%E7%AB%A0.canvas>)'));
  assert.equal(f.analyses[0].type, 'learning:prepare');
  assert.equal(f.analyses[0].payload.document.sourceType, 'article');
  assert.equal(f.stats.length, 1);
  assert.equal(f.closes, 1);
});

for (const behavior of ['create', 'overwrite', 'append', 'prepend']) {
  test(`URI article ${behavior} retains Markdown behavior and dispatches both files`, async () => {
    const f = fixture({ behavior });
    await f.run();
    assert.equal(f.uris.length, 2);
    assert.equal(f.uris[0].searchParams.get('overwrite'), 'true');
    for (const url of f.uris) assert.equal(url.searchParams.get('vault'), '知识库');
    for (const flag of ['overwrite', 'append', 'prepend']) {
      assert.equal(f.uris[1].searchParams.get(flag), behavior === flag ? 'true' : null);
    }
    assert.equal(f.input.saveControl.disabled, false);
  });
}

for (const behavior of ['append-daily', 'prepend-daily']) {
  test(`${behavior} writes Canvas beside resolved daily Markdown and preserves operation`, async () => {
    const f = fixture({ behavior });
    await f.run();
    assert.deepEqual(f.requests.map(r => r.method), ['GET', 'PUT', 'PATCH']);
    assert.equal(f.requests[1].url, 'http://127.0.0.1:27123/vault/Diary/2026-08-31.canvas');
    assert.equal(f.requests[2].url, 'http://127.0.0.1:27123/vault/Diary/2026-08-31.md');
    const patch = JSON.parse(f.requests[2].body);
    assert.equal(patch.operation, behavior === 'append-daily' ? 'append' : 'prepend');
    assert.equal(patch.rejectIfContentPreexists, true);
    assert.ok(patch.content.includes('[思维导图](<2026-08-31.canvas>)'));
    assert.equal(f.uris.length, 0);
  });
}

for (const behavior of ['create', 'append-daily']) {
  test(`${behavior} retries only missing Markdown without repeating AI after partial save`, async () => {
    let fail = true;
    const f = fixture({ behavior, failWrite: file => fail && !file.endsWith('.canvas') });
    await assert.rejects(f.run(), /Markdown.*failed/);
    assert.equal(f.context.pendingArticleLearningSave.completed.canvas, true);
    assert.equal(f.context.pendingArticleLearningSave.completed.markdown, false);
    assert.equal(f.stats.length, 0);
    assert.equal(f.closes, 0);
    assert.equal(f.input.saveControl.disabled, false);
    fail = false;
    await f.run();
    assert.equal(f.analyses.length, 1);
    const canvasWrites = behavior === 'create'
      ? f.uris.filter(u => u.searchParams.get('file').endsWith('.canvas'))
      : f.requests.filter(r => r.method === 'PUT');
    assert.equal(canvasWrites.length, 1);
    assert.equal(f.context.pendingArticleLearningSave, null);
    assert.equal(f.stats.length, 1);
    assert.equal(f.closes, 1);
  });
}

test('Canvas rejection never dispatches Markdown or reports completion', async () => {
  const f = fixture({ failWrite: file => file.endsWith('.canvas') });
  await assert.rejects(f.run(), /write rejected/);
  assert.equal(f.uris.length, 1);
  assert.equal(f.stats.length, 0);
  assert.equal(f.closes, 0);
  assert.equal(f.context.pendingArticleLearningSave.completed.canvas, false);
  assert.equal(f.errors.length, 1);
});

test('AI failure creates neither file and releases the save control', async () => {
  const f = fixture({ aiFailure: true });
  await assert.rejects(f.run(), /Analysis unavailable/);
  assert.equal(f.uris.length, 0);
  assert.equal(f.stats.length, 0);
  assert.equal(f.closes, 0);
  assert.equal(f.input.saveControl.disabled, false);
});

test('clipboard failure falls back to URI content for the complete article', async () => {
  const f = fixture({ clipboard: true });
  await f.run();
  assert.equal(f.uris.length, 2);
  assert.ok(f.uris[1].searchParams.get('content').includes('原文内容'));
  assert.ok(f.uris[1].searchParams.get('content').includes('[思维导图](<%E4%B8%AD%E6%96%87%E6%96%87%E7%AB%A0.canvas>)'));
});

test('concurrent clicks reuse one analysis and save, then release the control', async () => {
  const f = fixture();
  const first = f.run(), second = f.run();
  assert.equal(first, second);
  assert.equal(f.input.saveControl.disabled, true);
  await Promise.all([first, second]);
  assert.equal(f.analyses.length, 1);
  assert.equal(f.uris.length, 2);
  assert.equal(f.stats.length, 1);
  assert.equal(f.input.saveControl.disabled, false);
});

test('daily Canvas HTTP failure leaves both completion flags false and never patches Markdown', async () => {
  const f = fixture({ behavior: 'append-daily', failWrite: file => file.endsWith('.canvas') });
  await assert.rejects(f.run(), /HTTP 503/);
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'PUT']);
  assert.equal(f.context.pendingArticleLearningSave.completed.canvas, false);
  assert.equal(f.context.pendingArticleLearningSave.completed.markdown, false);
  assert.equal(f.stats.length, 0);
  assert.equal(f.closes, 0);
});

test('daily missing REST configuration fails before AI or writes instead of guessing a path', async () => {
  const f = fixture({ behavior: 'append-daily' });
  f.settings.obsidianApiKey = '';
  await assert.rejects(f.run(), /configuration invalid/);
  assert.equal(f.analyses.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.uris.length, 0);
  assert.equal(f.closes, 0);
});

test('editing the article after a partial save invalidates the prepared pair', async () => {
  let fail = true;
  const f = fixture({ failWrite: file => fail && !file.endsWith('.canvas') });
  await assert.rejects(f.run(), /Markdown.*failed/);
  f.input.noteContentField.value = '\n## 更新原文\n新的正文';
  fail = false;
  await f.run();
  assert.equal(f.analyses.length, 2);
  assert.equal(f.analyses[1].payload.document.mainContent, '## 更新原文\n新的正文');
  assert.equal(f.uris.filter(u => u.searchParams.get('file').endsWith('.canvas')).length, 2);
  assert.ok(f.uris.at(-1).searchParams.get('content').includes('新的正文'));
  assert.equal(f.stats.length, 1);
});

test('changing destination after a partial save writes a fresh pair with the new Canvas link', async () => {
  let fail = true;
  const f = fixture({ failWrite: file => fail && !file.endsWith('.canvas') });
  await assert.rejects(f.run(), /Markdown.*failed/);
  f.input.noteNameField.value = '更新标题.md';
  f.input.pathField.value = '其他文章';
  fail = false;
  await f.run();
  assert.equal(f.uris[2].searchParams.get('file'), '其他文章/更新标题.canvas');
  const markdown = f.uris[3].searchParams.get('content');
  assert.ok(markdown.includes('[思维导图](<%E6%9B%B4%E6%96%B0%E6%A0%87%E9%A2%98.canvas>)'));
  assert.ok(!markdown.includes('[思维导图](<%E4%B8%AD%E6%96%87%E6%96%87%E7%AB%A0.canvas>)'));
});


test('article Canvas link encodes the actual sanitized basename without exposing special directory syntax', async () => {
  const f = fixture({ name: '笔记 [草稿] # | (版本 1).md' });
  f.input.pathField.value = '资料 [项目] # | 空格';
  await f.run();
  const canvasPath = f.uris[0].searchParams.get('file');
  assert.equal(canvasPath, '资料 [项目] # | 空格/笔记 草稿   (版本 1).canvas');
  const markdown = f.uris[1].searchParams.get('content');
  const href = markdown.match(/\[思维导图\]\(<([^>]+)>\)/)?.[1];
  assert.equal(href, '%E7%AC%94%E8%AE%B0%20%E8%8D%89%E7%A8%BF%20%20%20(%E7%89%88%E6%9C%AC%201).canvas');
  assert.equal('资料 [项目] # | 空格/' + decodeURIComponent(href), canvasPath);
  assert.ok(!markdown.includes('[[资料'));
});

function addGrowth(f, reportText = '# 中文成长报告\n\n## 行动计划\n明天实践。') {
  let calls = 0, current = true, saving = false;
  f.context.WEB_GROWTH_EXPORT = fs.existsSync(path.join(__dirname, '../web/growth-export.js')) ? require('../web/growth-export.js') : undefined;
  f.context.crypto = require('node:crypto').webcrypto;
  f.context.TextEncoder = TextEncoder;
  f.context.AbortController = AbortController;
  f.context.setTimeout = setTimeout; f.context.clearTimeout = clearTimeout;
  f.input.growth = {
    getContext: () => ({ videoId: 'https://example.com/article', url: 'https://example.com/article', title: '中文文章', transcript: '文章原文' }),
    isBusy: () => false, setSaving: value => { saving = value; }, captureGuard: () => () => current,
    prepareReport: async () => { calls++; return reportText ? { key: reportText, revision: 1, markdown: reportText } : null; },
    cancelPending: async () => {}, onInvalidate: () => () => {},
  };
  return { get calls() { return calls; }, get saving() { return saving; }, invalidate() { current = false; } };
}
test('article completed conversation saves linked report with original note and Canvas', async () => {
  const f = fixture(); const g = addGrowth(f);
  await f.run();
  assert.equal(g.calls, 1);
  assert.equal(f.uris.length, 3);
  assert.equal(f.uris[2].searchParams.get('file'), '文章/中文文章 - 对话报告.md');
  assert.match(f.uris[2].searchParams.get('content'), /行动计划/);
  assert.match(f.uris[1].searchParams.get('content'), /成长对话报告/);
  assert.equal(g.saving, false);
});
test('article report failure retries only the report and does not duplicate appended Markdown', async () => {
  let fail = true;
  const f = fixture({ behavior: 'append', failWrite: file => fail && file.includes('对话报告') }); addGrowth(f);
  await assert.rejects(f.run(), /报告/);
  assert.equal(f.stats.length, 0); assert.equal(f.closes, 0);
  fail = false; await f.run();
  assert.equal(f.uris.filter(u => u.searchParams.get('file') === '文章/中文文章.md').length, 1);
  assert.equal(f.analyses.length, 1);
  assert.equal(f.stats.length, 1);
});
test('daily article report is independent per source URL and located beside the daily note', async () => {
  const f = fixture({ behavior: 'append-daily' }); addGrowth(f);
  await f.run();
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'PUT', 'PATCH', 'PUT']);
  const reportURL = decodeURIComponent(f.requests[3].url);
  assert.match(reportURL, /\/Diary\/2026-08-31 - .+ - 对话报告.md$/);
  assert.match(f.requests[3].body, /行动计划/);
});
test('article with no completed dialogue still saves exactly two artifacts', async () => {
  const f = fixture(); addGrowth(f, null);
  await f.run();
  assert.equal(f.uris.length, 2);
  assert.doesNotMatch(f.uris[1].searchParams.get('content'), /成长对话报告/);
});
test('article report generation failure writes nothing and releases save controls', async () => {
  const f = fixture(); const g = addGrowth(f);
  f.input.growth.prepareReport = async () => { throw new Error('报告生成失败'); };
  await assert.rejects(f.run(), /报告生成失败/);
  assert.equal(f.uris.length, 0); assert.equal(f.analyses.length, 0);
  assert.equal(f.input.saveControl.disabled, false); assert.equal(g.saving, false);
});
test('article switching while report loads prevents any stale artifact write', async () => {
  const f = fixture(); const g = addGrowth(f);
  f.input.growth.prepareReport = async () => { g.invalidate(); return { markdown: '旧报告', key: 'old' }; };
  await assert.rejects(f.run(), /切换|取消/);
  assert.equal(f.uris.length, 0); assert.equal(f.closes, 0);
});
