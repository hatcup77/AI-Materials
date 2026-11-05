/* =========================================================================
 *  仿真内核 · 单次运行
 *  把「模块 + 参数 + 材料」组装成一次可复现的实验记录
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});
  var getModule = C.getModule, normalizeParams = C.normalizeParams, findVariant = C.findVariant;

  var UID = 0;
  function createRun(moduleId, params, variantId, opts) {
    opts = opts || {};
    var M = getModule(moduleId);
    var p = normalizeParams(M, params);
    var v = findVariant(M, variantId);
    var res = M.simulate(p, v, opts);

    var metrics = {};
    var metricList = M.outputDefs.map(function (d) {
      var val = res.metrics[d.key];
      if (val == null || !isFinite(val)) val = 0;
      metrics[d.key] = val;
      return { key: d.key, label: d.label, unit: d.unit, digits: d.digits, value: val, primary: !!d.primary };
    });

    return {
      id: 'R' + (++UID) + '-' + Math.floor(Math.random() * 9000 + 1000),
      moduleId: moduleId,
      moduleName: M.name,
      variantId: v.id,
      variantName: v.name,
      color: null,
      params: p,
      paramDefs: M.paramDefs,
      outputDefs: M.outputDefs,
      variant: v,
      time: res.time,
      series: res.series,
      seriesDefs: M.seriesDefs,
      metrics: metricList,
      metricMap: metrics,
      primaryKey: M.primaryKey,
      field: res.field,
      extra: res.extra,
      ts: Date.now()
    };
  }

  C.createRun = createRun;
})(typeof window !== 'undefined' ? window : globalThis);
