# Apollo 知识库

Apollo 只保留一条清楚的知识库主链路：文档解析、WeKnora 与 LightRAG 双路入库、双路召回融合、LightRAG 知识图谱展示。上游前端、流水线画布、General / QA / Parent-child 模板和 Apollo 本地检索均不再保留。

## 上游集成约定

- 能作为库或前端组件复用的功能直接嵌入 Apollo，只引入实际使用的模块，不运行上游完整前端。
- 跨语言引擎不重写：由 Apollo 启停一个轻量本地进程，并统一管理配置、数据目录和健康检查。
- 项目运行不依赖 Docker；没有必要时不引入上游的数据库、消息队列和管理后台。
- LightRAG 前端只复用 Sigma 图谱画布；Python 核心运行在项目 venv，由工作区网关按知识库隔离。
- WeKnora 使用官方 Lite 单二进制版本（SQLite、内存队列），不运行标准版的 PostgreSQL、Redis、DocReader 和完整 Web UI。

## 文档入库

新知识库按固定顺序处理：选择策略与参数 → 上传文件 → 切片预览 → 确认处理 → 召回测试。文本、Markdown、CSV、JSON 和 HTML 可在浏览器中直接预览切片；PDF、Office 和图片会在正式解析后生成实际切片，避免仅为预览重复调用 MinerU。

上传时只选择一种解析方式：

- **本地解析**：原文件同时交给 WeKnora 和 LightRAG，各自使用内置解析器，不消耗 MinerU 额度。
- **MinerU 高精度解析**：Apollo 调用 MinerU 一次获得文本，再把同一份文本同时写入 WeKnora 和 LightRAG。

页面分别展示两个引擎的处理中、就绪、失败或未配置状态。首次提交失败或后来补齐配置后可以重试；原文件不会长期保存在 Apollo 本地。

知识库设置按引擎职责分开：

- **文档解析**：公共入口；本地解析时两个引擎各自处理，MinerU 时两个引擎共用提取文本。
- **向量检索配置**：WeKnora 的自动推荐、标题结构、版面结构、递归切段或自定义分段，以及分段长度、重叠长度、父子分段、召回数量、检索方式和相似度阈值。
- **知识图谱配置**：LightRAG 的 `local / global / hybrid / mix` 查询模式、图谱展示深度、图谱召回数、实体类型、实体抽取上限和关系抽取配置。
- **高级选项**：WeKnora 父子段长度与上下文扩展、LightRAG 查询 Token 预算，以及 Apollo 最终返回数和统一重排。折叠项不修改即可使用默认值。

切段策略只控制 WeKnora，切片预览也按 WeKnora 参数生成；LightRAG 使用自己的内部文档处理流程构建图谱。实体类型、抽取上限和关系抽取配置属于 LightRAG 建图期设置，有文档后锁定；全部留空或填 0 时直接使用 LightRAG 默认值。

## 检索与图谱

每次查询并行执行 WeKnora 向量、关键词或混合检索，以及用户选择的 LightRAG `local`、`global`、`hybrid` 或 `mix` 检索，使用 RRF 合并候选；开启并配置 SiliconFlow 后再统一重排。WeKnora 的阈值、召回数和上下文扩展，以及 LightRAG 的 `top_k` 与 Token 预算都会进入实际查询请求。Apollo 底座模型只根据最终资料生成一次带来源回答。某一路失败时另一路仍可返回，两个引擎都未配置时返回明确的未配置状态，不再降级到本地 SQLite 检索。

知识图谱页直接读取 LightRAG 的热门实体和子图接口，支持选择中心实体、缩放、拖动和查看实体说明。图谱是只读结果视图，不是另一套处理画布。

## 数据隔离

LightRAG 的文档与图谱路由不会按请求头动态切换存储，因此必须通过工作区网关把每个知识库映射到独立 `--workspace`：

```dotenv
LIGHTRAG_BASE_URL_TEMPLATE=http://127.0.0.1:9700/{collectionId}
```

`{collectionId}` 不能删除，否则不同知识库会共用同一份图谱和索引。Apollo 在首次入库时把实体类型、实体抽取上限和关系抽取配置发送给网关；网关为该知识库生成独立提示配置并启动对应 LightRAG 进程，因此这些建图参数会进入实际抽取流程。

## 环境变量

真实密钥只写在 `.env` 或生产环境，不提交 Git。

```dotenv
WEKNORA_BASE_URL=http://127.0.0.1:18473/api/v1
WEKNORA_API_KEY=
WEKNORA_EMBEDDING_MODEL_ID=
LIGHTRAG_BASE_URL_TEMPLATE=http://127.0.0.1:9700/{collectionId}
LIGHTRAG_API_KEY=
RAG_EXTERNAL_TIMEOUT_MS=300000

SILICONFLOW_API_KEY=
RAG_EMBEDDING_MODEL=BAAI/bge-m3
RAG_EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
RAG_RERANKER_MODEL=BAAI/bge-reranker-v2-m3

RAG_CHAT_API_KEY=
RAG_CHAT_BASE_URL=https://open.bigmodel.cn/api/paas/v4
RAG_CHAT_MODEL=glm-5.2
MINERU_API_KEY=
```

LightRAG 服务自身的 LLM 配置默认复用 Apollo 的 OpenAI 兼容模型；配置 `ANTHROPIC_AUTH_TOKEN` 后，启动脚本会自动改用本地协议适配器，并读取 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_MODEL`。本地执行 `pnpm rag:start` 会启动 LightRAG Python 工作区网关和 WeKnora Lite v0.6.0 原生单程序；v0.7.0 的官方 SQLite 初始迁移与其当前结构体不一致，修复前不用于新库。当前 Lite 构建只补了 SQLite 漏列、启动字段名和 POST 检索路由，未改动检索与切片逻辑。两套引擎均不运行上游完整 UI 或 Docker。

## SQLite 迁移

检测到旧版 `chunk_method`、`pipeline_template`、`pipeline_graph`、`configuration_locked` 或 `chunk_count` 列时，Apollo 会一次性删除并重建全部 `rag_*` 表。旧测试知识库、本地分块和 FTS 索引会被清空；用户、聊天、文件等非 RAG 数据不受影响。

## 上游接口

- [WeKnora 知识库 API](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge-base.md)
- [WeKnora 知识 API](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge.md)
- [WeKnora 切段配置](https://github.com/Tencent/WeKnora/blob/main/docs/CHUNKING.md)
- [LightRAG API Server](https://github.com/HKUDS/LightRAG/blob/main/docs/LightRAG-API-Server.md)
- [MinerU API](https://mineru.net/apiManage/docs)

当前限制：每个账号最多 50 个知识库，每库 500 个文档，单文档最多 20MB。
