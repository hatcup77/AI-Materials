/* =========================================================================
 *  界面配置 · 碳钢热处理
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
  // 奥氏体化温度按当前碳含量现算：换牌号后 Ac3 会变，构建时算死会错位。
  function tAust(cur) {
    var a = 912 - 203 * Math.sqrt(Math.max(cur.C, 0.01));
    return Math.round(Math.min(950, Math.max(770, a + 40)) / 5) * 5;
  }
  var PRESETS = [
    { name: '退火（炉冷）', p: function (cur) { return { Tset: tAust(cur), hold: 120, zone: 1, medium: 0, temperT: 0 }; } },
    { name: '正火（空冷）', p: function (cur) { return { Tset: tAust(cur), hold: 60, zone: 1, medium: 1, temperT: 0 }; } },
    { name: '淬火（水冷）', p: function (cur) { return { Tset: tAust(cur), hold: 30, zone: 1, medium: 3, temperT: 0 }; } },
    { name: '淬火（油冷）', p: function (cur) { return { Tset: tAust(cur), hold: 30, zone: 1, medium: 2, temperT: 0 }; } },
    { name: '调质（淬火+高温回火）', p: function (cur) { return { Tset: tAust(cur), hold: 30, zone: 1, medium: 3, temperT: 550 }; } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    return '<span class="lg-item"><span class="sw" style="background:rgb(92,108,128)"></span>铁素体</span>' +
      '<span class="lg-item"><span class="sw" style="background:rgb(70,84,104)"></span>珠光体</span>' +
      '<span class="lg-item"><span class="sw" style="background:rgb(58,68,92)"></span>贝氏体</span>' +
      '<span class="lg-item"><span class="sw" style="background:rgb(38,44,66)"></span>马氏体</span>';
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var out = [];

    var fr = extra.fracS || {};
    out.push({ text: '按 ' + p.C.toFixed(2) + ' wt% C 计算：Ac1 = 727 ℃、Ac3 = ' + fmtNum(extra.Ac3, 0) +
      ' ℃、Ms = ' + fmtNum(extra.Ms, 0) + ' ℃。' + (extra.zoneOff < 0 ? '装在' + extra.zoneName + '（' +
      fmtNum(extra.zoneOff, 0) + ' ℃），实际' : '装在' + extra.zoneName + '，实际') +
      '奥氏体化程度 <b>' + fmtNum(mv('austF'), 0) + '%</b>，晶粒 <b>' + fmtNum(mv('grain'), 0) + ' μm</b>。' });

    var parts = [];
    if ((fr.fM || 0) > 0.01) parts.push('马氏体 ' + fmtNum(fr.fM * 100, 0) + '%');
    if ((fr.fB || 0) > 0.01) parts.push('贝氏体 ' + fmtNum(fr.fB * 100, 0) + '%');
    if ((fr.fP || 0) > 0.01) parts.push('珠光体 ' + fmtNum(fr.fP * 100, 0) + '%');
    if ((fr.fF || 0) > 0.01) parts.push('铁素体 ' + fmtNum(fr.fF * 100, 0) + '%');
    if ((fr.fCem || 0) > 0.01) parts.push('渗碳体 ' + fmtNum(fr.fCem * 100, 0) + '%');
    /* 调质工况下 KPI 硬度是回火后的终值，组织对应淬火态，要把淬火态硬度单独换算说明 */
    var hvQ = fr.fM * (250 + 800 * p.C) + fr.fB * 420 + fr.fP * 205 + fr.fF * 90 + fr.fCem * 550;
    var hrcQ = clampHrc(hvQ);
    out.push({ text: extra.medName + '至室温，表面组织（淬火态）：' + (parts.join('、') || '无转变') + '。' +
      (extra.temperOn
        ? '淬火态硬度约 <b>' + fmtNum(hrcQ, 1) + ' HRC</b>。'
        : '表面硬度 <b>' + fmtNum(mv('HRCs'), 1) + ' HRC</b>，心部 <b>' +
          fmtNum(mv('HRCc'), 1) + ' HRC</b>，淬硬层 <b>' + fmtNum(mv('caseDepth'), 1) + ' mm</b>。'),
      warn: mv('HRCs') >= 55 && p.temperT === 0 });

    if (extra.temperOn) {
      out.push({ text: '回火 ' + fmtNum(extra.temperT, 0) + ' ℃ × 60 min' +
        '，马氏体/贝氏体分解软化约 <b>' + fmtNum((extra.soften || 0) * 100, 0) +
        '%</b>：最终硬度 表面 <b>' + fmtNum(mv('HRCs'), 1) + ' HRC</b> / 心部 <b>' +
        fmtNum(mv('HRCc'), 1) + ' HRC</b>，淬硬层 <b>' + fmtNum(mv('caseDepth'), 1) +
        ' mm</b>，抗拉强度 <b>' + fmtNum(mv('Rm'), 0) + ' MPa</b>。' });
    } else if (mv('HRCs') >= 50) {
      out.push({ text: '淬火态硬而脆，残余应力高，直接承载易开裂——工程上必须配合回火使用。',
        warn: true });
    }
    return out;
  }

  function clampHrc(hv) { return Math.min(66, Math.max(0, (hv - 100) / 9.3)); }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

    var austF = extra.austF == null ? 1 : extra.austF;
    if (austF < 0.95) {
      var why = p.Tset < extra.Ac3
        ? '加热温度低于 Ac3 = ' + fmtNum(extra.Ac3, 0) + ' ℃，只有部分奥氏体化'
        : '装在' + (extra.zoneName || '偏冷温区') + '，实际保温温度只有约 ' +
          fmtNum(p.Tset + (extra.zoneOff || 0), 0) + ' ℃';
      list.push({ t: '奥氏体化只有约 ' + fmtNum(austF * 100, 0) + '%：' + why +
        '。未转变部分保留原始组织，淬火硬度和淬硬层都会打折。建议升温、延长保温或移到均温区。',
        c: 'var(--amber)' });
    }
    if (p.medium === 3 && p.dia >= 50 && austF > 0.9) {
      list.push({ t: '直径 ' + fmtNum(p.dia, 0) + ' mm 还大件水冷，表里温差极大，淬火应力可能超过强度而<b>开裂</b>。' +
        '可考虑油冷、双液淬火或改用淬透性更好的钢。', c: 'var(--red)' });
    }
    if (p.temperT >= 250 && p.temperT <= 350) {
      list.push({ t: fmtNum(p.temperT, 0) + ' ℃ 落在第一类回火脆性区间（约 250~350 ℃），韧性反而下降且不可恢复。' +
        '要保硬选 200 ℃ 以下，要强韧选 500 ℃ 以上。', c: 'var(--red)' });
    }
    if (mv('HRCs') >= 50 && p.temperT === 0) {
      list.push({ t: '表面硬度 ' + fmtNum(mv('HRCs'), 1) + ' HRC 的淬火态马氏体硬而脆。加一道 550 ℃ 高温回火就是调质处理，' +
        '强度略降、韧性大增，轴类零件都这么做。', c: 'var(--violet)' });
    }
    if (mv('HRCc') < 35 && p.medium >= 2 && !extra.temperOn) {
      list.push({ t: '心部只有 ' + fmtNum(mv('HRCc'), 1) + ' HRC：直径 ' + fmtNum(p.dia, 0) +
        ' mm 已超出这种钢 + 这种介质的淬透能力，淬硬层 ' + fmtNum(mv('caseDepth'), 1) +
        ' mm。换更激烈的介质、减小直径或选碳更高的钢都能加深硬化层。', c: 'var(--amber)' });
    }
    if (mv('HRCs') < 25 && p.medium >= 2 && !extra.temperOn) {
      list.push({ t: '表面硬度不足 ' + fmtNum(mv('HRCs'), 1) +
        ' HRC：冷却不够快或奥氏体化不完全，先检查加热段再考虑换介质。', c: 'var(--amber)' });
    }
    if (austF > 0.95 && mv('HRCc') >= 45) {
      list.push({ t: '工件已淬透：表面 ' + fmtNum(mv('HRCs'), 1) + ' HRC、心部 ' + fmtNum(mv('HRCc'), 1) +
        ' HRC，表里性能一致，适合整体受力的零件。', c: 'var(--green)' });
    }
    list.push({ t: '教学建议：牌号与工艺固定，只把工件直径从 25 mm 拉到 100 mm，观察 CCT 图上心部冷却曲线' +
      '如何「穿出」珠光体区、淬硬层圆圈如何收缩。', c: 'var(--cyan)' });
    return list;
  }

  /* ------------------------------ 教学引导 ------------------------------ */
  function guideAim(M) {
    return '同一种 45 钢，加热到奥氏体区后一个下水、一个进炉，为什么一个硬得划玻璃、一个软得能锉动？<br>' +
      '热处理三段各有分工：<b>加热与保温</b>决定奥氏体化程度与晶粒大小（还受装炉温区影响），' +
      '<b>冷却</b>决定过冷奥氏体沿 CCT 曲线走到哪里，<b>回火</b>在硬度与韧性之间重新找平衡。<br>' +
      '要建立的判断是：<b>成分与工艺决定组织分布，组织分布决定零件各处的力学性能。</b>'
  }

  function guideSteps() {
    var html = '';
    html += '<div class="guide-sec"><h3>四、操作步骤</h3><ul>' +
      '<li>选牌号：20 钢（低碳）、45 钢（中碳）、T8 钢（共析）。碳含量可随时在左侧微调。</li>' +
      '<li>设加热温度：默认已按 Ac3 + 40 ℃ 给出。故意调低再看「奥氏体化程度」KPI 的变化。</li>' +
      '<li>切<b>装炉位置</b>：炉门区偏冷、炉后区偏热，同一设定温度下保温效果不同。</li>' +
      '<li>选<b>冷却介质</b>：炉冷 / 空冷 / 油冷 / 水冷，看 CCT 图上冷却曲线与 C 曲线的交点。</li>' +
      '<li>拖<b>工件直径</b>：观察截面金相图上淬硬层圆圈的变化，心部何时「淬不透」。</li>' +
      '<li>设<b>回火温度</b>：0 为不回火；200 ℃ 保硬；550 ℃ + 水冷就是调质。</li>' +
      '<li>点五个工艺预设（退火 / 正火 / 水淬 / 油淬 / 调质），分别运行仿真，在「数据与报告」勾选 2–5 组记录并点击「开始对比」，查看工艺与硬度的差异。</li>' +
      '<li>打开<b>实时演算</b>：冷却曲线在 CCT 图上逐步画出，穿过转变区时组织图一格格转变。</li>' +
      '</ul></div>';
    html += '<div class="guide-sec"><h3>五、思考题</h3><ul>' +
      '<li>45 钢 φ100 mm 水淬，心部为什么还是软的？把直径降到 25 mm 呢？</li>' +
      '<li>20 钢水淬后表面硬度为什么远低于 45 钢？这种「软表层」工件还能用吗？</li>' +
      '<li>CCT 图上冷却曲线与 C 曲线相交意味着什么？不相交的部分去了哪里？</li>' +
      '<li>装炉位置偏了（炉门区），同一炉工件性能为什么会参差不齐？</li>' +
      '<li>调质处理为什么强调「淬火 + 高温回火」两步？只做一步会怎样？</li>' +
      '</ul></div>';
    return html;
  }

  /* 实验报告里「一、实验目的」的写法：同一套判断，但更书面 */
  function reportAim(M) {
    return '研究碳钢（20、45、T8）热处理过程中，加热温度、装炉温区、冷却介质与工件直径对奥氏体化程度、' +
      '过冷奥氏体转变产物及截面硬度分布的影响：基于一维径向传热与 CCT 曲线沿程积分，' +
      '测定表面与心部硬度、淬硬层深度，并考察淬火 + 回火工艺链对强韧匹配的改善，' +
      '确定典型零件的合理热处理工艺窗口。'
  }

  /* ---------------------------- KPI 口径声明 ---------------------------- */
  /* 本实验里晶粒粗化意味着淬火组织粗大、韧性下降，与软磁口径相反。 */
  function grainHint(val) {
    return val >= 50 ? '奥氏体晶粒偏粗' : (val >= 20 ? '中等晶粒' : '细晶，组织细小');
  }

  /* --------------------------- 对比图坐标轴声明 --------------------------- */
  /* 这个实验的各组差异主要体现在冷却介质（与回火），图例标介质才有意义。 */
  var MEDIA_NAMES = ['炉冷', '空冷', '油冷', '水冷'];
  var COMPARE_AXIS = {
    tag: function (p) {
      return MEDIA_NAMES[Math.round(p.medium)] + (p.temperT > 0 ? ' +' + Math.round(p.temperT) + '℃回火' : '');
    },
    note: ' · 标注为冷却介质与回火',
    short: function (r) { return MEDIA_NAMES[Math.round(r.params.medium)]; }
  };

  /* 实验报告「结论与建议」里的工况摘要：这个实验的关键差异是介质与回火。 */
  function reportBrief(p, fmt) {
    return '设定 ' + fmt(p.Tset, 0) + ' ℃ / ' + MEDIA_NAMES[Math.round(p.medium)] +
      ' / φ' + fmt(p.dia, 0) + ' mm' + (p.temperT > 0 ? ' / ' + fmt(p.temperT, 0) + ' ℃ 回火' : '');
  }

  C.registerUI({
    id: 'quench',
    presets: PRESETS,
    viz: { title: '截面金相 · CCT 图 · 温度曲线', sub: '冷却曲线与 C 曲线的交点决定各处的组织 · 右下为炉膛温区', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim,
    reportBrief: reportBrief,
    grainHint: grainHint,
    seriesDefault: 'all',
    compareAxis: COMPARE_AXIS
  });
})(typeof window !== 'undefined' ? window : globalThis);
