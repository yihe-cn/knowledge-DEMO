# SIMUGO 场景召回服务设计文档

**版本**:v1.0
**日期**:2026-05-25
**关联文档**:SIMUGO KB 开发文档 v1.0、闭环钩子设计文档 v1.0
**受众**:技术总监、工程负责人、后端工程师、AI 工程师
**状态**:设计稿,待 review

---

## 0. 文档导读

本文档定义 SIMUGO 场景召回服务(Scenario Recall Service)的产品定位、检索策略、数据模型和工程实现。

**和前序文档的关系**:
- 闭环钩子文档第 8.2 节标注"场景召回服务是新依赖,需要单独 1-1.5 周工作量"——本文档是这个依赖的详细设计
- 不止服务钩子模块,还服务培训部仪表盘的"创建场景"建议、复盘问答的"针对性练习"跳转等多个上游消费者

**核心定位**:这是 SIMUGO 把"问答输入"和"练习资产"做实质连接的关键服务。做不好,钩子点击后无法兑现"针对性练习"的承诺,整个闭环就破产。

**阅读建议**:
- 技术总监:第 1、2、6、7 章
- 后端工程师:第 3、4、5 章
- AI 工程师:第 4 章

---

## 1. 业务定位

### 1.1 这个服务要解决的问题

SIMUGO 内部有一个**资产库**:由场景包构成的所有练习内容。这些资产分散、不索引、不可被语义查询——你只能从场景包列表里翻、按行业筛、按手工 tag 过滤。

但下游有多个**消费方**需要"按学员需求语义找对应场景":
- 钩子二:学员问的情境化问题 → 找最匹配的场景挂钩
- 钩子点击:钩子触发后跳转到具体场景
- 复盘问答:To-Do 关联 KP → 找该 KP 的相关场景
- 培训部仪表盘:"创建场景"建议 → 检查是否已有相关场景再建议
- 评估管线:给学员推荐"下一个该练的场景"
- 学员的"练习探索"入口(v2)

场景召回服务统一服务这些需求,**把场景资产从隐式翻找变成可被语义检索的能力**。

### 1.2 这个服务不解决的问题

- **不动态生成场景**:MVP 阶段只召回已有场景,不创建新场景。"用召回伪装成生成"是钩子文档第 3.2 节明确的产品策略
- **不评价场景质量**:服务返回 top-K 结果,不做"场景好坏"的判断
- **不做学员侧的场景列表展示**:那是练习模块的事,场景召回只是底层能力
- **不参与场景生命周期管理**:场景的创建、修改、下线由作者侧场景管理系统负责
- **不做权限决策**:服务返回所有 candidate,过滤交给调用方(MVP 阶段简化)

### 1.3 性能和质量目标

| 指标 | MVP 目标 |
|------|---------|
| 召回延迟 p95 | < 200ms |
| 召回 top-1 准确率(钩子二场景) | > 70%(相似度 ≥ 0.65 时) |
| 索引规模 | 1000+ 场景同时索引 |
| 召回多样性 | 不同 query 不应总召回同一个"网红场景" |
| 索引更新延迟 | 新场景上线 ≤ 5 分钟可被召回 |

---

## 2. 总体架构

### 2.1 服务边界

```
[多个消费方]
    │
    ├─ HookDecisionService(钩子模块)
    ├─ KbAgenticService(复盘问答)
    ├─ DashboardQueryService(仪表盘建议)
    └─ EvaluationPipeline(下一场景推荐)
    │
    ↓
┌────────────────────────────────────────┐
│ ScenarioRecallService(本文档)          │
│                                         │
│ 入口 API:                               │
│   - recall_by_query(自然语言 query)     │
│   - recall_by_kp(KP_id)                 │
│   - recall_by_learner_state(学员档案)   │
│                                         │
│ 内部组件:                                │
│   - ScenarioIndexer(索引器)             │
│   - ScenarioRetriever(检索器)           │
│   - DiversityReranker(多样性重排)       │
│   - RecallAuditor(审计)                 │
└────────────────────────────────────────┘
    │
    ├─→ [Milvus collection: scenarios]
    ├─→ [MySQL: scenario metadata]
    └─→ [Redis: 召回缓存 + 学员近期召回去重]
```

