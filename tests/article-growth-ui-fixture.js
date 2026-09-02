// Browser QA only: real article popup and growth service, synthetic data and no external requests.
(() => {
  const original = chrome.runtime.sendMessage, localFetch = window.fixtureLocalFetch;
  const event = { addListener() {}, removeListener() {} };
  const article = { id: 7, windowId: 9, active: true, url: 'https://example.com/learning', title: '如何把阅读变成行动' };
  const content = '<article><h1>如何把阅读变成行动</h1><p>先提出具体的问题，再阅读材料。每周安排两次三十分钟，完成一个小实验。</p><p>记录可观察的变化，然后复盘调整下一步。</p></article>';
  const report = { summary: '把文章方法转化为每周能完成的小实验。', insights: ['用一次实践验证理解。'], actions: [{ priority: '高', action: '选择一个真实问题并实践文章中的方法', deliverable: '一页实践记录', timeframe: '未来七天，两次三十分钟', successCriterion: '完成实验并写出结果', obstacle: '任务范围太大', alternative: '只验证一个步骤' }], questions: ['下周如何调整？'] };
  const service = YTD_GROWTH_SERVICE.create({ core: WEB_GROWTH_CORE, storage: chrome.storage.local, storagePrefix: 'article_growth_v1_', complete: async ({ responseFormat }) => responseFormat ? JSON.stringify(report) : '文章建议从一个具体问题开始。你可以本周安排两次三十分钟，实践一个方法，产出一页记录，再复盘可观察的变化。' });
  chrome.tabs.query = async () => [article];
  chrome.tabs.get = async () => article;
  chrome.runtime.getManifest = () => ({ version: '0.5.0' });
  chrome.runtime.connect = () => ({ onMessage: event, onDisconnect: event, postMessage() {}, disconnect() {} });
  chrome.i18n = { getUILanguage: () => 'zh-CN', getMessage: key => key };
  chrome.storage.local.onChanged = event;
  chrome.storage.sync.onChanged = event;
  chrome.commands = { getAll: async () => [] };
  chrome.runtime.sendMessage = async message => {
    if (message.action?.startsWith('article-growth:')) {
      try {
        const id = message.videoId;
        const methods = { get: () => service.get(id), send: () => service.send(message.context, message.question), import: () => service.importSource(id, message.source), remove: () => service.removeSource(id, message.sourceId), report: () => service.prepareReport(message.context, message.expectedRevision), clear: () => service.clear(id), cancel: () => service.cancel(id) };
        return { success: true, value: await methods[message.action.split(':')[1]]() };
      } catch (e) { return { success: false, error: e.message }; }
    }
    if (message.action === 'getActiveTab') return { success: true, tabId: article.id };
    if (message.action === 'getTabInfo') return { success: true, tab: article };
    if (message.action === 'sendMessageToTab') return { success: true, content, extractedContent: content, fullHtml: content, title: article.title, author: '示例作者', description: '从阅读到实践', language: 'zh-CN', highlights: [], schemaOrgData: {}, metaTags: [] };
    if (message.action === 'openObsidianUrl') {
      let list = document.getElementById('fixtureSavedFiles');
      if (!list) { list = document.createElement('pre'); list.id = 'fixtureSavedFiles'; document.body.append(list); }
      list.textContent += new URL(message.url).searchParams.get('file') + '\n';
      return { success: true };
    }
    return original(message);
  };
  window.browser = chrome;
  window.fetch = async (url, ...args) => {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin) throw new Error('External network forbidden in fixture');
    return localFetch(url, ...args);
  };
  chrome.storage.sync.set({ general_settings: { legacyMode: true, silentOpen: true }, vaults: ['测试知识库'] });
})();
// Surface fixture failures as visible diagnostics for browser QA.
(() => {
  const originalError = console.error;
  console.error = (...args) => {
    originalError(...args);
    const show = () => { const p = document.createElement('pre'); p.className = 'fixture-error'; p.textContent = args.map(String).join(' '); document.body.append(p); };
    document.body ? show() : document.addEventListener('DOMContentLoaded', show);
  };
})();
if (new URLSearchParams(location.search).get('preview') === 'open') document.addEventListener('DOMContentLoaded', () => { document.getElementById('growthChat').open = true; });
