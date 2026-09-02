/* Reuse the existing Bilibili REST settings without storing another copy of its key. */
var UNIFIED_BILI_EXPORT = (() => {
  function segment(value) {
    return String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+|\.+$/g, '').slice(0, 110);
  }
  function buildPath({ folder, title, bvid, page = 1, author = '', uploadDate = '', publishedAt = 0 }) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) throw new Error('缺少有效的视频编号。');
    const part = Number(page);
    if (!Number.isSafeInteger(part) || part < 1) throw new Error('无效的视频分 P。');
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const published = new Date(Number(publishedAt) * 1000);
    const publicationDate = uploadDate || (Number(publishedAt) > 0 && Number.isFinite(published.getTime())
      ? `${published.getFullYear()}-${String(published.getMonth() + 1).padStart(2, '0')}-${String(published.getDate()).padStart(2, '0')}` : '');
    if (String(folder).includes('{{upload_date}}') && !publicationDate) throw new Error('缺少发布日期，请重新获取字幕后再保存。');
    const variables = { created: localDate, author: segment(author) || '未知作者', bvid, upload_date: segment(publicationDate) };
    const expanded = String(folder ?? 'Clippings/Bilibili').replace(/\{\{(created|author|bvid|upload_date)\}\}/g, (_, name) => variables[name]);
    const parts = expanded.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some(value => value === '.' || value === '..' || /\{\{|\}\}/.test(value))) throw new Error('保存目录无效，请检查目录模板。');
    const directory = parts.map(segment).filter(Boolean).join('/');
    return [directory, `${segment(title) || bvid} - ${bvid} - P${part} - 学习稿.md`].filter(Boolean).join('/');
  }
  function createSaver() {
    let pending = null;
    return async function save(document, { send, confirm, isCurrent = () => true }) {
      if (!document.markdown?.trim()) throw new Error('没有可保存的学习稿。');
      const report = document.conversationReport;
      if (report != null && (typeof report !== 'string' || !report.trim() || report.length > 1000000)) throw new Error('对话报告格式无效，请重新生成。');
      const canvas = document.canvas == null ? null : serializeCanvas(document.canvas);
      const guard = () => { if (!isCurrent()) throw new Error('视频或分 P 已切换，或任务已取消；未继续写入文件。'); };
      guard();
      const response = await send({ type: 'get-settings' });
      guard();
      if (!response?.ok) throw new Error(response?.error || '读取 Obsidian 设置失败。');
      const settings = response.settings || {};
      if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) throw new Error('请先在 B站剪藏设置填写 Obsidian Local REST API 地址和密钥。');
      const filepath = buildPath({ ...document, folder: settings.noteFolder });
      const reportPath = report ? filepath.replace(/\.md$/i, '') + ' - 对话报告.md' : null;
      const canvasPath = canvas ? filepath.replace(/\.md$/i, '.canvas') : null;
      const link = path => encodeURIComponent(path.split('/').pop()).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
      const markdown = document.markdown + (canvas ? `\n\n## 思维脑图\n\n[打开思维脑图](<${link(canvasPath)}>)\n` : '') + (report ? `\n\n## 成长对话报告\n\n[查看成长启发与行动计划](<${link(reportPath)}>)\n` : '');
      const target = { baseUrl: settings.obsidianApiBaseUrl, apiKey: settings.obsidianApiKey };
      // Only held in this panel session; never logged or persisted with credentials.
      const key = JSON.stringify({ target, filepath, markdown, canvas, report });
      if (!pending || pending.key !== key) pending = { key, checked: false, files: { markdown: false, canvas: !canvas, report: !report } };
      const current = pending;
      const artifacts = [{ kind: 'markdown', path: filepath, content: markdown }];
      if (canvas) artifacts.push({ kind: 'canvas', path: canvasPath, content: canvas });
      if (report) artifacts.push({ kind: 'report', path: reportPath, content: report });
      try {
        if (!current.checked) {
          const existingPaths = [];
          for (const artifact of artifacts) {
            guard();
            const existing = await send({ type: 'obsidian-note-exists', ...target, filepath: artifact.path });
            guard();
            if (!existing?.ok) throw new Error(existing?.error || '检查已有笔记失败。');
            if (existing.exists) existingPaths.push(artifact.path);
          }
          if (existingPaths.length && !await confirm(`Obsidian 已有以下文件，是否覆盖？\n${existingPaths.join('\n')}`)) {
            if (pending === current) pending = null;
            return { canceled: true, path: filepath, canvasPath, reportPath, files: { ...current.files } };
          }
          guard();
          current.checked = true;
        }
        for (const artifact of artifacts) {
          if (current.files[artifact.kind]) continue;
          guard();
          const written = await send({ type: 'write-obsidian-note', ...target, filepath: artifact.path, content: artifact.content, contentType: artifact.kind === 'canvas' ? 'application/json' : 'text/markdown' });
          if (!written?.ok) throw new Error(written?.error || '文件写入失败。');
          current.files[artifact.kind] = true;
        }
        if (pending === current) pending = null;
        return { canceled: false, path: filepath, canvasPath, reportPath, files: { ...current.files } };
      } catch (error) {
        const missing = [canvas && !current.files.canvas ? '思维脑图' : '', report && !current.files.report ? '对话报告' : ''].filter(Boolean);
        const prefix = current.files.markdown && missing.length
          ? `学习稿已保存，但${missing.join('、')}尚未保存。再次保存将只补存未完成文件：`
          : '保存未完成：';
        const failure = new Error(prefix + (error.message || '请检查连接后重试。'));
        failure.files = { ...current.files }; failure.path = filepath; failure.canvasPath = canvasPath; failure.reportPath = reportPath;
        throw failure;
      }
    };
  }
  function serializeCanvas(canvas) {
    const invalid = () => { throw new Error('思维脑图格式无效，请重新生成。'); };
    if (!canvas || !Array.isArray(canvas.nodes) || !canvas.nodes.length || canvas.nodes.length > 300 || !Array.isArray(canvas.edges) || canvas.edges.length > 300) invalid();
    const ids = new Set();
    for (const node of canvas.nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || node.type !== 'text' || typeof node.text !== 'string' || !node.text.trim() || ![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) invalid();
      ids.add(node.id);
    }
    const edges = new Set();
    for (const edge of canvas.edges) {
      if (!edge || typeof edge.id !== 'string' || !edge.id || edges.has(edge.id) || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) invalid();
      edges.add(edge.id);
    }
    const serialized = JSON.stringify(canvas);
    if (serialized.length > 1000000) invalid();
    return serialized;
  }
  // A one-shot API remains available for callers that do not retain retry state.
  const save = (document, dependencies) => createSaver()(document, dependencies);
  return { buildPath, save, createSaver };
})();
if (typeof module !== 'undefined') module.exports = UNIFIED_BILI_EXPORT;
