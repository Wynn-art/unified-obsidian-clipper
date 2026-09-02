/* Shared by the original clipper/chat and the new study panel. */
(() => {
  let activeTab;
  const refresh = () => chrome.tabs.query({ active: true, currentWindow: true })
    .then(tabs => { activeTab = tabs[0]; }).catch(() => {});
  void refresh();
  chrome.tabs.onActivated.addListener(() => { void refresh(); });
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url) void refresh(); });
  for (const button of document.querySelectorAll('[data-unified-bili-mode]')) {
    button.addEventListener('click', async () => {
      const status = document.getElementById('unifiedNavigationStatus');
      button.disabled = true;
      try {
        if (!activeTab?.id) await refresh();
        if (!activeTab?.id) throw new Error('请先打开 B 站视频。');
        const result = await chrome.runtime.sendMessage({
          type: 'unified-bili:open', tabId: activeTab.id, mode: button.dataset.unifiedBiliMode,
        });
        if (!result?.ok) throw new Error(result?.error || '打开失败，请再次点击。');
        if (location.pathname.endsWith('/popup.html')) window.close();
      } catch (error) {
        if (status) status.textContent = error.message;
      } finally { button.disabled = false; }
    });
  }
})();
