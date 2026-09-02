/* A narrow adapter between extracted article data and the shared conversation UI. */
var WEB_GROWTH_UI = (() => {
  const core = typeof WEB_GROWTH_CORE !== 'undefined' ? WEB_GROWTH_CORE : require('./growth-core.js');
  const panel = typeof YTD_GROWTH_PANEL !== 'undefined' ? YTD_GROWTH_PANEL : require('../youtube/growth-panel.js');
  function create({ document, send, copy, confirm }) {
    let context = null, refresh = 0, ready = false, saving = false;
    const invalidators = new Set();
    const controller = panel.create({ document, copy, confirm, core, subject: '文章', getContext: () => context,
      send: message => send({ ...message, action: message.action.replace(/^ytd-growth:/, 'article-growth:') }) });
    function beginRefresh() {
      refresh++; context = null; ready = false;
      document.getElementById("clip-btn").disabled = true;
      document.getElementById("articleGrowthNotice").textContent = "正在提取文章，请稍候…";
      for (const fn of invalidators) fn();
      void controller.syncContext(null);
      return refresh;
    }
    async function commitRefresh(token, article) {
      if (token !== refresh) return;
      try {
        context = core.normalizeContext({ videoId: article.url, url: article.url, title: article.title,
          transcript: article.mainContent, overview: article.description || '' });
        await controller.syncContext(context);
        if (token === refresh) {
          document.getElementById("articleGrowthNotice").textContent = `当前文章：${context.title}`;
        }
      } catch (error) {
        context = null; await controller.syncContext(null);
        if (token === refresh) document.getElementById('articleGrowthNotice').textContent = `文章对话暂不可用：${error.message} 仍可保存剪藏笔记与脑图。`;
      } finally {
        if (token === refresh) { ready = true; document.getElementById("clip-btn").disabled = saving; }
      }
    }
    return { ...controller,
      isReady: () => ready,
      notifySaved({ transport, hasReport }) {
        document.getElementById('articleGrowthNotice').textContent = transport === 'uri'
          ? `已向 Obsidian 发送笔记、脑图${hasReport ? '和成长报告' : ''}；请在知识库中确认实际文件。`
          : `已保存笔记、脑图${hasReport ? '和成长报告' : ''}到 Obsidian。`;
      },
      setSaving(value) { saving = Boolean(value); controller.setSaving(value); document.getElementById("clip-btn").disabled = saving || !ready; },
      captureGuard() {
        const version = refresh, snapshot = context, panelGuard = controller.captureGuard();
        return () => refresh === version && context === snapshot && (!snapshot || panelGuard());
      }, onInvalidate(fn) { invalidators.add(fn); return () => invalidators.delete(fn); }, beginRefresh, commitRefresh, getContext: () => context,
      isRefreshCurrent: token => token === refresh, invalidate: beginRefresh };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WEB_GROWTH_UI;