### 2.2 与 KB 模块的关系

场景召回和 KB Agentic RAG 在技术上有许多相似性(都是 embedding + 检索),但**坚持作为独立服务**,理由:

- **不同的索引内容**:KB 索引文档 chunk,场景索引场景元数据,两类内容的预处理、index 策略、metadata schema 都不同
- **不同的检索目标**:KB 求"信息相关性",场景召回求"练习适配性"(后者要考虑学员状态、难度匹配、多样性等额外维度)
- **不同的更新频率**:KB 入库是批处理,场景库更新更频繁(每次场景上线)
- **未来 Skill 化时的独立单元**:这两个能力应该是两个独立 Skill

### 2.3 三类召回模式

服务对外提供三种召回接口,对应不同消费场景:

| 模式 | 输入 | 用途 |
|------|-----|------|
| `recall_by_query` | 自然语言 query + 学员上下文 | 钩子二的情境化问题召回 |
| `recall_by_kp` | KP id + 学员上下文 | 钩子一的弱 KP 场景召回、To-Do 跳转 |
| `recall_by_learner_state` | 学员档案 + 偏好 | "下一个推荐场景"、新学员引导 |

三种模式共享底层索引和检索引擎,但有不同的输入处理和排序策略。

---

## 3. 数据模型

### 3.1 场景索引的字段设计

场景召回的核心是把场景包的内容**结构化抽取**成一个可被检索的"场景档案"。每个场景索引一条记录,字段如下:

```python
class IndexedScenario(BaseModel):
    # 标识
    scenario_id: UUID
    scenario_version: str  # 跟随场景包版本

    # 基础元数据(直接从场景包配置取)
    title: str
    description_short: str  # 一句话描述(用于钩子文案展示)
    description_long: str   # 详细描述
    industry: str  # 医药代表 / 光学销售 等
    role: str      # 销售代表 / 客户经理 等

    # 场景特征
    customer_persona: str  # 客户人设描述
    scenario_context: str  # 场景情境描述(客户在什么阶段、什么诉求)
    difficulty_level: int  # 1-5
    estimated_duration_min: int  # 预计练习时长(分钟)

    # KP 关联(场景包绑定的 KP)
    covered_kp_ids: list[UUID]
    primary_kp_id: UUID | None  # 主考察 KP

    # 难点和挑战标签
    challenge_tags: list[str]  # 例:["隐性异议", "情绪激动客户", "决策周期长"]

    # 业务/合规标签
    business_tags: list[str]   # 例:["高净值客户", "新产品上市"]

    # 元数据
    enterprise_id: UUID | None  # NULL = platform,有值 = 客户私有场景
    enterprise_visibility: list[UUID]  # 该场景对哪些企业可见
    status: str  # active / draft / deprecated

    # 质量和使用数据(异步更新)
    times_practiced: int = 0
    avg_completion_score: float | None = None
    avg_learner_rating: float | None = None

    # 向量(用于检索)
    embedding_summary: list[float]  # 主向量(基于 title + description 等综合)
    embedding_context: list[float]  # 情境向量(基于 customer_persona + scenario_context)

    # 时间戳
    created_at: datetime
    indexed_at: datetime
```

**几个关键设计判断**:

**为什么有两个 embedding**:
- `embedding_summary`:综合表征,匹配宽泛的语义查询("帮我练习异议处理")
- `embedding_context`:情境表征,匹配具体的情境化查询("客户说我们比竞品贵 30%")
- 检索时根据 query 类型选用不同 embedding 或加权融合

**为什么场景特征字段如此细化**:
- 召回不能只靠"语义相似",还要考虑"练习适配性"
- 难度、时长、挑战标签让 reranking 阶段能做精细化排序
- 这些字段大部分场景包已有(从作者侧场景设计流程获得)

**关键缺失的字段**:**关键转折点**(场景中的核心交互节点)。MVP 阶段不要求场景包提供此字段,但 v2 应该补——这是召回精度提升的关键。

