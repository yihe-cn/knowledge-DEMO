# SIMUGO 企业知识库 & Agentic RAG MVP 开发文档

**版本**:v1.0
**日期**:2026-05-25
**受众**:技术总监(决策)、工程负责人(落地)
**状态**:决策草案,待技术总监审核

---

## 0. 文档导读

本文档覆盖 SIMUGO 企业知识库(KB)和基于 KnowledgePoint(KP)架构的 Agentic RAG MVP 的完整工程实现。读完本文档,你应当能够:

- 理解整体架构和模块边界
- 知道每个模块用什么技术组件实现、为什么这么选
- 评估工程团队所需的人力、时间、成本
- 识别项目的关键风险和缓解措施
- 直接据此组建开发团队启动开发

**阅读建议**:
- 技术总监:第 1、2、9、10、11 章
- 工程负责人:全部
- 后端工程师:第 3-7 章
- AI 工程师:第 4、6 章

---

## 1. 业务和产品定位

### 1.1 项目定位

SIMUGO 正在从"AI 练习平台"升级为"**企业能力数字平台**"。本次 MVP 是这次定位升级的核心载体,核心交付物是:

- 企业知识库(KB)接入能力
- 基于 KnowledgePoint(KP)架构的 Agentic RAG
- 学员侧 chatbot 和复盘问答
- 培训部能力图谱可视化

### 1.2 MVP 范围边界

**必做**:KP Registry、KB 入库管线(5 种文档格式)、Agentic RAG 主链路、To-Do 详情页 KP 改造、chatbot 形态 C、培训部能力图谱第一版、合规审计日志

**不做**:多轮对话、Roleplay Agent 实时调 KB、同行对比钩、私有 KP 全能力、Skill 化(下一迭代)、多步 Agentic planning(v2)、第二个行业 KP 切片(光学/医疗器械)

### 1.3 业务关键决策

| 决策项 | 决策 |
|--------|------|
| KP 行业覆盖 | 第一版仅医药代表 |
| 私有化部署需求 | 30% 客户需要,组件选型必须支持 |
| 客户文档形态 | PDF/PPTX/Word/Excel/Wiki 五种 |
| 旧场景包处理 | 硬并存(legacy_v1 + kp_native_v2) |
| 服务模式 | 三阶段(托管 → 共审 → 自助) |
| Chatbot 形态 | C(独立入口 + 全域可问) |

---

## 2. 总体架构

### 2.1 系统分层

