/* =========================================================================
 *  实验模块 · 固相反应合成
 *  JMAK 转变动力学 + 晶粒长大 + 致密化
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight, arr = C.arr, mulberry32 = C.mulberry32;
  /* =====================================================================
   *  模块一：固相反应合成（陶瓷粉体高温固相法）
   * ===================================================================== */
  var SOLID = {
    id: 'solid',
    name: '固相反应合成',
    tag: 'Solid-State Reaction',
    subtitle: '高温固相法合成功能陶瓷粉体',
    primaryKey: 'conversion',
    paramDefs: [
      { key: 'T', label: '烧结温度', unit: '℃', min: 600, max: 1300, step: 5, def: 1050,
        hint: 'Arrhenius 活化控制的核心边界条件，温度每升高 100 ℃ 反应速率约提升 3~5 倍' },
      { key: 'P', label: '成型压力', unit: 'MPa', min: 0.5, max: 20, step: 0.5, def: 5,
        hint: '提高颗粒接触面积，k ∝ P^0.30，同时改善坯体致密度' },
      { key: 'C', label: '前驱体配比', unit: '×化学计量', min: 0.6, max: 1.6, step: 0.02, def: 1.0,
        hint: '反应物浓度/过量系数，影响碰撞概率与产物化学计量比' },
      { key: 'd0', label: '初始粒径', unit: 'μm', min: 0.2, max: 5, step: 0.1, def: 1.0,
        hint: '粒径越小比表面积越大，固相反应速率越高，但易团聚' },
      { key: 't', label: '保温时间', unit: 'min', min: 20, max: 300, step: 5, def: 120,
        hint: '仿真总时长，反映转变程度与晶粒粗化程度' }
    ],
    /* Ea 为相形成表观活化能（文献量级 115~235 kJ/mol：BaTiO₃ 实测 134、LiMn₂O₄ 118、
       LiFePO₄ 碳热还原 184、8YSZ 结晶 232 kJ/mol）；
       n 为 Avrami 指数，取值对应「扩散控制 + 递减成核」（1.5~2.5）或「界面/液相控制 + 持续成核」（3~4）；
       Qg 为晶粒长大活化能，氧化物陶瓷实测多在 150~450 kJ/mol；
       kT、Kg0 分别是该材料在其默认工艺温度（defT）下的速率常数与晶粒长大速率常数。 */
    variants: [
      { id: 'BT', name: 'BaTiO₃ 钛酸钡', kT: 1.22973e-2, Ea: 135, n: 2.20, Kg0: 3.7610e14, Qg: 380,
        hue: 190, defT: 1050, formula: 'BaCO₃ + TiO₂ → BaTiO₃ + CO₂↑',
        note: '典型电子陶瓷介电材料，工业固相合成窗口 1000~1200 ℃；相形成活化能实测约 134 kJ/mol' },
      { id: 'ZnO', name: 'ZnO 压敏陶瓷', kT: 1.11777e-2, Ea: 150, n: 2.90, Kg0: 6.9794e8, Qg: 220,
        hue: 45, defT: 950, formula: 'ZnO + Bi₂O₃ + Sb₂O₃ → 压敏陶瓷',
        note: '烧结温度较低，液相烧结使界面反应占主导；Bi₂O₃ 在 1100 ℃ 以上挥发，需控温' },
      { id: 'NCM', name: 'LiNi₀.₈Co₀.₁Mn₀.₁O₂', kT: 1.26405e-2, Ea: 120, n: 2.40, Kg0: 1.9500e14, Qg: 300,
        hue: 155, defT: 800, formula: 'Ni₀.₈Co₀.₁Mn₀.₁(OH)₂ + LiOH·H₂O → NCM811',
        note: '锂电三元正极，需富氧气氛；高于 800 ℃ 锂挥发、阳离子混排加剧，晶粒也粗化' },
      { id: 'LATP', name: 'LATP 固态电解质', kT: 1.21509e-2, Ea: 140, n: 2.20, Kg0: 2.4049e15, Qg: 360,
        hue: 265, defT: 900, formula: 'Li₂CO₃ + Al₂O₃ + TiO₂ + NH₄H₂PO₄ → Li₁.₃Al₀.₃Ti₁.₇(PO₄)₃',
        note: 'NASICON 型固态电解质，900 ℃ 煅烧成相、950~1050 ℃ 烧结；温度不足时杂相难以消除' },
      { id: 'LCO', name: 'LiCoO₂ 钴酸锂', kT: 1.24672e-2, Ea: 128, n: 2.30, Kg0: 2.4342e15, Qg: 340,
        hue: 330, defT: 850, formula: 'Li₂CO₃ + Co₃O₄ → LiCoO₂ + CO₂↑',
        note: '层状氧化物正极材料；单相在 850 ℃ 仍稳定，高于 900 ℃ 分解出 Co₃O₄、1000 ℃ 以上生成缺锂固溶体' },
      { id: 'MZF', name: 'MnZn 铁氧体', kT: 1.10042e-2, Ea: 150, n: 3.00, Kg0: 5.1969e8, Qg: 260,
        hue: 15, defT: 1280, formula: 'MnCO₃ + ZnO + Fe₂O₃ → (Mn,Zn)Fe₂O₄',
        note: '软磁铁氧体磁芯，主烧 1260~1380 ℃；气氛决定能否得到单相尖晶石，低氧分压可在更低温成相' },
      { id: 'STO', name: 'SrTiO₃ 钛酸锶', kT: 1.27796e-2, Ea: 140, n: 2.30, Kg0: 7.7233e11, Qg: 350,
        hue: 95, defT: 1100, formula: 'SrCO₃ + TiO₂ → SrTiO₃ + CO₂↑',
        note: '钙钛矿介质陶瓷，粉体 950 ℃ 煅烧、1050~1350 ℃ 烧结；晶粒过粗会劣化介电性能' },
      { id: 'LFP', name: 'LiFePO₄ 磷酸铁锂', kT: 0.0102542162558, Ea: 184.2, n: 4.00, Kg0: 193927883134000, Qg: 300,
        hue: 140, defT: 750, formula: 'FePO₄ + Li₂CO₃ + C → LiFePO₄ + CO₂↑',
        note: '碳热还原法制备，700~800 ℃ 最佳；碳含量约 3% 时电性能最好，过高会团聚、过低则 Fe³⁺ 残留' },
      { id: 'LTO', name: 'Li₄Ti₅O₁₂ 钛酸锂', kT: 0.0136632301925, Ea: 179.0, n: 2.00, Kg0: 109849820956, Qg: 280,
        hue: 275, defT: 900, formula: '2Li₂CO₃ + 5TiO₂ → Li₄Ti₅O₁₂ + 2CO₂↑',
        note: '尖晶石结构负极材料，800~1000 ℃ 空气烧结；零体积应变使循环寿命长，但本征电子电导率低' },
      { id: 'LMO', name: 'LiMn₂O₄ 锰酸锂', kT: 0.0121121942284, Ea: 118.0, n: 2.40, Kg0: 113620889037000, Qg: 300,
        hue: 315, defT: 780, formula: '4MnO₂ + Li₂CO₃ → 2LiMn₂O₄ + CO₂↑ + ½O₂',
        note: '尖晶石正极材料，600~800 ℃ 长时间焙烧；Mn³⁺ 的 Jahn~Teller 效应导致高温循环性能衰减' },
      { id: 'PZT', name: 'Pb(Zr,Ti)O₃ 锆钛酸铅', kT: 0.0112776813679, Ea: 224.9, n: 2.80, Kg0: 104194045821, Qg: 320,
        hue: 35, defT: 1150, formula: 'PbO + ZrO₂ + TiO₂ → Pb(Zr,Ti)O₃',
        note: '压电陶瓷，950~1200 ℃ 烧结；PbO 在 800 ℃ 以上即挥发，需盖坩埚并加过量 PbO 补偿，否则失铅反而欠烧' },
      { id: 'YBCO', name: 'YBa₂Cu₃O₇ 超导氧化物', kT: 0.011673567623, Ea: 114.6, n: 3.00, Kg0: 2134390343310, Qg: 300,
        hue: 185, defT: 900, formula: 'Y₂O₃ + 4BaCO₃ + 6CuO → 2YBa₂Cu₃O₇ + 4CO₂↑',
        note: '高温超导氧化物，880~920 ℃ 煅烧、940~960 ℃ 流动氧烧结；必须 450~500 ℃ 纯氧退火补氧，否则为四方相、不超导' },
      { id: 'YSZ', name: '8YSZ 钇稳定氧化锆', kT: 0.0109258915751, Ea: 231.8, n: 3.00, Kg0: 1741604441.63, Qg: 260,
        hue: 250, defT: 1000, formula: 'ZrO₂ + Y₂O₃ → (ZrO₂)₈(Y₂O₃)',
        note: '固体氧化物燃料电池电解质，700~1000 ℃ 煅烧成相；致密化烧结需 1400~1500 ℃，普通固相法更需 1700 ℃' }
    ],
    seriesDefs: [
      { key: 'conversion', name: '转化率 α', unit: '%', color: '#3ddbe8', axis: 'left', primary: true },
      { key: 'rate', name: '反应速率 dα/dt', unit: '%/min', color: '#ffb347', axis: 'right' },
      { key: 'grain', name: '平均晶粒尺寸', unit: 'μm', color: '#a78bfa', axis: 'right' },
      { key: 'density', name: '相对致密度', unit: '%', color: '#66e3a0', axis: 'right' }
    ],
    outputDefs: [
      { key: 'conversion', label: '转化率', unit: '%', digits: 1, primary: true },
      { key: 'density', label: '相对致密度', unit: '%', digits: 1 },
      { key: 'grain', label: '平均晶粒尺寸', unit: 'μm', digits: 1 },
      { key: 'ratePeak', label: '峰值反应速率', unit: '%/min', digits: 2 },
      { key: 't90', label: '90% 转化耗时', unit: 'min', digits: 0 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'conversion', label: '转化率最大', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' },
      { key: 'density', label: '致密度最高', dir: 'max' },
      { key: 'grain', label: '晶粒尺寸最小', dir: 'min' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'fine', label: '晶粒 ≤ 20 μm', test: function (m) { return m.grain <= 20; } },
      { id: 'dense', label: '致密度 ≥ 95 %', test: function (m) { return m.density >= 95; } },
      { id: 'both', label: '晶粒 ≤ 20 μm 且 致密度 ≥ 95 %', test: function (m) { return m.grain <= 20 && m.density >= 95; } }
    ],
    notes: [
      'JMAK 转变动力学：α(t) = 1 − exp[−(k·t)ⁿ]，n 为 Avrami 指数（成核-长大机制）。',
      '速率常数：k = A·exp(−Eₐ/RT)·(P/P₀)^0.30·C^0.75·d₀^−0.22。',
      '晶粒长大：G = d₀ + K_g·t^0.35，K_g = K₀·exp(−Q_g/RT)，Q_g 取 150~450 kJ/mol 的实测区间，晶粒粗化与温度强相关。',
      '致密化：ρ = f(α, P, G)，转化率与晶粒尺寸存在「高致密与细晶」的工艺竞争关系。'
    ]
  };

  SOLID.simulate = function (p, v, opts) {
    var Tk = p.T + K0;
    // 由参考温度下的速率常数反推指前因子，使不同材料在其工艺窗口内可比
    var A = v.kT / arr(v.defT + K0, v.Ea);
    var k = A * arr(Tk, v.Ea) * Math.pow(p.P / 5, 0.30) * Math.pow(p.C, 0.75) * Math.pow(1 / p.d0, 0.22);
    var n = v.n;
    var Kg = v.Kg0 * arr(Tk, v.Qg);

    var NP = 84;
    var time = [], conv = [], rate = [], grain = [], dens = [];
    var i;
    for (i = 0; i < NP; i++) {
      var t = p.t * i / (NP - 1);
      var x = k * t;
      var xn = Math.pow(x, n);
      var a = 1 - Math.exp(-xn);
      var r = n * Math.pow(k, n) * Math.pow(Math.max(t, 1e-4), n - 1) * Math.exp(-xn);
      var G = p.d0 + Kg * Math.pow(t, 0.35);
      var rho = 0.60 + 0.385 * Math.sqrt(a) + 0.012 * Math.log(1 + p.P / 2) - 0.0007 * G;
      time.push(t); conv.push(a * 100); rate.push(r * 100);
      grain.push(G); dens.push(clamp(rho, 0.50, 0.995) * 100);
    }

    var aF = conv[conv.length - 1] / 100;
    var GF = grain[grain.length - 1];
    var rhoF = dens[dens.length - 1];
    // 峰值速率解析解：dα/dt 极值出现在 (k·t)^n = (n−1)/n
    var ratePeak = n * Math.pow((n - 1) / n, (n - 1) / n) * k * Math.exp(-(n - 1) / n) * 100;
    var t90 = Math.pow(-Math.log(0.1), 1 / n) / k;
    // dα/dt 极值时刻：(k·t)^n = (n−1)/n
    var tPeak = Math.pow((n - 1) / n, 1 / n) / k;

    var score = 100 * (0.45 * aF +
      0.35 * clamp((rhoF / 100 - 0.85) / 0.145, 0, 1) +
      0.20 * (1 - clamp((GF - 2) / 28, 0, 1)));

    var metrics = {
      conversion: aF * 100, density: rhoF, grain: GF,
      ratePeak: ratePeak, t90: t90, score: score
    };

    var field = null;
    if (!(opts && opts.fast)) {
      field = buildMicroField(p, v, k, p.t, aF);
    }

    return {
      time: time,
      series: {
        conversion: conv, rate: rate, grain: grain, density: dens
      },
      metrics: metrics,
      field: field,
      extra: { k: k, Kg: Kg, t90: t90, tPeak: tPeak }
    };
  };

  /* 微观组织场：JMAK 成核-长大 + 圆盘并合渲染 */
  function buildMicroField(p, v, k, tEnd, alphaEnd) {
    var rnd = mulberry32(Math.floor(k * 1e6) + Math.floor(p.T * 7) + Math.floor(tEnd));
    var N = 260;
    var sites = [], i;
    for (i = 0; i < N; i++) {
      var u = rnd();
      var tn = -Math.log(1 - u * 0.985) / (k * 1.12);
      sites.push({
        x: 0.03 + rnd() * 0.94,
        y: 0.03 + rnd() * 0.94,
        tn: tn,
        jit: 0.72 + rnd() * 0.56,
        lum: rnd()
      });
    }
    // 半径标定：使最终覆盖率与 JMAK 转化率一致
    var ext = alphaEnd >= 0.999 ? 9 : -Math.log(1 - alphaEnd);
    var sumKt = 0;
    for (i = 0; i < sites.length; i++) {
      var dt = tEnd - sites[i].tn;
      if (dt > 0) sumKt += k * dt / (sites[i].jit * sites[i].jit);
    }
    var c = sumKt > 1e-6 ? Math.sqrt(ext / (Math.PI * sumKt)) : 0;

    return {
      kind: 'micro',
      hue: v.hue,
      tEnd: tEnd,
      k: k,
      c: c,
      sites: sites,
      legend: { title: '微观组织演化', low: '未反应前驱体', high: '生成相 ' + v.name.split(' ')[0] },
      draw: function (ctx, W, H, prog) {
        var t = tEnd * prog;
        var side = Math.min(W, H) * 1.08;
        ctx.save();
        var lt = themeLight();
        ctx.fillStyle = lt ? 'hsl(' + v.hue + ', 22%, 95%)' : 'hsl(' + v.hue + ', 15%, 7%)';
        ctx.fillRect(0, 0, W, H);

        // 前驱体压坯底纹（静态颗粒，缓存一次）
        var bg = this._bg;
        if (!bg) {
          var rb = mulberry32(Math.floor(tEnd * 13) + 7);
          bg = [];
          for (var q = 0; q < 520; q++) {
            bg.push({
              x: rb(), y: rb(),
              r: 0.005 + rb() * 0.010,
              lf: rb(),
              a: 0.45 + rb() * 0.45
            });
          }
          this._bg = bg;
        }
        for (var qi = 0; qi < bg.length; qi++) {
          var p2 = bg[qi];
          var lb = lt ? (74 + p2.lf * 14) : (20 + p2.lf * 12);
          ctx.fillStyle = 'hsla(' + v.hue + ', 16%, ' + lb + '%, ' + (lt ? p2.a * 0.7 : p2.a) + ')';
          ctx.beginPath();
          ctx.arc(p2.x * W, p2.y * H, p2.r * side, 0, 6.2832);
          ctx.fill();
        }

        // 生成相：先绘制加深轮廓（r+δ），再覆盖实心区域 → 仅外轮廓保留晶界
        var padded = [];
        for (var j = 0; j < sites.length; j++) {
          var s = sites[j];
          var dtt = t - s.tn;
          if (dtt <= 0) continue;
          var r = c * Math.sqrt(k * dtt) * s.jit * side;
          if (r < 0.8) continue;
          padded.push([s.x * W, s.y * H, r]);
        }
        var rim = Math.max(1.6, side * 0.008);
        ctx.fillStyle = lt ? 'hsl(' + v.hue + ', 46%, 40%)' : 'hsl(' + v.hue + ', 42%, 18%)';
        for (var a = 0; a < padded.length; a++) {
          ctx.beginPath();
          ctx.arc(padded[a][0], padded[a][1], padded[a][2] + rim, 0, 6.2832);
          ctx.fill();
        }
        ctx.fillStyle = lt ? 'hsl(' + v.hue + ', 60%, 57%)' : 'hsl(' + v.hue + ', 70%, 47%)';
        for (var b = 0; b < padded.length; b++) {
          ctx.beginPath();
          ctx.arc(padded[b][0], padded[b][1], padded[b][2], 0, 6.2832);
          ctx.fill();
        }
        // 轻微组织起伏（低透明度，避免出现明显圆形轮廓）
        ctx.fillStyle = lt ? 'hsla(' + v.hue + ', 92%, 26%, 0.035)' : 'hsla(' + v.hue + ', 82%, 66%, 0.10)';
        for (var c2 = 0; c2 < padded.length; c2 += 2) {
          ctx.beginPath();
          ctx.arc(padded[c2][0] - padded[c2][2] * 0.18, padded[c2][1] - padded[c2][2] * 0.18,
            padded[c2][2] * 0.55, 0, 6.2832);
          ctx.fill();
        }
        ctx.restore();
      }
    };
  }

  C.registerModule(SOLID, { buildMicroField: buildMicroField });
})(typeof window !== 'undefined' ? window : globalThis);
