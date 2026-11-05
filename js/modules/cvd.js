/* =========================================================================
 *  实验模块 · 化学气相沉积
 *  表面反应与质量输运串联动力学 + 晶圆膜厚分布
 *  自包含：模型定义、求解、可视化场构建都在本文件内，
 *  只向内核注册模块对象与场构建函数，不感知界面。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var RGAS = C.RGAS, K0 = C.K0, clamp = C.clamp, themeLight = C.themeLight;
  /* =====================================================================
   *  模块二：化学气相沉积（CVD 薄膜生长）
   * ===================================================================== */
  var CVD = {
    id: 'cvd',
    name: '化学气相沉积',
    tag: 'Chemical Vapor Deposition',
    subtitle: '前驱体热分解沉积功能薄膜',
    primaryKey: 'thickness',
    paramDefs: [
      { key: 'T', label: '衬底温度', unit: '℃', min: 100, max: 1100, step: 5, def: 900,
        hint: '低温区受表面反应控制（强温度依赖），高温区转为质量输运控制（趋于平台）；原子层沉积在 200~400 ℃ 弱温度依赖区' },
      { key: 'P', label: '腔体压力', unit: 'Torr', min: 1, max: 100, step: 1, def: 10,
        hint: '压力升高提高前驱体分压与沉积速率，但加剧气相成核与膜厚不均' },
      { key: 'C', label: '前驱体浓度', unit: '%', min: 0.2, max: 5, step: 0.1, def: 2,
        hint: '浓度-速率呈 Langmuir-Hinshelwood 饱和关系，过高导致气相耗尽' },
      { key: 'Q', label: '载气流量', unit: 'sccm', min: 100, max: 800, step: 10, def: 300,
        hint: '流量影响边界层厚度与停留时间，过低引起膜厚均匀性恶化' },
      { key: 't', label: '沉积时间', unit: 'min', min: 5, max: 120, step: 1, def: 40,
        hint: '膜厚 = 沉积速率 × 时间（反应控制区近似线性）' }
    ],
    /* Rref 是在该材料自身参考温度 Tref 下的表面反应速率（nm/min）；
       Tref 一律取该材料的默认工艺温度，Rref 已按此基准重新标定。
       Ea 取自文献：TEOS 热壁 LPCVD 167~192 kJ/mol，LPCVD 氮化硅约 1.8 eV（174），
       多晶硅与氮化钛 130~160 kJ/mol，TiO₂ 的 TTIP 前驱体在 500 ℃ 以下约 78 kJ/mol、
       超过后转为扩散控制，InP 表面反应 55 kJ/mol，ALD 表面自限反应因活化能低而弱温度依赖（约 60 kJ/mol）。 */
    variants: [
      { id: 'SiH4', name: 'SiH₄ / H₂ · 多晶硅', Ea: 130, Rref: 31.9148936170, Tref: 1173.15, hue: 190, defT: 900,
        formula: 'SiH₄(g) → Si(s) + 2H₂(g)', note: '半导体前道工序主流体系，600 ℃ 以上速率急剧上升' },
      { id: 'TEOS', name: 'TEOS / O₂ · SiO₂', Ea: 175, Rref: 26.3157894737, Tref: 1023.15, hue: 205, defT: 750,
        formula: 'Si(OC₂H₅)₄ + 12O₂ → SiO₂ + 8CO₂ + 10H₂O', note: '700~750 ℃ 速率 20~30 nm/min，台阶覆盖性好，常用于层间介质沉积' },
      { id: 'TiCl4', name: 'TiCl₄ / N₂ / H₂ · TiN', Ea: 158, Rref: 43.4782608696, Tref: 1223.15, hue: 40, defT: 950,
        formula: '6TiCl₄ + 8NH₃ → 6TiN + 24HCl + N₂', note: '硬质涂层与扩散阻挡层，高温沉积获得致密膜' },
      { id: 'GaN', name: 'TMGa / NH₃ · GaN 氮化镓', Ea: 160, Rref: 15.4639175258, Tref: 1323.15, hue: 120, defT: 1050,
        formula: 'Ga(CH₃)₃ + NH₃ → GaN + 3CH₄', note: 'MOCVD 在 1050 ℃ 生长，速率约 400~1200 nm/h；第三代半导体蓝光 LED 与功率器件的核心体系' },
      { id: 'Al2O3', name: 'TMA / H₂O · Al₂O₃ 氧化铝', Ea: 60, Rref: 1.00200400802, Tref: 573.15, hue: 255, defT: 300,
        roughK: 0.06,
        formula: 'Al(CH₃)₃ + 3H₂O → Al₂O₃ + 3CH₄',
        note: '原子层沉积的自限性介质层，每循环约 0.1 nm；T-ALD 用 TMA/H₂O 只能在 200~400 ℃，再高 TMA 自分解' },
      { id: 'W', name: 'WF₆ / H₂ · W 钨薄膜', Ea: 110, Rref: 214.285714286, Tref: 873.15, hue: 350, defT: 600,
        formula: 'WF₆ + 3H₂ → W + 6HF', note: '半导体互连与扩散阻挡层的常用金属膜，300~900 ℃ 可沉积，速率可达 100~300 nm/min' },
      { id: 'Si3N4', name: 'SiH₂Cl₂ / NH₃ · Si₃N₄ 氮化硅', Ea: 174, Rref: 4.032258064516129, Tref: 1073.15, hue: 210, defT: 800,
        roughK: 0.45,
        formula: '3SiH₂Cl₂ + 4NH₃ → Si₃N₄ + 6HCl + 6H₂',
        note: 'LPCVD 氮化硅，750~830 ℃，速率仅 3~5 nm/min；活化能约 1.8 eV，温度敏感性极强' },
      { id: 'TiO2', name: 'TTIP / O₂ · TiO₂ 二氧化钛', Ea: 77.9, Rref: 109.75609756097561, Tref: 723.15, hue: 55, defT: 450,
        roughK: 0.85,
        formula: 'Ti(OC₄H₉)₄ + O₂ → TiO₂ + 4CO₂ + 8H₂O',
        note: 'TTIP 金属有机前驱体 MOCVD，400~600 ℃；加入水蒸气可把 450 ℃ 的速率从 90 提到 440 nm/min' },
      { id: 'Diamond', name: 'CH₄ / H₂ · 金刚石薄膜', Ea: 43, Rref: 15.463917525773196, Tref: 1173.15, hue: 165, defT: 900,
        roughK: 5,
        formula: 'CH₄ + H₂ → C(金刚石) + 2H₂',
        note: '热丝/微波等离子 CVD，基片 800~1000 ℃；生长率仅 0.5~1.3 μm/h，是最难沉积的材料' },
      { id: 'InP', name: 'TMI / PH₃ · InP 磷化铟', Ea: 55, Rref: 55.55555555555556, Tref: 973.15, hue: 20, defT: 700,
        roughK: 0.25,
        formula: 'In(CH₃)₃ + PH₃ → InP + 3CH₄',
        note: 'III-V 族 MOCVD 外延，700 ℃ 生长率约 50 nm/min；420~580 ℃ 区间为质量输运控制' },
      { id: 'AlN', name: 'TMA / NH₃ · AlN 氮化铝', Ea: 170, Rref: 43.478260869565216, Tref: 1323.15, hue: 300, defT: 1050,
        roughK: 0.4,
        formula: 'Al(CH₃)₃ + NH₃ → AlN + 3CH₄',
        note: '1050~1150 ℃ 生长，速率 30~50 nm/min；TMA 与 NH₃ 的气相寄生反应剧烈，需高 V/III 比抑制' },
      { id: 'ITO', name: 'In / Sn / O₂ · ITO 氧化铟锡', Ea: 100, Rref: 1.5045045045045045, Tref: 823.15, hue: 130, defT: 550,
        roughK: 0.6,
        formula: 'In(CH₃)₃ + Sn(CH₃)₄ + O₂ → ITO',
        note: '透明导电电极，350~600 ℃；本体层生长慢（0.1~3 nm/min），Sn 掺杂 5~12% 时电阻率最低' }
    ],
    seriesDefs: [
      { key: 'thickness', name: '薄膜厚度', unit: 'nm', color: '#3ddbe8', axis: 'left', primary: true },
      { key: 'rate', name: '沉积速率', unit: 'nm/min', color: '#ffb347', axis: 'right' },
      { key: 'uniformity', name: '膜厚均匀性', unit: '%', color: '#66e3a0', axis: 'right' },
      { key: 'rough', name: '表面粗糙度 Ra', unit: 'nm', color: '#a78bfa', axis: 'right' }
    ],
    outputDefs: [
      { key: 'thickness', label: '薄膜厚度', unit: 'nm', digits: 0, primary: true },
      { key: 'rate', label: '沉积速率', unit: 'nm/min', digits: 1 },
      { key: 'uniformity', label: '膜厚均匀性', unit: '%', digits: 1 },
      { key: 'rough', label: '表面粗糙度', unit: 'nm', digits: 2 },
      { key: 'stress', label: '残余应力', unit: 'MPa', digits: 0 },
      { key: 'score', label: '综合评分', unit: '', digits: 1 }
    ],
    objectives: [
      { key: 'rate', label: '沉积速率最大', dir: 'max' },
      { key: 'uniformity', label: '均匀性最高', dir: 'max' },
      { key: 'score', label: '综合评分最优', dir: 'max' },
      { key: 'rough', label: '粗糙度最小', dir: 'min' }
    ],
    constraints: [
      { id: 'none', label: '无约束', test: function () { return true; } },
      { id: 'uni', label: '均匀性 ≥ 95 %', test: function (m) { return m.uniformity >= 95; } },
      { id: 'smooth', label: '粗糙度 ≤ 3 nm', test: function (m) { return m.rough <= 3; } },
      { id: 'both', label: '均匀性 ≥ 95 % 且 粗糙度 ≤ 3 nm', test: function (m) { return m.uniformity >= 95 && m.rough <= 3; } }
    ],
    notes: [
      '沉积速率取表面反应与质量输运的串联阻力：1/R = 1/R_kin + 1/R_mt。',
      'R_kin = R_ref·exp[−Eₐ/R·(1/T − 1/T_ref)]·(P/P₀)^0.5·Langmuir(C)，T_ref 与 R_ref 均按材料自身工艺温度标定，低温段呈 Arrhenius 行为。',
      'R_mt = 500·f(P^0.85, Q^0.35)，基准 500 nm/min（常规热壁 CVD 约 100~200 nm/min，高流量外延可达 1~3 μm/min），高温段速率对温度不敏感，形成「输运平台」。',
      '膜厚均匀性由压力、流量、温度共同决定，边缘与喷淋头图案会导致径向偏差。'
    ]
  };

  CVD.simulate = function (p, v, opts) {
    var Tk = p.T + K0, Tref = v.Tref || 1173.15;
    var rKin = v.Rref *
      Math.exp(-v.Ea * 1000 / RGAS * (1 / Tk - 1 / Tref)) *
      Math.pow(p.P / 10, 0.5) *
      (p.C / (1 + 0.35 * p.C)) / (2 / 1.7);
    var rMt = 500 * Math.pow(p.P / 10, 0.85) * Math.pow(p.C / 2, 0.55) * Math.pow(p.Q / 300, 0.35);
    var rate = 1 / (1 / Math.max(rKin, 1e-6) + 1 / Math.max(rMt, 1e-6));

    var sigma = 0.022 +
      0.034 * Math.abs(Math.log(p.P / 10)) +
      0.011 * Math.abs(p.C - 2) +
      0.00026 * Math.max(0, p.T - 900) +
      0.06 * Math.max(0, (300 - p.Q) / 300) +
      0.09 * Math.max(0, (p.Q - 560) / 240);
    var uni = clamp(100 * (1 - sigma), 55, 99.4);

    // roughK：材料级粗糙度标度（原子层沉积表面自限、膜层平整，取值远小于 1）
    var roughK = v.roughK != null ? v.roughK : 1;
    var rough = 1.1 + roughK * 4.6 * Math.exp(-(p.T - 480) / 300) + 0.9 * Math.pow(p.P / 10, 0.4) - 0.2;
    rough = clamp(rough, 0.4, 12);
    var stress = -260 + 0.42 * (p.T - 900) + 34 * Math.log(p.P / 10) + 18 * Math.log(p.Q / 300);

    var NP = 84;
    var time = [], thick = [], rateArr = [], uniArr = [], roughArr = [];
    for (var i = 0; i < NP; i++) {
      var t = p.t * i / (NP - 1);
      var f = i / (NP - 1);
      time.push(t);
      thick.push(rate * t);
      rateArr.push(rate);
      // 早期成核延迟与均匀性演化
      uniArr.push(clamp(uni * (1 - 0.35 * Math.exp(-f * 4.2)), 40, 99.4));
      roughArr.push(rough * (1 + 0.8 * Math.exp(-f * 5)));
    }

    var thickness = rate * p.t;
    var score = 100 * (0.40 * clamp(rate / 120, 0, 1) +
      0.35 * clamp((uni - 80) / 19, 0, 1) +
      0.25 * (1 - clamp((rough - 0.5) / 5, 0, 1)));

    var metrics = {
      thickness: thickness, rate: rate, uniformity: uni,
      rough: rough, stress: stress, score: score
    };

    var field = null;
    if (!(opts && opts.fast)) field = buildWaferField(p, v, rate, p.t, uni, thickness);

    return {
      time: time,
      series: { thickness: thick, rate: rateArr, uniformity: uniArr, rough: roughArr },
      metrics: metrics, field: field,
      extra: { rKin: rKin, rMt: rMt, sigma: sigma }
    };
  };

  /* 晶圆膜厚分布场 */
  function buildWaferField(p, v, rate, tEnd, uni, thickness) {
    var dev = (100 - uni) / 100;
    var res = 168;
    // 归一化厚度分布（径向对称 + 方位角调制 + 喷淋头图案）
    function ratio(nx, ny) {
      var r = Math.sqrt(nx * nx + ny * ny);
      if (r > 1) return 0;
      var th = Math.atan2(ny, nx);
      var radial = 1 - 1.05 * dev * Math.pow(r, 2.2);
      var azim = 0.35 * dev * Math.cos(3 * th) * Math.pow(r, 2);
      var shower = 0.20 * dev * Math.cos(9 * th) * Math.pow(r, 4);
      return clamp(radial + azim + shower, 0.45, 1.35);
    }
    // 预扫描色标范围，使微小偏差也能以完整色阶呈现（与图例数值对应）
    var rMin = Infinity, rMax = -Infinity;
    for (var a = 0; a < 90; a++) {
      for (var b = 0; b < 90; b++) {
        var nx0 = (a + 0.5) / 90 * 2 - 1, ny0 = (b + 0.5) / 90 * 2 - 1;
        var rv = ratio(nx0, ny0);
        if (rv <= 0) continue;
        if (rv < rMin) rMin = rv;
        if (rv > rMax) rMax = rv;
      }
    }
    if (!isFinite(rMin) || rMax - rMin < 1e-6) { rMin = 0.95; rMax = 1.05; }

    return {
      kind: 'wafer',
      res: res,
      hue: v.hue,
      uni: uni,
      legend: { title: '晶圆膜厚分布', low: '薄', high: '厚' },
      ratioFn: ratio,
      maxThick: thickness,
      rMin: rMin,
      rMax: rMax,
      tMin: thickness * rMin,
      tMax: thickness * rMax,
      draw: function (ctx, W, H, prog) {
        var res = this.res;
        var cv = this._cv;
        if (!cv) {
          cv = document.createElement('canvas');
          cv.width = res; cv.height = res;
          this._cv = cv;
        }
        var c2 = cv.getContext('2d');
        var img = c2.createImageData(res, res);
        var d = img.data;
        var bright = 0.22 + 0.78 * Math.min(1, prog * 1.12);
        var span = Math.max(1e-6, this.rMax - this.rMin);
        for (var j = 0; j < res; j++) {
          for (var i = 0; i < res; i++) {
            var nx = (i + 0.5) / res * 2 - 1;
            var ny = (j + 0.5) / res * 2 - 1;
            var rr = this.ratioFn(nx, ny);
            var idx = (j * res + i) * 4;
            if (rr <= 0) { d[idx + 3] = 0; continue; }
            var val = clamp((rr - this.rMin) / span, 0, 1);
            var col = thermal(val);
            d[idx] = col[0] * bright;
            d[idx + 1] = col[1] * bright;
            d[idx + 2] = col[2] * bright;
            d[idx + 3] = 255;
          }
        }
        c2.putImageData(img, 0, 0);

        ctx.save();
        var wl = themeLight();
        ctx.fillStyle = wl ? 'hsl(' + v.hue + ', 24%, 96%)' : 'hsl(' + v.hue + ', 14%, 8%)';
        ctx.fillRect(0, 0, W, H);
        var side = Math.min(W, H) * 0.9;
        var ox = (W - side) / 2, oy = (H - side) / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.beginPath();
        ctx.arc(ox + side / 2, oy + side / 2, side / 2, 0, 6.2832);
        ctx.save(); ctx.clip();
        ctx.drawImage(cv, ox, oy, side, side);
        ctx.restore();
        ctx.lineWidth = 2;
        ctx.strokeStyle = wl ? 'hsla(' + v.hue + ', 45%, 42%, 0.45)' : 'hsla(' + v.hue + ', 40%, 70%, 0.35)';
        ctx.beginPath();
        ctx.arc(ox + side / 2, oy + side / 2, side / 2, 0, 6.2832);
        ctx.stroke();
        // 十字定位
        ctx.strokeStyle = wl ? 'rgba(24,48,80,0.12)' : 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox, oy + side / 2); ctx.lineTo(ox + side, oy + side / 2);
        ctx.moveTo(ox + side / 2, oy); ctx.lineTo(ox + side / 2, oy + side);
        ctx.stroke();
        ctx.restore();
      }
    };
  }

  function thermal(t) {
    t = clamp(t, 0, 1);
    // 深蓝 → 青 → 黄 → 橙红
    var stops = [
      [10, 20, 48], [24, 78, 130], [46, 176, 190], [235, 205, 90], [240, 120, 60], [225, 60, 60]
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

  C.registerModule(CVD, { buildWaferField: buildWaferField });
})(typeof window !== 'undefined' ? window : globalThis);
