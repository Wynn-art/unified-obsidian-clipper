/* Only the trusted Bilibili study page can access this isolated conversation store. */
(() => {
  const { requestAiCompletion } = BILI_AI_TRANSPORT.createAiTransport({
    getSettings: async () => {
      const stored = await chrome.storage.local.get(BILI_SETTINGS.STORAGE_KEY);
      return BILI_SETTINGS.normalize(stored[BILI_SETTINGS.STORAGE_KEY]);
    },
    ensureHostPermission: async baseUrl => {
      const origin = BILI_SETTINGS.originOf(baseUrl);
      if (!origin || !await chrome.permissions.contains({ origins: [origin] })) {
        throw BILI_GROWTH_CORE.error('请在 B站学习设置中检查模型地址，并保存授权。');
      }
    },
    fetch: globalThis.fetch,
  });
  const service = YTD_GROWTH_SERVICE.create({
    core: BILI_GROWTH_CORE, storagePrefix: 'bili_growth_v1_', storage: chrome.storage.local,
    complete: async ({ messages, maxTokens, signal, responseFormat }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
      // Bound the whole operation, including provider fallback attempts, below the panel deadline.
      const timer = setTimeout(abort, 120000);
      try {
        return (await requestAiCompletion({ messages, maxTokens, responseFormat, signal: controller.signal, temperature: 0.4 })).text;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    },
  });
  const page = chrome.runtime.getURL('bilibili-digest/sidepanel.html');
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (typeof message?.action !== 'string' || !message.action.startsWith('bili-growth:')) return false;
    if (sender?.id !== chrome.runtime.id || sender.tab || sender.url?.split(/[?#]/)[0] !== page) {
      respond({ success: false, error: '没有访问 B站成长对话的权限，请从学习模式侧栏操作。' }); return false;
    }
    const run = () => {
      switch (message.action) {
        case 'bili-growth:get': return service.get(message.videoId);
        case 'bili-growth:import': return service.importSource(message.videoId, message.source);
        case 'bili-growth:remove': return service.removeSource(message.videoId, message.sourceId);
        case 'bili-growth:send': return service.send(message.context, message.question);
        case 'bili-growth:cancel': return service.cancel(message.videoId);
        case 'bili-growth:clear': return service.clear(message.videoId);
        case 'bili-growth:report': return service.prepareReport(message.context, message.expectedRevision);
        default: throw BILI_GROWTH_CORE.error('不支持的 B站成长对话操作。');
      }
    };
    Promise.resolve().then(run).then(value => respond({ success: true, value }), error =>
      respond({ success: false, error: error?.growthSafe ? error.message : 'B站成长对话操作失败，请检查学习模式的 AI 配置后重试。' }));
    return true;
  });
})();
