/* =========================================================================
   专业术语资料库 · 数据层
   每条术语：所属分类、中英文名、符号、定义、工程意义、常见误区、关联模块参数
   ========================================================================= */
(function (global) {
  'use strict';

  var CATS = [
    { id: 'core', short: '通用', name: '通用 · 热力学与传递', desc: '贯穿四个模块的基础概念' },
    { id: 'solid', short: '固相反应', name: '固相反应合成', desc: 'JMAK 动力学、成核-长大与致密化' },
    { id: 'cvd', short: 'CVD', name: '化学气相沉积', desc: '表面反应与质量输运的串联' },
    { id: 'rd', short: '反应扩散', name: '反应-扩散', desc: '浓度场、反应前沿与渗透深度' },
    { id: 'kiln', short: '马弗炉', name: '马弗炉烧成', desc: '边界条件与炉膛不均匀性' },
    { id: 'heat', short: '热处理', name: '热处理', desc: 'Fe-C 相变、组织与磁性能' },
    { id: 'num', short: '数值/AI', name: '数值方法与智能寻优', desc: '离散求解、扫掠与优化' }
  ];

  var TERMS = [
    /* ------------------------------ 通用 ------------------------------ */
    {
      id: 'act-energy', cat: 'core', zh: '活化能', en: 'Activation energy', abbr: '', sym: 'Eₐ', unit: 'kJ/mol',
      def: '反应速率常数对温度敏感程度的度量，出现在 Arrhenius 式的指数项中。物理含义是反应或扩散步骤必须越过的能量势垒。',
      why: '它决定「升温能换来多大加速」：Eₐ 越大，同样升 50 K 速率增幅越显著。氧化物固相反应的表观 Eₐ 常在 100~400 kJ/mol。',
      pit: '不要把表观活化能当成某个基元步骤的能垒。固相反应往往由扩散、成核、界面反应串联，测到的是表观值，还会随温区漂移。',
      mod: 'solid', param: 'T', rel: ['arrhenius', 'rate-const']
    },
    {
      id: 'arrhenius', cat: 'core', zh: 'Arrhenius 方程', en: 'Arrhenius equation', abbr: '', sym: 'k = A·e^(−Eₐ/RT)', unit: '',
      def: '把速率常数写成温度的指数函数：k = A·exp(−Eₐ/RT)。本平台四个模块中的所有速率常数都由此式给出温度依赖。',
      why: '它解释了为什么温度是陶瓷工艺里最有效、也最危险的旋钮：同一个指数项同时放大了反应速率和晶粒长大速率。',
      pit: '用 ln k~1/T 拟合时要注意温区。跨越相变或机理转换（如由界面控制转为扩散控制）时，曲线会出现折点而不是一条直线。',
      mod: 'solid', param: 'T', rel: ['act-energy', 'pre-exponential']
    },
    {
      id: 'pre-exponential', cat: 'core', zh: '指前因子', en: 'Pre-exponential factor', abbr: '', sym: 'A', unit: 's⁻¹',
      def: 'Arrhenius 式中的频率因子，代表分子碰撞或原子跃迁的尝试频率，并隐含熵效应。',
      why: '本平台不直接给出 A，而是用「参考温度下的速率常数 k_T」反推 A，使 800 ℃ 附近的量级与实验数据对得上。',
      pit: 'A 与 Eₐ 强相关，单独标定其中一个没有物理意义，这就是动力学中的补偿效应，两个参数可以同时变而曲线几乎不动。',
      mod: 'solid', param: '', rel: ['arrhenius', 'act-energy']
    },
    {
      id: 'rate-const', cat: 'core', zh: '反应速率常数', en: 'Rate constant', abbr: '', sym: 'k', unit: '随级数变化',
      def: '单位浓度（或单位界面）条件下的反应速率系数，量纲随反应级数不同。',
      why: '本平台把 k 拆成两部分相乘：Arrhenius 温度项，以及压力、浓度、粒径的幂次修正项。',
      pit: 'k 不是真正的常数。它随温度变化，也可能随转化率变化：产物层增厚、界面减少都会让有效 k 下降。',
      mod: 'solid', param: 'T', rel: ['arrhenius', 'act-energy']
    },
    {
      id: 'conversion', cat: 'core', zh: '转化率', en: 'Degree of conversion', abbr: '', sym: 'α', unit: '%',
      def: '已反应的物质量占初始可反应量的分数，0~100%。本平台四个模块都把转化率作为主指标之一。',
      why: '最直观地回答「反应进行到哪一步」。它由时间、温度、以及样品真实经历的温度史共同决定。',
      pit: '转化率不等于致密度，更不等于性能。α 已经 100% 的坯体仍然可能是多孔体，晶粒也可能已经粗化。',
      mod: 'solid', param: 't', rel: ['jmak', 'relative-density']
    },
    {
      id: 'characteristic-time', cat: 'core', zh: '特征时间', en: 'Characteristic time', abbr: '', sym: 'τ', unit: 'min',
      def: '过程完成约 63%（1−1/e）所需的时间，是 S 形曲线的时间尺度。',
      why: '不同机理的特征时间对参数的依赖不同。比较 τ 比比较某一时刻的转化率更能看出机理是否改变。',
      pit: '只看某一点的 α 容易被曲线起点误导。两组实验在同一时刻 α 相同，整条曲线可能完全不同。',
      mod: 'solid', param: 't', rel: ['conversion', 'jmak']
    },
    {
      id: 'thermal-time-const', cat: 'core', zh: '热时间常数', en: 'Thermal time constant', abbr: '', sym: 'τ_th', unit: 'min',
      def: '集总热容假设下 τ = ρVc_p/(hA)，描述样品温度追赶环境温度的快慢；纯传导分量可按 τ ≈ d²/(4α) 估算。',
      why: '在马弗炉中它直接决定滞后量：ΔT_lag ≈ 升温速率 × τ。所以升温越快，样品欠温越多。平台里薄片坯体约 1 min、坩埚装粉 1.5~2 min、匣钵大装料约 9 min。',
      pit: '集总假设要求 Bi < 0.1。大件或低导热样品内部还存在温度梯度，实际滞后比这个估算更大。',
      mod: 'kiln', param: 'ramp', rel: ['biot', 'thermal-lag', 'temp-gap']
    },
    {
      id: 'biot', cat: 'core', zh: 'Biot 数', en: 'Biot number', abbr: 'Bi', sym: 'Bi = hL/λ', unit: '',
      def: '内部导热阻力与表面换热阻力之比。Bi 很小意味着物体内部近似等温。',
      why: '它决定了「样品内部是否均匀」这一层不均匀性。实验室小坩埚 Bi 小，工业大件 Bi 大。',
      pit: '实验室小试样上得到的均匀结论不能直接外推到工业大件，几何放大后 Bi 会显著增大。',
      mod: 'kiln', param: 'sy', rel: ['thermal-time-const', 'uniformity']
    },
    {
      id: 'boundary-condition', cat: 'core', zh: '边界条件', en: 'Boundary condition', abbr: 'BC', sym: 'Dirichlet / Neumann / Robin', unit: '',
      def: '求解微分方程时在边界上给定的约束：第一类给定变量值，第二类给定通量，第三类给定与环境的换热关系。',
      why: '本平台所有可调参数本质上都在改边界条件：炉壁温度、进气分压、源边界浓度、表面换热系数。',
      pit: '最常见的错误是把边界值当成场内的值。设定 1050 ℃ 是加热壁的温度，不是样品的温度。',
      mod: 'kiln', param: 'Tset', rel: ['setpoint', 'furnace-field', 'steady-transient']
    },
    {
      id: 'steady-transient', cat: 'core', zh: '稳态与瞬态', en: 'Steady state vs. transient', abbr: '', sym: '∂/∂t = 0', unit: '',
      def: '稳态指场量不随时间变化；瞬态指系统仍在演化过程中。',
      why: '炉膛热场按稳态求解，样品温度史按瞬态求解，两者时间尺度相差两个数量级，这正是表温与件温脱节的原因。',
      pit: '仪表显示「已到温」只说明控温点到了稳态，不代表整个炉膛达到稳态，更不代表样品达到稳态。',
      mod: 'kiln', param: 'hold', rel: ['furnace-field', 'thermal-lag']
    },
    {
      id: 'fick', cat: 'core', zh: 'Fick 定律与扩散系数', en: 'Fick\u2019s law / Diffusivity', abbr: '', sym: 'J = −D∇C', unit: 'm²/s',
      def: '扩散通量正比于浓度梯度，比例系数为扩散系数 D；D 本身按 Arrhenius 随温度变化。',
      why: '反应-扩散模块中，反应前沿推进的快慢由 D 与反应速率竞争决定。',
      pit: '多孔介质应使用有效扩散系数 D_eff = D·ε/τ。直接代入本征 D 会明显高估渗透深度。',
      mod: 'rd', param: 'tort', rel: ['tortuosity', 'porosity', 'reaction-diffusion']
    },
    {
      id: 'heat-transfer', cat: 'core', zh: '三种传热方式', en: 'Conduction / Convection / Radiation', abbr: '', sym: 'q_rad ∝ εσT⁴', unit: '',
      def: '导热发生在固体内部，对流发生在流体与壁面之间，辐射在高温下按 T⁴ 增长并成为主导。',
      why: '马弗炉在 1000 ℃ 时辐射占主导，所以炉膛温度分布对几何形状、装料遮挡极其敏感。',
      pit: '低温段忽略辐射、高温段只算对流，都会把升温能力算错，误差在高温区被四次方迅速放大。',
      mod: 'kiln', param: 'Tset', rel: ['furnace-field', 'heat-leak']
    },
    {
      id: 'blackbody', cat: 'core', zh: '黑体辐射与色温', en: 'Blackbody radiation / Color temperature', abbr: '', sym: 'λ_max·T = 2898 μm·K', unit: '',
      def: '物体热辐射谱随温度升高向短波移动，肉眼看到的颜色由暗红、橙红到黄白依次变化。',
      why: '动画里炉膛与样品的颜色就是按此映射的。样品颜色始终比炉膛慢半拍，这是热滞后的可视化。',
      pit: '颜色反映的是亮度温度，不等于真实温度。不同发射率、不同观察条件下的颜色不可直接比较。',
      mod: 'kiln', param: 'Tset', rel: ['thermal-lag', 'heat-transfer']
    },
    {
      id: 'thermal-lag', cat: 'core', zh: '热滞后', en: 'Thermal lag', abbr: '', sym: 'ΔT_lag', unit: 'K',
      def: '样品温度落后于环境温度的现象，源于样品自身热容与有限的表面换热能力。',
      why: '同样的设定曲线，热容大的装载（匣钵、大坩埚）滞后更多，有效保温时间更短。',
      pit: '滞后不是仪表故障，无法通过校准热电偶消除。它属于物理过程，只能靠降低升温速率或延长保温来补偿。',
      mod: 'kiln', param: 'ramp', rel: ['thermal-time-const', 'temp-gap', 'effective-hold']
    },
    {
      id: 'uniformity', cat: 'core', zh: '温度不均匀度', en: 'Temperature uniformity', abbr: '', sym: 'ΔT', unit: 'K',
      def: '工作区内最高温度与最低温度之差，或表示为相对设定值的 ±半幅。',
      why: '本平台把装料区的 ΔT 直接算出来并显示在画布上，这是「不均匀」这个概念的量化形式。',
      pit: '空炉测得的均匀度不等于满载均匀度。装载会遮挡辐射、改变气流，让实际温差更大。',
      mod: 'kiln', param: 'sx', rel: ['furnace-field', 'effective-zone', 'isotherm']
    },
    {
      id: 'thermocouple', cat: 'core', zh: '热电偶与控温点', en: 'Thermocouple / Control point', abbr: 'TC', sym: 'T_TC', unit: '℃',
      def: '热电偶测量的是自身接点处的温度。控温点通常固定在炉壁附近或炉膛一角，并不在样品上。',
      why: '控温点位置决定了「表显温度」与「样品温度」的系统偏差，这是系统误差而非随机误差。',
      pit: '把 TC 读数当作样品温度，是实验室最常见的一类误判。它会把整条工艺曲线高估几十 K。',
      mod: 'kiln', param: '', rel: ['setpoint', 'temp-gap']
    },
    {
      id: 'over-under-fire', cat: 'core', zh: '过烧与欠烧', en: 'Over-firing / Under-firing', abbr: '', sym: '', unit: '',
      def: '过烧指温度或时间超出工艺窗口，晶粒粗化、液相过量、性能下降；欠烧指反应不完全、致密度不足。',
      why: '工艺窗口就是两者夹出来的区间。升温速率与装炉位置都会改变这个窗口的有效宽度。',
      pit: '欠烧通常可以补烧挽救，过烧不可逆。所以工程上宁可略微欠烧，也不要冒过烧的风险。',
      mod: 'kiln', param: 'hold', rel: ['grain-growth', 'densification']
    },
    {
      id: 'reference-temperature', cat: 'core', zh: '参考温度标定', en: 'Reference-temperature normalization', abbr: 'T_ref', sym: 'T_ref', unit: 'K',
      def: '把速率常数、扩散系数一类量锚定在某个参考温度上标定，再用 Arrhenius 关系外推到其它温度。本平台每个材料体系都有自己的 T_ref，一般就取它自己的默认工艺温度。',
      why: '有了它，参数表里的数字才有物理含义：写出来的 k、D 就是该材料在自己工艺温度下的真实值，不同材料之间也能直接横向比较。',
      pit: '换 T_ref 必须同时按 Arrhenius 关系重标定常数。把参考点从 900 ℃ 挪到 750 ℃ 而只改 T_ref、不改常数，整条曲线会整体平移，结果就错了。',
      mod: 'cvd', param: 'T', rel: ['arrhenius', 'pre-exponential', 'act-energy']
    },

    /* ---------------------------- 固相反应 ---------------------------- */
    {
      id: 'jmak', cat: 'solid', zh: 'JMAK 方程', en: 'Johnson-Mehl-Avrami-Kolmogorov', abbr: 'JMAK', sym: 'α = 1 − e^(−(kt)^n)', unit: '',
      def: '描述成核-长大控制的等温转变动力学：α = 1 − exp[−(kt)^n]，其中 k 是速率常数，n 是 Avrami 指数。',
      why: '固相模块用它生成 S 形转化率曲线。n 与 k 一起决定曲线陡不陡、什么时候起势。',
      pit: 'JMAK 假设随机成核、各向同性长大、长大过程互不碰撞。实际反应后期颗粒碰撞合并，曲线会偏离模型。',
      mod: 'solid', param: 'T', rel: ['avrami', 'nucleation-growth']
    },
    {
      id: 'avrami', cat: 'solid', zh: 'Avrami 指数', en: 'Avrami exponent', abbr: '', sym: 'n', unit: '',
      def: 'JMAK 方程中的指数，综合反映成核方式与长大维度。界面控制下三维长大配瞬时成核约为 3、持续成核约为 4；扩散控制下则要低得多，持续成核约 2.5、瞬时成核约 2。',
      why: 'n 发生变化意味着机理变化，而不只是「曲线陡一点」。它是判断控制机制的指纹。',
      pit: '用单条曲线拟合 n 很不可靠。需要一组不同温度下的曲线同时拟合，才能把 k 与 n 分离。另外 n 不是连续可调的旋钮：它由机理决定，取到机理允许的范围之外，就等于编了一个不存在的机制。',
      mod: 'solid', param: 'T', rel: ['jmak', 'nucleation-growth']
    },
    {
      id: 'nucleation-growth', cat: 'solid', zh: '成核-长大', en: 'Nucleation and growth', abbr: '', sym: 'Ṅ, G', unit: '',
      def: '新相在旧相中先形成临界核，再向四周长大。总转变速率由成核率与长大速率共同控制。',
      why: '这解释了为什么「保温」比「冲温」更容易得到细晶高致密组织：升温主要加速长大，保温给成核留出时间。',
      pit: '成核与长大对温度的依赖不同。升温往往更有利于长大而不是成核，结果是晶粒变粗。',
      mod: 'solid', param: 'T', rel: ['jmak', 'grain-growth', 'avrami']
    },
    {
      id: 'shrinking-core', cat: 'solid', zh: '未反应核收缩模型', en: 'Shrinking core model', abbr: '', sym: 'r_c(t)', unit: '',
      def: '反应从颗粒表面逐层向内推进，未反应核逐渐缩小。速率由界面反应或产物层内扩散控制。',
      why: '实验台微观组织动画里那个逐渐变小的深色核，就是这个模型的可视化。',
      pit: '产物层一旦致密化，控制步骤会从界面反应切换为扩散，速率出现明显拐点，不能再用单一速率式外推。',
      mod: 'solid', param: 'd0', rel: ['specific-surface', 'conversion']
    },
    {
      id: 't90', cat: 'solid', zh: 't90 与半反应时间', en: 't90 / Half-time', abbr: '', sym: 't₉₀', unit: 'min',
      def: '转化率达到 90% 所需的时间。半反应时间则是达到 50% 的时间。',
      why: '工程上比「完全反应」更实用，因为最后 10% 往往极其缓慢，继续保温的收益很低而晶粒粗化的代价很高。',
      pit: 't90 强烈依赖升温史。两组实验的 t90 不同，可能只是升温速率不同，而不是本征动力学不同。',
      mod: 'solid', param: 't', rel: ['conversion', 'jmak']
    },
    {
      id: 'specific-surface', cat: 'solid', zh: '比表面积与粒径', en: 'Specific surface area / Particle size', abbr: '', sym: 'S ∝ 1/d₀', unit: 'm²/g',
      def: '单位质量粉体的表面积，与颗粒直径近似成反比。粒径越小，接触面积越大。',
      why: '本平台以 d₀^−0.22 的方式修正速率常数，体现细粉反应更快的实验事实。',
      pit: '过细的粉体极易团聚，实际有效表面积并不按 1/d 增长。比表面积测的是开孔表面，不等于反应界面。',
      mod: 'solid', param: 'd0', rel: ['shrinking-core', 'rate-const']
    },
    {
      id: 'stoichiometry', cat: 'solid', zh: '化学计量配比', en: 'Stoichiometry', abbr: '', sym: 'x', unit: '×化学计量',
      def: '按反应式的摩尔比配料。平台用「×化学计量」表示相对标准配比的偏移倍数。',
      why: '配比偏离会残留第二相、改变缺陷浓度，进而影响反应速率与最终性能。',
      pit: '挥发损失（Li、Zn、Pb 在高温下易挥发）会让烧后的实际配比偏离名义配比，配料时要预补偿。',
      mod: 'solid', param: 'C', rel: ['conversion', 'densification']
    },
    {
      id: 'densification', cat: 'solid', zh: '致密化', en: 'Densification', abbr: '', sym: 'ρ_rel', unit: '%',
      def: '颗粒间孔隙逐渐消除、坯体收缩的过程，驱动力是降低表面能。',
      why: '平台用相对致密度表征。它与转化率并不同步：反应可能已经完成，致密化才刚起步。',
      pit: '致密化与晶粒长大互相竞争。升温太快会出现「致密没完成、晶粒已粗化」的最差组合。',
      mod: 'solid', param: 'T', rel: ['relative-density', 'grain-growth', 'over-under-fire']
    },
    {
      id: 'grain-growth', cat: 'solid', zh: '晶粒长大', en: 'Grain growth', abbr: '', sym: 'Gⁿ − G₀ⁿ = Kt', unit: 'μm',
      def: '晶粒平均尺寸随时间按幂律增长，速率常数 K 随温度按 Arrhenius 变化。',
      why: '平台输出平均晶粒尺寸，这是「高温快烧」矛盾的另一半：温度既帮反应也帮粗化。',
      pit: '晶粒长大活化能并不小：氧化物陶瓷实测多在 150~450 kJ/mol（ZnO 压敏体 150~400，BaTiO₃ 烧结达 550），远高于一般液相反应的量级。所以「多烧一小时」的代价往往被低估。',
      mod: 'solid', param: 'T', rel: ['densification', 'nucleation-growth']
    },
    {
      id: 'relative-density', cat: 'solid', zh: '相对致密度', en: 'Relative density', abbr: '', sym: 'ρ/ρ_th', unit: '%',
      def: '实测体积密度与同成分理论密度之比，等价于 100% 减去气孔率。',
      why: '它直接对应气孔率与一系列性能：强度、透光率、电导率、介电损耗。',
      pit: '相对致密度高不代表组织好。粗晶高致密与细晶高致密在性能上差别很大，两个指标要一起看。',
      mod: 'solid', param: 'T', rel: ['densification', 'grain-growth']
    },
    {
      id: 'perovskite-structure', cat: 'solid', zh: '钙钛矿结构', en: 'Perovskite structure', abbr: 'ABO₃', sym: 'ABO₃', unit: '',
      def: '以立方或八面体骨架为核心的一类晶体结构原型：二价 A 位阳离子占立方体顶点，四价 B 位占体心，氧离子占面心。',
      why: 'SrTiO₃、BaTiO₃ 都属这一族。钙钛矿的介电、压电、超导性能对结构容差因子极其敏感，烧成工艺的微小偏差会直接改掉材料性能。',
      pit: '化学式对了不等于结构对了。SrCO₃ 与 TiO₂ 按 1:1 混合，XRD 上仍可能有大量杂相峰，说明固相反应没走完，得到的只是「成分正确的多相混合物」。',
      mod: 'solid', param: 'T', rel: ['jmak', 'grain-growth', 'stoichiometry']
    },
    {
      id: 'layered-oxide', cat: 'solid', zh: '层状氧化物正极', en: 'Layered oxide cathode', abbr: '', sym: 'LiMO₂', unit: '',
      def: '以 Li⁺ 占据层状过渡金属氧化物骨架的插电正极材料家族，典型代表 LiCoO₂、LiNi₀.₈Co₀.₁Mn₀.₁O₂。',
      why: 'LiCoO₂ 与 NCM 同属这一族。层状结构靠锂的层间迁移实现可逆嵌入，所以焙烧温度与保温时间同时决定了容量与循环寿命。',
      pit: '高温焙烧锂会挥发，缺锂后生成杂相，容量直接掉一截；同时温度上去了晶粒也粗化。这两件事同时发生，所以窗口很窄。LiCoO₂ 更极端：单相在 850 ℃ 仍稳定，高于 900 ℃ 就会分解释放出 Co₃O₄，1000 ℃ 以上还会生成缺锂固溶体 LixCo₁₋ₓO。',
      mod: 'solid', param: 'T', rel: ['jmak', 'grain-growth', 'over-under-fire']
    },
    {
      id: 'spinel-ferrite', cat: 'solid', zh: '尖晶石铁氧体', en: 'Spinel ferrite', abbr: '', sym: 'AB₂O₄', unit: '',
      def: '氧离子作立方堆积、A/B 阳离子分别占据四面体与八面体空隙的结构原型，MnZn、NiZn 等软磁铁氧体均属此类。',
      why: '尖晶石相一旦形成，晶界就很难继续靠固相扩散长过去。所以 MnZn 铁氧体主烧要 1260~1380 ℃、预烧 800~1000 ℃，温度窗口比钛酸钡窄得多。',
      pit: '气氛的影响方向常被记反：MnFe₂O₄ 在**空气中低于 800 ℃ 会因 Mn²⁺ 被氧化而分解**，析出无法溶入尖晶石的 Fe₂O₃、Mn₂O₃ 杂相；反过来**降低氧分压反而能降低成相温度**（4 % O₂ 下 1230 ℃ 即可得单相）。所以要治杂相，思路是控氧分压与温度，而不是一味降温。',
      mod: 'solid', param: 'T', rel: ['jmak', 'avrami', 'stoichiometry']
    },
    {
      id: 'carbothermal-reduction', cat: 'solid', zh: '碳热还原', en: 'Carbothermal reduction', abbr: '', sym: '', unit: '',
      def: '以碳或一氧化碳作为还原剂，把金属氧化物的氧化态降下来、同时完成目标相生成的固相反应路线。',
      why: 'LiFePO₄ 的 Fe³⁺ 必须被还原成 Fe²⁺ 才能成相，碳既是还原剂又是包覆导电层来源，碳含量约 3 % 时电性能最好。',
      pit: '碳量是双刃剑：不足则 Fe³⁺ 残留（每残留 1 % 容量约降 3 mAh/g），过量则颗粒团聚、压实密度下降。而且碳热还原必须在惰性气氛下做，否则 Fe²⁺ 会被重新氧化。',
      mod: 'solid', param: 'T', rel: ['stoichiometry', 'furnace-atmosphere', 'jmak']
    },
    {
      id: 'oxygen-vacancy', cat: 'solid', zh: '氧空位与氧扩散', en: 'Oxygen vacancy and diffusion', abbr: '', sym: 'δ', unit: '',
      def: '晶格中缺失一个氧原子形成的缺陷，带正有效电荷，是氧离子导体（如 YSZ、YBCO）的载流子来源。',
      why: 'YBCO 的超导性直接取决于氧含量：650 ℃ 以上链位氧会自发脱出，材料退化为四方相、失去超导，必须在 450~500 ℃ 纯氧中退火补氧。',
      pit: '氧空位浓度不同时活化能也不同：空位越多，扩散势垒反而越低。所以同一材料在不同氧分压下拟合出的 Ea 会有明显差别。',
      mod: 'solid', param: 'T', rel: ['arrhenius', 'furnace-atmosphere', 'reference-temperature']
    },
    {
      id: 'pb-volatility', cat: 'solid', zh: '铅氧化物挥发', en: 'PbO volatility', abbr: '', sym: '', unit: '',
      def: 'PbO 在 800 ℃ 以上显著挥发，导致烧结体失铅、化学计量比偏离目标相的失配现象。',
      why: 'PZT 压电陶瓷的典型工艺是加盖坩埚并加过量 PbO 补偿挥发；敞口装料会欠烧，介电常数与压电系数一起掉。',
      pit: '把失铅误判成「温度不够」而去继续升温，是最常见的误操作，温度再高只会让 Pb 挥发得更快，方向完全反了。',
      mod: 'solid', param: 'T', rel: ['stoichiometry', 'over-under-fire', 'furnace-atmosphere']
    },

    /* ------------------------------ CVD ------------------------------ */
    {
      id: 'langmuir', cat: 'cvd', zh: 'Langmuir-Hinshelwood 动力学', en: 'Langmuir-Hinshelwood kinetics', abbr: 'L-H', sym: 'r ∝ Kp/(1+Kp)', unit: '',
      def: '表面反应速率对前驱体分压呈饱和型关系：低压段近似线性，高压段趋于平台。',
      why: '它解释了为什么一味提高分压，沉积速率最终不再上升：表面吸附位已经饱和。',
      pit: '饱和不等于输运限制。区分两者要看温度依赖：表面反应控制对温度极敏感，输运控制几乎不随温度变。',
      mod: 'cvd', param: 'C', rel: ['surface-limited', 'mass-transport-limited', 'series-resistance']
    },
    {
      id: 'surface-limited', cat: 'cvd', zh: '表面反应控制', en: 'Surface-reaction limited', abbr: '', sym: 'k_s ≪ h_m', unit: '',
      def: '沉积速率由表面化学反应动力学控制，速率对温度呈强 Arrhenius 依赖。',
      why: '在这个区间，温度均匀性直接决定膜厚均匀性，温度差 10 K 就可能带来明显的厚度差。',
      pit: '不要指望用「提高温度」来改善均匀性。在反应控制区，升温通常让温度分布的影响更突出。',
      mod: 'cvd', param: 'T', rel: ['langmuir', 'series-resistance', 'wafer-uniformity']
    },
    {
      id: 'mass-transport-limited', cat: 'cvd', zh: '质量输运控制', en: 'Mass-transport limited', abbr: '', sym: 'h_m ≪ k_s', unit: '',
      def: '沉积速率由气相组分输运到表面的通量控制，对温度不敏感，对流量、压力、流场敏感。',
      why: '工业上常刻意选择这个区间，用牺牲一点速率换取更好的片内均匀性。',
      pit: '输运控制区内容易发生气相成核，产生颗粒污染与粗糙表面，需要配合低前驱体分压。',
      mod: 'cvd', param: 'Q', rel: ['boundary-layer', 'series-resistance', 'surface-limited']
    },
    {
      id: 'series-resistance', cat: 'cvd', zh: '串联阻力', en: 'Series resistance', abbr: '', sym: '1/k = 1/k_s + 1/k_m', unit: '',
      def: '表面反应与质量输运是两个串联步骤，总阻力等于两者倒数之和，速率由较慢的一步决定。',
      why: '这是本平台 CVD 模块的核心公式。它使速率曲线自然出现「温度敏感段」与「流量敏感段」两段。',
      pit: '两段交界处不能用任一单段的规律外推。工艺流程常落在这个过渡区，最容易被误判。',
      mod: 'cvd', param: 'T', rel: ['surface-limited', 'mass-transport-limited', 'boundary-layer']
    },
    {
      id: 'boundary-layer', cat: 'cvd', zh: '边界层', en: 'Boundary layer', abbr: '', sym: 'δ', unit: 'mm',
      def: '气流经过衬底时在其上方形成的滞留薄层，层内以扩散为主。厚度随流速增大而减小。',
      why: '扩散通量正比于 D/δ，所以提高流量可以减薄边界层、提高沉积速率与均匀性。',
      pit: 'δ 沿程会增厚，导致片内前端厚、后端薄。只测中心点无法发现这种沿程衰减。',
      mod: 'cvd', param: 'Q', rel: ['mass-transport-limited', 'wafer-uniformity']
    },
    {
      id: 'partial-pressure', cat: 'cvd', zh: '前驱体分压', en: 'Precursor partial pressure', abbr: '', sym: 'p_i', unit: 'Torr',
      def: '前驱体在反应室气氛中所占的分压，决定表面吸附覆盖度与反应速率。',
      why: '平台用浓度（配比）参数代表前驱体供给水平，与温度、压力共同决定沉积速率。',
      pit: '分压不等于流量。提高稀释气流量会降低分压，即使前驱体流量没变。',
      mod: 'cvd', param: 'C', rel: ['langmuir', 'deposition-rate']
    },
    {
      id: 'deposition-rate', cat: 'cvd', zh: '沉积速率', en: 'Deposition rate', abbr: '', sym: 'r_dep', unit: 'nm/min',
      def: '单位时间内生长的膜厚，由表面反应速率与质量输运通量共同决定。',
      why: '本平台 CVD 模块的主输出。它同时受温度、分压、流量、压力四个参数影响。',
      pit: '速率高不等于质量好。速率上升往往伴随粗糙度增加、致密度下降、残余应力升高。',
      mod: 'cvd', param: 'T', rel: ['series-resistance', 'roughness', 'film-thickness']
    },
    {
      id: 'film-thickness', cat: 'cvd', zh: '膜厚与膜厚分布', en: 'Film thickness / Thickness profile', abbr: '', sym: 'h', unit: 'nm',
      def: '沉积结束时膜的总厚度，以及它在晶圆径向与周向上的分布。',
      why: '平台用二维晶圆场呈现膜厚分布，并给出片内均匀性数值。',
      pit: '平均膜厚合格不代表可用。边缘过薄或局部过厚都会导致后续光刻/刻蚀失配。',
      mod: 'cvd', param: 't', rel: ['deposition-rate', 'wafer-uniformity']
    },
    {
      id: 'wafer-uniformity', cat: 'cvd', zh: '片内均匀性', en: 'Within-wafer uniformity', abbr: 'WIW', sym: '(max−min)/(2·mean)', unit: '%',
      def: '同一片晶圆上膜厚（或其他指标）的相对偏差，常用半极差除以均值表示。',
      why: '平台输出该数值并用径向色标显示，能直观看到边缘效应与喷淋头周向不均。',
      pit: '五点测量无法反映旋转对称的周向不均。周向偏差需要环形多点或全片 mapping。',
      mod: 'cvd', param: 'Q', rel: ['boundary-layer', 'film-thickness', 'conformality']
    },
    {
      id: 'roughness', cat: 'cvd', zh: '表面粗糙度', en: 'Surface roughness', abbr: 'Ra / Rq', sym: 'Ra', unit: 'nm',
      def: '表面微观起伏的算术平均偏差（Ra）或均方根值（Rq）。',
      why: '粗糙度与晶粒尺寸、成核密度、气相成核颗粒直接相关，是膜质量的核心指标之一。',
      pit: '膜变厚不一定更粗糙。柱状生长在特定条件下会「自平坦化」，粗糙度反而下降。',
      mod: 'cvd', param: 'T', rel: ['deposition-rate', 'grain-growth']
    },
    {
      id: 'residual-stress', cat: 'cvd', zh: '残余应力', en: 'Residual stress', abbr: '', sym: 'σ_res', unit: 'MPa',
      def: '沉积结束后留在膜内的应力，由热膨胀失配（热应力）与生长过程本身（本征应力）两部分叠加。',
      why: '平台按 Δα·ΔT 估算热应力部分。应力过大会导致膜开裂、剥落或基片翘曲。',
      pit: '应力有拉、压两个方向。只看绝对值会误判失效模式：拉应力导致开裂，压应力导致鼓包。',
      mod: 'cvd', param: 'T', rel: ['deposition-rate', 'thermal-lag']
    },
    {
      id: 'conformality', cat: 'cvd', zh: '保形性', en: 'Conformality / Step coverage', abbr: '', sym: 't_side/t_top', unit: '',
      def: '膜在沟槽、通孔侧壁与底部的覆盖能力，通常用侧壁厚度与顶部厚度之比衡量。',
      why: '输运控制区保形性差（顶部厚、底部薄甚至封口），反应控制区保形性好。',
      pit: '均匀性好不等于保形性好。前者评价平面内厚度一致性，后者评价三维形貌覆盖能力。',
      mod: 'cvd', param: 'P', rel: ['mass-transport-limited', 'wafer-uniformity']
    },
    {
      id: 'ald-self-limit', cat: 'cvd', zh: '原子层沉积（自限性）', en: 'Atomic layer deposition (self-limiting)', abbr: 'ALD', sym: 'Δt = C·τ', unit: '',
      def: '用「脉冲与吹扫」循环交替供给两种前驱体，每次脉冲只让表面恰好饱和一个单分子层，靠自限性把厚度控制在埃级精度的成膜方法。',
      why: 'TMA/H₂O 沉积 Al₂O₃ 是它的典型代表。本平台把它建模成活化能极低（60 kJ/mol）、速率几乎不随温度变化的一层，正好对应 ALD「弱温度依赖」的真实特征。',
      pit: 'ALD 是循环过程，「沉积速率」在 nm/min 这个尺度上没有意义，真正可读的是每循环的厚度增量（约 0.1 nm/cycle）和循环数；用 CVD 的思路去理解 ALD 的速率曲线会得出错误结论。另一个容易踩的坑是温度上限：T-ALD 用 TMA/H₂O 只能在 200~400 ℃ 做，再高 TMA 会自分解。',
      mod: 'cvd', param: 'T', rel: ['surface-limited', 'langmuir', 'series-resistance']
    },
    {
      id: 'mocvd-precursor', cat: 'cvd', zh: '有机金属前驱体', en: 'Metal-organic precursor', abbr: '', sym: 'TMGa', unit: '',
      def: '以有机基团连接金属原子的气相前驱体，如三甲基镓 TMGa、三乙氧基硅烷 TEOS、四氯化钛 TiCl₄。',
      why: '有机金属前驱体挥发性好、分解温度低，是 MOCVD 能把 GaN 做到 1000 ℃ 以下的关键。平台上 GaN、TEOS 两个体系正是靠这类前驱体的分解来沉积。',
      pit: 'C 污染是 MOCVD 的通病。碳在膜里残留会改变折射率、禁带宽度和界面态密度，沉积速率高不等于膜质好。',
      mod: 'cvd', param: 'T', rel: ['langmuir', 'partial-pressure', 'residual-stress']
    },
    {
      id: 'diffusion-barrier', cat: 'cvd', zh: '扩散阻挡层', en: 'Diffusion barrier', abbr: '', sym: '', unit: '',
      def: '插在金属互连与半导体之间、用于阻断原子互扩散的薄层，常见材料有 TaN、TiN、W。',
      why: 'Cu 互连一旦向衬底扩散，会在禁带内形成深能级复合中心，把载流子寿命打掉。所以阻挡层虽是几纳米厚，却是器件良率的关键。',
      pit: '阻挡层不是越厚越好。厚阻挡层本身电阻大，而且过厚会把沉积应力积累起来，导致界面脱层。',
      mod: 'cvd', param: 't', rel: ['deposition-rate', 'residual-stress', 'film-thickness']
    },
    {
      id: 'transparent-conductor', cat: 'cvd', zh: '透明导电膜', en: 'Transparent conducting oxide', abbr: 'TCO', sym: '', unit: '',
      def: '同时具备较高电导率与可见光透过率的氧化物薄膜，ITO（掺锡氧化铟）是面板与触控电极的绝对主流。',
      why: '显示与光伏产业的基本矛盾：要导电就挡光，要透光就不导电。ITO 用 Sn 掺杂 In₂O₃ 在 5~12 % 区间把电阻率压到最低。',
      pit: 'ITO 膜的生长速率极慢（本体层仅 0.1~3 nm/min），却常被当成「薄层不算问题」。实际上它是透明电极工艺的瓶颈所在。',
      mod: 'cvd', param: 't', rel: ['deposition-rate', 'mocvd-precursor', 'film-thickness']
    },
    {
      id: 'gas-phase-nucleation', cat: 'cvd', zh: '气相成核与颗粒污染', en: 'Gas-phase nucleation', abbr: '', sym: '', unit: '',
      def: '前驱体在气相中先聚集成核、再落到衬底上形成颗粒污染的过程。',
      why: 'AlN 用 TMA/NH₃ 时气相寄生反应特别剧烈，会有 20 % 以上的输入铝变成气相颗粒，所以必须配很高的 V/III 比把氨压下去。',
      pit: '速率上不去时先降压、降温都能减少成核，但真正的解法是提高 V/III 比，即压低反应物浓度而不是简单降温。',
      mod: 'cvd', param: 'P', rel: ['partial-pressure', 'mocvd-precursor', 'deposition-rate']
    },
    {
      id: 'nucleation-barrier', cat: 'cvd', zh: '形核延迟', en: 'Nucleation delay', abbr: '', sym: '', unit: '',
      def: '从通气开始到膜真正开始生长的那段空白时间，衬底表面要先吸附、反应才能形成稳定核。',
      why: '金刚石 CVD 尤其明显：CH₄ 比例低于 5 % 时生长受甲烷供给限制甚至完全不长膜，此时温度再高也没用。',
      pit: '把形核延迟当成「设备没开好」去排查，往往找错方向。它是热力学成核能垒的结果，取决于气体比例与衬底预处理。',
      mod: 'cvd', param: 't', rel: ['deposition-rate', 'surface-limited', 'mass-transport-limited']
    },

    /* ---------------------------- 反应-扩散 ---------------------------- */
    {
      id: 'reaction-diffusion', cat: 'rd', zh: '反应-扩散方程', en: 'Reaction-diffusion equation', abbr: '', sym: '∂C/∂t = D∇²C − R(C)', unit: '',
      def: '描述物质一边扩散一边被反应消耗的偏微分方程。平台用二维显式有限差分数值求解。',
      why: '它是「渗得深不深、反应集中不集中」的统一框架，浓度场动画就是它的解。',
      pit: '反应项通常是非线性的。浓度越高消耗越快，前沿会随浓度变陡，不能按线性叠加估算。',
      mod: 'rd', param: 'C0', rel: ['damkohler', 'penetration-depth', 'finite-difference']
    },
    {
      id: 'damkohler', cat: 'rd', zh: 'Damköhler 数', en: 'Damköhler number', abbr: 'Da', sym: 'Da = kC₀L²/D', unit: '',
      def: '反应速率与扩散速率之比。Da ≫ 1 时反应快于扩散，前沿陡而浅；Da ≪ 1 时扩散快于反应，前沿宽而深。',
      why: '一个无量纲数就能判断反应发生在哪儿、能渗多深。平台直接把它作为输出指标。',
      pit: 'Da 依赖特征长度 L 的定义。不同文献定义不同，比较数量级前必须统一。',
      mod: 'rd', param: 'C0', rel: ['reaction-diffusion', 'penetration-depth', 'reaction-front']
    },
    {
      id: 'electrodeposition', cat: 'rd', zh: '电化学沉积', en: 'Electrodeposition', abbr: '', sym: 'Mⁿ⁺ + ne⁻ → M', unit: '',
      def: '溶液中的金属离子在阴极表面得电子、还原并沉积成金属层的镀覆过程，速率取决于电流密度与传质条件。',
      why: '平台把电沉积建模成强反应控制体系（Da ≫ 1）：阴极表面离子瞬间耗尽，前沿陡峭、渗透深度只有几百微米。这正是电镀层厚度分布不均的根源。',
      pit: '电沉积的驱动力是电化学势差，不是温度。把「升温能加快反应」的直觉直接搬到电镀上会得到错误结论，电镀温度过高反而常因副反应与结晶粗化而变差。',
      mod: 'rd', param: 'cat', rel: ['damkohler', 'reaction-front', 'penetration-depth']
    },
    {
      id: 'corrosion-passivation', cat: 'rd', zh: '钝化膜与腐蚀', en: 'Passivation & corrosion', abbr: '', sym: '', unit: '',
      def: '金属在潮湿环境中表面生成一层致密氧化膜，把金属与腐蚀介质隔开、显著降低腐蚀速率的现象。',
      why: '钝化膜生长同时受「膜生长（反应）」与「离子穿膜（扩散）」控制，是扩散-反应耦合最典型的教学场景：平台上腐蚀体系的 Da 约 35，属扩散控制占优。',
      pit: '「生成膜就等于保护」只在膜完整时成立。膜一旦被氯离子、划伤或孔蚀破坏，局部电流集中会加速破坏，形成自催化式的局部腐蚀。',
      mod: 'rd', param: 'C0', rel: ['reaction-diffusion', 'damkohler', 'tortuosity']
    },
    {
      id: 'solvothermal-mof', cat: 'rd', zh: '溶剂热 / MOF 骨架生长', en: 'Solvothermal & MOF growth', abbr: 'MOF', sym: '', unit: '',
      def: '在密闭高压容器中、溶剂沸点以上的温度下让前驱体缓慢反应并结晶成孔状配位骨架的合成路线。',
      why: 'MOF 的成核与生长对温度极敏感：低温时扩散慢、成核主导，骨架长不大；温度升高后成核快、晶体反而变差。平台上 mof 体系的 Da 随温度从 10 涨到 156，正好呈现这种「S 形」响应。',
      pit: 'MOF 是「孔材料」，比表面积来自孔道而不是颗粒大小。所以加大球磨、延长反应时间换来的大晶粒，常常反而使比表面积下降、性能变差。另外溶剂热通常要在 90~200 ℃ 密封十几到几十小时，把 MOF 体系当成常温体系来算扩散和动力学会完全跑偏。',
      mod: 'rd', param: 'T', rel: ['damkohler', 'nucleation-growth', 'reaction-front']
    },
    {
      id: 'penetration-depth', cat: 'rd', zh: '渗透深度', en: 'Penetration depth', abbr: '', sym: 'δ_p', unit: 'μm',
      def: '反应物浓度降到边界值某一规定比例处距表面的深度。',
      why: '平台 RD 模块的主输出之一，直接决定渗层、涂层、电极浸润层是否够厚。',
      pit: '扩散控制下渗透深度随时间按 √t 增长，不是线性增长。靠延长时间翻倍深度需要四倍时间。',
      mod: 'rd', param: 't', rel: ['damkohler', 'reaction-front', 'tortuosity']
    },
    {
      id: 'reaction-front', cat: 'rd', zh: '反应前沿', en: 'Reaction front', abbr: '', sym: 'x_f(t)', unit: 'μm',
      def: '反应主要发生的窄带，其位置随时间向内部推进。前沿不是几何面，而是有厚度的反应带。',
      why: '前沿位置与前沿梯度共同决定「渗得深不深」和「反应集中不集中」，二者常此消彼长。',
      pit: '不要把它当成一条线。前沿厚度与 Da 直接相关，Da 越小前沿越宽。',
      mod: 'rd', param: 'C0', rel: ['penetration-depth', 'concentration-gradient', 'damkohler']
    },
    {
      id: 'concentration-gradient', cat: 'rd', zh: '前沿浓度梯度', en: 'Front gradient', abbr: '', sym: '∂C/∂x', unit: '%/mm',
      def: '浓度沿深度的变化率，在反应前沿处达到最大。平台以相对梯度（%/mm）输出。',
      why: '梯度大意味着反应高度集中在前沿附近；梯度小意味着反应弥散在整个渗层内。',
      pit: '梯度大不代表渗得深。两者通常反向变化：反应越快，前沿越陡也越浅。',
      mod: 'rd', param: 'C0', rel: ['reaction-front', 'damkohler']
    },
    {
      id: 'tortuosity', cat: 'rd', zh: '曲折度', en: 'Tortuosity', abbr: '', sym: 'τ', unit: '',
      def: '孔隙通道的实际路径长度与直线距离之比，恒大于等于 1。',
      why: '有效扩散系数 D_eff = D·ε/τ，曲折度越大，实际渗得越浅。平台以「曲折度」作为可调参数。',
      pit: '曲折度无法直接测量，通常由孔隙率经验关系反推。不同经验式给出的值可能相差一倍。',
      mod: 'rd', param: 'tort', rel: ['porosity', 'fick', 'penetration-depth']
    },
    {
      id: 'porosity', cat: 'rd', zh: '孔隙率', en: 'Porosity', abbr: '', sym: 'ε', unit: '',
      def: '孔隙体积占总体积的比例。它一方面提供扩散通道，一方面减少固相体积。',
      why: 'ε 与 τ 一起决定有效扩散系数，是调控渗透深度的材料侧手段。',
      pit: '开孔与闭孔对渗透的贡献完全不同。总孔隙率相同、开闭孔比例不同的两种坯体，渗透行为可以差很远。',
      mod: 'rd', param: 'tort', rel: ['tortuosity', 'fick']
    },
    {
      id: 'second-order', cat: 'rd', zh: '二级反应', en: 'Second-order reaction', abbr: '', sym: 'R = kC²', unit: '',
      def: '反应速率与反应物浓度的平方成正比，浓度翻倍则速率变为四倍。',
      why: '平台 RD 模块采用二级反应，使边界浓度 C₀ 对前沿位置呈现明显的非线性影响。',
      pit: '高浓度下二级反应会让前沿极陡，数值上容易算出负浓度。实际求解需要限幅或改用专门格式。',
      mod: 'rd', param: 'C0', rel: ['reaction-diffusion', 'damkohler']
    },

    /* ---------------------------- 马弗炉 ---------------------------- */
    {
      id: 'setpoint', cat: 'kiln', zh: '设定温度与样品温度', en: 'Setpoint vs. Sample temperature', abbr: 'SP', sym: 'T_set / T_s', unit: '℃',
      def: '设定温度是温控表上的目标值，等价于加热元件的边界条件；样品温度是样品实际达到的温度。',
      why: '这是马弗炉模块的核心命题。两者之间的差，就是装炉位置与热惯性共同造成的损失。',
      pit: '把设定温度直接当成样品经历的温度，是理论课与工程实践之间最大的一道沟。平台就是为了拆开这两者。',
      mod: 'kiln', param: 'Tset', rel: ['boundary-condition', 'temp-gap', 'thermal-lag']
    },
    {
      id: 'furnace-field', cat: 'kiln', zh: '炉膛稳态热场', en: 'Furnace temperature field', abbr: '', sym: '∇²T = 0', unit: '',
      def: '炉膛内温度的空间分布，由四壁给定的边界温度与炉膛几何共同决定，稳态下满足拉普拉斯方程。',
      why: '平台用 SOR 迭代在 64×40 网格上解出这个场。装料区的温差不是假设的，是这个解的自然结果。',
      pit: '空炉解出的场与装载后的场不同。样品与坩埚会吸收热量、遮挡辐射，把局部温度拉低。',
      mod: 'kiln', param: 'Tset', rel: ['boundary-condition', 'isotherm', 'uniformity']
    },
    {
      id: 'isotherm', cat: 'kiln', zh: '等温线', en: 'Isotherm', abbr: '', sym: 'T = const', unit: '',
      def: '温度相等的点连成的曲线。等温线越密，说明该处温度梯度越大。',
      why: '炉门与四角处等温线明显弯折、密集，这是「不均匀」最直观的图形证据。',
      pit: '等温线稀疏不代表温度均匀，也可能只是色标跨度过大把差异压平了。要结合数值一起看。',
      mod: 'kiln', param: 'Tset', rel: ['furnace-field', 'uniformity']
    },
    {
      id: 'loading-position', cat: 'kiln', zh: '装炉位置', en: 'Loading position', abbr: '', sym: 'sx, sy', unit: '%',
      def: '样品在炉膛内的坐标，本平台用水平位置 sx 与垂直位置 sy 两个百分比表示，可直接在炉膛剖面里拖动。',
      why: '同一条温控曲线、同一批材料，位置不同拿到的边界温度就不同，最终转化率可以差三十个百分点以上。',
      pit: '「放中间」不等于「放最热处」。最热处通常偏向加热元件一侧，而不是几何中心。',
      mod: 'kiln', param: 'sx', rel: ['furnace-field', 'effective-zone', 'uniformity']
    },
    {
      id: 'effective-zone', cat: 'kiln', zh: '有效装料区', en: 'Effective loading zone', abbr: '', sym: '', unit: '',
      def: '温度偏差满足工艺要求（例如 ±5 K）的装料区域。平台在底部剖面图上用淡色带标出常用装料区。',
      why: '它回答了「那到底能放在哪儿」这个工程问题：不均匀无法消除，但可以避开。',
      pit: '有效区随设定温度变化，高温下通常变窄。按低温炉的经验布置高温炉装料会出问题。',
      mod: 'kiln', param: 'sx', rel: ['uniformity', 'loading-position', 'temp-gap']
    },
    {
      id: 'effective-hold', cat: 'kiln', zh: '有效保温时间', en: 'Effective hold time', abbr: '', sym: 't_eff', unit: 'min',
      def: '样品温度达到设定值某一比例（平台取 95%，或差值小于 10 K）的累计时间。',
      why: '设定保温 120 min，靠炉门的位置可能一分钟有效保温都没有，因为它从头到尾没接近过设定温度。',
      pit: '「到温后开始计时」的仪表逻辑只对控温点有效，无法反映样品真实受热，这是批次一致性问题的根源。',
      mod: 'kiln', param: 'hold', rel: ['thermal-lag', 'temp-gap', 'setpoint']
    },
    {
      id: 'temp-gap', cat: 'kiln', zh: '温度缺口', en: 'Temperature gap', abbr: '', sym: 'ΔT_gap', unit: 'K',
      def: '设定温度与样品峰值温度之差。平台把它作为独立指标输出。',
      why: '它把「表温」与「件温」的偏离变成一个可读的数字，是这个模块最直接的教学抓手。',
      pit: '缺口不是固定值。它随升温速率增大而增大，随装炉位置变冷而增大，不能当成设备的常数偏差。',
      mod: 'kiln', param: 'ramp', rel: ['thermal-lag', 'setpoint', 'effective-hold']
    },
    {
      id: 'heat-leak', cat: 'kiln', zh: '炉门漏热', en: 'Heat leakage at the door', abbr: '', sym: 'q_loss', unit: 'W',
      def: '炉门、观察孔、电极引出处的额外散热，使这些位置的边界温度低于炉壁。',
      why: '平台给炉门边界一个低于炉壁的系数，于是门口形成明显的「冷区」，等温线在此塌陷。',
      pit: '漏热对小炉更显著。把实验室小炉的结果按比例放大到大炉，会低估门侧温差的相对影响。',
      mod: 'kiln', param: 'sx', rel: ['boundary-condition', 'furnace-field', 'uniformity']
    },
    {
      id: 'load-heat-capacity', cat: 'kiln', zh: '装载热容', en: 'Load heat capacity', abbr: '', sym: 'C_load = ρVc_p', unit: 'J/K',
      def: '装入炉内的坩埚与样品的总热容，决定样品的热时间常数与滞后量。',
      why: '装得越多，τ 越大，同一条曲线下有效保温越短。这也是为什么换批次装载后原曲线不再适用。',
      pit: '装载量改变后必须重新设计升温程序。沿用旧曲线是批次间性能波动的常见来源。',
      mod: 'kiln', param: 'sy', rel: ['thermal-time-const', 'thermal-lag']
    },
    {
      id: 'furnace-atmosphere', cat: 'kiln', zh: '炉内气氛', en: 'Furnace atmosphere', abbr: '', sym: 'p(O₂)', unit: '',
      def: '马弗炉炉膛内与样品接触的气体成分与分压，常见为空气、惰性气、还原气或氮气，决定了样品发生氧化、还原、氮化还是碳化。',
      why: '气氛是热学之外的第二个「边界条件」，而且常是不可逆的那一个。MnZn 铁氧体在低氧分压下 1230 ℃ 就能成单相尖晶石，而在空气中要 1300 ℃ 才行。',
      pit: '气氛不进温度曲线，所以只看热曲线会以为工艺没问题。同一炉温度、同一装炉位置，换个气氛可能就得到完全不同的物相。',
      mod: 'kiln', param: 'Tset', rel: ['setpoint', 'over-under-fire', 'load-heat-capacity']
    },

    /* -------------------------- 数值与智能寻优 -------------------------- */
    {
      id: 'finite-difference', cat: 'num', zh: '有限差分法', en: 'Finite difference method', abbr: 'FDM', sym: '∂T/∂x ≈ ΔT/Δx', unit: '',
      def: '用差商代替导数，把偏微分方程离散成一组代数方程，再逐点求解。',
      why: '平台的浓度场与炉膛热场都用它求解。网格越密精度越高，但计算量按网格数平方增长。',
      pit: '二阶精度不代表误差单调下降。边界条件处理往往只有一阶，会拖累整体精度。',
      mod: 'rd', param: '', rel: ['explicit-stability', 'grid-independence']
    },
    {
      id: 'explicit-stability', cat: 'num', zh: '显式格式与稳定性', en: 'Explicit scheme stability', abbr: '', sym: 'Δt ≤ Δx²/(2D)', unit: '',
      def: '显式时间推进每一步只用已知时刻的值，时间步长必须小于稳定性上限，否则误差会指数放大。',
      why: '平台据此反推时间步数并设上限。曾出现过步长超限导致梯度算到 1e24 的数值发散。',
      pit: '加大时间步「省时间」是错觉。越过稳定限后结果不是变粗糙，而是直接崩掉。',
      mod: 'rd', param: 't', rel: ['cfl', 'finite-difference']
    },
    {
      id: 'photoresist-develop', cat: 'rd', zh: '光刻胶显影', en: 'Photoresist development', abbr: '', sym: '', unit: '',
      def: '用碱性显影液把曝光后碱溶的光刻胶溶解掉，把潜像转成实体图形的过程。',
      why: '显影速率与扩散系数同步受温度支配，25 ℃ 下溶解速率每升高 1 ℃ 约涨 8~12 %，14 nm 节点因此要求显影温度控制在 ±0.1 ℃。',
      pit: '显影时间不足会留下残胶，过度则侧壁被掏蚀、线宽塌陷。显影不是「多冲一会儿更干净」，而是必须在窗口内停。',
      mod: 'rd', param: 'T', rel: ['reaction-front', 'concentration-gradient', 'damkohler']
    },
    {
      id: 'undercut', cat: 'rd', zh: '侧蚀与钻蚀', en: 'Lateral undercut', abbr: '', sym: '', unit: '',
      def: '刻蚀液从掩模边缘渗到掩模下方、把侧壁掏空的破坏性刻蚀行为。',
      why: '湿法刻蚀中刻蚀剂同时从上方与侧向到达，反应与扩散哪一方占优直接决定图形保真度，这正是 Damköhler 数要回答的问题。',
      pit: '把钻蚀归因于「刻蚀时间太长」只是表象。扩散控制的体系即使缩短时间，只要温度仍偏高端，钻蚀依然存在。',
      mod: 'rd', param: 'T', rel: ['damkohler', 'reaction-front', 'tortuosity']
    },
    {
      id: 'hydrogen-embrittlement', cat: 'rd', zh: '氢脆与延迟断裂', en: 'Hydrogen embrittlement', abbr: '', sym: '', unit: '',
      def: '金属吸氢后韧性显著下降、在低于屈服强度下延迟断裂的现象。',
      why: 'γ-Fe 中氢扩散活化能只有约 23 kJ/mol，扩散极快；一旦扩散到晶界、位错等不可逆陷阱，裂纹就失去可逆性。',
      pit: '氢脆常被误判为「材料强度不够」。真正的对策是控氢（镀层、烘烤除氢）与除氢，而不是简单降强度使用。',
      mod: 'rd', param: 'T', rel: ['arrhenius', 'penetration-depth', 'porosity']
    },
    {
      id: 'wetting-infiltration', cat: 'rd', zh: '浸润与渗透', en: 'Wetting and infiltration', abbr: '', sym: '', unit: '',
      def: '液体在多孔介质中润湿并渗入孔隙的过程，渗透速率由孔隙曲折度与界面接触角共同决定。',
      why: '电池隔膜电解液浸润不足会抬高界面阻抗、诱发析锂；隔膜的曲折度正是渗透深度的直接抑制因素。',
      pit: '把浸润问题当成「多加电解液」去解决是无效的。多加的液体只是堆在表面，接触不到孔道深处。',
      mod: 'rd', param: 'tort', rel: ['tortuosity', 'porosity', 'penetration-depth']
    },
    {
      id: 'cfl', cat: 'num', zh: '网格 Fourier 数与 CFL 条件', en: 'Grid Fourier number / CFL condition', abbr: '', sym: 'Fo = DΔt/Δx²', unit: '',
      def: '衡量一个时间步内扩散跨越多少个网格。显式格式要求 Fo ≤ 0.5（二维 ≤ 0.25）。',
      why: '平台取 0.2 作为安全系数，在精度与耗时之间折中。',
      pit: '同时存在对流时还要满足 Courant 条件（uΔt/Δx ≤ 1），只看扩散条件会漏掉一半限制。',
      mod: 'rd', param: 't', rel: ['explicit-stability', 'finite-difference']
    },
    {
      id: 'grid-independence', cat: 'num', zh: '网格无关性', en: 'Grid independence', abbr: '', sym: '', unit: '',
      def: '网格加密到一定程度后，结果不再随网格变化，此时才认为数值解可信。',
      why: '平台提供 fast / mid / full 三档网格，本身就构成一次网格无关性检验。',
      pit: '只在一个工况下验证网格无关性不够。参数变化可能改变梯度，需要在高梯度工况复核。',
      mod: 'rd', param: '', rel: ['finite-difference', 'sor']
    },
    {
      id: 'sor', cat: 'num', zh: 'SOR 迭代', en: 'Successive over-relaxation', abbr: 'SOR', sym: 'ω', unit: '',
      def: '逐点松弛迭代求解椭圆型方程，用松弛因子 ω 加速收敛，ω 通常在 1 到 2 之间。',
      why: '平台用它对炉膛稳态热场迭代 900 次，得到收敛的温度分布。',
      pit: 'ω 过大导致振荡不收敛，过小则收敛极慢。最佳值与网格规模有关，不能随便取 1.9。',
      mod: 'kiln', param: '', rel: ['furnace-field', 'grid-independence']
    },
    {
      id: 'sweep', cat: 'num', zh: '参数扫掠', en: 'Parametric sweep', abbr: '', sym: '', unit: '',
      def: '固定其他参数，只让一个参数在量程内取若干点，得到该参数对目标的响应曲线。',
      why: '「边界条件响应」页就是参数扫掠。它能把「改这个参数到底改了什么」画成一条看得见的曲线。',
      pit: '单参数扫掠看不到交互作用。温度与时间的耦合、浓度与曲折度的耦合都需要二维扫描才能暴露。',
      mod: 'solid', param: 'T', rel: ['sensitivity', 'coordinate-descent']
    },
    {
      id: 'sensitivity', cat: 'num', zh: '敏感性分析', en: 'Sensitivity analysis', abbr: '', sym: '±15%', unit: '',
      def: '让各参数在各自量程的固定比例内变动，比较目标的变化幅度并排序。',
      why: '平台用龙卷风图呈现，能快速回答「先调哪个参数最有效」。',
      pit: '敏感性依赖工作点。在低温段最敏感的参数，到高温段可能变成最不敏感的那个。',
      mod: 'solid', param: '', rel: ['sweep', 'coordinate-descent']
    },
    {
      id: 'coordinate-descent', cat: 'num', zh: '坐标下降', en: 'Coordinate descent', abbr: '', sym: '', unit: '',
      def: '固定其他维度、只沿一个维度寻优，逐维轮换迭代直到不再改善。适合低维黑箱目标。',
      why: '平台的智能寻优先用 4^N 粗网格全局撒点，再用坐标下降细化，10~900 ms 内给出前三方案。',
      pit: '多峰目标下容易陷入局部最优。所以粗网格撒点不能省，它是全局性的保障。',
      mod: 'solid', param: '', rel: ['sweep', 'constrained-opt']
    },
    {
      id: 'constrained-opt', cat: 'num', zh: '约束优化', en: 'Constrained optimization', abbr: '', sym: 'max f(x) s.t. g(x) ≤ 0', unit: '',
      def: '在满足一组约束（如粗糙度 ≤ 3 nm、晶粒 ≤ 12 μm）的前提下，最大化或最小化目标函数。',
      why: '平台先筛选满足约束的候选，再在可行域内比较目标值，避免给出「指标漂亮但工艺不可行」的方案。',
      pit: '约束不可达时应当提示放宽，而不是硬返回一个违反约束的「最优解」。这是优化器最常见的失信方式。',
      mod: 'cvd', param: '', rel: ['coordinate-descent', 'sensitivity']
    },
    /* ------------------------------ 热处理 ------------------------------ */
    {
      id: 'carbon-content', cat: 'heat', zh: '碳含量与 Fe-C 相图', en: 'Carbon content', abbr: '', sym: 'C%', unit: 'wt%',
      def: '铁碳合金中碳的质量分数。共析点 0.8%，低于它出现先共析铁素体，高于它出现先共析渗碳体。',
      why: '这是热处理里唯一不能靠工艺调整的变量：它同时定下了 Ac3 的位置、珠光体的比例，以及矫顽力的下限。',
      pit: '不要把钢与铁的界线记成 2.11%。那是碳在奥氏体中的最大溶解度；室温下碳在铁素体中的溶解度只有约 0.00005%，所以哪怕 0.02% 的碳也几乎全部以渗碳体形式存在。',
      mod: 'heat', param: 'C', rel: ['austenitizing', 'cct-curve', 'coercivity']
    },
    {
      id: 'austenitizing', cat: 'heat', zh: '奥氏体化', en: 'Austenitization', abbr: '', sym: 'Ac1 / Ac3', unit: '℃',
      def: '加热到 Ac1（727 ℃）以上使珠光体转变为奥氏体；亚共析钢需超过 Ac3 才能完全奥氏体化。',
      why: '只有完全奥氏体化，冷却时才有条件得到均匀的马氏体或细珠光体。奥氏体化程度决定了最终组织的地基。',
      pit: 'Ac3 随碳含量升高而下降（约 912 − 203√C），所以不同牌号的加热温度不能统一。加热不足会残留未溶铁素体、硬度上不去；加热过高则晶粒粗化。',
      mod: 'heat', param: 'Tset', rel: ['carbon-content', 'grain-growth', 'martensite']
    },
    {
      id: 'cct-curve', cat: 'heat', zh: '连续冷却转变曲线', en: 'Continuous cooling transformation', abbr: 'CCT', sym: 'CCT', unit: '',
      def: '以冷却速度为横轴、温度为纵轴，标出各冷速下转变开始与结束的温度区间。',
      why: '它就是「冷却速度决定组织」的定量表达：左上为珠光体区，中部为贝氏体区，下方为马氏体区。临界冷速是能否淬硬的判据。',
      pit: 'CCT 不等于 TTT。TTT 是等温转变曲线，直接把 TTT 当连续冷却用会高估临界冷速，误以为空冷也能淬硬。',
      mod: 'heat', param: 'cool', rel: ['martensite', 'pearlite-series', 'carbon-content']
    },
    {
      id: 'pearlite-series', cat: 'heat', zh: '珠光体、索氏体与托氏体', en: 'Pearlite / Sorbite / Troostite', abbr: 'P / S / T', sym: '', unit: '',
      def: '三者都是铁素体与渗碳体交替排列的层片状组织，区别只在片层间距。',
      why: '片层越细，铁素体与渗碳体的相界面越多，硬度越高，对磁畴壁的钉扎也越强。粗珠光体片层约 0.3 μm 以上，索氏体约 0.25~0.3 μm，托氏体小于 0.25 μm。',
      pit: '索氏体与托氏体都不是独立相，只是珠光体的细片形态。回火得到的「回火索氏体」与连续冷却得到的索氏体形貌相近，但成因完全不同，不能混为一谈。',
      mod: 'heat', param: 'cool', rel: ['cct-curve', 'martensite', 'coercivity']
    },
    {
      id: 'martensite', cat: 'heat', zh: '马氏体与 Ms 点', en: 'Martensite', abbr: '', sym: 'Ms', unit: '℃',
      def: '奥氏体以无扩散切变方式转变形成的碳过饱和固溶体，碳被强制固溶在体心正方晶格中。',
      why: '硬度极高，但位错密度与内应力也极高，是磁畴壁的强钉扎点。所以淬火态矫顽力比退火态高一个数量级。',
      pit: '马氏体转变不完全。碳越高 Ms 越低（中碳钢约 350 ℃，共析钢约 200 ℃），高碳钢淬火后必然残留一部分奥氏体，需要深冷处理或多次回火才能减少。',
      mod: 'heat', param: 'cool', rel: ['cct-curve', 'austenitizing', 'coercivity']
    },
    {
      id: 'decarburization', cat: 'heat', zh: '脱碳', en: 'Decarburization', abbr: '', sym: 'x_d', unit: 'mm',
      def: '高温下表层碳与氧、水汽、二氧化碳反应生成气体逸出，使表面碳含量降低，形成一层铁素体为主的贫碳层。',
      why: '脱碳层硬度低、组织接近纯铁，对软磁反而降低矫顽力，但会显著降低疲劳强度与表面耐磨性，是热处理最常见的表面缺陷。',
      pit: '真空不等于不脱碳。低真空下残余氧与水汽仍会造成脱碳，只是速率低得多；要靠保护气氛或足够高的真空度，而不是简单抽气。',
      mod: 'heat', param: 'atm', rel: ['furnace-atmosphere', 'coercivity', 'carbon-content']
    },
    {
      id: 'coercivity', cat: 'heat', zh: '矫顽力与磁畴钉扎', en: 'Coercivity', abbr: 'Hc', sym: 'Hc', unit: 'A/m',
      def: '使磁化强度降为零所需的反向磁场，衡量材料被磁化之后「记住」的程度。',
      why: '软磁要求越低越好（电磁纯铁约 40~80 A/m），硬磁则相反。凡是能钉扎磁畴壁的缺陷都会抬高它：晶界、渗碳体、位错、内应力。',
      pit: '提高强度与降低矫顽力在钢里往往互相冲突：细化晶粒、增加碳化物能强化，却同时增加钉扎点。这就是磁钢选材的核心矛盾，也是退火要「粗晶 + 少碳化物」的原因。',
      mod: 'heat', param: 'cool', rel: ['martensite', 'decarburization', 'carbon-content']
    }
  ];

  var byId = {};
  TERMS.forEach(function (t) { byId[t.id] = t; });

  var catById = {};
  CATS.forEach(function (c) { catById[c.id] = c; });

  var API = { cats: CATS, catById: catById, terms: TERMS, byId: byId, count: TERMS.length };
  global.GLOSSARY = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