```
┌─────────────────────────────────────────────────────────────┐
│  用户层                                                       │
│  - 学员 App(chatbot、复盘报告、To-Do 详情)                  │
│  - 客户管理后台(培训负责人、合规官、IT 管理员)               │
│  - SIMUGO 运营后台(KP 维护、文档复核)                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  API 层(FastAPI)                                            │
│  - Chatbot API、Issue Followup API                          │
│  - KB Admin API、KP Admin API                                │
│  - Internal Service API                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────┬─────────────┬─────────────┬─────────────────┐
│ KP Registry  │ KB Ingestion│ Agentic RAG │ Evaluation       │
│ Service      │ Pipeline    │ (LangGraph) │ Integration      │
└──────────────┴─────────────┴─────────────┴─────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  基础设施层                                                   │
│  MySQL 8 │ Milvus 2.4 │ Redis 7 │ Celery │ 阿里 OSS │ MinIO  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AI 模型层                                                    │
│  Claude Sonnet (推理) │ Qwen-Max (中文/低成本)                │
│  BGE-M3 (embedding) │ BGE-reranker-v2-m3 (rerank)            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 模块清单

| 模块 | 职责 | 主要技术 |
|------|------|---------|
| KP Registry | 知识点本体管理 | FastAPI + SQLAlchemy + MySQL |
| KB Ingestion | 文档入库管线 | Celery + 多种解析库 + LLM |
| KP Identification | KB 入库时识别 KP | Claude/Qwen + BGE-M3 |
| Agentic RAG | 检索 + 综合推理 | LangGraph + Pydantic AI |
| Vector Index | 向量+全文混合检索 | Milvus 2.4 + BGE-M3 |
| Audit Logger | 合规审计日志 | MySQL + 阿里 OSS 归档 |
| Admin Console | 管理后台 | React + Ant Design Pro |
| Permission Service | chunk 级权限 | 基于现有认证扩展 |

### 2.3 核心数据流

**KB 入库**:文件上传 → 抽取 → chunking → 置信度评分 → KP 识别 → 人工复核 → 入向量库 + KP source 绑定

**学员问答**:Query → KP Tagging → Plan(MVP 确定性) → Tool 执行(FAQ + Chunk 并行) → 跨文档综合 → 答案+引用 → 审计落库

**评估管线**:练习转录 → KP 命中识别 → 逐 KP 评估 → issue 派生 → To-Do 生成 → 学员 KP 档案更新

---

## 3. 技术栈选型

### 3.1 选型汇总

| 类别 | 技术 | 版本 | 理由 |
|------|------|------|------|
| 后端语言 | Python | 3.11+ | 与现有栈一致 |
| Web 框架 | FastAPI | 0.110+ | 异步、类型安全、文档自动化 |
| ORM | SQLAlchemy | 2.0+ | async 成熟、类型安全 |
| 主数据库 | MySQL | 8.0+ | 现有栈 |
| 向量数据库 | Milvus | 2.4+ | 见下文 3.2 |
| 缓存 | Redis | 7.x | 现有栈 |
| 消息队列 | Celery + Redis broker | Celery 5.3+ | 见下文 3.3 |
| 对象存储 | 阿里 OSS | - | 现有栈 |
| Agentic 框架 | LangGraph | 最新稳定 | 现有栈 |
| LLM SDK | Anthropic SDK + DashScope SDK | - | Claude + Qwen 官方 |
| Embedding | BGE-M3 | 自托管 | 中文最强,私有部署友好 |
| Reranker | BGE-reranker-v2-m3 | 自托管 | 与 BGE-M3 同源 |
| 数据校验 | Pydantic | v2 | 现有栈 |
| 容器 | Docker + Docker Compose | - | 部署一致性 |
| 编排(可选) | Kubernetes | - | 大客户私有部署 |

### 3.2 向量数据库:为什么是 Milvus

**对比候选**:Milvus、Qdrant、pgvector、Pinecone、阿里 Hologres

**Milvus 胜出原因**:

- **中文 RAG 生态最成熟**:国内最广泛部署,踩坑指南、最佳实践、招聘市场最完整
- **私有化部署成熟**:30% 客户需要私有部署,Milvus 的 standalone 和 cluster 模式都有大量生产经验
- **性能**:对千万级 chunk 规模有清晰扩展路径,蔡司这种大客户的文档量不会被卡
- **混合检索**:支持稠密 + 稀疏向量(MVP 我们要做 dense + BM25 混合检索)
- **生态集成**:LangChain/LlamaIndex/PyMilvus 等都有官方支持

**不选其他的理由**:
- Pinecone:SaaS only,私有化客户无法部署
- Qdrant:国内案例少,Milvus 在国内 IT 部门接受度更高
- pgvector:你们 MySQL 不是 PostgreSQL,引入 PG 仅为向量库不值得
- 阿里 Hologres:厂商绑定,私有化部署客户用不了

**部署方式建议**:
- 公网客户:Milvus standalone(单机)起步,数据量 > 千万 chunk 后切 cluster
- 私有化客户:同 standalone,运维交付方式参考阿里云 OS 文档

### 3.3 消息队列:为什么是 Celery

**对比候选**:Celery、Kafka、RocketMQ、RQ、Dramatiq

**Celery 胜出原因**:

- **Python 原生**:你们栈是 Python,Celery 是事实标准
- **复用 Redis**:已有 Redis,Celery 用 Redis 做 broker 无需引入新组件
- **场景匹配**:KB 入库和 KP 识别是批处理任务,不是高吞吐流式场景,不需要 Kafka 级别的能力
- **可视化**:Flower 提供任务监控
- **重试和死信**:成熟支持

**Celery 配置建议**:
- broker:Redis(已有)
- result backend:Redis(短期) + MySQL(长期归档)
- worker 队列分离:`ingestion`(慢)、`kp_identification`(LLM 调用)、`audit`(轻) 三个独立队列
- 并发数:按 worker 类型调,LLM 调用类 worker 用 prefork 8,IO 类用 gevent 256

### 3.4 LLM 路由策略

| 场景 | 模型 | 理由 |
|------|------|------|
| KP tagger | Claude Sonnet | 准确率最关键,影响整个 RAG 链路 |
| KB 入库 KP 识别 | Claude Sonnet | 错识别成本高(污染 Registry) |
| Agentic synthesizer | Claude Sonnet | 跨文档综合是推理瓶颈 |
| 文档摘要(粗筛用) | Qwen-Max | 量大,Qwen 中文好且便宜 |
| 置信度评估 | Qwen-Max | 简单任务,成本敏感 |
| FAQ 相似度判断 | 仅 embedding,无 LLM | 成本/延迟最优 |
| Embedding | BGE-M3 自托管 | 私有部署友好,中文最强 |
| Reranker | BGE-reranker-v2-m3 | 配套 BGE-M3 |

**私有化部署客户的模型路由**:全部走 Qwen-Max(私有部署用 Qwen 离线版本)+ BGE-M3。Claude 链路在私有部署下不可用,需要做 fallback 设计。

**LLM 调用层封装**:

```python
class LlmRouter:
    """统一的 LLM 调用入口,根据场景和租户路由到对应模型"""

    async def complete(
        self,
        scenario: LlmScenario,  # KP_TAGGER / SYNTHESIZER / SUMMARIZER 等
        prompt: str,
        enterprise_id: UUID,
        output_schema: Type[BaseModel] | None = None,
        **kwargs,
    ) -> LlmResponse:
        # 1. 检查租户配置(私有化部署强制走 Qwen)
        if self._is_private_deployment(enterprise_id):
            model = "qwen-max"
        else:
            model = self._route_by_scenario(scenario)

        # 2. 调用对应 SDK
        # 3. 统一错误处理、计费、审计日志
        # 4. fallback(主模型挂时切到备用)
```

---

## 4. KP Registry 模块

### 4.1 模块职责

- 知识点本体(Domain + KP + Source + Override)的 CRUD
- 学员 KP 档案的实时读写
- 为上层模块(Agentic RAG、Evaluation、Hook)提供 KP 查询服务
- KP 的版本化、企业 override、ownership 管理

### 4.2 数据模型

完整 MySQL DDL 见附录 A。核心表:

- `capability_domain`:能力域(粗粒度,8-15 个/行业)
- `knowledge_point`:知识点(细粒度,80-150 个/行业)
- `knowledge_point_source`:KP 的来源绑定(指向 KB chunk / course section / manual)
- `knowledge_point_enterprise_override`:企业级 KP override
- `issue_template`:issue 模板,关联 KP(或 legacy 手写)
- `scenario_kp_binding`:场景包绑定 KP(新场景用)
- `learner_kp_profile`:学员 KP 掌握度档案

**关键设计**:
- 所有表有 `ownership` 字段(platform_default / enterprise_customized / enterprise_private)
- `enterprise_overrides_allowed` 字段控制哪些字段允许客户 override
- 学员档案表 `learner_kp_profile` 是物化表,异步更新,支持毫秒级钩子决策查询

### 4.3 服务接口

```python
class KpRegistryService:
    async def get_kp(kp_id, enterprise_id) -> KnowledgePoint
    async def list_kps(domain_id, industry, enterprise_id, status) -> list[KP]
    async def get_kps_for_scenario(scenario_id) -> list[ScenarioKpBinding]
    async def search_kps_by_text(query, industry, enterprise_id, top_k) -> list[(KP, score)]
    async def get_kp_sources(kp_id, enterprise_id, source_types) -> list[Source]
    async def bind_kp_source(kp_id, source, confirmed) -> Source
    async def get_learner_kp_profile(user_id, kp_ids) -> list[Profile]
    async def update_learner_kp_profile_from_evaluation(user_id, kp_evaluations)
    async def increment_chatbot_query_count(user_id, kp_ids)
