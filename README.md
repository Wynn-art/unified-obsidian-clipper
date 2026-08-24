# Unified Obsidian Clipper

一个 Chrome 扩展，把 YouTube / Bilibili 视频和任意网页一键剪藏到 Obsidian：自动抓取视频字幕与信息、调用 AI 生成摘要和笔记、支持网页高亮和阅读模式。

## 功能特性

- **YouTube 视频剪藏**：抓取视频字幕（transcript）、标题、作者等信息，写入 Obsidian 笔记
- **Bilibili 视频剪藏**：支持视频页与稍后再看列表，自动获取视频信息与字幕
- **网页剪藏**：任意网页正文提取，保存为 Markdown
- **AI 摘要与笔记**：内置 DeepSeek 等大模型接口（可自定义 Provider / Model），自动生成摘要、翻译、学习笔记
- **网页高亮**：在任意网页上划词高亮，随手保存
- **阅读模式**：沉浸式阅读页面
- **多语言界面**：内置 30+ 语言
- **快捷键**：
  - `⌘/Ctrl + Shift + O` 打开剪藏面板
  - `Alt + Shift + O` 快速剪藏
  - `Alt + Shift + H` 开关高亮
  - `Alt + Shift + R` 开关阅读模式

## 安装

1. 下载或克隆本仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目文件夹

## 配置

### 1. Obsidian 本地接口

1. 在 Obsidian 社区插件市场安装并启用 **Local REST API with MCP**
2. 在插件设置中勾选 **Enable Non-encrypted (HTTP) Server**（地址通常为 `http://127.0.0.1:27123`）
3. 复制 API Key，填入本扩展设置页的「Local REST API 地址」和「Local REST API Key」

### 2. AI 接口（可选）

在扩展设置中添加 AI Provider（如 DeepSeek），填入 API Key，即可使用 AI 摘要与笔记功能。

### 3. 笔记目录

可配置自动写入的目录，支持变量：`{{created}}` / `{{upload_date}}` / `{{author}}` / `{{bvid}}`。

## 致谢

本项目合并并改进自以下 MIT 开源项目：

- [YouTube Digest](https://github.com/Xplore-AGI) — Copyright (c) 2026 Xplore-AGI
- [Bilibili Obsidian Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) — Copyright (c) 2026 haixiong1997
- [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) — Copyright (c) 2024 Obsidian

完整许可声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## License

[MIT](./THIRD_PARTY_NOTICES.md#mit-license)
