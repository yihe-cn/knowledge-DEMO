// dataPax.js — 宝怡乐 PAX® 专利配方（婴儿抗反流配方奶粉）
// 学员：医药代表 · 客户：儿科医生（KOL）
// 数据来源：PAX 内训 PPTx —— 详见 Knowledge/PAX 内训/

export const PAX_KNOWLEDGE = [
  {
    id: 'paxm1',
    title: '肠道微生态基础',
    icon: '🧬',
    color: 'sage',
    summary: '肠道是最大免疫器官 · 1000 天关键窗口',
    progress: 0,
    points: [
      {
        id: 'pax1-1',
        title: '肠道——人体最大免疫与代谢器官',
        tier: 'core',
        spec: '肠道聚集了 70% 的免疫细胞和 70% 的人体微生物，营养素代谢水平远远超过肝脏；70% 的神经递质源自肠道，被誉为人体"第二大脑"。希波克拉底："所有的疾病始于肠道"。',
        customerVoice: '我门诊的过敏患儿，菌群多样性确实普遍偏低。',
        sales: '面对医生先建立"肠道≠消化器官"的认知框架。把"菌群-免疫-神经"三轴说清，PAX 的故事才有底座。',
        sources: [
          { type: '文献', label: 'MacDonald T. Science 2005;307:1920' },
          { type: '文献', label: 'Tremaroli V. Nature 2012;489:242-249' },
          { type: '文献', label: 'Cryan JF. Nat Rev Neurosci 2012;13:701-712' },
        ],
        appliesTo: ['学术开场', '建立菌群-免疫认知', 'KOL 沟通'],
        notApplicable: ['家长直接沟通', '快速试用推介'],
        rebuttals: [
          {
            q: '这些机制讲了很多年了，跟你们 PAX 有什么关系？',
            approach: '认可机制是共识，但临床落地仍缺手段。引出 PAX 的差异化——不是又一个益生菌制剂，而是把"益生元 + 抗反流"做进了配方基底。',
          },
          {
            q: '70% 这个比例不同文献口径不一样。',
            approach: '坦诚不同研究口径会有 5-10% 波动。强调结论一致：肠道是免疫调控核心场所，这一点没有争议。',
          },
        ],
      },
      {
        id: 'pax1-2',
        title: '生命早期 1000 天 · 关键窗口期',
        tier: 'core',
        spec: '从受孕到出生后 2 岁的 1000 天内，婴儿肠道菌群从无到有逐步建立，至约 3 岁达到相对稳定。1 岁以内是构建的关键窗口，菌群定植遵循固定轨迹；早产儿、剖宫产儿在这一过程中易错失良机。',
        customerVoice: '错过这个窗口期，后面再补就事倍功半了。',
        sales: '把"1000 天"翻译成医生能直接给家长说的句子。强调干预的最佳时间窗，为 PAX 的"出生即介入"做铺垫。',
        sources: [
          { type: '文献', label: 'Backhed F. Cell Host & Microbe 2015;17:690-703' },
          { type: '文献', label: 'Odamaki T. BMC Microbiology 2016;16:90' },
          { type: '文献', label: 'Nguyen QN. PLoS Pathog 2016;12(12):e1005997' },
        ],
        appliesTo: ['强调早期干预', '与家长沟通模板', '科普推广'],
        rebuttals: [
          {
            q: '3 岁稳定之后再干预就完全没用了？',
            approach: '不能这么说。但 1000 天是窗口期已是学术共识——早期干预对菌群多样性和免疫成熟的塑造效率最高，后期更多是"维持"而非"塑造"。',
          },
        ],
      },
    ],
  },
  {
    id: 'paxm2',
    title: '早期菌群紊乱的远期风险',
    icon: '⚠',
    color: 'amber',
    summary: '剖宫产 / 配方喂养 · NEC / 过敏 / 神经系统',
    progress: 0,
    points: [
      {
        id: 'pax2-1',
        title: '剖宫产与配方喂养——双歧杆菌定植受阻',
        tier: 'core',
        spec: '阴道分娩和母乳喂养是建立双歧杆菌优势菌群的两大主因。剖宫产儿、配方奶喂养婴儿肠道菌群初始化延迟，双歧杆菌定植丰度显著低于自然分娩、母乳喂养婴儿。',
        customerVoice: '我们科剖宫产率不低，确实是临床现实。',
        sales: '不要把剖宫产说成"错"——医生很反感。把它定位为"客观风险因素"，PAX 是"在客观因素下的可干预手段"。',
        sources: [
          { type: '文献', label: 'Backhed F. Cell Host & Microbe 2015;17:690-703' },
          { type: '文献', label: 'Nat Rev Gastr & Hep 2018;15:197-205' },
        ],
        appliesTo: ['剖宫产新生儿', '早产儿', '无法母乳喂养群体'],
        notApplicable: ['足月顺产 + 纯母乳喂养（首选仍是母乳）'],
        rebuttals: [
          {
            q: '剖宫产宝宝几个月之后菌群也会追上来吧？',
            approach: '部分追赶是事实，但研究显示双歧杆菌的"代际差距"可持续到 1 岁以上，且与远期免疫疾病相关。早期干预的价值在于"缩短追赶期"。',
          },
          {
            q: '我让家长喂母乳不就行了，为什么要推配方？',
            approach: '完全同意母乳优先。PAX 的定位是——当母乳不可用、不充足、或确诊 CMA 需配方喂养时，做菌群友好的次优选择。',
          },
        ],
      },
      {
        id: 'pax2-2',
        title: '菌群紊乱的近远期疾病图谱',
        tier: 'core',
        spec: '近期：喂养不耐受、NEC（新生儿坏死性小肠结肠炎）、晚发败血症。远期：过敏性疾病、肥胖、糖尿病、消化道疾病、神经精神疾病（孤独症谱系、ADHD、抽动障碍等）。"卫生假说"——早期菌群构建不足，过敏性疾病风险升高。',
        customerVoice: '近年的神经科会议确实越来越多提脑-肠轴。',
        sales: '医生对"远期风险"的接受度比家长高。用 NEC + 过敏 + 神经三个维度展开，对应到他不同的患者人群。',
        sources: [
          { type: '文献', label: 'Groer MW. Birth Defects Res C 2015;105:252-264' },
          { type: '文献', label: 'Warner BB. Lancet 2016;387:1928-1936' },
          { type: '综述', label: '新生儿肠道微生态研究进展. 中华新生儿科杂志 2018' },
        ],
        appliesTo: ['NICU 场景', '过敏门诊', '儿保咨询'],
        rebuttals: [
          {
            q: '菌群和神经疾病的相关性，因果还是关联？',
            approach: '坦诚目前多为关联性研究，因果链仍在探索。但脑-肠轴双向通讯已被多项 RCT 证实，干预菌群对部分神经发育结局有改善信号。',
          },
        ],
      },
    ],
  },
  {
    id: 'paxm3',
    title: 'PAX® 专利配方机制',
    icon: '⚛',
    color: 'cyan',
    summary: '淀粉-果胶复合物 · 宽 pH 高粘度',
    progress: 0,
    points: [
      {
        id: 'pax3-1',
        title: '淀粉-果胶混合物的益生元特性',
        tier: 'core',
        spec: '淀粉与果胶通过氢键形成复合物，抗性机制类似 RS1 / RS5 型抗性淀粉。果胶选择性提升双歧杆菌和拟杆菌相对丰度；慢释碳源促进结肠丁酸生成。复合物在下消化道作为可发酵碳水底物，产生短链脂肪酸（SCFAs：乙酸为主，伴丙酸/丁酸），可测的菌群结构改变。',
        customerVoice: '果胶 + 淀粉这个组合的协同效应，文献是怎么解释的？',
        sales: '这是 PAX 区别于传统抗反流配方的核心机制。把它讲成"既能增稠又是益生元"，比单独讲增稠或单独讲菌群都有力。',
        sources: [
          { type: '文献', label: 'Food Hydrocolloids 2022. DOI:10.1016/j.foodhyd.2022.107644' },
          { type: '文献', label: 'Holscher HD. Gut Microbes 2017;8(2):172-184' },
        ],
        appliesTo: ['核心机制讲解', 'KOL 学术沟通'],
        rebuttals: [
          {
            q: '果胶单用就有益生元作用，复合物的"协同"实际增益有多大？',
            approach: '坦诚单一 RS 或单一果胶都有益生菌作用文献支持。复合物的协同主要体现在"快-慢底物延展发酵曲线"和"平衡气体/产酸动力学"——这对婴儿胃肠耐受性是关键。',
          },
          {
            q: '增加双歧杆菌是不是普遍益生菌都能做到？',
            approach: '是。但 PAX 的差异是把益生元做进了"抗反流"配方基底——不需要额外补充益生菌，一次喂养同时解决两个问题。',
          },
        ],
      },
      {
        id: 'pax3-2',
        title: '宽 pH 范围保持高粘度（对比传统增稠剂）',
        tier: 'core',
        spec: '婴儿胃 pH 通常 5-7（高于成人 1.5-3.5）。传统淀粉增稠剂仅在酸性 pH 下增稠；角豆胶在奶瓶内即增稠（流动性差，易堵奶嘴），且可能引起腹泻。PAX 三种增稠剂组合在更宽 pH 范围保持高粘度——奶瓶中流动性好，入胃后快速增稠。',
        customerVoice: '我开过角豆胶的，确实有家长反馈喂养困难和腹泻。',
        sales: '这是医生的"经验痛点"。对比传统增稠剂的副作用（角豆胶→腹泻 / 淀粉→便秘），PAX 的差异立刻可感。',
        sources: [
          { type: '文献', label: 'Salvatore et al. 2018' },
          { type: '文献', label: 'Iacono et al. 2002; Mortensen et al. 2017' },
        ],
        appliesTo: ['对比传统 AR 配方', '反流婴儿喂养困难场景'],
        rebuttals: [
          {
            q: '角豆胶+淀粉的组合 ESPGHAN 也是推荐的吧？',
            approach: '是的，2024 ESPGHAN 共识肯定了"果胶+LBG+淀粉"组合的技术合理性。但共识也强调具体微生物代谢谱受配方差异显著影响——PAX 的复合物配比是有专利保护的差异化。',
          },
        ],
      },
    ],
  },
  {
    id: 'paxm4',
    title: '临床循证数据',
    icon: '📊',
    color: 'violet',
    summary: 'SONAR / ALLER / COMETE · 9 项 RCT',
    progress: 0,
    points: [
      {
        id: 'pax4-1',
        title: 'SONAR 研究——反流 14 天平均减少 6.3 次',
        tier: 'core',
        spec: 'SONAR 研究（Dupont 2016b）：前瞻性多中心临床试验，90 名平均 9.6±5.8 周龄婴儿（每日反流≥5 次），3 个月完全食用 Nova AR+ 配方。结果：治疗 14 天反流平均减少 6.3 (±3.3) 次；100% 婴儿反流次数下降；53.3% (48/90) 此前曾用其他增稠配方无效。',
        customerVoice: '一项 90 例的多中心数据，量级是可以的。',
        sales: '医生对临床数据敏感——直接说"100% 婴儿都有改善"比"显著减少"有力。但注意补充样本量和研究设计，避免被质疑夸大。',
        sources: [
          { type: '文献', label: 'Dupont C et al. 2016b (SONAR)' },
          { type: '指南', label: 'Haiden N et al. ESPGHAN Nutrition Committee. J Pediatr Gastroenterol Nutr 2024;79(1):168-180' },
        ],
        appliesTo: ['频繁反流婴儿', '其他增稠配方无效场景'],
        rebuttals: [
          {
            q: '没有安慰剂对照，怎么排除自然消退？',
            approach: '坦诚 SONAR 是单臂开放试点。但 14 天就出现的 6.3 次/日下降，比婴儿反流自然消退（通常以月计）的曲线明显更陡。后续的 ALLER / COMETE 都有对照设计。',
          },
        ],
      },
      {
        id: 'pax4-2',
        title: 'CMA + 反流双适用——双歧杆菌定植维持',
        tier: 'core',
        spec: 'ALLER STUDY（77 名 CMA 婴儿）：随机双盲，Allernova AR vs Allernova。1 个月后 CoMiss 评分显著下降，过敏与反流双重缓解。Dupont 2015 氨基酸研究：含 PAX 氨基酸配方组双歧杆菌定植变化 -1.7%（±8.7），对照纽康特组 -20.3%（±10.1）——PAX 组维持双歧杆菌定植。',
        customerVoice: 'CMA 患儿的菌群本来就紊乱，PAX 这点对临床很有意义。',
        sales: 'CMA + 反流是儿科营养门诊的高发组合场景。强调"双重适用 + 菌群友好"——传统深度水解/氨基酸配方往往牺牲菌群定植。',
        sources: [
          { type: '文献', label: 'Vandenplas Y. Arch Dis Child 2014;99:933-936' },
          { type: '文献', label: 'Dupont C. J Pediatr Gastroenterol Nutr 2015' },
        ],
        appliesTo: ['确诊 CMA 婴儿', '深度水解 / 氨基酸配方需求', '反流伴过敏'],
        rebuttals: [
          {
            q: '-1.7% vs -20.3% 的差异 p 值显著吗？',
            approach: '坦诚 Dupont 2015 是小样本研究，统计学差异未达 p<0.05。但 -20% vs -2% 的临床意义差距值得关注，需要后续更大样本验证。我们没必要回避这一点。',
          },
        ],
      },
    ],
  },
];

