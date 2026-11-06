/* =========================================================================
 *  界面配置 · Fe-C 热处理
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
      // 奥氏体化温度必须按当前碳含量现算：换牌号后 Ac3 会变，
      // 构建时算死会让 45 号钢仍按纯铁的 Ac3 加热。
      function tAust(cur) {
        var a = 912 - 203 * Math.sqrt(Math.max(cur.C, 0.01));
        return Math.round(Math.min(1000, Math.max(760, a + 40)) / 5) * 5;
      }
  var PRESETS = [
        { name: '退火（炉冷）', p: function (cur) { return { Tset: tAust(cur), ramp: 3, hold: 120, cool: 0.05, atm: 1 }; } },
        { name: '正火（空冷）', p: function (cur) { return { Tset: tAust(cur), ramp: 8, hold: 60, cool: 2, atm: 2 }; } },
        { name: '淬火（水冷）', p: function (cur) { return { Tset: tAust(cur), ramp: 10, hold: 30, cool: 120, atm: 2 }; } },
        { name: '回火（软化）', p: function (cur) { return { Tset: 600, ramp: 5, hold: 90, cool: 1, atm: 1 }; } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    var fmtNum = ctx.fmtNum;
      return '<span class="lg-item"><span class="sw" style="background:rgb(92,108,128)"></span>铁素体</span>' +
        '<span class="lg-item"><span class="sw" style="background:rgb(70,84,104)"></span>珠光体类</span>' +
        '<span class="lg-item"><span class="sw" style="background:rgb(38,44,66)"></span>马氏体</span>';
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, v = ctx.v, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum, signed = ctx.signed;
    var paramDef = ctx.paramDef, est = ctx.est;
    var out = [];

      var hx = extra || {};
      var fr = hx.frac || {};
      if (!hx.isTemper) {
        out.push({ text: '按 ' + p.C.toFixed(2) + ' wt% C 计算，Ac3 = ' + fmtNum(hx.Ac3, 0) +
          ' ℃、Ms = ' + fmtNum(hx.Ms, 0) + ' ℃。加热到 ' + p.Tset + ' ℃ 保温 ' + fmtNum(p.hold, 0) +
          ' min，奥氏体化程度约 <b>' + fmtNum((hx.austF || 0) * 100, 0) + '%</b>，奥氏体晶粒长到 <b>' +
          fmtNum(mv('grain'), 0) + ' μm</b>。' });
        var parts = [];
        if ((fr.fPro || 0) > 0.01) parts.push('铁素体 ' + fmtNum(fr.fPro * 100, 0) + '%');
        if ((fr.fP || 0) > 0.01) parts.push('珠光体 ' + fmtNum(fr.fP * 100, 0) + '%');
        if ((fr.fS || 0) > 0.01) parts.push('索氏体 ' + fmtNum(fr.fS * 100, 0) + '%');
        if ((fr.fT || 0) > 0.01) parts.push('托氏体 ' + fmtNum(fr.fT * 100, 0) + '%');
        if ((fr.fB || 0) > 0.01) parts.push('贝氏体 ' + fmtNum(fr.fB * 100, 0) + '%');
        if ((fr.fM || 0) > 0.01) parts.push('马氏体 ' + fmtNum(fr.fM * 100, 0) + '%');
        if ((fr.fCem || 0) > 0.01) parts.push('渗碳体 ' + fmtNum(fr.fCem * 100, 0) + '%');
        out.push({ text: '以 ' + fmtNum(p.cool, 2) + ' ℃/s 冷却，该成分的临界冷速约 ' + fmtNum(hx.vk, 0) +
          ' ℃/s，过冷奥氏体分解为：' + parts.join('、') + '。硬度 <b>' + fmtNum(mv('HV'), 0) + ' HV</b>。',
          warn: (fr.fM || 0) > 0.5 });
      } else {
        out.push({ text: '加热温度 ' + p.Tset + ' ℃ 低于 Ac1（727 ℃），处在回火区间。淬火马氏体随回火软化，硬度降到 <b>' +
          fmtNum(mv('HV'), 0) + ' HV</b>，残余应力消除约 ' + fmtNum((hx.soften || 0) * 100, 0) + '%。' });
      }
      out.push({ text: '矫顽力 Hc = <b>' + fmtNum(mv('Hc'), 0) + ' A/m</b>，最大磁导率 <b>' +
        fmtNum(mv('mu'), 0) + '</b>。渗碳体与马氏体位错是磁畴的强钉扎点，晶界数量则随晶粒粗化而减少。',
        warn: mv('Hc') > 1000 });
      out.push({ text: '脱碳层 <b>' + fmtNum(mv('decarb'), 2) + ' mm</b>（' +
        ['真空', '保护气氛', '开放通风'][Math.round(p.atm)] + '）。氧势越高、温度越高、保温越久，脱碳越深。表层碳被烧掉后局部接近纯铁，反而使矫顽力下降。',
        warn: mv('decarb') > 0.5 });
    return out;
  }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

      var hHc = mv('Hc'), hMu = mv('mu'), hHV = mv('HV');
      var hDec = mv('decarb'), hGrain = mv('grain'), hFM = mv('fM');
      var hEx = extra || {};
      if (hEx.isTemper) {
        list.push({ t: '加热温度 ' + p.Tset + ' ℃ 低于 Ac1（727 ℃），处在<b>回火</b>区间。组织从淬火马氏体软化，硬度降到 ' +
          fmtNum(hHV, 0) + ' HV，残余应力消除约 ' + fmtNum((hEx.soften || 0) * 100, 0) + '%。', c: 'var(--violet)' });
        list.push({ t: '回火温度决定软化程度：150~250 ℃ 低温回火保留高硬度，500~650 ℃ 高温回火得到回火索氏体，是调质处理的核心。', c: 'var(--cyan)' });
      } else {
        if ((hEx.austF == null ? 1 : hEx.austF) < 0.95) {
          list.push({ t: '奥氏体化只有约 ' + fmtNum((hEx.austF || 0) * 100, 0) + '%，因为加热温度低于 Ac3 = ' +
            fmtNum(hEx.Ac3, 0) + ' ℃。未溶的原始组织会留在最终组织里，建议升温或延长保温。', c: 'var(--amber)' });
        }
        if (hFM > 50) {
          list.push({ t: '马氏体占 <b>' + fmtNum(hFM, 0) + '%</b>，矫顽力被推到 ' + fmtNum(hHc, 0) +
            ' A/m。马氏体的高密度位错是强钉扎点，<b>这类组织不适合做磁钢</b>，需要退火或高温回火。', c: 'var(--red)' });
        }
        if (hDec > 0.5) {
          list.push({ t: '脱碳层 <b>' + fmtNum(hDec, 2) + ' mm</b> 偏厚，来自高氧势或过长的保温。改用真空或保护气氛可压到 0.1 mm 以内；轻度脱碳对软磁反而有利，但会牺牲表面硬度。', c: 'var(--amber)' });
        }
        if (hGrain < 30) {
          list.push({ t: '晶粒仅 <b>' + fmtNum(hGrain, 0) + ' μm</b>，晶界密度高，对磁畴钉扎明显。适当提高加热温度或延长保温可粗化晶粒、降低矫顽力。', c: 'var(--violet)' });
        }
        if (hHc <= 200 && hDec <= 0.3 && hGrain >= 40) {
          list.push({ t: '矫顽力 ' + fmtNum(hHc, 0) + ' A/m、磁导率 ' + fmtNum(hMu, 0) +
            '，已达到<b>软磁材料的可用水平</b>，可作为电磁纯铁类零件的退火参照工况。', c: 'var(--green)' });
        }
        list.push({ t: '教学建议：加热与保温固定不变，只把冷却速率从 0.05 拉到 120 ℃/s，观察组织从珠光体经索氏体、托氏体、贝氏体一路转到马氏体，矫顽力同步抬升两个数量级。', c: 'var(--cyan)' });
      }
    return list;
  }

  /* ------------------------------ 教学引导 ------------------------------ */
  /* 该实验为什么值得做、怎么做、该想清楚什么。主流程只负责套版式。 */
  function guideAim(M) {
    return '同一炉 Fe-C 合金、同一条加热曲线，只改变<b>冷却速度</b>或<b>炉内气氛</b>，工件为什么一个软一个硬、一个能当磁钢一个不能？<br>' +
        '热处理可以拆成升温、保温、冷却三段：<b>保温</b>决定奥氏体晶粒长到多大，<b>冷却</b>决定过冷奥氏体往哪儿转，<b>气氛</b>决定表面氧化脱碳多深。<br>' +
        '要建立的判断是：<b>成分给出平衡组织，工艺改变实际组织，组织决定磁性能。</b>'
  }

  function guideSteps() {
    var html = '';
      html += '<div class="guide-sec"><h3>四、操作步骤</h3><ul>' +
        '<li>选牌号。碳含量随时可在左侧微调，它决定了 Ac3 位置和平衡组织里珠光体的比例。</li>' +
        '<li>设定加热温度：高于 Ac3 才能完全奥氏体化；低于 Ac1（727 ℃）则进入<b>回火</b>区间。</li>' +
        '<li>调保温时间：晶粒按幂律长大，时间翻倍晶粒不会翻倍，但对矫顽力的影响是持续的。</li>' +
        '<li>拖<b>冷却速率</b>滑块（对数刻度，0.02~200 ℃/s）：炉冷 0.05、空冷 2、风冷 15、油冷 40、水冷 120。</li>' +
        '<li>切<b>炉内气氛</b>：真空、保护气氛、开放通风，看组织图顶部那条脱碳层怎么变厚变薄。</li>' +
        '<li>点下方四个工艺预设（退火 / 正火 / 淬火 / 回火），同一牌号一键对比四种组织的差别。</li>' +
        '<li>看右下角晶胞：加热时是面心立方（奥氏体），冷却后变体心立方（铁素体）或体心正方（马氏体）。</li>' +
        '<li>打开<b>实时演算</b>，把时间换算拖到几十秒：能看见晶粒一点点长大、冷却时组织一格格转过去。</li>' +
        '</ul></div>';
      html += '<div class="guide-sec"><h3>五、思考题</h3><ul>' +
        '<li>同样 45 钢，退火与淬火的矫顽力相差近十倍，差别来自组织里的哪一部分？</li>' +
        '<li>冷却速度越过临界冷速时组织发生了什么突变？为什么这个突变对磁性是灾难性的？</li>' +
        '<li>脱碳会降低矫顽力，看起来对软磁有利，这种「改善」的代价是什么？</li>' +
        '<li>为什么电磁纯铁要做长时间退火，而不用正火或淬火？</li>' +
        '<li>若要求工件表面既不能脱碳、晶粒又要足够粗，工艺窗口应该怎么定？</li>' +
        '</ul></div>';
      html += '<div class="guide-sec"><h3>六、相关模块</h3><p>同一炉钢换个视角：表面与心部硬度、淬硬层深度、CCT 冷却曲线的力学性能分析，' +
        '见「<b>碳钢热处理</b>」模块；那里用一维径向传热模拟工件截面的淬透过程。</p></div>';
    return html;
  }

  /* 实验报告里「一、实验目的」的写法：同一套判断，但更书面 */
  function reportAim(M) {
    return '研究 Fe-C 合金热处理过程中，加热温度、保温时间、冷却速度与炉内气氛对过冷奥氏体转变产物的影响：' +
        '同一成分、同一加热制度下仅改变冷却速度，考察珠光体、索氏体、托氏体、贝氏体与马氏体的相对含量变化，' +
        '并据此分析组织对硬度、矫顽力与磁导率的影响，确定面向软磁应用的合理工艺窗口。'
  }

  /* ---------------------------- KPI 口径声明 ---------------------------- */
  /* 这个实验里晶粒粗化是好事：晶界是磁畴的钉扎点，晶粒越粗矫顽力越低。
     陶瓷烧结那套「粗化即缺陷」的判断搬过来会把结论说反。 */
  function grainHint(val) {
    return val >= 80 ? '粗晶，晶界钉扎弱' : (val >= 30 ? '中等晶粒' : '细晶，晶界钉扎强');
  }

  C.registerUI({
    id: 'heat',
    presets: PRESETS,
    viz: { title: '组织演化 · 温度曲线 · 晶胞', sub: '冷速决定过冷奥氏体去向 · 右侧为当前主导相的晶体结构', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim,
    grainHint: grainHint,
    seriesDefault: 'all'
  });
})(typeof window !== 'undefined' ? window : globalThis);
