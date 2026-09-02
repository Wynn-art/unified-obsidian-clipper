// Development server only: synthetic data, no browser profile or external API requests.
(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  window.fixtureLocalFetch = (url, ...args) => { if (new URL(url, location.href).origin !== location.origin) throw new Error("External requests forbidden"); return nativeFetch(url, ...args); };
  const bili = location.pathname.includes('bilibili');
  const noop = () => {};
  const event = { addListener: noop, removeListener: noop };
  const activeTab = { id: 7, windowId: 9, active: true, url: bili ? 'https://www.bilibili.com/video/BV1xx411c7mD?p=2' : 'https://www.youtube.com/watch?v=demo1234567' };
  const notes = [{ id: 'note-demo', bvid: 'BV1xx411c7mD', page: 2, videoId: 'demo1234567', timestampSeconds: 12, timestamp: '0:12', videoTitle: '如何建立个人学习系统', ownerName: '示例作者', channelName: 'Demo Channel', text: '先记录问题，再带着问题阅读原文。', timestampedUrl: activeTab.url + '&t=12', createdAt: Date.now() }];
  const analysis = { chapters: [{ timestamp: '0:00', timestampSeconds: 0, title: '先提出问题', summary: '带着具体问题阅读，保留原文依据。' }], keyQuotes: [{ timestamp: '0:12', timestampSeconds: 12, quote: '先记录问题，再带着问题阅读原文。' }] };
  const segments = [{ id: 's1', start: 0, text: '学习不是收集资料，而是理解并运用知识。' }, { id: 's2', start: 12, text: '先记录问题，再带着问题阅读原文。' }, { id: 's3', start: 25, text: '每个结论都应有可回溯的原文依据。' }];
  const area = () => {
    const data = {};
    return { get: async keys => {
      if (keys == null) return data;
      const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(names.map(key => [key, data[key] ?? defaults[key]]));
    }, set: async values => Object.assign(data, values), remove: async keys => [].concat(keys).forEach(key => delete data[key]) };
  };
  async function send(message, callback) {
    const action = message.action?.replace(/^bili-digest:/, '');
    let result = { success: true, ok: true };
    if (action === 'getAiTasks') result.tasks = [];
    if (action === 'checkConfig') result = { ready: true, hasAiKey: true, hasSupadataKey: true };
    if (action === 'getNotes') result.notes = notes;
    if (action === 'getQaHistory') result.entries = [];
    if (action === 'fetchTranscript') result = bili ? {
      success: true, fromCache: true, segments, language: 'zh-CN', analysis,
      videoInfo: { title: '如何建立个人学习系统', owner: '示例作者' },
      translated: { s1: 'Learning means understanding and applying knowledge.', s2: 'Write down questions before reading the source.', s3: 'Every conclusion needs a traceable source.' },
    } : { success: true, transcript: segments.map(s => ({ ...s, duration: 12 })), transcriptText: segments.map(s => s.text).join('\n'), transcriptTimestamped: segments.map(s => `[${s.start}] ${s.text}`).join('\n'), language: 'zh' };
    if (action === 'relayToContent') result.response = { title: 'Building a personal learning system', channelName: 'Demo Channel', duration: 60, currentTime: 12, paused: true };
    if (action === 'analyzeTranscript') result.analysis = analysis;
    if (action === 'translateContent') result.translatedContent = { segments: message.content.segments.map(s => ({ id: s.id, text: `示例译文：${s.text}` })) };
    if (action === 'askQuestion') result.entry = { id: 'qa-demo', question: message.question, answer: '视频建议先提出问题，再阅读原文 [00:12]。', citations: [{ startSeconds: 12, quote: segments[1].text }], createdAt: Date.now() };
    if (message.type === 'get-settings') result.settings = { noteFolder: 'Clippings/Bilibili', obsidianApiBaseUrl: 'http://127.0.0.1:27123', obsidianApiKey: 'SYNTHETIC-FIXTURE-NOT-A-KEY' };
    if (message.type === 'obsidian-note-exists') result.exists = false;
    if (message.type === 'write-obsidian-note') document.body.dataset.fixtureSaved = message.filepath;
    if (message.type === 'unified-bili:open') document.body.dataset.fixtureMode = message.mode;
    if (action === 'resolveLearningObsidianTarget') result = { success: true, markdownPath: 'YouTube/demo.md', canvasPath: 'YouTube/demo.canvas' };
    if (message.type === 'learning:prepare') result = { ok: true, value: {
      outputs: { summary: ['示例总结'], trends: ['示例趋势'], expandedKnowledge: [{ topic: '问题', explanation: '示例解释', application: '' }], mindMap: { root: '学习', branches: [{ title: '提问', items: ['保留依据'] }] } },
      markdown: '## 核心总结\n- 示例总结', canvas: { nodes: [{ id: 'root', type: 'text', text: '学习方法', x: 0, y: 0, width: 300, height: 100 }, { id: 'branch', type: 'text', text: '明确问题与实践', x: 420, y: 0, width: 280, height: 90 }], edges: [{ id: 'edge', fromNode: 'root', toNode: 'branch', fromSide: 'right', toSide: 'left' }] },
    } };
    if (action === 'syncToObsidian') result = { success: true, files: { markdown: true, canvas: true }, markdownPath: 'YouTube/demo.md', canvasPath: 'YouTube/demo.canvas' };
    if (callback) callback(result);
    return result;
  }
  window.chrome = {
    runtime: { id: 'test-preview', sendMessage: send, onMessage: event, getURL: p => '/' + p },
    tabs: { query: async () => [activeTab], onActivated: event, onUpdated: event, sendMessage: async () => ({ currentTime: 12, paused: true, success: true }), create: async () => ({}) },
    storage: { local: area(), sync: area(), session: area(), onChanged: event },
    windows: { getCurrent: async () => ({ id: 9 }) },
    permissions: { contains: async () => true, request: async () => true },
    sidePanel: { setOptions: async () => {}, open: async () => {} },
  };
  window.fetch = async () => { throw new Error('External requests disabled in UI fixture'); };
})();
