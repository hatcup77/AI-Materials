/* =========================================================================
 *  实验模块 · 反应-扩散
 *  二维显式有限差分（Fick 扩散 + 二级反应）
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var RGAS = C.RGAS, K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight;

  /* =====================================================================
   *  模块三：反应-扩散（溶液/凝胶体系二维场）
   * ===================================================================== */
  var RD = {
    id: 'rd',
    name: '反应-扩散',
    tag: 'Reaction-Diffusion',
    subtitle: '二维浓度场与反应前沿演化',
    primaryKey: 'conversion',
    paramDefs: [
      { key: 'T', label: '体系温度', unit: '℃', min: 25, max: 150, step: 1, def: 60,
        hint: '同时提高扩散系数 D 与反应速率常数 k，但 k 对温度更敏感' },
      { key: 'C0', label: '边界浓度', unit: 'mol/L', min: 0.05, max: 1.0, step: 0.01, def: 0.4,
        hint: '左侧边界恒定浓度（Dirichlet 边界条件），决定反应驱动力' },
      { key: 'cat', label: '催化活性因子', unit: '倍', min: 0.5, max: 3.0, step: 0.05, def: 1.0,
        hint: '催化剂使 k 线性放大，可显著改变 Damköhler 数与渗透深度' },
      { key: 'tort', label: '孔隙曲折度 τ', unit: '倍', min: 1.0, max: 3.0, step: 0.05, def: 1.5,
        hint: 'D = D₀/τ²，曲折度增大使扩散受限，反应由动力学控制转为扩散控制' },
      { key: 't', label: '反应时间', unit: 'min', min: 10, max: 180, step: 1, def: 60,
        hint: '仿真总时长，反映反应前沿推进距离' }
    ],
    /* D0、k0 分别是该材料在自身参考温度 Tref = defT + 273.15 K 下的扩散系数 (m²/s)
       与反应速率常数 (1/s)；Tref 一律取该材料的默认工艺温度，参数已按此基准重新标定。
       D0 已计入默认曲折度 τ=1.5 的影响（有效 D = D0/τ² ≈ 1e-10 ~ 1.3e-9 m²/s，
       与 C-S-H 凝胶、水热体系实测的 1e-10 ~ 1e-9 m²/s 量级一致）。
       Ed 为扩散活化能：硅酸盐水泥水化 26、溶胶-凝胶 20、玻璃离子交换 130 kJ/mol；
       Er 为反应活化能：水泥水化 40、水热晶体生长 70、TMAH 显影溶解约 10 kJ/mol。 */
    variants: [
      { id: 'sol', name: '溶胶-凝胶水解缩聚', D0: 1.2e-9, Ed: 20, k0: 0.05, Er: 60, Tref: 333.15, hue: 165, defT: 60,
        formula: 'Si(OC₂H₅)₄ + 4H₂O → SiO₂ + 4C₂H₅OH', note: '典型溶胶-凝胶体系，反应前沿随温度快速推进' },
      { id: 'cement', name: '水泥基材料水化', D0: 2.25e-10, Ed: 26, k0: 0.024194419394543077, Er: 40, Tref: 323.15, hue: 35, defT: 50,
        formula: 'C₃S + H₂O → C-S-H + Ca(OH)₂', note: '扩散控制显著，渗透深度对时间呈 √t 关系；表观活化能 30~48 kJ/mol' },
      { id: 'hydro', name: '水热法晶体生长', D0: 2.8125e-9, Ed: 16, k0: 0.2673803621809997, Er: 70, Tref: 348.15, hue: 265, defT: 75,
        formula: '前驱体离子 → 晶核长大（水热条件）', note: '高温高压水热体系，成核-生长竞争明显' },
      { id: 'corro', name: '金属腐蚀 / 钝化膜生长', D0: 1.6e-9, Ed: 20, k0: 0.06, Er: 55, Tref: 298.15, hue: 20, defT: 25,
        formula: 'Fe → Fe²⁺ + 2e⁻  ／  O₂ + 2H₂O + 4e⁻ → 4OH⁻',
        note: '室温湿态腐蚀，界面处钝化膜生长与溶解竞争，扩散与反应耦合最强' },
      { id: 'ecu', name: '电化学沉积镀层生长', D0: 7.0e-10, Ed: 18, k0: 0.20, Er: 45, Tref: 298.15, hue: 210, defT: 25,
        formula: 'Mⁿ⁺ + n e⁻ → M（阴极还原）',
        note: '阴极表面沉积，反应控制极强，Da ≫ 1，前沿陡峭、渗透深度浅' },
      { id: 'mof', name: 'MOF 溶剂热骨架生长', D0: 1.0e-9, Ed: 22, k0: 0.08, Er: 60, Tref: 393.15, hue: 285, defT: 120,
        formula: '金属离子 + 有机配体 → 多孔配位骨架',
        note: '溶剂热通常 90~200 ℃、十几到几十小时；低温扩散控制、高温成核主导，转化率对温度呈 S 形响应' },
      { id: 'develop', name: '光刻胶碱性显影溶解 (TMAH)', D0: 2.925e-9, Ed: 15, k0: 0.1882930, Er: 10.5, Tref: 298.15, hue: 320, defT: 25,
        formula: '酚醛树脂 + OH⁻ → 碱溶性羧酸盐',
        note: '正胶显影，25 ℃ 时 TMAH 扩散系数约 1.3e-9 m²/s；溶解速率对温度极敏感（每升 1 ℃ 约快 8~12%）' },
      { id: 'etch', name: '半导体湿法刻蚀 (SiO₂/HF)', D0: 2.25e-9, Ed: 15, k0: 0.1003915, Er: 20, Tref: 303.15, hue: 100, defT: 30,
        formula: 'SiO₂ + 6HF → H₂SiF₆ + 2H₂O',
        note: '缓冲氧化蚀刻（BOE）去除二氧化硅，25~40 ℃ 为最佳窗口；超过 45 ℃ 侧蚀钻蚀失控' },
      { id: 'electrolyte', name: '锂电池电解液中的离子迁移', D0: 6.5025e-10, Ed: 17, k0: 0.03949701, Er: 40, Tref: 298.15, hue: 190, defT: 25,
        formula: 'Li⁺ 在电解液中迁移 → 嵌入负极',
        note: '1 M 电解液中 Li⁺ 扩散系数约 2.9e-10 m²/s、活化能 17 kJ/mol；低温下扩散控制明显，倍率性能受限' },
      { id: 'sep', name: '锂电隔膜的电解液浸润', D0: 2.7e-10, Ed: 17, k0: 0.02922750, Er: 45, Tref: 298.15, hue: 265, defT: 25,
        formula: '电解液在多孔隔膜中的浸润与渗透',
        note: '隔膜孔隙曲折度决定浸润速率与内阻；浸润不足会导致界面阻抗高、析锂风险上升' },
      { id: 'hdiff', name: '钢中氢扩散与氢脆', D0: 6.525e-11, Ed: 23, k0: 0.07905002, Er: 35, Tref: 298.15, hue: 20, defT: 25,
        formula: 'H → H⁺ + e⁻ → 钢中可逆/不可逆陷阱捕获',
        note: 'γ-Fe 中氢扩散 D₀≈3.1e-7 m²/s、活化能约 23 kJ/mol；氢陷阱捕获不可逆时形成延迟断裂' }
    ],
    seriesDefs: [
      { key: 'conversion', name: '平均转化率', unit: '%', color: '#3ddbe8', axis: 'left', primary: true },
      { key: 'penetration', name: '渗透深度', unit: 'μm', color: '#ffb347', axis: 'right' },
      { key: 'da', name: 'Damköhler 数', unit: '', color: '#a78bfa', axis: 'right' }
    ],
    outputDefs: [
      { key: 'conversion', label: '平均转化率', unit: '%', digits: 1, primary: true },
      { key: 'penetration', label: '渗透深度', unit: 'μm', digits: 0 },
      { key: 'grad', label: '前沿浓度梯度', unit: '%/mm', digits: 0 },
      { key: 'da', label: 'Damköhler 数', unit: '', digits: 1 },
      { key: 'front', label: '前沿推进速率', unit: 'μm/min', digits: 1 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'conversion', label: '平均转化率最大', dir: 'max' },
      { key: 'penetration', label: '渗透深度最大', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' },
      { key: 'grad', label: '前沿梯度最陡', dir: 'max' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'deep', label: '渗透深度 ≥ 800 μm', test: function (m) { return m.penetration >= 800; } },
      { id: 'conv', label: '平均转化率 ≥ 85 %', test: function (m) { return m.conversion >= 85; } },
      { id: 'both', label: '转化率 ≥ 85 % 且 渗透深度 ≥ 800 μm', test: function (m) { return m.conversion >= 85 && m.penetration >= 800; } }
    ],    notes: [
      '控制方程：∂C/∂t = D∇²C − kC，网格采用显式有限差分，左边界为恒定浓度 Dirichlet 条件。',
      'D = D₀·exp[−E_d/R·(1/T − 1/T_ref)]/τ²，k = k₀·exp[−E_r/R·(1/T − 1/T_ref)]·催化因子，T_ref 取该材料自身的参考温度。',
      'Damköhler 数 Da = k·L²/D：Da ≫ 1 为反应控制（前沿陡峭），Da ≪ 1 为扩散控制（分布均匀）。',
      '渗透深度定义为浓度衰减至边界浓度 10 % 的位置。'
    ]
  };

  /* 浓度场绘制器：simulate 与实时演算共用 */
  function makeRdField(nx, ny, hue, C0, frames) {
    return {
      kind: 'rd',
      nx: nx, ny: ny, hue: hue,
      frames: frames,
      legend: { title: '浓度场 C(x, y)', low: '低浓度', high: 'C₀ 源边界' },
      draw: function (ctx, W, H, prog) {
        var idx = clamp(Math.round(prog * (this.frames.length - 1)), 0, this.frames.length - 1);
        var data = this.frames[idx];
        var cv = this._cv;
        if (!cv || cv.width !== this.nx) {
          cv = document.createElement('canvas');
          cv.width = this.nx; cv.height = this.ny;
          this._cv = cv;
        }
        var c2 = cv.getContext('2d');
        var img = c2.createImageData(this.nx, this.ny);
        var d = img.data;
        var mx = C0;
        for (var n = 0; n < this.nx * this.ny; n++) {
          var t = clamp(data[n] / mx, 0, 1);
          var col = viridis(Math.pow(t, 0.62));
          var o = n * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
        c2.putImageData(img, 0, 0);
        ctx.save();
        var rl = themeLight();
        ctx.fillStyle = rl ? '#f2f6fb' : 'hsl(' + hue + ', 14%, 8%)';
        ctx.fillRect(0, 0, W, H);
        var padX = 22, padT = 16, padB = 24;
        var w = W - padX * 2, h = H - padT - padB;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(cv, padX, padT, w, h);
        ctx.strokeStyle = rl ? 'rgba(30,70,120,0.24)' : 'rgba(150,200,255,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(padX + 0.5, padT + 0.5, w, h);
        ctx.fillStyle = rl ? 'rgba(9,140,160,0.9)' : 'rgba(120,235,255,0.85)';
        ctx.fillRect(padX - 5, padT, 3.5, h);
        ctx.font = '10.5px "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = rl ? 'rgba(38,64,96,0.8)' : 'rgba(190,220,250,0.75)';
        ctx.textAlign = 'left';
        ctx.fillText('◀ C = C₀ 源边界', padX, padT + h + 7);
        ctx.textAlign = 'right';
        ctx.fillText('出口（零梯度）▶', padX + w, padT + h + 7);
        ctx.restore();
      }
    };
  }

  RD.simulate = function (p, v, opts) {
    opts = opts || {};
    var mode = opts.mode || (opts.fast ? 'fast' : 'full');
    var fast = mode !== 'full';
    var Tk = p.T + K0, Tref = v.Tref || 333.15;
    var D = v.D0 * Math.exp(-v.Ed * 1000 / RGAS * (1 / Tk - 1 / Tref)) / (p.tort * p.tort);
    var k = v.k0 * Math.exp(-v.Er * 1000 / RGAS * (1 / Tk - 1 / Tref)) * p.cat / 60; // 1/s
    var Lx = 5e-3, Ly = 3e-3;
    var tend = p.t * 60;

    var maxNX = mode === 'fast' ? 31 : (mode === 'mid' ? 45 : 61);
    var maxNY = mode === 'fast' ? 21 : (mode === 'mid' ? 31 : 41);
    var hardSteps = mode === 'fast' ? 700 : (mode === 'mid' ? 1800 : 9000);
    var C0 = p.C0 * 1000;          // mol/m³ 便于数值量级
    var Cref = 400;                // 参考浓度 0.4 mol/L，二级反应归一化
    // 先按目标步数确定网格尺度，再由实际 Δx 反推满足稳定性的时间步 (α ≤ 0.2)
    var dxT = Math.sqrt(D * tend / (0.2 * hardSteps));
    var NX = clamp(Math.ceil(Lx / dxT) + 1, 15, maxNX);
    var NY = clamp(Math.ceil(Ly / dxT) + 1, 11, maxNY);
    var dxReq = Lx / (NX - 1);
    var dy = Ly / (NY - 1);
    // 显式扩散的稳定性：D·dt/Δx² ≤ 0.2（网格就是按这条设计的）。
    // 步数必须由稳定性判据给出，不能再被 hardSteps 硬截断，因为网格取整会让实际 Δx
    // 略小于设计值，一旦截断步数，α 就会越过 0.2，扩散项失稳、浓度场崩溃。
    var dtStable = 0.2 * dxReq * dxReq / Math.max(D, 1e-12);
    var maxSteps = Math.max(60, Math.ceil(tend / dtStable));
    var dt = tend / maxSteps;
    var alpha = D * dt / (dxReq * dxReq);

    var C = new Float32Array(NX * NY);
    var C2 = new Float32Array(NX * NY);
    var supply = 0;                // 累计由边界输入的反应物（mol / m 深度）
    var i, j, step;
    // 催化剂/孔隙沿厚度方向的不均匀分布（使反应前沿呈起伏形貌）
    var kRow = new Float64Array(NY);
    for (j = 0; j < NY; j++) {
      kRow[j] = k * (1 + 0.30 * Math.cos(2 * Math.PI * (j / Math.max(1, NY - 1)) * 1.5 + 0.7));
    }
    for (j = 0; j < NY; j++) C[j * NX] = C0;

    var frames = [];
    var nFrames = fast ? 0 : 46;
    var saveEvery = nFrames ? Math.max(1, Math.floor(maxSteps / nFrames)) : 0;

    var dx2 = dxReq * dxReq, dy2 = dy * dy;

    for (step = 0; step <= maxSteps; step++) {
      // 边界通量（物料衡算用）：J = D·(C₀ − C₁)/Δx，逐行累加边界面积 Δy
      var fluxSum = 0;
      for (j = 1; j < NY - 1; j++) fluxSum += (C0 - C[j * NX + 1]);
      supply += D * fluxSum / dxReq * dy * dt;

      for (j = 1; j < NY - 1; j++) {
        var row = j * NX;
        for (i = 1; i < NX - 1; i++) {
          var id = row + i;
          var lap = (C[id - 1] + C[id + 1] - 2 * C[id]) / dx2 +
                    (C[id - NX] + C[id + NX] - 2 * C[id]) / dy2;
          // 二级反应 r = k·C²/C_ref，用隐式（后向 Euler）处理：Cⁿ⁺¹ = Cⁿ/(1+dt·k·Cⁿ/C_ref)。
          // 显式处理这一项时 dt·k·(C₀/C_ref) ≤ 0.5 才稳定，高温强反应下会冲过零点、
          // 浓度场整体崩溃；隐式化后反应项无条件稳定，步长只需满足扩散约束。
          var cNew = C[id] / (1 + dt * kRow[j] * C[id] / Cref);
          C2[id] = cNew + dt * D * lap;
          if (C2[id] < 0) C2[id] = 0;
        }
      }
      // 边界条件
      for (j = 0; j < NY; j++) {
        C2[j * NX] = C0;                       // 左：恒定浓度
        C2[j * NX + NX - 1] = C2[j * NX + NX - 2]; // 右：零梯度
      }
      for (i = 0; i < NX; i++) {
        C2[i] = C2[NX + i];                    // 上下：无通量
        C2[(NY - 1) * NX + i] = C2[(NY - 2) * NX + i];
      }
      var tmp = C; C = C2; C2 = tmp;

      if (nFrames && step % saveEvery === 0 && frames.length < nFrames) {
        frames.push(new Float32Array(C));
      }
    }

    // 指标计算
    var sum = 0, cnt = 0;
    for (j = 0; j < NY; j++) {
      for (i = 0; i < NX; i++) {
        sum += C[j * NX + i] / C0; cnt++;
      }
    }
    var mean = sum / cnt;
    // 转化率 = 1 − 域内残留量 / 累计输入量（物料衡算；源边界列不计入残留）
    var remaining = 0;
    for (j = 0; j < NY; j++) {
      for (i = 1; i < NX; i++) remaining += C[j * NX + i] * dxReq * dy;
    }
    var conversion = supply > 1e-12 ? clamp((1 - remaining / supply) * 100, 0, 100) : 0;

    // 渗透深度（中线上 C 衰减至 0.1C0 的位置）
    var jm = Math.floor(NY / 2);
    var pen = Lx;
    for (i = 1; i < NX; i++) {
      if (C[jm * NX + i] / C0 <= 0.1) {
        var x1 = (i - 1) * dxReq, x2 = i * dxReq;
        var c1 = C[jm * NX + i - 1] / C0, c2v = C[jm * NX + i] / C0;
        var frac = (c1 - 0.1) / Math.max(1e-6, (c1 - c2v));
        pen = x1 + (x2 - x1) * clamp(frac, 0, 1);
        break;
      }
    }
    var da = k * (C0 / Cref) * Lx * Lx / D;
    // 前沿浓度梯度（沿中线的最大归一化梯度，%/mm）
    var gradMax = 0;
    for (i = 1; i < NX; i++) {
      var g = Math.abs(C[jm * NX + i] - C[jm * NX + i - 1]) / C0 / dxReq * 1e-3 * 100;
      if (g > gradMax) gradMax = g;
    }
    var front = pen * 1e6 / Math.max(p.t, 1e-6);

    var score = 100 * (0.50 * conversion / 100 + 0.25 * clamp(pen * 1e6 / 1600, 0, 1) +
      0.25 * clamp(gradMax / 350, 0, 1));

    var metrics = {
      conversion: conversion, penetration: pen * 1e6, da: da,
      grad: gradMax, front: front, score: score
    };

    // 曲线（用解析近似生成时间演化，避免重复 FD 计算）
    var NP = 64;
    var time = [], convArr = [], penArr = [], gradArr = [], daArr = [];
    for (var q = 0; q < NP; q++) {
      var tt = p.t * q / (NP - 1);
      var u = q / (NP - 1);
      // 反应前沿近似按 √t 推进，转化率随时间平滑饱和
      var sat = (1 - Math.exp(-1.6 * u)) / (1 - Math.exp(-1.6));
      time.push(tt);
      convArr.push(conversion * sat);
      penArr.push(pen * 1e6 * Math.sqrt(sat));
      gradArr.push(gradMax * Math.pow(sat, 0.7));
      daArr.push(da * sat);
    }

    var field = null;
    if (!fast && frames.length > 2) {
      field = makeRdField(NX, NY, v.hue, C0, frames);
    }

    return {
      time: time,
      series: { conversion: convArr, penetration: penArr, grad: gradArr, da: daArr },
      metrics: metrics, field: field,
      extra: { D: D, k: k, NX: NX, NY: NY, alpha: alpha }
    };
  };

  function viridis(t) {
    t = clamp(t, 0, 1);
    var stops = [
      [7, 11, 36], [28, 74, 142], [24, 140, 178], [92, 204, 152], [236, 226, 112]
    ];
    var x = t * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(x));
    var f = x - i;
    return [
      Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f),
      Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f),
      Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f)
    ];
  }

  C.registerModule(RD, { makeRdField: makeRdField });
})(typeof window !== 'undefined' ? window : globalThis);