```

**实现要点**:
- 所有读取自动应用企业 override(透明给上层)
- 写入操作有审计 trace(谁、何时、改了什么)
- 高频查询接口加 Redis 缓存(TTL 5 分钟,KP 修改时主动 invalidate)
- `search_kps_by_text` 用 BGE-M3 embedding 检索 + MySQL 元数据过滤

### 4.4 关键技术选择

| 子模块 | 技术 |
|--------|------|
| KP 实体 CRUD | SQLAlchemy 2.0 async + MySQL |
| KP embedding 索引 | Milvus(独立 collection,只装 KP 描述向量) |
| 缓存 | Redis,KP 数据 TTL 5min |
| 版本管理 | 语义版本号 + audit_trail JSONB 字段记录变更历史 |
| 管理后台 | React + Ant Design Pro,调 FastAPI REST API |

### 4.5 KP 内容初始化(一次性工作)

医药代表行业 KP 第一版(80-150 个 KP)的建立流程:

1. **盘点**:导出现有医药相关场景包和 SOP 文档(预计第 0-2 周)
2. **能力域定稿**:8-12 个能力域,产品负责人 + 行业专家定稿(第 1-2 周)
3. **LLM 逆向抽取**:批量跑场景包和 SOP,LLM 输出 KP 候选(第 2-3 周)
4. **人工精校**:SIMUGO 团队 2-3 人 × 2 周,去重、命名、归类(第 3-5 周)
5. **客户 review**:邀请深度共建客户审 KP 命名和分类(第 4-5 周)
6. **入库**:第一批 platform_default KP 入 Registry(第 5-6 周)

**KP 命名规范**(必须在入库前定稿):
- 格式:`[能力域] · [具体动作或知识点]`
- 例:`价格异议处理 · 价值锚定话术`、`不良反应应对 · 24 小时上报流程`
- 字数:能力域 ≤ 8 字,KP 名称 ≤ 20 字
- 必须能让学员一眼理解,不要使用内部黑话

---

## 5. KB 入库管线模块

### 5.1 模块职责

- 接收客户上传的原始文档(PDF、PPTX、Word、Excel、Wiki URL)
- 抽取、清洗、chunking
- 置信度评分和分流(自动入库 vs 人工复核)
- 入向量索引和元数据库
- 触发 KP 识别

### 5.2 入库流程

```
[文件上传] ─→ 阿里 OSS(原始文件归档)
    │
    ├─→ [Celery Task: parse_document]
    │     │
    │     ├─ PDF → 见 5.3
    │     ├─ PPTX → 见 5.4
    │     ├─ Word → 见 5.5
    │     ├─ Excel → 见 5.6(独立 FAQ 路径)
    │     └─ Wiki URL → 见 5.7
    │
    ├─→ [标准化层] 段落切分 + 元数据提取 + 权限边界识别
    │
    ├─→ [chunking 层] 200-800 字符语义切块
    │
    ├─→ [置信度评分] 高/中/低分流
    │     │
    │     ├─ 高 → 自动入库 + 异步 KP 识别
    │     └─ 中/低 → 人工复核队列
    │
    └─→ [入库]
          │
          ├─ chunk 进 Milvus(BGE-M3 embedding + BM25 sparse)
          ├─ chunk metadata 进 MySQL
          └─ 触发 KP 识别 task
