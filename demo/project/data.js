// data.js — knowledge points, dialog script, evaluation
// Demo scenario: 极氪 007 · 郑先生
//
// Knowledge point depth tiers:
//   core   — full content: spec, customerVoice, sources, appliesTo,
//            notApplicable, rebuttals, sales tip
//   detail — lighter: spec, customerVoice, sources, sales tip (no appliesTo, fewer rebuttals)

const KNOWLEDGE = [
  {
    id: 'kp1',
    title: '三电与续航',
    icon: '⚡',
    color: 'cyan',
    summary: '800V 高压架构 · 金砖电池 CLTC 688km',
    progress: 0,
    points: [
      {
        id: 'kp1-1',
        title: '800V 高压架构',
        tier: 'core',
        spec: '全系标配 800V 高压平台。整车高压系统由电池、电机、电控、充电系统协同设计，峰值充电功率 421kW。',
        customerVoice: '充电 15 分钟补能 500 公里——咖啡都没喝完，车就充好了。',
        sales: '客户问"充电要多久"时，先用 800V 切入——它是一切快充能力的底层前提。',
        sources: [
          { type: '官方', label: '极氪官网产品页 · 2024.10' },
          { type: '实测', label: '懂车帝快充实测 · 2024.09' },
        ],
        appliesTo: ['补能焦虑', '长途出行', '商务通勤'],
        notApplicable: ['纯市区代步', '不在意充电时长'],
        rebuttals: [
          {
            q: '可你们快充桩没特斯拉多吧？',
            approach: '承认覆盖差距，但说明 800V 平台兼容 400V 桩仍可正常充；再把话题引向"日常 70% 是家充/公司充"的真实节奏。',
          },
          {
            q: '800V 听着唬人，实际差别有多大？',
            approach: '不讲技术，讲场景：同样补 300km，800V 平台约 7 分钟，400V 普遍 20 分钟以上。',
          },
        ],
      },
      {
        id: 'kp1-2',
        title: '金砖 / 麒麟电池',
        tier: 'core',
        spec: '自研金砖电池 CLTC 688km；可选麒麟电池 CLTC 最长 870km。',
        customerVoice: '上海到合肥，中间不用充。开 600 公里之后才需要找桩。',
        sales: '面对续航焦虑，按客户用车里程匹配版本，不要无差别推顶配。',
        sources: [
          { type: '官方', label: '极氪 007 配置表 · 2024.09' },
          { type: '内部', label: 'CLTC 测试报告 · 极氪研发' },
        ],
        appliesTo: ['续航焦虑', '长途出行', '不愿意频繁充电'],
        notApplicable: ['通勤里程 < 30km', '已有家充桩、不在意单次续航'],
        rebuttals: [
          {
            q: 'CLTC 都是吹的，实际能跑多少？',
            approach: '坦诚 CLTC 与实际有差距（约 7-8 折），用实测里程举例；再问客户日常单程通勤多少 km，反向匹配版本。',
          },
          {
            q: '电池用几年会不会衰减一半？',
            approach: '引用电池质保政策（8 年/16 万公里电芯衰减不超 30%），并说明慢充为主能显著延缓衰减。',
          },
        ],
      },
      {
        id: 'kp1-3',
        title: '补能速度',
        tier: 'core',
        spec: '10%–80% 最快约 10.5 分钟，充电 15 分钟续航补充 500km 以上。',
        customerVoice: '一杯咖啡的时间，能再开 500 公里。',
        sales: '具体到分钟和公里——"一杯咖啡，再开 500 公里"比"很快"有力得多。',
        sources: [
          { type: '官方', label: '极氪官网快充参数 · 2024.10' },
          { type: '实测', label: '汽车之家高速场景测试 · 2024.08' },
        ],
        appliesTo: ['长途出行', '商务出差', '中途休息节奏紧凑'],
        notApplicable: ['绝大多数时间慢充'],
        rebuttals: [
          {
            q: '充电桩不是它的车占着我也充不上吗？',
            approach: '认可排队问题确实存在，但 800V 让单车占桩时间显著缩短——同样一个桩，翻台速度更快也间接缓解。',
          },
        ],
      },
      {
        id: 'kp1-4',
        title: '低温热管理',
        tier: 'core',
        spec: '电池自加热 + 整车热泵。零下低温环境下主动维持电池工作温度，减少续航释放损失。',
        customerVoice: '东北的冬天里，车自己会"取暖"，电池不是硬扛低温。',
        sales: '北方客户的核心顾虑。先共情冬季体验，再用自加热具体机制回应，不要只丢一个续航数字。',
        sources: [
          { type: '官方', label: '极氪冬测白皮书 · 2024.02' },
          { type: '实测', label: '懂车帝漠河冬测 · 2024.01' },
          { type: '内部', label: '热管理培训手册 v3' },
        ],
        appliesTo: ['北方用户', '冬季长途', '过年返乡'],
        notApplicable: ['长期南方用车'],
        rebuttals: [
          {
            q: '我朋友的电车冬天掉电掉得厉害，你们能比？',
            approach: '不否认电车冬季普遍衰减，但区分"被动失温"和"主动加热"。具体讲机制：金砖电池有加热回路，热泵把电机余热回收给电池。',
          },
          {
            q: '热泵这套东西故障率会不会高？',
            approach: '引用整车质保 + 三电终身质保（首任车主）。热泵是成熟方案，特斯拉/比亚迪等都在用，不是黑科技。',
          },
        ],
      },
    ],
  },
  {
    id: 'kp2',
    title: '智能驾驶',
    icon: '◎',
    color: 'violet',
    summary: '激光雷达 + 双 OrinX · 浩瀚智驾 2.0 全系标配',
    progress: 0,
    points: [
      {
        id: 'kp2-1',
        title: '感知硬件',
        tier: 'core',
        spec: '激光雷达 + 双 OrinX 芯片全系标配，总算力 508 TOPS。',
        customerVoice: '车上多一双"眼睛"，雨雾天看不清的场景，它能补上。',
        sales: '当客户对比特斯拉时，硬件冗余是最有力的差异点——纯视觉方案在恶劣天气下有边界。',
        sources: [
          { type: '官方', label: '极氪智驾发布会 · 2024.04' },
          { type: '内部', label: '产品力培训手册 v5' },
        ],
        appliesTo: ['夜间通勤', '雨雾天行驶', '家用安全顾虑', '智驾对比'],
        notApplicable: ['完全不开智驾的客户'],
        rebuttals: [
          {
            q: '激光雷达不是有点过时了吗？特斯拉只用摄像头也能跑。',
            approach: '不评价对方路线对错。讲事实：纯视觉在逆光、雨雾、夜间会有性能掉点，激光雷达提供主动测距冗余。两条路线都在演进，硬件多一层兜底。',
          },
          {
            q: '听说激光雷达坏一次几万块？',
            approach: '维修成本确实是顾虑。明确告知质保覆盖范围 + 自费维修参考价；强调发生概率极低，把话题引回日常体验价值。',
          },
        ],
      },
      {
        id: 'kp2-2',
        title: '浩瀚智驾 2.0',
        tier: 'detail',
        spec: '高速领航辅助 + 城区领航辅助 NOA，覆盖通勤主流场景。',
        customerVoice: '上下班这段路，从家小区到公司停车场，几乎全程辅助。',
        sales: '用通勤场景具体化，让客户在脑子里"看到"自己的路线。',
        sources: [
          { type: '官方', label: '浩瀚智驾 2.0 OTA 公告 · 2024.07' },
        ],
        rebuttals: [
          {
            q: '城区 NOA 是不是经常需要接管？',
            approach: '坦诚目前仍是辅助驾驶不是自动驾驶，需要接管的场景客观存在；但相比一年前能接管次数显著下降。建议客户试驾时亲自体验通勤段。',
          },
        ],
      },
      {
        id: 'kp2-3',
        title: '全系标配不额外收费',
        tier: 'detail',
        spec: '高阶智驾功能不需要额外订阅或后期解锁，硬件软件一次到位。',
        customerVoice: '不用每年再交一笔订阅费，买回家就是全功能的。',
        sales: '帮客户算"三年总成本"——一次性 vs 订阅累计，自然展现性价比。',
        sources: [
          { type: '官方', label: '极氪官网选装说明 · 2024.10' },
        ],
        rebuttals: [
          {
            q: '不会以后再出个 XX Pro 版收钱吧？',
            approach: '坦诚未来 OTA 可能有付费增值功能（行业普遍如此），但已交付的硬件能力不会被锁。把承诺写进购车合同里。',
          },
        ],
      },
      {
        id: 'kp2-4',
        title: '智能座舱',
        tier: 'detail',
        spec: '8155 芯片 · 多屏交互 · 全场景语音。',
        customerVoice: '"开空调到 23 度"——一句话，孩子在后排说也认。',
        sales: '试驾时让客户亲自唤起一次语音——体验比参数更打动人。',
        sources: [
          { type: '官方', label: '极氪 007 配置表 · 2024.09' },
        ],
        rebuttals: [
          {
            q: '车机会不会用两年就卡？',
            approach: '说明 8155 是当前主流方案，覆盖未来 3-5 年迭代。再带客户在车里实际触一下流畅度。',
          },
        ],
      },
    ],
  },
];

