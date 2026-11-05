/* =========================================================================
 *  界面配置 · 化学气相沉积
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
  var PRESETS = [
        { name: '高速沉积', p: { T: 1020, P: 30, C: 3.2, Q: 420, t: 40 } },
        { name: '高均匀性', p: { T: 880, P: 10, C: 1.8, Q: 320, t: 50 } },
        { name: '低温工艺', p: { T: 620, P: 6, C: 2.4, Q: 260, t: 90 } },
        { name: '低压薄层', p: { T: 950, P: 3, C: 1.2, Q: 300, t: 15 } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    var fmtNum = ctx.fmtNum;
      var f = ctx.field;
      var rng = f ? ('<span class="lg-item">' + fmtNum(f.tMin, 0) + ' → ' + fmtNum(f.tMax, 0) + ' nm</span>') : '<span class="lg-item">薄 → 厚</span>';
      return '<span class="lg-item"><span class="grad"></span></span>' + rng;
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, v = ctx.v, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum, signed = ctx.signed;
    var paramDef = ctx.paramDef, est = ctx.est;
    var out = [];

      var rk = extra.rKin, rm = extra.rMt;
      var ctrl = rk < rm ? '表面反应控制' : '质量输运控制';
      out.push({ text: '在 <b>' + p.T + ' ℃ / ' + p.P + ' Torr / 前驱体 ' + p.C + '%</b> 条件下，沉积速率 <b>' +
        fmtNum(mv('rate'), 1) + ' nm/min</b>，沉积 ' + p.t + ' min 获得薄膜厚度 <b>' +
        fmtNum(mv('thickness'), 0) + ' nm</b>。' });
      out.push({ text: '当前处于 <b>' + ctrl + '</b> 区间（R_kin = ' + fmtNum(rk, 1) + ' vs R_mt = ' + fmtNum(rm, 0) +
        ' nm/min）。' + (ctrl === '表面反应控制'
          ? '升温可显著提高速率，属 Arrhenius 区。'
          : '速率对温度已不敏感，需通过提高压力或前驱体浓度来突破输运瓶颈。') });
      out.push({ text: '膜厚均匀性 <b>' + fmtNum(mv('uniformity'), 1) + '%</b>，表面粗糙度 Ra <b>' +
        fmtNum(mv('rough'), 2) + ' nm</b>，残余应力 <b>' + fmtNum(mv('stress'), 0) + ' MPa</b>（' +
        (mv('stress') < 0 ? '压应力' : '拉应力') + '）。', warn: mv('uniformity') < 92 });
      var alt = est({ Q: Math.min(paramDef('Q').max, p.Q + 180) });
      out.push({ text: '载气流量由 ' + p.Q + ' 提升至 ' + Math.min(paramDef('Q').max, p.Q + 180) +
        ' sccm，均匀性由 ' + fmtNum(mv('uniformity'), 1) + '% 变为 <b>' + fmtNum(alt.uniformity, 1) +
        '%</b>，速率变为 ' + fmtNum(alt.rate, 1) + ' nm/min，流量通过边界层厚度同时影响速率与均匀性。' });
    return out;
  }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

      var u = mv('uniformity'), rr = mv('rough'), ra = mv('rate');
      if (u < 95) list.push({ t: '均匀性 <b>' + fmtNum(u, 1) + '%</b> 未达量产门槛，建议将腔体压力调整至 8~12 Torr、载气流量提升至 300~450 sccm。', c: 'var(--amber)' });
      if (rr > 3) list.push({ t: '粗糙度 Ra = <b>' + fmtNum(rr, 2) + ' nm</b> 偏高，表面呈岛状生长特征，可提高衬底温度改善原子迁移。', c: 'var(--red)' });
      if (extra.rKin >= extra.rMt * 0.7) list.push({ t: '已接近质量输运控制区，继续升温收益有限，应优化气流场设计。', c: 'var(--violet)' });
      if (ra < 20) list.push({ t: '沉积速率偏低（<b>' + fmtNum(ra, 1) + ' nm/min</b>），若追求产能可提高前驱体浓度至 3% 以上。', c: 'var(--amber)' });
      list.push({ t: '教学建议：对比 700/900/1050 ℃ 三组实验，可清晰观察到由反应控制向输运控制转变的速率平台。', c: 'var(--cyan)' });
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
    id: 'cvd',
    presets: PRESETS,
    viz: { title: '晶圆表面膜厚分布', sub: '径向 + 方位角调制 · 颜色表示局部膜厚', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim
  });
})(typeof window !== 'undefined' ? window : globalThis);
