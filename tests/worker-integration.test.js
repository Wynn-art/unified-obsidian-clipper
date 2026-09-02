const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function event() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), removeListener() {}, hasListener: fn => listeners.includes(fn) };
}
function storageArea(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(names.map(key => [key, data[key] ?? defaults[key]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
    async setAccessLevel() {},
  };
}
async function worker({ fetchImpl, local = {} } = {}) {
  const panelCalls = [], errors = [];
  const noOp = async () => {};
  const tabs = new Map([
    [1, { id: 1, windowId: 9, active: true, url: 'https://www.youtube.com/watch?v=abcdefghi' }],
    [2, { id: 2, windowId: 9, active: false, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }],
    [3, { id: 3, windowId: 9, active: false, url: 'https://example.com/article' }],
  ]);
  const chrome = {
    runtime: { id: 'test-extension', onInstalled: event(), onStartup: event(), onMessage: event(), onConnect: event(),
      getURL: value => `chrome-extension://test-extension/${value}`, getManifest: () => JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))), sendMessage: noOp },
    storage: { local: storageArea(local), sync: storageArea(), session: storageArea(), onChanged: event() },
    tabs: { query: async query => [...tabs.values()].filter(tab => !query?.active || tab.active), get: async id => tabs.get(id),
      onActivated: event(), onUpdated: event(), onRemoved: event(), sendMessage: async () => ({}), create: noOp },
    sidePanel: { setOptions: async options => panelCalls.push(options), setPanelBehavior: noOp, open: noOp },
    action: { onClicked: event(), setPopup: noOp, setIcon: noOp, setBadgeText: noOp, setBadgeBackgroundColor: noOp },
    commands: { onCommand: event() }, contextMenus: { onClicked: event(), removeAll: noOp, create: noOp },
    windows: { getCurrent: async () => ({ id: 9 }), getAll: async () => [{ id: 9 }] },
    permissions: { contains: async () => true },
    declarativeNetRequest: { updateSessionRules: noOp },
    i18n: { getMessage: key => key, getUILanguage: () => 'en' },
    scripting: { executeScript: async () => [] },
  };
  const context = vm.createContext({ chrome, browser: chrome, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Headers,
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
    navigator: { userAgent: 'Chrome/130.0.0.0', language: 'en-US' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: fetchImpl || (async () => { throw new Error('Network requests forbidden during worker smoke test'); }),
    structuredClone, crypto: require('node:crypto').webcrypto,
  });
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  };
  context.importScripts('background.js');
  await new Promise(resolve => setImmediate(resolve));
  async function send(message, sender = {}) {
    const responses = [];
    let resolveFirst;
    const first = new Promise(resolve => { resolveFirst = resolve; });
    for (const listener of chrome.runtime.onMessage.listeners) {
      listener(message, sender, response => { responses.push(response); resolveFirst(response); });
    }
    const result = await Promise.race([first, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`No response: ${JSON.stringify(message)}`)), 1000);
      timer.unref();
    })]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(responses.length, 1, 'only one module may answer a runtime request');
    return result;
  }
  return { context, chrome, panelCalls, errors, tabs, send };
}

test('the real combined service worker imports all modules without global collisions', async () => {
  const w = await worker();
  assert.deepEqual(w.errors, []);
  assert.ok(w.panelCalls.some(options => options.tabId === 2 && options.path === 'bilibili/sidepanel.html'));
  assert.ok(w.panelCalls.some(options => options.tabId === 3 && options.path === 'web/side-panel.html'));
  const source = await w.send({ type: 'core:resolve-source', payload: { url: 'https://www.bilibili.com/list/watchlater/?bvid=BV1xx411c7mD' } });
  assert.equal(source.value.source, 'bilibili');
});

test('YouTube, legacy Bilibili and study requests receive exactly their own responses', async () => {
  const w = await worker();
  const yt = await w.send({ action: 'checkConfig' });
  const study = await w.send({ action: 'bili-digest:checkConfig' });
  const legacy = await w.send({ type: 'get-settings' });
  assert.equal(yt.hasAiKey, false);
  assert.equal(yt.hasSupadataKey, false);
  assert.equal(study.ready, false);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.settings.noteFolder, 'Clippings/Bilibili');
  const task = await w.send({ action: 'bili-digest:startAiTask', taskId: 'study-one', kind: 'analysis', bvid: 'BV1xx411c7mD', page: 1 });
  assert.equal(task.success, true);
  await w.send({ action: 'bili-digest:cancelAiTask', taskId: 'study-one' });
});