```

### 5.3 PDF 处理

**技术选型**:
- 主 OCR:阿里云 OCR 文档识别 API(成本 + 中文质量 + 表格还原)
- 备选:MinerU(自托管,私有部署客户用)
- 版面理解:阿里云 OCR 自带

**关键能力**:
- 区分扫描 PDF 和文字 PDF(有文字层直接抽取,无文字层走 OCR)
- 表格还原(医药文档大量表格,这是关键能力)
- 公式识别(基础支持即可,MVP 不重点投入)

**质量预检规则**(入库前自动检查):
- DPI < 150 的扫描 PDF:拒收,提示客户重新扫描
- 页数 > 500:走特殊大文件队列,异步处理
- 含手写批注:标记 metadata.has_handwriting=true,降低自动入库置信度
- 加密 PDF:拒收

**实现库**:
- `pypdf` / `pdfplumber`:文字层 PDF 处理
- 阿里云 OCR Python SDK:OCR 调用
- `pdf2image`:扫描 PDF 转图片(给 OCR)

### 5.4 PPTX 处理

**复用现有能力**:你们 PPT Presentation Training Module 已有视觉抽取 + pptx 原生增强双路架构,复用之。

**实现库**:
- `python-pptx`:原生抽取
- 视觉路径:你们现有方案

**特殊处理**:老 PPT 大量嵌入扫描图片当背景,视觉路径会比原生路径更可靠,在适配器层做能力路由。

### 5.5 Word 处理

**实现库**:
- `python-docx`:.docx 文件
- **不支持 .doc**:要求客户先转 .docx(libreoffice headless 部署复杂、解析质量差)

**特殊处理**:
- 表格:`python-docx` 抽出后保留为结构化数据,不要扁平化为纯文本
- tracked changes:忽略,只取最终版,metadata 标记 `has_unaccepted_changes`
- 嵌入对象(OLE):跳过,记入 manifest

### 5.6 Excel 处理(FAQ 独立路径)

**关键设计**:Excel 不走 chunk 管线,走 FAQ 独立路径。

**实现**:
- `openpyxl` 解析 .xlsx
- 假定 Excel 结构是 Q&A 表格,需要客户在上传时**指定列映射**(question 列、answer 列、category 列等)
- 每行 = 一条 FAQ 记录,直接入 FAQ 索引
- 每条 FAQ 也尝试 KP 关联(按 question 文本打 KP 标签)

**FAQ 索引存储**:
- Milvus 独立 collection `kb_faq`
- 字段:`question`(向量)、`question_text`、`answer_text`、`enterprise_id`、`permission_scope`、`kp_ids`

**入库简化**:Excel 的人工复核只检查列映射是否正确 + 抽样几条 Q&A 验证质量,不做 chunk 级复核。

### 5.7 Wiki URL 处理

**MVP 实现**:单页 URL 粘贴 → 一次性抓取 → 转 Markdown → 走 Word 类似的文本管线

**技术选型**:
- 抓取:`httpx` + `BeautifulSoup4`
- 转 Markdown:`markdownify`
- 注意:是**快照不是同步**,产品 UI 必须明确说明,过期客户手动重粘贴

**MVP 不做**:Confluence/飞书/语雀 API 集成、自动增量同步、爬虫

### 5.8 置信度评分

**多维评分**:

| 维度 | 评估方法 | 权重 |
|------|---------|-----|
| OCR 质量 | OCR API 自带 confidence | 0.3 |
| 内容连贯性 | Qwen-Max 评估每个 chunk 是否语义完整 | 0.3 |
| 元数据完整度 | 标题、作者、版本等是否齐全 | 0.2 |
| 结构清晰度 | 章节、段落结构是否合理 | 0.2 |

**阈值**(根据 Spike 调整):
- 总分 > 0.85:高,自动入库
- 总分 0.65-0.85:中,进人工复核队列(轻度复核)
- 总分 < 0.65:低,强制人工复核

### 5.9 chunking 策略

**策略**:语义切块,以段落为单位,200-800 字符

**实现**:
- 优先按 Markdown 标题/章节边界切
- 次按段落边界切
- 单段落 > 800 字符时按句子边界切
- 单段落 < 200 字符时与相邻段落合并

**chunk metadata 必填字段**:
- chunk_id、document_id、document_version_id(immutable snapshot)
- position(章节路径 + 段落序号)
- permission_scope(部门/岗位/角色三级)
- content_hash(用于去重和重传检测)
- created_at、source_chunk_method

**实现库**:基础切块自己实现 + `langchain-text-splitters`(辅助)

### 5.10 向量索引设计

**Milvus collection 结构**:

```
collection: kb_chunks
  fields:
    chunk_id: VARCHAR(64) primary
    enterprise_id: VARCHAR(64) (partition key)
    embedding: FLOAT_VECTOR(1024)  # BGE-M3 dense
    sparse_embedding: SPARSE_FLOAT_VECTOR  # BGE-M3 sparse
    permission_scope_hash: VARCHAR(64)  # 用于权限过滤
    kp_ids: VARCHAR(64)[]  # KP 关联(支持空)
    document_id: VARCHAR(64)
    document_version: VARCHAR(20)
    metadata: JSON
  indexes:
    embedding: HNSW
    sparse_embedding: SPARSE_INVERTED_INDEX
  partition_strategy: by enterprise_id

collection: kb_faq
  (类似结构,but for FAQ)

collection: kp_descriptions
  (KP 描述向量索引,用于 KP tagger)
```

**关键设计**:
- 按 `enterprise_id` partition,租户物理隔离
- 同时存 dense + sparse vector,支持混合检索
- 权限过滤在 Milvus 查询时作为 filter expression 应用
- KP 关联存为数组字段,支持"按 KP 范围检索"

---

## 6. KP 识别模块

### 6.1 模块职责

KB 入库时识别每个 chunk 涉及哪些已有 KP,绑定到 `knowledge_point_source` 表。

### 6.2 实现策略

**双层识别**:文档级粗筛 + chunk 级精判

```python
class KpIdentificationPipeline:
    async def identify_for_document(document, industry, enterprise_id):
        # 1. 文档级粗筛
        candidate_kps = await self._document_level_candidates(...)
        # 用 BGE-M3 把文档 summary 和 KP 描述做相似度,筛 top-30

        # 2. chunk 级精判
        bindings = []
        for chunk in document.chunks:
            top_kps = self._embedding_rerank(chunk, candidate_kps, top_k=10)
            judgements = await llm.judge_kp_in_chunk(chunk, top_kps)
            bindings.extend([
                b for b in judgements
                if b.confidence > THRESHOLD_BINDING
            ])

        return DocumentKpIdentificationResult(bindings=bindings, ...)
