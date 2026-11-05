/* =========================================================================
 *  实验模块 · Fe-C 热处理
 *  奥氏体化 + 晶粒长大 + 冷却速度决定组织分配
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var RGAS = C.RGAS, K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight, arr = C.arr, mulberry32 = C.mulberry32, rrect = C.rrect;

  /* ==========================================================================
   *  热处理（heat）：Fe-C 合金的奥氏体化、保温晶粒长大、可控冷却组织转变
   *  面向磁性材料与线缆用钢。碳含量决定平衡组织，冷速决定过冷奥氏体的去向，
   *  气氛决定氧化脱碳程度，三者共同决定矫顽力与磁导率。
   * ========================================================================== */

  function hsig(x) { return 1 / (1 + Math.exp(-x)); }

  var HEAT = {
    id: 'heat',
    name: '热处理',
    tag: 'Heat Treatment',
    subtitle: 'Fe-C 合金的加热、保温与可控冷却',
    primaryKey: 'Hc',
    paramDefs: [
      { key: 'C', label: '碳含量', unit: 'wt%', min: 0.02, max: 1.20, step: 0.01, def: 0.45,
        hint: '决定平衡组织中的珠光体比例。碳越高，渗碳体越多，矫顽力越大' },
      { key: 'Tset', label: '加热温度', unit: '℃', min: 150, max: 1000, step: 5, def: 850,
        hint: '低于 Ac1 时进入回火区间，组织从淬火马氏体开始软化' },
      { key: 'ramp', label: '升温速率', unit: '℃/min', min: 1, max: 15, step: 0.5, def: 8,
        hint: '升温快则奥氏体化时间短，晶粒来不及长大，但工件内外温差更大' },
      { key: 'hold', label: '保温时间', unit: 'min', min: 10, max: 180, step: 5, def: 60,
        hint: '保温越久奥氏体化越完全，但晶粒按幂律持续长大' },
      { key: 'cool', label: '冷却速率', unit: '℃/s', min: 0.02, max: 200, step: 0.01, def: 2, log: true,
        hint: '炉冷 0.05、空冷 2、风冷 15、油冷 40、水冷 120 ℃/s。这是决定组织的关键参数' },
      { key: 'atm', label: '炉内气氛', unit: '', min: 0, max: 2, step: 1, def: 1,
        hint: '0 真空、1 保护气氛、2 开放通风。氧势越高，氧化脱碳越严重' }
    ],
    /* defC 为该牌号的名义碳含量，defT 为推荐的奥氏体化温度；
       hue 用于组织图配色，Ac3 由碳含量实时算出，不在此固化。 */
    variants: [
      { id: 'dt4', name: 'DT4 电磁纯铁（C≤0.04）', defC: 0.03, defT: 880, hue: 200,
        formula: 'Fe（极低碳，α-Fe 基体）',
        note: '软磁首选。碳极低、夹杂少，退火后晶粒粗大、矫顽力最低，用于继电器铁芯与磁屏蔽' },
      { id: 's10', name: '10 号钢（C≈0.10）', defC: 0.10, defT: 900, hue: 210,
        formula: 'Fe + 少量珠光体',
        note: '低碳钢，塑韧性好。冷速稍快即可得到细珠光体，兼顾磁性与强度' },
      { id: 's20', name: '20 号钢（C≈0.20）', defC: 0.20, defT: 900, hue: 190,
        formula: 'Fe + 珠光体（约 25%）',
        note: '渗碳齿轮与轴类常用。正火得到均匀细珠光体，淬火后低碳马氏体韧性好' },
      { id: 's45', name: '45 号钢（C≈0.45）', defC: 0.45, defT: 850, hue: 32,
        formula: 'Fe + 珠光体（约 55%）',
        note: '调质钢代表。淬火加高温回火得到回火索氏体，强韧匹配；作为磁钢则矫顽力偏高' },
      { id: 't8', name: 'T8 碳素工具钢（C≈0.80）', defC: 0.80, defT: 800, hue: 280,
        formula: '共析珠光体（片层状）',
        note: '共析成分。缓冷得到全珠光体，水冷几乎全马氏体，硬度可达 HRC 64 以上' },
      { id: 't12', name: 'T12 碳素工具钢（C≈1.20）', defC: 1.20, defT: 780, hue: 330,
        formula: '珠光体 + 先共析渗碳体',
        note: '过共析钢。必须球化退火才能切削，直接淬火会因网状渗碳体而脆裂' }
    ],
    /* 左轴统一用百分比：奥氏体化程度与马氏体含量都是 %，共用一条轴才不会互相压扁。
       晶粒尺寸是 μm，混进左轴会把百分比曲线压成直线，因此只放在 KPI 里。 */
    seriesDefs: [
      { key: 'T', name: '工件温度', unit: '℃', color: '#ffb347', axis: 'right', primary: true },
      { key: 'aust', name: '奥氏体化程度', unit: '%', color: '#3ddbe8', axis: 'left' },
      { key: 'fM', name: '马氏体含量', unit: '%', color: '#a78bfa', axis: 'left' }
    ],
    outputDefs: [
      { key: 'Hc', label: '矫顽力 Hc', unit: 'A/m', digits: 0, primary: true },
      { key: 'mu', label: '最大磁导率', unit: '', digits: 0 },
      { key: 'HV', label: '硬度', unit: 'HV', digits: 0 },
      { key: 'grain', label: '晶粒尺寸', unit: 'μm', digits: 0 },
      { key: 'decarb', label: '脱碳层深度', unit: 'mm', digits: 2 },
      { key: 'fM', label: '马氏体含量', unit: '%', digits: 0 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'Hc', label: '矫顽力最小', dir: 'min' },
      { key: 'mu', label: '磁导率最大', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' },
      { key: 'decarb', label: '脱碳层最浅', dir: 'min' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'soft', label: '矫顽力 ≤ 200 A/m', test: function (m) { return m.Hc <= 200; } },
      { id: 'd03', label: '脱碳层 ≤ 0.3 mm', test: function (m) { return m.decarb <= 0.3; } },
      { id: 'coarse', label: '晶粒 ≥ 50 μm', test: function (m) { return m.grain >= 50; } }
    ],
    notes: [
      '临界温度：Ac1 取 727 ℃。亚共析钢 Ac3 = 912 − 203√C，过共析钢 Acm = 727 + 400(C − 0.8)。',
      '奥氏体晶粒长大：d² = d₀² + K·t·exp(−Qg/RT)/(1 + 6C)，碳含量升高会拖慢晶界迁移。',
      '冷却组织分配由冷速与临界冷速之比决定：v_k = 45·exp(−1.6C)，比值越大马氏体越多，中等冷速落入贝氏体区。',
      '珠光体类再按冷速细分为 P（粗片层）、S（索氏体）、T（托氏体），片层间距随过冷度减小。',
      '脱碳层按抛物线规律 x = k√t·exp(−Qd/RT)，真空与保护气氛的氧势因子分别取 0.04 与 0.10。',
      '矫顽力叠加碳化物钉扎、马氏体缺陷与晶界三部分。脱碳降低表层碳含量，反而使 Hc 下降。'
    ]
  };

  HEAT.simulate = function (p, v, opts) {
    var fast = !!(opts && opts.fast);
    var T0 = 25;
    var C = p.C, Tset = p.Tset, hold = p.hold, cool = p.cool, atm = p.atm;
    var ramp = Math.max(0.5, p.ramp);

    /* ---------- 临界温度 ---------- */
    var Ac1 = 727;
    var Ac3 = C <= 0.8 ? (912 - 203 * Math.sqrt(Math.max(C, 0.01))) : (727 + 400 * (C - 0.8));
    var Ms = C <= 0.6 ? (539 - 423 * C) : Math.max(100, 320 - 260 * (C - 0.6));
    var isTemper = Tset < Ac1;

    /* ---------- 奥氏体化程度 ---------- */
    var austF = 0;
    if (!isTemper) {
      austF = Tset >= Ac3 ? 1 : (Tset - Ac1) / Math.max(1, Ac3 - Ac1);
      austF = clamp(austF, 0, 1) * (1 - Math.exp(-hold / 8));
    }

    /* ---------- 奥氏体晶粒 ---------- */
    var d0 = 10, Qg = 150000, Kg = 1.03e9;
    var grain = isTemper ? 15 :
      Math.sqrt(d0 * d0 + austF * (Kg / (1 + 6 * C)) * hold * Math.exp(-Qg / (RGAS * (Tset + K0))));

    /* ---------- 冷却组织分配（目标分数） ---------- */
    var vk = 45 * Math.exp(-1.6 * C);
    var u = Math.log10(cool);
    var uv = Math.log10(cool / vk);
    var fMt = isTemper ? 0 : hsig(uv / 0.22);
    var fBt = isTemper ? 0 : (1 - fMt) * hsig((u - Math.log10(20)) / 0.35);
    var rest = 1 - fMt - fBt;
    var proCap = clamp(1 - Math.log10(cool / 2) / 2, 0, 1);
    var fProt = (!isTemper && C < 0.8) ? rest * ((0.8 - C) / 0.8) * 0.85 * proCap : 0;
    var fCemt = (!isTemper && C > 0.8) ? rest * ((C - 0.8) / 0.6) * 0.40 * proCap : 0;
    var fPST = Math.max(0, rest - fProt - fCemt);
    var tShare = hsig((u - Math.log10(8)) / 0.35);
    var pShare = 1 - hsig((u - Math.log10(0.3)) / 0.35);
    var fTt = fPST * tShare;
    var fPt = fPST * pShare;
    var fSt = Math.max(0, fPST - fTt - fPt);

    /* ---------- 脱碳层 ---------- */
    var atmF = [0.04, 0.10, 1.0][Math.round(atm)];
    if (atmF == null) atmF = 1.0;
    var decarb = Math.min(5, 100400 * Math.sqrt(hold) * Math.exp(-130000 / (RGAS * (Tset + K0))) * atmF);

    /* ---------- 时间轴：升温 / 保温 / 冷却 ---------- */
    var tRamp = (Tset - T0) / ramp;
    var tCool = (Tset - T0) / (cool * 60);
    var tEnd = tRamp + hold + tCool;

    var NP = fast ? 26 : 96;
    var dt = tEnd / (NP - 1);
    var time = [], sT = [], sAust = [], sGrain = [], sHc = [], sFm = [];
    var aNow = 0, gNow = d0, fMnow = 0, fPnow = 0;
    /* 组织转变在冷却段按温度窗口推进，动画能看见组织长出来 */
    var pP = 0, pB = 0, pM = 0;

    for (var i = 0; i < NP; i++) {
      var t = i * dt;
      var T;
      if (t <= tRamp) T = T0 + (Tset - T0) * (t / Math.max(1e-6, tRamp));
      else if (t <= tRamp + hold) T = Tset;
      else T = Math.max(T0, Tset - (t - tRamp - hold) * cool * 60);

      if (!isTemper && T > Ac1) {
        var eq = T >= Ac3 ? 1 : clamp((T - Ac1) / Math.max(1, Ac3 - Ac1), 0, 1);
        aNow = Math.max(aNow, eq * (1 - Math.exp(-(t > tRamp ? hold : t) / 8)));
      }
      if (!isTemper && T > Ac1 && aNow > 0.05) {
        gNow = Math.sqrt(d0 * d0 + aNow * (Kg / (1 + 6 * C)) * Math.min(t, tRamp + hold) *
          Math.exp(-Qg / (RGAS * (T + K0))));
      }
      if (t > tRamp + hold) {
        pP = clamp((650 - T) / 50, 0, 1);
        pB = clamp((560 - T) / 50, 0, 1);
        pM = Ms > T0 ? clamp((Ms - T) / 60, 0, 1) : 0;
        fMnow = fMt * pM;
        fPnow = fPST * pP;
      }
      var cemNow = fPnow * 0.12 * (C / 0.8);
      var hcNow = 30 + 7000 * cemNow + 4000 * fMnow + 8000 / Math.max(1, gNow);

      time.push(t);
      sT.push(T);
      sAust.push(isTemper ? 0 : aNow * 100);
      sGrain.push(gNow);
      sHc.push(hcNow);
      sFm.push(fMnow * 100);
    }

    /* ---------- 终态指标 ---------- */
    var Ceff = C * (1 - clamp(decarb / 5, 0, 0.7));
    var HV_M = 200 + 900 * C;
    var HV, Hc, fM, fB, fP, fS, fT, fPro, fCem, soften = 0;

    if (isTemper) {
      soften = clamp((Tset - 150) / 500, 0, 1) * (1 - Math.exp(-hold / 40));
      HV = HV_M * (1 - 0.60 * soften);
      Hc = (30 + 4000 + 8000 / 45) * (1 - 0.82 * soften);
      fM = 0; fB = 0; fP = 0; fS = 0; fT = 0; fPro = 0; fCem = 0;
    } else {
      fM = fMt; fB = fBt; fP = fPt; fS = fSt; fT = fTt; fPro = fProt; fCem = fCemt;
      /* 未奥氏体化的部分保留原始退火组织（先共析铁素体 + 珠光体） */
      var keep = 1 - austF;
      var fPro0 = (0.8 - C) / 0.8 * 0.85;
      if (C < 0.8) { fPro += keep * fPro0; fP += keep * (1 - fPro0); }
      else { fCem += keep * 0.25; }

      HV = fM * HV_M + fB * 400 + fT * 340 + fS * 260 + fP * 200 + fPro * 90 + fCem * 550;
      var cem = fPST * 0.12 * (Ceff / 0.8) + fCem + fB * 0.05;
      Hc = 30 + 7000 * cem + 4000 * fM + 8000 / Math.max(1, grain);
    }

    var mu = 12000 / (1 + Hc / 100);
    /* 综合评分：软磁用途看低矫顽力与高磁导率，同时惩罚严重脱碳与过硬组织 */
    var score = 100 * (0.42 * clamp(mu / 6000, 0, 1) +
      0.33 * clamp(1 - Hc / 3000, 0, 1) +
      0.15 * clamp(1 - decarb / 2, 0, 1) +
      0.10 * clamp((HV - 80) / 400, 0, 1));

    var metrics = {
      Hc: Hc, mu: mu, HV: HV, grain: grain, decarb: decarb,
      fM: fM * 100, score: score
    };

    var field = null;
    if (!fast) {
      field = buildHeatField({
        p: p, v: v, time: time, sT: sT, sAust: sAust, sGrain: sGrain,
        Ac1: Ac1, Ac3: Ac3, Ms: Ms, T0: T0, tRamp: tRamp, tEnd: tEnd,
        isTemper: isTemper,
        frac: { fM: fM, fB: fB, fP: fP, fS: fS, fT: fT, fPro: fPro, fCem: fCem },
        decarb: decarb, grain: grain, soften: soften, austF: austF, cool: cool
      });
    }

    return {
      time: time,
      series: { T: sT, aust: sAust, grain: sGrain, Hc: sHc, fM: sFm },
      metrics: metrics,
      field: field,
      extra: {
        Ac1: Ac1, Ac3: Ac3, Ms: Ms, tRamp: tRamp, tEnd: tEnd, isTemper: isTemper,
        frac: { fM: fM, fB: fB, fP: fP, fS: fS, fT: fT, fPro: fPro, fCem: fCem },
        cool: cool, vk: vk, atm: atm, soften: soften, decarb: decarb, hcSeries: sHc,
        austF: austF
      }
    };
  };

  /* ---------------------- 热处理组织可视化 ---------------------- */
  function buildHeatField(ctx) {
    var st = {
      p: ctx.p, v: ctx.v,
      time: ctx.time, sT: ctx.sT, sAust: ctx.sAust, sGrain: ctx.sGrain,
      Ac1: ctx.Ac1, Ac3: ctx.Ac3, Ms: ctx.Ms, T0: ctx.T0,
      tRamp: ctx.tRamp, tEnd: ctx.tEnd,
      isTemper: ctx.isTemper, frac: ctx.frac,
      decarb: ctx.decarb, grain: ctx.grain, soften: ctx.soften,
      austF: ctx.austF, cool: ctx.cool,
      _cv: null, _key: '', _cw: 0, _ch: 0
    };

    /* 相在组织图里的基色（r,g,b） */
    function phaseRGB(kind, lt) {
      if (kind === 'F') return lt ? [214, 222, 232] : [92, 108, 128];   // 铁素体
      if (kind === 'P') return lt ? [176, 186, 202] : [70, 84, 104];    // 珠光体
      if (kind === 'S') return lt ? [160, 172, 192] : [62, 76, 96];     // 索氏体
      if (kind === 'T') return lt ? [142, 156, 178] : [54, 66, 86];     // 托氏体
      if (kind === 'B') return lt ? [150, 158, 180] : [58, 68, 92];     // 贝氏体
      if (kind === 'M') return lt ? [108, 118, 146] : [38, 44, 66];     // 马氏体
      if (kind === 'C') return lt ? [232, 226, 208] : [122, 116, 98];   // 渗碳体
      return lt ? [200, 208, 220] : [80, 92, 110];
    }

    /* 按分数生成相序列，用确定性随机分配 */
    function phaseList(f) {
      f = f || st.frac;
      var arr = [];
      var defs = [['M', f.fM], ['B', f.fB], ['T', f.fT], ['S', f.fS], ['P', f.fP], ['C', f.fCem], ['F', f.fPro]];
      defs.forEach(function (d) {
        for (var i = 0; i < Math.round(d[1] * 100); i++) arr.push(d[0]);
      });
      if (!arr.length) arr.push('F');
      return arr;
    }

    /* 生成组织纹理（离屏），只在参数变化时重算 */
    function renderOrg(w, h, lt, fr) {
      fr = fr || st.frac;
      // 相分数按 0.1 粒度进缓存键：动画期间最多重算十余次，不会每帧都重画
      var key = [st.p.C, st.p.cool, st.p.atm, st.grain, st.decarb,
        Math.round(fr.fM * 10), Math.round(fr.fB * 10), Math.round(fr.fP * 10),
        Math.round(fr.fS * 10), Math.round(fr.fT * 10), Math.round(fr.fPro * 10),
        Math.round(fr.fCem * 10), lt ? 1 : 0, w, h].join('|');
      if (key === st._key && st._cv && st._cw === w && st._ch === h) return st._cv;

      var cv = st._cv || document.createElement('canvas');
      cv.width = w; cv.height = h;
      var g2 = cv.getContext('2d');
      var img = g2.createImageData(w, h);
      var d = img.data;

      var list = phaseList(fr);
      var rnd = mulberry32(20261105);
      // 晶粒网格：视场约横跨 6 个晶粒
      var NX = 6;
      var pxPerUm = w / (NX * Math.max(4, st.grain));
      var NY = Math.max(3, Math.round(h / (Math.max(4, st.grain) * pxPerUm)));
      var cx = [], cy = [], ph = [];
      for (var j = 0; j < NY; j++) {
        for (var i = 0; i < NX; i++) {
          cx.push((i + 0.15 + 0.7 * rnd()) * w / NX);
          cy.push((j + 0.15 + 0.7 * rnd()) * h / NY);
          ph.push(list[Math.floor(rnd() * list.length) % list.length]);
        }
      }
      var decarbPx = Math.min(h * 0.45, st.decarb / (Math.max(4, st.grain) / pxPerUm) * pxPerUm);
      decarbPx = Math.min(h * 0.4, st.decarb * 1000 * pxPerUm * 0.35);

      var ids = new Uint16Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          // 找最近中心（只查 3x3 邻域即可，网格已抖动）
          var gi = Math.min(NX - 1, Math.floor(x / (w / NX)));
          var gj = Math.min(NY - 1, Math.floor(y / (h / NY)));
          var best = 1e18, bi = 0;
          for (var jj = Math.max(0, gj - 1); jj <= Math.min(NY - 1, gj + 1); jj++) {
            for (var ii = Math.max(0, gi - 1); ii <= Math.min(NX - 1, gi + 1); ii++) {
              var id = jj * NX + ii;
              var dx = x - cx[id], dy = y - cy[id];
              var dd = dx * dx + dy * dy;
              if (dd < best) { best = dd; bi = id; }
            }
          }
          ids[y * w + x] = bi;
          var kind = ph[bi];
          // 表层脱碳：顶部带内改为铁素体
          if (y < decarbPx) kind = 'F';
          var col = phaseRGB(kind, lt);
          var shade = 1;
          // 片层纹理：P/S/T 间距依次减小，C 为块状
          if (kind === 'P' || kind === 'S' || kind === 'T') {
            var per = kind === 'P' ? 9 : (kind === 'S' ? 6 : 4);
            shade = 0.84 + 0.26 * (0.5 + 0.5 * Math.sin((x + y * 0.7) * 2 * Math.PI / per));
          } else if (kind === 'B') {
            shade = 0.9 + 0.14 * Math.sin((x * 0.7 - y) * 0.5);
          } else if (kind === 'M') {
            shade = 0.88 + 0.2 * Math.abs(Math.sin((x * 0.9 + y * 1.3) * 0.22));
          }
          var idx = (y * w + x) * 4;
          d[idx] = Math.min(255, col[0] * shade);
          d[idx + 1] = Math.min(255, col[1] * shade);
          d[idx + 2] = Math.min(255, col[2] * shade);
          d[idx + 3] = 255;
        }
      }
      // 描晶界：与右邻或下邻不同属一个晶粒的像素压暗，边界才看得出来
      for (var yy = 0; yy < h - 1; yy++) {
        for (var xx = 0; xx < w - 1; xx++) {
          var p0 = yy * w + xx;
          if (ids[p0] !== ids[p0 + 1] || ids[p0] !== ids[p0 + w]) {
            var q0 = p0 * 4;
            d[q0] *= 0.62; d[q0 + 1] *= 0.66; d[q0 + 2] *= 0.74;
          }
        }
      }
      g2.putImageData(img, 0, 0);
      st._cv = cv; st._key = key; st._cw = w; st._ch = h;
      return cv;
    }

    /* 立方晶胞：fcc / bcc / bct 三种排布 */
    function drawCell(c2, x, y, s, type, lt) {
      var ink = lt ? '#28405e' : '#c9dcf4';
      var dim = lt ? 'rgba(40,70,110,0.45)' : 'rgba(150,185,225,0.45)';
      var atom = lt ? '#2f6fa8' : '#5fb8e8';
      // 等轴测投影
      function pj(px, py, pz) {
        return { x: x + (px - pz) * 0.62 * s, y: y + ((px + pz) * 0.34 - py) * s };
      }
      var V = [];
      for (var i = 0; i < 8; i++) {
        V.push(pj(i & 1, (i >> 1) & 1, (i >> 2) & 1));
      }
      // 棱
      var E = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
      c2.strokeStyle = dim; c2.lineWidth = 1;
      E.forEach(function (e) {
        c2.beginPath();
        c2.moveTo(V[e[0]].x, V[e[0]].y);
        c2.lineTo(V[e[1]].x, V[e[1]].y);
        c2.stroke();
      });
      // 原子位置
      var pos = [];
      [0, 1, 2, 3, 4, 5, 6, 7].forEach(function (k) {
        var c = V[k]; pos.push({ x: c.x, y: c.y, r: 2.6 });
      });
      if (type === 'fcc') {
        [[0, 1, 0.5], [0, 0.5, 1], [1, 1, 0.5], [1, 0.5, 0], [0.5, 0, 1], [0.5, 1, 0], [1, 0.5, 1], [0, 0.5, 0]].slice(0, 6).forEach(function (c) {
          var q = pj(c[0], c[1], c[2]); pos.push({ x: q.x, y: q.y, r: 2.4 });
        });
      } else {
        var ctr = pj(0.5, 0.5, 0.5);
        pos.push({ x: ctr.x, y: ctr.y, r: type === 'bct' ? 3.0 : 2.8 });
      }
      pos.forEach(function (a) {
        c2.beginPath();
        c2.arc(a.x, a.y, a.r, 0, 6.2832);
        c2.fillStyle = atom; c2.fill();
      });
    }

    st.draw = function (c2, W, H, prog) {
      var lt = themeLight();
      c2.clearRect(0, 0, W, H);
      var idx = Math.min(st.time.length - 1, Math.max(0, Math.round(prog * (st.time.length - 1))));
      var tNow = st.time[idx];
      var T = st.sT[idx];

      var ink = lt ? '#1a2c44' : '#dce8f8';
      var dim = lt ? 'rgba(38,64,96,0.62)' : 'rgba(170,195,225,0.62)';
      var line = lt ? 'rgba(30,70,120,0.18)' : 'rgba(140,180,235,0.18)';

      /* ---------- 布局：左侧组织，右上温度曲线，右下晶胞 ---------- */
      var gap = 8;
      var orgW = Math.round(W * 0.585);
      var orgH = H - 2 * gap;
      var orgX = gap, orgY = gap;
      var sideX = orgX + orgW + gap;
      var sideW = W - sideX - gap;
      var cellH = Math.round((H - 3 * gap) * 0.42);
      var curveH = H - 3 * gap - cellH;
      var curveY = gap, cellY = gap + curveH + gap;

      /* ---------- 组织图 ---------- */
      rrect(c2, orgX, orgY, orgW, orgH, 7);
      c2.fillStyle = lt ? '#f2f5f9' : '#0a1220';
      c2.fill();
      c2.save();
      rrect(c2, orgX, orgY, orgW, orgH, 7);
      c2.clip();
      var cw = Math.max(60, Math.round(orgW));
      var ch = Math.max(50, Math.round(orgH));
      // 冷却前是待转变的奥氏体（浅色基体），冷却开始后按进度过渡到终态组织
      var fracNow = st.frac;
      if (!st.isTemper) {
        var tc0 = st.tRamp + st.p.hold;
        if (tNow <= tc0) {
          fracNow = { fM: 0, fB: 0, fP: 0, fS: 0, fT: 0, fPro: 1, fCem: 0 };
        } else {
          var kk2 = clamp((tNow - tc0) / Math.max(1e-6, st.tEnd - tc0), 0, 1);
          fracNow = {
            fM: st.frac.fM * kk2, fB: st.frac.fB * kk2, fP: st.frac.fP * kk2,
            fS: st.frac.fS * kk2, fT: st.frac.fT * kk2, fCem: st.frac.fCem * kk2,
            fPro: st.frac.fPro * kk2 + (1 - kk2)
          };
        }
      }
      var tex = renderOrg(cw, ch, lt, fracNow);
      c2.imageSmoothingEnabled = false;
      c2.drawImage(tex, orgX, orgY, cw, ch);
      c2.imageSmoothingEnabled = true;

      // 脱碳层标注
      var decarbPx = Math.min(ch * 0.4, st.decarb * 1000 * (cw / (6 * Math.max(4, st.grain))) * 0.35);
      if (decarbPx > 3) {
        c2.strokeStyle = lt ? 'rgba(210,120,40,0.85)' : 'rgba(255,179,71,0.9)';
        c2.setLineDash([4, 3]);
        c2.lineWidth = 1.2;
        c2.beginPath();
        c2.moveTo(orgX, orgY + decarbPx);
        c2.lineTo(orgX + orgW, orgY + decarbPx);
        c2.stroke();
        c2.setLineDash([]);
        c2.fillStyle = lt ? '#b96a08' : 'rgba(255,196,120,0.95)';
        c2.font = '10px "Microsoft YaHei", sans-serif';
        c2.textAlign = 'left';
        c2.fillText('脱碳层 ' + st.decarb.toFixed(2) + ' mm', orgX + 6, orgY + Math.max(12, decarbPx - 5));
      }
      // 晶粒尺寸标注
      c2.fillStyle = dim;
      c2.font = '10px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'right';
      c2.fillText('晶粒 ' + st.grain.toFixed(0) + ' μm', orgX + orgW - 6, orgY + orgH - 7);
      c2.restore();
      c2.strokeStyle = line; c2.lineWidth = 1;
      rrect(c2, orgX, orgY, orgW, orgH, 7);
      c2.stroke();

      /* ---------- 温度曲线 ---------- */
      rrect(c2, sideX, curveY, sideW, curveH, 7);
      c2.fillStyle = lt ? '#f7f9fc' : '#080e18';
      c2.fill();
      c2.strokeStyle = line; c2.stroke();

      var padL = 26, padR = 8, padT = 14, padB = 16;
      var px0 = sideX + padL, px1 = sideX + sideW - padR;
      var py0 = curveY + padT, py1 = curveY + curveH - padB;
      var Tmax = Math.max(st.p.Tset * 1.08, 100);
      function tx(t) { return px0 + (px1 - px0) * clamp(t / Math.max(1e-6, st.tEnd), 0, 1); }
      function ty(v) { return py1 - (py1 - py0) * clamp((v - st.T0) / (Tmax - st.T0), 0, 1); }

      // 三段背景
      var xR = tx(st.tRamp), xH = tx(st.tRamp + st.p.hold);
      c2.fillStyle = lt ? 'rgba(255,190,90,0.10)' : 'rgba(255,179,71,0.07)';
      c2.fillRect(px0, py0, xR - px0, py1 - py0);
      c2.fillStyle = lt ? 'rgba(61,190,232,0.10)' : 'rgba(61,219,232,0.07)';
      c2.fillRect(xR, py0, xH - xR, py1 - py0);
      c2.fillStyle = lt ? 'rgba(120,150,200,0.10)' : 'rgba(120,170,235,0.07)';
      c2.fillRect(xH, py0, px1 - xH, py1 - py0);

      // Ac1 / Ac3 参考线
      [[st.Ac1, 'Ac1'], [st.Ac3, 'Ac3']].forEach(function (r) {
        if (r[0] > st.T0 && r[0] < Tmax) {
          c2.strokeStyle = lt ? 'rgba(200,90,60,0.45)' : 'rgba(255,140,110,0.4)';
          c2.setLineDash([3, 3]); c2.lineWidth = 1;
          c2.beginPath(); c2.moveTo(px0, ty(r[0])); c2.lineTo(px1, ty(r[0])); c2.stroke();
          c2.setLineDash([]);
          c2.fillStyle = lt ? 'rgba(176,74,44,0.9)' : 'rgba(255,160,130,0.85)';
          c2.font = '9px "Microsoft YaHei", sans-serif'; c2.textAlign = 'left';
          c2.fillText(r[1], px0 + 2, ty(r[0]) - 2);
        }
      });

      // 温度曲线
      c2.strokeStyle = lt ? '#d1701a' : '#ffb347';
      c2.lineWidth = 1.8;
      c2.beginPath();
      for (var i2 = 0; i2 <= idx; i2++) {
        var xx = tx(st.time[i2]), yy = ty(st.sT[i2]);
        if (i2 === 0) c2.moveTo(xx, yy); else c2.lineTo(xx, yy);
      }
      c2.stroke();
      // 当前点
      c2.beginPath();
      c2.arc(tx(st.time[idx]), ty(st.sT[idx]), 3.2, 0, 6.2832);
      c2.fillStyle = lt ? '#0a7d90' : '#3ddbe8'; c2.fill();

      // 轴标注
      c2.fillStyle = dim; c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'right';
      c2.fillText(Math.round(Tmax) + '℃', px0 - 3, py0 + 4);
      c2.fillText(st.T0 + '℃', px0 - 3, py1);
      c2.textAlign = 'center';
      if (xR - px0 > 28) c2.fillText('升温', (px0 + xR) / 2, py1 + 11);
      if (xH - xR > 28) c2.fillText('保温', (xR + xH) / 2, py1 + 11);
      if (px1 - xH > 28) c2.fillText('冷却', (xH + px1) / 2, py1 + 11);

      /* ---------- 晶体结构 ---------- */
      rrect(c2, sideX, cellY, sideW, cellH, 7);
      c2.fillStyle = lt ? '#f7f9fc' : '#080e18';
      c2.fill();
      c2.strokeStyle = line; c2.stroke();

      var type = 'bcc', label = '铁素体 α-Fe';
      if (st.isTemper) { type = 'bct'; label = '回火马氏体'; }
      else if (T > st.Ac3) { type = 'fcc'; label = '奥氏体 γ-Fe'; }
      else if (st.frac.fM > 0.35 && T < st.Ms + 60) { type = 'bct'; label = '马氏体 α′-Fe'; }
      else if (st.frac.fM > 0.15) { type = 'bct'; label = '马氏体 + 铁素体'; }

      var cx0 = sideX + sideW * 0.5;
      var cy0 = cellY + cellH * 0.46;
      var cs = Math.min(sideW * 0.125, cellH * 0.30);
      drawCell(c2, cx0, cy0, cs, type, lt);

      c2.fillStyle = dim; c2.font = '9.5px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'center';
      c2.fillText(label, sideX + sideW / 2, cellY + cellH - 8);
    };

    return st;
  }

  C.registerModule(HEAT, { buildHeatField: buildHeatField });
})(typeof window !== 'undefined' ? window : globalThis);
