(() => {
  const handlers = {
    actionOnClicked: null,
    runtimeOnInstalled: null,
    tabsOnUpdated: null,
    tabsOnActivated: null,
    runtimeOnMessage: null,
  };

  const capture = (slot) => (handler) => {
    if (typeof handler !== "function") throw new TypeError(`Invalid YouTube lifecycle handler: ${slot}`);
    if (handlers[slot]) throw new Error(`YouTube lifecycle already captured: ${slot}`);
    handlers[slot] = handler;
  };

  globalThis.YTD_LIFECYCLE = Object.freeze({
    actionOnClicked: capture("actionOnClicked"),
    runtimeOnInstalled: capture("runtimeOnInstalled"),
    tabsOnUpdated: capture("tabsOnUpdated"),
    tabsOnActivated: capture("tabsOnActivated"),
    runtimeOnMessage: capture("runtimeOnMessage"),
    getHandlers: () => Object.freeze({ ...handlers }),
  });
})();
