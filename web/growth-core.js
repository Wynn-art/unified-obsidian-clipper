/* Article identity and wording; reuse the tested dialogue/report data model. */
var WEB_GROWTH_CORE = (() => {
  const shared = typeof YTD_GROWTH_CORE !== 'undefined' ? YTD_GROWTH_CORE : require('../youtube/growth-core.js');
  const error = message => shared.error(message.replace(/视频/g, '文章'));
  function videoId(value) {
    if (typeof value !== 'string' || value.length > 8192) throw error('文章链接无效。');
    let url;
    try { url = new URL(value); } catch (_) { throw error('文章链接无效。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw error('文章链接无效。');
    // Preserve query and fragment routes: different documents must never share dialogue.
    return url.href;
  }
  function normalizeContext(input) {
    if (!input || typeof input !== 'object') throw error('请先提取文章正文。');
    const url = videoId(input.url), id = videoId(input.videoId);
    if (url !== id) throw error('文章链接与当前文章不一致。');
    return { videoId: id, url, title: shared.text(input.title, '文章标题', 2000),
      transcript: shared.text(input.transcript, '文章正文'), overview: shared.text(input.overview, '文章概览', undefined, true) };
  }
  function articleMessages(messages) {
    return messages.map(message => message.role === 'system'
      ? { ...message, content: message.content.replace(/视频字幕/g, '文章正文').replace(/视频/g, '文章') }
      : message);
  }
  function buildClientPrompt(input, question) {
    const c = normalizeContext(input);
    const content = `请结合下面的文章背景、我的问题，以及我在客户端自行上传的附件进行分析。若没有收到附件，请明确说明，不要假装读取。区分文章观点、附件来源与推断，指出不确定性，并给出具体行动建议。请用中文输出可复制回学习扩展的分析结果，并注明材料名称。\n\n文章标题：${c.title}\n文章链接：${c.url}\n\n文章概览：\n${c.overview || '未提供'}\n\n文章正文：\n${c.transcript}\n\n我的问题：\n${shared.question(question)}`;
    if (content.length > shared.LIMITS.context) throw error(`上下文超过 ${shared.LIMITS.context} 字符，请减少内容后重试；内容未被截断。`);
    return content;
  }
  function validateReport(raw) {
    const report = shared.validateReport(raw);
    const explanatory = [report.summary, ...report.insights, ...report.questions, ...report.actions.flatMap(Object.values)].join('\n');
    if (!/[\u3400-\u9fff]/u.test(explanatory)) throw error('模型未返回中文成长报告，请重新生成。');
    return report;
  }
  return { ...shared, error, videoId, normalizeContext, buildClientPrompt, validateReport,
    chatMessages: (...args) => articleMessages(shared.chatMessages(...args)),
    reportMessages: (...args) => articleMessages(shared.reportMessages(...args)),
    renderReport: (context, state, report) => shared.renderReport({ ...context, url: context.url.replace(/[()]/g, c => c === '(' ? '%28' : '%29') }, state, report,
      { sourceLabel: '文章', sourceDescription: '文章正文' }) };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WEB_GROWTH_CORE;
