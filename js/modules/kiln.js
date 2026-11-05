/* =========================================================================
 *  实验模块 · 马弗炉烧成
 *  炉膛稳态热场 + 装炉位置 + 一阶热滞后
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight, arr = C.arr, rrect = C.rrect, docCreateCanvas = C.docCreateCanvas;
  /* =====================================================================
   *  模块四：马弗炉烧成（箱式炉 · 装炉位置 · 炉膛热场）
   *
   *  这一模块要讲清楚工程上绕不开、课本里却很少展开的两个词：
   *   · 边界：炉膛六个面的换热条件并不相同，加热壁接近 1.0（边界值），
   *             炉门只有 0.90，门缝更低。样品放在哪儿，就享受哪一面的「待遇」。
   *   · 不均匀：腔内稳态温度场是 ∇²T = 0 的解，中间最高，四角与门口最低。
   *             同一台炉、同一条曲线，装炉位置不同，样品温度可差上百 K。
   *
   *  所以这里的「设定温度」只是边界条件（热电偶控制点），
   *  样品真正经历的温度 = 边界场插值 + 一阶热滞后，再由它决定反应程度。
   * ===================================================================== */
  var KILN_GEO = {
    nx: 64, ny: 40,
    left: 1.000, right: 0.902, top: 0.975, bottom: 0.958,
    doorEdge: 0.045             // 门框缝隙的额外漏热
  };
  var _kilnF = null;

  /* 稳态归一化热场：解 ∇²F = 0，四边给定不同的边界值 */
  function kilnNormField() {
    if (_kilnF) return _kilnF;
    var nx = KILN_GEO.nx, ny = KILN_GEO.ny;
    var F = new Float32Array(nx * ny);
    var i, j, k, idx;

    for (k = 0; k < nx * ny; k++) F[k] = 0.95;
    for (i = 0; i < nx; i++) {
      F[i] = KILN_GEO.bottom;
      F[(ny - 1) * nx + i] = KILN_GEO.top;
    }
    for (j = 0; j < ny; j++) {
      F[j * nx] = KILN_GEO.left;
      F[j * nx + nx - 1] = KILN_GEO.right;
    }
    var de = 4;
    for (j = 0; j < de; j++) {
      var f = KILN_GEO.doorEdge * (1 - j / de);
      F[j * nx + nx - 1] -= f;
      F[(ny - 1 - j) * nx + nx - 1] -= f;
    }

    // SOR 迭代
    var w = 1.87;
    for (var it = 0; it < 900; it++) {
      for (j = 1; j < ny - 1; j++) {
        var row = j * nx;
        for (i = 1; i < nx - 1; i++) {
          idx = row + i;
          var nv = 0.25 * (F[idx - 1] + F[idx + 1] + F[idx - nx] + F[idx + nx]);
          F[idx] += w * (nv - F[idx]);
        }
      }
    }

    var mn = 9, mx = -9;
    for (k = 0; k < nx * ny; k++) { if (F[k] < mn) mn = F[k]; if (F[k] > mx) mx = F[k]; }
    _kilnF = { F: F, nx: nx, ny: ny, min: mn, max: mx };
    return _kilnF;
  }

  function kilnFAt(G, u, v) {
    var nx = G.nx, ny = G.ny;
    var x = clamp(u, 0, 1) * (nx - 1), y = clamp(v, 0, 1) * (ny - 1);
    var i0 = Math.floor(x), j0 = Math.floor(y);
    var i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(ny - 1, j0 + 1);
    var fx = x - i0, fy = y - j0;
    var a = G.F[j0 * nx + i0], b = G.F[j0 * nx + i1];
    var c = G.F[j1 * nx + i0], d = G.F[j1 * nx + i1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /* 炉火色标：暗红 → 橙 → 亮黄 */
  function fireRamp(t) {
    var st = [
      [0.00, 26, 11, 9], [0.28, 106, 30, 14], [0.52, 184, 64, 20],
      [0.72, 232, 122, 36], [0.88, 251, 178, 72], [1.00, 255, 228, 158]
    ];
    t = clamp(t, 0, 1);
    for (var i = 1; i < st.length; i++) {
      if (t <= st[i][0]) {
        var a = st[i - 1], b = st[i];
        var f = (t - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
      }
    }
    return [255, 228, 158];
  }

  /* 黑体辐射近似色：样品自发光 */
  function bbRamp(T) {
    var st = [
      [380, 62, 52, 48], [560, 108, 44, 28], [720, 166, 58, 28],
      [880, 212, 96, 34], [1030, 245, 148, 52], [1180, 255, 202, 112]
    ];
    if (T <= st[0][0]) return [st[0][1], st[0][2], st[0][3]];
    for (var i = 1; i < st.length; i++) {
      if (T <= st[i][0]) {
        var a = st[i - 1], b = st[i];
        var f = (T - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
      }
    }
    return [255, 202, 112];
  }

  var KILN = {
    id: 'kiln',
    name: '马弗炉烧成',
    tag: 'Box Furnace',
    subtitle: '箱式炉装炉位置与炉膛热场',
    primaryKey: 'conversion',
    paramDefs: [
      { key: 'Tset', label: '设定温度', unit: '℃', min: 600, max: 1350, step: 5, def: 1050,
        hint: '温控表的目标值，本质上只是热电偶所在位置的一条边界条件' },
      { key: 'ramp', label: '升温速率', unit: '℃/min', min: 1, max: 15, step: 0.5, def: 5,
        hint: '速率越快，样品热滞后越大，真正处于高温段的时间越短' },
      { key: 'hold', label: '保温时间', unit: 'min', min: 30, max: 300, step: 5, def: 120,
        hint: '从炉温到达设定值开始计时，但此时样品可能还差 30~80 K' },
      { key: 'sx', label: '水平装炉位置', unit: '%', min: 0, max: 100, step: 1, def: 50,
        hint: '0% 贴近左侧加热壁，100% 靠近炉门（漏热最重）；可直接拖动图里的样品' },
      { key: 'sy', label: '垂直装炉位置', unit: '%', min: 0, max: 100, step: 1, def: 45,
        hint: '0% 放在炉底垫板，100% 靠近炉顶；热流上浮，上层通常更热' }
    ],
    /* part 为装料形式，τ 为该装料形式的热时间常数：
       薄片/小坩埚的热扩散时间常数按 τ ≈ d²/(4α) 估算（氧化铝 α ≈ 8.7e-6 m²/s），
       匣钵大装料因热容大而显著变慢。Gt 为在参考温度下保温 120 min 的目标晶粒尺寸。 */
    variants: [
      { id: 'BT', name: 'BaTiO₃ 钛酸钡', part: '坩埚装粉', kT: 1.27612e-2, Ea: 135, n: 2.20,
        Qg: 380, Gt: 3.0, tau: 1.8, hue: 190, defT: 1050,
        formula: 'BaCO₃ + TiO₂ → BaTiO₃ + CO₂↑',
        note: '电子陶瓷介电材料；装炉位置直接影响合成率与批次一致性' },
      { id: 'ZnO', name: 'ZnO 压敏陶瓷', part: '片状坯体', kT: 1.36025e-2, Ea: 150, n: 2.90,
        Qg: 220, Gt: 2.5, tau: 1.2, hue: 45, defT: 950,
        formula: 'ZnO + Bi₂O₃ + Sb₂O₃ → 压敏陶瓷',
        note: '薄片试样热容小、跟随快，但对炉门冷区依然敏感' },
      { id: 'NCM', name: 'LiNi₀.₈Co₀.₁Mn₀.₁O₂', part: '匣钵装载', kT: 1.41862e-2, Ea: 120, n: 2.40,
        Qg: 300, Gt: 3.6, tau: 9.0, hue: 155, defT: 800,
        formula: 'Ni₀.₈Co₀.₁Mn₀.₁(OH)₂ + LiOH·H₂O → NCM811',
        note: '匣钵装料量大、热滞后明显，是「设定到了、样品没到」的典型' },
      { id: 'LATP', name: 'LATP 固态电解质', part: '坩埚装粉', kT: 1.27931e-2, Ea: 140, n: 2.20,
        Qg: 360, Gt: 2.2, tau: 1.6, hue: 265, defT: 900,
        formula: 'Li₂CO₃ + Al₂O₃ + TiO₂ + NH₄H₂PO₄ → Li₁.₃Al₀.₃Ti₁.₇(PO₄)₃',
        note: 'NASICON 型固态电解质，温度不足时杂相难以消除' },
      { id: 'LCO', name: 'LiCoO₂ 钴酸锂', part: '坩埚装粉', kT: 1.35778e-2, Ea: 128, n: 2.30,
        Qg: 340, Gt: 3.0, tau: 1.7, hue: 330, defT: 850,
        formula: 'Li₂CO₃ + Co₃O₄ → LiCoO₂ + CO₂↑',
        note: '层状氧化物正极，焙烧窗口窄；温度偏高锂挥发、晶粒粗化' },
      { id: 'MZF', name: 'MnZn 铁氧体', part: '压制块料', kT: 1.18489e-2, Ea: 150, n: 3.00,
        Qg: 260, Gt: 6.0, tau: 2.6, hue: 15, defT: 1280,
        formula: 'MnCO₃ + ZnO + Fe₂O₃ → (Mn,Zn)Fe₂O₄',
        note: '软磁铁氧体磁芯；块料热容大、热滞后明显，晶粒易粗化' },
      { id: 'STO', name: 'SrTiO₃ 钛酸锶', part: '坩埚装粉', kT: 1.35529e-2, Ea: 140, n: 2.30,
        Qg: 350, Gt: 1.2, tau: 1.9, hue: 95, defT: 1100,
        formula: 'SrCO₃ + TiO₂ → SrTiO₃ + CO₂↑',
        note: '钙钛矿介质陶瓷；晶粒过粗会劣化介电性能' },
      { id: 'LFP', name: 'LiFePO₄ 磷酸铁锂', part: '薄层铺粉', kT: 0.0161401765, Ea: 184.2, n: 4.00,
        Qg: 300, Gt: 1.905939, tau: 1.4, hue: 140, defT: 750,
        formula: 'FePO₄ + Li₂CO₃ + C → LiFePO₄ + CO₂↑',
        note: '碳热还原需薄层铺料保证碳源均匀接触；温度不足则 Fe³⁺ 残留，碳不足则团聚' },
      { id: 'LTO', name: 'Li₄Ti₅O₁₂ 钛酸锂', part: '坩埚装粉', kT: 0.0167085520, Ea: 179.0, n: 2.00,
        Qg: 280, Gt: 1.375283, tau: 1.8, hue: 275, defT: 900,
        formula: '2Li₂CO₃ + 5TiO₂ → Li₄Ti₅O₁₂ + 2CO₂↑',
        note: '尖晶石负极，900 ℃ 煅烧；温度过高晶粒粗化，锂离子扩散路径变长' },
      { id: 'LMO', name: 'LiMn₂O₄ 锰酸锂', part: '压制块料', kT: 0.0126479590, Ea: 118.0, n: 2.40,
        Qg: 300, Gt: 2.354938, tau: 2.6, hue: 315, defT: 780,
        formula: '4MnO₂ + Li₂CO₃ → 2LiMn₂O₄ + CO₂↑ + ½O₂',
        note: '压制块料热容大、热滞后明显；需要长时间保温才能让锰均匀成相' },
      { id: 'PZT', name: 'Pb(Zr,Ti)O₃ 锆钛酸铅', part: '压制块料', kT: 0.0151371268, Ea: 224.9, n: 2.80,
        Qg: 320, Gt: 2.519622, tau: 2.4, hue: 35, defT: 1150,
        formula: 'PbO + ZrO₂ + TiO₂ → Pb(Zr,Ti)O₃',
        note: 'PbO 高温挥发，敞口坩埚装料会失铅欠烧；加盖并加母粉可抑制挥发' },
      { id: 'YBCO', name: 'YBa₂Cu₃O₇ 超导氧化物', part: '压制块料', kT: 0.0120693697, Ea: 114.6, n: 3.00,
        Qg: 300, Gt: 1.867118, tau: 2.8, hue: 185, defT: 900,
        formula: 'Y₂O₃ + 4BaCO₃ + 6CuO → 2YBa₂Cu₃O₇ + 4CO₂↑',
        note: '压块热滞后大，且必须在流动氧中烧结；普通马弗炉的静态空气会使晶格缺氧' },
      { id: 'YSZ', name: '8YSZ 钇稳定氧化锆', part: '压制块料', kT: 0.0168072635, Ea: 231.8, n: 3.00,
        Qg: 260, Gt: 1.347242, tau: 2.6, hue: 250, defT: 1000,
        formula: 'ZrO₂ + Y₂O₃ → (ZrO₂)₈(Y₂O₃)',
        note: '压制块料热容大，炉门冷区明显欠温；YSZ 难烧结，需长时间保温才能致密化' }
    ],
    seriesDefs: [
      { key: 'conversion', name: '转化率 α', unit: '%', color: '#3ddbe8', axis: 'left', primary: true },
      { key: 'tProg', name: '炉温（设定曲线）', unit: '℃', color: '#ffb347', axis: 'right' },
      { key: 'tPart', name: '样品实际温度', unit: '℃', color: '#ff7b93', axis: 'right', solid: true }
    ],
    outputDefs: [
      { key: 'conversion', label: '转化率', unit: '%', digits: 1, primary: true },
      { key: 'tPart', label: '样品峰值温度', unit: '℃', digits: 0 },
      { key: 'gap', label: '温度缺口', unit: 'K', digits: 0 },
      { key: 'holdEff', label: '有效保温', unit: 'min', digits: 0 },
      { key: 'density', label: '相对致密度', unit: '%', digits: 1 },
      { key: 'grain', label: '平均晶粒尺寸', unit: 'μm', digits: 1 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'conversion', label: '转化率最大', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' },
      { key: 'gap', label: '温度缺口最小', dir: 'min' },
      { key: 'grain', label: '晶粒尺寸最小', dir: 'min' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'gap30', label: '温度缺口 ≤ 30 K', test: function (m) { return m.gap <= 30; } },
      { id: 'hold100', label: '有效保温 ≥ 100 min', test: function (m) { return m.holdEff >= 100; } },
      { id: 'fine', label: '晶粒 ≤ 12 μm', test: function (m) { return m.grain <= 12; } }
    ],
    notes: [
      '炉膛稳态热场：∇²T = 0，边界为加热壁 ≈ T_set、炉门 ≈ 0.90·T_set（漏热），门缝更低。',
      '样品温度：dT_s/dt = (T_局部 − T_s)/τ，τ 为装炉件热时间常数，随装料热容从薄片的约 1 min 到匣钵装载的约 9 min。',
      '转变动力学：dα/dt = n·k(T_s)·(1−α)·[−ln(1−α)]^((n−1)/n)，k 用样品真实温度求 Arrhenius。',
      '晶粒长大：d(G³)/dt = K₃(T_s)，即 Ostwald 立方长大律，同样只认样品温度。'
    ]
  };

  KILN.simulate = function (p, v, opts) {
    var fast = !!(opts && opts.fast);
    var T0 = 25;
    var ramp = Math.max(0.5, p.ramp);
    var Tset = p.Tset;
    var hold = p.hold;
    var tRamp = Math.max(1, (Tset - T0) / ramp);
    var tEnd = tRamp + hold;

    var G = kilnNormField();
    var sxn = p.sx / 100, syn = p.sy / 100;
    var fpos = kilnFAt(G, 0.10 + 0.80 * sxn, 0.12 + 0.76 * syn);

    var A = v.kT / arr(v.defT + K0, v.Ea);
    var n = v.n;
    var K3 = (Math.pow(v.Gt, 3) - 1) / 120 / arr(v.defT + K0, v.Qg);
    var tau = v.tau || 6.5;

    var NP = fast ? 24 : 90;
    var time = [], tProg = [], tPart = [], conv = [], rate = [], grav = [];
    var dt = fast ? 0.9 : 0.28;
    var a = 0, G3 = 1, Ts = T0, TsMax = T0, holdEff = 0, ratePeak = 0;
    var nextT = 0, si = 0;
    var t, Tpg, Tloc, kk, am, dadot, g;

    for (t = 0; t < tEnd + dt * 0.5; t += dt) {
      Tpg = T0 + Math.min(ramp * t, Tset - T0);
      Tloc = T0 + (Tpg - T0) * fpos;
      Ts = Tloc + (Ts - Tloc) * Math.exp(-dt / tau);
      if (Ts > TsMax) TsMax = Ts;
      if (Ts >= Tset - Math.max(10, Tset * 0.05)) holdEff += dt;

      kk = A * arr(Ts + K0, v.Ea);
      am = Math.max(a, 1e-7);
      dadot = n * kk * Math.pow(-Math.log(1 - am), (n - 1) / n) * (1 - am);
      a = Math.min(0.999999, a + dadot * dt);
      if (dadot > ratePeak) ratePeak = dadot;
      G3 += K3 * arr(Ts + K0, v.Qg) * dt;

      if (t >= nextT - 1e-9 || t + dt >= tEnd) {
        g = Math.pow(G3, 1 / 3);
        time.push(Math.min(t, tEnd));
        tProg.push(Tpg);
        tPart.push(Ts);
        conv.push(a * 100);
        rate.push(dadot * 100);
        grav.push(g);
        si++;
        nextT = tEnd * si / (NP - 1);
        if (si >= NP) break;
      }
    }
    if (time.length < NP) {
      g = Math.pow(G3, 1 / 3);
      time.push(tEnd); tProg.push(Tset); tPart.push(Ts);
      conv.push(a * 100); rate.push(dadot * 100); grav.push(g);
    }

    var Gf = Math.pow(G3, 1 / 3);
    var rho = 0.60 + 0.385 * Math.sqrt(a) - 0.0007 * Gf + 0.010 * Math.log(1 + holdEff / 40);
    var rhoF = clamp(rho, 0.50, 0.995) * 100;
    var gap = Math.max(0, Tset - TsMax);
    var score = 100 * (0.42 * a +
      0.30 * clamp((rhoF / 100 - 0.85) / 0.145, 0, 1) +
      0.16 * clamp(1 - gap / 120, 0, 1) +
      0.12 * (1 - clamp((Gf - 2) / 28, 0, 1)));

    // 有效区温差（装料常用区 20%~80%）
    var uMin = 1e9, uMax = -1e9, ii, jj, val;
    for (jj = Math.round(G.ny * 0.15); jj <= Math.round(G.ny * 0.85); jj += 2) {
      for (ii = Math.round(G.nx * 0.2); ii <= Math.round(G.nx * 0.8); ii++) {
        val = G.F[jj * G.nx + ii];
        if (val < uMin) uMin = val;
        if (val > uMax) uMax = val;
      }
    }
    var uniform = (uMax - uMin) * (Tset - T0);

    var metrics = {
      conversion: a * 100,
      tPart: TsMax,
      gap: gap,
      holdEff: holdEff,
      density: rhoF,
      grain: Gf,
      score: score
    };

    var field = null;
    if (!fast) {
      field = buildKilnField({
        p: p, v: v, G: G, sxn: sxn, syn: syn, fpos: fpos,
        time: time, tProg: tProg, tPart: tPart, conv: conv,
        tEnd: tEnd, tRamp: tRamp, T0: T0, uniform: uniform, TsMax: TsMax, gap: gap
      });
    }

    return {
      time: time,
      series: { conversion: conv, tProg: tProg, tPart: tPart, rate: rate, grain: grav },
      metrics: metrics,
      field: field,
      extra: {
        tEnd: tEnd, tRamp: tRamp, fpos: fpos, uniform: uniform,
        TsMax: TsMax, gap: gap, holdEff: holdEff, ratePeak: ratePeak, tau: tau
      }
    };
  };

  /* ---------------------- 炉膛剖面动画（含拖动取样） ---------------------- */
  function buildKilnField(ctx) {
    var st = {
      p: ctx.p, v: ctx.v, G: ctx.G,
      time: ctx.time, tProg: ctx.tProg, tPart: ctx.tPart, conv: ctx.conv,
      sxn: ctx.sxn, syn: ctx.syn,
      tEnd: ctx.tEnd, tRamp: ctx.tRamp, T0: ctx.T0,
      uniform: ctx.uniform, TsMax: ctx.TsMax, gap: ctx.gap,
      _cv: null,
      _sample: null,
      _chamber: null,
      _hover: false,
      _drag: false
    };

    function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

    st.draw = function (c2, W, H, prog) {
      var lt = themeLight();
      var idx = Math.min(st.time.length - 1, Math.max(0, Math.round(prog * (st.time.length - 1))));
      var tNow = st.time[idx];
      var Tpg = st.tProg[idx];
      var Ts = st.tPart[idx];
      var aNow = st.conv[idx] / 100;
      var G = st.G, nx = G.nx, ny = G.ny;

      var cInk = lt ? '#1a2c44' : '#dce8f8';
      var cDim = lt ? 'rgba(38,64,96,0.62)' : 'rgba(170,195,225,0.62)';
      var cShell = lt ? '#c6d2e2' : '#1b2432';
      var cInsul = lt ? '#e7edf5' : '#232f42';
      var cLine = lt ? 'rgba(30,70,120,0.22)' : 'rgba(140,180,235,0.22)';
      var cWarm = lt ? '#b96a08' : 'rgba(255,179,71,0.95)';
      var cCurve = lt ? '#d1701a' : 'rgba(255,164,86,0.95)';
      var cCyan = lt ? '#0a7d90' : '#3ddbe8';

      c2.clearRect(0, 0, W, H);

      /* ---------- 布局 ---------- */
      var bodyX = W * 0.035, bodyY = 42;
      var bodyW = W * 0.93, bodyH = Math.min(H * 0.43, H - 42 - 112);
      var shell = 6, insul = 11;
      var doorW = Math.max(16, Math.min(22, bodyW * 0.045));
      var inX = bodyX + shell + insul;
      var inY = bodyY + shell + insul;
      var inW = bodyW - doorW - (shell + insul) * 2;
      var inH = bodyH - (shell + insul) * 2;
      st._chamber = { x: inX, y: inY, w: inW, h: inH };

      /* ---------- 顶部边界条件说明 ---------- */
      var bw = { left: st.T0 + (Tpg - st.T0) * KILN_GEO.left, top: st.T0 + (Tpg - st.T0) * KILN_GEO.top,
                 bottom: st.T0 + (Tpg - st.T0) * KILN_GEO.bottom, door: st.T0 + (Tpg - st.T0) * (KILN_GEO.right - KILN_GEO.doorEdge) };

      /* ---------- 炉体 ---------- */
      rrect(c2, bodyX, bodyY, bodyW, bodyH, 6);
      c2.fillStyle = cShell; c2.fill();
      c2.strokeStyle = cLine; c2.lineWidth = 1; c2.stroke();

      rrect(c2, bodyX + shell, bodyY + shell, bodyW - shell * 2, bodyH - shell * 2, 4);
      c2.fillStyle = cInsul; c2.fill();

      /* ---------- 炉膛温度场 ---------- */
      var qAbsScale = 1100;
      var tMin = st.T0 + (Tpg - st.T0) * G.min;
      var tMax = st.T0 + (Tpg - st.T0) * G.max;
      var span = Math.max(1e-6, tMax - tMin);

      if (!st._cv) st._cv = docCreateCanvas(nx, ny);
      var cv = st._cv, c3 = cv.getContext('2d');
      var img = c3.createImageData(nx, ny);
      var d = img.data;
      for (var j = 0; j < ny; j++) {
        for (var i = 0; i < nx; i++) {
          var T = st.T0 + (Tpg - st.T0) * G.F[j * nx + i];
          var qAbs = clamp((T - 25) / qAbsScale, 0, 1);
          var qRel = Math.pow(clamp((T - tMin) / span, 0, 1), 0.82);
          var col = fireRamp(0.48 * qAbs + 0.52 * qRel);
          var o = ((ny - 1 - j) * nx + i) * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
      }
      c3.putImageData(img, 0, 0);
      c2.save();
      c2.beginPath(); c2.rect(inX, inY, inW, inH); c2.clip();
      c2.imageSmoothingEnabled = true;
      c2.drawImage(cv, inX, inY, inW, inH);
      c2.restore();

      /* ---------- 等温线 ---------- */
      c2.save();
      c2.beginPath(); c2.rect(inX, inY, inW, inH); c2.clip();
      for (var ci = 1; ci <= 4; ci++) {
        var lv = tMin + span * ci / 5;
        c2.setLineDash([5, 4]);
        c2.lineWidth = 2.6;
        c2.strokeStyle = 'rgba(30,10,4,0.22)';
        contour(c2, G, lv, st.T0, Tpg, inX, inY, inW, inH);
        c2.lineWidth = 1.1;
        c2.strokeStyle = 'rgba(255,250,240,0.62)';
        contour(c2, G, lv, st.T0, Tpg, inX, inY, inW, inH);
        c2.setLineDash([]);
      }
      c2.restore();

      /* ---------- 内腔描边 ---------- */
      c2.strokeStyle = lt ? 'rgba(30,70,120,0.28)' : 'rgba(160,200,245,0.30)';
      c2.lineWidth = 1;
      c2.strokeRect(inX + 0.5, inY + 0.5, inW - 1, inH - 1);

      /* ---------- 加热元件（左 / 顶 / 底） ---------- */
      var heat = clamp((Tpg - st.T0) / Math.max(1, st.p.Tset - st.T0), 0, 1);
      var glow = 0.25 + 0.75 * heat;
      c2.lineCap = 'round';
      c2.shadowBlur = 10 * glow;
      c2.shadowColor = 'rgba(255,110,40,' + (0.55 * glow).toFixed(2) + ')';
      c2.strokeStyle = 'rgba(255,' + Math.round(90 + 110 * heat) + ',' + Math.round(40 + 60 * heat) + ',' + (0.5 + 0.45 * heat).toFixed(2) + ')';
      c2.lineWidth = 2.4;
      // 左壁螺旋
      c2.beginPath();
      for (var yy = inY + 6; yy <= inY + inH - 6; yy += 9) {
        c2.moveTo(inX + 1.6, yy);
        c2.lineTo(inX + 6.2, yy + 4.5);
      }
      c2.stroke();
      // 顶部 / 底部加热带
      c2.lineWidth = 1.3;
      c2.beginPath();
      c2.moveTo(inX + 8, inY + 3.2); c2.lineTo(inX + inW - 8, inY + 3.2);
      c2.moveTo(inX + 8, inY + inH - 3.2); c2.lineTo(inX + inW - 8, inY + inH - 3.2);
      c2.stroke();
      c2.lineWidth = 2.6;
      c2.beginPath();
      for (var xx = inX + 10; xx <= inX + inW - 10; xx += 11) {
        c2.moveTo(xx, inY + 1.4); c2.lineTo(xx, inY + 5.4);
        c2.moveTo(xx, inY + inH - 1.4); c2.lineTo(xx, inY + inH - 5.4);
      }
      c2.stroke();
      c2.shadowBlur = 0;

      /* ---------- 炉门 ---------- */
      var dx = bodyX + bodyW - doorW - shell;
      var dy0 = bodyY + shell, dh = bodyH - shell * 2;
      // 门缝冷流（先画，压在门后）
      c2.save();
      var grd = c2.createLinearGradient(dx - 30, 0, dx + 1, 0);
      grd.addColorStop(0, 'rgba(70,140,235,0)');
      grd.addColorStop(1, lt ? 'rgba(30,105,200,0.38)' : 'rgba(110,185,255,0.34)');
      c2.fillStyle = grd;
      c2.fillRect(dx - 30, dy0 + 2, 31, dh - 4);
      c2.restore();

      c2.fillStyle = lt ? '#aebdd2' : '#28374c';
      rrect(c2, dx, dy0, doorW, dh, 3); c2.fill();
      c2.strokeStyle = lt ? 'rgba(30,70,120,0.35)' : 'rgba(150,190,240,0.30)';
      c2.lineWidth = 1; c2.stroke();
      // 门扇内衬
      c2.fillStyle = lt ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.06)';
      rrect(c2, dx + 3, dy0 + 5, doorW - 6, dh - 10, 2); c2.fill();
      // 把手
      c2.fillStyle = lt ? '#6c8098' : '#5d708a';
      rrect(c2, dx + doorW * 0.5 - 1.8, dy0 + dh * 0.30, 3.6, dh * 0.40, 1.8); c2.fill();
      // 铰链
      c2.fillStyle = lt ? '#8fa2ba' : '#41546d';
      c2.fillRect(dx + 1, dy0 + 8, 4, 7);
      c2.fillRect(dx + 1, dy0 + dh - 15, 4, 7);

      /* ---------- 搁板 ---------- */
      var sy = st.syn;
      var sxp = st.sxn;
      var sw = Math.max(24, inW * 0.135);
      var shh = Math.max(16, inH * 0.17);
      var px = inX + inW * (0.10 + 0.80 * sxp) - sw / 2;
      var py = inY + inH * (0.88 - 0.76 * sy) - shh;
      px = clamp(px, inX + 4, inX + inW - sw - 4);
      py = clamp(py, inY + 4, inY + inH - shh - 4);
      st._sample = { x: px, y: py, w: sw, h: shh };

      // 垫板
      c2.fillStyle = lt ? 'rgba(120,90,70,0.55)' : 'rgba(150,110,80,0.55)';
      c2.fillRect(px - 12, py + shh + 1, sw + 24, 3);

      /* ---------- 样品 ---------- */
      var col2 = bbRamp(Ts);
      var body = 'rgb(' + Math.round(col2[0]) + ',' + Math.round(col2[1]) + ',' + Math.round(col2[2]) + ')';
      // 外发光（热辐射）
      if (Ts > 600) {
        c2.save();
        c2.shadowBlur = Math.min(26, (Ts - 600) / 22);
        c2.shadowColor = 'rgba(255,' + Math.round(120 + (Ts - 600) / 8) + ',60,0.85)';
        c2.fillStyle = body;
        rrect(c2, px, py, sw, shh, 2.5); c2.fill();
        c2.restore();
      } else {
        c2.fillStyle = body;
        rrect(c2, px, py, sw, shh, 2.5); c2.fill();
      }
      // 未反应核（收缩核模型示意）
      var core = Math.sqrt(Math.max(0, 1 - aNow));
      if (core > 0.06) {
        c2.fillStyle = lt ? 'rgba(40,46,56,' + (0.55 * core + 0.12).toFixed(2) + ')'
                          : 'rgba(18,20,26,' + (0.62 * core + 0.12).toFixed(2) + ')';
        c2.beginPath();
        c2.ellipse(px + sw / 2, py + shh / 2, sw * 0.46 * core, shh * 0.44 * core, 0, 0, 6.2832);
        c2.fill();
      }
      c2.strokeStyle = lt ? 'rgba(20,30,45,0.45)' : 'rgba(255,235,205,0.35)';
      c2.lineWidth = 1;
      rrect(c2, px, py, sw, shh, 2.5); c2.stroke();

      // 拖动手柄
      c2.setLineDash([3, 3]);
      c2.strokeStyle = st._hover || st._drag ? 'rgba(61,219,232,0.9)' : 'rgba(61,219,232,0.42)';
      c2.lineWidth = 1;
      rrect(c2, px - 5.5, py - 5.5, sw + 11, shh + 11, 4); c2.stroke();
      c2.setLineDash([]);

      /* ---------- 热电偶 ---------- */
      var tcX = inX + inW * 0.235, tcY0 = inY + 1, tcY1 = inY + inH * 0.20;
      c2.strokeStyle = lt ? 'rgba(60,80,110,0.8)' : 'rgba(200,215,235,0.7)';
      c2.lineWidth = 1.4;
      c2.beginPath(); c2.moveTo(tcX, tcY0); c2.lineTo(tcX, tcY1); c2.stroke();
      c2.beginPath(); c2.arc(tcX, tcY1, 2.6, 0, 6.2832);
      c2.fillStyle = lt ? '#2f4a6d' : '#eef5ff'; c2.fill();
      c2.strokeStyle = 'rgba(20,12,8,0.55)'; c2.lineWidth = 1; c2.stroke();
      c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.fillStyle = lt ? 'rgba(20,40,65,0.85)' : 'rgba(235,242,255,0.9)';
      c2.textAlign = 'left';
      c2.fillText('TC', tcX + 4, tcY1 - 1);

      /* ---------- 标注：设定 / 样品 / 缺口 ---------- */
      c2.textAlign = 'center';
      c2.font = '10.5px "Microsoft YaHei", sans-serif';
      var lab = '样品 ' + fmt(Ts, 0) + ' ℃';
      var lw = c2.measureText(lab).width + 10;
      var tagY = py - 11;
      if (tagY - 8 < inY + 4) tagY = py + shh + 17;      // 贴顶时标签放到样品下方
      var labX = clamp(px + sw / 2, inX + lw / 2 + 3, inX + inW - lw / 2 - 3);
      c2.fillStyle = lt ? 'rgba(255,255,255,0.92)' : 'rgba(8,14,24,0.8)';
      rrect(c2, labX - lw / 2, tagY - 8, lw, 15, 4); c2.fill();
      c2.fillStyle = lt ? '#0f2036' : '#ffe6c8';
      c2.fillText(lab, labX, tagY);

      // 画布右上角（炉体之外）：设定值
      c2.textAlign = 'right';
      c2.textBaseline = 'middle';
      c2.font = '11px "Microsoft YaHei", sans-serif';
      c2.fillStyle = cWarm;
      c2.fillText('设定 ' + fmt(st.p.Tset, 0) + ' ℃', inX + inW, 21);
      c2.font = '9.5px "Microsoft YaHei", sans-serif';
      c2.fillStyle = cDim;
      c2.fillText('温控表目标值', inX + inW, 34);

      /* ---------- 边界条件一行（放在炉体下方，避开左上角 HUD） ---------- */
      c2.textAlign = 'left';
      c2.textBaseline = 'middle';
      c2.font = '9.5px "Microsoft YaHei", sans-serif';
      c2.fillStyle = cDim;
      var bwTxt = W < 430
        ? ('边界  壁 ' + fmt(bw.left, 0) + ' ｜ 顶 ' + fmt(bw.top, 0) +
           ' ｜ 底 ' + fmt(bw.bottom, 0) + ' ｜ 门 ' + fmt(bw.door, 0) + ' ℃')
        : ('边界条件  加热壁 ' + fmt(bw.left, 0) + ' ℃ ｜ 炉顶 ' + fmt(bw.top, 0) +
           ' ｜ 炉底 ' + fmt(bw.bottom, 0) + ' ｜ 炉门 ' + fmt(bw.door, 0) + ' ℃');
      c2.fillText(bwTxt, inX - 2, bodyY + bodyH + 11);

      /* ---------- 底部：沿装料高度的水平温度剖面 ---------- */
      var py0 = bodyY + bodyH + 20;
      var phH = H - py0 - 6;
      if (phH < 40) return;

      var jrow = Math.round((0.12 + 0.76 * sy) * (ny - 1));
      var prof = [], pMin = 1e9, pMax = -1e9;
      for (var kk2 = 0; kk2 < nx; kk2++) {
        var tv = st.T0 + (Tpg - st.T0) * G.F[jrow * nx + kk2];
        prof.push(tv);
        if (tv < pMin) pMin = tv;
        if (tv > pMax) pMax = tv;
      }
      var pPad = Math.max(6, (pMax - pMin) * 0.35);
      var lo2 = pMin - pPad, hi2 = pMax + pPad;
      var baseY = py0 + phH - 15;
      var my = function (v) { return baseY - (v - lo2) / (hi2 - lo2) * (phH - 22); };

      // 曲线 + 填充
      c2.beginPath();
      for (var kx = 0; kx < prof.length; kx++) {
        var xx2 = inX + inW * kx / (prof.length - 1);
        if (kx === 0) c2.moveTo(xx2, my(prof[kx]));
        else c2.lineTo(xx2, my(prof[kx]));
      }
      var fillG = c2.createLinearGradient(0, py0, 0, baseY);
      fillG.addColorStop(0, 'rgba(255,150,70,0.28)');
      fillG.addColorStop(1, 'rgba(255,150,70,0.02)');
      c2.save();
      c2.lineTo(inX + inW, baseY);
      c2.lineTo(inX, baseY);
      c2.closePath();
      c2.fillStyle = fillG; c2.fill();
      c2.restore();

      c2.beginPath();
      for (var kx2 = 0; kx2 < prof.length; kx2++) {
        var xx3 = inX + inW * kx2 / (prof.length - 1);
        if (kx2 === 0) c2.moveTo(xx3, my(prof[kx2]));
        else c2.lineTo(xx3, my(prof[kx2]));
      }
      c2.strokeStyle = cCurve;
      c2.lineWidth = 1.7;
      c2.stroke();

      // 常用装料区（20%~80% 宽度）
      c2.fillStyle = lt ? 'rgba(10,125,144,0.055)' : 'rgba(61,219,232,0.045)';
      c2.fillRect(inX + inW * 0.20, py0 + 8, inW * 0.60, baseY - py0 - 8);
      c2.setLineDash([3, 3]);
      c2.strokeStyle = lt ? 'rgba(10,125,144,0.32)' : 'rgba(61,219,232,0.26)';
      c2.lineWidth = 1;
      c2.beginPath();
      c2.moveTo(inX + inW * 0.20, py0 + 8); c2.lineTo(inX + inW * 0.20, baseY);
      c2.moveTo(inX + inW * 0.80, py0 + 8); c2.lineTo(inX + inW * 0.80, baseY);
      c2.stroke();
      c2.setLineDash([]);
      c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'center';
      c2.fillStyle = lt ? 'rgba(10,110,130,0.7)' : 'rgba(110,220,235,0.62)';
      c2.fillText('常用装料区', inX + inW * 0.5, py0 + 15);

      // 基线
      c2.strokeStyle = cLine; c2.lineWidth = 1;
      c2.beginPath();
      c2.moveTo(inX, baseY + 0.5); c2.lineTo(inX + inW, baseY + 0.5);
      c2.stroke();

      // 样品位置
      var sxPos = inX + inW * (0.10 + 0.80 * sxp);
      var syT = st.T0 + (Tpg - st.T0) * kilnFAt(G, 0.10 + 0.80 * sxp, 0.12 + 0.76 * sy);
      c2.setLineDash([2, 3]);
      c2.strokeStyle = lt ? 'rgba(10,125,144,0.55)' : 'rgba(61,219,232,0.5)';
      c2.beginPath(); c2.moveTo(sxPos, py0 + 2); c2.lineTo(sxPos, baseY); c2.stroke();
      c2.setLineDash([]);
      c2.beginPath(); c2.arc(sxPos, my(syT), 3.8, 0, 6.2832);
      c2.fillStyle = cCyan; c2.fill();
      c2.strokeStyle = lt ? '#ffffff' : '#06202a'; c2.lineWidth = 1.4; c2.stroke();

      c2.font = '9.5px "Microsoft YaHei", sans-serif';
      c2.textBaseline = 'middle';
      // 标题
      c2.textAlign = 'right';
      c2.fillStyle = cDim;
      c2.fillText('同一装料高度上的温度剖面', inX + inW, py0 + 4);
      // 轴两端
      c2.fillText('左壁', inX + 1, baseY + 8);
      c2.textAlign = 'right';
      c2.fillText('炉门', inX + inW, baseY + 8);
      // 极值
      c2.textAlign = 'left';
      c2.fillStyle = cWarm;
      c2.fillText('高 ' + fmt(pMax, 0) + ' / 低 ' + fmt(pMin, 0) + ' ℃', inX + 34, baseY + 8);
      c2.textAlign = 'right';
      c2.fillText('ΔT = ' + fmt(pMax - pMin, 0) + ' K', inX + inW - 34, baseY + 8);
    };

    /* 等温线（marching squares 简化版） */
    function contour(c2, G, level, T0, Tpg, x0, y0, w, h) {
      var nx = G.nx, ny = G.ny;
      var cellW = w / (nx - 1), cellH = h / (ny - 1);
      var f = function (val) { return T0 + (Tpg - T0) * val; };
      c2.beginPath();
      for (var j = 0; j < ny - 1; j++) {
        for (var i = 0; i < nx - 1; i++) {
          var v00 = f(G.F[j * nx + i]), v10 = f(G.F[j * nx + i + 1]);
          var v01 = f(G.F[(j + 1) * nx + i]), v11 = f(G.F[(j + 1) * nx + i + 1]);
          var s00 = v00 >= level, s10 = v10 >= level, s01 = v01 >= level, s11 = v11 >= level;
          if (s00 === s10 && s00 === s01 && s00 === s11) continue;
          var pts = [];
          if (s00 !== s10) pts.push([x0 + (i + (level - v00) / (v10 - v00)) * cellW, y0 + (ny - 1 - j) * cellH]);
          if (s01 !== s11) pts.push([x0 + (i + (level - v01) / (v11 - v01)) * cellW, y0 + (ny - 2 - j) * cellH]);
          if (s00 !== s01) pts.push([x0 + i * cellW, y0 + (ny - 1 - j - (level - v00) / (v01 - v00)) * cellH]);
          if (s10 !== s11) pts.push([x0 + (i + 1) * cellW, y0 + (ny - 1 - j - (level - v10) / (v11 - v10)) * cellH]);
          if (pts.length >= 2) {
            c2.moveTo(pts[0][0], pts[0][1]);
            c2.lineTo(pts[1][0], pts[1][1]);
            if (pts.length === 4) {
              c2.moveTo(pts[2][0], pts[2][1]);
              c2.lineTo(pts[3][0], pts[3][1]);
            }
          }
        }
      }
      c2.stroke();
    }

    st.hitTest = function (mx_, my_) {
      var s = st._sample;
      if (!s) return false;
      var pad = 10;
      return mx_ > s.x - pad && mx_ < s.x + s.w + pad && my_ > s.y - pad && my_ < s.y + s.h + pad;
    };

    st.toPos = function (mx_, my_) {
      var ch = st._chamber;
      if (!ch) return null;
      var u = (mx_ - ch.x) / ch.w;
      var v = (my_ - ch.y) / ch.h;
      return {
        sx: clamp((u - 0.10) / 0.80 * 100, 0, 100),
        sy: clamp((0.88 - v) / 0.76 * 100, 0, 100)
      };
    };

    return st;
  }

  C.registerModule(KILN, { kilnNormField: kilnNormField, kilnFAt: kilnFAt, buildKilnField: buildKilnField });
})(typeof window !== 'undefined' ? window : globalThis);
