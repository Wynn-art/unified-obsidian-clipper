/* UI controller for the client-assisted workflow. It never handles credentials. */
var YTD_GROWTH_PANEL = (() => {
  function create({ document: doc, send, getContext, copy, confirm, subject = "视频", core = typeof module !== 'undefined' && module.exports ? require('./growth-core.js') : YTD_GROWTH_CORE }) {
    const el = id => doc.getElementById(id);
    let context = null, state = null, epoch = 0, busy = false, saving = false, reportTask = null;
    const drafts = new Map();
    const request = async message => {
      let timer;
      try {
        const response = await Promise.race([
          send(message),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('操作超时，请停止后重试。')), 135000); }),
        ]);
        if (!response?.success) throw new Error(response?.error || '操作失败，请重试。');
        return response.value;
      } finally { clearTimeout(timer); }
    };
    const status = text => { el('growthStatus').textContent = text; };
    function buttons() {
      const locked = !context || busy || saving;
      for (const id of ['growthSend', 'growthQuestion', 'growthCopyClient', 'growthImport', 'growthSourceTitle', 'growthSourceText', 'growthClear']) el(id).disabled = locked;
      el('growthReport').disabled = locked || !state?.turns?.length;
      el('growthStop').disabled = !busy && !reportTask;
      el('growthStop').hidden = !busy && !reportTask;
      el('growthChat').hidden = !context;
    }
    function render() {
      const messages = el('growthMessages');
      messages.replaceChildren();
      for (const turn of state?.turns || []) {
        const pair = doc.createElement('article');
        pair.className = 'growth-turn';
        for (const [label, text] of [['你', turn.user], ['学习助理', turn.assistant]]) {
          const heading = doc.createElement('strong'); heading.textContent = label;
          const body = doc.createElement('p'); body.textContent = text;
          pair.append(heading, body);
        }
        messages.append(pair);
      }
      messages.scrollTop = messages.scrollHeight;
      const sources = el('growthSources'); sources.replaceChildren();
      for (const source of state?.sources || []) {
        const row = doc.createElement('div'); row.className = 'growth-source';
        const name = doc.createElement('span'); name.textContent = `${source.title} · 手动导入`;
        const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '移除';
        remove.disabled = busy || saving;
        remove.setAttribute('aria-label', `移除材料：${source.title}`);
        remove.addEventListener('click', () => operate(async (snapshot, active) => {
          const next = await request({ action: 'ytd-growth:remove', videoId: snapshot.videoId, sourceId: source.id });
          if (active()) { state = next; status('已移除材料；下次生成报告会更新。'); }
        }));
        row.append(name, remove); sources.append(row);
      }
      el('growthEmpty').hidden = Boolean(state?.turns?.length);
      el('growthReportText').textContent = state?.report?.markdown || '';
      el('growthReportPreview').hidden = !state?.report?.markdown;
      buttons();
    }
    async function operate(work) {
      if (!context || busy || saving) return;
      const current = epoch, snapshot = { ...context };
      const active = () => current === epoch && context?.videoId === snapshot.videoId;
      busy = true; render();
      try { await work(snapshot, active); }
      catch (error) { if (active()) status(error.message || '操作失败，请重试。'); }
      finally { if (active()) { busy = false; render(); } }
    }
    async function syncContext(next) {
      if (context && next?.videoId === context.videoId) { context = { ...next }; return; }
      const previous = context;
      if (previous) drafts.set(previous.videoId, el('growthQuestion').value);
      if (previous && (busy || reportTask)) void send({ action: 'ytd-growth:cancel', videoId: previous.videoId }).catch(() => {});
      const current = ++epoch;
      context = next ? { ...next } : null; state = null; busy = false; reportTask = null;
      el('growthQuestion').value = next ? drafts.get(next.videoId) || '' : '';
      el('growthSourceTitle').value = ''; el('growthSourceText').value = '';
      status(next ? `正在恢复当前${subject}的对话…` : ''); render();
      if (!next) return;
      try {
        const loaded = await request({ action: 'ytd-growth:get', videoId: next.videoId });
        if (current === epoch) { state = loaded; status(`回答基于当前${subject}与导入资料；建议需结合自身情况判断。`); render(); }
      } catch (error) { if (current === epoch) { status(error.message); buttons(); } }
    }
    el('growthSend').addEventListener('click', () => operate(async (snapshot, active) => {
      const question = el('growthQuestion').value.trim();
      if (!question) { status('请先输入问题。'); return; }
      status(`正在结合${subject}和资料分析…`);
      const live = getContext();
      if (!live || live.videoId !== snapshot.videoId) throw new Error(`${subject}已切换，请在当前${subject}重新提问。`);
      const next = await request({ action: 'ytd-growth:send', context: live, question });
      if (active()) { state = next; el('growthQuestion').value = ''; drafts.delete(snapshot.videoId); status('回答已保存到本地。保存到 Obsidian 时会附上成长报告。'); }
    }));
    el('growthQuestion').addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); el('growthSend').click(); }
    });
    el('growthCopyClient').addEventListener('click', () => operate(async (snapshot, active) => {
      const live = getContext();
      if (!live || live.videoId !== snapshot.videoId) throw new Error(`${subject}已切换。`);
      const prompt = core.buildClientPrompt(live, el('growthQuestion').value.trim() || `请结合${subject}和我上传的材料，分析有哪些个人成长启发与可实施的下一步行动。`);
      await copy(prompt);
      if (active()) status('已复制。到 Gemini 客户端粘贴并上传附件，再将分析结果导入下方。没有自动发送任何内容。');
    }));
    el('growthImport').addEventListener('click', () => operate(async (snapshot, active) => {
      const source = { title: el('growthSourceTitle').value.trim(), text: el('growthSourceText').value.trim() };
      status('正在保存补充资料…');
      const next = await request({ action: 'ytd-growth:import', videoId: snapshot.videoId, source });
      if (active()) { state = next; el('growthSourceTitle').value = ''; el('growthSourceText').value = ''; status('分析结果已作为补充资料保存。继续提问后会纳入对话报告。'); }
    }));
    el('growthClear').addEventListener('click', () => operate(async (snapshot, active) => {
      if (!confirm(`清空当前${subject}的本地对话、补充资料和报告缓存？已保存的 Obsidian 文件不会删除。`)) return;
      const next = await request({ action: 'ytd-growth:clear', videoId: snapshot.videoId });
      if (active()) { state = next; status(`已清空当前${subject}的本地对话。`); }
    }));
    async function cancelPending() {
      if (!context || (!busy && !reportTask)) return;
      const videoId = context.videoId, current = ++epoch;
      status('正在停止…');
      try {
        const next = await request({ action: 'ytd-growth:cancel', videoId });
        if (current === epoch) { state = next; status('已停止。未完成的问答不会写入报告；问题草稿已保留。'); }
      } catch (error) { if (current === epoch) status(error.message); }
      finally { if (current === epoch) { busy = false; reportTask = null; render(); } }
    }
    el('growthStop').addEventListener('click', cancelPending);
    async function prepareReport(snapshot) {
      const current = epoch;
      const task = { videoId: snapshot.videoId };
      const assertActive = () => {
        if (current !== epoch || context?.videoId !== snapshot.videoId) throw new Error(`${subject}已切换或生成已停止；此次保存已取消。`);
      };
      assertActive();
      reportTask = task; buttons();
      try {
        const stored = await request({ action: 'ytd-growth:get', videoId: snapshot.videoId });
        assertActive();
        if (!stored.turns.length) return null;
        const report = await request({ action: 'ytd-growth:report', context: snapshot, expectedRevision: stored.revision });
        assertActive();
        state = { ...stored, report }; render();
        return report;
      } finally {
        if (reportTask === task) { reportTask = null; buttons(); }
      }
    }
    el('growthReport').addEventListener('click', () => operate(async (snapshot, active) => {
      status('正在整理成长启发和行动计划…');
      const live = getContext();
      if (!live || live.videoId !== snapshot.videoId) throw new Error(`${subject}已切换。`);
      const report = await prepareReport(live);
      if (active()) status(report ? '报告已生成，可在下方预览；点击上方“保存到 Obsidian”一起保存。' : '完成至少一组问答后再生成报告。');
    }));
    render();
    return { syncContext, prepareReport, cancelPending, setSaving(value) { saving = Boolean(value); render(); }, isBusy: () => busy,
      captureGuard() { const selectedEpoch = epoch, selectedVideo = context?.videoId;
        return () => Boolean(selectedVideo) && epoch === selectedEpoch && context?.videoId === selectedVideo;
      } };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YTD_GROWTH_PANEL;