```

### 6.3 关键参数(Spike 1 后调整)

| 参数 | MVP 初始值 | 调整依据 |
|------|----------|---------|
| 文档级筛选 top-N | 30 | Spike 1 召回率 |
| chunk 级 LLM 判断 top-K | 10 | Spike 1 准确率 |
| 自动 confirm 阈值 | 0.85 | Spike 1 精确率 |
| 进人工复核阈值 | 0.6-0.85 | 平衡复核工作量 |
| 丢弃阈值 | < 0.6 | 避免污染 Registry |

### 6.4 LLM Prompt 设计

**核心 prompt 原则**:
- 强调"严格判断"——chunk 是否**定义/描述**该 KP,不是泛泛相关
- 输出结构化(Pydantic schema):`{kp_id, is_defined, confidence, text_span, reasoning}`
- 一次判断 top-K(10)个 KP,而不是逐个调用,降低成本

**Prompt 模板存储**:
- 存 MySQL 表 `llm_prompt_template`,字段:name、version、template、is_active
- 通过 prompt_id 引用,支持版本化
- 修改 prompt 不发版,但要在审计日志记录 prompt_version

### 6.5 KP 识别成本控制

| 措施 | 实现 |
|------|------|
| 批量提交 | 同文档 chunks 在一个 LLM session 内 |
| 分级 LLM | embedding 筛选用 BGE-M3,LLM 判断用 Claude |
| 缓存 | content_hash 命中跳过 |
| 客户配额 | 每月 KP 识别次数上限,超限走人工 |

**成本估算**:
- 100 页 SOP 文档(200 chunks):约 ¥30-80(Claude Sonnet)
- 100 份文档:约 ¥3000-8000
- 私有化客户走 Qwen-Max,成本约为 1/3

---

## 7. Agentic RAG 模块

### 7.1 模块职责

接收学员的 query,执行检索 + 跨文档综合推理,返回带引用的答案。

### 7.2 LangGraph 实现

**Graph 拓扑**:

```
[entry] → kp_tagger → planner → execute_retrieval → synthesizer → audit_finalizer → [END]
                          ↓                ↓               ↓
                    error_handler ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

**State 定义**:

```python
class KbAgenticState(TypedDict):
    request: KbAgenticRequest
    tagged_kps: list[TaggedKp]
    plan: Plan | None
    retrieval_results: list[RetrievalResult]
    answer: Answer | None
    audit_events: list[AuditEvent]
    error: Error | None
```

### 7.3 Checkpointer:MySQL 自实现

**问题**:LangGraph 官方 checkpointer 不支持 MySQL,只有 SQLite/Postgres。

**方案**:
- MVP:用 SqliteSaver 持久化到本地文件(每个 thread 一个文件),配合阿里 OSS 异步备份
- 后续:实现 MySQL Checkpointer(继承 BaseCheckpointSaver,约 300 行代码)

**MVP 简化**:checkpointer 主要用于审计 trace,我们另有独立的审计日志系统(见第 8 章),checkpointer 用 SQLite 已够用。

### 7.4 各节点实现要点

#### kp_tagger 节点
- 输入:query
- 用 BGE-M3 在 `kp_descriptions` collection 找 top-10 候选 KP
- Claude Sonnet 精判:这个 query 涉及哪些 KP
- 输出:tagged_kps(每个含 kp_id + confidence + reason)
- 副作用:异步更新 `learner_kp_profile.chatbot_query_count_30d`

#### planner 节点(MVP 退化形态)
- 输入:tagged_kps
- 规则:
  - 总是先 FAQ lookup
  - 并行 chunk retrieve(限定 KP 范围)
- 输出:Plan(2 个 PlanStep)
- 注意:确定性逻辑,无 LLM 调用,MVP 阶段延迟 ~0
- v2 升级:换成 LLM-driven planner,Plan 结构不变

#### execute_retrieval 节点
- 输入:Plan
- 并行执行所有 PlanStep,通过 ToolRegistry
- FAQ 短路:如 FAQ 高置信命中(> 0.85),丢弃 chunk 结果
- 输出:retrieval_results

#### synthesizer 节点(MVP 关键难点)
- **简单路径**(FAQ 短路):直接返回 FAQ answer
- **综合路径**(chunk 结果):
  1. 单 chunk 抽事实点(分别 LLM 调用,可并行)
  2. 检测冲突(LLM 检查事实点间是否矛盾)
  3. 生成最终答案(LLM 综合 + 引用回写)
  4. (可选)verification:另一个 LLM 验证答案的每个事实点是否在 chunk 中有支持

**verification 是否开启**:取决于 Spike 3 结果。如果事实准确率 ≥ 95% 不开,< 95% 强制开。

#### audit_finalizer 节点
- 把整次请求的所有 audit_events 落库(见第 8 章)

### 7.5 ToolRegistry 实现

```python
class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, RetrievalTool] = {}

    def register(self, tool: RetrievalTool):
        self._tools[tool.name] = tool

    async def execute(self, step: PlanStep, user_context: UserContext) -> RetrievalResult:
        tool = self._tools.get(step.tool_name)
        # 权限求值:每次重新算
        permissions = await permission_service.compute(user_context, tool.required_permissions)
        query = step.query.with_permissions(permissions)
        return await tool.execute(query)


class KbChunkRetrieveTool(RetrievalTool):
    name = "kb_chunk_retrieve"

    async def execute(self, query):
        # 1. 用 BGE-M3 embed query
        # 2. KP 范围限定:从 KP source 表拿到允许的 chunk_ids
        # 3. Milvus 混合检索(dense + sparse,权重各半)
        # 4. 权限过滤(Milvus filter expression)
        # 5. BGE-reranker rerank,选 top-5
        # 6. 返回 RetrievalResult


class KbFaqLookupTool(RetrievalTool):
    name = "kb_faq_lookup"

    async def execute(self, query):
        # 1. BGE-M3 embed query
        # 2. Milvus FAQ collection 检索 top-3
        # 3. 高阈值过滤(>= 0.82)
        # 4. 返回 RetrievalResult
```

### 7.6 入口 API