### 3.2 MySQL 元数据表

```sql
CREATE TABLE scenario_index (
    scenario_id VARCHAR(64) PRIMARY KEY,
    scenario_version VARCHAR(20) NOT NULL,

    title VARCHAR(200) NOT NULL,
    description_short VARCHAR(500) NOT NULL,
    description_long TEXT,

    industry VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL,
    customer_persona TEXT,
    scenario_context TEXT,
    difficulty_level TINYINT NOT NULL,
    estimated_duration_min INT NOT NULL,

    covered_kp_ids JSON NOT NULL,  -- ["kp_id_1", "kp_id_2"]
    primary_kp_id VARCHAR(64),

    challenge_tags JSON,
    business_tags JSON,

    enterprise_id VARCHAR(64),  -- NULL = platform
    enterprise_visibility JSON,
    status VARCHAR(20) NOT NULL DEFAULT 'active',

    times_practiced INT NOT NULL DEFAULT 0,
    avg_completion_score FLOAT,
    avg_learner_rating FLOAT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP NOT NULL,

    INDEX idx_industry_status (industry, status),
    INDEX idx_primary_kp (primary_kp_id),
    INDEX idx_enterprise (enterprise_id)
);

-- 学员近期召回记录(用于召回去重和多样性)
CREATE TABLE learner_scenario_recall_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    scenario_id VARCHAR(64) NOT NULL,
    recall_mode VARCHAR(30) NOT NULL,  -- by_query / by_kp / by_learner_state
    recall_source VARCHAR(30) NOT NULL,  -- hook2 / issue_followup / dashboard 等
    triggered_query TEXT,
    triggered_kp_id VARCHAR(64),
    recalled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 后续转化
    clicked_at TIMESTAMP,
    practice_started_at TIMESTAMP,
    practice_completed_at TIMESTAMP,

    INDEX idx_user_recent (user_id, recalled_at),
    INDEX idx_user_scenario (user_id, scenario_id, recalled_at)
);
```

### 3.3 Milvus collection 设计

```
collection: scenarios
  fields:
    scenario_id: VARCHAR(64) primary
    industry: VARCHAR(50) (partition key)
    embedding_summary: FLOAT_VECTOR(1024)  # BGE-M3
    embedding_context: FLOAT_VECTOR(1024)
    enterprise_id: VARCHAR(64)
    status: VARCHAR(20)
    covered_kp_ids: VARCHAR(64)[]  # 数组字段,支持 KP 范围 filter
    difficulty_level: INT8
    metadata: JSON  # 完整 metadata,Milvus 读出后供 ranker 使用
  indexes:
    embedding_summary: HNSW (M=16, efConstruction=200)
    embedding_context: HNSW (M=16, efConstruction=200)
  partition_strategy: by industry
```

partition by `industry` 的原因:绝大多数召回都限定在某个 industry 内,partition 能大幅缩小检索空间。

---

## 4. 召回引擎实现

### 4.1 索引化:把场景包变成 IndexedScenario

**触发时机**:
- 场景包发布:新场景 active → 立刻索引
- 场景包更新:版本变化 → 重新索引(soft delete 旧版本)
- 场景包下线:status → deprecated,从 active 索引中移除
- 全量重建:维护期可触发,周期 < 1 月一次

**索引化流程**:

```python
class ScenarioIndexer:
    async def index_scenario(self, scenario_id: UUID):
        scenario = await scenario_service.get_full_scenario(scenario_id)

        # 1. 抽取结构化字段
        indexed = self._extract_metadata(scenario)

        # 2. 生成 summary embedding
        summary_text = self._compose_summary_text(indexed)
        # = title + " · " + description_short + " · " + ", ".join(challenge_tags)
        indexed.embedding_summary = await self.embedding_client.embed(summary_text)

        # 3. 生成 context embedding
        context_text = self._compose_context_text(indexed)
        # = customer_persona + " · " + scenario_context
        indexed.embedding_context = await self.embedding_client.embed(context_text)

        # 4. 入 Milvus
        await self.milvus.upsert(collection="scenarios", data=[indexed.to_milvus()])

        # 5. 入 MySQL 元数据
        await self.db.upsert("scenario_index", indexed.to_db())
```