const CUSTOMER = {
  name: '郑先生',
  age: 36,
  job: 'IT 工程师 · 互联网公司技术总监',
  budget: '约 25 万',
  family: '已婚 · 一个 5 岁女儿',
  city: '上海 · 老家黑龙江',
  context: '油换电首购 · 市区通勤为主 · 老家黑龙江 · 刚从隔壁特斯拉门店出来',
  avatar: '郑',
  mood: { interest: 50, trust: 40 },
  tagline: '理性 · 爱比较 · 注重数据',
  motivation: '现有燃油车开了 6 年，想换辆电车作为家庭主力用车。最近在看 Model 3 和小米 SU7，今天专程来对比 007。',
  personality: [
    '理性偏分析型——会问具体数据和原理',
    '不喜欢被推销话术包围，反感"放心""相信我"',
    '听到具体场景描述会眼睛一亮',
    '懂一点技术，能识别忽悠',
  ],
  concerns: [
    { tag: '冬季续航', detail: '老家黑龙江，过年要长途回家，担心低温衰减' },
    { tag: '智驾对比', detail: '刚从特斯拉门店出来，对 FSD 有先入为主印象' },
    { tag: '补能效率', detail: '长途路上不愿意等很久充电' },
    { tag: '价格', detail: '预算紧，对配置取舍敏感' },
    { tag: '家用安全', detail: '主要载妻女出行，对智驾稳定性看重' },
  ],
  promptSeed: `你扮演一位到极氪 4S 店看车的客户，名字是郑先生，36 岁，IT 工程师，预算约 25 万。
你性格理性、爱比较、注重数据，不喜欢套话；老家黑龙江，过年要开车回去；刚从隔壁特斯拉门店出来在做对比；
家里有妻子和 5 岁女儿，换车主要作为家用主力车。
你今天主要的顾虑：(1) 冬季续航低温衰减；(2) 智驾对比特斯拉 FSD；(3) 补能速度；(4) 价格；(5) 家用安全。
对话规则：
- 你是客户，不是销售。保持客户视角，问问题、表达顾虑、给反应。
- 短回复，一次说 1-2 句话，不超过 60 字。
- 销售如果说得好（有具体数据、共情、引导你聊场景），你会更感兴趣，态度松动。
- 销售如果套话、贬低对手、回避问题，你会冷淡、产生抵触。
- 不要主动提到你的"5 个顾虑列表"，自然带出。
- 不要扮演销售或旁白。`,
};

