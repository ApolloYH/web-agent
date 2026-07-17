# Apollo Web Agent

> 当前 Web 主线对应 Agent `@apolloyh/apollo-agent@0.2.1`。项目状态、生产部署差异和新对话交接入口见 [docs/进度文档.md](docs/进度文档.md)。

公开使用指南：[https://apollo.yh521.top/docs](https://apollo.yh521.top/docs)

Apollo 是面向个人工作的超级助手。每个用户拥有独立的配置、会话、技能、长期记忆和文件工作区，可以在同一界面完成对话、写作、分析、文件处理和文档编辑。

文件库统一展示网站产出物和用户授权的本地目录。Word、Markdown、JSON 可在当前页面原位编辑，PDF 和图片可在当前页面预览；Agent 可读取和搜索 PDF 文本。本地文件默认不上传，只有调用云端 Agent 理解或修改文档时才会传递目录清单或当前正文。

## 启动

```bash
pnpm install
pnpm office:setup  # 首次运行，用 Docker 准备 Word 运行时与字体
pnpm dev
```

打开 http://127.0.0.1:5173/。开发服务会同时在 `127.0.0.1:5174` 启动独立 Office Host。

## 浏览器操作

Apollo 提供两条隔离的浏览器链路：

- **用户 Chrome（主链路）**：通过 `browser-extension/` 中的 Chrome MV3 扩展操作用户明确选中的标签页，可复用用户已登录会话。扩展随 `pnpm build` 一起构建，首次开发安装见 [`browser-extension/README.md`](browser-extension/README.md)。
- **Apollo 托管浏览器（可选）**：`browser-worker/` 使用 `browser-use` 运行无用户 Cookie 的隔离浏览器任务。只有配置 `APOLLO_BROWSER_WORKER_URL` 后才会向 Agent 注册该高风险工具，部署见 [`browser-worker/README.md`](browser-worker/README.md)。

本地 Chrome 的读写操作和托管浏览器任务均复用现有 Agent 工具审批、SSE 交互和取消链路。

Vite 中间件同时承载登录、SQLite 对话记录、Apollo 流式事件、文件上传和产出物下载。开发环境只监听 `127.0.0.1`；生产部署应使用 HTTPS、持久化数据卷和正式 Node 服务，不要直接暴露 Vite dev/preview。

生产构建与启动：

```bash
pnpm build
pnpm start
```

生产 systemd 基线见 `ops/web-agent.service`，包含自动重启、停机期限、内存/任务/文件描述符上限和系统级沙箱。部署拓扑、健康检查、备份和恢复见 [`docs/生产架构与恢复.md`](docs/生产架构与恢复.md)。

提交或发布前执行最小交付检查：

```bash
pnpm test
pnpm build
pnpm audit --prod
```

生产发布后必须确认 `GET /livez` 与 `GET /healthz` 均成功，并手动运行一次 `web-agent-backup.service` 验证快照可读。完整验收清单见 [`docs/生产架构与恢复.md`](docs/生产架构与恢复.md#9-发布验收清单)。

## 配置与隔离

- `config/web-entry-apollo.json`：默认 Apollo 配置模板，默认权限为 `ask`。
- `.apollo/web-entry-config.json`：首次启动时从模板复制的运行时配置；权限切换只修改该文件，不污染 Git 模板。
- `config/web-assistant-apollo.json`：用户配置模板。
- `.apollo/users/<用户 id>/workspace/.apollo/assistant-config.json`：用户实际配置，可在设置中编辑。
- `.apollo/users/<用户 id>/workspace/.apollo/web-assistant-session`：用户固定 session。
- `.apollo/users/<用户 id>/workspace/.apollo/entry-sessions/`：各对话的独立 session。
- `.apollo/users/<用户 id>/workspace/artifacts/`：该用户的 Agent 产出文件。

Web Apollo 使用 `configMode: "isolated"`，只读取项目内显式配置和项目 `.env`，不会读取 CLI 的 `~/.apollo` 配置。用户之间不共享配置、会话、记忆或文件。

服务端运行时按用户隔离，用户之间不共享 Engine、session 路径、审批回执或文件工作区。默认单节点最多同时运行 8 个 Agent 任务、每个账号最多 3 个；超过限制返回 `429` 和 `Retry-After`。每个账号默认有 2GB 工作区配额，服务器保留至少 512MB 可用磁盘。生产存活与就绪检查分别为 `/livez`、`/healthz`。

对话产出物展示 Word、PDF、JPG、JPEG、PNG、WebP；文件库另外支持 Markdown 和 JSON，并可递归展示已授权本地目录中的上述文件。用户仍可上传其他允许格式作为 Agent 输入。文件结果由工具通过结构化 `artifacts` 上报，不依赖模型正文中的路径猜测。

所需环境变量见 `.env.example`。密钥只在服务端读取，不得提交 `.env`。

## 安全默认值

- 默认权限是 `ask`。
- `WEB_ALLOW_UNRESTRICTED=false` 时，前端不能启用全自动权限。
- 系统级权限和完整运行时 JSON 配置只有管理员可修改；用户可在部署允许的范围内选择自己的审批模式。
- 注册应配置 `WEB_REGISTRATION_INVITE`，管理员由 `WEB_ADMIN_USERNAME` 显式指定。
- 上传请求有总大小和单文件双重限制；附件和产出物下载会校验真实路径并拒绝符号链接越界。
- Web 永久拒绝系统命令、工作区越界、敏感文件读取、Skill 安装和 MCP 调用；即使启用全自动审批也不会解除这些边界。
- 定时备份单元为 `ops/web-agent-backup.service` 和 `ops/web-agent-backup.timer`，恢复前必须停止应用服务。
