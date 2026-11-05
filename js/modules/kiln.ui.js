/* =========================================================================
 *  界面配置 · 马弗炉烧成
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
  var PRESETS = [
        { name: '居中装炉', p: { Tset: 1050, ramp: 5, hold: 120, sx: 50, sy: 45 } },
        { name: '贴近加热壁', p: { Tset: 1050, ramp: 5, hold: 120, sx: 8, sy: 55 } },
        { name: '靠近炉门', p: { Tset: 1050, ramp: 5, hold: 120, sx: 92, sy: 45 } },
        { name: '快速升温', p: { Tset: 1050, ramp: 14, hold: 120, sx: 50, sy: 45 } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    var fmtNum = ctx.fmtNum;
      return '<span class="lg-item"><span class="sw" style="background:rgb(248,164,60)"></span>高温区</span>' +
        '<span class="lg-item"><span class="sw" style="background:rgb(112,32,15)"></span>低温区</span>';
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, v = ctx.v, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum, signed = ctx.signed;
    var paramDef = ctx.paramDef, est = ctx.est;
    var out = [];

      var wallR = est({ sx: 6 });
      var doorR = est({ sx: 94 });
      var kGap0 = mv('gap');
      var uni = extra.uniform;
      var tau = extra.tau;
      out.push({ text: '设定 <b>' + p.Tset + ' ℃</b>，热电偶读到设定值时，样品峰值温度只有 <b>' +
        fmtNum(mv('tPart'), 0) + ' ℃</b>，缺口 <b>' + fmtNum(kGap0, 0) + ' K</b>。' +
        '这个缺口由两件事叠加：炉膛边界场（同一条曲线，不同位置拿到的温度不同）与装炉件的热惯性。' });
      out.push({ text: '完全相同的曲线：贴左加热壁（sx=6%）转化率 <b>' + fmtNum(wallR.conversion, 1) +
        '%</b>，当前位置 <b>' + fmtNum(mv('conversion'), 1) + '%</b>，移到炉门侧（sx=94%）仅 <b>' +
        fmtNum(doorR.conversion, 1) + '%</b>。装炉位置不是「摆放习惯」，它直接改写了样品的温度历程。',
        warn: mv('conversion') - doorR.conversion > 15 });
      out.push({ text: '炉膛装料区温差极差 <b>' + fmtNum(uni, 0) + ' K</b>（约 ±' + fmtNum(uni / 2, 0) +
        ' K）：靠近加热元件的区域超前升温，靠门的区域始终欠温。这就是「不均匀」：它不会因为延长保温而消失，只会被摊平一部分。' });
      out.push({ text: '升温 ' + p.ramp + ' ℃/min 配合热时间常数 τ = ' + fmtNum(tau, 1) + ' min，样品约滞后 <b>' +
        fmtNum(p.ramp * tau, 0) + ' K</b>；设定保温 ' + p.hold + ' min，样品真正有效的只有 <b>' +
        fmtNum(mv('holdEff'), 0) + ' min</b>。',
        warn: mv('holdEff') < p.hold * 0.75 });
    return out;
  }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

      var kGap = mv('gap'), kConv = mv('conversion'), kHold = mv('holdEff');
      if (p.sx > 75) list.push({ t: '样品靠炉门（sx = <b>' + p.sx + '%</b>），门缝漏热使该处边界温度比加热壁低约 <b>' +
        fmtNum((p.Tset - 25) * 0.09, 0) + ' K</b>，建议移回 25~60% 的有效装料区。', c: 'var(--amber)' });
      if (kGap > 50) list.push({ t: '温度缺口 <b>' + fmtNum(kGap, 0) + ' K</b>：先把升温速率从 ' + p.ramp +
        ' 降到 ' + Math.max(1, Math.round(p.ramp * 0.5)) + ' ℃/min，再考虑提设定温度，否则只是把「表温」拉高，样品仍跟不上。', c: 'var(--red)' });
      if (kHold < p.hold * 0.7 && kHold > 0) list.push({ t: '有效保温只有 <b>' + fmtNum(kHold, 0) + ' min</b>（设定 ' + p.hold +
        ' min），升温段被预支掉了；延长保温比提高温度更不伤晶粒。', c: 'var(--violet)' });
      if (kConv < 85) list.push({ t: '转化率 <b>' + fmtNum(kConv, 1) + '%</b> 未达标：优先把样品朝加热壁方向移动（当前 sx = ' + p.sx +
        '%），再考虑提高设定温度，位置带来的温差比调表更省时间，也不额外伤晶粒。', c: 'var(--amber)' });
      if (kConv >= 90 && kGap <= 30) list.push({ t: '该位置温度缺口小、转化充分，可作为<b>批次中心位置的参照工况</b>。', c: 'var(--green)' });
      list.push({ t: '教学建议：固定设定温度与保温时间，只把样品从左壁拖到炉门，观察转化率与致密度如何单调下降，这就是「边界」与「不均匀」。', c: 'var(--cyan)' });
    return list;
  }

  /* ------------------------------ 教学引导 ------------------------------ */
  /* 该实验为什么值得做、怎么做、该想清楚什么。主流程只负责套版式。 */
  function guideAim(M) {
    return '同一台马弗炉、同一条温控曲线，只改变<b>装炉位置</b>或<b>升温速率</b>，样品结果为什么不一样？<br>' +
        '本实验求解炉膛稳态热场（∇²T = 0，四边给定不同边界值）与装炉件的一阶热响应，把工程上绕不开、' +
        '理论课却很少展开的两个概念摆到台面上：<b>边界</b>：炉壁、炉顶、炉底、炉门的换热条件并不相同；' +
        '<b>不均匀</b>：即使炉子「到了设定温度」，装料区依然存在几十 K 的温差。<br>' +
        '要建立的判断是：<b>设定温度只是边界条件，样品温度才是决定反应的那一个。</b>'
  }

  function guideSteps() {
    var html = '';
      html += '<div class="guide-sec"><h3>四、操作步骤</h3><ul>' +
        '<li>选材料体系：坩埚装粉、匣钵装载的热时间常数不同，滞后量也不同。</li>' +
        '<li>设定温度 / 升温速率 / 保温时间，这三项就是操作者在温控表上能拧的全部旋钮。</li>' +
        '<li>第四、五项是「放置零件」：用滑块，或者<b>直接在炉膛剖面里拖动样品</b>。</li>' +
        '<li>点播放或拖时间轴，看加热丝由暗变亮、样品颜色滞后变红，以及样品标签温度始终追不上「设定值」。</li>' +
        '<li>看底部剖面曲线：同一条装料高度上，左壁到炉门有几十 K 的落差，青色圆点就是你的样品。</li>' +
        '<li>把样品从左壁拖到炉门再跑一次，在「多组对比分析」里比较两条温度曲线下的转化率差别。</li>' +
        '<li>打开<b>实时演算</b>，把时间换算滑杆拖到 40 min 左右：能看到样品温度一路追着设定值、温度缺口先拉大再收窄，而不是直接看到终值。</li>' +
        '</ul></div>';
      html += '<div class="guide-sec"><h3>五、思考题</h3><ul>' +
        '<li>设定 1050 ℃、保温 120 min，为什么样品峰值可能连 1000 ℃ 都不到？这个缺口由哪两部分叠加而成？</li>' +
        '<li>把样品从加热壁移到炉门，转化率下降的原因里，哪些属于「边界」，哪些属于「不均匀」？延长保温能让两者都消失吗？</li>' +
        '<li>升温速率翻倍时，样品峰值温度几乎不变，而转化率明显下降，请用样品温度曲线下的「有效面积」解释。</li>' +
        '<li>若要求同一炉内 5 个坩埚的转化率偏差 &lt; 3%，你会如何布置装料位置、如何修改温控曲线？</li>' +
        '</ul></div>';
    return html;
  }

  /* 实验报告里「一、实验目的」的写法：同一套判断，但更书面 */
  function reportAim(M) {
    return '研究箱式马弗炉在给定温控曲线下，装炉位置与炉膛热场不均匀性对样品实际温度历程及反应结果的影响：' +
        '同一设定温度、同一保温时间，仅改变样品在炉内的位置，考察转化率、致密度与晶粒尺寸的差异，' +
        '据此理解工程上「边界」与「不均匀」两个概念，并确定有效装料区。'
  }

  /* --------------------------- 对比图坐标轴声明 --------------------------- */
  /* 这个实验的各组差异体现在装炉位置而不是温度，图例要标位置才有意义。 */
  var COMPARE_AXIS = {
    tag: function (p) { return p.sx + '%'; },
    note: ' · 标注为水平装炉位置',
    short: function (r) { return r.params.sx + '%'; }
  };

  C.registerUI({
    id: 'kiln',
    presets: PRESETS,
    viz: { title: '炉膛剖面 · 装炉位置', sub: '∇²T = 0 稳态热场 · 拖动样品改变位置', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim,
    seriesDefault: 'all',
    compareAxis: COMPARE_AXIS
  });
})(typeof window !== 'undefined' ? window : globalThis);
