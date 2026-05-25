# SIMUGO 闭环钩子设计文档

**版本**:v1.0
**日期**:2026-05-25
**关联文档**:SIMUGO KB 开发文档 v1.0
**受众**:产品负责人、技术总监、工程负责人
**状态**:设计稿,待 review

---

## 0. 文档导读

本文档定义 SIMUGO 闭环钩子(Practice Hooks)的产品设计、数据模型、决策逻辑和工程实现。读完本文档,你应当能够:

- 理解每种钩子的形态、触发条件、产品价值
- 知道钩子在整个 SIMUGO 闭环中的位置
- 评估工程实现的工作量和风险
- 直接据此交给工程团队实现

**和 KB 开发文档的关系**:本文档是 KB 开发文档的延伸,聚焦 chatbot 答案后挂的"练习钩子"这一独立产品模块。钩子是 SIMUGO 区别于通用 RAG chatbot 的核心差异化能力,商业上的重要性高于其工程量。

---

## 1. 钩子的本质和产品定位

### 1.1 一句话定义

闭环钩子是 chatbot 答案后挂的**练习入口**,把"知识查询"转化为"针对性能力诊断和练习"。

### 1.2 为什么这件事重要

学员去 chatbot 问问题,表面是要答案,实际上每一次提问都暴露了一个能力缺口——他不会、他记不清、他遇到了实战难题、他在为某个具体场景做准备。**这个缺口才是 SIMUGO 的金矿,不是答案本身。**

通用 chatbot 给完答案就结束了;SIMUGO 的 chatbot 给完答案才刚开始——因为我们有练习引擎、有学员的历史数据、有评估体系。钩子是把这三件事和 chatbot 答案串起来的唯一通道。

如果不做钩子,SIMUGO 的 chatbot 就是把企业 KB 搜索的事做一遍,和 Dify/Coze/钉钉智能问答没有差异。**钩子是形态 C 的差异化兜底**——你既然把 chatbot 做成"全域可问"的开放入口,就必须用钩子把它和练习闭环绑住。

### 1.3 钩子的硬规则

| 规则 | 原因 |
|------|------|
| 每个答案最多挂 1 个钩子 | 多了变成推荐栏,价值密度立刻被稀释 |
| 钩子是答案的一部分,紧贴答案 | 不是答案后面的广告,语言要延续 |
| 必须含具体的个人化数据 | "你上次 62 分"比"你需要练习"强 10 倍 |
| 承诺要兑现 | 点"练习"必须真跳到针对性练习,不是场景列表 |
| 拒绝不计入负反馈 | 学员可能就是要快速查信息没空练,关掉是正常行为 |
| 转化率是北极星指标 | 提问 → 进入练习的转化率,不是 chatbot 回答满意度 |

---

## 2. 钩子分类和优先级

### 2.1 钩子类型

| 编号 | 名称 | 触发条件 | 数据依赖 | MVP 优先级 |
|------|------|---------|---------|-----------|
| 钩子零 | 提问画像钩 | 学员在同一 KP 累计提问 ≥ N 次 | chatbot 提问历史 | **P0 主钩** |
| 钩子二 | 场景召回钩 | 情境化提问 + 有相似场景 | 场景库 | **P0 主钩** |
| 钩子一 | 历史回放钩 | query 命中学员该 KP 的弱表现 | 练习评估历史(learner_kp_profile) | **P1**,活跃学员激活 |
| 钩子四 | 同行对比钩 | 同公司同岗位样本足 | 聚合评估数据 | **v2**,数据底座 MVP 建好 |
| 钩子三 | 知识强化钩 | 纯陈述性知识问答 | 题库(无) | **不做** |

### 2.2 价值密度排序

价值由高到低:钩子一 > 钩子二 > 钩子零 > 钩子四

- **钩子一最高**:用学员自己历史数据,无法被通用 chatbot 模仿,说服力最强
- **钩子二次之**:即时满足感强,体验稀缺
- **钩子零再次之**:个人化但说服力不如钩子一(累计计数 vs 评估分数)
- **钩子四在数据成熟前价值有限**

### 2.3 学员分段策略

