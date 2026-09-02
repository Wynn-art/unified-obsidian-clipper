/* Platform identity only; dialogue, prompts and reports reuse the YouTube implementation. */
var BILI_GROWTH_CORE = (() => {
  const shared = typeof YTD_GROWTH_CORE !== 'undefined' ? YTD_GROWTH_CORE : require('../youtube/growth-core.js');
  function videoId(value) {
    if (typeof value !== 'string' || !/^BV[0-9A-Za-z]{10}_p[1-9][0-9]{0,5}$/.test(value)) throw shared.error('B站视频编号或分 P 无效，请重新打开视频。');
    return value;
  }
  function normalizeContext(input) {
    if (!input || typeof input !== 'object') throw shared.error('视频上下文无效，请重新提取字幕。');
    const id = videoId(input.videoId), [bvid, part] = id.split('_p');
    const page = Number(part);
    if (input.url) {
      let url;
      try { url = new URL(input.url); } catch (_) { throw shared.error('视频链接无效。'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
          !['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname) ||
          ![ `/video/${bvid}`, `/video/${bvid}/` ].includes(url.pathname) ||
          (url.searchParams.get('p') || '1') !== String(page)) throw shared.error('视频链接与当前视频或分 P 不一致。');
    }
    return { videoId: id, title: shared.text(input.title, '视频标题', 2000),
      url: `https://www.bilibili.com/video/${bvid}?p=${page}`,
      transcript: shared.text(input.transcript, '视频字幕'), overview: shared.text(input.overview, '视频概览', undefined, true) };
  }
  return { ...shared, videoId, normalizeContext,
    buildClientPrompt: (context, question) => shared.buildClientPrompt(context, question, normalizeContext) };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BILI_GROWTH_CORE;
