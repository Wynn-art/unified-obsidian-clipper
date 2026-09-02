const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../youtube/growth-panel.js');
class Element {
  constructor() { this.textContent = ''; this.value = ''; this.disabled = false; this.hidden = false; this.children = []; this.listeners = {}; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  async fire(name) { return this.listeners[name]?.({ preventDefault() {}, key: '' }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
function harness(send) {
  const elements = new Map();
  const document = { getElementById: id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }, createElement: () => new Element() };
  const copies = [];
  const context = { videoId: 'video12345', title: '视频A', url: 'https://www.youtube.com/watch?v=video12345', transcript: '[0:00] 视频原文内容' };
  const panel = create({ document, send, getContext: () => context, copy: async text => copies.push(text), confirm: () => true });
  return { panel, context, copies, el: id => document.getElementById(id) };
}
const empty = id => ({ videoId: id, revision: 0, turns: [], sources: [], report: null });

test('copying client instructions is local and includes question and video context', async () => {
  const calls = [];
  const h = harness(async msg => { calls.push(msg); return { success: true, value: empty(msg.videoId) }; });
  await h.panel.syncContext(h.context);
  h.el('growthQuestion').value = '怎样用于我的学习？';
  await h.el('growthCopyClient').fire('click');
  assert.equal(h.copies.length, 1);
  assert.match(h.copies[0], /视频原文内容/);
  assert.match(h.copies[0], /怎样用于我的学习/);
  assert.equal(calls.length, 1, 'only initial get; copy must not send model/client request');
});

test('late conversation responses cannot render in a newly selected video', async () => {
  let finish;
  const h = harness(msg => msg.action === 'ytd-growth:send'
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ success: true, value: empty(msg.videoId) }));
  await h.panel.syncContext(h.context);
  h.el('growthQuestion').value = '问题A';
  const sending = h.el('growthSend').fire('click');
  await Promise.resolve();
  await h.panel.syncContext({ ...h.context, videoId: 'video67890', title: '视频B', url: 'https://www.youtube.com/watch?v=video67890' });
  finish({ success: true, value: { ...empty('video12345'), revision: 1, turns: [{ user: '问题A', assistant: '旧答案A' }] } });
  await sending;
  assert.equal(h.el('growthMessages').children.length, 0);
  assert.doesNotMatch(h.el('growthStatus').textContent, /旧答案A/);
});

test('failed sends keep the draft and release the send button for retry', async () => {
  const h = harness(async msg => msg.action === 'ytd-growth:send' ? { success: false, error: '模型暂不可用' } : { success: true, value: empty(msg.videoId) });
  await h.panel.syncContext(h.context);
  h.el('growthQuestion').value = '保留这个问题';
  await h.el('growthSend').fire('click');
  assert.equal(h.el('growthQuestion').value, '保留这个问题');
  assert.equal(h.el('growthSend').disabled, false);
  assert.match(h.el('growthStatus').textContent, /模型暂不可用/);
});

test('save preparation returns null without a report request if there are no completed turns', async () => {
  const calls = [];
  const h = harness(async msg => { calls.push(msg.action); return { success: true, value: empty(msg.videoId) }; });
  await h.panel.syncContext(h.context);
  assert.equal(await h.panel.prepareReport(h.context), null);
  assert.equal(calls.includes('ytd-growth:report'), false);
});

test('stopping while report state loads cannot start a new model request later', async () => {
  let finish, gets = 0;
  const calls = [];
  const full = { ...empty('video12345'), revision: 1, turns: [{ user: '问', assistant: '答' }] };
  const h = harness(msg => {
    calls.push(msg.action);
    if (msg.action === 'ytd-growth:get' && ++gets === 2) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ success: true, value: full });
  });
  await h.panel.syncContext(h.context);
  const generating = h.el('growthReport').fire('click');
  await h.el('growthStop').fire('click');
  finish({ success: true, value: full });
  await generating;
  assert.equal(calls.includes('ytd-growth:report'), false);
});

test('save report preparation is cancelable and rejects stale output after leaving the video', async () => {
  let finish;
  const calls = [];
  const full = { ...empty('video12345'), revision: 1, turns: [{ user: '问', assistant: '答' }] };
  const h = harness(msg => {
    calls.push(msg.action);
    if (msg.action === 'ytd-growth:report') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ success: true, value: full });
  });
  await h.panel.syncContext(h.context);
  h.panel.setSaving(true);
  const preparing = h.panel.prepareReport(h.context);
  const rejected = assert.rejects(preparing, /切换|停止|取消/);
  for (let i = 0; i < 8 && !finish; i++) await Promise.resolve();
  assert.equal(h.el('growthStop').hidden, false);
  assert.equal(h.el('growthStop').disabled, false);
  await h.panel.syncContext(null);
  finish({ success: true, value: { revision: 1, markdown: '旧视频报告' } });
  await rejected;
  assert.equal(calls.includes('ytd-growth:cancel'), true);
});
