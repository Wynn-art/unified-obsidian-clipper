(() => {
  const handlers = {
    runtimeOnInstalled: null,
    runtimeOnMessage: null,
    runtimeOnConnect: null,
  };
  const capture = (slot) => (handler) => {
    if (typeof handler !== "function") throw new TypeError(`Invalid Bilibili lifecycle handler: ${slot}`);
    if (handlers[slot]) throw new Error(`Bilibili lifecycle already captured: ${slot}`);
    handlers[slot] = handler;
  };
  globalThis.BOC_LIFECYCLE = Object.freeze({
    runtimeOnInstalled: capture("runtimeOnInstalled"),
    runtimeOnMessage: capture("runtimeOnMessage"),
    runtimeOnConnect: capture("runtimeOnConnect"),
    getHandlers: () => Object.freeze({ ...handlers }),
  });
})();
