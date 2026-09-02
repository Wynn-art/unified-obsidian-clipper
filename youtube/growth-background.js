/* Dedicated trusted-page adapter; model credentials never cross this boundary. */
(() => {
  const service = YTD_GROWTH_SERVICE.create({
    storage: chrome.storage.local,
    complete: async ({ messages, maxTokens, signal, responseFormat }) => {
      const result = await requestAiCompletion({ messages, maxTokens, signal, responseFormat, temperature: 0.4 });
      return result.text;
    },
  });
  const page = chrome.runtime.getURL("youtube/sidepanel.html");
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (typeof message?.action !== "string" || !message.action.startsWith("ytd-growth:")) return false;
    if (sender?.id !== chrome.runtime.id || sender.tab || sender.url?.split(/[?#]/)[0] !== page) {
      respond({ success: false, error: "没有访问成长对话的权限。请从扩展侧栏操作。" });
      return false;
    }
    const run = async () => {
      switch (message.action) {
        case "ytd-growth:get": return service.get(message.videoId);
        case "ytd-growth:import": return service.importSource(message.videoId, message.source);
        case "ytd-growth:remove": return service.removeSource(message.videoId, message.sourceId);
        case "ytd-growth:send": return service.send(message.context, message.question);
        case "ytd-growth:cancel": return service.cancel(message.videoId);
        case "ytd-growth:clear": return service.clear(message.videoId);
        case "ytd-growth:report": return service.prepareReport(message.context, message.expectedRevision);
        default: throw new Error("不支持的成长对话操作。");
      }
    };
    run().then(value => respond({ success: true, value }), error => {
      // Service errors are sanitized; do not expose provider response payloads or credentials.
      respond({ success: false, error: error?.message || "成长对话操作失败，请重试。" });
    });
    return true;
  });
})();