test('opening study mode through the actual router remains selected after a tab update', async () => {
  const w = await worker();
  const opened = await w.send({ type: 'unified-bili:open', tabId: 2, mode: 'study' });
  assert.equal(opened.ok, true);
  for (const listener of w.chrome.tabs.onUpdated.listeners) listener(2, { url: w.tabs.get(2).url, status: 'complete' }, w.tabs.get(2));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.panelCalls.filter(options => options.tabId === 2).at(-1).path, 'bilibili-digest/sidepanel.html');
});

test('YouTube overview dispatch preserves description and duration argument positions', async () => {
  const w = await worker();
  vm.runInContext('handleAnalyzeTranscript = async (...args) => ({ args });', w.context);
  const result = await w.send({ action: 'analyzeTranscript', transcriptText: 'transcript', videoTitle: 'title', channelName: 'channel', videoDescription: 'description', videoDuration: 180 });
  assert.deepEqual(Array.from(result.args), ['transcript', 'title', 'channel', 'description', 180]);
});

const chineseLearningOutput = {
  summary: ['Claude 可辅助处理文本任务', '明确目标可以改善回答', '重要信息仍需人工核实'],
  trends: ['使用方式从单次提问转向持续协作', '提示词逐渐包含更多背景信息'],
  expandedKnowledge: [{ topic: '上下文信息', explanation: '模型依据所提供的信息生成回答', application: '写作前提供读者和目标' }],
  mindMap: { root: 'Claude 入门指南', branches: [
    { title: '基本操作', items: ['输入具体问题'] },
    { title: '提示方法', items: ['补充任务背景'] },
    { title: '结果核验', items: ['检查关键事实'] },
  ] },
};
const englishLearningOutput = {
  summary: ['Claude assists with text tasks', 'Clear goals improve answers', 'Verify important information'],
  trends: ['Single questions evolve into collaboration', 'Prompts include more context'],
  expandedKnowledge: [{ topic: 'Context', explanation: 'Models use supplied information', application: 'Provide an audience and goal before writing' }],
  mindMap: { root: 'Getting started with Claude', branches: [
    { title: 'Basics', items: ['Ask a specific question'] },
    { title: 'Prompting', items: ['Provide background'] },
    { title: 'Verification', items: ['Check facts'] },
  ] },
};
function learningMessage(mainContent = '[0:00] Claude assists with text tasks. [0:15] Set a clear goal and verify important information.') {
  return { type: 'learning:prepare', payload: { document: {
    sourceType: 'youtube', contentKind: 'transcript',
    title: 'The Ultimate Beginners Guide to Claude AI', author: 'Example channel',
    url: 'https://www.youtube.com/watch?v=9oJySubZRSA', description: '',
    mainContent, contentCompleteness: { transcript: true }, metadata: { videoId: '9oJySubZRSA' },
  } } };
}
async function learningWorker(respond) {
  const requests = [];
  const w = await worker({
    local: { ytd_settings: { provider: 'deepseek', aiApiKey: 'synthetic-test-key' } },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const request = JSON.parse(options.body);
      requests.push(request);
      const content = await respond(request, requests.length);
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: {
        content: typeof content === 'string' ? content : JSON.stringify(content),
      } }] }) };
    },
  });
  return { ...w, requests };
}
function assertChineseRequest(request) {
  const system = request.messages.find(message => message.role === 'system').content;
  assert.match(system, /简体中文|Simplified Chinese/i, 'the actual provider request must specify the output language');
}

test('English transcripts request Chinese learning outputs and render Chinese Markdown and Canvas', async () => {
  const w = await learningWorker(() => chineseLearningOutput);
  const result = await w.send(learningMessage());
  assert.equal(result.ok, true);
  assert.equal(w.requests.length, 1);
  assertChineseRequest(w.requests[0]);
  assert.match(result.value.markdown, /Claude 可辅助处理文本任务/);
  assert.match(result.value.markdown, /使用方式从单次提问转向持续协作/);
  assert.match(result.value.markdown, /写作前提供读者和目标/);
  assert.equal(result.value.canvas.nodes[0].text, 'Claude 入门指南');
  assert.ok(result.value.canvas.nodes.every(node => /\p{Script=Han}/u.test(node.text)));
});