// Dialog script. Each turn also lists `recommendedKp` — the KP ids the
// ammo strip surfaces to the student under the customer's bubble.
const SCRIPT = [
  {
    id: 't1',
    customer: '小伙子，我刚从隔壁特斯拉看了一圈，Model 3 也就这个价钱。你们这 007 有啥不一样的？',
    customerSub: '（语气随意，带点比较的意思）',
    tone: 'neutral',
    recommendedKp: ['kp1-1', 'kp2-1', 'kp2-3'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '先共情 + 反问需求',
        text: '理解，您今天主要在做对比是吧。能先聊聊您平时主要怎么用车吗？通勤、家用、还是兼顾长途？这样我才能给您讲到点上。',
        cites: [],
        skill: '需求挖掘',
        delta: { interest: 8, trust: 12 },
        feedback: '正确——先做需求挖掘，再讲产品，避免一上来堆参数。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '直接抛差异点',
        text: '哥您来对地方了，我们 007 是 800V 平台，激光雷达双 OrinX 全系标配，跟 Model 3 完全两个代差。',
        cites: ['kp1-1', 'kp2-1'],
        skill: '产品知识',
        delta: { interest: 4, trust: -2 },
        feedback: '参数引用准确，但缺少需求挖掘，过早进入推销话术。',
      },
      {
        id: 'c',
        quality: 'bad',
        label: '价格回应',
        text: '我们也有优惠政策的，您要诚心买的话价格好说。',
        cites: [],
        skill: '沟通表达',
        delta: { interest: -6, trust: -10 },
        feedback: '错误——客户还没产生兴趣就谈价格，传递的是"产品没什么可讲"。',
      },
    ],
  },
  {
    id: 't2',
    customer: '我老家黑龙江，过年要开回去。冬天零下二三十度，电车续航不会缩水一半吧？我朋友的车说掉得厉害。',
    customerSub: '（身体前倾，这是真实顾虑）',
    tone: 'concern',
    recommendedKp: ['kp1-4', 'kp1-2', 'kp1-1'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '共情 + 自加热机制',
        text: '您这个担心特别实在，东北用户都会问。007 的电池有自加热功能，整车配热泵——电池在零下也能维持工作温度，不是简单地"硬扛低温"。回老家这种长途，我们可以一起算一下补能节奏。',
        cites: ['kp1-4', 'kp1-1'],
        skill: '异议处理',
        delta: { interest: 12, trust: 15 },
        feedback: '正确——先共情，再用具体技术机制回应，最后把话题引向解决方案。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '只讲参数',
        text: '我们 CLTC 续航 688 公里，麒麟电池版本能到 870。冬天打个折也够您跑的。',
        cites: ['kp1-2'],
        skill: '产品知识',
        delta: { interest: 2, trust: 0 },
        feedback: '引用了续航参数但没回应核心顾虑——客户问的是"低温衰减"，不是标称续航。',
      },
      {
        id: 'c',
        quality: 'bad',
        label: '回避',
        text: '现在电池技术都很成熟了，您放心，没那么夸张。',
        cites: [],
        skill: '异议处理',
        delta: { interest: -4, trust: -12 },
        feedback: '错误——没有事实依据，客户的核心顾虑被一句"放心"打发。',
      },
    ],
  },
  {
    id: 't3',
    customer: '那充电呢？我要是周末跑长途，半路充电不会等到天黑吧？',
    customerSub: '',
    tone: 'concern',
    recommendedKp: ['kp1-3', 'kp1-1'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '具体到分钟和公里',
        text: '不会。800V 平台下，10% 到 80% 最快 10.5 分钟，充 15 分钟就能补 500 公里以上。您中途休息一下、上个洗手间，车也充好了。',
        cites: ['kp1-3', 'kp1-1'],
        skill: '产品知识',
        delta: { interest: 14, trust: 12 },
        feedback: '正确——数据具体、场景化，把"很快"翻译成客户能感知的画面。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '笼统快',
        text: '我们快充很快的，比大部分车都快。',
        cites: [],
        skill: '产品知识',
        delta: { interest: -2, trust: -4 },
        feedback: '没有具体数据，客户无法感知"快"是多快。',
      },
      {
        id: 'c',
        quality: 'good',
        label: '反问引导',
        text: '您一般长途中途会停多久？休息站基本都有快充，您按平时休息节奏开，几乎不用额外等。',
        cites: ['kp1-3'],
        skill: '需求挖掘',
        delta: { interest: 8, trust: 8 },
        feedback: '加分——把补能体验和客户的真实节奏挂钩。',
      },
    ],
  },
  {
    id: 't4',
    customer: '智驾呢？特斯拉的 FSD 名气挺大的，你们能比吗？',
    customerSub: '（带点挑战的语气）',
    tone: 'challenge',
    recommendedKp: ['kp2-1', 'kp2-3', 'kp2-2'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '硬件冗余 + 商业模式对比',
        text: '硬件上我们和它路线不一样——007 全系激光雷达加双 OrinX 芯片，总算力 508 TOPS，是有冗余的方案。功能上高速和城区领航辅助都有。还有一点：这些功能全系标配，不需要额外订阅。FSD 是要持续付费的，您可以算个总账。',
        cites: ['kp2-1', 'kp2-2', 'kp2-3'],
        skill: '异议处理',
        delta: { interest: 15, trust: 12 },
        feedback: '正确——硬件差异 + 商业模式差异双维度对比，没有贬低对方，有数据支撑。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '只讲硬件',
        text: '我们有激光雷达，特斯拉是纯视觉，硬件上我们更强。',
        cites: ['kp2-1'],
        skill: '产品知识',
        delta: { interest: 4, trust: 2 },
        feedback: '提到了关键差异点但没展开。客户还需要知道"硬件强意味着什么"。',
      },
      {
        id: 'c',
        quality: 'bad',
        label: '贬低对方',
        text: 'FSD 在国内根本用不了的，咱们的智驾比它实用多了。',
        cites: [],
        skill: '沟通表达',
        delta: { interest: -8, trust: -10 },
        feedback: '错误——贬低竞品损害专业形象，且没有事实依据。',
      },
    ],
  },
  {
    id: 't5',
    customer: '听起来挺像那么回事。价格能再优惠点吗？',
    customerSub: '（开始进入议价节奏）',
    tone: 'interested',
    recommendedKp: ['kp2-4', 'kp2-3'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '价值锚定 + 推进试驾',
        text: '价格我们一定给您争取最优方案。不过在那之前，您要不要先坐进车里体验一下？尤其是智驾——光听我说没用，您试一次比什么都直接。我现在给您约个试驾？',
        cites: ['kp2-4'],
        skill: '推进成交',
        delta: { interest: 12, trust: 10 },
        feedback: '正确——不直接降价，用体验深化价值，自然推进到试驾环节。',
      },
      {
        id: 'b',
        quality: 'bad',
        label: '直接降价',
        text: '可以的可以的，我去申请一下，应该能再让一些。',
        cites: [],
        skill: '推进成交',
        delta: { interest: 2, trust: -8 },
        feedback: '错误——客户还没建立价值认知，过早让价会降低产品定位。',
      },
      {
        id: 'c',
        quality: 'mid',
        label: '价值复盘',
        text: '价格我们后面可以谈。其实您算笔账，全系标配的智驾就比 FSD 订阅省下来不少。',
        cites: ['kp2-3'],
        skill: '产品知识',
        delta: { interest: 6, trust: 4 },
        feedback: '回归价值是对的，但没有推进到下一步动作。',
      },
    ],
  },
];

