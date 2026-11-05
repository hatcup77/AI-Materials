/* =========================================================================
 *  界面配置 · 固相反应合成
 *  该实验专属的预设工艺、可视化标题与图例、洞察分析与诊断建议。
 *  全部通过 ctx 读取运行结果，不直接访问界面状态，主流程按 id 取用。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  /* ------------------------------ 工艺预设 ------------------------------ */
  var PRESETS = [
        { name: '低温长时', p: { T: 900, P: 8, C: 1.05, d0: 0.6, t: 260 } },
        { name: '高温快烧', p: { T: 1220, P: 4, C: 1.0, d0: 1.2, t: 60 } },
        { name: '高压致密', p: { T: 1080, P: 18, C: 1.1, d0: 0.5, t: 150 } },
        { name: '细晶工艺', p: { T: 1000, P: 12, C: 1.15, d0: 0.3, t: 180 } }
  ];

  /* --------------------------- 可视化标题与图例 --------------------------- */
  function legend(ctx) {
    var fmtNum = ctx.fmtNum;
      var v = ctx.v;
      var lt = ctx.theme === 'light';
      return '<span class="lg-item"><span class="sw" style="background:hsl(' + v.hue + ',16%,' + (lt ? 80 : 18) + '%)"></span>未反应前驱体</span>' +
        '<span class="lg-item"><span class="sw" style="background:hsl(' + v.hue + ',60%,' + (lt ? 57 : 47) + '%)"></span>生成相</span>';
  }

  /* ------------------------------ 洞察分析 ------------------------------ */
  function insights(ctx) {
    var p = ctx.p, v = ctx.v, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum, signed = ctx.signed;
    var paramDef = ctx.paramDef, est = ctx.est;
    var out = [];

      var dT = 100;
      var hiT = Math.min(paramDef('T').max, p.T + dT);
      var loT = Math.max(paramDef('T').min, p.T - dT);
      var hi = est({ T: hiT });
      var lo = est({ T: loT });
      var conv0 = mv('conversion');
      out.push({ text: '在 <b>' + p.T + ' ℃ / ' + p.P + ' MPa / 保温 ' + p.t + ' min</b> 条件下，' + v.name.split(' ')[0] +
        ' 转化率达 <b>' + fmtNum(conv0, 1) + '%</b>，相对致密度 <b>' + fmtNum(mv('density'), 1) +
        '%</b>，平均晶粒尺寸 <b>' + fmtNum(mv('grain'), 1) + ' μm</b>。' });
      if (Math.abs(hi.conversion - conv0) < 0.05 && Math.abs(lo.conversion - conv0) < 0.05) {
        out.push({ text: '温度在 <b>' + loT + '~' + hiT + ' ℃</b> 内对转化率已无显著影响（均接近 <b>' + fmtNum(conv0, 1) +
          '%</b>），说明反应已基本完全，工艺矛盾从「能否反应」转移到「<b>晶粒是否粗化</b>」。', warn: mv('grain') > 20 });
      } else {
        out.push({ text: '温度的边际效应最强：升温至 <b>' + hiT + ' ℃</b> 转化率变为 <b>' +
          fmtNum(hi.conversion, 1) + '%</b>（' + signed(hi.conversion - conv0) + '），降温至 ' + loT +
          ' ℃ 则变为 <b>' + fmtNum(lo.conversion, 1) + '%</b>。Arrhenius 活化能 Eₐ = ' + v.Ea + ' kJ/mol 主导该敏感性。' });
      }
      var dG = hi.grain - mv('grain');
      out.push({
        text: '晶粒长大受 Q_g = ' + v.Qg + ' kJ/mol 控制：温度由 ' + p.T + ' ℃ 升至 ' + hiT + ' ℃ 会使晶粒由 ' +
          fmtNum(mv('grain'), 1) + ' μm 增至 <b>' + fmtNum(hi.grain, 1) + ' μm</b>（' + signed(dG) +
          '），这是「高温快烧」与「细晶高致密」之间的核心矛盾。', warn: dG > 8
      });
      var t90 = mv('t90');
      out.push({
        text: t90 > p.t
          ? '达到 90% 转化理论需 <b>' + fmtNum(t90, 0) + ' min</b>，已超出当前保温时间，建议延长保温或提高温度。'
          : '达到 90% 转化约需 <b>' + fmtNum(t90, 0) + ' min</b>，当前保温时间留有 ' +
            fmtNum((p.t - t90) / p.t * 100, 0) + '% 余量，可适度缩短工艺周期以抑制晶粒粗化。',
        warn: t90 > p.t
      });
    return out;
  }

  /* ------------------------------ 诊断建议 ------------------------------ */
  function advice(ctx) {
    var p = ctx.p, extra = ctx.extra;
    var mv = ctx.mv, fmtNum = ctx.fmtNum;
    var list = [];

      var g = mv('grain'), d = mv('density'), c = mv('conversion');
      if (c < 90) list.push({ t: '转化率仅 <b>' + fmtNum(c, 1) + '%</b>，建议提高烧结温度或延长保温时间，优先升温（对 k 的影响更直接）。', c: 'var(--amber)' });
      if (g > 20) list.push({ t: '晶粒已达 <b>' + fmtNum(g, 1) + ' μm</b>，存在粗化风险；可降低温度并延长保温，或增大初始粒径均匀性。', c: 'var(--red)' });
      if (d < 95) list.push({ t: '相对致密度 <b>' + fmtNum(d, 1) + '%</b> 偏低，建议提高成型压力以增大颗粒接触面积。', c: 'var(--violet)' });
      if (c >= 90 && g <= 20 && d >= 95) list.push({ t: '当前工艺已同时满足高转化、细晶、高致密，<b>可直接作为教学示范工况</b>。', c: 'var(--green)' });
      list.push({ t: '教学建议：固定其余参数，仅扫描温度 900→1200 ℃，观察 t90 的指数式缩短与晶粒的同步粗化。', c: 'var(--cyan)' });
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
    id: 'solid',
    presets: PRESETS,
    viz: { title: '微观组织演化', sub: 'JMAK 成核-长大过程 · 圆形区域为已转变产物相', legend: legend },
    insights: insights,
    advice: advice,
    guide: { aim: guideAim, steps: guideSteps },
    reportAim: reportAim
  });
})(typeof window !== 'undefined' ? window : globalThis);
