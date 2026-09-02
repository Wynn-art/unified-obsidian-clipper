/* Trusted article UI only; credentials remain inside the service worker. */
(() => {
  const service = YTD_GROWTH_SERVICE.create({
    core: WEB_GROWTH_CORE, storagePrefix: 'article_growth_v1_', storage: chrome.storage.local,
    complete: async ({ messages, maxTokens, signal, responseFormat }) => {
      const result = await requestAiCompletion({ messages, maxTokens, signal, responseFormat, temperature: 0.4 });
      return result.text;
    },
  });
  const pages = ['web/popup.html', 'web/side-panel.html'].map(path => chrome.runtime.getURL(path));
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (typeof message?.action !== 'string' || !message.action.startsWith('article-growth:')) return false;
    if (sender?.id !== chrome.runtime.id || !pages.includes(sender.url?.split(/[?#]/)[0])) {
      respond({ success: false, error: '没有访问文章成长对话的权限，请从文章剪藏面板操作。' }); return false;
    }
    const run = () => {
      switch (message.action) {
        case 'article-growth:get': return service.get(message.videoId);
        case 'article-growth:import': return service.importSource(message.videoId, message.source);
        case 'article-growth:remove': return service.removeSource(message.videoId, message.sourceId);
        case 'article-growth:send': return service.send(message.context, message.question);
        case 'article-growth:cancel': return service.cancel(message.videoId);
        case 'article-growth:clear': return service.clear(message.videoId);
        case 'article-growth:report': return service.prepareReport(message.context, message.expectedRevision);
        default: throw WEB_GROWTH_CORE.error('不支持的文章成长对话操作。');
      }
    };
    Promise.resolve().then(run).then(value => respond({ success: true, value }), error =>
      respond({ success: false, error: error?.growthSafe ? error.message : '文章成长对话失败，请检查 YouTube 设置中的 DeepSeek 配置后重试。' }));
    return true;
  });
})();