因为学员练习密度只有 3.5 次/月,钩子一在 MVP 初期对大多数学员无效。设计**分段命中**策略:

| 学员段 | 判定 | 主钩 | 备钩 |
|--------|-----|-----|-----|
| 冷启动 | 总练习 < 5 次,无 KP 有 ≥ 2 次历史 | 钩子零 | 钩子二 |
| 活跃 | 某 KP 有 ≥ 2 次历史 | 钩子一(限该 KP) | 钩子二 |
| 成熟 | 总练习 ≥ 20 次 | 钩子一 | 钩子二 / 钩子四(未来) |

**关键设计**:钩子一的激活是 KP 粒度的,不是学员整体的——只要某个 KP 上有 ≥ 2 次历史,这个 KP 的问答就能触发钩子一,其他 KP 仍走钩子零。

### 2.4 钩子决策的优先级算法

```
def decide_hook(query, tagged_kps, user_context):
    # 1. 钩子一尝试(价值最高)
    for kp in tagged_kps:
        profile = learner_kp_profile(user_id, kp.id)
        if profile.encounter_count >= 2 and profile.mastery < THRESHOLD_WEAK:
            return Hook1(kp=kp, profile=profile)

    # 2. 钩子二尝试
    if is_contextual_query(query):
        recalled = recall_scenario(query, top_k=1)
        if recalled and recalled.score > THRESHOLD_RECALL:
            return Hook2(scenario=recalled)

    # 3. 钩子零尝试
    for kp in tagged_kps:
        count = chatbot_query_count_30d(user_id, kp.id)
        if count >= THRESHOLD_QUERY_PATTERN:  # 5-7
            return Hook0(kp=kp, count=count)

    # 4. 没钩
    return None
```

**关键设计**:不挂钩子比挂错钩子好。所有条件不满足时返回 `None`,不要硬塞一个泛泛的"推荐"。

---

## 3. 每种钩子的产品形态

### 3.1 钩子零:提问画像钩

**触发文案模板**(可被企业 override):

```
你最近一个月聊到「{kp.name}」已经 {count} 次了。
要不要找个场景练一下,把这块吃透?

[去练习 →]   [先不用]
```

**呈现位置**:chatbot 答案下方,紧贴答案(无视觉分隔线)

**点击行为**:跳转到针对该 KP 的练习(实现见 4.4)

**关键设计判断**:

- 数据用 30 天滚动窗口的提问计数,**不是永久累积**
- 文案是"邀请式"——"聊到 X" / "吃透"是中性偏正向用语
- **不出现"你在 X 上很弱"这类诊断式表述**
- 学员可在设置里关闭"基于提问行为给我推荐"(MVP P0,见 5.4)

### 3.2 钩子二:场景召回钩

**触发文案模板**:

```
想用真实客户练一次吗?
我会模拟一个「{scenario.description_short}」的场景找你聊。

[开始练习 →]   [先不用]
```

**呈现位置**:同上

**点击行为**:跳转到召回到的具体场景(top-1,场景库已有的)

**关键设计判断**:

- **是召回不是生成**——MVP 阶段从场景库召回最相似的现有场景,包装成"为你定制的练习",不真做动态生成。
- 场景描述用 `scenario.description_short`(场景包元数据已有),不要现写
- 召回阈值 ≥ 0.65,低于阈值不挂钩子二
- 同一学员同一场景**24 小时内不重复推荐**(避免被同一场景反复推)

### 3.3 钩子一:历史回放钩

**触发文案模板**(根据学员表现分支):

```
情况 A:近期有失败记录
你最近 3 次在「{kp.name}」上平均 {avg_score} 分,
主要问题是 {top_issue_pattern}。要不要再练一次?

[再练一次 →]   [先不用]

情况 B:有历史但表现尚可,这次提问可能预示遗忘
你在「{kp.name}」上最后一次练习是 {days_ago} 天前,
得了 {last_score} 分。要不要再练一下保持手感?

[去练习 →]   [先不用]
```

**呈现位置**:同上

**点击行为**:跳转到该 KP 关联的场景(优先选学员上次表现差的那个场景,如果有)

**关键设计判断**:

