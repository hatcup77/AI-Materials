/* =========================================================================
 *  仿真内核 · 基础设施
 *  常量、数学工具、Canvas 工具、模块注册表、参数规范化
 *
 *  拆分后的加载顺序（浏览器按 <script> 顺序，Node 由 sim.js 依序 require）：
 *    core/base.js  →  modules/*.js  →  engine/*.js  →  sim.js
 *  模块只依赖 core，内核不认识任何具体实验，新增实验只需在 modules/ 加一个文件。
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.SimCore || (root.SimCore = {});

  var RGAS = 8.314;          // J/(mol·K)
  var K0 = 273.15;           // 0 ℃ 对应开尔文

  /* ------------------------------ 通用工具 ------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 场分布渲染随亮/暗主题切换配色（Node 环境下恒为深色） */
  function themeLight() {
    return typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.getAttribute('data-theme') === 'light';
  }
  function arr(Tk, Ea) { return Math.exp(-Ea * 1000 / (RGAS * Tk)); }
  function r6(v) { return Math.round(v * 1e6) / 1e6; }

  // 可复现伪随机数（保证同一实验每次渲染一致）
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 均匀采样时间轴
  function linspace(a, b, n) {
    var out = [], i;
    for (i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1));
    return out;
  }


  function docCreateCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* 模块注册表：各实验模块在自己的文件里注册，内核不认识具体模块 */
  var MODULES = {};
  var INTERNALS = {};

  function registerModule(def, internals) {
    if (!def || !def.id) throw new Error('registerModule: 模块必须有 id');

    /* 可选字段补齐：新实验只写模型与参数就能跑起来，
       界面上的优化目标、约束、说明文案都有兜底，不必逐个回忆协议。 */
    def.name = def.name || def.id;
    def.tag = def.tag || '';
    def.subtitle = def.subtitle || '';
    def.paramDefs = def.paramDefs || [];
    def.outputDefs = def.outputDefs || [];
    def.seriesDefs = def.seriesDefs || [];
    def.variants = def.variants || [{ id: 'default', name: def.name }];
    def.notes = def.notes || [];
    def.primaryKey = def.primaryKey || (def.outputDefs[0] && def.outputDefs[0].key);
    def.objectives = def.objectives ||
      (def.primaryKey ? [{ key: def.primaryKey, label: '主指标最优', dir: 'max' }] : []);
    def.constraints = def.constraints ||
      [{ id: 'none', label: '无约束', test: function () { return true; } }];

    MODULES[def.id] = def;
    INTERNALS[def.id] = internals || {};
  }

  function listModules() {
    var out = [];
    for (var k in MODULES) if (Object.prototype.hasOwnProperty.call(MODULES, k)) out.push(MODULES[k]);
    return out;
  }

  /* 模块内部函数（场构建器等）供实时引擎复用，不对外暴露 */
  function internals(id) { return INTERNALS[id] || {}; }

  /* ---------------------------- 界面配置表 ---------------------------- */
  /* 每个实验的预设工艺、可视化标题、洞察与诊断文案，由各自的 *.ui.js 注册。
     界面层只按 id 取配置，不认识具体实验，新增实验不必改主流程。 */
  var UI = {};

  function registerUI(def) {
    if (!def || !def.id) throw new Error('registerUI: 配置必须有 id');
    UI[def.id] = def;
  }

  function getUI(id) { return UI[id] || {}; }

  function getModule(id) { return MODULES[id] || MODULES.solid; }

  function findVariant(M, id) {
    for (var i = 0; i < M.variants.length; i++) if (M.variants[i].id === id) return M.variants[i];
    return M.variants[0];
  }

  function normalizeParams(M, params) {
    var out = {};
    M.paramDefs.forEach(function (d) {
      var v = params && params[d.key] != null ? +params[d.key] : d.def;
      out[d.key] = clamp(v, d.min, d.max);
    });
    return out;
  }

  function defaultParams(M, variantId) {
    var v = findVariant(M, variantId);
    var p = {};
    M.paramDefs.forEach(function (d) { p[d.key] = d.def; });
    if (v && v.defT != null) {
      if (p.T != null) p.T = v.defT;
      else if (p.Tset != null) p.Tset = v.defT;
    }
    // 热处理模块按牌号给出名义碳含量，其余模块没有 defC 字段，不受影响
    if (v && v.defC != null && p.C != null) p.C = v.defC;
    return p;
  }

  /* ------------------------------ 对外导出 ------------------------------ */
  C.RGAS = RGAS; C.K0 = K0;
  C.clamp = clamp; C.arr = arr; C.r6 = r6;
  C.mulberry32 = mulberry32; C.linspace = linspace; C.themeLight = themeLight;
  C.rrect = rrect; C.docCreateCanvas = docCreateCanvas;
  C.registerModule = registerModule;
  C.listModules = listModules;
  C.internals = internals;
  C.MODULES = MODULES;
  C.registerUI = registerUI;
  C.getUI = getUI;
  C.getModule = getModule;
  C.findVariant = findVariant;
  C.normalizeParams = normalizeParams;
  C.defaultParams = defaultParams;

})(typeof window !== 'undefined' ? window : globalThis);