```python
@router.post("/api/kb/chatbot/query")
async def chatbot_query(req: ChatbotQueryRequest, user: User):
    """学员 chatbot 入口"""
    kb_request = KbAgenticRequest(
        id=uuid4(),
        query=req.query,
        user_context=UserContext.from_user(user),
        invocation_source="chatbot",
    )
    response = await kb_agentic_service.query(kb_request)

    # 钩子(下一迭代实现,MVP 占位)
    hook = None

    return ChatbotQueryResponse(answer=response.answer, hook=hook)


@router.post("/api/kb/issue/{issue_id}/query")
async def issue_query(issue_id: UUID, req: IssueQueryRequest, user: User):
    """复盘问答入口,绑定 issue_id"""
    issue = await issue_service.get(issue_id)

    kb_request = KbAgenticRequest(
        id=uuid4(),
        query=req.query,
        user_context=UserContext.from_user(user),
        invocation_source="issue_followup",
        bound_issue_id=issue_id,
        forced_kp_scope=[issue.kp_id] if issue.kp_id else None,
    )
    response = await kb_agentic_service.query(kb_request)
    return IssueQueryResponse(answer=response.answer)
```

### 7.7 错误处理和降级

| 错误来源 | 降级 |
|---------|------|
| KP tagger 失败 | tagged_kps 空,后续全量检索 |
| Milvus 连接失败 | 返回友好错误 + 告警 |
| FAQ 索引失败 | 跳过,只走 chunk |
| chunk 0 结果 | synthesizer 输出"未找到相关内容" |
| synthesizer LLM 失败 | fallback 模型(Claude→Qwen) |
| verification 失败 | 答案加"AI 综合,请以原文为准"声明 |
| 全链路超时 | 返回部分结果 + 超时标记 |

每种降级在审计日志明确标记。

---

## 8. 合规审计模块

### 8.1 模块职责

记录 KB Agentic RAG 每次请求的完整 trace,满足医药客户 5-10 年保存的合规要求,支持客户合规官审计查询。

### 8.2 审计数据模型

```sql
-- 审计快照主表(MySQL)
CREATE TABLE kb_audit_snapshot (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    enterprise_id VARCHAR(64) NOT NULL,
    invocation_source VARCHAR(30) NOT NULL,  -- chatbot / issue_followup
    bound_issue_id VARCHAR(64),
    bound_scenario_id VARCHAR(64),

    query TEXT NOT NULL,
    tagged_kps JSON NOT NULL,
    plan JSON,
    retrieval_results_summary JSON,  -- 仅 chunk_ids 和 confidence,详情见步骤表
    answer JSON,

    -- 元数据
    llm_models_used JSON,
    prompt_versions JSON,
    total_latency_ms INT,
    total_token_cost INT,

    -- 状态
    status VARCHAR(20) NOT NULL,  -- success / partial / failed
    error_summary TEXT,

    -- 归档
    archived_to_oss BOOLEAN DEFAULT FALSE,
    archived_path VARCHAR(500),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user (user_id, created_at),
    INDEX idx_enterprise (enterprise_id, created_at),
    INDEX idx_request (request_id)
);

-- 步骤明细表(MySQL,可拆分到不同库)
CREATE TABLE kb_audit_step (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    step_name VARCHAR(50) NOT NULL,  -- kp_tagger / planner / execute_retrieval / synthesizer
    sequence_no INT NOT NULL,

    inputs JSON NOT NULL,
    outputs JSON NOT NULL,

    -- LLM 详细信息(如适用)
    model VARCHAR(50),
    prompt_template_id VARCHAR(64),
    prompt_rendered MEDIUMTEXT,
    completion TEXT,
    tokens_used INT,
    latency_ms INT,

    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NOT NULL,

    INDEX idx_request (request_id)
);
```

### 8.3 长期归档策略

**热数据**(< 90 天):MySQL 主表,可查询
**温数据**(90 天 - 1 年):MySQL 归档分区
**冷数据**(> 1 年):阿里 OSS 归档存储,按 request_id 索引,需要时单独查询

**归档触发**:Celery 周期任务(每日凌晨),把 90 天前数据迁移到归档分区,5 年前数据迁移到 OSS。

### 8.4 客户审计查询能力

客户合规官在管理后台可以:
- 按时间范围 + 用户 + 关键词查询审计记录
- 查看任意一次 query 的完整步骤回放
- 导出审计记录(CSV / JSON / PDF 三种格式)
- 设置审计告警(如错答率超阈值)

API 暴露:
- `GET /api/admin/audit/list`
- `GET /api/admin/audit/{request_id}`
- `POST /api/admin/audit/export`

### 8.5 实现要点

- 审计写入是关键路径,不能因为审计失败导致主流程失败 → 用 Celery 异步写入 + Redis 临时缓冲
- 审计数据敏感,客户合规官的查询有独立权限(独立的 admin role)
- 不上 LangSmith 等 SaaS 工具,审计完全自托管

---

## 9. 评估管线对接 KP

### 9.1 模块职责

把现有评估管线(Layer 2)的输出从"维度评估 → issue 列表"改造为"KP 评估 → issue 派生"。

### 9.2 改造方案:硬并存

**场景包标记**:
- 旧场景:`schema_version = "legacy_v1"`,evaluator 走老路径
- 新场景:`schema_version = "kp_native_v2"`,evaluator 走新路径

**新路径(kp_native_v2)流程**:

```
练习转录
    ↓
[KP 命中识别]
    场景声明的 KP 列表中,每个 KP 在转录里有没有被触发?
    输出:list[(kp_id, triggered, evidence_span)]
    ↓
[逐 KP 评估]
    每个被触发的 KP,用 evaluation_rubric 评分
    输出:list[(kp_id, score_0_to_1, performance_notes)]
    ↓
[未达标 KP → issue 派生]
    score < threshold 的 KP 自动从 issue_template 派生 issue
    填充转录片段、KP 标准定义、改进建议
    ↓
[To-Do 生成]
    生成的 issue 写入 To-Do 表,关联 issue_template_id + kp_id
    ↓
[学员 KP 档案更新]
    异步更新 learner_kp_profile(encounter_count, score 等)
```

