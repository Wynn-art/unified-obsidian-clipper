// Local browser QA only. Uses the real service/controller with an in-memory model stub.
(() => {
  const originalSend = chrome.runtime.sendMessage;
  const report = { summary: '把视频里的学习方法转化为每周能完成的小实验。', insights: ['先明确问题，再阅读材料；用一次可交付的实践验证理解。'], actions: [{ priority: '高', action: '选择一个工作中真实遇到的问题，记录并尝试一种视频中的方法', deliverable: '一页问题记录和实践笔记', timeframe: '未来七天，安排两次各三十分钟', successCriterion: '完成一次实践并写出结果与待改进之处', obstacle: '任务范围太大', alternative: '只验证其中一个步骤' }], questions: ['我是否获得了可观察的变化？下一次要调整什么？'] };
  const service = YTD_GROWTH_SERVICE.create({ storage: chrome.storage.local, complete: async ({ messages }) => {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (messages[0].content.includes('生成中文成长报告')) return JSON.stringify(report);
    return '视频在 [00:12] 建议先记录问题，再阅读原文。你可以先选一个真实工作问题，本周安排两次三十分钟实践，产出一页记录。\n\n这是基于你提供的信息给出的建议，还需要结合你的时间安排验证。';
  } });
  chrome.runtime.sendMessage = async message => {
    if (!message.action?.startsWith('ytd-growth:')) {
      const result = await originalSend(message);
      if (message.action === 'syncToObsidian' && message.conversationReport) {
        document.body.dataset.fixtureGrowthSaved = 'true';
        result.files.report = true;
        result.reportPath = 'YouTube/demo - 对话报告.md';
      }
      return result;
    }
    try {
      let value;
      switch (message.action) {
        case 'ytd-growth:get': value = await service.get(message.videoId); break;
        case 'ytd-growth:send': value = await service.send(message.context, message.question); break;
        case 'ytd-growth:import': value = await service.importSource(message.videoId, message.source); break;
        case 'ytd-growth:remove': value = await service.removeSource(message.videoId, message.sourceId); break;
        case 'ytd-growth:report': value = await service.prepareReport(message.context, message.expectedRevision); break;
        case 'ytd-growth:cancel': value = await service.cancel(message.videoId); break;
        case 'ytd-growth:clear': value = await service.clear(message.videoId); break;
      }
      return { success: true, value };
    } catch (error) { return { success: false, error: error.message }; }
  };
})();