**关键设计判断**:

**为什么不直接用场景的"原始 prompt"做 embedding**:
- 场景包的原始 prompt 是给 Roleplay Agent 用的,包含演绎指令、风格控制等"非语义"内容
- 用原始 prompt embedding 会让相似度受这些非语义因素干扰
- 必须抽取出**用户视角的"这个场景在练什么"**作为 embedding 源,这是索引化的核心价值

**summary_text 的拼接策略**:
- 包含 title(直觉性最强)、description_short(高度概括)、challenge_tags(具体痛点)
- 不包含 description_long(噪音太多)
- 不包含 covered_kp_ids(IDs 而非语义)

### 4.2 检索:三种模式的实现

#### 4.2.1 recall_by_query(钩子二的核心)

```python
async def recall_by_query(
    self,
    query: str,
    user_context: UserContext,
    top_k: int = 5,
    filters: ScenarioFilters | None = None,
) -> list[ScoredScenario]:
    # 1. 查询预处理:判断 query 是不是情境化问题
    query_type = await self._classify_query_type(query)
    # 返回 contextual(情境化) / definitional(陈述性) / vague(过于宽泛)

    if query_type == "vague":
        return []  # 宽泛 query 不做场景召回,避免噪音

    # 2. embed query
    query_embedding = await self.embedding_client.embed(query)

    # 3. 选择主 embedding 路径
    if query_type == "contextual":
        # 情境化 query 优先匹配 embedding_context
        primary_field = "embedding_context"
        secondary_field = "embedding_summary"
    else:
        primary_field = "embedding_summary"
        secondary_field = "embedding_context"

    # 4. Milvus 检索(双 embedding 各取 top-20)
    primary_results = await self.milvus.search(
        collection="scenarios",
        vector_field=primary_field,
        query_vector=query_embedding,
        filter=self._build_filter(user_context, filters),
        top_k=20,
    )
    secondary_results = await self.milvus.search(
        collection="scenarios",
        vector_field=secondary_field,
        query_vector=query_embedding,
        filter=self._build_filter(user_context, filters),
        top_k=20,
    )

    # 5. 加权融合(主 0.7、次 0.3)
    fused = self._weighted_fuse(primary_results, secondary_results, 0.7, 0.3)

    # 6. 多样性 + 个人化 rerank
    reranked = await self.diversity_reranker.rerank(
        candidates=fused,
        user_context=user_context,
        top_k=top_k,
    )

    # 7. 记录召回历史
    await self.audit.log_recall(...)

    return reranked
```

**query 类型判断**:

用 Qwen-Max(快、便宜)做一次 prompt 分类:

```
判断下面的提问类型:

提问:"{query}"

类型选项:
- contextual:涉及具体的客户互动情境(例如"客户说...""遇到...怎么办")
- definitional:询问知识或定义(例如"什么是...""...是怎么规定的")
- vague:过于宽泛或没有可练习的情境(例如"销售技巧""怎么做好工作")

只输出类型名称。
```

成本极低,延迟 < 300ms。结果可加 Redis 缓存(query hash 为 key,TTL 1 天)。

#### 4.2.2 recall_by_kp(钩子一、To-Do 跳转用)

