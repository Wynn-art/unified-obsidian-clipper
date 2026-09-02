/* Runs after sidepanel.js so exports reflect its real notes, overview and visible subtitles. */
(() => {
  const button = document.getElementById('unifiedSaveStudy');
  const status = document.getElementById('unifiedStudySaveStatus');
  const stopButton = document.getElementById('unifiedStudySaveStop');
  const growth = typeof BILI_GROWTH_UI !== 'undefined' ? BILI_GROWTH_UI.create({
    document, getState: () => state, send: message => chrome.runtime.sendMessage(message),
    copy: text => navigator.clipboard.writeText(text), confirm: message => window.confirm(message),
  }) : null;
  const save = UNIFIED_BILI_EXPORT.createSaver ? UNIFIED_BILI_EXPORT.createSaver() : UNIFIED_BILI_EXPORT.save;
  let preparedLearning = null;
  let activeSave = null;
  const cancelSave = message => {
    if (!activeSave) return;
    activeSave.reason = message;
    activeSave.controller.abort();
  };
  // Bound every async stage and race navigation cancellation, even when a worker channel goes silent.
  async function waitFor(promise, job, timeout = 180000) {
    let timer, onAbort;
    const signal = job.controller.signal;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        onAbort = () => reject(new Error(job.reason || '保存准备已停止，未继续写入文件。'));
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { job.reason = '保存准备等待超时，请重试。迟到结果不会继续写入。'; job.controller.abort(); }, timeout);
      })]);
    } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort); }
  }
  globalThis.syncBiliGrowthContext = () => {
    if (activeSave && (state.view !== 'ready' || state.bvid !== activeSave.bvid || state.page !== activeSave.page)) cancelSave('视频或分 P 已切换；此次保存已取消。');
    return growth?.sync();
  };
  stopButton?.addEventListener?.('click', () => cancelSave('已停止保存准备。已发出的模型请求可能仍在处理，但不会继续保存。'));
  window.addEventListener?.('pagehide', () => { cancelSave('侧栏已关闭，保存已取消。'); void growth?.invalidate(); });
  void growth?.sync();
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (growth?.isBusy()) { status.textContent = '请等待当前成长对话完成，或停止后再保存。'; return; }
    button.disabled = true;
    growth?.setSaving(true);
    status.textContent = '正在准备学习稿…';
    let job = null;
    try {
      if (state.view !== 'ready' || !state.bvid || !state.data) throw new Error('请等待当前视频字幕加载成功后再保存。');
      job = { bvid: state.bvid, page: state.page, controller: new AbortController(), reportPending: false };
      // Stop, navigation and timeout all invalidate the report's local epoch before late gets resolve.
      job.controller.signal.addEventListener('abort', () => { if (job.reportPending) void growth?.cancelPending(); }, { once: true });
      activeSave = job;
      if (stopButton) stopButton.hidden = false;
      // Capture before the first await: navigating to another part must not mix its notes.
      const snapshot = {
        bvid: state.bvid, page: state.page,
        title: state.data.videoInfo?.title || state.bvid,
        author: state.data.videoInfo?.owner || '',
        publishedAt: state.data.videoInfo?.publishedAt || 0,
        analysis: structuredClone(state.analysis),
        transcript: currentTranscriptExport(),
      };
      const growthContext = growth?.getContext();
      const growthGuard = growth?.captureGuard();
      const isCurrent = () => activeSave === job && !job.controller.signal.aborted && state.view === 'ready' && state.bvid === snapshot.bvid && state.page === snapshot.page && (!growthGuard || growthGuard());
      const assertCurrent = () => { if (!isCurrent()) throw new Error('视频或分 P 已切换，或生成已停止；此次保存已取消。'); };
      const notes = await waitFor(sendToBackground({ action: 'getNotes', bvid: snapshot.bvid, page: snapshot.page }, { idempotent: true }), job, 30000);
      assertCurrent();
      if (!notes?.success) throw new Error(notes?.error || '读取当前视频笔记失败。');
      status.textContent = '正在检查成长对话并准备报告…';
      let report = null;
      if (growthContext) {
        job.reportPending = true;
        try { report = await waitFor(growth.prepareReport(growthContext), job); }
        finally { job.reportPending = false; }
      }
      assertCurrent();
      const markdown = BILI_LEARNING_STORE.learningAsMarkdown({
        ...snapshot, notes: notes.notes || [],
      });
      const learningDocument = {
        sourceType: 'bilibili', contentKind: 'transcript', title: snapshot.title, author: snapshot.author,
        url: `https://www.bilibili.com/video/${snapshot.bvid}?p=${snapshot.page}`, description: '',
        mainContent: (snapshot.transcript?.segments || []).map(segment => `[${segment.start || 0}] ${segment.source || segment.display || ''}`).join('\n'),
        contentCompleteness: { transcript: Boolean(snapshot.transcript?.segments?.length) },
        metadata: { bvid: snapshot.bvid, page: snapshot.page, learningMode: 'bili-study' },
      };
      if (!learningDocument.mainContent.trim()) throw new Error('缺少字幕，无法生成思维脑图。');
      const learningKey = JSON.stringify(learningDocument);
      if (preparedLearning?.key !== learningKey) {
        status.textContent = '正在生成中文学习总结与思维脑图…';
        const response = await waitFor(chrome.runtime.sendMessage({ type: 'learning:prepare', payload: { document: learningDocument } }), job);
        assertCurrent();
        if (!response?.ok || typeof response.value?.markdown !== 'string' || !response.value?.canvas?.nodes?.length) throw new Error(response?.error || '思维脑图生成失败，请重试；尚未写入文件。');
        preparedLearning = { key: learningKey, value: response.value };
      }
      assertCurrent();
      const artifacts = preparedLearning.value;
      // Keep frontmatter and user notes intact; append the generated learning sections.
      const fullMarkdown = markdown + '\n\n' + artifacts.markdown;
      status.textContent = report ? '正在写入学习稿、思维脑图与成长报告…' : '正在写入学习稿与思维脑图…';
      if (stopButton) stopButton.hidden = true;
      const result = await waitFor(save({ ...snapshot, markdown: fullMarkdown, canvas: artifacts.canvas, conversationReport: report?.markdown || null }, {
        send: message => chrome.runtime.sendMessage(message),
        confirm: message => window.confirm(message),
        isCurrent,
      }), job);
      status.textContent = result.canceled ? '已取消，原笔记未改动。' : `已保存：学习稿 ${result.path}；思维脑图 ${result.canvasPath}${result.reportPath ? `；成长报告 ${result.reportPath}` : ''}`;
    } catch (error) {
      status.textContent = error.message || '保存失败，请检查 B站剪藏设置。';
    } finally {
      if (activeSave === job || (!job && !activeSave)) {
        activeSave = null; button.disabled = false; growth?.setSaving(false);
        if (stopButton) stopButton.hidden = true;
      }
    }
  });
})();