- 文案中的 `top_issue_pattern` 来自学员该 KP 历史 issue 的高频模式(MVP 简化:取最近一次的 issue 描述)
- `days_ago` 用人类可读格式("3 天前"、"两周前"),不写日期
- 分支选择由 `learner_kp_profile.mastery_estimate` 和 `last_encountered_at` 决定

### 3.4 钩子四:同行对比钩(v2 占位)

**MVP 不实现**,但数据底座 MVP 建好,具体见 4.6。

形态预告(v2 上线时):

```
你们部门 {n} 个 {role} 在「{kp.name}」上平均 {peer_avg} 分,
TOP 表现是 {top_score} 分。要不要挑战这个分数?

[挑战练习 →]   [先不用]
```

### 3.5 钩子的视觉规范

(此处需要 UI 设计师细化,本文档给硬约束)

- 与答案文本同区域,不要 card-in-card
- CTA 按钮用主品牌色(参考截图里的深绿)
- 拒绝按钮("先不用")用次级色,不要红色或警示色
- 不要"X 关闭"图标——心理上"关闭"暗示干扰,"先不用"是邀请的延续
- 钩子区域整体高度控制在 80-120px,不要太显眼

---

## 4. 钩子模块的工程实现

### 4.1 架构定位

**关键判断**:钩子模块在 LangGraph **之外**,作为独立服务。

理由:
- 钩子是产品层逻辑(推荐什么练习),不是 RAG 逻辑(检索/合成)
- 钩子的决策依赖学员档案、场景库等数据,这些不属于 RAG state
- 下一迭代的 Skill 化时,钩子可以更自然地拆分为多个 Skill
- 钩子失败不应该影响主答案返回

调用关系:

```
[Chatbot API endpoint]
    ↓
[KbAgenticService.query]  ← LangGraph 在这层
    ↓
得到 KbAgenticResponse
    ↓
[HookDecisionService.decide]  ← 钩子模块在这层,独立
    ↓
合并 KbAgenticResponse + Hook 返回给前端
```

### 4.2 模块组件

```
HookDecisionService(主入口)
    ├── LearnerStageClassifier(学员分段)
    ├── Hook0Resolver(提问画像钩)
    ├── Hook1Resolver(历史回放钩)
    ├── Hook2Resolver(场景召回钩)
    ├── HookTextRenderer(文案渲染,支持企业 override)
    ├── HookAuditLogger(钩子展示和点击审计)
    └── HookConfigService(企业级钩子开关、阈值、模板 override)
```

每个 Resolver 是独立的,失败不影响其他 Resolver。MVP 阶段单进程内,下一迭代可拆为独立服务。

### 4.3 主入口接口

```python
class HookDecisionService:
    async def decide(
        self,
        chatbot_request: ChatbotQueryRequest,
        kb_response: KbAgenticResponse,
        user_context: UserContext,
    ) -> Hook | None:
        # 1. 检查企业级开关
        config = await self.hook_config.get(user_context.enterprise_id)
        if not config.enabled:
            return None

        # 2. 检查学员个人开关
        prefs = await self.user_prefs.get(user_context.user_id)
        if not prefs.hook_recommendations_enabled:
            return None

        # 3. 分段
        stage = await self.classifier.classify(user_context.user_id)

        # 4. 按价值密度顺序尝试
        tagged_kps = kb_response.tagged_kps

        # 钩子一(限活跃/成熟段)
        if stage in (LearnerStage.ACTIVE, LearnerStage.MATURE):
            if config.hook1_enabled:
                hook = await self.hook1_resolver.try_resolve(
                    tagged_kps, user_context
                )
                if hook:
                    return await self._finalize(hook, user_context)

        # 钩子二(全段可用)
        if config.hook2_enabled:
            hook = await self.hook2_resolver.try_resolve(
                chatbot_request.query, kb_response, user_context
            )
            if hook:
                return await self._finalize(hook, user_context)

        # 钩子零(全段可用)
        if config.hook0_enabled:
            hook = await self.hook0_resolver.try_resolve(
                tagged_kps, user_context
            )
            if hook:
                return await self._finalize(hook, user_context)

        return None

    async def _finalize(self, hook: Hook, user_context: UserContext) -> Hook:
        # 文案渲染(应用企业 override)
        hook.rendered_text = await self.renderer.render(hook, user_context)
        # 记录展示审计
        await self.audit.log_hook_impression(hook, user_context)
        return hook
```

