# Apollo RAG 知识库

Apollo 的 RAG 不是把 Dify 或 RAGFlow 整套服务嵌进 Web Agent，而是复用它们经过验证的产品流程：知识库、文档解析、结构化切分、混合召回、重排和来源引用。这样保留核心体验，同时避免引入另一套队列、对象存储、向量数据库和用户体系。

## 用户流程

1. 从侧栏进入“RAG”，创建知识库。
2. 选择可执行流水线模板：自定义基础流水线、通用、父子分段、问答、上下文增强、LLM 生成问答或复杂 PDF。
3. 上传资料并用“召回测试”检查命中原文。
4. 在对话中明确说“根据我的知识库回答”。Agent 会调用 `rag_search`，并引用知识库和文档名称。

## 流水线执行规则

- 画布中的节点按连线顺序逐个执行，不是展示用流程图。
- 当前只允许一条从“数据源”到“知识索引”的完整路径；分支、悬空节点、循环和未知节点会在保存时被拒绝。
- 数据源后必须连接“内容提取”或“MinerU 解析”，索引前必须经过真实切段节点。
- 父子分段会分别保存父块和子块：检索、向量化使用子块，命中后把所属父块交给召回测试和 Agent。
- “LLM 生成问答”必须配置 `RAG_CHAT_API_KEY` 且后接“问答切段”；模型失败时任务直接失败，不会伪装成已执行后回退到普通切段。
- 首份文档开始处理后锁定流水线，避免同一知识库混用不同处理规则。

## 检索与解析

- 本地 SQLite FTS5 索引始终可用，中文短查询也有字面匹配回退。
- 配置硅基流动后，`BAAI/bge-m3` 生成向量，关键词与向量结果使用 RRF 合并，再由 `BAAI/bge-reranker-v2-m3` 重排。
- PDF、DOCX、文本、Markdown、CSV、HTML 和 JSON 优先本地解析。
- 本地无法提取有效文字，或上传 DOC、PPT/PPTX、XLS/XLSX、图片时，使用 MinerU VLM 解析并读取结果中的 `full.md`。
- 配置智谱后，`glm-4.7-flashx` 只根据召回资料生成带 `[数字]` 来源标记的回答；失败时仍返回原始检索结果。

## 服务端环境变量

真实密钥只写在 `.env` 或生产服务器 `/opt/apollo-web-agent/shared/.env`，不得提交 Git。

```dotenv
SILICONFLOW_API_KEY=
RAG_EMBEDDING_MODEL=BAAI/bge-m3
RAG_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
RAG_CHAT_API_KEY=
RAG_CHAT_BASE_URL=https://open.bigmodel.cn/api/paas/v4
RAG_CHAT_MODEL=glm-4.7-flashx
MINERU_API_KEY=
```

实现参考：[Dify](https://github.com/langgenius/dify)、[RAGFlow](https://github.com/infiniflow/ragflow)、[硅基流动 Embeddings](https://docs.siliconflow.cn/cn/api-reference/embeddings/create-embeddings)、[硅基流动 Rerank](https://docs.siliconflow.cn/cn/api-reference/rerank/create-rerank)、[MinerU API](https://mineru.net/apiManage/docs) 和 [智谱 GLM-4.7](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7)。

## 当前边界

- 处理模板是 Apollo 自己可执行的解析规则，不包含 RAGFlow 的 RAPTOR、GraphRAG、图片知识图谱或邮件连接器。
- 每个账号最多 50 个知识库，每库 500 个文档；单文档最多 20MB。
- 当前语义检索在单节点内扫描最多 10,000 个已向量化分段。只有规模达到这个上限并出现可测量的延迟或召回问题时，再引入专用向量数据库。