// Knowledge point id → which course module / point
const KP_INDEX = {};
KNOWLEDGE.forEach(m => m.points.forEach(p => { KP_INDEX[p.id] = { module: m, point: p }; }));

// ─── 多客户人设库（用于 "AI 考我" 模式切换） ─────────────────
// 第一个保持是郑先生，等同于 CUSTOMER，确保练习模块兼容
const CUSTOMERS = [
  { id: 'zheng', ...CUSTOMER, vibe: '理性挑剔', emoji: '🤓', avatarColor: 'dark' },
  {
    id: 'wang',
    name: '王阿姨',
    age: 56,
    job: '退休中学教师',
    budget: '儿子预算 25 万',
    family: '已婚 · 儿子在上海工作',
    city: '上海',
    context: '儿子陪同看车 · 主要接送孙女上下学 · 第一次买电车',
    avatar: '王',
    tagline: '友善 · 关心实用 · 怕麻烦',
    vibe: '家用关怀',
    emoji: '👵',
    avatarColor: 'warm',
    motivation: '儿子说要给我换辆新车，电车是大势所趋。我自己只想要好上手、不出毛病。',
    opener: '哎哟小伙子，我儿子让我来看看这个 007。说是什么新能源，我这老太太能开吗？',
    personality: [
      '不爱听参数，喜欢听"会不会麻烦"',
      '看到耐心解释会放下戒心',
      '关心售后和上门服务',
      '会问家里人能不能也开',
    ],
    concerns: [
      { tag: '操作复杂', detail: '不懂电车，怕功能太多用不来' },
      { tag: '家用安全', detail: '主要接送孙女，最看重安全' },
      { tag: '售后方便', detail: '坏了去哪修，要不要跑很远' },
      { tag: '充电', detail: '小区老旧能不能装桩' },
    ],
    promptSeed: `你扮演一位 56 岁的退休中学教师王阿姨，由 30 岁儿子陪同来看车。
车主要给你开，用来接送 6 岁孙女上下学。你第一次买电车，对电车有顾虑也有好奇。
性格温和有礼貌，但务实——不喜欢听一堆参数，喜欢听"会不会麻烦""安不安全"。
关键顾虑：(1) 自己开不开得来；(2) 家用安全；(3) 售后是否方便；(4) 小区老旧能不能装桩；(5) 价格不要超过儿子预算。
- 你是客户，不是销售。短回复，一次 1-2 句，不超过 60 字。
- 会用"哎呀""小伙子""你说的这个..."等口语词。
- 销售耐心解释、用类比/生活化场景说话，你会更信任。
- 销售堆参数、专业术语，你会皱眉说"我不太懂这些"。`,
  },
  {
    id: 'zhang',
    name: '张总',
    age: 42,
    job: '建材公司老板',
    budget: '约 30 万 · 想要顶配',
    family: '已婚 · 两个孩子',
    city: '上海',
    context: '本地老板 · 名下已有奔驰 GLC、Model Y · 想试试国产高端',
    avatar: '张',
    tagline: '直接 · 看重面子 · 要 VIP 待遇',
    vibe: '挑剔老板',
    emoji: '💼',
    avatarColor: 'gold',
    motivation: '我开过特斯拉、奔驰 EQS，现在想试试国产高端。要的是开出去有面儿、有差异化。',
    opener: '我在外面看了一圈，你们这个 007跟我那台 Model Y 比，到底好在哪？别跟我堆参数。',
    personality: [
      '不在意参数细节，要差异化体验',
      '看重品牌调性、车主圈子',
      '反感被当韭菜，价格敏感反向（嫌便宜没档次）',
      '会问"你们老板也开这个吗"',
    ],
    concerns: [
      { tag: '品牌调性', detail: '开出去不能掉价、烂大街' },
      { tag: '服务待遇', detail: '上门保养、专属顾问要有' },
      { tag: '稀缺感', detail: '不要满街都是' },
      { tag: '智能体验', detail: '要比 BBA 体验上有突破' },
    ],
    promptSeed: `你扮演一位 42 岁的上海建材公司老板张总，名下已有奔驰 GLC 和 Model Y。
你今天来看车不是因为缺车，而是想要"开出去有面儿"的国产高端。
性格直接、强势、不绕弯，说话简短带威严。
关键顾虑：(1) 品牌调性够不够、会不会满街都是；(2) VIP 服务是不是真的；(3) 智能体验能否超过 BBA；(4) 稀缺感；(5) 价格不重要——但要让你觉得"值"。
- 你是客户。短回复，一次 1-2 句，不超过 60 字。
- 销售用"档次""圈子""稀缺"这种语言你会感兴趣。
- 销售只讲技术参数、谈优惠，你会显得不耐烦。
- 你会主动比较 BBA 和特斯拉，但不爱听销售贬低别家。`,
  },
];

const CUSTOMER_INDEX = {};
CUSTOMERS.forEach(c => { CUSTOMER_INDEX[c.id] = c; });

window.SIMUGO_DATA = { KNOWLEDGE, CUSTOMER, CUSTOMERS, CUSTOMER_INDEX, SCRIPT, KP_INDEX };
