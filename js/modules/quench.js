/* =========================================================================
 *  实验模块 · 碳钢热处理
 *  炉温区 + 奥氏体化 + 一维径向传热 + CCT 转变动力学 + 淬透层
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 *
 *  模型仅用于教学/演示：临界温度、C 曲线与换热系数量级取自公开
 *  文献的典型值，不对应任何具体牌号的实测数据。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var RGAS = C.RGAS, K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight, mulberry32 = C.mulberry32, rrect = C.rrect;

  /* ------------------------------ 介质与炉温区 ------------------------------ */
  /* 四种冷却介质：换热系数 h 与介质温度模型。炉冷用随炉降温的介质温度
     模拟关炉后的缓冷，其余介质恒为室温。 */
  var MEDIA = [
    { key: 'furn', name: '炉冷（退火）', h: 80,    tau: 8000 },
    { key: 'air',  name: '空冷（正火）', h: 120,   tau: 0 },
    { key: 'oil',  name: '油冷（淬火）', h: 4000,  tau: 0 },
    { key: 'aqua', name: '水冷（淬火）', h: 18000, tau: 0 }
  ];
  /* 三个装炉温区：炉门口漏热偏冷且波动大，炉后靠近加热体偏热。
     同一设定温度下，工件实际经历的保温温度不同。 */
  var ZONES = [
    { name: '炉门区', dT: -55, amp: 22, period: 6.5 },
    { name: '均温区', dT: 0,   amp: 3,  period: 6.5 },
    { name: '炉后区', dT: 30,  amp: 8,  period: 6.5 }
  ];
  var KSTEEL = 0.033;      // W/(mm·K)
  var ALPHA = 12.5;        // mm²/s，钢的热扩散率

  function mediumOf(i) { return MEDIA[clamp(Math.round(i), 0, MEDIA.length - 1)]; }
  function zoneOf(i) { return ZONES[clamp(Math.round(i), 0, ZONES.length - 1)]; }

  /* ------------------------------ 临界温度与 C 曲线 ------------------------------ */
  /* Ac1/Ac3/Ms 与 heat 模块同一套经验式；C 曲线为按碳含量插值的教学拟合：
     鼻尖温度、鼻尖时间、宽度三个参数定出 C 形线，转变量沿冷却路径用
     JMAK 叠加积分。CCT 相对 TTT 整体右移（时间 ×1.6）。 */
  function critTemps(Cc) {
    var Ac1 = 727;
    var Ac3 = Cc <= 0.8 ? (912 - 203 * Math.sqrt(Math.max(Cc, 0.01))) : (727 + 400 * (Cc - 0.8));
    var Ms = Cc <= 0.6 ? (539 - 423 * Cc) : Math.max(100, 320 - 260 * (Cc - 0.6));
    return { Ac1: Ac1, Ac3: Ac3, Ms: Ms };
  }

  function tttParams(Cc) {
    return {
      TnP: 600 - 70 * Cc,                                   // 珠光体鼻尖温度
      tNs: 0.5 * Math.exp(2.2 * (1 - Cc / 0.8)) + 0.35,     // 鼻尖开始时间（s）
      Wp: 70, Kp: 1.6,
      BsTop: 505 - 60 * Cc,                                 // 贝氏体上限温度
      TnB: 450 - 40 * Cc,
      tNb: 4 * Math.exp(2.0 * (1 - Cc / 0.8)) + 1.5,
      Wb: 60, Kb: 1.7,
      fP: 3.5, fB: 4.0, cctF: 1.6
    };
  }
  function pStart(P, T) { return P.cctF * P.tNs * Math.exp(P.Kp * Math.pow((T - P.TnP) / P.Wp, 2)); }
  function bStart(P, T) { return P.cctF * P.tNb * Math.exp(P.Kb * Math.pow((T - P.TnB) / P.Wb, 2)); }

  function hvToHrc(hv) { return clamp((hv - 100) / 9.3, 0, 66); }

  /* 由转变量推出各相分数：已转变部分按动力学结果，未转变部分保留原始组织 */
  function keepFracs(Cc, fp, fb, fm) {
    var used = fp + fb + fm;
    var keep = Math.max(0, 1 - used);
    var fF0 = 0, fP0 = 0, fCem = 0;
    if (Cc < 0.8) { fF0 = keep * (0.8 - Cc) / 0.8 * 0.85; fP0 = keep - fF0; }
    else { fCem = keep * Math.min(1, (Cc - 0.8) / 0.4) * 0.35; fP0 = keep - fCem; }
    return { fM: fm, fB: fb, fP: fp + fP0, fS: 0, fT: 0, fF: fF0, fCem: fCem };
  }

  /* ========================================================================== */
  var QUENCH = {
    id: 'quench',
    name: '碳钢热处理',
    tag: 'Carbon Steel',
    subtitle: '20 / 45 / T8 钢的加热、淬火与回火',
    primaryKey: 'HRCs',
    paramDefs: [
      { key: 'C', label: '碳含量', unit: 'wt%', min: 0.05, max: 0.90, step: 0.01, def: 0.45,
        hint: '决定 Ms 点、马氏体硬度与 C 曲线位置。碳越高淬透性越好、淬火越硬' },
      { key: 'Tset', label: '加热温度', unit: '℃', min: 750, max: 950, step: 5, def: 850,
        hint: '应高于 Ac3 并留出 30~50 ℃ 过热裕量。低于 Ac3 则奥氏体化不完全' },
      { key: 'hold', label: '保温时间', unit: 'min', min: 5, max: 180, step: 5, def: 45,
        hint: '保温使奥氏体化趋于完全并均匀化，但晶粒按幂律持续长大' },
      { key: 'zone', label: '装炉位置', unit: '', min: 0, max: 2, step: 1, def: 1,
        hint: '0 炉门区（漏热偏冷、波动大）、1 均温区、2 炉后区（靠近加热体偏热）' },
      { key: 'medium', label: '冷却介质', unit: '', min: 0, max: 3, step: 1, def: 3,
        hint: '0 炉冷 ≈ 退火、1 空冷 ≈ 正火、2 油冷、3 水冷。介质决定表面换热强度' },
      { key: 'dia', label: '工件直径', unit: 'mm', min: 10, max: 100, step: 1, def: 25,
        hint: '直径越大，心部冷速越低，淬硬层越浅——这就是淬透性问题' },
      { key: 'temperT', label: '回火温度', unit: '℃', min: 0, max: 650, step: 5, def: 0,
        hint: '0 = 不回火。150~250 低温回火保硬；500~650 高温回火得回火索氏体（调质）。回火时间固定 60 min' }
    ],
    variants: [
      { id: 's20', name: '20 钢（C≈0.20，渗碳型）', defC: 0.20, defT: 890, hue: 210,
        formula: 'Fe + 少量珠光体',
        note: '低碳钢，淬透性差。水淬也只能得到表层低碳马氏体，心部仍保持韧态，适合做渗碳件的芯材' },
      { id: 's45', name: '45 钢（C≈0.45，调质型）', defC: 0.45, defT: 850, hue: 32,
        formula: 'Fe + 珠光体（约 55%）',
        note: '中碳钢代表。调质（淬火 + 高温回火）后强韧匹配，是轴类零件的主力工艺' },
      { id: 't8', name: 'T8 钢（C≈0.80，共析工具钢）', defC: 0.80, defT: 790, hue: 280,
        formula: '共析珠光体',
        note: '共析成分，淬透性三者中最好。水淬可得高硬度马氏体，但淬火应力大、易开裂' }
    ],
    /* 左轴：奥氏体化程度与马氏体含量（%）；右轴：表面/心部温度（℃） */
    seriesDefs: [
      { key: 'T', name: '表面温度', unit: '℃', color: '#ffb347', axis: 'right', primary: true },
      { key: 'Tc', name: '心部温度', unit: '℃', color: '#e879a9', axis: 'right' },
      { key: 'aust', name: '奥氏体化程度', unit: '%', color: '#3ddbe8', axis: 'left' },
      { key: 'fM', name: '表面马氏体', unit: '%', color: '#a78bfa', axis: 'left' }
    ],
    outputDefs: [
      { key: 'HRCs', label: '表面硬度', unit: 'HRC', digits: 1, primary: true },
      { key: 'HRCc', label: '心部硬度', unit: 'HRC', digits: 1 },
      { key: 'caseDepth', label: '淬硬层深度', unit: 'mm', digits: 1 },
      { key: 'Rm', label: '抗拉强度', unit: 'MPa', digits: 0 },
      { key: 'austF', label: '奥氏体化程度', unit: '%', digits: 0 },
      { key: 'grain', label: '晶粒尺寸', unit: 'μm', digits: 0 },
      { key: 'fM', label: '表面马氏体', unit: '%', digits: 0 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'HRCs', label: '表面硬度最高', dir: 'max' },
      { key: 'caseDepth', label: '淬硬层最深', dir: 'max' },
      { key: 'HRCc', label: '心部硬度最高', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'through', label: '心部 HRC ≥ 35（淬透）', test: function (m) { return m.HRCc >= 35; } },
      { id: 'hard', label: '表面 HRC ≥ 50', test: function (m) { return m.HRCs >= 50; } },
      { id: 'full', label: '奥氏体化 ≥ 95%', test: function (m) { return m.austF >= 95; } }
    ],
    notes: [
      '临界温度：Ac1 取 727 ℃，Ac3 = 912 − 203√C，Ms 由碳含量线性插值。',
      'C 曲线（TTT）按碳含量拟合出珠光体与贝氏体两个 C 形区；连续冷却（CCT）曲线整体右移 1.6 倍时间。',
      '工件径向温度用一维柱坐标显式差分求解，表面换热系数：炉冷 80、空冷 300、油冷 4000、水冷 18000 W/(m²·K)。',
      '转变动力学：温度高于贝氏体上限只发生珠光体转变，Ms 点以下按 Koistinen–Marburger 方程生成马氏体。',
      '马氏体硬度 ≈ 250 + 800·C (HV)；抗拉强度按 Rm ≈ 3.45·HV 估算。',
      '淬硬层深度取硬度降到（表面 + 心部）/2 处的半径，即半马氏体区的工程定义。',
      '炉温区影响：炉门区漏热约 −55 ℃ 且波动 ±22 ℃，炉后区约 +30 ℃，奥氏体化按工件实际温度积分。',
      '水冷忽略蒸汽膜阶段（沸腾换热），回火软化按温度区间与保温时间指数推进。'
    ]
  };

  /* ================================ 求解 ================================ */
  QUENCH.simulate = function (p, v, opts) {
    var fast = !!(opts && opts.fast);
    var T0 = 25;
    /* 升温速率固定 8 ℃/min、回火时间固定 60 min：两者对结论影响弱，
       保留会让寻优的粗网格达到 4^9，计算量不可接受。 */
    var Cc = p.C, Tset = p.Tset, hold = p.hold, ramp = 8, temperH = 60;
    var dia = p.dia, R = dia / 2;
    var med = mediumOf(p.medium), zone = zoneOf(p.zone);
    var ct = critTemps(Cc), P = tttParams(Cc);
    var Ac1 = ct.Ac1, Ac3 = ct.Ac3, Ms = ct.Ms;
    var BsTop = P.BsTop;
    var temperOn = p.temperT > 0;

    /* ---------- 加热段：炉温程序 + 温区偏移 + 工件热惯性 ---------- */
    var tRamp = (Tset - T0) / ramp;
    var tHoldEnd = tRamp + hold;
    var tauH = 1.5 + dia / 22;                       // 工件升温时间常数（min）
    var HS = fast ? 200 : 800;                       // 加热段子步数
    var hTime = [], hTs = [], hTloc = [], hAust = [];
    var aNow = 0, g2 = 100, hRec = Math.max(1, Math.floor(HS / 60));
    var prevAll = T0;                                 // 每子步更新的工件温度
    var dtH = tHoldEnd / HS;
    for (var i = 0; i <= HS; i++) {
      var th = tHoldEnd * i / HS;
      var Tprog = T0 + Math.min(ramp * th, Tset - T0);
      var Tloc = Tprog + zone.dT + zone.amp * Math.sin(2 * Math.PI * th / zone.period);
      var Ts = Tloc + (prevAll - Tloc) * Math.exp(-dtH / tauH);
      prevAll = Ts;
      if (Ts > Ac1) {
        var eq = clamp((Ts - Ac1) / Math.max(1, Ac3 - Ac1), 0, 1);
        aNow += (eq - aNow) * (1 - Math.exp(-dtH / 8));
        g2 += aNow * (1.03e9 / (1 + 6 * Cc)) * Math.exp(-150000 / (RGAS * (Ts + K0))) * dtH;
      }
      if (i % hRec === 0 || i === HS) {
        hTime.push(th); hTloc.push(Tloc); hTs.push(Ts);
        hAust.push(Ts > Ac1 ? aNow * 100 : 0);
      }
    }
    var austF = clamp(aNow, 0, 1);
    var grain = Math.sqrt(g2);
    var Tcool0 = hTs[hTs.length - 1];                // 出炉温度（长时间保温近似均匀）

    /* ---------- 冷却段：一维径向显式差分 + 沿程转变积分 ---------- */
    /* 节点数随直径调整，让步长与总时长解耦：小工件节点少、步长大。 */
    var NR = clamp(Math.round(R / (fast ? 10 : 3)) + 1, fast ? 4 : 5, fast ? 11 : 21);
    var dr = R / (NR - 1);
    var hWmm = med.h / 1e6;                          // W/(m²·K) → W/(mm²·K)
    var Bi = hWmm * dr / KSTEEL;
    var dtS = 0.12 * dr * dr / (ALPHA * (1 + Bi));   // 稳定性限制的步长（s）
    var cap = fast ? 300000 : 1500000;
    var Tstop = 110;
    var Tr = new Float64Array(NR);
    for (i = 0; i < NR; i++) Tr[i] = Tcool0;
    var fP = new Float64Array(NR), fB = new Float64Array(NR), fM = new Float64Array(NR);
    var A0 = austF;                                  // 可转变的奥氏体总量
    var nP = 2.2, nB = 1.6;
    var KIN_EVERY = 4;                               // 每 4 步积一次动力学，省时且精度足够

    var coolT = [0], coolSurf = [Tr[NR - 1]], coolCore = [Tr[0]];
    var histF = [];
    for (i = 0; i < NR; i++) histF.push({ fP: [0], fB: [0], fM: [0] });
    var nextSample = 30, tS = 0, steps = 0, tMaxNow = Tcool0;

    function record() {
      coolT.push(tS);
      coolSurf.push(Tr[NR - 1]); coolCore.push(Tr[0]);
      for (var k = 0; k < NR; k++) {
        histF[k].fP.push(fP[k]); histF[k].fB.push(fB[k]); histF[k].fM.push(fM[k]);
      }
      nextSample = tS + Math.max(dtS * 8, 30);
    }

    while (steps < cap && tMaxNow > Tstop) {
      var Tmed = med.tau > 0 ? T0 + (Tcool0 - T0) * Math.exp(-tS / med.tau) : T0;
      for (i = 1; i < NR - 1; i++) {
        var ri = i * dr;
        Tr[i] += ALPHA * dtS * ((Tr[i + 1] - 2 * Tr[i] + Tr[i - 1]) / (dr * dr) +
          (Tr[i + 1] - Tr[i - 1]) / (2 * ri * dr));
      }
      Tr[0] += 4 * ALPHA * dtS * (Tr[1] - Tr[0]) / (dr * dr);   // 中心轴对称极限
      Tr[NR - 1] += ALPHA * dtS * (2 * (Tr[NR - 2] - Tr[NR - 1]) / (dr * dr) -
        2 * hWmm * (Tr[NR - 1] - Tmed) / (KSTEEL * dr));        // 表面对流边界
      tS += dtS; steps++;

      if (steps % KIN_EVERY === 0 && A0 > 0.001) {
        var dtK = dtS * KIN_EVERY;
        for (i = 0; i < NR; i++) {
          var T = Tr[i];
          if (T >= Ac1) continue;
          if (T >= BsTop) {
            // 珠光体区：JMAK 增量（相对可转变量 A0 的分数），
            // 分数下限 1e-3 用来跨过 f=0 处的速率奇点（孵化期）
            if (A0 - fP[i] - fB[i] <= 0.001) continue;
            var ts = pStart(P, T);
            if (!isFinite(ts) || ts <= 1e-3) continue;
            var kP = Math.pow(-Math.log(0.99), 1 / nP) / ts;
            var xP = Math.max(fP[i] / A0, 1e-3);
            var dP = nP * kP * Math.pow(-Math.log(1 - xP), (nP - 1) / nP) * (1 - xP) * dtK;
            fP[i] = Math.min(A0 - fB[i], fP[i] + Math.max(0, dP));
          } else if (T > Ms) {
            // 贝氏体区
            if (A0 - fP[i] - fB[i] <= 0.001) continue;
            var tb = bStart(P, T);
            if (!isFinite(tb) || tb <= 1e-3) continue;
            var kB = Math.pow(-Math.log(0.99), 1 / nB) / tb;
            var xB = Math.max(fB[i] / A0, 1e-3);
            var dB = nB * kB * Math.pow(-Math.log(1 - xB), (nB - 1) / nB) * (1 - xB) * dtK;
            fB[i] = Math.min(A0, fB[i] + Math.max(0, dB));
          }
          // 马氏体：Ms 以下按 Koistinen–Marburger 解析式，单调冷却直接赋值
          if (T < Ms) {
            var rem = Math.max(0, A0 - fP[i] - fB[i]);
            fM[i] = rem * (1 - Math.exp(-0.011 * (Ms - T)));
          }
        }
      }
      tMaxNow = Tr[0];
      for (i = 1; i < NR; i++) if (Tr[i] > tMaxNow) tMaxNow = Tr[i];
      if (tS >= nextSample) record();
    }
    if (coolT[coolT.length - 1] < tS - 1e-9) record();
    var tCool = tS;
    var tEnd = tHoldEnd + tCool / 60;

    /* ---------- 终态：各节点组织与硬度 ---------- */
    var HV_M = 250 + 800 * Cc;
    var rNodes = [], hvR = [], hrcR = [], fracR = [];
    for (i = 0; i < NR; i++) rNodes.push(i * dr);
    function nodeFrac(k) { return keepFracs(Cc, fP[k], fB[k], fM[k]); }
    for (i = 0; i < NR; i++) {
      var fr = nodeFrac(i);
      fracR.push(fr);
      hvR.push(fr.fM * HV_M + fr.fB * 420 + fr.fP * 205 + fr.fF * 90 + fr.fCem * 550);
      hrcR.push(hvToHrc(hvR[i]));
    }
    /* 回火：软化只作用于马氏体/贝氏体，铁素体-珠光体基体几乎不变 */
    var soften = 0;
    if (temperOn) {
      soften = clamp((p.temperT - 150) / 500, 0, 1) * (1 - Math.exp(-temperH / 40));
      for (i = 0; i < NR; i++) {
        var fr2 = fracR[i];
        var hardPart = (fr2.fM * HV_M + fr2.fB * 420) * (1 - 0.62 * soften);
        var softBase = fr2.fP * 205 + fr2.fF * 90 + fr2.fCem * 550;
        hvR[i] = hardPart + softBase;
        hrcR[i] = hvToHrc(hvR[i]);
      }
    }

    /* ---------- 指标 ---------- */
    var HRCs = hrcR[NR - 1], HRCc = hrcR[0];
    var caseDepth = 0;
    if (hvR[NR - 1] > hvR[0]) {
      var half = (hvR[NR - 1] + hvR[0]) / 2;
      if (hvR[0] >= half) caseDepth = R;
      else {
        for (i = NR - 1; i > 0; i--) {
          if (hvR[i] >= half && hvR[i - 1] < half) {
            var w = (hvR[i] - half) / Math.max(1e-6, hvR[i] - hvR[i - 1]);
            caseDepth = rNodes[i] - w * dr;
            break;
          }
        }
      }
    }
    var Rm = Math.round(3.45 * hvR[NR - 1]);
    var fMsurf = fM[NR - 1] * 100;
    var score = 100 * (0.45 * clamp(HRCs / 58, 0, 1) +
      0.25 * clamp(caseDepth / Math.max(1, 0.6 * R), 0, 1) +
      0.20 * austF +
      0.10 * clamp(Rm / 2000, 0, 1));

    /* ---------- 时间轴与过程曲线 ---------- */
    var NP = fast ? 26 : 96;
    var time = [], sT = [], sTc = [], sAust = [], sFm = [], sHRC = [];
    var nCoolS = coolT.length, hN = hTime.length;
    /* 表面硬度序列（HUD 游标用）：加热段为退火态基线，冷却段按表面节点相分数推算 */
    function hvOfFrac(fr, so) {
      return (fr.fM * HV_M + fr.fB * 420) * (1 - 0.62 * so) + fr.fP * 205 + fr.fF * 90 + fr.fCem * 550;
    }
    var baseHRC = hvToHrc(hvOfFrac(keepFracs(Cc, 0, 0, 0), 0));
    for (i = 0; i < NP; i++) {
      var tt = tEnd * i / (NP - 1);
      time.push(tt);
      if (tt <= tHoldEnd) {
        var idxH = Math.min(hN - 1, Math.max(0, Math.round(tt / Math.max(1e-6, tHoldEnd) * (hN - 1))));
        sT.push(hTs[idxH]); sTc.push(hTs[idxH]);
        sAust.push(hAust[idxH]); sFm.push(0);
        sHRC.push(baseHRC);
      } else {
        var tc = (tt - tHoldEnd) * 60;
        var idxC = Math.min(nCoolS - 1, Math.max(0, Math.round(tc / Math.max(1e-6, coolT[nCoolS - 1]) * (nCoolS - 1))));
        sT.push(coolSurf[idxC]); sTc.push(coolCore[idxC]);
        sAust.push(100 * austF);
        sFm.push(histF[NR - 1].fM[idxC] * 100);
        var hfS = histF[NR - 1];
        sHRC.push(hvToHrc(hvOfFrac(keepFracs(Cc, hfS.fP[idxC], hfS.fB[idxC], hfS.fM[idxC]), soften)));
      }
    }

    var metrics = {
      HRCs: HRCs, HRCc: HRCc, caseDepth: caseDepth, Rm: Rm,
      austF: austF * 100, grain: grain, fM: fMsurf, score: score
    };

    var field = null;
    if (!fast) {
      field = buildQuenchField({
        p: p, v: v, time: time, sT: sT, sTc: sTc,
        hTime: hTime, hTs: hTs, hTloc: hTloc,
        coolT: coolT, coolSurf: coolSurf, coolCore: coolCore,
        histF: histF, NR: NR, rNodes: rNodes, dr: dr,
        fracR: fracR, caseDepth: caseDepth,
        Ac1: Ac1, Ac3: Ac3, Ms: Ms, BsTop: BsTop, P: P,
        T0: T0, Tcool0: Tcool0, tRamp: tRamp, tHoldEnd: tHoldEnd, tEnd: tEnd, tCool: tCool,
        austF: austF, grain: grain, zone: zone, med: med,
        dia: dia, R: R
      });
    }

    return {
      time: time,
      series: { T: sT, Tc: sTc, aust: sAust, fM: sFm, HRCs: sHRC },
      metrics: metrics,
      field: field,
      extra: {
        Ac1: Ac1, Ac3: Ac3, Ms: Ms, BsTop: BsTop, P: P,
        tRamp: tRamp, tHoldEnd: tHoldEnd, tEnd: tEnd, tCool: tCool,
        austF: austF, grain: grain, caseDepth: caseDepth,
        HRCs: HRCs, HRCc: HRCc,
        fracS: fracR[NR - 1], fracC: fracR[0], rNodes: rNodes, hrcR: hrcR,
        zoneName: zone.name, zoneOff: zone.dT, medName: med.name,
        temperOn: temperOn, temperT: p.temperT, soften: soften
      }
    };
  };

  /* ================================ 可视化 ================================ */
  function buildQuenchField(st) {
    var P = st.P;

    /* 相配色（与 heat 模块同源） */
    function phaseRGB(kind, lt) {
      if (kind === 'F') return lt ? [214, 222, 232] : [92, 108, 128];
      if (kind === 'P') return lt ? [176, 186, 202] : [70, 84, 104];
      if (kind === 'B') return lt ? [150, 158, 180] : [58, 68, 92];
      if (kind === 'M') return lt ? [108, 118, 146] : [38, 44, 66];
      if (kind === 'C') return lt ? [232, 226, 208] : [122, 116, 98];
      return lt ? [200, 208, 220] : [80, 92, 110];
    }
    function pickPhase(fr, rnd) {
      var acc = 0;
      var defs = [['M', fr.fM], ['B', fr.fB], ['P', fr.fP], ['C', fr.fCem], ['F', fr.fF]];
      for (var i = 0; i < defs.length; i++) {
        acc += defs[i][1];
        if (rnd <= acc) return defs[i][0];
      }
      return 'F';
    }

    /* 截面金相纹理：像素按半径归到节点，节点相分数决定该带的相分布 */
    var _tex = { cv: null, key: '' };
    function renderSection(S, lt, fracsNow) {
      var parts = [st.p.C, st.p.dia, st.grain.toFixed(0), st.austF.toFixed(2), lt ? 1 : 0, S];
      for (var k = 0; k < st.NR; k++) {
        var f = fracsNow[k];
        parts.push(Math.round(f.fM * 8), Math.round(f.fB * 8), Math.round(f.fP * 8), Math.round(f.fF * 8), Math.round(f.fCem * 8));
      }
      var key = parts.join('|');
      if (_tex.key === key && _tex.cv) return _tex.cv;

      var cv = _tex.cv || document.createElement('canvas');
      cv.width = S; cv.height = S;
      var g2 = cv.getContext('2d');
      var img = g2.createImageData(S, S);
      var d = img.data;
      var cx = S / 2, cy = S / 2, Rp = S * 0.46;
      var rnd = mulberry32(20261105);
      var NG = 10;                                   // 直径方向约 10 个晶粒（示意）
      var gc = [];
      for (var j = 0; j < NG; j++) {
        for (var i = 0; i < NG; i++) {
          gc.push({ x: (i + 0.12 + 0.76 * rnd()) * S / NG, y: (j + 0.12 + 0.76 * rnd()) * S / NG });
        }
      }
      var ids = new Uint16Array(S * S);
      for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
          var idx = y * S + x;
          var dxp = x - cx, dyp = y - cy;
          var rpx = Math.sqrt(dxp * dxp + dyp * dyp);
          if (rpx > Rp) { ids[idx] = 65535; d[idx * 4 + 3] = 0; continue; }
          var nodeF = rpx / Rp * (st.NR - 1);
          var n0 = Math.min(st.NR - 1, Math.floor(nodeF));
          var w1 = nodeF - n0, n1 = Math.min(st.NR - 1, n0 + 1);
          var gi = Math.min(NG - 1, Math.floor(x / (S / NG))), gj = Math.min(NG - 1, Math.floor(y / (S / NG)));
          var best = 1e18, bi = 0;
          for (var jj = Math.max(0, gj - 1); jj <= Math.min(NG - 1, gj + 1); jj++) {
            for (var ii = Math.max(0, gi - 1); ii <= Math.min(NG - 1, gi + 1); ii++) {
              var id2 = jj * NG + ii;
              var ddx = x - gc[id2].x, ddy = y - gc[id2].y;
              var dd = ddx * ddx + ddy * ddy;
              if (dd < best) { best = dd; bi = id2; }
            }
          }
          ids[idx] = bi;
          // 同一晶粒在每个节点带有固定散列，跨节点带自然错开
          var seed = ((bi * 613 + 7) % 1000) / 1000;
          var mixRnd = ((bi * 97 + Math.floor(nodeF * 13)) % 1000) / 1000;
          var fr = fracsNow[mixRnd < w1 ? n1 : n0];
          var kind = pickPhase(fr, seed);
          var col = phaseRGB(kind, lt);
          var shade = 1;
          if (kind === 'P') shade = 0.84 + 0.26 * (0.5 + 0.5 * Math.sin((x + y * 0.7) * 2 * Math.PI / 9));
          else if (kind === 'B') shade = 0.9 + 0.14 * Math.sin((x * 0.7 - y) * 0.5);
          else if (kind === 'M') shade = 0.88 + 0.2 * Math.abs(Math.sin((x * 0.9 + y * 1.3) * 0.22));
          var q = idx * 4;
          d[q] = Math.min(255, col[0] * shade);
          d[q + 1] = Math.min(255, col[1] * shade);
          d[q + 2] = Math.min(255, col[2] * shade);
          d[q + 3] = 255;
        }
      }
      // 晶界压暗 + 节点过渡环带
      for (var yy = 0; yy < S - 1; yy++) {
        for (var xx = 0; xx < S - 1; xx++) {
          var p0 = yy * S + xx;
          if (ids[p0] === 65535) continue;
          var q0 = p0 * 4;
          if (ids[p0] !== ids[p0 + 1] || ids[p0] !== ids[p0 + S]) {
            d[q0] *= 0.62; d[q0 + 1] *= 0.66; d[q0 + 2] *= 0.74;
          }
          var rA = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy));
          var rB = Math.sqrt((xx + 1 - cx) * (xx + 1 - cx) + (yy + 1 - cy) * (yy + 1 - cy));
          if (Math.floor(rA / Rp * (st.NR - 1)) !== Math.floor(rB / Rp * (st.NR - 1))) {
            d[q0] *= 0.8; d[q0 + 1] *= 0.8; d[q0 + 2] *= 0.82;
          }
        }
      }
      g2.putImageData(img, 0, 0);
      _tex.cv = cv; _tex.key = key;
      return cv;
    }

    /* 采样时刻的各节点组织（动画插值用） */
    function fracsAt(coolIdx) {
      var out = [];
      for (var k = 0; k < st.NR; k++) {
        var hf = st.histF[k];
        var i2 = Math.min(hf.fP.length - 1, Math.max(0, coolIdx));
        var fp = hf.fP[i2], fb = hf.fB[i2], fm = hf.fM[i2];
        var used = fp + fb + fm, keep = Math.max(0, 1 - used);
        var Cc = st.p.C, fF0 = 0, fP0 = 0, fCem = 0;
        if (Cc < 0.8) { fF0 = keep * (0.8 - Cc) / 0.8 * 0.85; fP0 = keep - fF0; }
        else { fCem = keep * Math.min(1, (Cc - 0.8) / 0.4) * 0.35; fP0 = keep - fCem; }
        out.push({ fM: fm, fB: fb, fP: fp + fP0, fF: fF0, fCem: fCem });
      }
      return out;
    }

    st.draw = function (c2, W, H, prog) {
      var lt = themeLight();
      c2.clearRect(0, 0, W, H);
      var nCoolS = st.coolT.length;
      var coolLen = st.coolT[nCoolS - 1];
      var idx = Math.min(st.time.length - 1, Math.max(0, Math.round(prog * (st.time.length - 1))));
      var tNow = st.time[idx];
      var inCool = tNow > st.tHoldEnd;
      var coolProg = inCool ? clamp((tNow - st.tHoldEnd) * 60 / Math.max(1e-6, coolLen), 0, 1) : 0;
      var coolIdx = Math.min(nCoolS - 1, Math.max(0, Math.round(coolProg * (nCoolS - 1))));

      var dim = lt ? 'rgba(38,64,96,0.62)' : 'rgba(170,195,225,0.62)';
      var line = lt ? 'rgba(30,70,120,0.18)' : 'rgba(140,180,235,0.18)';

      /* 宽屏左右排布；窄屏将 CCT 图放到整行，保留温度和炉膛示意。 */
      var gap = 8;
      var stacked = W < 620 && H >= 460;
      var secW = stacked ? W - 2 * gap : Math.round(W * 0.46);
      var secH = stacked ? Math.round(H * 0.34) : H - 2 * gap;
      var cctX = stacked ? gap : gap + secW + gap;
      var cctY = stacked ? gap + secH + gap : gap;
      var cctW = W - cctX - gap;
      var cctH = Math.round((H - cctY - 2 * gap) * (stacked ? 0.62 : 0.52));
      var botY = cctY + cctH + gap;
      var botH = H - botY - gap;
      var curveW = Math.round(cctW * 0.58);
      var furnX = cctX + curveW + gap, furnW = cctW - curveW - gap;
      /* ---------- 左侧：截面金相图 ---------- */
      rrect(c2, gap, gap, secW, secH, 7);
      c2.fillStyle = lt ? '#edf6f2' : '#13241d';
      c2.fill();
      c2.save();
      rrect(c2, gap, gap, secW, secH, 7);
      c2.clip();
      var tex = renderSection(300, lt, fracsAt(coolIdx));
      var side = Math.min(secW, secH) - 12;
      c2.imageSmoothingEnabled = false;
      c2.drawImage(tex, gap + (secW - side) / 2, gap + (secH - side) / 2, side, side);
      c2.imageSmoothingEnabled = true;

      var ccx = gap + secW / 2, ccy = gap + secH / 2, Rp = side / 2;
      if (st.caseDepth > 0.5 && st.caseDepth < st.R - 0.5) {
        c2.strokeStyle = lt ? 'rgba(210,120,40,0.85)' : 'rgba(255,179,71,0.9)';
        c2.setLineDash([4, 3]); c2.lineWidth = 1.2;
        c2.beginPath();
        c2.arc(ccx, ccy, Rp * st.caseDepth / st.R, 0, 6.2832);
        c2.stroke();
        c2.setLineDash([]);
        c2.fillStyle = lt ? '#b96a08' : 'rgba(255,196,120,0.95)';
        c2.font = '10px "Microsoft YaHei", sans-serif';
        c2.textAlign = 'left';
        c2.fillText('淬硬层 ' + st.caseDepth.toFixed(1) + ' mm', gap + 8, gap + 16);
      }
      c2.fillStyle = dim;
      c2.font = '10px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'right';
      c2.fillText('表面', ccx + Rp - 14, ccy - Rp + 14);
      c2.textAlign = 'center';
      c2.fillText('心部', ccx, ccy + 3);
      c2.textAlign = 'right';
      c2.fillText('φ' + st.dia + ' mm · 晶粒 ' + st.grain.toFixed(0) + ' μm', gap + secW - 8, gap + secH - 8);
      c2.restore();
      c2.strokeStyle = line; c2.lineWidth = 1;
      rrect(c2, gap, gap, secW, secH, 7);
      c2.stroke();

      /* ---------- 右上：CCT 图 + 冷却曲线 ---------- */
      rrect(c2, cctX, cctY, cctW, cctH, 7);
      c2.fillStyle = lt ? '#f5faf7' : '#101e19';
      c2.fill();
      c2.strokeStyle = line; c2.stroke();

      var padL = 30, padR = 8, padT = 25, padB = 27;
      var px0 = cctX + padL, px1 = cctX + cctW - padR;
      var py0 = cctY + padT, py1 = cctY + cctH - padB;
      c2.fillStyle = lt ? '#315d51' : '#a5c3b5';
      c2.font = '11px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'left';
      c2.fillText('CCT · 连续冷却', cctX + 8, cctY + 15);
      if (cctW >= 200) {
        c2.textAlign = 'right';
        c2.fillStyle = lt ? '#a6500b' : '#ffb347';
        c2.fillText('表面', px1 - 36, cctY + 15);
        c2.fillStyle = lt ? '#ac3e74' : '#f093be';
        c2.fillText('心部', px1, cctY + 15);
      }
      var tMaxLog = 4.6, Ttop = 900, Tbot = 100;
      function lxt(ts) { return px0 + (px1 - px0) * clamp(Math.log10(Math.max(0.1, ts)) / tMaxLog, 0, 1); }
      function tyv(T) { return py1 - (py1 - py0) * clamp((T - Tbot) / (Ttop - Tbot), 0, 1); }

      // 转变区填充：珠光体（琥珀）与贝氏体（紫），马氏体在 Ms 以下
      function shadeRegion(startFn, mult, TtopR, TbotR, fill) {
        c2.beginPath();
        var T, first = true;
        for (T = TtopR; T >= TbotR; T -= 6) {
          var x = lxt(startFn(P, T) * mult);
          if (first) { c2.moveTo(x, tyv(T)); first = false; } else c2.lineTo(x, tyv(T));
        }
        for (T = TbotR; T <= TtopR; T += 6) c2.lineTo(lxt(startFn(P, T)), tyv(T));
        c2.closePath();
        c2.fillStyle = fill;
        c2.fill();
      }
      var pTop = Math.min(st.Ac1 - 5, P.TnP + 150);
      var pBot = Math.max(st.BsTop + 8, P.TnP - 120);
      shadeRegion(pStart, 3.5, pTop, pBot, lt ? 'rgba(224,148,52,0.16)' : 'rgba(255,179,71,0.12)');
      shadeRegion(bStart, 4.0, st.BsTop, st.Ms + 12, lt ? 'rgba(139,109,232,0.16)' : 'rgba(167,139,250,0.12)');
      c2.fillStyle = lt ? 'rgba(200,80,80,0.10)' : 'rgba(248,113,113,0.08)';
      c2.fillRect(px0, tyv(st.Ms), px1 - px0, py1 - tyv(st.Ms));

      // 开始（实线）与终了（虚线）曲线
      function curvePair(startFn, fMult, Tlo, Thi, style) {
        [1, fMult].forEach(function (mult, mi) {
          c2.strokeStyle = style; c2.lineWidth = 1;
          c2.setLineDash(mi === 1 ? [3, 3] : []);
          c2.beginPath();
          var first = true;
          for (var T = Thi; T >= Tlo; T -= 6) {
            var x = lxt(startFn(P, T) * mult), y = tyv(T);
            if (first) { c2.moveTo(x, y); first = false; } else c2.lineTo(x, y);
          }
          c2.stroke();
          c2.setLineDash([]);
        });
      }
      var inkP = lt ? 'rgba(196,118,20,0.8)' : 'rgba(255,179,71,0.7)';
      var inkB = lt ? 'rgba(109,80,205,0.8)' : 'rgba(167,139,250,0.7)';
      curvePair(pStart, P.fP, pBot, pTop, inkP);
      curvePair(bStart, P.fB, st.Ms + 12, st.BsTop, inkB);

      // Ac1 / Ms 参考线
      [[st.Ac1, 'Ac1', lt ? 'rgba(200,90,60,0.5)' : 'rgba(255,140,110,0.45)'],
       [st.Ms, 'Ms', lt ? 'rgba(190,60,60,0.7)' : 'rgba(248,113,113,0.6)']].forEach(function (r) {
        if (r[0] > Tbot && r[0] < Ttop) {
          c2.strokeStyle = r[2]; c2.setLineDash([3, 3]); c2.lineWidth = 1;
          c2.beginPath(); c2.moveTo(px0, tyv(r[0])); c2.lineTo(px1, tyv(r[0])); c2.stroke();
          c2.setLineDash([]);
          c2.fillStyle = r[2]; c2.font = '9px "Microsoft YaHei", sans-serif';
          c2.textAlign = 'left';
          c2.fillText(r[1], px0 + 2, tyv(r[0]) - 2);
        }
      });
      // 轴
      c2.fillStyle = dim; c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'center';
      ['1', '10', '100', '1k', '10k'].forEach(function (lb, lg) {
        c2.fillText(lb, lxt(Math.pow(10, lg)), py1 + 11);
      });
      c2.textAlign = 'right';
      c2.fillText('900℃', px0 - 3, py0 + 4);
      c2.fillText('100℃', px0 - 3, py1);
      c2.textAlign = 'left';
      c2.fillText('时间 (s)', px1 - 36, py1 + 23);

      // 冷却曲线：表面与心部（进入冷却段后才出现）
      if (inCool && coolLen > 0) {
        [['coolSurf', lt ? '#d1701a' : '#ffb347'], ['coolCore', '#e879a9']].forEach(function (cfg) {
          var arr = st[cfg[0]];
          c2.strokeStyle = cfg[1]; c2.lineWidth = 1.7;
          c2.beginPath();
          var lim = Math.max(1, Math.round(coolProg * (arr.length - 1)));
          c2.moveTo(lxt(0.1), tyv(st.Tcool0));
          var lastX = 0, lastY = 0;
          for (var i2 = 1; i2 <= lim; i2++) {
            var x = lxt(st.coolT[i2]), y = tyv(arr[i2]);
            c2.lineTo(x, y);
            lastX = x; lastY = y;
          }
          c2.stroke();
          c2.beginPath(); c2.arc(lastX, lastY, 3, 0, 6.2832);
          c2.fillStyle = cfg[1]; c2.fill();
        });
      }

      /* ---------- 右下左：温度-时间曲线（含炉温程序线） ---------- */
      rrect(c2, cctX, botY, curveW, botH, 7);
      c2.fillStyle = lt ? '#f5faf7' : '#101e19';
      c2.fill();
      c2.strokeStyle = line; c2.stroke();
      var qL = 26, qR = 6, qT = 12, qB = 16;
      var qx0 = cctX + qL, qx1 = cctX + curveW - qR;
      var qy0 = botY + qT, qy1 = botY + botH - qB;
      var Tmax = Math.max(st.p.Tset * 1.08, 100);
      function qx(t) { return qx0 + (qx1 - qx0) * clamp(t / Math.max(1e-6, st.tEnd), 0, 1); }
      function qy(T) { return qy1 - (qy1 - qy0) * clamp((T - st.T0) / (Tmax - st.T0), 0, 1); }
      var xr = qx(st.tRamp), xh = qx(st.tHoldEnd);
      c2.fillStyle = lt ? 'rgba(255,190,90,0.10)' : 'rgba(255,179,71,0.07)';
      c2.fillRect(qx0, qy0, xr - qx0, qy1 - qy0);
      c2.fillStyle = lt ? 'rgba(61,190,232,0.10)' : 'rgba(61,219,232,0.07)';
      c2.fillRect(xr, qy0, xh - xr, qy1 - qy0);
      c2.fillStyle = lt ? 'rgba(120,150,200,0.10)' : 'rgba(120,170,235,0.07)';
      c2.fillRect(xh, qy0, qx1 - xh, qy1 - qy0);
      c2.strokeStyle = lt ? 'rgba(200,90,60,0.45)' : 'rgba(255,140,110,0.4)';
      c2.setLineDash([3, 3]);
      c2.beginPath(); c2.moveTo(qx0, qy(st.Ac1)); c2.lineTo(qx1, qy(st.Ac1)); c2.stroke();
      c2.setLineDash([]);
      // 炉温程序线（虚线，含温区偏移与波动）→ 工件表面（实线）→ 心部（点线，仅冷却段）
      c2.beginPath();
      c2.strokeStyle = lt ? 'rgba(90,110,140,0.8)' : 'rgba(150,175,205,0.7)';
      c2.setLineDash([4, 3]); c2.lineWidth = 1;
      var hlim = Math.min(st.hTime.length - 1, Math.max(0, Math.round((Math.min(tNow, st.tHoldEnd) / Math.max(1e-6, st.tHoldEnd)) * (st.hTime.length - 1))));
      for (var i4 = 0; i4 <= hlim; i4++) {
        var xx = qx(st.hTime[i4]), yy = qy(st.hTloc[i4]);
        if (i4 === 0) c2.moveTo(xx, yy); else c2.lineTo(xx, yy);
      }
      c2.stroke();
      c2.setLineDash([]);
      function plotLine(getY, style, dash) {
        c2.strokeStyle = style; c2.lineWidth = 1.5;
        if (dash) c2.setLineDash(dash);
        c2.beginPath();
        var lim = Math.max(1, idx);
        for (var i3 = 0; i3 <= lim && i3 < st.time.length; i3++) {
          var x2 = qx(st.time[i3]), y2 = qy(getY(i3));
          if (i3 === 0) c2.moveTo(x2, y2); else c2.lineTo(x2, y2);
        }
        c2.stroke();
        c2.setLineDash([]);
      }
      plotLine(function (i5) { return st.sT[i5]; }, lt ? '#d1701a' : '#ffb347');
      if (inCool) plotLine(function (i6) { return st.sTc[i6]; }, '#e879a9', [2, 2]);
      c2.beginPath(); c2.arc(qx(tNow), qy(st.sT[idx]), 3.2, 0, 6.2832);
      c2.fillStyle = lt ? '#0a7d90' : '#3ddbe8'; c2.fill();
      c2.fillStyle = dim; c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'right';
      c2.fillText(Math.round(Tmax) + '℃', qx0 - 3, qy0 + 4);
      c2.fillText(st.T0 + '℃', qx0 - 3, qy1);
      c2.textAlign = 'center';
      if (xr - qx0 > 26) c2.fillText('升温', (qx0 + xr) / 2, qy1 + 11);
      if (xh - xr > 26) c2.fillText('保温', (xr + xh) / 2, qy1 + 11);
      if (qx1 - xh > 26) c2.fillText('冷却', (xh + qx1) / 2, qy1 + 11);

      /* ---------- 右下右：炉膛温区示意 ---------- */
      rrect(c2, furnX, botY, furnW, botH, 7);
      c2.fillStyle = lt ? '#f5faf7' : '#101e19';
      c2.fill();
      c2.strokeStyle = line; c2.stroke();
      var fzY = botY + 14, fzH = botH - 42;
      var zw = (furnW - 16) / 3;
      var zoneIdx = clamp(Math.round(st.p.zone), 0, 2);
      for (var zi = 0; zi < 3; zi++) {
        var zx = furnX + 8 + zi * zw;
        rrect(c2, zx, fzY, zw - 3, fzH, 4);
        var hot = zi === 2 ? 0.16 : (zi === 1 ? 0.09 : 0.03);
        c2.fillStyle = zi === zoneIdx
          ? (lt ? 'rgba(255,150,60,0.30)' : 'rgba(255,150,60,0.22)')
          : (lt ? 'rgba(120,140,170,' + hot + ')' : 'rgba(140,165,200,' + hot + ')');
        c2.fill();
        c2.strokeStyle = line; c2.stroke();
        c2.fillStyle = dim; c2.font = '9px "Microsoft YaHei", sans-serif';
        c2.textAlign = 'center';
        c2.fillText(zw < 33 ? ZONES[zi].name.slice(0, 2) : ZONES[zi].name, zx + (zw - 3) / 2, fzY + 12);
        c2.fillText((ZONES[zi].dT >= 0 ? '+' : '') + ZONES[zi].dT + ' ℃', zx + (zw - 3) / 2, fzY + fzH - 5);
      }
      var wjx = furnX + 8 + zoneIdx * zw + (zw - 3) / 2;
      c2.beginPath(); c2.arc(wjx, fzY + fzH / 2 + 2, 5, 0, 6.2832);
      c2.fillStyle = lt ? '#2f6fa8' : '#5fb8e8'; c2.fill();
      c2.fillStyle = dim; c2.font = '9px "Microsoft YaHei", sans-serif';
      c2.textAlign = 'center';
      c2.fillText(st.zone.name + ' · ' + st.med.name, furnX + furnW / 2, botY + botH - 10);
    };

    return st;
  }

  C.registerModule(QUENCH, { buildQuenchField: buildQuenchField });
})(typeof window !== 'undefined' ? window : globalThis);
