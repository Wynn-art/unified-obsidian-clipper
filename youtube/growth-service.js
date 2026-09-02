var YTD_GROWTH_SERVICE = (() => {
  'use strict';
  const defaultCore = typeof YTD_GROWTH_CORE !== 'undefined' ? YTD_GROWTH_CORE : require('./growth-core.js');
  const clone = value => JSON.parse(JSON.stringify(value));
  function create({ storage, complete, core = defaultCore, storagePrefix = 'ytd_growth_v1_', now = () => new Date().toISOString(), makeId = () => globalThis.crypto.randomUUID() }) {
    const PREFIX = storagePrefix;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function' || typeof complete !== 'function') throw core.error('成长对话服务配置不完整。');
    const queues = new Map(), jobs = new Map();
    const empty = (videoId, revision = 0) => ({ videoId, revision, turns: [], sources: [], report: null });
    function queue(videoId, action) {
      const previous = queues.get(videoId) || Promise.resolve();
      const result = previous.then(action);
      const tail = result.catch(() => {});
      queues.set(videoId, tail);
      tail.then(() => { if (queues.get(videoId) === tail) queues.delete(videoId); });
      return result;
    }
    async function read(id, clearing = false) {
      let result;
      try { result = (await storage.get(PREFIX + id))[PREFIX + id]; } catch (_) { throw core.error('本地对话读取失败，请稍后重试。'); }
      if (result === undefined || result === null) return empty(id);
      const validRevision = Number.isSafeInteger(result.revision) && result.revision >= 0 && result.revision < Number.MAX_SAFE_INTEGER;
      if (clearing) return empty(id, validRevision ? result.revision : 0);
      const nonempty = value => typeof value === 'string' && value.trim().length > 0;
      const record = value => value && nonempty(value.id) && nonempty(value.createdAt);
      const validTurns = Array.isArray(result.turns) && result.turns.length <= core.LIMITS.turns && result.turns.every(turn => record(turn) && nonempty(turn.user) && turn.user.length <= core.LIMITS.question && nonempty(turn.assistant) && Array.isArray(turn.sourceIds) && turn.sourceIds.length <= core.LIMITS.sources && turn.sourceIds.every(nonempty));
      const validSources = Array.isArray(result.sources) && result.sources.length <= core.LIMITS.sources && result.sources.every(source => record(source) && nonempty(source.title) && source.title.length <= 200 && nonempty(source.text) && source.text.length <= core.LIMITS.source);
      const validReport = result.report === null || (result.report && result.report.revision === result.revision && nonempty(result.report.key) && nonempty(result.report.markdown));
      if (result.videoId !== id || !validRevision || !validTurns || !validSources || !validReport) throw core.error('本地对话记录格式异常，请清空当前视频记录后重试。');
      return clone(result);
    }
    async function write(state) {
      try { await storage.set({ [PREFIX + state.videoId]: clone(state) }); } catch (_) { throw core.error('本地对话保存失败，可能是存储空间不足。请先备份并手动清理后重试；未自动删除任何记录。'); }
      return clone(state);
    }
    function stop(id) {
      const job = jobs.get(id);
      if (job) { jobs.delete(id); job.controller.abort(); }
    }
    function assertCurrent(job, state) {
      if (jobs.get(job.videoId) !== job || job.controller.signal.aborted || state.revision !== job.revision) throw core.error('任务已取消或对话内容发生变化，请重试。');
    }
    function start(id, state) {
      if (jobs.has(id)) throw core.error('当前视频有任务正在进行，请等待完成或先停止。');
      const job = { videoId: id, revision: state.revision, controller: new AbortController() };
      jobs.set(id, job);
      return job;
    }
    async function generate(job, messages, maxTokens, responseFormat) {
      const signal = job.controller.signal;
      if (signal.aborted) throw core.error('任务已取消，请重试。');
      let onAbort;
      const canceled = new Promise((_, reject) => {
        onAbort = () => reject(core.error('任务已取消，请重试。'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const result = await Promise.race([Promise.resolve().then(() => {
          if (signal.aborted) throw core.error('任务已取消，请重试。');
          return complete({ messages, maxTokens, signal, ...(responseFormat ? { responseFormat } : {}) });
        }), canceled]);
        if (signal.aborted) throw core.error('任务已取消，请重试。');
        if (typeof result !== 'string' || !result.trim()) throw core.error('模型未返回有效内容，请重试。');
        return result.trim();
      } catch (failure) {
        if (signal.aborted) throw core.error('任务已取消，请重试。');
        if (failure && failure.growthSafe) throw failure;
        throw core.error('模型请求失败，请检查网络与 AI 设置后重试。');
      } finally { signal.removeEventListener('abort', onAbort); }
    }
    function finish(job) { if (jobs.get(job.videoId) === job) jobs.delete(job.videoId); }
    async function get(value) { const id = core.videoId(value); return queue(id, () => read(id)); }
    async function importSource(value, input) {
      const id = core.videoId(value), material = core.source(input);
      return queue(id, async () => {
        const state = await read(id);
        if (state.sources.length >= core.LIMITS.sources) throw core.error(`每个视频最多保存 ${core.LIMITS.sources} 份材料，请先移除不用的材料。`);
        stop(id);
        state.sources.push({ id: makeId(), ...material, createdAt: String(now()) });
        state.revision++; state.report = null;
        return write(state);
      });
    }
    async function removeSource(value, sourceId) {
      const id = core.videoId(value);
      return queue(id, async () => {
        const state = await read(id);
        const index = state.sources.findIndex(source => source.id === sourceId);
        if (index === -1) return state;
        stop(id);
        state.sources.splice(index, 1); state.revision++; state.report = null;
        return write(state);
      });
    }
    async function clear(value) {
      const id = core.videoId(value);
      return queue(id, async () => {
        stop(id);
        // Retain a monotonic tombstone revision so a frozen save cannot match old content.
        const state = await read(id, true);
        return write(empty(id, state.revision + 1));
      });
    }
    async function cancel(value) {
      const id = core.videoId(value);
      return queue(id, async () => { stop(id); return read(id); });
    }
    async function send(input, inputQuestion) {
      const context = core.normalizeContext(input), question = core.question(inputQuestion), id = context.videoId;
      const setup = await queue(id, async () => {
        const state = await read(id);
        if (state.turns.length >= core.LIMITS.turns) throw core.error(`每个视频最多保存 ${core.LIMITS.turns} 组问答，请先导出并清理对话。`);
        const messages = core.chatMessages(context, state, question);
        return { snapshot: clone(state), messages, job: start(id, state) };
      });
      try {
        const assistant = await generate(setup.job, setup.messages, 4096);
        if (assistant.length > 60000) throw core.error('模型回复超过 60000 字符，本次回复未保存，也未截断。请缩小问题范围后重试。');
        return await queue(id, async () => {
          const state = await read(id); assertCurrent(setup.job, state);
          state.turns.push({ id: makeId(), user: question, assistant, createdAt: String(now()), sourceIds: setup.snapshot.sources.map(source => source.id) });
          state.revision++; state.report = null;
          return write(state);
        });
      } finally { finish(setup.job); }
    }
    async function prepareReport(input, expectedRevision) {
      const context = core.normalizeContext(input), id = context.videoId;
      const setup = await queue(id, async () => {
        const state = await read(id);
        if (expectedRevision !== undefined && expectedRevision !== state.revision) throw core.error('对话版本已发生变化，请重新保存或预览报告。');
        if (!state.turns.length) return { result: null };
        if (jobs.has(id)) throw core.error('当前视频有任务正在进行，请等待完成或先停止。');
        const key = core.reportKey(context, state.revision);
        if (state.report && state.report.key === key && state.report.revision === state.revision) return { result: clone(state.report) };
        const messages = core.reportMessages(context, state);
        return { snapshot: clone(state), key, messages, job: start(id, state) };
      });
      if (Object.prototype.hasOwnProperty.call(setup, 'result')) return setup.result;
      try {
        const raw = await generate(setup.job, setup.messages, 8192, { type: 'json_object' });
        const report = core.validateReport(raw);
        const prepared = { revision: setup.snapshot.revision, key: setup.key, markdown: core.renderReport(context, setup.snapshot, report) };
        return await queue(id, async () => {
          const state = await read(id); assertCurrent(setup.job, state);
          state.report = prepared;
          await write(state);
          return clone(prepared);
        });
      } finally { finish(setup.job); }
    }
    return { get, importSource, removeSource, clear, send, cancel, prepareReport };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YTD_GROWTH_SERVICE;