test('long English transcripts keep Chinese output requirements in every chunk and synthesis request', async () => {
  const w = await learningWorker(request => {
    const system = request.messages[0].content;
    return system.includes('"facts"')
      ? { facts: ['明确目标可以改善回答'], conclusions: ['重要信息仍需核验'] }
      : chineseLearningOutput;
  });
  const result = await w.send(learningMessage('[0:00] Provide clear goals and verify important facts.\n'.repeat(2500)));
  assert.equal(result.ok, true);
  assert.ok(w.requests.length >= 3, 'must exercise chunking and synthesis');
  w.requests.forEach(assertChineseRequest);
});

test('fully English model output is corrected once before returning saveable artifacts', async () => {
  const w = await learningWorker((_request, count) => count === 1 ? englishLearningOutput : chineseLearningOutput);
  const result = await w.send(learningMessage());
  assert.equal(w.requests.length, 2);
  assert.equal(result.ok, true);
  assertChineseRequest(w.requests[1]);
  assert.equal(result.value.outputs.summary[0], 'Claude 可辅助处理文本任务');
  assert.equal(result.value.canvas.nodes[0].text, 'Claude 入门指南');
});

test('format repair also retains Chinese output requirements', async () => {
  const w = await learningWorker((_request, count) => count === 1 ? '{broken json' : chineseLearningOutput);
  const result = await w.send(learningMessage());
  assert.equal(result.ok, true);
  assert.equal(w.requests.length, 2);
  assertChineseRequest(w.requests[1]);
});

for (const [field, mutate] of [
  ['summary', value => { value.summary[0] = 'Claude assists with text tasks'; }],
  ['trends', value => { value.trends[0] = 'Prompts include more context'; }],
  ['topic', value => { value.expandedKnowledge[0].topic = 'Context'; }],
  ['explanation', value => { value.expandedKnowledge[0].explanation = 'Models use supplied information'; }],
  ['application', value => { value.expandedKnowledge[0].application = 'Provide an audience and goal'; }],
  ['root', value => { value.mindMap.root = 'Getting started with Claude'; }],
  ['branch', value => { value.mindMap.branches[0].title = 'Basics'; }],
  ['child', value => { value.mindMap.branches[0].items[0] = 'Ask a specific question'; }],
]) {
  test(`an English ${field} cannot bypass language validation or cause unlimited retries`, async () => {
    const mixed = structuredClone(chineseLearningOutput);
    mutate(mixed);
    const w = await learningWorker(() => mixed);
    const result = await w.send(learningMessage());
    assert.equal(result.ok, false);
    assert.equal(result.value, undefined, 'failed language validation must not produce saveable artifacts');
    assert.match(result.error, /中文/);
    assert.equal(w.requests.length, 2, 'at most one correction call');
  });
}

async function saveFromPanel(w, { onLearningPrepared } = {}) {
  const writes = [];
  const elements = { syncObsidianBtn: { disabled: false }, obsidianSyncStatus: { textContent: '' }, resultsState: { style: { display: 'block' } } };
  const paths = { markdownPath: 'YouTube/The Ultimate Beginners Guide to Claude AI - 9oJySubZRSA.md',
    canvasPath: 'YouTube/The Ultimate Beginners Guide to Claude AI - 9oJySubZRSA.canvas' };
  const context = vm.createContext({
    console, URL, setTimeout, clearTimeout,
    window: { confirm: () => true },
    document: { addEventListener() {}, getElementById: id => elements[id] },
    chrome: { ...w.chrome, runtime: { onMessage: event(), sendMessage: async message => {
      if (message.action === 'resolveLearningObsidianTarget') return { success: true, ...paths };
      if (message.action === 'syncToObsidian') {
        writes.push(message);
        return { success: true, ...paths, files: { markdown: true, canvas: true } };
      }
      const result = await w.send(message);
      if (message.type === 'learning:prepare') onLearningPrepared?.(context);
      return result;
    } } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'youtube/sidepanel.js'), 'utf8'), context);
  vm.runInContext(`
    currentVideoId = '9oJySubZRSA';
    currentVideoTitle = 'The Ultimate Beginners Guide to Claude AI';
    currentTranscript = [{ start: 0, duration: 15, text: 'Claude assists with text tasks. Set clear goals and verify important information.' }];
    for (const segment of getActiveTranscriptSegments()) {
      transcriptParagraphCache.set(transcriptTranslationCacheKey(segment), 'Claude 可以辅助文本任务。请明确目标并核实重要信息。');
    }
  `, context);
  await vm.runInContext('syncCurrentVideoToObsidian()', context);
  return { writes, elements, paths };
}

