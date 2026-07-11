# Web Agent 工作台

Apollo Agent 的 ChatGPT 风格 Web 工作台：在居中对话流中查看 CLI 运行过程，并按需打开 Word、PDF、JSON、Markdown 产出物 Canvas。

## 技术栈

- **React 19 + Vite 7 + TypeScript + Tailwind v4**
- 对话：直连 **OpenAI 兼容 `/chat/completions`**（SSE 流式）
- Word 预览：**`docx-preview`**（纯前端把 docx 渲成 HTML，保留分页/字体/表格/图片/样式）
- Markdown：`react-markdown` + `remark-gfm` + `highlight.js`
- JSON：自研可折叠树视图
- PDF：浏览器原生 `<iframe>` 预览

> Vite 开发服务器会同时挂载本地 Apollo middleware；Mock 模式无需模型或额外后端。

## 目录结构

```
src/
  App.tsx                 主布局：侧栏 / 对话 / 产出物 Canvas
  components/
    AppSidebar.tsx        可折叠任务侧栏 + Apollo 快捷命令
    ChatPanel.tsx         对话气泡 + 输入框 + 流式
    ArtifactPanel.tsx     按需打开的产出物 Canvas
    MarkdownView.tsx      Markdown 渲染
    JsonView.tsx          JSON 折叠树
    PdfView.tsx           PDF 预览（iframe）
    WordView.tsx          docx-preview 渲染 Word（只读）
    SettingsBar.tsx       Apollo / Mock / OpenAI / Noumi 设置
    RuntimeStatusBar.tsx  模型、Token、缓存、会话运行指标
  lib/
    agent.ts              OpenAI 兼容流式客户端 + 产出物解析
    mockAgent.ts          本地 mock（无后端也能跑通全链路）
    settings.ts           配置持久化
index.html                应用入口
```

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:5173。默认连接 `agent/` 中的 Apollo SDK，并读取 `agent/.apollo/.env`；Mock、OpenAI-compatible 和 Noumi 模式仍可在设置中切换。

## 接入你的后端 agent

右上角「⚙ 设置」关闭 Mock，填入：

- **Base URL**：如 `http://localhost:8000/v1`
- **Model**：你的模型名
- **API Key**：可选

后端需兼容 OpenAI `POST /chat/completions`（`stream: true`，SSE，增量在 `choices[0].delta.content`）。

### 产出物契约（双通道）

agent 在流式回复末尾，用一个 ` ```artifacts ` 代码块声明产出物（会自动从对话正文中隐藏）：

````
```artifacts
[
  { "kind": "markdown", "title": "分析报告.md", "content": "## 结论\n..." },
  { "kind": "json",     "title": "结果.json",   "content": "{ \"k\": 1 }" },
  { "kind": "word",     "title": "报告.docx",   "url": "https://你的后台/files/1.docx" },
  { "kind": "pdf",      "title": "汇报.pdf",     "url": "https://你的后台/files/1.pdf" }
]
```
````

- **通道 A（内联）**：`content` 字段——JSON / Markdown 直接内联；Word 也可内联为 base64 docx。
- **通道 B（下载 URL）**：`url` 字段——Word / PDF 走后台可下载地址；前端 fetch 后预览。
- 两个通道可同时给（`content` + `url`）；Word 优先用 `content`，其次拉 `url`。

> `url` 若跨源，后台需允许 CORS；受保护资源可在 `WordView`/`agent` 层扩展带 token 的 fetch。

## 各类型预览说明

| 类型 | 渲染方式 | 数据来源 |
| --- | --- | --- |
| Markdown | react-markdown（GFM + 代码高亮） | `content` |
| JSON | 可折叠树 | `content` |
| PDF | `<iframe>` 原生预览 | `url`（可为 data URL） |
| Word | docx-preview 渲成 HTML | `content`(base64) 或 `url` |

Word / PDF 面板右上角有「⬇ 下载」按钮，可把原文件保存到本机。
