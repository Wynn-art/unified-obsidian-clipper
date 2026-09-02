/* Isolate the imported study module's messages from YouTube and Web Clipper. */
var UNIFIED_BILI_BRIDGE = (() => {
  const prefix = 'bili-digest:';
  const encode = message => {
    if (!message || typeof message.action !== 'string') throw new TypeError('Missing study action');
    return { ...message, action: prefix + message.action };
  };
  return {
    sendMessage(message, ...args) { return chrome.runtime.sendMessage(encode(message), ...args); },
    sendTabMessage(tabId, message, ...args) { return chrome.tabs.sendMessage(tabId, encode(message), ...args); },
    onMessage(listener) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (typeof message?.action !== 'string' || !message.action.startsWith(prefix)) return false;
        return listener({ ...message, action: message.action.slice(prefix.length) }, sender, sendResponse);
      });
    },
  };
})();
