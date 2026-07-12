# 威彦达 Web Agent

威彦达的统一智能体入口。网页同时提供两套彼此隔离的 Apollo：

- **统一入口（超级 Apollo）**：普通问答和润色直接回答；标准、规范和条款问题检索工标库；管控一张卡、监理文书、隐患识别、方案审查、图纸对比等业务通过专用 Skill 调用 LangHub。
- **个人助理（个人 Apollo）**：处理用户日常工作，拥有独立配置、固定 session、个人技能和长期记忆，不加载统一入口业务技能。

## 启动

```bash
pnpm install
pnpm dev
```

打开 http://localhost:5173。

Vite 中间件同时承载登录、SQLite 对话记录、Apollo 流式事件、文件上传和产出物下载。开发环境只监听 `127.0.0.1`；生产部署应使用 HTTPS、持久化数据卷和正式 Node 服务，不要直接暴露 Vite dev/preview。

生产构建与启动：

```bash
pnpm build
pnpm start
```

## 配置与隔离

- `config/web-entry-apollo.json`：统一入口公共业务配置模板，默认权限为 `ask`。
- `.apollo/web-entry-config.json`：首次启动时从模板复制的统一入口运行时配置；权限切换只修改该文件，不污染 Git 模板。
- `config/web-assistant-apollo.json`：个人助理部署模板。
- `.apollo/users/<用户 id>/workspace/.apollo/assistant-config.json`：用户首次使用助理时从模板复制出的个人配置，可在助理设置中编辑。
- `.apollo/users/<用户 id>/workspace/.apollo/web-assistant-session`：个人助理固定 session。
- `.apollo/users/<用户 id>/workspace/.apollo/entry-sessions/`：每个统一入口对话的独立 session。
- `.apollo/users/<用户 id>/workspace/artifacts/`：该用户的 Apollo 与 LangHub 产出文件。

Web 两套 Apollo 都使用 `configMode: "isolated"`，只读取项目内显式配置和项目 `.env`，不会读取 CLI 的 `~/.apollo` 配置。统一入口关闭 Apollo 记忆工具；个人助理保留记忆工具。

## 业务 Skill

- `entry-skills/query-engineering-standards`：工标库检索；固定使用 fast 模式，同一用户轮次最多真正请求一次检索服务。
- `entry-skills/run-zhijian-task`：校验业务输入和附件后调用 LangHub，并把新文件下载到当前用户的 `artifacts/`。

管控一张卡和隐患识别只要求一张现场图片；施工方案审查只要求一个方案文件。其他业务继续按 Skill 中的输入清单校验。

同一用户的不同对话可以同时运行；不同 LangHub 项目可并行。同一个 LangHub 项目共享文件工作区，为避免两个对话互相收错成果文件，服务端会对该项目的实际任务调用排队。

对话和文件库只展示 Word、PDF、JPG、JPEG、PNG、WebP；用户仍可上传其他允许格式作为 Agent 输入。文件结果由工具通过结构化 `artifacts` 上报，不依赖模型正文中的路径猜测。

所需环境变量见 `.env.example`。密钥只在服务端读取，不得提交 `.env`。

## 安全默认值

- 默认权限是 `ask`。
- `WEB_ALLOW_UNRESTRICTED=false` 时，前端不能启用全自动权限。
- 统一入口权限只有管理员可修改；个人助理配置和权限归当前用户所有。
- 注册应配置 `WEB_REGISTRATION_INVITE`，管理员由 `WEB_ADMIN_USERNAME` 显式指定。
- 上传请求有总大小和单文件双重限制；附件和产出物下载会校验真实路径并拒绝符号链接越界。
