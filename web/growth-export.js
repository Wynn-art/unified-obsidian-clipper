/* Optional third artifact, using the article's existing URI / daily REST transport. */
var WEB_GROWTH_EXPORT = (() => {
  function encode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, character =>
      '%' + character.charCodeAt(0).toString(16).toUpperCase());
  }
  function reportUri(pair, target, silentOpen) {
    const parameters = [
      ['file', pair.reportPath],
      ['overwrite', 'true'],
      ['content', pair.report],
    ];
    if (target.vault) parameters.push(['vault', target.vault]);
    if (silentOpen) parameters.push(['silent', 'true']);
    return 'obsidian://new?' + parameters.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
  }
  async function attach(pair, target, report, context, { behavior } = {}) {
    if (!report) return;
    if (typeof report.markdown !== 'string' || !report.markdown.trim()) throw new Error('成长报告内容无效，请重新生成。');
    let base = target.canvasPath.replace(/\.canvas$/i, '');
    if (target.transport === 'local-rest' || ['append', 'prepend'].includes(behavior)) {
      // Several articles can share one daily note without overwriting one another's reports.
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(context.url));
      const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      base += ` - 文章-${id}`;
    }
    pair.report = report.markdown;
    pair.reportPath = `${base} - 对话报告.md`;
    pair.markdown += `\n\n[成长对话报告](<${encodeURIComponent(pair.reportPath.split('/').pop())}>)\n`;
  }
  async function save(pair, target, completed, { openUri, silentOpen = false } = {}) {
    if (!pair.report || completed.report) return;
    try {
      if (target.transport === 'local-rest') {
        const url = `${target.origin}/vault/${pair.reportPath.split('/').map(encodeURIComponent).join('/')}`;
        const response = await target.request(url, { method: 'PUT', headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'text/markdown' }, body: pair.report });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } else {
        await openUri(reportUri(pair, target, silentOpen));
      }
      completed.report = true;
    } catch (error) {
      throw new Error(`笔记和脑图已处理，但成长报告保存失败。请在当前面板重试补存报告：${error.message || '写入失败'}`);
    }
  }
  return { attach, save, reportUri };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WEB_GROWTH_EXPORT;