### 9.3 KP 评估的 LLM 实现

**Prompt 结构**:
- 输入:场景声明的 KP 列表 + 完整练习转录
- 让 Claude 逐个 KP 判断:
  - 是否被触发(转录里是否包含相关交互)
  - 触发的具体位置(span)
  - 表现评分(基于 KP 的 evaluation_rubric)
- 输出:Pydantic schema 结构化

**性能考虑**:
- 一次练习的 KP 数量通常 5-15 个,可在一次 LLM 调用内完成
- 跨 KP 的 prompt 设计避免相互干扰,每个 KP 独立判断
- LLM 调用走 Celery 异步任务,不阻塞用户

### 9.4 学员 KP 档案的更新逻辑

```python
async def update_learner_kp_profile_from_evaluation(
    user_id, kp_evaluations
):
    for eval_item in kp_evaluations:
        profile = await get_or_create_profile(user_id, eval_item.kp_id)
        profile.encounter_count += 1
        if eval_item.score >= PASS_THRESHOLD:
            profile.pass_count += 1
        else:
            profile.fail_count += 1
        profile.last_encountered_at = now()
        profile.last_score = eval_item.score
        # mastery_estimate 用加权平均(MVP 简化)
        profile.mastery_estimate = compute_mastery(profile)
        await save(profile)
```

---

## 10. 管理后台模块

### 10.1 后台清单

| 后台 | 用户 | 主要功能 |
|------|-----|---------|
| SIMUGO 运营后台 | SIMUGO 团队 | 平台 KP 维护、KB 复核、跨客户数据分析 |
| 客户管理后台 | 客户合规官 / 培训负责人 / IT | 企业 KP 配置、文档管理、能力图谱、审计查询 |

### 10.2 技术选型

- 前端框架:React 18 + TypeScript
- UI 组件库:Ant Design Pro
- 状态管理:Zustand(轻量)
- API 通信:axios + TanStack Query
- 部署:同后端一起,Nginx 反向代理

### 10.3 MVP 必做功能(P0)

**SIMUGO 运营后台**:
- KP CRUD(能力域 + KP)
- KB 文档列表 + KP 绑定复核工作台
- 客户列表 + 客户使用数据

**客户管理后台**:
- 企业 KP 配置(查看 + 启用/禁用)
- 文档上传 + 复核(三阶段服务模式中的"共审"和"自助"阶段使用)
- 能力图谱可视化(第一版)
- 审计日志查询和导出

### 10.4 能力图谱可视化

**这是平台叙事的核心 UI**,值得重点投入:

- 第一层:能力域饼图(各能力域 KP 数量、覆盖率)
- 第二层:点击能力域 → 该域下所有 KP 列表(KP 名称、来源、命中次数、平均得分)
- 第三层:点击 KP → 详情(标准定义、来源文档、相关场景、学员掌握度分布、issue 触发历史)

**实现技术**:Recharts / Apache ECharts(国产、中文友好)

---

## 11. 部署架构

### 11.1 部署拓扑

**公网客户(70%)**:
```
[阿里云 SLB]
    ↓
[FastAPI App * N(K8s)] ← → [MySQL RDS]
                          ← → [Milvus(K8s standalone)]
                          ← → [Redis(阿里云 Redis)]
                          ← → [阿里 OSS]
[Celery Workers * N(K8s)]
[BGE-M3 / Reranker(K8s GPU 节点,共享)]
```

**私有化客户(30%)**:
```
[客户内网 LB]
    ↓
[FastAPI App * N(Docker)] ← → [MySQL(客户提供或我们交付)]
                            ← → [Milvus standalone(Docker)]
                            ← → [Redis(Docker)]
                            ← → [MinIO(替代阿里 OSS)]
[Celery Workers * N(Docker)]
[BGE-M3 / Reranker(Docker + GPU)]
[Qwen-Max 私有部署(客户协议)]
```

### 11.2 资源估算(公网集群,目标支撑 10 个企业客户)

| 组件 | 规格 | 节点数 | 用途 |
|------|------|-------|------|
| FastAPI App | 4C8G | 3 | API 服务 |
| Celery Worker(IO) | 4C8G | 2 | 入库管线 |
| Celery Worker(LLM) | 4C8G | 2 | LLM 任务 |
| BGE-M3 / Reranker | 16C32G + A10 GPU | 2 | embedding 服务 |
| MySQL RDS | 8C32G | - | 主库 |
| Milvus standalone | 16C64G | 1 | 向量库 |
| Redis | 8G | 1 | 缓存 + 队列 |

预估月成本(阿里云):约 ¥25,000-35,000

### 11.3 私有化部署交付

- 提供 Docker Compose 一键部署脚本
- GPU 要求:1 张 A10 / RTX 4090 同等级,用于 BGE-M3
- 文档:部署手册、运维手册、监控告警手册
- 升级机制:版本化的 Docker image,客户拉新镜像即可升级
- 数据迁移工具:从公网迁移到私有(罕见,但要有)

### 11.4 监控告警

- 应用监控:Sentry(错误追踪)+ Prometheus + Grafana(指标)
- 日志:阿里云 SLS(公网)/ ELK(私有)
- 告警:钉钉/企业微信群

**关键告警阈值**:
- API 错误率 > 1%
- LLM 调用失败率 > 5%
- Milvus 查询 p99 > 500ms
- KP 识别错误率 > 5%
- 审计日志写入失败 > 0(零容忍)

---

## 12. 开发计划和组织

### 12.1 团队配置