test('the actual YouTube save flow never writes rejected English learning results', async () => {
  const w = await learningWorker(() => englishLearningOutput);
  const { writes, elements } = await saveFromPanel(w);
  assert.equal(w.requests.length, 2);
  assert.equal(writes.length, 0);
  assert.match(elements.obsidianSyncStatus.textContent, /中文/);
  assert.equal(elements.syncObsidianBtn.disabled, false);
});

test('the actual YouTube save flow writes corrected Chinese artifacts and preserves original filename', async () => {
  const w = await learningWorker((_request, count) => count === 1 ? englishLearningOutput : chineseLearningOutput);
  const { writes, elements, paths } = await saveFromPanel(w);
  assert.equal(writes.length, 1);
  assert.match(writes[0].markdown, /明确目标可以改善回答/);
  assert.equal(writes[0].canvas.nodes[0].text, 'Claude 入门指南');
  assert.equal(writes[0].expectedPaths.markdownPath, paths.markdownPath);
  assert.match(elements.obsidianSyncStatus.textContent, /已保存/);
  assert.ok(elements.obsidianSyncStatus.textContent.includes(paths.canvasPath));
  assert.equal(elements.syncObsidianBtn.disabled, false);
});

for (const term of ['Claude', 'API', 'Claude Projects', 'GPT-4o', 'iPhone', 'xAI']) {
  test(`Chinese learning notes with the source term ${term} can be saved without another AI call`, async () => {
    const outputs = structuredClone(chineseLearningOutput);
    outputs.expandedKnowledge[0].topic = term;
    outputs.mindMap.root = term;
    outputs.mindMap.branches[0].title = term;
    outputs.mindMap.branches[0].items[0] = term;
    const w = await learningWorker(() => outputs);
    const result = await w.send(learningMessage(`[0:00] We explain ${term} and how to use it.`));
    assert.equal(result.ok, true);
    assert.equal(w.requests.length, 1, 'proper names must not cause a paid repair call');
    assert.equal(result.value.outputs.expandedKnowledge[0].topic, term);
    assert.equal(result.value.canvas.nodes[0].text, term);
  });
}

test('numeric and URL mind-map labels do not block Chinese prose', async () => {
  const outputs = structuredClone(chineseLearningOutput);
  outputs.mindMap.branches[0].items = ['3.5', 'https://claude.ai'];
  const w = await learningWorker(() => outputs);
  const result = await w.send(learningMessage());
  assert.equal(result.ok, true);
  assert.equal(w.requests.length, 1);
});

test('language correction identifies the untranslated field instead of asking for an untargeted rewrite', async () => {
  const mixed = structuredClone(chineseLearningOutput);
  mixed.trends[1] = 'Prompts include more context';
  const w = await learningWorker((_request, count) => count === 1 ? mixed : chineseLearningOutput);
  const result = await w.send(learningMessage());
  assert.equal(result.ok, true);
  assert.equal(w.requests.length, 2);
  assert.ok(w.requests[1].messages.some(message => message.content.includes('trends[1]')));
});

test('failed language correction reports the affected section without including model text', async () => {
  const mixed = structuredClone(chineseLearningOutput);
  mixed.expandedKnowledge[0].explanation = 'Untranslated private example text';
  const w = await learningWorker(() => mixed);
  const result = await w.send(learningMessage());
  assert.equal(result.ok, false);
  assert.match(result.error, /扩展知识第1条解释/);
  assert.doesNotMatch(result.error, /private example/);
});

test('capitalized English sentences cannot pass as source names', async () => {
  const outputs = structuredClone(chineseLearningOutput);
  outputs.summary[0] = 'Claude';
  outputs.trends[0] = 'API';
  outputs.mindMap.branches[0].items[0] = 'Ask a specific question';
  const w = await learningWorker(() => outputs);
  const result = await w.send(learningMessage('[0:00] Claude API. Ask a specific question.'));
  assert.equal(result.ok, false);
  assert.equal(w.requests.length, 2);
});

