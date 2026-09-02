/* The unified shell, not either imported extension, owns per-tab panel paths. */
var UNIFIED_BILI_PANEL_FACTORY = (() => {
  const key = 'unified_bili_panel_modes_v1';
  const paths = { chat: 'bilibili/sidepanel.html', study: 'bilibili-digest/sidepanel.html' };
  function supported(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === 'www.bilibili.com' &&
        (parsed.pathname.startsWith('/video/') || parsed.pathname.startsWith('/list/'));
    } catch { return false; }
  }
  function createPanelController(chrome) {
    const modes = new Map(), configured = new Map(), knownTabs = new Map();
    let loading;
    const ready = () => loading ||= chrome.storage.session.get(key).then(stored => {
      for (const [tabId, mode] of Object.entries(stored[key] || {})) {
        if (paths[mode] && !modes.has(Number(tabId))) modes.set(Number(tabId), mode);
      }
    });
    const persist = () => chrome.storage.session.set({ [key]: Object.fromEntries(modes) });
    async function configure(tab) {
      if (!tab?.id || !supported(tab.url)) {
        if (tab?.id) { configured.delete(tab.id); knownTabs.delete(tab.id); }
        return false;
      }
      knownTabs.set(tab.id, tab);
      await ready();
      const path = paths[modes.get(tab.id) || 'chat'];
      if (configured.get(tab.id) !== path) {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path, enabled: true });
        configured.set(tab.id, path);
      }
      await chrome.action.setPopup({ tabId: tab.id, popup: 'bilibili/popup.html' });
      return true;
    }
    async function open(tabOrId, mode) {
      if (!paths[mode]) throw new Error('Invalid Bilibili panel mode');
      const tab = typeof tabOrId === 'object' ? tabOrId : knownTabs.get(tabOrId) || await chrome.tabs.get(tabOrId);
      if (!tab?.id || !supported(tab.url)) throw new Error('请在 B 站视频页打开学习面板。');
      knownTabs.set(tab.id, tab);
      modes.set(tab.id, mode);
      // Both API calls start in the same gesture callback; do not await storage first.
      const setting = chrome.sidePanel.setOptions({ tabId: tab.id, path: paths[mode], enabled: true });
      const opening = chrome.sidePanel.open({ tabId: tab.id });
      await Promise.all([setting, opening]);
      configured.set(tab.id, paths[mode]);
      await ready();
      await persist();
      return { ok: true };
    }
    function forget(tabId) {
      knownTabs.delete(tabId); configured.delete(tabId); modes.delete(tabId);
      return ready().then(() => { modes.delete(tabId); return persist(); });
    }
    return { configure, open, forget, supported };
  }
  return { createPanelController, supported };
})();
if (typeof module !== 'undefined') module.exports = UNIFIED_BILI_PANEL_FACTORY;