export const PAX_CUSTOMER = {
  id: 'zhang',
  name: '张主任',
  age: 48,
  job: '三甲医院儿科 / 儿保科主任',
  budget: '科室年度配方推荐',
  family: '—',
  city: '上海',
  context: '门诊量大 · 学术型 KOL · 多次参加 ESPGHAN 年会 · 家长经常咨询反流/便秘配方',
  avatar: '张',
  mood: { interest: 45, trust: 50 },
  tagline: '循证 · 严谨 · 看研究质量',
  motivation: '门诊确实有反复反流和便秘的患儿家长来咨询。市面上抗反流配方不少，看看你们 PAX 的数据有什么差异化。',
  personality: [
    '只信 RCT 和高质量综述——会追问样本量、对照设计、p 值',
    '反感"领先""独家""革命性"这类营销词',
    '听到"机制+证据+局限"的完整论述会松动',
    '关心医生群体反馈，会问"复旦儿科、北京儿童医院在用吗"',
  ],
  concerns: [
    { tag: '临床证据等级', detail: '关注是否有 RCT、双盲、多中心，样本量是否充分' },
    { tag: '对菌群的真实影响', detail: '不只看反流减少，还要看双歧杆菌定植维持' },
    { tag: '安全性', detail: '尤其针对早产儿、CMA 婴儿、低体重新生儿' },
    { tag: 'ESPGHAN 指南一致性', detail: '关注是否与 2024 ESPGHAN AR 配方共识对齐' },
    { tag: '菌种合规与质控', detail: '关注欧盟 QPS / 中国《可用于婴幼儿食品的菌种名单》' },
  ],
  promptSeed: `你扮演一位 48 岁的三甲医院儿科 / 儿保科主任，张主任，今天接待医药代表的学术拜访。
你是学术型 KOL，多次参加 ESPGHAN 年会，门诊量大，家长常咨询反流和便秘配方。
你性格严谨循证：只信 RCT 和高质量综述，会追问样本量、对照设计、p 值；反感"领先""独家""革命性"等营销词。
你今天主要的关注点：(1) 临床证据等级；(2) 对肠道菌群尤其是双歧杆菌的真实影响；(3) 安全性（早产儿、CMA 婴儿）；(4) 与 2024 ESPGHAN AR 配方共识的一致性；(5) 菌种合规与质控。
对话规则：
- 你是医生客户，不是医药代表。保持医生视角，提问、质疑、给反馈。
- 短回复，一次 1-2 句话，不超过 70 字。可以用术语（NEC、CoMiss、QPS、ESPGHAN、双歧杆菌等）。
- 代表如果讲机制+证据+局限完整，引用具体文献和数据，你会更感兴趣。
- 代表如果只讲"显著改善""父母满意度高"等模糊表述，你会冷淡甚至质疑。
- 代表如果回避局限或夸大效果，你会直接反驳。
- 不要主动罗列你的"5 个关注点"，自然带出。
- 不要扮演代表或旁白。`,
};