### 4.4 钩子点击的 CTA 兑现

点击钩子时,前端调用对应的 CTA API:

```python
@router.post("/api/kb/hook/{hook_id}/accept")
async def accept_hook(hook_id: str, user: User):
    """学员接受钩子,生成针对性练习"""
    hook = await hook_audit.get_hook_by_id(hook_id)

    # 记录点击
    await hook_audit.log_hook_click(hook_id, user)

    # 根据钩子类型决定跳转
    if hook.type == HookType.HOOK0:
        # 钩子零:为该 KP 召回场景
        scenario = await scenario_recall.recall_by_kp(
            kp_id=hook.kp_id,
            user_id=user.id,
        )
        return RedirectResponse(f"/practice/scenario/{scenario.id}")

    elif hook.type == HookType.HOOK1:
        # 钩子一:跳转到学员上次表现差的场景,如无则按 KP 召回
        scenario = await self._select_practice_for_hook1(hook, user)
        return RedirectResponse(f"/practice/scenario/{scenario.id}")

    elif hook.type == HookType.HOOK2:
        # 钩子二:钩子里召回的场景已确定,直接跳转
        return RedirectResponse(f"/practice/scenario/{hook.scenario_id}")
```

### 4.5 数据模型

新增表:

```sql
-- chatbot 提问历史(钩子零、KP 计数用)
CREATE TABLE chatbot_query_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    enterprise_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    query TEXT NOT NULL,
    tagged_kp_ids JSON NOT NULL,  -- ["kp_id_1", "kp_id_2"]
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_kp (user_id, created_at),
    INDEX idx_enterprise (enterprise_id, created_at)
);

-- 钩子展示日志(展示 + 点击,合规审计)
CREATE TABLE hook_event_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    hook_id VARCHAR(64) NOT NULL UNIQUE,
    request_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    enterprise_id VARCHAR(64) NOT NULL,
    hook_type VARCHAR(20) NOT NULL,  -- hook0 / hook1 / hook2 / hook4

    -- 触发上下文
    triggering_kp_id VARCHAR(64),
    triggering_scenario_id VARCHAR(64),
    triggering_data JSON,  -- 计数、分数等具体触发数据

    -- 文案(实际展示的)
    rendered_text TEXT,
    template_id VARCHAR(64),
    template_version VARCHAR(20),

    -- 状态时间
    impression_at TIMESTAMP NOT NULL,
    clicked_at TIMESTAMP,  -- NULL 表示未点击
    rejected_at TIMESTAMP,  -- 显式点"先不用"

    -- 转化(可选,练习完成后回填)
    practice_session_id VARCHAR(64),
    practice_completed_at TIMESTAMP,

    INDEX idx_user (user_id, impression_at),
    INDEX idx_type_enterprise (hook_type, enterprise_id, impression_at)
);

-- 企业级钩子配置
CREATE TABLE hook_enterprise_config (
    enterprise_id VARCHAR(64) PRIMARY KEY,
    hook0_enabled BOOLEAN DEFAULT TRUE,
    hook1_enabled BOOLEAN DEFAULT TRUE,
    hook2_enabled BOOLEAN DEFAULT TRUE,
    hook4_enabled BOOLEAN DEFAULT FALSE,  -- v2 默认关

    -- 阈值 override(NULL = 用 platform 默认)
    hook0_query_count_threshold INT,
    hook1_mastery_threshold FLOAT,
    hook2_recall_score_threshold FLOAT,

    -- 文案 override
    text_templates_override JSON,  -- {hook0: "...", hook1_branch_a: "...", ...}

    -- 数据保留期
    chatbot_query_retention_days INT DEFAULT 30,  -- 30/60/90

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 学员钩子相关偏好
CREATE TABLE user_hook_preferences (
    user_id VARCHAR(64) PRIMARY KEY,
    hook_recommendations_enabled BOOLEAN DEFAULT TRUE,
    -- 未来可扩展更细粒度开关
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**关键设计**:
- `chatbot_query_log` 是钩子零的数据基础,按 user_id + created_at 索引以支持高效"过去 30 天该 KP 提问几次"查询
- `hook_event_log` 完整记录展示和点击,**这是钩子模块的核心审计表**,数据要保留至少 1 年(转化率分析、合规审计)
- 钩子 ID 在创建时生成(UUID),前端把它作为 CTA 的参数回传
- `hook_recommendations_enabled = false` 时**所有钩子都不展示**,而不是只关钩子零——给学员明确的全局退出

### 4.6 钩子四的数据底座(MVP 建,v2 用)

**目的**:MVP 不展示钩子四,但要异步计算和物化"同公司同岗位的 KP 表现聚合"数据,等 v2 直接用。

新增物化表:

```sql
CREATE TABLE peer_kp_aggregation (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id VARCHAR(64) NOT NULL,
    role VARCHAR(50) NOT NULL,  -- 销售 / 医代 / 客服 等
    kp_id VARCHAR(64) NOT NULL,

    sample_size INT NOT NULL,  -- 样本数(隐私保护,< 10 不展示)
    avg_score FLOAT NOT NULL,
    top_score FLOAT NOT NULL,
    p50_score FLOAT NOT NULL,
    p25_score FLOAT NOT NULL,

    computed_at TIMESTAMP NOT NULL,
    UNIQUE KEY uk_enterprise_role_kp (enterprise_id, role, kp_id)
);
```

**计算任务**:Celery beat 每日凌晨更新该表,从 `learner_kp_profile` 聚合。

**MVP 阶段不暴露查询接口**,只是默默积累数据。v2 开放时数据已经够厚。

---

## 5. 心理体感保护

这一节是产品设计的硬约束,不是可选项。

### 5.1 数据可见性

**钩子零的提问画像数据,MVP 阶段仅学员本人可见**,不进入企业 HR/培训部报表。

**理由**:学员一旦感知"我问 chatbot = 暴露我不会",会主动绕开 chatbot 去查资料,KB 模块使用率断崖式下降。

**执行**:培训部仪表盘的"学员能力剖面"页面**不展示** chatbot 提问相关字段。仪表盘只能看到 KP 的练习表现(`learner_kp_profile` 的 encounter/pass/fail 等),不能看 `chatbot_query_count_30d`。

**v2 是否开放给培训部**:不在 MVP 决策范围。如果未来要开放,**必须是聚合视图**(整个部门在某 KP 的提问热度),不能下钻到个体。

### 5.2 文案语气

所有钩子文案遵循:

| 禁用表述 | 推荐表述 |
|---------|---------|
| "你在 X 上很弱" | "聊到 X 这块" |
| "你需要练习" | "要不要练一下" |
| "你犯了 N 个错误" | "上次有些细节没说全" |
| "提升你的能力" | "把这块吃透" |
| "强制" / "必须" | "要不要" / "想不想" |

文案 review 是产品负责人职责,每个新文案上线前 review。

### 5.3 数据保留期

`chatbot_query_log` **默认 30 天滚动**,过期硬删除(不是软删)。

企业可在 `hook_enterprise_config.chatbot_query_retention_days` 配置 30/60/90 三档。**不允许永久保留**——这条规则不可配置。

Celery 周期任务每日凌晨清理过期数据。

### 5.4 学员退出开关

**MVP P0 必做**:学员设置页有一个开关:

```
[设置 / 学习偏好]

