/* =========================================================================
 *  界面配置 · 反应-扩散
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
  var PRESETS = [
        { name: '快速渗透', p: { T: 85, C0: 0.35, cat: 2.4, tort: 1.2, t: 90 } },
        { name: '深度处理', p: { T: 40, C0: 0.2, cat: 0.7, tort: 1.1, t: 170 } },
        { name: '高强度反应', p: { T: 75, C0: 0.9, cat: 2.6, tort: 1.6, t: 120 } },
        { name: '受限扩散', p: { T: 55, C0: 0.5, cat: 1.0, tort: 2.8, t: 150 } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    var fmtNum = ctx.fmtNum;
      return '<span class="lg-item"><span class="grad" style="background:linear-gradient(90deg,#080c28,#1a3c78,#109282,#46c078,#e6dc5a)"></span></span>' +
        '<span class="lg-item">低 → 高浓度</span>';
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, v = ctx.v, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum, signed = ctx.signed;
    var paramDef = ctx.paramDef, est = ctx.est;
    var out = [];

      var altTT = Math.min(paramDef('T').max, p.T + 15);
      var altCC = Math.min(paramDef('C0').max, p.C0 + 0.2);
      var altT = est({ T: altTT });
      var altC = est({ C0: altCC });
      out.push({ text: '边界浓度 C₀ = <b>' + p.C0.toFixed(2) + ' mol/L</b>、温度 ' + p.T + ' ℃ 时，' + p.t +
        ' min 后平均转化率 <b>' + fmtNum(mv('conversion'), 1) + '%</b>，渗透深度 <b>' +
        fmtNum(mv('penetration'), 0) + ' μm</b>，前沿推进速率 ' + fmtNum(mv('front'), 1) + ' μm/min。' });
      out.push({ text: 'Damköhler 数 Da = kL²/D = <b>' + fmtNum(mv('da'), 0) + '</b>（' +
        (mv('da') > 100 ? '≫ 1，反应控制，前沿陡峭' : (mv('da') > 1 ? '≈ 1，过渡控制区' : '≪ 1，扩散控制，分布平缓')) +
        '），前沿浓度梯度 ' + fmtNum(mv('grad'), 0) + ' %/mm。' });
      out.push({ text: '温度由 ' + p.T + ' ℃ 升至 ' + altTT + ' ℃：转化率 ' + fmtNum(mv('conversion'), 1) + '% → <b>' +
        fmtNum(altT.conversion, 1) + '%</b>，渗透深度 ' + fmtNum(mv('penetration'), 0) + ' → <b>' +
        fmtNum(altT.penetration, 0) + ' μm</b>。k 的温度敏感性高于 D，因此升温使 Da 增大、反应区收窄。', warn: altT.penetration < 600 });
      out.push({ text: '边界浓度提高至 ' + altCC.toFixed(2) + ' mol/L：Da 由 ' + fmtNum(mv('da'), 0) + ' 增至 <b>' +
        fmtNum(altC.da, 0) + '</b>，渗透深度降为 ' + fmtNum(altC.penetration, 0) + ' μm，二级反应使浓度对前沿位置呈非线性影响。' });
    return out;
  }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

      var da = mv('da'), pen = mv('penetration'), conv = mv('conversion');
      if (da > 500) list.push({ t: 'Da = <b>' + fmtNum(da, 0) + '</b> 偏大，反应集中在入口附近；若需深度处理应降低催化活性或提高曲折度。', c: 'var(--amber)' });
      if (pen < 600) list.push({ t: '渗透深度仅 <b>' + fmtNum(pen, 0) + ' μm</b>，浅于 5 mm 试样厚度的 15%，建议延长反应时间或提高温度。', c: 'var(--red)' });
      if (conv < 85) list.push({ t: '平均转化率 <b>' + fmtNum(conv, 1) + '%</b> 偏低，可提高边界浓度或催化活性。', c: 'var(--violet)' });
      if (da <= 500 && pen >= 600 && conv >= 85) list.push({ t: '当前处于「转化率与渗透深度」的较优折中区间，可用于演示反应控制与扩散控制的平衡。', c: 'var(--green)' });
      list.push({ t: '教学建议：将曲折度 τ 由 1.0 增至 3.0，观察 Da 增大、前沿收窄，直观理解扩散限制。', c: 'var(--cyan)' });
    return list;
  }

  /* ------------------------------ 教学引导 ------------------------------ */
  /* 该实验为什么值得做、怎么做、该想清楚什么。主流程只负责套版式。 */
  function guideAim(M) {
    return '通过虚拟仿真研究 <b>' + M.subtitle + '</b> 过程中边界条件（温度、压力、浓度、时间等）对材料反应进程与最终结果的影响，' +
        '掌握「变量控制、过程观测、结果对比」的实验方法，并借助智能寻优确定合理工艺窗口。';
    html += '<div class="guide-tip">术语不熟？点右上角「术语库」（' +
      (window.GLOSSARY ? window.GLOSSARY.count : '') +
      ' 条，支持中英文与符号搜索），' +
      '或点左侧参数名后的小问号，直接跳到该参数对应的词条。</div>';
    html += '<div class="guide-sec"><h3>一、实验目的</h3><p>' + aim + '</p></div>'
  }

  function guideSteps() {
    var html = '';
      html += '<div class="guide-sec"><h3>四、操作步骤</h3><ul>' +
        '<li>在左侧选择材料体系，调节温度、压力、浓度等实验条件（结果会实时预览）。</li>' +
        '<li>点击「运行仿真」，实验记录自动写入「数据与报告」。</li>' +
        '<li>在实验台拖动时间轴或点击播放，观察组织/场分布的演化过程。</li>' +
        '<li>改变单一条件并重复运行，在「多组对比分析」中比较过程曲线与关键指标。</li>' +
        '<li>使用右侧「工艺智能寻优」获得推荐参数，再回到实验台验证。</li>' +
        '<li>想看清过程而不只是结论：打开实验台下方的<b>实时演算</b>，把时间换算滑杆拖到 10~20 min，点 ▶ 让曲线与组织随时间长出来；暂停后可改变换算继续。</li>' +
        '</ul></div>';
      html += '<div class="guide-sec"><h3>五、思考题</h3><ul>' +
        '<li>为什么主指标随时间呈 S 形（或饱和）变化？其特征时间由哪些参数决定？</li>' +
        '<li>温度与时间对结果的影响能否互相替代？从微观机制角度说明理由。</li>' +
        '<li>若同时要求高转化率与细晶组织，应如何设计工艺窗口？</li>' +
        '</ul></div>';
    return html;
  }

  /* 实验报告里「一、实验目的」的写法：同一套判断，但更书面 */
  function reportAim(M) {
    return '研究' + M.subtitle + '过程中边界条件对反应进程与结果的影响规律，通过多组对照实验确定较优工艺窗口。';
    html += '<div class="report-sec"><h3>一、实验目的</h3><p>' + aimTxt + '</p></div>'
  }

  C.registerUI({
    id: 'rd',
    presets: PRESETS,
    viz: { title: '二维浓度场演化', sub: '有限差分求解 ∂C/∂t = D∇²C − kC²/C_ref', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim
  });
})(typeof window !== 'undefined' ? window : globalThis);