test('the YouTube save button writes a Chinese note containing a Claude label without paid correction', async () => {
  const outputs = structuredClone(chineseLearningOutput);
  outputs.mindMap.branches[0].title = 'Claude';
  const w = await learningWorker(() => outputs);
  const { writes, elements } = await saveFromPanel(w);
  assert.equal(w.requests.length, 1);
  assert.equal(writes.length, 1);
  assert.match(elements.obsidianSyncStatus.textContent, /已保存/);
  assert.ok(writes[0].canvas.nodes.some(node => node.text === 'Claude'));
});

for (const title of ['Getting Started', 'Set Clear Goals']) {
  test(`ordinary English heading ${title} is translated rather than exempted as a name`, async () => {
    const outputs = structuredClone(chineseLearningOutput);
    outputs.mindMap.branches[0].title = title;
    const w = await learningWorker(() => outputs);
    const result = await w.send(learningMessage(`[0:00] ${title}. Claude assists with writing.`));
    assert.equal(result.ok, false);
    assert.match(result.error, /脑图第1个分支标题/);
    assert.equal(w.requests.length, 2);
  });
}

test('technical labels next to Chinese characters are recognized in source text', async () => {
  const outputs = structuredClone(chineseLearningOutput);
  outputs.mindMap.branches[0].title = 'API';
  const w = await learningWorker(() => outputs);
  const result = await w.send(learningMessage('[0:00] 可以使用API连接服务。'));
  assert.equal(result.ok, true);
  assert.equal(w.requests.length, 1);
});

const growthSender = { id: 'test-extension', url: 'chrome-extension://test-extension/youtube/sidepanel.html' };
const biliGrowthSender = { id: 'test-extension', url: 'chrome-extension://test-extension/bilibili-digest/sidepanel.html' };
test('B study mindmap uses its own model configuration with the shared Chinese learning renderer', async () => {
  const requests = [];
  const w = await worker({ local: { bili_digest_settings: { presetId: 'custom', protocol: 'openai', aiBaseUrl: 'https://bili-study.example/v1', aiApiKey: 'study-only-key', aiModel: 'study-model' } },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://bili-study.example/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer study-only-key');
      requests.push(JSON.parse(options.body));
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(chineseLearningOutput) } }] }) };
    },
  });
  const message = learningMessage();
  message.payload.document.sourceType = 'bilibili';
  message.payload.document.url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2';
  message.payload.document.metadata = { bvid: 'BV1xx411c7mD', page: 2, learningMode: 'bili-study' };
  const result = await w.send(message, biliGrowthSender);
  assert.equal(result.ok, true, result.error);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'study-model');
  assertChineseRequest(requests[0]);
  assert.equal(result.value.canvas.nodes[0].text, 'Claude 入门指南');
  assert.ok(result.value.canvas.edges.length > 0);
});

test('Bilibili growth routes use study model settings and never YouTube credentials', async () => {
  const requests = [];
  const report = { summary: '明确目标', insights: ['小步练习'], actions: [{ priority: '高', action: '练习', deliverable: '记录', timeframe: '明天', successCriterion: '完成一次', obstacle: '忘记', alternative: '提醒' }], questions: ['效果如何？'] };
  const w = await worker({ local: {
    ytd_settings: { provider: 'deepseek', aiApiKey: 'unrelated-youtube-key' },
    bili_digest_settings: { presetId: 'custom', protocol: 'openai', aiBaseUrl: 'https://bili-model.example/v1', aiApiKey: 'bili-synthetic-key', aiModel: 'bili-model' },
  }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://bili-model.example/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer bili-synthetic-key');
    const request = JSON.parse(options.body); requests.push(request);
    assert.equal(request.model, 'bili-model');
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: requests.length === 1 ? '先做一次实践。' : JSON.stringify(report) } }] }) };
  } });
  const context = { videoId: 'BV1xx411c7mD_p2', title: '学习视频 P2', url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2', transcript: '[0:00] 开始学习。' };
  const message = { action: 'bili-growth:send', context, question: '明天如何开始？' };
  for (const sender of [growthSender, { ...biliGrowthSender, tab: { id: 1 } }, { ...biliGrowthSender, id: 'other-extension' }]) {
    const denied = await w.send(message, sender);
    assert.equal(denied.success, false); assert.match(denied.error, /权限/);
  }
  assert.equal(requests.length, 0);
  const sent = await w.send(message, biliGrowthSender);
  assert.equal(sent.success, true, sent.error);
  assert.equal(sent.value.turns[0].assistant, '先做一次实践。');
  const generated = await w.send({ action: 'bili-growth:report', context }, biliGrowthSender);
  assert.equal(generated.success, true, generated.error);
  assert.match(generated.value.markdown, /bilibili.com\/video\/BV1xx411c7mD\?p=2/);
  assert.match(generated.value.markdown, /明天如何开始？/);
  assertChineseRequest(requests[1]);
  assert.equal(requests[1].response_format.type, 'json_object');
  const otherPart = await w.send({ action: 'bili-growth:get', videoId: 'BV1xx411c7mD_p1' }, biliGrowthSender);
  assert.equal(otherPart.value.turns.length, 0);
  const youtube = await w.send({ action: 'ytd-growth:get', videoId: context.videoId }, growthSender);
  assert.equal(youtube.value.turns.length, 0);
});