| 角色 | 人数 | 主要职责 |
|------|------|---------|
| 产品负责人 | 1 | 整体规划、客户对接、KP 内容质量 |
| KP 内容运营 | 2 | 逆向抽取、KP 命名分类、复核 |
| 后端工程师 | 3 | KP Registry、KB 入库、Agentic RAG |
| AI 工程师 | 1-2 | KP 识别、synthesizer、prompt |
| 前端工程师 | 2 | 管理后台、学员侧 UI |
| QA | 1 | 端到端测试、合规验收 |
| DevOps | 0.5 | 部署、监控(可兼) |

**关键角色风险**:KP 内容运营这两个人是新增需求,如果不到位,KP 第一版无法按时建立。建议立刻开始招聘或内部转岗。

### 12.2 18 周里程碑

| 周次 | 里程碑 |
|------|--------|
| 0-2 | 资产盘点、能力域定稿、Spike 1/2/3 启动 |
| 2-4 | KP Registry 数据层 + admin P0 |
| 4-6 | 医药 KP 第一版精校 + 客户 review |
| 6-10 | KB 入库管线 + KP 识别 |
| 8-14 | Agentic RAG(LangGraph 实现) |
| 10-14 | 评估管线改造 + UI 改造 |
| 12-16 | 集成测试 + closed beta |
| 16-18 | 上线准备 + 正式上线 |

### 12.3 关键检查点

- Week 4:KP 第一版 review by 客户
- Week 8:To-Do KP 联动 alpha by 客户
- Week 12:完整链路 demo,3 家客户演示
- Week 14:closed beta 启动
- Week 18:正式上线

### 12.4 关键风险跟踪

| 风险 | 等级 | 缓解 |
|------|-----|------|
| KP 识别准确率不达标 | 高 | Spike 1 优先 |
| 扫描 PDF OCR 质量 | 中 | Spike 2 + SLA 收口 |
| 综合推理事实准确率 | 高 | Spike 3 + verification 降级 |
| 现有资产盘点超估 | 中 | Week 0-2 准确盘点 |
| 客户合规要求超预期 | 中 | Week 1 和客户对齐 |
| LangGraph 生产稳定性 | 中 | 早期压测 |
| KP 内容运营人手 | 高 | MVP 启动前必须落实 |

---

## 13. 附录

### 附录 A:完整 MySQL DDL

(见 5.10 节 chunk metadata 已示意,完整 DDL 由后端工程师按本文档第 4、8 章细化,本文档作为决策稿不展开 SQL)

### 附录 B:LLM Prompt 模板清单

MVP 阶段需要的 prompt 模板(均存 `llm_prompt_template` 表,版本化管理):

- `kp_tagger_v1`:query → 涉及哪些 KP
- `kp_identification_chunk_v1`:chunk + 候选 KP → 是否定义
- `kp_identification_document_v1`:文档 summary → 候选 KP
- `synthesizer_fact_extraction_v1`:chunk → 事实点
- `synthesizer_conflict_check_v1`:多 chunk facts → 是否冲突
- `synthesizer_final_answer_v1`:facts → 答案 + 引用
- `synthesizer_verification_v1`:answer + chunks → 事实准确率
- `evaluation_kp_assessment_v1`:转录 + 声明 KP → 每个 KP 评估
- `document_summary_v1`:文档全文 → summary(粗筛用)
- `confidence_evaluation_v1`:chunk → 内容连贯性分

### 附录 C:第三方组件清单和成本

| 组件 | 用途 | 月成本估算(10 客户) |
|------|------|-------------------|
| 阿里云 OCR | PDF 文档识别 | ¥3,000-5,000 |
| Anthropic Claude API | KP/synthesis 等 | ¥15,000-25,000 |
| 阿里通义 Qwen API | 辅助任务 + 私有客户 | ¥3,000-8,000 |
| 阿里云 OSS | 文档存储 | ¥500-1,000 |
| 阿里云 RDS MySQL | 数据库 | ¥2,000-3,000 |
| 阿里云 Redis | 缓存 + 队列 | ¥500-1,000 |
| 阿里云 ECS / K8s | 应用 + Milvus | ¥10,000-15,000 |
| Sentry | 错误监控 | ¥500 |

**总月成本**:约 ¥35,000-60,000(公网集群,10 家客户规模)

### 附录 D:工程文档之外要补的产品文档

技术文档之外,产品侧还需要:

- KP 命名规范(行业专家定稿)
- 医药代表能力域定义(行业专家定稿)
- KB 文档准入 SLA(给客户合同附件)
- 客户审计需求清单(和客户合规官对齐)
- 三阶段服务模式的判据和定价(商务侧)

### 附录 E:本文档未覆盖、需要后续单独文档的内容

- 闭环钩子的详细实现(钩子零/一/二的 Skill 化设计)
- Skill 化迁移路线(下一迭代)
- 第二个行业(光学/医疗器械)的 KP 切片方案
- 培训部仪表盘的详细 UI 和数据查询设计
- Roleplay Agent 在练习中调 KB 的 v2 设计

---

## 14. 决策请求

本文档提交技术总监 review,请确认以下决策:

1. **总体架构**:KP Registry + KB Ingestion + Agentic RAG + 评估改造 的四模块拆分是否合理?
2. **技术选型**:Milvus / Celery / BGE-M3 / LangGraph / FastAPI 等选型是否接受?
3. **资源投入**:7-10 人 × 18 周的工程团队是否落实?
4. **KP 内容运营**:2 个内容运营角色是否能在 4 周内到位?
5. **客户共建**:深度共建客户(建议医药客户)是否能在 Week 0-2 启动?
6. **预算**:开发期 18 周 + 上线后 12 个月运营预算是否到位?
7. **风险接受**:Spike 验证可能导致 MVP 范围调整,产品和商务侧是否接受?

签字:_______________  日期:_______________

---

**文档版本历史**

| 版本 | 日期 | 变更 | 作者 |
|------|------|-----|------|
| v1.0 | 2026-05-25 | 初稿 | 产品负责人 |
