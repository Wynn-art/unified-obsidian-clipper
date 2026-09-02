// Loaded only by the local QA server. Real controller/service, synthetic model and REST.
(() => {
  const prior = chrome.runtime.sendMessage;
  const report = { summary: '将视频方法用于每周两小时的实践。', insights: ['先带着真实问题学习，再用产出验证理解。'],
    actions: [{ priority: '高', action: '挑选一个工作问题并实践视频中的方法', deliverable: '一页实践记录', timeframe: '本周两次各30分钟', successCriterion: '完成一次实践并记录结果', obstacle: '范围过大', alternative: '只验证其中一个步骤' }], questions: ['下周需要调整哪个步骤？'] };
  const service = YTD_GROWTH_SERVICE.create({ core: BILI_GROWTH_CORE, storagePrefix: 'bili_growth_v1_', storage: chrome.storage.local,
    complete: async ({ responseFormat }) => responseFormat ? JSON.stringify(report) : '视频在 [0:12] 建议先记录问题，再阅读原文。你可以本周安排两次各30分钟实践，产出一页记录，再根据结果调整。' });
  let writes = 0;
  chrome.runtime.sendMessage = async (message, callback) => {
    if (message.action?.startsWith('bili-growth:')) {
      let value;
      try {
        switch (message.action) {
          case 'bili-growth:get': value = await service.get(message.videoId); break;
          case 'bili-growth:send': value = await service.send(message.context, message.question); break;
          case 'bili-growth:report': value = await service.prepareReport(message.context, message.expectedRevision); break;
          case 'bili-growth:import': value = await service.importSource(message.videoId, message.source); break;
          case 'bili-growth:remove': value = await service.removeSource(message.videoId, message.sourceId); break;
          case 'bili-growth:clear': value = await service.clear(message.videoId); break;
          case 'bili-growth:cancel': value = await service.cancel(message.videoId); break;
        }
        const result = { success: true, value }; callback?.(result); return result;
      } catch (error) { const result = { success: false, error: error.message }; callback?.(result); return result; }
    }
    if (message.type === 'write-obsidian-note') {
      document.body.dataset.fixtureBiliWrites = String(++writes);
      if (message.filepath.includes('对话报告')) document.body.dataset.fixtureBiliReport = message.content;
      else if (message.filepath.endsWith('.canvas')) document.body.dataset.fixtureBiliCanvas = message.content;
      else document.body.dataset.fixtureBiliNote = message.content;
    }
    return prior(message, callback);
  };
})();
