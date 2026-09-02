var BILI_GROWTH_UI = (() => {
  const core = typeof BILI_GROWTH_CORE !== 'undefined' ? BILI_GROWTH_CORE : require('./growth-core.js');
  const panel = typeof YTD_GROWTH_PANEL !== 'undefined' ? YTD_GROWTH_PANEL : require('../youtube/growth-panel.js');
  function buildContext(state) {
    if (state.view !== 'ready' || !state.bvid || !state.data?.segments?.length) return null;
    const transcript = state.data.segments.map(segment => {
      const seconds = Math.max(0, Math.floor(Number(segment.start) || 0));
      const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      return `[${timestamp}] ${segment.text || ''}`;
    }).join('\n');
    return core.normalizeContext({
      videoId: `${state.bvid}_p${state.page}`, title: `${state.data.videoInfo?.title || state.bvid} · P${state.page}`,
      url: `https://www.bilibili.com/video/${state.bvid}?p=${state.page}`, transcript,
      overview: state.analysis ? JSON.stringify(state.analysis) : '',
    });
  }
  function create({ getState, send, ...dependencies }) {
    const getContext = () => buildContext(getState());
    const controller = panel.create({ ...dependencies, core, getContext,
      send: message => send({ ...message, action: message.action.replace(/^ytd-growth:/, 'bili-growth:') }) });
    return { ...controller, getContext, sync: () => controller.syncContext(getContext()), invalidate: () => controller.syncContext(null) };
  }
  return { buildContext, create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BILI_GROWTH_UI;