export const PAX_SCRIPT = [
  {
    id: 'pax-t1',
    customer: '请坐。你们 PAX 这个配方我门诊也有家长问过，但市面抗反流配方不少。直接说——你们有什么差异化？',
    customerSub: '（语气平和但直接，没有寒暄余地）',
    tone: 'neutral',
    recommendedKp: ['pax3-1', 'pax3-2', 'pax4-1'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '机制差异 + 数据切入',
        text: '张主任，PAX 的差异化在两点：一是淀粉-果胶复合物，既增稠又是益生元，把抗反流和菌群干预合并；二是 SONAR 研究 90 例婴儿，14 天日均反流减少 6.3 次，100% 婴儿都有下降。具体您想先看机制还是临床？',
        cites: ['pax3-1', 'pax4-1'],
        skill: '学术开场',
        delta: { interest: 12, trust: 14 },
        feedback: '正确——直接给出"机制+数据"双锚点，让医生选切入角度。比泛泛讲"创新专利"专业得多。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '只讲临床效果',
        text: 'PAX 的临床效果非常显著，反流改善率很高，家长满意度 92% 以上，多个国家都在用。',
        cites: [],
        skill: '产品知识',
        delta: { interest: -2, trust: -6 },
        feedback: '错误——"满意度 92%"是面向家长的口径，对医生无效。没有具体研究和样本量，反而暴露了不专业。',
      },
      {
        id: 'c',
        quality: 'mid',
        label: '机制铺垫',
        text: '我们的核心是淀粉-果胶复合物，机制上既能增稠又有益生元效果，跟传统抗反流配方完全不一样。',
        cites: ['pax3-1'],
        skill: '产品知识',
        delta: { interest: 6, trust: 4 },
        feedback: '机制方向正确，但缺数据落地。医生听到机制后会立刻问"那临床效果呢"——可以一次给齐。',
      },
    ],
  },
  {
    id: 'pax-t2',
    customer: '果胶 + 淀粉的组合，ESPGHAN 2024 共识里也提到过类似方案。你们的复合物和那些有什么本质不同？',
    customerSub: '（开始深挖技术细节）',
    tone: 'challenge',
    recommendedKp: ['pax3-1', 'pax3-2'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '承认共性 + 阐明专利差异',
        text: '您提到的没错，ESPGHAN 2024 确实肯定了"果胶+LBG+淀粉"组合的技术合理性。我们的差异在配比——通过氢键形成的复合物机制类似 RS1/RS5 抗性淀粉，并且在婴儿胃 pH 5-7 的宽范围下保持高粘度，奶瓶内流动性好。这部分有专利保护。',
        cites: ['pax3-1', 'pax3-2'],
        skill: '异议处理',
        delta: { interest: 14, trust: 16 },
        feedback: '正确——先承认共性（医生熟悉的事实），再讲差异（配比+pH 适应性+专利）。这是和 KOL 的标准沟通范式。',
      },
      {
        id: 'b',
        quality: 'bad',
        label: '否认共性',
        text: '其他配方都不一样的，我们是全球唯一做到这种复合物的，专利配方独一无二。',
        cites: [],
        skill: '沟通表达',
        delta: { interest: -10, trust: -14 },
        feedback: '错误——医生知道事实，否认共性等于挑战他的专业判断。"全球唯一"这种词在 KOL 面前是减分项。',
      },
      {
        id: 'c',
        quality: 'mid',
        label: '只讲技术参数',
        text: '我们的配方在 pH 6.2 时粘度达到峰值，比其他增稠剂在宽 pH 范围下表现更好。',
        cites: ['pax3-2'],
        skill: '产品知识',
        delta: { interest: 4, trust: 0 },
        feedback: '数据准确但缺乏对医生提问的回应——他问的是"本质不同"，你只答了一个技术指标。',
      },
    ],
  },
  {
    id: 'pax-t3',
    customer: '我比较关心对菌群的真实影响。增稠是一回事，菌群定植又是一回事。有双歧杆菌相关的数据吗？',
    customerSub: '（往专业核心问题推进）',
    tone: 'interested',
    recommendedKp: ['pax4-2', 'pax3-1', 'pax2-1'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '直击双歧杆菌数据 + 坦诚局限',
        text: 'Dupont 2015 氨基酸配方研究做了对照——含 PAX 组双歧杆菌变化 -1.7%，对照纽康特组 -20.3%。坦白说样本量不大、p 值未达显著，但 -20% vs -2% 的临床意义差距值得关注。机制上是果胶选择性促进双歧杆菌增殖。',
        cites: ['pax4-2', 'pax3-1'],
        skill: '异议处理',
        delta: { interest: 16, trust: 18 },
        feedback: '正确——给出关键数据，同时坦诚研究局限。"主动承认 p 值未达显著"反而强化了你的可信度。',
      },
      {
        id: 'b',
        quality: 'bad',
        label: '回避局限',
        text: 'Dupont 2015 研究显示 PAX 配方维持双歧杆菌定植，临床意义显著。',
        cites: ['pax4-2'],
        skill: '产品知识',
        delta: { interest: 2, trust: -8 },
        feedback: '错误——"显著"用法不规范，主任会追问 p 值，发现你回避局限。失分。',
      },
      {
        id: 'c',
        quality: 'mid',
        label: '只讲机制',
        text: '机制上 PAX 的果胶可以选择性促进双歧杆菌增殖，慢释碳源还能促进结肠丁酸生成。',
        cites: ['pax3-1'],
        skill: '产品知识',
        delta: { interest: 6, trust: 4 },
        feedback: '机制讲得对，但医生明确问"数据"——只答机制是绕开了核心问题。',
      },
    ],
  },
  {
    id: 'pax-t4',
    customer: '我门诊很多 CMA 患儿伴反流，传统深度水解配方对菌群不太友好。你们能不能用？',
    customerSub: '（这是医生的真实临床痛点）',
    tone: 'interested',
    recommendedKp: ['pax4-2', 'pax3-1'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: 'CMA 场景 + ALLER 研究',
        text: '这正是 PAX 的核心场景之一。Allernova AR 就是 PAX 复合物加到深度水解基底上——ALLER STUDY 77 名 CMA 婴儿，1 个月后 CoMiss 评分显著下降，过敏和反流双重缓解。同时 PAX 的益生元成分帮助维持菌群——这恰好弥补了传统深度水解的短板。',
        cites: ['pax4-2', 'pax3-1'],
        skill: '需求挖掘',
        delta: { interest: 18, trust: 16 },
        feedback: '正确——精准命中医生的临床痛点（CMA + 反流 + 菌群三角），引用对应研究和具体患者数。',
      },
      {
        id: 'b',
        quality: 'mid',
        label: '泛泛推介',
        text: '可以的，PAX 配方有深度水解版本，对 CMA 婴儿也适用，临床效果不错。',
        cites: [],
        skill: '产品知识',
        delta: { interest: 0, trust: -4 },
        feedback: '"效果不错"在 KOL 面前是无效话术。错失了一次用 ALLER STUDY 数据直接命中临床痛点的机会。',
      },
      {
        id: 'c',
        quality: 'good',
        label: '反问临床场景',
        text: '您门诊的 CMA + 反流患儿，主要月龄段是什么？我可以根据具体情况帮您看 ALLER STUDY 和 COMETE 研究里的相应亚组数据。',
        cites: [],
        skill: '需求挖掘',
        delta: { interest: 12, trust: 14 },
        feedback: '加分——主动反问细化场景，把"产品介绍"转化为"临床咨询"。这是高阶代表的标志。',
      },
    ],
  },
  {
    id: 'pax-t5',
    customer: '最后一个问题。你们用的菌种、原料，欧盟 QPS 和国内监管都符合吗？',
    customerSub: '（合规是医生开方的底线）',
    tone: 'neutral',
    recommendedKp: ['pax3-1', 'pax3-2'],
    options: [
      {
        id: 'a',
        quality: 'good',
        label: '合规 + 给资料',
        text: 'PAX 复合物的核心是淀粉和果胶——食品基础原料，不涉及益生菌菌种，本身就不在 QPS 或菌种名单的限制范围内。配方整体已通过欧盟《新型食品条例》评估，国内进口也是合规批文。我下次拜访给您带详细合规文件和 ESPGHAN 共识全文。',
        cites: ['pax3-1'],
        skill: '推进成交',
        delta: { interest: 12, trust: 14 },
        feedback: '正确——准确区分"益生元（PAX）"与"益生菌菌种"，避免混淆合规口径；同时承诺下次带资料，自然推进到下次拜访。',
      },
      {
        id: 'b',
        quality: 'bad',
        label: '含糊带过',
        text: '我们都是合规的，欧盟和国内都通过了，您放心。',
        cites: [],
        skill: '沟通表达',
        delta: { interest: -6, trust: -12 },
        feedback: '错误——"您放心"是 KOL 沟通的禁语。合规问题必须具体到法规条款，模糊回应=不专业。',
      },
      {
        id: 'c',
        quality: 'mid',
        label: '只讲国内',
        text: '我们在国内的进口和销售都符合国家市场监管的要求，有正式批文。',
        cites: [],
        skill: '产品知识',
        delta: { interest: 4, trust: 2 },
        feedback: '答了一半。医生问的是"欧盟 QPS 和国内"两个口径，只答国内会被认为没听清问题。',
      },
    ],
  },
];