```python
async def recall_by_kp(
    self,
    kp_id: UUID,
    user_context: UserContext,
    top_k: int = 5,
    prefer_difficulty: int | None = None,
) -> list[ScoredScenario]:
    # 1. 在 MySQL 用 KP 关联快速过滤(精确)
    candidates = await self.db.query(
        """
        SELECT scenario_id, metadata FROM scenario_index
        WHERE status = 'active'
          AND industry = %s
          AND visible_for_enterprise(%s, enterprise_id, enterprise_visibility)
          AND %s = ANY(covered_kp_ids)
        """,
        user_context.industry, user_context.enterprise_id, str(kp_id),
    )

    if not candidates:
        # 该 KP 没有任何场景,返回空(消费方负责处理)
        return []

    # 2. 没有 embedding-based 召回的必要,直接 rerank
    # rerank 依据:
    #   - primary_kp 匹配度(primary_kp_id == kp_id 加权)
    #   - 难度匹配(用学员该 KP 的 mastery_estimate 推断合适难度)
    #   - 学员历史:近期已练过的扣分
    #   - 质量信号:avg_completion_score、avg_learner_rating
    reranked = await self.diversity_reranker.rerank_by_kp(
        candidates=candidates,
        target_kp_id=kp_id,
        user_context=user_context,
        prefer_difficulty=prefer_difficulty,
        top_k=top_k,
    )

    return reranked
```

**关键设计**:`recall_by_kp` 不走向量检索,因为 KP 关联是离散关系(场景的 covered_kp_ids 数组),走 MySQL filter 即可。向量检索的开销是浪费。

#### 4.2.3 recall_by_learner_state(学员探索/推荐用)

```python
async def recall_by_learner_state(
    self,
    user_context: UserContext,
    intent: RecommendIntent,  # next_practice / explore / fill_weakness
    top_k: int = 5,
) -> list[ScoredScenario]:
    # MVP 阶段简化实现:
    # 1. 拉学员的 weak KPs(mastery < 0.6 且 encounter >= 2)
    weak_kps = await self.kp_registry.get_weak_kps(user_context.user_id)

    if intent == RecommendIntent.fill_weakness and weak_kps:
        # 召回弱 KP 对应的场景
        results = []
        for kp in weak_kps[:3]:
            kp_results = await self.recall_by_kp(kp.id, user_context, top_k=2)
            results.extend(kp_results)
        return self._dedupe_and_rank(results, top_k)

    # 2. fallback:基于学员历史练习模式的协同过滤
    # MVP 简化:推荐"和学员练过的场景同 KP 范畴但难度+1"的场景
    return await self._collaborative_recall_simple(user_context, top_k)
```

**MVP 限制**:`recall_by_learner_state` 是最复杂的模式,MVP 阶段做简化版,主要服务"未来的探索入口",v2 升级为完整的个性化推荐。

### 4.3 DiversityReranker(多样性 + 个人化重排)

仅有相似度排序会导致**召回结果同质化**——同一个 query 总是召回同一批"网红场景"。Reranker 解决这个问题。

```python
class DiversityReranker:
    async def rerank(
        self,
        candidates: list[ScoredScenario],
        user_context: UserContext,
        top_k: int,
    ) -> list[ScoredScenario]:
        # 1. 拉学员近期召回历史(过去 7 天)
        recent_history = await self.db.query_recent_recalls(
            user_id=user_context.user_id, days=7,
        )
        recent_scenario_ids = {h.scenario_id for h in recent_history}
        recent_practiced = {h.scenario_id for h in recent_history if h.practice_completed_at}

        # 2. 调整每个 candidate 的最终得分
        for c in candidates:
            score = c.similarity_score

            # 个人化加权
            if c.scenario_id in recent_practiced:
                score *= 0.3  # 已练过的强降权
            elif c.scenario_id in recent_scenario_ids:
                score *= 0.7  # 近期推过但未练的中度降权

            # 难度匹配
            if user_context.user_avg_difficulty is not None:
                diff_gap = abs(c.difficulty_level - user_context.user_avg_difficulty)
                score *= (1.0 - 0.1 * diff_gap)  # 难度差越大越降权

            # 质量信号
            if c.avg_completion_score is not None:
                score *= (0.8 + 0.4 * c.avg_completion_score)  # 高分场景小幅加权

            c.final_score = score

        # 3. 选 top-K 但保证多样性(贪心:避免同 KP 多个场景挤进 top)
        return self._diverse_top_k(candidates, top_k, diversity_field="primary_kp_id")
```

**关键设计**:

- 个人化降权:学员练过的场景下次召回不要再硬推
- 难度匹配:不要给新手推高难度场景
- 多样性约束:top-3 不要全都来自同一个 KP