test('growth chat and cached report use the configured provider through the real worker adapter', async () => {
  const report = { summary: '明确练习目标', insights: ['先做一个小实验'], actions: [{ priority: '高', action: '安排练习', deliverable: '练习记录', timeframe: '明天', successCriterion: '完成十分钟', obstacle: '忘记', alternative: '设置提醒' }], questions: ['练习是否可持续？'] };
  const w = await learningWorker((_request, count) => count === 1 ? '从每天十分钟开始，记录一次实践。' : report);
  const context = { videoId: '9oJySubZRSA', title: '学习方法', url: 'https://www.youtube.com/watch?v=9oJySubZRSA', transcript: '[0:00] 建议每天练习十分钟。' };
  const sent = await w.send({ action: 'ytd-growth:send', context, question: '明天如何开始？' }, growthSender);
  assert.equal(sent.success, true);
  assert.equal(sent.value.turns.length, 1);
  assertChineseRequest(w.requests[0]);
  const generated = await w.send({ action: 'ytd-growth:report', context }, growthSender);
  assert.equal(generated.success, true);
  assert.match(generated.value.markdown, /行动计划/);
  assert.match(generated.value.markdown, /明天如何开始？/);
  assert.equal(w.requests[1].response_format.type, 'json_object');
  assertChineseRequest(w.requests[1]);
  const cached = await w.send({ action: 'ytd-growth:report', context }, growthSender);
  assert.equal(cached.value.markdown, generated.value.markdown);
  assert.equal(w.requests.length, 2);
});

test('growth chat namespace is answered once and rejects web content scripts', async () => {
  const w = await worker();
  const result = await w.send({ action: 'ytd-growth:get', videoId: '9oJySubZRSA' }, growthSender);
  assert.equal(result.success, true);
  assert.equal(result.value.turns.length, 0);
  const denied = await w.send({ action: 'ytd-growth:clear', videoId: '9oJySubZRSA' }, {
    id: 'test-extension', tab: { id: 1 }, url: 'https://www.youtube.com/watch?v=9oJySubZRSA',
  });
  assert.equal(denied.success, false);
  assert.match(denied.error, /权限/);
});

test('growth empty report and imported materials never call a model before actual dialogue', async () => {
  const w = await worker();
  const context = { videoId: '9oJySubZRSA', title: 'Claude', url: 'https://www.youtube.com/watch?v=9oJySubZRSA', transcript: '[0:00] Test transcript' };
  const imported = await w.send({ action: 'ytd-growth:import', videoId: context.videoId, source: { title: 'Gemini 图片分析', text: '用户粘贴的分析结果' } }, growthSender);
  assert.equal(imported.success, true);
  assert.equal(imported.value.sources.length, 1);
  const result = await w.send({ action: 'ytd-growth:report', context }, growthSender);
  assert.equal(result.success, true);
  assert.equal(result.value, null);
});

async function obsidianWorker(failKind = '') {
  const writes = [];
  const w = await worker({ local: { ytd_settings: { obsidian: { apiKey: 'synthetic-obsidian', folder: 'YouTube' } } },
    fetchImpl: async (url, options) => {
      writes.push({ url: decodeURIComponent(url), ...options });
      const kind = url.endsWith('.canvas') ? 'canvas' : decodeURIComponent(url).includes('对话报告') ? 'report' : 'markdown';
      return { ok: kind !== failKind, status: kind === failKind ? 500 : 200 };
    },
  });
  return { ...w, writes };
}
function obsidianSaveMessage(report) {
  return { action: 'syncToObsidian', metadata: { videoId: '9oJySubZRSA', title: 'Example (video)', url: 'https://www.youtube.com/watch?v=9oJySubZRSA' },
    segments: [{ start: 0, text: 'Original', translation: '译文' }], markdown: '## 核心总结\n中文摘要', canvas: { nodes: [], edges: [] },
    conversationReport: report };
}

