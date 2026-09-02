/* Loaded before popup.js, so every extraction can synchronously invalidate old context. */
(() => {
  globalThis.WEB_ARTICLE_GROWTH = WEB_GROWTH_UI.create({
    document, send: message => chrome.runtime.sendMessage(message),
    copy: text => navigator.clipboard.writeText(text), confirm: message => window.confirm(message),
  });
  window.addEventListener('pagehide', () => globalThis.WEB_ARTICLE_GROWTH.invalidate());
})();