**MVP 简化**:Reranker 用纯规则,不用 ML 模型。规则可调整,v2 可升级为 learning-to-rank。

### 4.4 召回质量降级

什么时候返回空结果(不挂钩子、不跳转)?

| 情况 | 处理 |
|------|-----|
| 所有候选 similarity < 阈值(0.65) | 返回空 |
| 该 query 类型为 vague | 返回空 |
| 该 industry 完全无场景 | 返回空 |
| 学员近期 7 天召回历史已覆盖所有 top 候选 | 返回空(避免重复打扰) |
| 候选数量过少(< 2) | 返回 candidate 但不做 reranking |

**核心原则**:**召回质量优先于召回数量。返回空是合法的,挂出低质量场景是有害的。**

### 4.5 学员/客户隔离

| 隔离场景 | 实现 |
|---------|-----|
| 客户 A 不能召回到客户 B 的私有场景 | Milvus filter + MySQL 视图过滤 |
| 客户禁用了某场景 | scenario_index.status = 'deprecated_for_enterprise',filter 排除 |
| 平台默认场景客户可启用/禁用 | enterprise_visibility 数组维护启用列表 |
| 学员所属角色不对该场景开放 | role 字段 filter |

**filter 性能**:把高频 filter 字段(industry、enterprise_id、status)放到 Milvus partition / scalar field,filter 在向量检索前生效,延迟可控。

---

## 5. 召回服务的工程实现

### 5.1 模块组件清单

```
ScenarioRecallService(主入口,FastAPI router)
    ├── ScenarioIndexer(索引化,Celery 任务)
    ├── ScenarioRetriever(检索引擎,核心库)
    ├── QueryClassifier(query 类型判断,LLM 调用)
    ├── DiversityReranker(重排)
    ├── ScenarioMetadataService(MySQL 元数据 CRUD)
    ├── RecallHistoryService(召回历史)
    └── RecallAuditor(审计日志)

依赖:
    ├── KpRegistryService(查 weak KPs)
    ├── ScenarioService(场景包元数据)
    ├── BGE-M3 embedding 服务
    ├── Qwen-Max(QueryClassifier 用)
    ├── Milvus(向量检索)
    ├── MySQL(元数据 + 历史)
    └── Redis(query 分类缓存)
```

### 5.2 入口 API

```python
@router.post("/api/scenario/recall/by_query")
async def recall_by_query_endpoint(
    req: RecallByQueryRequest,
    user: User,
) -> RecallResponse:
    """钩子二、复盘问答等调用"""
    results = await scenario_recall.recall_by_query(
        query=req.query,
        user_context=UserContext.from_user(user),
        top_k=req.top_k or 5,
        filters=req.filters,
    )
    return RecallResponse(scenarios=results)


@router.post("/api/scenario/recall/by_kp")
async def recall_by_kp_endpoint(
    req: RecallByKpRequest,
    user: User,
) -> RecallResponse:
    """钩子一、To-Do 跳转等调用"""
    results = await scenario_recall.recall_by_kp(
        kp_id=req.kp_id,
        user_context=UserContext.from_user(user),
        top_k=req.top_k or 5,
        prefer_difficulty=req.prefer_difficulty,
    )
    return RecallResponse(scenarios=results)


@router.post("/api/scenario/recall/by_learner_state")
async def recall_by_learner_state_endpoint(
    req: RecallByLearnerStateRequest,
    user: User,
) -> RecallResponse:
    """学员推荐、仪表盘"下一步"建议等调用"""
    results = await scenario_recall.recall_by_learner_state(
        user_context=UserContext.from_user(user),
        intent=req.intent,
        top_k=req.top_k or 5,
    )
    return RecallResponse(scenarios=results)


@router.post("/api/scenario/recall/_internal/index")
async def trigger_indexing(scenario_id: UUID):
    """场景包发布时触发索引化(内部接口,有权限校验)"""
    await scenario_indexer.index_scenario_async(scenario_id)
    return {"status": "queued"}
```

