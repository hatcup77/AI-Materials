/* =========================================================================
 *  仿真内核 · 参数研究
 *  快速评估、单参数扫掠、敏感性分析、智能寻优
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var clamp = C.clamp, mulberry32 = C.mulberry32, getModule = C.getModule, normalizeParams = C.normalizeParams, findVariant = C.findVariant;


  /* 快速评估（不含可视化场），供扫掠/寻优使用。
     默认用 mid 档网格：反应-扩散是数值解，粗网格与完整求解在同一点上会差 4~6 个百分点，
     学生把 KPI 和扫掠曲线对不上会困惑；mid 档只多花几毫秒，偏差压到 2 pp 以内。
     只有寻优内部（要评估上千个点）才退回 fast 档。 */
  function estimate(moduleId, params, variantId, opts) {
    var M = getModule(moduleId);
    var p = normalizeParams(M, params);
    var v = findVariant(M, variantId);
    var o = { fast: true };
    // 只有反应-扩散是数值解，网格精度会影响结果；其余模块是解析式，fast 档即精确解
    if (M.id === 'rd') o.mode = (opts && opts.fast) ? 'fast' : 'mid';
    return M.simulate(p, v, o).metrics;
  }

  /* 单参数响应曲线 */
  function sweep(moduleId, params, variantId, key, steps) {
    var M = getModule(moduleId);
    var def = null;
    M.paramDefs.forEach(function (d) { if (d.key === key) def = d; });
    if (!def) return [];
    steps = steps || 28;
    var out = [];
    for (var i = 0; i < steps; i++) {
      var x = def.min + (def.max - def.min) * i / (steps - 1);
      var p = {}; for (var k in params) p[k] = params[k];
      p[key] = x;
      out.push({ x: x, metrics: estimate(moduleId, p, variantId) });
    }
    return out;
  }

  /* 敏感性分析（龙卷风图）：各参数在 ±15% 量程内的输出变化 */
  function sensitivity(moduleId, params, variantId, metricKey, spanRatio) {
    spanRatio = spanRatio || 0.15;
    var M = getModule(moduleId);
    var base = estimate(moduleId, params, variantId)[metricKey];
    var list = [];
    M.paramDefs.forEach(function (d) {
      if (d.key === 't' && d.key !== metricKey) { /* 时间仍纳入分析 */ }
      var span = (d.max - d.min) * spanRatio;
      var pl = {}; for (var k in params) pl[k] = params[k];
      var ph = {}; for (var k2 in params) ph[k2] = params[k2];
      pl[d.key] = clamp(params[d.key] - span, d.min, d.max);
      ph[d.key] = clamp(params[d.key] + span, d.min, d.max);
      var lo = estimate(moduleId, pl, variantId)[metricKey];
      var hi = estimate(moduleId, ph, variantId)[metricKey];
      list.push({
        key: d.key, label: d.label, unit: d.unit,
        lowVal: pl[d.key], highVal: ph[d.key],
        low: lo, high: hi, base: base,
        effect: Math.abs(hi - lo)
      });
    });
    list.sort(function (a, b) { return b.effect - a.effect; });
    return list;
  }

  /* 智能寻优：粗网格 + 坐标下降细化 */
  function optimize(moduleId, params, variantId, objectiveKey, goal, constraintId) {
    var M = getModule(moduleId);
    var objDef = { key: objectiveKey, dir: goal || 'max' };
    M.objectives.forEach(function (o) { if (o.key === objectiveKey) objDef = o; });
    var cons = { test: function () { return true; } };
    M.constraints.forEach(function (c) { if (c.id === constraintId) cons = c; });

    var dims = M.paramDefs.slice();
    var LEVELS = 4;
    var total = 0;
    var seen = [];
    var rnd = mulberry32(20240517);

    function evalP(p) {
      total++;
      var m = estimate(moduleId, p, variantId, { fast: true });
      var ok = cons.test(m);
      var obj = m[objDef.key];
      return { p: p, m: m, ok: ok, obj: obj };
    }

    // 粗网格
    var grid = [{ p: {}, i: 0 }];
    dims.forEach(function (d) {
      var next = [];
      for (var l = 0; l < LEVELS; l++) {
        var val = d.min + (d.max - d.min) * l / (LEVELS - 1);
        // 网格点略作偏置，避免全部落在极值
        if (l === 0) val = d.min + (d.max - d.min) * 0.03;
        if (l === LEVELS - 1) val = d.min + (d.max - d.min) * 0.97;
        grid.forEach(function (g) {
          var p = {}; for (var k in g.p) p[k] = g.p[k];
          p[d.key] = val;
          next.push({ p: p });
        });
      }
      grid = next;
    });

    var pop = grid.map(function (g) { return evalP(g.p); });
    // 基线工况也纳入候选
    pop.push(evalP(normalizeParams(M, params)));

    function better(a, b) {
      if (!b) return true;
      if (a.ok !== b.ok) return a.ok;
      var diff = a.obj - b.obj;
      var tol = 1e-3 * Math.max(1, Math.abs(b.obj));
      if (Math.abs(diff) > tol) return objDef.dir === 'max' ? diff > 0 : diff < 0;
      // 目标值几乎相同（饱和区）时，以综合评分打破平局，避免推荐病态工况
      if (objDef.key !== 'score') return (a.m.score || 0) > (b.m.score || 0);
      return objDef.dir === 'max' ? diff > 0 : diff < 0;
    }

    pop.sort(function (a, b) { return better(a, b) ? -1 : 1; });
    var best = pop[0];

    // 坐标下降细化
    for (var round = 0; round < 3; round++) {
      var improved = false;
      for (var di = 0; di < dims.length; di++) {
        var d = dims[di];
        var stepSize = (d.max - d.min) / (Math.pow(2, round + 2) * (LEVELS - 1));
        for (var s = -2; s <= 2; s++) {
          if (s === 0) continue;
          var p2 = {}; for (var kk in best.p) p2[kk] = best.p[kk];
          p2[d.key] = clamp(best.p[d.key] + s * stepSize, d.min, d.max);
          var cand = evalP(p2);
          if (better(cand, best)) { best = cand; improved = true; }
        }
      }
      if (!improved) break;
    }

    // 收集互不相同的 Top3 方案（满足约束的优先）
    var tops = [best];
    var pool = pop.concat([best]);
    pool.sort(function (a, b) { return better(a, b) ? -1 : 1; });
    var ordered = pool.filter(function (c) { return c.ok; })
      .concat(pool.filter(function (c) { return !c.ok; }));
    for (var t = 0; t < ordered.length && tops.length < 3; t++) {
      var cand2 = ordered[t];
      var dup = false;
      for (var u = 0; u < tops.length; u++) {
        // 展示用的前三项指标几乎一致 → 视为重复方案（备选方案需要有区分度）
        var sameResult = true;
        var cmpN = Math.min(3, M.outputDefs.length);
        for (var oi = 0; oi < cmpN; oi++) {
          var dk = M.outputDefs[oi].key;
          var av = cand2.m[dk], bv = tops[u].m[dk];
          if (Math.abs(av - bv) > 0.01 * Math.max(1, Math.abs(bv))) { sameResult = false; break; }
        }
        if (sameResult) { dup = true; break; }
        // 参数过于接近 → 视为重复方案
        var dist = 0, ans = 0;
        for (var kd in cand2.p) {
          var dd = null;
          M.paramDefs.forEach(function (x) { if (x.key === kd) dd = x; });
          if (!dd) continue;
          var nv = (cand2.p[kd] - tops[u].p[kd]) / (dd.max - dd.min);
          dist += nv * nv; ans++;
        }
        if (ans && Math.sqrt(dist / ans) < 0.10) { dup = true; break; }
      }
      if (!dup) tops.push(cand2);
    }

    return { candidates: tops, evaluated: total, objective: objDef, constraint: cons };
  }

  C.estimate = estimate;
  C.sweep = sweep;
  C.sensitivity = sensitivity;
  C.optimize = optimize;
})(typeof window !== 'undefined' ? window : globalThis);