test('Obsidian no-dialogue save remains exactly two writes and has no report link', async () => {
  const w = await obsidianWorker();
  const result = await w.send(obsidianSaveMessage(null));
  assert.equal(result.success, true);
  assert.equal(w.writes.length, 2);
  assert.doesNotMatch(w.writes[0].body, /成长对话报告/);
});

test('Obsidian saves a third report and includes a same-folder link in the main note', async () => {
  const w = await obsidianWorker();
  const result = await w.send(obsidianSaveMessage('# 成长报告\n\n## 行动计划\n- 实践一次'));
  assert.equal(result.success, true);
  assert.equal(result.files.report, true);
  assert.equal(w.writes.length, 3);
  assert.match(w.writes[0].body, /成长对话报告/);
  assert.match(w.writes[2].url, / - 对话报告\.md$/);
  assert.equal(w.writes[2].body, '# 成长报告\n\n## 行动计划\n- 实践一次');
});

test('report write failure reports partial success; retry only writes the report', async () => {
  const w = await obsidianWorker('report');
  const request = obsidianSaveMessage('# 成长报告');
  const result = await w.send(request);
  assert.equal(result.success, false);
  assert.equal(result.files.markdown, true);
  assert.equal(result.files.canvas, true);
  assert.equal(result.files.report, false);
  assert.match(result.error, /报告/);
  w.writes.length = 0;
  await w.send({ ...request, artifacts: { markdown: false, canvas: false, report: true } });
  assert.equal(w.writes.length, 1);
  assert.match(w.writes[0].url, /对话报告/);
});

test('invalid report data fails before any Obsidian file is written', async () => {
  const w = await obsidianWorker();
  const result = await w.send(obsidianSaveMessage({ content: 'invalid type' }));
  assert.equal(result.success, false);
  assert.equal(w.writes.length, 0);
});

test('leaving a video while learning artifacts generate cancels the pending save before any write', async () => {
  const w = await learningWorker(() => chineseLearningOutput);
  const { writes, elements } = await saveFromPanel(w, { onLearningPrepared: context => {
    vm.runInContext("currentVideoId = 'newvideo123';", context);
  } });
  assert.equal(writes.length, 0);
  assert.match(elements.obsidianSyncStatus.textContent, /切换|取消/);
});

test('article growth worker allows only its extension pages and uses existing YouTube model', async () => {
  assert.ok(fs.readFileSync(path.join(root, 'background.js'), 'utf8').includes('web/growth-background.js'), 'worker must install the article growth adapter');
  const calls = [];
  const w = await worker({ fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '可以先用文章的方法实践一次。' } }] }) };
  }, local: { ytd_settings: { provider: 'deepseek', aiApiKey: 'article-fixture-key' } } });
  const id = 'https://example.com/article';
  const message = { action: 'article-growth:get', videoId: id };
  for (const sender of [{}, { id: 'test-extension', url: 'https://example.com/article' }, { id: 'test-extension', url: w.chrome.runtime.getURL('youtube/sidepanel.html') }, { id: 'foreign', url: w.chrome.runtime.getURL('web/popup.html') }]) {
    const result = await w.send(message, sender);
    assert.equal(result.success, false);
  }
  for (const page of ['web/popup.html', 'web/side-panel.html']) {
    const result = await w.send(message, { id: 'test-extension', url: w.chrome.runtime.getURL(page) });
    assert.equal(result.success, true);
    assert.equal(result.value.turns.length, 0);
  }
  const result = await w.send({ action: 'article-growth:send', context: { videoId: id, url: id, title: '文章', transcript: '正文原文' }, question: '怎样实践？' }, { id: 'test-extension', url: w.chrome.runtime.getURL('web/side-panel.html') });
  assert.equal(result.success, true, result.error);
  assert.match(calls[0].body.messages[0].content, /文章正文/);
  assert.equal(result.value.turns.length, 1);
});