// 多医生人设库（用于"AI 考我"模式切换）
export const PAX_CUSTOMERS = [
  { ...PAX_CUSTOMER, vibe: '学术严谨', emoji: '🩺', avatarColor: 'dark' },
  {
    id: 'li',
    name: '李医生',
    age: 35,
    job: '社区医院儿科主治',
    budget: '基层用药推荐',
    family: '—',
    city: '上海郊区',
    context: '基层医生 · 接诊量大但学术资源少 · 关心实操和家长沟通',
    avatar: '李',
    tagline: '务实 · 关心家长依从性',
    vibe: '基层实操',
    emoji: '👨‍⚕️',
    avatarColor: 'warm',
    motivation: '我们社区门诊看反流便秘的宝宝不少，三甲推过来的也多。你们的配方简单介绍下，重点说怎么用、家长怎么操作。',
    opener: '您来得正好。我们这一线接的反流宝宝挺多的，家长经常拿着大医院开的方子来问怎么喂。你们 PAX 给我简单说说？',
    personality: [
      '更关心"怎么用"而非"为什么"',
      '关注家长的依从性和操作便利',
      '不爱听术语，喜欢具体场景',
      '会问"出问题了我能怎么处理"',
    ],
    concerns: [
      { tag: '家长依从性', detail: '配方喂养操作复杂家长会停' },
      { tag: '常见副作用', detail: '换配方后腹泻或便秘怎么处理' },
      { tag: '价格门槛', detail: '基层家庭对进口配方价格敏感' },
      { tag: '与现有方案衔接', detail: '从普通配方切换是否需要过渡期' },
    ],
    promptSeed: `你扮演一位 35 岁的社区医院儿科主治医生李医生，今天接待医药代表。
你接诊量大但学术资源少，更关心实操和家长沟通，不爱听术语。
你性格务实直接，关注的是"怎么用、家长依从性、出问题怎么处理"。
关键关注：(1) 家长能不能简单上手；(2) 换配方副作用如何处理；(3) 价格是否家长能接受；(4) 与现有方案衔接是否平滑。
- 你是医生客户。短回复，一次 1-2 句，不超过 60 字。
- 代表用术语堆积你会皱眉，喜欢"具体怎么喂、家长怎么记住"。
- 喜欢听过来人的案例和操作细节。`,
  },
];