智能推荐
  ☑ 根据我的提问行为给我推荐练习
     SIMUGO 会根据你在 chatbot 的提问识别你的学习重点,
     并在合适的时候推荐针对性练习。
     关闭后,你仍然可以正常使用 chatbot 和练习功能。
```

关闭后,**所有钩子都不展示**(不是只关钩子零),给学员明确的全局退出。

技术实现:`user_hook_preferences.hook_recommendations_enabled = FALSE`。

### 5.5 钩子拒绝行为

学员点"先不用"后:
- 记录 `rejected_at`,但**不计入负反馈**
- **不弹"为什么不练"反馈框**
- **不出现"你已经 N 次跳过练习"提示**
- 同一钩子类型 24 小时内可再次推荐(不同 query 可能触发同样钩子,正常)
- 同一具体钩子(hook_id)不再重复推荐

---

## 6. 合规审核

延续 KB 开发文档第 8 章的合规框架。

### 6.1 类型 A:机制开关(MVP 做)

客户企业管理后台暴露:

```
[合规配置 / 钩子设置]

  钩子类型      启用     阈值                  文案
  提问画像钩    [开]     5 次/30 天 [改]      [查看/编辑]
  历史回放钩    [开]     掌握度 < 0.6 [改]    [查看/编辑]
  场景召回钩    [开]     相似度 ≥ 0.65 [改]   [查看/编辑]
  同行对比钩    [关]     -                    -

  数据保留期    30 天 ▾  (30/60/90 可选)
