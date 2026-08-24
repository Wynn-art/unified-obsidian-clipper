/** Pure helpers for the Obsidian Local REST API integration. */
var YTD_OBSIDIAN = (() => {
  const DEFAULTS = Object.freeze({
    baseUrl: "http://127.0.0.1:27123",
    apiKey: "",
    folder: "YouTube",
    filenameTemplate: "{title} - {videoId}.md",
  });

  function normalizeSettings(input = {}) {
    let baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : DEFAULTS.baseUrl;
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
        baseUrl = DEFAULTS.baseUrl;
      } else {
        baseUrl = parsed.origin;
      }
    } catch (_error) {
      baseUrl = DEFAULTS.baseUrl;
    }
    const folder = String(input.folder ?? DEFAULTS.folder)
      .replace(/\\/g, "/")
      .split("/")
      .map(sanitizePathSegment)
      .filter(Boolean)
      .join("/") || DEFAULTS.folder;
    const filenameTemplate = String(input.filenameTemplate || DEFAULTS.filenameTemplate).trim() || DEFAULTS.filenameTemplate;
    return {
      baseUrl,
      apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "",
      folder,
      filenameTemplate,
    };
  }

  function sanitizePathSegment(value) {
    return String(value ?? "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[\u201c\u201d\u2018\u2019]/g, "")
      .replace(/\s+/g, " ")
      .replace(/-\s+-/g, " -")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 180) || "YouTube note";
  }

  function buildNotePath(settings, metadata) {
    const normalized = normalizeSettings(settings);
    let filename = normalized.filenameTemplate
      .replaceAll("{title}", metadata.title || "YouTube video")
      .replaceAll("{videoId}", metadata.videoId || "unknown");
    filename = sanitizePathSegment(filename);
    if (!filename.toLowerCase().endsWith(".md")) filename += ".md";
    return `${normalized.folder}/${filename}`;
  }

  function yaml(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function buildMarkdownNote(metadata, segments, outputs = null, learningMarkdown = null) {
    const safeTitle = String(metadata.title || "YouTube video").trim();
    const videoUrl = String(metadata.url || `https://www.youtube.com/watch?v=${metadata.videoId || ""}`);
    const lines = [
      "---",
      `title: ${yaml(safeTitle)}`,
      `video_id: ${yaml(metadata.videoId)}`,
      `source: ${yaml(videoUrl)}`,
      `channel: ${yaml(metadata.channel)}`,
      `captured_at: ${yaml(metadata.capturedAt || new Date().toISOString())}`,
      `duration: ${Number(metadata.duration) || 0}`,
      "tags:",
      "  - youtube",
      "  - transcript",
      "---",
      "",
      `# ${safeTitle}`,
      "",
      `> 来源：[YouTube](${videoUrl})`,
      `> 频道：${metadata.channel || "未知"}`,
      "",
    ];
    const sharedMarkdown = typeof learningMarkdown === "string" && learningMarkdown.trim()
      ? learningMarkdown.trim()
      : outputs
        ? buildLearningMarkdown(outputs).trim()
        : "";
    if (sharedMarkdown) lines.push(sharedMarkdown, "");
    lines.push("## 字幕", "");
    for (const segment of Array.isArray(segments) ? segments : []) {
      const start = Math.max(0, Math.floor(Number(segment.start) || 0));
      const timestamp = formatTime(start);
      const timestampUrl = `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}t=${start}s`;
      lines.push(`### [${timestamp}](${timestampUrl})`, "", String(segment.text || "").replace(/\|/g, "\\|"), "", `中文翻译：${String(segment.translation || "（未翻译）").replace(/\|/g, "\\|")}`, "");
    }
    return `${lines.join("\n").trim()}\n`;
  }

  function cleanLearningText(value, fallback = "") {
    return String(value ?? fallback).replace(/[\u0000-\u001f]/g, "").trim();
  }

  function validateLearningOutputs(value) {
    if (!value || typeof value !== "object") throw new Error("AI 学习结果格式无效。");
    const list = (name) => {
      if (!Array.isArray(value[name]) || value[name].length > 12) {
        throw new Error(`AI 学习结果缺少有效的 ${name}。`);
      }
      return value[name].map((item) => cleanLearningText(item)).filter(Boolean);
    };
    const summary = list("summary");
    const trends = list("trends");
    if (!value.expandedKnowledge || !Array.isArray(value.expandedKnowledge) || value.expandedKnowledge.length > 12) {
      throw new Error("AI 学习结果缺少有效的 expandedKnowledge。");
    }
    const expandedKnowledge = value.expandedKnowledge.map((item) => {
      if (!item || typeof item !== "object") throw new Error("扩展知识格式无效。");
      const topic = cleanLearningText(item.topic);
      const explanation = cleanLearningText(item.explanation);
      const application = cleanLearningText(item.application);
      if (!topic || !explanation) throw new Error("扩展知识缺少主题或解释。");
      return { topic, explanation, application };
    });
    const mindMap = value.mindMap;
    if (!mindMap || typeof mindMap !== "object" || !cleanLearningText(mindMap.root) || !Array.isArray(mindMap.branches) || mindMap.branches.length > 12) {
      throw new Error("AI 学习结果缺少有效的 mindMap。");
    }
    const branches = mindMap.branches.map((branch) => {
      if (!branch || typeof branch !== "object" || !cleanLearningText(branch.title) || !Array.isArray(branch.items) || branch.items.length > 12) {
        throw new Error("思维导图分支格式无效。");
      }
      return {
        title: cleanLearningText(branch.title),
        items: branch.items.map((item) => cleanLearningText(item)).filter(Boolean),
      };
    });
    return { summary, trends, expandedKnowledge, mindMap: { root: cleanLearningText(mindMap.root), branches } };
  }

  function markdownLine(value) {
    return cleanLearningText(value).replace(/\|/g, "\\|");
  }

  function buildLearningMarkdown(outputs) {
    const normalized = validateLearningOutputs(outputs);
    const lines = ["## 核心总结", "", ...normalized.summary.map((item) => `- ${markdownLine(item)}`), "", "## 内容趋势", "", ...normalized.trends.map((item) => `- ${markdownLine(item)}`), "", "## 扩展知识", ""];
    normalized.expandedKnowledge.forEach((item) => {
      const suffix = item.application ? `（应用：${markdownLine(item.application)}）` : "";
      lines.push(`- **${markdownLine(item.topic)}**：${markdownLine(item.explanation)}${suffix}`);
    });
    lines.push("", "## 思维导图", "", `- **${markdownLine(normalized.mindMap.root)}**`);
    normalized.mindMap.branches.forEach((branch) => {
      lines.push(`  - ${markdownLine(branch.title)}`);
      branch.items.forEach((item) => lines.push(`    - ${markdownLine(item)}`));
    });
    return `${lines.join("\n")}\n\n`;
  }

  function stableId(prefix, value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(36)}`;
  }

  function buildCanvas(outputs) {
    const normalized = validateLearningOutputs(outputs);
    const nodes = [];
    const edges = [];
    const rootId = stableId("root", normalized.mindMap.root);
    nodes.push({ id: rootId, type: "text", text: normalized.mindMap.root, x: 0, y: 0, width: 300, height: 100, color: "5" });
    normalized.mindMap.branches.forEach((branch, branchIndex) => {
      const branchId = stableId("branch", `${branchIndex}:${branch.title}`);
      nodes.push({ id: branchId, type: "text", text: branch.title, x: 420, y: branchIndex * 220, width: 280, height: 90, color: "4" });
      edges.push({ id: stableId("edge", `${rootId}:${branchId}`), fromNode: rootId, toNode: branchId, fromSide: "right", toSide: "left" });
      branch.items.forEach((item, itemIndex) => {
        const itemId = stableId("item", `${branchIndex}:${itemIndex}:${item}`);
        nodes.push({ id: itemId, type: "text", text: item, x: 800, y: branchIndex * 220 + itemIndex * 120, width: 300, height: 80, color: "2" });
        edges.push({ id: stableId("edge", `${branchId}:${itemId}`), fromNode: branchId, toNode: itemId, fromSide: "right", toSide: "left" });
      });
    });
    return { nodes, edges };
  }

  function learningCanvasPath(notePath) {
    return String(notePath).replace(/\.md$/i, ".canvas");
  }

  function mapObsidianError(status) {
    if (status === 0) return "无法连接 Obsidian。请确认 Obsidian 正在运行，并已启用 Local REST API 的 HTTP 服务。";
    if (status === 401 || status === 403) return "Obsidian API Key 无效，请在 Settings 中重新填写。";
    if (status === 400 || status === 404) return "Obsidian 无法写入该路径，请检查保存目录和文件名格式。";
    return `Obsidian 请求失败（HTTP ${status}）。`;
  }

  function vaultUrl(baseUrl, path) {
    const encodedPath = String(path || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `${normalizeSettings({ baseUrl }).baseUrl}/vault/${encodedPath}`;
  }

  function openUrl(baseUrl, path) {
    const encodedPath = String(path || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `${normalizeSettings({ baseUrl }).baseUrl}/open/${encodedPath}`;
  }

  return { DEFAULTS, normalizeSettings, sanitizePathSegment, buildNotePath, buildMarkdownNote, buildLearningMarkdown, validateLearningOutputs, buildCanvas, learningCanvasPath, mapObsidianError, formatTime, vaultUrl, openUrl };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_OBSIDIAN;