### 5.3 Celery 任务

```python
@celery_app.task(queue="scenario_indexing")
def index_scenario_task(scenario_id: str):
    asyncio.run(scenario_indexer.index_scenario(UUID(scenario_id)))


@celery_app.task(queue="scenario_indexing")
def update_scenario_stats_task():
    """每小时一次,更新场景的使用统计(times_practiced 等)"""
    asyncio.run(scenario_indexer.update_all_stats())


@celery_app.task(queue="scenario_indexing")
def rebuild_index_task():
    """全量重建索引(运维操作)"""
    asyncio.run(scenario_indexer.rebuild_all())
```

### 5.4 性能优化要点

| 优化点 | 实现 |
|--------|-----|
| Milvus partition by industry | 检索空间缩小 N 倍 |
| 双 embedding 检索结果缓存 | 同 query 5 分钟内复用结果(Redis) |
| QueryClassifier LLM 调用缓存 | query hash 为 key,TTL 1 天 |
| MySQL 元数据预读 | 检索后批量 SELECT,避免 N+1 |
| Reranker 中的学员历史预拉 | 单次查询,内存计算 |
| 索引化异步 | 场景发布不阻塞,后台 < 5 分钟内完成 |

### 5.5 失败处理

| 失败场景 | 处理 |
|---------|-----|
| Milvus 不可用 | 返回 empty,调用方降级处理(钩子二就不挂钩) |
| QueryClassifier 失败 | 默认 query 类型为 contextual,继续 |
| BGE-M3 embedding 失败 | 主链路失败,返回 error,调用方降级 |
| Reranker 失败 | 跳过 rerank,直接返回 similarity 排序结果 |
| 元数据查询失败 | 返回 partial result(只有 ID 没有 metadata) |

**核心原则**:场景召回失败**不应该阻断主流程**(chatbot 答案仍然返回、To-Do 详情页仍然加载),只是钩子/跳转能力缺失。

---

## 6. 监控和质量评估

### 6.1 关键指标

| 指标 | 定义 | MVP 目标 |
|------|-----|---------|
| 召回延迟 p95 | API 响应时间 | < 200ms |
| 召回延迟 p99 | API 响应时间 | < 500ms |
| 召回成功率 | 返回非空 / 总请求 | > 60%(钩子二)、 > 80%(by_kp) |
| 召回点击率 | 召回结果被点击 / 召回展示 | > 10% |
| 召回转化率 | 召回点击后完成练习 / 召回点击 | > 50% |
| top-1 准确率 | 人工评测的 top-1 适配率 | > 70% |

### 6.2 质量评估方法

**离线评测集**(MVP 阶段建立):

- 收集 100-200 个真实学员 query + 期望召回的场景(人工标注)
- 每次 reranker 规则调整或 embedding 升级,跑评测集
- 指标:top-1 准确率、top-3 召回率、平均排名

**在线 A/B 实验**(MVP 后期 + v2):

- reranker 不同权重的 A/B
- 不同 embedding 模型的 A/B
- 通过对比转化率判断优劣

### 6.3 监控告警

监控大盘:

- 召回延迟趋势(p50/p95/p99)
- 召回成功率(按 mode 拆分)
- 召回点击率(按消费方拆分)
- 索引化任务积压数(应该接近 0)

告警阈值:

- 召回延迟 p95 > 500ms(性能问题)
- 召回成功率突降 > 20%(数据问题或 embedding 问题)
- Milvus 错误率 > 1%(基础设施问题)
- 索引化积压 > 50 条(任务问题)

---

## 7. 工程实现计划

### 7.1 工作量估计

| 子模块 | 工作量(人周) |
|--------|--------------|
| 数据模型 + 迁移脚本 | 0.5 |
| Milvus collection 设置和 client | 0.5 |
| ScenarioIndexer | 1 |
| ScenarioRetriever(三种模式) | 1.5 |
| QueryClassifier | 0.5 |
| DiversityReranker | 1 |
| API endpoints + 权限 | 0.5 |
| Celery 任务和调度 | 0.5 |
| 监控告警 | 0.5 |
| 单元测试 + 集成测试 | 0.5 |
| 离线评测集建立和评测 | 0.5 |
| **合计** | **7.5 人周** |