```

实现:`hook_enterprise_config` 表 + admin API + UI。

### 6.2 类型 B:钩子配置审核(MVP 做)

客户合规官可以:
- 编辑各钩子的文案模板(企业版,需要在 `text_templates_override` 落库)
- 调整阈值(在合理范围内,如钩子零 3-10 次,钩子一 0.3-0.8)
- 查看文案模板的"对学员预览"

修改文案上线前**必须经过客户合规官 confirm 流程**(MVP 简化:有审计日志记录修改人 + 时间,不做多人审批工作流)。

### 6.3 类型 C:每条触发实时审核(不做)

技术不可行,不做。文档明确说明。

### 6.4 审计日志

所有钩子的展示和点击都进 `hook_event_log`,客户合规官在管理后台可:
- 按时间 + 用户查询钩子触发记录
- 看到每次钩子展示的完整文案(rendered_text 是实际展示的内容)
- 导出审计记录

---

## 7. 转化率指标和监控

### 7.1 关键指标

| 指标 | 定义 | 目标 |
|------|------|------|
| 钩子展示率 | 有钩子的 chatbot 回答 / 总回答 | 30-50%(过高说明硬塞,过低说明数据不足) |
| 钩子点击率 | 钩子被点击 / 钩子展示 | MVP 阶段 5-15%,v2 提升 |
| 钩子转化率 | 点击后真完成练习 / 钩子点击 | > 50% |
| 拒绝率 | 显式"先不用" / 钩子展示 | < 30%(过高说明文案/精度差) |
| 重复打扰率 | 24h 内被推同样钩子的学员比例 | 0(硬约束,违反即 bug) |

### 7.2 监控面板

SIMUGO 运营后台需要一个**钩子健康度面板**:

- 整体展示率/点击率/转化率(按时间趋势)
- 按钩子类型拆分(钩子零/一/二的表现差异)
- 按 KP 拆分(哪些 KP 的钩子转化高、哪些不行)
- 按客户企业拆分(哪些企业的学员转化高)
- 按学员段拆分(冷启动/活跃/成熟段差异)

实现:基于 `hook_event_log` 物化日 / 周聚合表,前端用 ECharts 展示。

### 7.3 钩子 A/B 测试基础设施

**MVP 必做最简版**:钩子的 prompt 模板有 version 字段,可以同时多版本并存,通过 `enterprise_id` hash 路由(简单分流)。

**MVP 不做**:完整的 A/B 测试平台、复杂分流策略、统计显著性自动判定。

---

## 8. 工程实现计划

### 8.1 工作量估计

| 子模块 | 工作量(人周) |
|--------|--------------|
| 数据模型 + 迁移脚本 | 1 |
| HookDecisionService 主框架 | 1 |
| Hook0Resolver(提问画像) | 1 |
| Hook1Resolver(历史回放) | 1.5 |
| Hook2Resolver(场景召回) | 2(依赖场景召回能力) |
| HookTextRenderer + 模板系统 | 1 |
| HookAuditLogger + 数据保留 | 1 |
| HookConfigService + admin UI | 1.5 |
| 学员退出开关 + 设置页 UI | 0.5 |
| 钩子展示前端组件 + CTA 接入 | 1.5 |
| 监控面板 | 1 |
| 钩子四数据底座 | 0.5 |
| 集成测试 | 1 |
| **合计** | **14 人周** |

按 1 个后端 + 1 个前端 + 0.5 个产品的投入,约 4 周可完成。

### 8.2 关联依赖

钩子模块依赖以下已建立的基础:

- `learner_kp_profile`(KP Registry 已建)
- KP tagger 输出(LangGraph 节点已建)
- 场景库 + 场景包元数据(现有)
- 场景召回能力(scenario_recall_service,可能需要新建轻量版)

**场景召回服务是一个新依赖**,可能需要单独 1-1.5 周工作量。简化方案:用 BGE-M3 embedding 把场景的 description 索引到 Milvus,query 时做 top-K 检索。

### 8.3 落地节奏

建议放在 KB MVP 主体上线后的**首个迭代**实施,而不是和 MVP 并行:

- **MVP 上线阶段(Week 0-18)**:钩子接口预留,但实际返回固定 `null`
- **迭代 1(Week 18-22)**:钩子模块完整实现 + 上线
- **迭代 2(Week 22-26)**:监控数据收集 + 文案/阈值优化
- **迭代 3 之后**:Skill 化重构 + 钩子四上线

**理由**:钩子是产品价值的放大器,不是 MVP 的核心阻断项。MVP 主体上线后再加钩子,客户感受到的是"持续改进",而不是"MVP 太复杂"。

### 8.4 风险清单

| 风险 | 等级 | 缓解 |
|------|-----|------|
| 钩子点击后跳转的场景不够"对口" | 高 | 场景召回质量是钩子兑现的根本,要专门测 |
| 学员反感钩子,使用 chatbot 频次下降 | 中 | 心理体感保护 + 转化率监控,异常立刻调整 |
| 文案过度个性化暴露隐私焦虑 | 中 | 文案 review 严格执行,语气测试 |
| 钩子模块挂掉影响 chatbot 主流程 | 高 | 钩子调用必须有超时+异常吞掉,主答案优先 |
| 企业合规官修改文案导致体验降级 | 中 | 文案 override 有"对学员预览"环节 |
| 钩子频次过高导致打扰 | 中 | "无钩"是合法返回,产品负责人 review 展示率 |

---

## 9. 设计判断说明

本文档基于以下我做出的设计判断,产品负责人 review 时可以挑战:

| 判断 | 原因 |
|------|------|
| 复盘问答不挂钩子 | 复盘场景已有 SOP 卡片 + To-Do 详情,再挂钩子是噪音 |
| 学员"关闭推荐"是 MVP P0 | 心理体感保护一旦上线再补,已造成的伤害收不回 |
| 钩子点击后是召回不是生成 | 质量可控、承诺能兑现;动态生成 v2 再说 |
| 钩子一激活门槛是 KP 粒度的 ≥ 2 次 | 比总练习次数门槛更精准,符合 3.5 次/月密度 |
| 钩子在 LangGraph 之外 | 产品逻辑不应入侵 RAG 逻辑,边界清晰 |
| 钩子在 MVP 主体后的首个迭代上线 | 不是 MVP 阻断,放慢做好 |
| 钩子四 MVP 不做但数据底座要建 | 数据需要时间积累,v2 开放时不能再等 |
| 提问画像数据 MVP 不给培训部 | 防止学员对 chatbot 产生戒备 |

请产品负责人 review 后明确表态(同意 / 调整 / 推翻)。

---

## 10. 决策请求

请技术总监和产品负责人 review 后回应:

1. **优先级和分段策略**:钩子零/一/二的 MVP 优先级和学员分段是否接受?
2. **心理体感保护**:数据可见性、文案语气、数据保留期、学员退出开关——这套保护机制是否接受?
3. **架构定位**:钩子在 LangGraph 之外作为独立服务,是否接受?
4. **落地节奏**:钩子放在 MVP 主体上线后的首个迭代,是否接受?
5. **场景召回新依赖**:是否在本次工作量内包含场景召回服务的轻量实现?
6. **资源**:14 人周(后端+前端+产品)是否能投入?

---

**文档版本历史**

| 版本 | 日期 | 变更 | 作者 |
|------|------|-----|------|
| v1.0 | 2026-05-25 | 初稿 | 产品负责人 |
