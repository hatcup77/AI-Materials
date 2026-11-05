/* =========================================================================
 *  仿真内核 · 实时演算
 *  按进度推进的增量求解器，各模块一个引擎，终点回到完整解
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var RGAS = C.RGAS, K0 = C.K0, clamp = C.clamp, arr = C.arr, getModule = C.getModule, normalizeParams = C.normalizeParams, findVariant = C.findVariant, createRun = C.createRun;

  /* 场构建函数由各模块在注册时作为内部函数交上来，这里做同名转发，
     使实时引擎的代码与拆分前逐字一致。 */
  function buildMicroField(a, b, c, d, e) { return C.internals('solid').buildMicroField(a, b, c, d, e); }
  function buildWaferField(a, b, c, d, e, f) { return C.internals('cvd').buildWaferField(a, b, c, d, e, f); }
  function makeRdField(a, b, c, d, e) { return C.internals('rd').makeRdField(a, b, c, d, e); }
  function buildKilnField(a) { return C.internals('kiln').buildKilnField(a); }
  function kilnNormField() { return C.internals('kiln').kilnNormField(); }
  function kilnFAt(a, b, c) { return C.internals('kiln').kilnFAt(a, b, c); }


  /* =====================================================================
   *  实时演算引擎
   *  与 createRun 的区别：不一次算完整段，而是由外部按真实时间推进 t，
   *  每次推进后用 snapshot() 取「此刻」的指标、曲线段与场分布。
   * ===================================================================== */

  /* 固相反应：解析式，任意 t 可直接求值 */
  function liveSolid(M, p, v) {
    var Tk = p.T + K0;
    var A = v.kT / arr(v.defT + K0, v.Ea);
    var k = A * arr(Tk, v.Ea) * Math.pow(p.P / 5, 0.30) * Math.pow(p.C, 0.75) * Math.pow(1 / p.d0, 0.22);
    var n = v.n;
    var Kg = v.Kg0 * arr(Tk, v.Qg);
    var tEnd = p.t;
    var ratePeak = n * Math.pow((n - 1) / n, (n - 1) / n) * k * Math.exp(-(n - 1) / n) * 100;
    var t90 = Math.pow(-Math.log(0.1), 1 / n) / k;
    var tPeak = Math.pow((n - 1) / n, 1 / n) / k;
    var aEnd = 1 - Math.exp(-Math.pow(k * tEnd, n));
    var field = buildMicroField(p, v, k, tEnd, aEnd);

    function at(t) {
      var x = k * t, xn = Math.pow(x, n);
      var a = 1 - Math.exp(-xn);
      var G = p.d0 + Kg * Math.pow(t, 0.35);
      var rho = clamp(0.60 + 0.385 * Math.sqrt(a) + 0.012 * Math.log(1 + p.P / 2) - 0.0007 * G, 0.50, 0.995);
      var rate = n * Math.pow(k, n) * Math.pow(Math.max(t, 1e-4), n - 1) * Math.exp(-xn);
      return { a: a, G: G, rho: rho, rate: rate };
    }

    var api = {
      moduleId: 'solid', params: p, variantId: v.id, unit: 'min',
      tEnd: tEnd, t: 0, progress: 0, done: false,
      advance: function (dt) {
        this.t = Math.min(this.tEnd, this.t + Math.max(0, dt));
        this.progress = this.tEnd > 0 ? this.t / this.tEnd : 1;
        this.done = this.t >= this.tEnd - 1e-9;
        return this;
      },
      snapshot: function () {
        var t = this.t, st = at(t);
        var NP = Math.max(2, Math.min(72, Math.round(72 * t / Math.max(tEnd, 1e-6)) + 1));
        var time = [], conv = [], rate = [], grain = [], dens = [];
        for (var i = 0; i < NP; i++) {
          var tt = t * i / (NP - 1);
          var q = at(tt);
          time.push(tt);
          conv.push(q.a * 100); rate.push(q.rate * 100);
          grain.push(q.G); dens.push(q.rho * 100);
        }
        var score = 100 * (0.45 * st.a +
          0.35 * clamp((st.rho - 0.85) / 0.145, 0, 1) +
          0.20 * (1 - clamp((st.G - 2) / 28, 0, 1)));
        return {
          t: t, progress: this.progress, time: time,
          series: { conversion: conv, rate: rate, grain: grain, density: dens },
          metrics: {
            conversion: st.a * 100, density: st.rho * 100, grain: st.G,
            ratePeak: ratePeak, t90: t90, score: score
          },
          field: field, fieldProg: this.progress,
          extra: { k: k, Kg: Kg, t90: t90, tPeak: tPeak, tEnd: tEnd, live: true }
        };
      }
    };
    return api;
  }

  /* CVD：解析式（均匀性/粗糙度按当前时间点演化） */
  function liveCvd(M, p, v) {
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
    var uniEnd = clamp(100 * (1 - sigma), 55, 99.4);
    var roughK = v.roughK != null ? v.roughK : 1;
    var roughEnd = clamp(1.1 + roughK * 4.6 * Math.exp(-(p.T - 480) / 300) + 0.9 * Math.pow(p.P / 10, 0.4) - 0.2, 0.4, 12);
    var stress = -260 + 0.42 * (p.T - 900) + 34 * Math.log(p.P / 10) + 18 * Math.log(p.Q / 300);
    var tEnd = p.t;

    function at(t) {
      var f = tEnd > 0 ? clamp(t / tEnd, 0, 1) : 1;
      var done = t >= tEnd - 1e-9;
      return {
        f: f,
        thickness: rate * t,
        uni: done ? uniEnd : clamp(uniEnd * (1 - 0.35 * Math.exp(-f * 4.2)), 40, 99.4),
        rough: done ? roughEnd : roughEnd * (1 + 0.8 * Math.exp(-f * 5))
      };
    }

    var api = {
      moduleId: 'cvd', params: p, variantId: v.id, unit: 'min',
      tEnd: tEnd, t: 0, progress: 0, done: false,
      advance: function (dt) {
        this.t = Math.min(this.tEnd, this.t + Math.max(0, dt));
        this.progress = this.tEnd > 0 ? this.t / this.tEnd : 1;
        this.done = this.t >= this.tEnd - 1e-9;
        return this;
      },
      snapshot: function () {
        var t = this.t, st = at(t);
        var NP = Math.max(2, Math.min(72, Math.round(72 * t / Math.max(tEnd, 1e-6)) + 1));
        var time = [], thick = [], rateArr = [], uniArr = [], roughArr = [];
        for (var i = 0; i < NP; i++) {
          var tt = t * i / (NP - 1);
          var q = at(tt);
          time.push(tt);
          thick.push(q.thickness); rateArr.push(rate);
          uniArr.push(q.uni); roughArr.push(q.rough);
        }
        var score = 100 * (0.40 * clamp(rate / 120, 0, 1) +
          0.35 * clamp((st.uni - 80) / 19, 0, 1) +
          0.25 * (1 - clamp((st.rough - 0.5) / 5, 0, 1)));
        if (!this._field || this.t - this._fieldT > this.tEnd / 60) {
          this._field = buildWaferField(p, v, rate, tEnd, st.uni, st.thickness);
          this._fieldT = this.t;
        }
        return {
          t: t, progress: this.progress, time: time,
          series: { thickness: thick, rate: rateArr, uniformity: uniArr, rough: roughArr },
          metrics: {
            thickness: st.thickness, rate: rate, uniformity: st.uni,
            rough: st.rough, stress: stress, score: score
          },
          field: this._field, fieldProg: this.progress,
          extra: { rKin: rKin, rMt: rMt, sigma: sigma, tEnd: tEnd, live: true }
        };
      }
    };
    return api;
  }

  /* 马弗炉：真正的时间推进（样品温度一阶滞后 + JMAK 累积） */
  function liveKiln(M, p, v) {
    var T0 = 25;
    var ramp = Math.max(0.5, p.ramp);
    var Tset = p.Tset, hold = p.hold;
    var tRamp = Math.max(1, (Tset - T0) / ramp);
    var tEnd = tRamp + hold;

    var G = kilnNormField();
    var sxn = p.sx / 100, syn = p.sy / 100;
    var fpos = kilnFAt(G, 0.10 + 0.80 * sxn, 0.12 + 0.76 * syn);

    var A = v.kT / arr(v.defT + K0, v.Ea);
    var n = v.n;
    var K3 = (Math.pow(v.Gt, 3) - 1) / 120 / arr(v.defT + K0, v.Qg);
    var tau = v.tau || 6.5;

    var hTime = [0], hTprog = [T0], hTpart = [T0], hConv = [0], hRate = [0], hGrain = [1];
    var nextT = tEnd / 89;

    var api = {
      moduleId: 'kiln', params: p, variantId: v.id, unit: 'min',
      tEnd: tEnd, t: 0, progress: 0, done: false,
      _a: 0, _G3: 1, _Ts: T0, _TsMax: T0, _holdEff: 0, _ratePeak: 0,
      advance: function (dt) {
        var dtStep = 0.2;
        var target = Math.min(this.tEnd, this.t + Math.max(0, dt));
        while (this.t < target - 1e-9) {
          var h = Math.min(dtStep, target - this.t);
          this.t += h;
          var t = this.t;
          var Tpg = T0 + Math.min(ramp * t, Tset - T0);
          var Tloc = T0 + (Tpg - T0) * fpos;
          this._Ts = Tloc + (this._Ts - Tloc) * Math.exp(-h / tau);
          if (this._Ts > this._TsMax) this._TsMax = this._Ts;
          if (this._Ts >= Tset - Math.max(10, Tset * 0.05)) this._holdEff += h;

          var kk = A * arr(this._Ts + K0, v.Ea);
          var am = Math.max(this._a, 1e-7);
          var dadot = n * kk * Math.pow(-Math.log(1 - am), (n - 1) / n) * (1 - am);
          this._a = Math.min(0.999999, this._a + dadot * h);
          if (dadot > this._ratePeak) this._ratePeak = dadot;
          this._G3 += K3 * arr(this._Ts + K0, v.Qg) * h;

          if (t >= nextT - 1e-9 || this.t >= this.tEnd - 1e-9) {
            hTime.push(Math.min(t, tEnd));
            hTprog.push(Tpg);
            hTpart.push(this._Ts);
            hConv.push(this._a * 100);
            hRate.push(dadot * 100);
            hGrain.push(Math.pow(this._G3, 1 / 3));
            nextT = tEnd * (hTime.length) / 89;
          }
        }
        this.progress = tEnd > 0 ? this.t / tEnd : 1;
        this.done = this.t >= this.tEnd - 1e-9;
        return this;
      },
      snapshot: function () {
        var Gf = Math.pow(this._G3, 1 / 3);
        var rho = 0.60 + 0.385 * Math.sqrt(this._a) - 0.0007 * Gf + 0.010 * Math.log(1 + this._holdEff / 40);
        var rhoF = clamp(rho, 0.50, 0.995) * 100;
        var gap = Math.max(0, Tset - this._TsMax);
        var score = 100 * (0.42 * this._a +
          0.30 * clamp((rhoF / 100 - 0.85) / 0.145, 0, 1) +
          0.16 * clamp(1 - gap / 120, 0, 1) +
          0.12 * (1 - clamp((Gf - 2) / 28, 0, 1)));

        var uMin = 1e9, uMax = -1e9, ii, jj, val;
        for (jj = Math.round(G.ny * 0.15); jj <= Math.round(G.ny * 0.85); jj += 2) {
          for (ii = Math.round(G.nx * 0.2); ii <= Math.round(G.nx * 0.8); ii++) {
            val = G.F[jj * G.nx + ii];
            if (val < uMin) uMin = val;
            if (val > uMax) uMax = val;
          }
        }
        var uniform = (uMax - uMin) * (Tset - T0);

        if (!this._field || this.t - this._fieldT > this.tEnd / 45) {
          this._field = buildKilnField({
            p: p, v: v, G: G, sxn: sxn, syn: syn, fpos: fpos,
            time: hTime, tProg: hTprog, tPart: hTpart, conv: hConv,
            tEnd: tEnd, tRamp: tRamp, T0: T0, uniform: uniform,
            TsMax: this._TsMax, gap: gap
          });
          this._fieldT = this.t;
        }

        return {
          t: this.t, progress: this.progress, time: hTime,
          series: { conversion: hConv, tProg: hTprog, tPart: hTpart, rate: hRate, grain: hGrain },
          metrics: {
            conversion: this._a * 100, tPart: this._TsMax, gap: gap,
            holdEff: this._holdEff, density: rhoF, grain: Gf, score: score
          },
          field: this._field, fieldProg: 1,
          extra: {
            tEnd: tEnd, tRamp: tRamp, fpos: fpos, uniform: uniform,
            TsMax: this._TsMax, gap: gap, holdEff: this._holdEff,
            ratePeak: this._ratePeak, tau: tau, live: true
          }
        };
      }
    };
    return api;
  }

  /* 反应-扩散：真正的逐步积分（网格与步长按总时长确定，一次初始化） */
  function liveRd(M, p, v) {
    var Tk = p.T + K0, Tref = v.Tref || 333.15;
    var D = v.D0 * Math.exp(-v.Ed * 1000 / RGAS * (1 / Tk - 1 / Tref)) / (p.tort * p.tort);
    var k = v.k0 * Math.exp(-v.Er * 1000 / RGAS * (1 / Tk - 1 / Tref)) * p.cat / 60;
    var Lx = 5e-3, Ly = 3e-3;
    var tend = p.t * 60;

    var maxNX = 61, maxNY = 41, hardSteps = 9000;
    var C0 = p.C0 * 1000;
    var Cref = 400;
    var dxT = Math.sqrt(D * tend / (0.2 * hardSteps));
    var NX = clamp(Math.ceil(Lx / dxT) + 1, 15, maxNX);
    var NY = clamp(Math.ceil(Ly / dxT) + 1, 11, maxNY);
    var dx = Lx / (NX - 1), dy = Ly / (NY - 1);
    // 与 RD.simulate 保持同一套数值格式（显式扩散 + 隐式二级反应）
    var dtStable = 0.2 * dx * dx / Math.max(D, 1e-12);
    var maxSteps = Math.max(60, Math.ceil(tend / dtStable));
    var dt = tend / maxSteps;

    var C = new Float32Array(NX * NY);
    var C2 = new Float32Array(NX * NY);
    var supply = 0;
    var kRow = new Float64Array(NY);
    var j, i;
    for (j = 0; j < NY; j++) {
      kRow[j] = k * (1 + 0.30 * Math.cos(2 * Math.PI * (j / Math.max(1, NY - 1)) * 1.5 + 0.7));
    }
    for (j = 0; j < NY; j++) C[j * NX] = C0;

    var dx2 = dx * dx, dy2 = dy * dy;
    var stepDone = 0;
    var recordEvery = Math.max(1, Math.floor(maxSteps / 70));
    var hist = { time: [0], conv: [0], pen: [0], grad: [0], da: [0] };

    function measure() {
      var sum = 0, cnt = 0;
      for (j = 0; j < NY; j++) { for (i = 0; i < NX; i++) { sum += C[j * NX + i] / C0; cnt++; } }
      var remaining = 0;
      for (j = 0; j < NY; j++) { for (i = 1; i < NX; i++) remaining += C[j * NX + i] * dx * dy; }
      var conversion = supply > 1e-12 ? clamp((1 - remaining / supply) * 100, 0, 100) : 0;

      var jm = Math.floor(NY / 2);
      var pen = Lx;
      for (i = 1; i < NX; i++) {
        if (C[jm * NX + i] / C0 <= 0.1) {
          var x1 = (i - 1) * dx, x2 = i * dx;
          var c1 = C[jm * NX + i - 1] / C0, c2v = C[jm * NX + i] / C0;
          var frac = (c1 - 0.1) / Math.max(1e-6, (c1 - c2v));
          pen = x1 + (x2 - x1) * clamp(frac, 0, 1);
          break;
        }
      }
      var gradMax = 0;
      for (i = 1; i < NX; i++) {
        var g = Math.abs(C[jm * NX + i] - C[jm * NX + i - 1]) / C0 / dx * 1e-3 * 100;
        if (g > gradMax) gradMax = g;
      }
      var da = k * (C0 / Cref) * Lx * Lx / D;
      return { conversion: conversion, pen: pen * 1e6, grad: gradMax, da: da };
    }

    var api = {
      moduleId: 'rd', params: p, variantId: v.id, unit: 'min',
      tEnd: p.t, t: 0, progress: 0, done: false,
      advance: function (dtMin) {
        var targetSteps = Math.min(maxSteps, Math.round((this.t + Math.max(0, dtMin)) * 60 / dt));
        var guard = 0;
        while (stepDone < targetSteps && guard++ < 4000) {
          var fluxSum = 0;
          for (j = 1; j < NY - 1; j++) fluxSum += (C0 - C[j * NX + 1]);
          supply += D * fluxSum / dx * dy * dt;

          for (j = 1; j < NY - 1; j++) {
            var row = j * NX;
            for (i = 1; i < NX - 1; i++) {
              var id = row + i;
              var lap = (C[id - 1] + C[id + 1] - 2 * C[id]) / dx2 +
                        (C[id - NX] + C[id + NX] - 2 * C[id]) / dy2;
              // 隐式二级反应（与 RD.simulate 一致）：Cⁿ⁺¹ = Cⁿ/(1+dt·k·Cⁿ/C_ref)
              var cNew = C[id] / (1 + dt * kRow[j] * C[id] / Cref);
              C2[id] = cNew + dt * D * lap;
              if (C2[id] < 0) C2[id] = 0;
            }
          }
          for (j = 0; j < NY; j++) {
            C2[j * NX] = C0;
            C2[j * NX + NX - 1] = C2[j * NX + NX - 2];
          }
          for (i = 0; i < NX; i++) {
            C2[i] = C2[NX + i];
            C2[(NY - 1) * NX + i] = C2[(NY - 2) * NX + i];
          }
          var tmp = C; C = C2; C2 = tmp;
          stepDone++;

          if (stepDone % recordEvery === 0) {
            var m0 = measure();
            hist.time.push(stepDone * dt / 60);
            hist.conv.push(m0.conversion);
            hist.pen.push(m0.pen);
            hist.grad.push(m0.grad);
            hist.da.push(m0.da);
          }
        }
        this.t = Math.min(this.tEnd, stepDone * dt / 60);
        this.progress = this.tEnd > 0 ? this.t / this.tEnd : 1;
        this.done = stepDone >= maxSteps;
        return this;
      },
      snapshot: function () {
        var m = measure();
        // 起步阶段（t 很小）浓度场还只有边界一层，指标没有物理意义，按 0 显示
        var started = this.t > 0.5;
        var penV = started ? m.pen : 0;
        var gradV = started ? m.grad : 0;
        var convV = started ? m.conversion : 0;
        var gapT = this.tEnd / 70;
        if (!hist.time.length || this.t - hist.time[hist.time.length - 1] > gapT) {
          hist.time.push(this.t); hist.conv.push(convV);
          hist.pen.push(penV); hist.grad.push(gradV); hist.da.push(m.da);
        }
        var score = 100 * (0.50 * convV / 100 +
          0.25 * clamp(penV / 1600, 0, 1) + 0.25 * clamp(gradV / 350, 0, 1));
        var front = started ? m.pen / this.t : 0;
        var frames = [new Float32Array(C)];
        // 每帧新建 makeRdField 会连带重建离屏 canvas（_cv 挂在对象上），
        // 这里复用同一个场对象，只替换帧数据
        if (!this._field) this._field = makeRdField(NX, NY, v.hue, C0, frames);
        else this._field.frames = frames;
        return {
          t: this.t, progress: this.progress,
          time: hist.time.slice(),
          series: {
            conversion: hist.conv.slice(), penetration: hist.pen.slice(),
            grad: hist.grad.slice(), da: hist.da.slice()
          },
          metrics: {
            conversion: convV, penetration: penV, da: m.da,
            grad: gradV, front: front, score: score
          },
          field: this._field, fieldProg: 0,
          extra: { D: D, k: k, NX: NX, NY: NY, alpha: D * dt / (dx * dx), tEnd: this.tEnd, live: true }
        };
      }
    };
    return api;
  }

  /* 热处理实时演算：组织转变按温度窗口推进，这里直接复用完整解的时间序列，
     推进游标即可。终值与静态仿真完全一致，不会出现两种模式对不上的情况。 */
  function liveHeat(M, p, v) {
    var full = M.simulate(p, v, {});
    var tEnd = Math.max(1e-6, full.extra.tEnd);
    var NP = full.time.length;
    var api = {
      moduleId: 'heat', params: p, variantId: v.id, unit: 'min',
      tEnd: tEnd, t: 0, progress: 0, done: false,
      advance: function (dt) {
        this.t = Math.min(this.tEnd, this.t + Math.max(0, dt));
        this.progress = this.t / this.tEnd;
        this.done = this.t >= this.tEnd - 1e-9;
      },
      snapshot: function () {
        var idx = Math.min(NP - 1, Math.max(0, Math.round(this.progress * (NP - 1))));
        var sl = function (a) { return a.slice(0, idx + 1); };
        var hcNow = full.series.Hc[idx];
        var gNow = full.series.grain[idx];
        var m = full.metrics;
        return {
          t: this.t, progress: this.progress, time: sl(full.time),
          series: {
            T: sl(full.series.T), aust: sl(full.series.aust),
            grain: sl(full.series.grain), Hc: sl(full.series.Hc), fM: sl(full.series.fM)
          },
          // 走到终点时直接返回完整解，保证实时模式与静态仿真的终值严格一致；
          // 中途用简化式给出瞬时值，只用于表现演化趋势
          metrics: (idx >= NP - 1) ? m : {
            Hc: hcNow, mu: 12000 / (1 + hcNow / 100), HV: m.HV,
            grain: gNow, decarb: m.decarb, fM: full.series.fM[idx], score: m.score
          },
          field: full.field, fieldProg: this.progress,
          extra: { Ac1: full.extra.Ac1, Ac3: full.extra.Ac3, Ms: full.extra.Ms,
            tRamp: full.extra.tRamp, tEnd: tEnd, isTemper: full.extra.isTemper,
            frac: full.extra.frac, cool: full.extra.cool, vk: full.extra.vk,
            atm: full.extra.atm, soften: full.extra.soften, decarb: full.extra.decarb,
            austF: full.extra.austF, live: true }
        };
      }
    };
    return api;
  }

  function createLive(moduleId, params, variantId) {
    var M = getModule(moduleId);
    var p = normalizeParams(M, params);
    var v = findVariant(M, variantId);
    if (moduleId === 'cvd') return liveCvd(M, p, v);
    if (moduleId === 'rd') return liveRd(M, p, v);
    if (moduleId === 'kiln') return liveKiln(M, p, v);
    if (moduleId === 'heat') return liveHeat(M, p, v);
    return liveSolid(M, p, v);
  }

  C.createLive = createLive;
})(typeof window !== 'undefined' ? window : globalThis);