按 1 个后端工程师 + 0.3 个 AI 工程师协助,约 2 周可完成核心功能,加 1 周做评测和优化。

**与之前估计(1-1.5 人周)的差异**:之前的估计偏乐观,只算了"基础召回"。本文档展开后包含了三种模式、reranker、QueryClassifier、监控等,实际工作量约 2.5 人周。

### 7.2 落地节奏

场景召回服务**必须在闭环钩子之前上线**:

- **Week 14-16**(MVP 主体的尾期):场景召回服务核心实现 + 索引化
- **Week 16-18**:评测和调优
- **Week 18-22**(MVP 上线后):服务闭环钩子模块上线

**为什么不在 MVP 主体期间上线给学员看到**:
- KB MVP 主体期间还没有钩子,服务无消费方
- 提前上线意义不大,反而占用工程资源
- 但要在 KB MVP 上线时索引化已完成,数据基础打好

### 7.3 关键风险

| 风险 | 等级 | 缓解 |
|------|-----|------|
| 场景包元数据质量参差(尤其老场景) | 高 | 索引化阶段加 LLM 辅助补全 metadata,人工 review |
| 召回质量不达标(top-1 < 50%) | 高 | 离线评测集 + reranker 多轮迭代 |
| Milvus 性能问题 | 中 | partition + 索引优化,预压测 |
| 索引化任务积压(场景多时) | 低 | Celery 队列扩 worker |
| 场景库太小召回多样性差 | 中 | MVP 阶段接受,推动场景库扩充 |

### 7.4 对老场景的索引化策略

老场景包的元数据可能缺失字段(challenge_tags、scenario_context 等)。MVP 阶段处理方式:

- **必需字段**(title、description、industry、role):全部必填,缺失则跳过索引(打告警)
- **结构化标签**(challenge_tags、business_tags):LLM 辅助生成,人工 review
- **场景情境描述**(customer_persona、scenario_context):LLM 从场景包剧本中提取,人工 review

这是一个**一次性内容运营工作**,建议在 Week 12-14(KB MVP 主体后期)由 KP 内容运营人员兼做。预计每个老场景 5-10 分钟人工工时。

---

## 8. 设计判断说明

本文档基于以下我做出的设计判断,review 时可以挑战:

| 判断 | 原因 |
|------|------|
| 场景召回作为独立服务,不并入 KB Agentic RAG | 索引内容、检索目标、更新频率都不同 |
| 双 embedding(summary + context) | 不同 query 类型适配不同表征,提升精度 |
| recall_by_kp 不走向量检索,走 MySQL filter | KP 关联是离散关系,向量是浪费 |
| QueryClassifier 用 LLM 不用规则 | LLM 准确率更高,延迟可接受 |
| Reranker 用规则不用 ML 模型 | MVP 阶段无足够数据训练,规则可调 |
| 召回失败不阻断主流程 | 钩子/跳转能力可降级,主答案优先 |
| recall_by_learner_state MVP 简化 | 完整个性化推荐 v2 做 |
| 老场景索引化由内容运营人工 review | 数据质量决定召回质量,值得人工投入 |

---

## 9. 决策请求

请技术总监 review 后回应:

1. **独立服务定位**:场景召回作为独立服务,接受?
2. **工程量调整**:从 1.5 人周调整到 7.5 人周(2-3 周工程时间),接受?
3. **落地节奏**:Week 14-18 实现,MVP 主体后服务钩子,接受?
4. **老场景索引化**:由 KP 内容运营兼做,人工 review,接受?
5. **MVP 三种模式范围**:by_query + by_kp + 简化的 by_learner_state,接受?
6. **离线评测集投入**:0.5 人周用于建立评测集,接受?

---

**文档版本历史**

| 版本 | 日期 | 变更 | 作者 |
|------|------|-----|------|
| v1.0 | 2026-05-25 | 初稿 | 产品负责人 |
