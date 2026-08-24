/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
const stageElement = document.querySelector("#stage");
const sourceElement = document.querySelector("#source");
const detailElement = document.querySelector("#detail");
async function renderStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = (await chrome.runtime.sendMessage({
        type: "core:resolve-source",
        payload: { url: tab?.url ?? "" },
    }));
    if (!response.ok || !response.value)
        throw new Error(response.error ?? "Unable to resolve the active page");
    if (stageElement)
        stageElement.textContent = response.value.stage;
    if (sourceElement)
        sourceElement.textContent = response.value.source ?? "unsupported";
    if (detailElement)
        detailElement.textContent = tab?.title ?? tab?.url ?? "No active tab";
}
void renderStatus().catch((error) => {
    if (stageElement)
        stageElement.textContent = "stage-1";
    if (sourceElement)
        sourceElement.textContent = "unsupported";
    if (detailElement)
        detailElement.textContent = error instanceof Error ? error.message : "Unable to inspect this page";
});


/******/ })()
;