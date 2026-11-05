/* =========================================================================
 *  AI+ 虚拟仿真材料实验平台 · 交互逻辑
 * ========================================================================= */
(function () {
  'use strict';

  var Sim = window.Sim;
  var Charts = window.Charts;
  var PALETTE = Charts.PALETTE;

  function $(s, r) { return (r || document).querySelector(s); }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  var state = {
    moduleId: 'solid',
    variantId: 'BT',
    params: {},
    current: null,
    runs: [],               // 已记录实验
    compare: [],            // 当前模块的 run id 列表
    compareByModule: {},    // 各模块各自的对比选择，切回不丢
    paramsByModule: {},     // 各模块各自调好的参数，切回不重置
    seq: { solid: 0, cvd: 0, rd: 0, kiln: 0 },
    frame: 1,
    playing: false,
    raf: null,
    lastTs: 0,
    live: { on: false, playing: false, rate: null, rateAuto: true, engine: null, tReal: 0, raf: null, last: 0, lastChart: 0, done: false },
    seriesVisible: {},
    sweepKey: 'T',
    cmpMetric: 'score',
    sens: null,
    runMs: 0,
    previewTimer: null
  };

  /* ----------------------------- 工具函数 ----------------------------- */
  function paramDef(key) {
    var M = Sim.getModule(state.moduleId), out = null;
    M.paramDefs.forEach(function (d) { if (d.key === key) out = d; });
    return out;
  }
  function digitsOf(def) {
    if (!def) return 1;
    return def.step >= 1 ? 0 : (def.step >= 0.1 ? 1 : 2);
  }
  /* 跨数量级的参数（如冷却速率 0.02~200 ℃/s）用对数滑块，
     线性滑块会让 0.02~1 这一段只占不到 1% 行程，低速段根本调不准。 */
  function toSlider(d, v) {
    var lo = Math.log(d.min), hi = Math.log(d.max);
    if (!(hi > lo)) return 0;
    return Math.round(1000 * (Math.log(Math.max(d.min, Math.min(d.max, v))) - lo) / (hi - lo));
  }
  function fromSlider(d, pos) {
    var lo = Math.log(d.min), hi = Math.log(d.max);
    if (!(hi > lo)) return d.min;
    return d.min * Math.exp((hi - lo) * pos / 1000);
  }
  function dynDigits(v) {
    var a = Math.abs(v);
    if (a >= 10) return 0;
    if (a >= 1) return 1;
    return 2;
  }
  function fmtNum(v, d) {
    if (v == null || !isFinite(v)) return '无';
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
    return v.toFixed(d == null ? 1 : d);
  }
  function fmtMetric(v, def) {
    if (v == null || !isFinite(v)) return '无';
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
    return v.toFixed(def ? def.digits : 1);
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function metricDef(run, key) {
    var out = null;
    (run.outputDefs || []).forEach(function (d) { if (d.key === key) out = d; });
    return out || { key: key, label: key, unit: '', digits: 1 };
  }
  function mv(run, key) { return run.metricMap[key]; }
  function seriesAt(run, key, frame) {
    var arr = run.series[key];
    if (!arr || !arr.length) return null;
    var i = Math.round(frame * (arr.length - 1));
    return arr[Math.max(0, Math.min(arr.length - 1, i))];
  }
  function runLabel(run) {
    return (run.seq ? '#' + run.seq + ' ' : '') + run.variantId;
  }
  function toast(msg, tone) {
    var wrap = $('#toastWrap');
    // 同时最多保留 3 条，避免批量操作时提示堆叠遮挡右侧面板
    while (wrap.children.length >= 3) wrap.removeChild(wrap.firstElementChild);
    var t = document.createElement('div');
    t.className = 'toast' + (tone === 'warn' ? ' warn' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 320);
    }, 1900);
  }

  /* -------------------------- 记录持久化（本标签页） -------------------------- */
  /* 只存参数、指标、曲线等可复用的数据，不存体积很大的场分布。
     sessionStorage 让刷新不丢记录，同时不把实验数据写到长期存储或服务器。 */
  var RUNS_KEY = 'hdu-lab-runs-v1';
  var PARAMS_KEY = 'hdu-lab-params-v1';
  var MAX_RUNS = 80;

  /* 参数单独存一份：拖滑块时不必反复序列化整张记录表 */
  function persistParams() {
    try {
      if (state.moduleId && state.params) {
        state.paramsByModule[state.moduleId] = {
          variantId: state.variantId,
          params: Sim.normalizeParams(Sim.getModule(state.moduleId), state.params)
        };
      }
      sessionStorage.setItem(PARAMS_KEY, JSON.stringify(state.paramsByModule));
    } catch (e) {}
  }

  function persistRuns() {
    try {
      var data = state.runs.map(function (r) {
        return {
          id: r.id, moduleId: r.moduleId, variantId: r.variantId, seq: r.seq,
          params: r.params, time: r.time, series: r.series, metricMap: r.metricMap,
          extra: r.extra, ts: r.ts, note: r.note || ''
        };
      });
      sessionStorage.setItem(RUNS_KEY, JSON.stringify({
        runs: data, compare: state.compareByModule
      }));
      persistParams();
    } catch (e) { /* 隐私模式或超配额时退化为内存记录 */ }
  }

  function restoreRuns() {
    var data = null, cmp = {};
    try {
      var raw = JSON.parse(sessionStorage.getItem(RUNS_KEY) || 'null');
      if (raw && raw.runs) { data = raw.runs; cmp = raw.compare || {}; }
      else if (Array.isArray(raw)) data = raw;   // 兼容早期只存数组的格式
      var praw = JSON.parse(sessionStorage.getItem(PARAMS_KEY) || 'null');
      if (praw && typeof praw === 'object') {
        Object.keys(praw).forEach(function (mid) {
          var e = praw[mid];
          if (!e || !e.params || !Sim.MODULES[mid]) return;
          state.paramsByModule[mid] = {
            variantId: e.variantId,
            params: Sim.normalizeParams(Sim.getModule(mid), e.params)
          };
        });
      }
    } catch (e) {}
    if (cmp && typeof cmp === 'object') state.compareByModule = cmp;
    if (!Array.isArray(data)) return;
    data.forEach(function (r) {
      if (!r || !Sim.MODULES[r.moduleId] || !r.params || !r.metricMap) return;
      var M = Sim.getModule(r.moduleId);
      var v = Sim.findVariant(M, r.variantId);
      var metrics = M.outputDefs.map(function (d) {
        var val = r.metricMap[d.key];
        return { key: d.key, label: d.label, unit: d.unit, digits: d.digits, value: val, primary: !!d.primary };
      });
      state.runs.push({
        id: r.id, moduleId: r.moduleId, moduleName: M.name,
        variantId: v.id, variantName: v.name, variant: v,
        params: r.params, paramDefs: M.paramDefs, outputDefs: M.outputDefs,
        seriesDefs: M.seriesDefs, primaryKey: M.primaryKey,
        time: r.time || [], series: r.series || {}, metrics: metrics,
        metricMap: r.metricMap, extra: r.extra || {},
        seq: r.seq, ts: r.ts || Date.now(), note: r.note || '', restored: true
      });
      if (r.seq > (state.seq[r.moduleId] || 0)) state.seq[r.moduleId] = r.seq;
    });
  }

  function capRuns() {
    // 防止长期试凑把存储和表格撑爆；优先保留已经加入对比的记录
    while (state.runs.length > MAX_RUNS) {
      var idx = -1;
      for (var i = 0; i < state.runs.length; i++) {
        if (state.compare.indexOf(state.runs[i].id) < 0) { idx = i; break; }
      }
      if (idx < 0) idx = 0;
      state.runs.splice(idx, 1);
    }
  }

  /* ------------------------------ 主题 ------------------------------ */
  var Theme = window.Theme;
  var THEME_KEY = Theme ? Theme.KEY : 'hdu-lab-theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function updateThemeBtn(t) {
    var btn = $('#btnTheme');
    if (!btn) return;
    btn.setAttribute('aria-checked', t === 'dark' ? 'true' : 'false');
    btn.setAttribute('title', t === 'dark' ? '切换到亮色模式' : '切换到深色模式');
  }

  /* 真正改变主题的动作：改属性 → 存盘 → Canvas 按新配色重绘。
     这段必须在 View Transition 的回调里同步跑完，
     否则新主题那一帧截到的是还没重绘的旧配色画布。 */
  function commitTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    updateThemeBtn(t);
    Charts.syncTheme();
    // Canvas 图表不继承 CSS，需要按新配色整体重绘
    renderAll();
    if (isTabActive('response')) renderSweep();
    renderCompare();
  }

  function applyTheme(t, silent) {
    if (!Theme) { commitTheme(t); return; }
    Theme.switchTo(t, {
      button: $('#btnTheme'),
      apply: function () { commitTheme(t); },
      done: function () {
        if (!silent) toast(t === 'light' ? '已切换到亮色模式' : '已切换到深色模式');
      }
    });
  }

  function initTheme() {
    updateThemeBtn(currentTheme());
    $('#btnTheme').addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ----------------------------- 初始化 ----------------------------- */
  /* 窄屏兜底：窗口不足 1180px 时提示一次，用户可关闭 */
  var narrowDismissed = false;
  function updateNarrowHint() {
    var el = $('#narrowHint');
    if (!el) return;
    var narrow = window.innerWidth < 1180;
    el.hidden = !(narrow && !narrowDismissed);
  }

  function init() {
    initTheme();
    bindTabs();
    bindModal();
    buildModuleSwitch();
    bindBenchControls();
    bindCompare();
    bindData();
    bindAi();
    restoreRuns();
    // 首页的模块卡片带 ?m=xxx 进来，直接落到对应实验
    var startId = 'solid';
    try {
      var qm = new URLSearchParams(location.search).get('m');
      if (qm && Sim.MODULES && Sim.MODULES[qm]) startId = qm;
      else {
        // 没有指定时回到上次用过的模块
        var lm = localStorage.getItem('hdu-lab-last-module');
        if (lm && Sim.MODULES && Sim.MODULES[lm]) startId = lm;
      }
    } catch (e) {}
    selectModule(startId);
    var resizeRaf = null;
    window.addEventListener('resize', function () {
      // 连续拖动窗口时合并到一帧，避免重复重绘两张画布
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = null;
        drawViz();
        renderProcessChart();
        updateNarrowHint();
      });
    });
    updateNarrowHint();
    var nhClose = $('#btnNarrowClose');
    if (nhClose) nhClose.addEventListener('click', function () {
      narrowDismissed = true;
      $('#narrowHint').hidden = true;
    });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { drawViz(); });
      ro.observe($('#vizCanvas'));
    }
    $('#btnGuide').addEventListener('click', openGuide);
    bindGlossary();
    bindLive();
    bindVizDrag();
  }

  /* 炉膛里直接拖动样品：把「位置」从滑块变成一个可以上手的东西 */
  function bindVizDrag() {
    var cv = $('#vizCanvas');
    if (!cv) return;
    var dragging = false;
    function local(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    cv.addEventListener('pointerdown', function (e) {
      // 能不能拖动由模块的场对象决定：只有实现了 hitTest / toPos 的场才响应，
      // 这样新增实验想支持拖动，在自己的场里补这两个方法即可。
      var f = state.current && state.current.field;
      if (!f || !f.hitTest) return;
      var q = local(e);
      if (!f.hitTest(q.x, q.y)) return;
      dragging = true;
      f._drag = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      cv.style.cursor = 'grabbing';
      // 实时演算时不要停播：位置变化走软重置，演算继续往前推
      if (!state.live.on) stopPlay();
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var f = state.current && state.current.field;
      if (!f || !f.toPos) return;
      var q = local(e);
      if (!dragging) {
        cv.style.cursor = f.hitTest && f.hitTest(q.x, q.y) ? 'grab' : '';
        f._hover = !!(f.hitTest && f.hitTest(q.x, q.y));
        return;
      }
      var pos = f.toPos(q.x, q.y);
      if (!pos) return;
      state.params.sx = Math.round(pos.sx);
      state.params.sy = Math.round(pos.sy);
      syncParamInputs();
      if (state.live.on) liveResetSoon();
      else schedulePreview(50);
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      if (state.current && state.current.field) state.current.field._drag = false;
      cv.style.cursor = 'grab';
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () { cv.style.cursor = ''; });
  }

  function buildModuleSwitch() {
    var box = $('#moduleSwitch');
    box.innerHTML = '';
    // 模块清单直接来自注册表：新增实验注册后按钮自动出现，主流程不用改
    Sim.listModules().forEach(function (M) {
      var id = M.id;
      var b = document.createElement('button');
      b.textContent = M.name;
      b.dataset.module = id;
      if (id === state.moduleId) b.className = 'active';
      b.addEventListener('click', function () {
        if (state.moduleId === id) return;
        selectModule(id);
      });
      box.appendChild(b);
    });
  }

  function selectModule(id) {
    clearTimeout(state.previewTimer);
    if (state.live.on) disableLive(false);
    // 先收下当前模块的调参与对比选择，再切走；学生查完别的模块回来不用重调
    if (state.booted && state.moduleId && state.params) {
      state.paramsByModule[state.moduleId] = {
        variantId: state.variantId,
        params: Sim.normalizeParams(Sim.getModule(state.moduleId), state.params)
      };
      state.compareByModule[state.moduleId] = state.compare.slice();
    }
    state.moduleId = id;
    document.body.setAttribute('data-module', id);
    try { localStorage.setItem('hdu-lab-last-module', id); } catch (e) {}
    var M = Sim.getModule(id);
    var saved = state.paramsByModule[id];
    state.variantId = saved && M.variants.some(function (v) { return v.id === saved.variantId; })
      ? saved.variantId : M.variants[0].id;
    state.params = saved
      ? Sim.normalizeParams(M, saved.params)
      : Sim.defaultParams(M, state.variantId);
    state.sens = null;
    state.frame = 1;
    // 新模块可能没有上一个模块选中的扫掠参数，回退到该模块首个参数
    var hasKey = M.paramDefs.some(function (d) { return d.key === state.sweepKey; });
    if (!hasKey) state.sweepKey = (M.paramDefs[0] || {}).key || 'T';

    $$('#moduleSwitch button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.module === id);
    });
    $('#moduleTag').textContent = M.name;

    state.seriesVisible = {};
    // 默认显示几条曲线由各实验声明：过程量多、互不遮挡的实验可以全开
    var sdef = Sim.getUI(id).seriesDefault;
    M.seriesDefs.forEach(function (s, i) {
      state.seriesVisible[s.key] = sdef === 'all' ? true : (typeof sdef === 'number' ? i < sdef : i < 2);
    });

    buildMaterialSelect();
    buildParams();
    buildPresets();
    buildSweepSwitch();
    buildAiForm();
    buildSeriesChips();
    buildCompareMetricSelect();
    $('#sweepNote').innerHTML = '';
    $('#aiOptResult').innerHTML = '';
    $('#aiOptStatus').textContent = '';
    $('#sensNote').textContent = '';
    $('#adviceList').innerHTML = '';
    Charts.clear($('#sensCanvas'));
    if ($('#sensEmpty')) $('#sensEmpty').classList.remove('hidden');
    Charts.clear($('#chartSweep'));

    runSim({ preview: true, silent: true });
    // 每个模块保留自己的对比列表，渲染时仍按模块过滤，切回来能恢复
    state.compare = (state.compareByModule[id] || []).filter(function (cid) {
      return state.runs.some(function (r) { return r.id === cid && r.moduleId === id; });
    });
    state.compareByModule[id] = state.compare.slice();
    persistRuns();
    state.booted = true;
    renderCompare();
    renderData();
    aiMarkModuleSwitch(M.name);
  }

  /* 切模块时明确断开上一轮上下文，避免模型拿着上一模块的数据答下一模块 */
  function aiMarkModuleSwitch(name) {
    if (!aiChat || !aiChat.msgs.length) return;
    aiChat.msgs = [];
    var box = $('#aiChat');
    if (!box) return;
    var sep = document.createElement('div');
    sep.className = 'ai-sep';
    sep.textContent = '已切换到「' + name + '」模块，上一轮对话上下文已清空';
    box.appendChild(sep);
    aiScroll();
  }

  function isTabActive(name) {
    var t = $('#mainTabs .tab.active');
    return !!t && t.dataset.tab === name;
  }

  /* --------------------------- 材料体系选择 --------------------------- */
  function buildMaterialSelect() {
    var M = Sim.getModule(state.moduleId);
    var sel = $('#materialSelect');
    sel.innerHTML = M.variants.map(function (v) {
      return '<option value="' + v.id + '">' + v.name + '</option>';
    }).join('');
    sel.value = state.variantId;
    sel.onchange = function () {
      var oldV = Sim.findVariant(M, state.variantId);
      state.variantId = sel.value;
      var newV = Sim.findVariant(M, sel.value);
      // 换材料只换材料本身，保留已经调好的温度、时间等条件；
      // 但如果温度还是上一材料的默认值，就跟着换成新材料的工作温度
      var next = Sim.normalizeParams(M, state.params);
      if (oldV && newV && oldV.defT != null && newV.defT != null &&
          Math.abs(next.T - oldV.defT) < 1e-6) next.T = newV.defT;
      if (oldV && newV && oldV.defT != null && newV.defT != null &&
          next.Tset != null && Math.abs(next.Tset - oldV.defT) < 1e-6) next.Tset = newV.defT;
      // 碳含量同理：还是上一牌号的名义值时才跟随，手动调过就保留
      if (oldV && newV && oldV.defC != null && newV.defC != null &&
          next.C != null && Math.abs(next.C - oldV.defC) < 1e-6) next.C = newV.defC;
      state.params = next;
      buildParams();
      persistParams();
      runSim({ preview: true });
    };
    updateMaterialNote();
  }

  function updateMaterialNote() {
    var M = Sim.getModule(state.moduleId);
    var v = Sim.findVariant(M, state.variantId);
    $('#materialNote').innerHTML = '<b>' + v.name + '</b>：' + v.note +
      '<span class="fml">' + v.formula + '</span>';
  }

  /* ------------------------------ 参数面板 ------------------------------ */
  /* 参数 → 术语：让「这个滑块到底在改什么」能一键查到 */
  var PARAM_GLOSS = {
    solid: { T: 'act-energy', C: 'stoichiometry', d0: 'specific-surface', t: 'jmak' },
    cvd: { T: 'surface-limited', P: 'mass-transport-limited', C: 'partial-pressure', Q: 'boundary-layer', t: 'deposition-rate' },
    rd: { T: 'reaction-diffusion', C0: 'second-order', cat: 'damkohler', tort: 'tortuosity', t: 'penetration-depth' },
    kiln: { Tset: 'setpoint', ramp: 'thermal-lag', hold: 'effective-hold', sx: 'loading-position', sy: 'loading-position' },
    heat: { C: 'carbon-content', Tset: 'austenitizing', ramp: 'thermal-lag', hold: 'grain-growth', cool: 'cct-curve', atm: 'furnace-atmosphere' }
  };

  function paramGlossId(key) {
    var map = PARAM_GLOSS[state.moduleId];
    return (map && map[key]) || '';
  }

  function buildParams() {
    var M = Sim.getModule(state.moduleId);
    var box = $('#paramList');
    box.innerHTML = '';
    M.paramDefs.forEach(function (d) {
      var item = document.createElement('div');
      item.className = 'param-item';
      item.dataset.key = d.key;
      var useLog = !!d.log;
      var cur = state.params[d.key];
      var dg = useLog ? dynDigits(cur) : digitsOf(d);
      var gid = paramGlossId(d.key);
      var gt = gid && window.GLOSSARY ? window.GLOSSARY.byId[gid] : null;
      item.innerHTML =
        '<div class="param-top">' +
          '<span class="param-name">' + d.label +
            (gt ? '<button class="param-q" data-gloss="' + gid + '" title="术语：' + gt.zh + '" aria-label="查看术语：' + gt.zh + '">?</button>' : '') +
          '</span>' +
          '<span class="param-val"><input class="v param-num" type="text" inputmode="decimal" ' +
            'value="' + cur.toFixed(dg) + '" title="点击输入精确数值，回车生效" ' +
            'aria-label="' + d.label + '精确数值">' +
          '<span class="u">' + d.unit + '</span></span>' +
        '</div>' +
        '<input type="range" class="param-range" min="' + (useLog ? 0 : d.min) + '" max="' + (useLog ? 1000 : d.max) +
          '" step="' + (useLog ? 1 : d.step) + '" value="' + (useLog ? toSlider(d, cur) : cur) + '">' +
        '<div class="param-hint">' + d.hint + '</div>';
      box.appendChild(item);

      var input = $('.param-range', item);
      var label = $('.v', item);
      paintRange(input);

      input.addEventListener('input', function () {
        var val = useLog ? fromSlider(d, parseFloat(input.value)) : parseFloat(input.value);
        state.params[d.key] = val;
        label.value = val.toFixed(useLog ? dynDigits(val) : dg);
        paintRange(input);
        persistParams();
        if (state.live.on) liveResetSoon();
        else schedulePreview();
      });
      input.addEventListener('change', function () {
        if (state.live.on) return;   // 实时下已由 input 的防抖软重置处理
        schedulePreview(0);
      });

      // 数值本身也是输入框：拖滑块适合扫范围，精确设值直接打字
      function commitNumber() {
        var raw = parseFloat(label.value);
        if (!isFinite(raw)) { label.value = state.params[d.key].toFixed(dg); return; }
        var val = Math.max(d.min, Math.min(d.max, raw));
        if (!useLog) {
          val = d.min + Math.round((val - d.min) / d.step) * d.step;
          val = Math.max(d.min, Math.min(d.max, val));
        }
        state.params[d.key] = val;
        input.value = useLog ? toSlider(d, val) : val;
        label.value = val.toFixed(useLog ? dynDigits(val) : dg);
        paintRange(input);
        persistParams();
        if (state.live.on) liveResetSoon();
        else schedulePreview(0);
      }
      label.addEventListener('change', commitNumber);
      label.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitNumber(); label.blur(); }
        else if (e.key === 'Escape') { label.value = state.params[d.key].toFixed(dg); label.blur(); }
      });
    });
    updateMaterialNote();
  }

  function paintRange(input) {
    var min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
    var pct = ((v - min) / (max - min)) * 100;
    input.style.background =
      'linear-gradient(90deg, ' + cssVar('--chart-1', '#3ddbe8') + ' ' + pct +
      '%, var(--fill-6) ' + pct + '%)';
  }

  function syncParamInputs() {
    $$('#paramList .param-item').forEach(function (item) {
      var key = item.dataset.key;
      var def = paramDef(key);
      var input = $('.param-range', item);
      var useLog = !!(def && def.log);
      var dg = useLog ? dynDigits(state.params[key]) : digitsOf(def);
      input.value = useLog ? toSlider(def, state.params[key]) : state.params[key];
      $('.v', item).value = state.params[key].toFixed(dg);
      paintRange(input);
    });
  }

  function schedulePreview(delay) {
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(function () {
      runSim({ preview: true, keepFrame: true });
    }, delay == null ? 220 : delay);
  }

  /* ------------------------------ 工艺预设 ------------------------------ */
  function buildPresets() {
    var presets = Sim.getUI(state.moduleId).presets || [];
    var box = $('#presetList');
    box.innerHTML = '';
    presets.forEach(function (ps) {
      var b = document.createElement('button');
      b.className = 'preset-btn';
      b.textContent = ps.name;
      b.addEventListener('click', function () {
        // 预设可以是字面量，也可以是按当前参数现算的函数
        // （如热处理要按当前碳含量定奥氏体化温度）
        var pv = typeof ps.p === 'function' ? ps.p(state.params) : ps.p;
        Object.keys(pv).forEach(function (k) {
          var d = paramDef(k);
          if (d) state.params[k] = Math.max(d.min, Math.min(d.max, pv[k]));
        });
        syncParamInputs();
        runSim({ preview: true });
        toast('已加载预设：' + ps.name);
      });
      box.appendChild(b);
    });
  }

  /* ------------------------------ 运行仿真 ------------------------------ */
  function runSim(opt) {
    opt = opt || {};
    // 实时模式下不预先算整段：参数预览走软重置（保留进度），
    // 点「运行仿真」才从头开始
    if (state.live.on) {
      if (opt.preview) liveSoftReset(true);
      else { liveReset(true); startLive(); }
      return;
    }
    var t0 = performance.now();
    var run = Sim.createRun(state.moduleId, state.params, state.variantId);
    state.runMs = performance.now() - t0;
    state.current = run;
    if (!opt.keepFrame) state.frame = 1;
    if (opt.preview && !opt.silent && state.playing) { /* 保持播放 */ }
    renderAll();
    if (isTabActive('response')) renderSweep();
    if (!opt.preview) {
      state.seq[state.moduleId] = (state.seq[state.moduleId] || 0) + 1;
      run.seq = state.seq[state.moduleId];
      state.runs.push(run);
      capRuns();
      persistRuns();
      renderData();
      renderCompare();
      toast('仿真完成 · ' + runLabel(run) + ' 已记入数据表');
    }
  }

  function renderAll() {
    renderKpis();
    renderProcessChart();
    renderVizHeader();
    drawViz();
    updateHud();
    if (!state.live.on) {
      renderInsights();
      renderAdvice();
    }
    updateTabInfo();
    if (state.sens) runSensitivity(true);
  }

  /* ------------------------------- KPI ------------------------------- */
  function renderKpis() {
    var run = state.current;
    var box = $('#kpiRow');
    box.innerHTML = '';
    var primaryKeys = [];
    run.outputDefs.forEach(function (d) {
      if (primaryKeys.length < 6) primaryKeys.push(d.key);
    });
    // 优先展示：主指标 + 关键指标
    primaryKeys.forEach(function (key, idx) {
      var d = metricDef(run, key);
      var val = mv(run, key);
      var color = PALETTE[idx % PALETTE.length] || Charts.THEME.mark;
      var meta = kpiMeta(run, key, val);
      var div = document.createElement('div');
      div.className = 'kpi';
      div.style.setProperty('--c', color);
      div.innerHTML =
        '<div class="k-label">' + d.label + '</div>' +
        '<div class="k-val">' + fmtMetric(val, d) + (d.unit ? '<small>' + d.unit + '</small>' : '') + '</div>' +
        '<div class="k-meta">' + meta + '</div>';
      box.appendChild(div);
    });
  }

  function kpiMeta(run, key, val) {
    var p = run.params;
    if (key === 'conversion') {
      if (p.Tset != null) {
        return val > 92 ? '已充分反应' : (val > 75 ? '接近完全，仍有缺口' : (val > 45 ? '反应不完全' : '明显欠温'));
      }
      return val > 98 ? '接近完全反应' : (val > 80 ? '主反应基本完成' : (val > 30 ? '反应不充分' : '几乎未发生反应'));
    }
    if (key === 'density') return val >= 98 ? '已达烧结致密' : (val >= 92 ? '致密度良好' : '存在明显孔隙');
    if (key === 'grain') {
      // 晶粒粗化是好是坏取决于用途：陶瓷烧结里粗化即缺陷，
      // 软磁材料里粗晶反而削弱晶界钉扎。这种口径差异由各实验自己声明。
      var grainHint = Sim.getUI(state.moduleId).grainHint;
      if (grainHint) return grainHint(val);
      return val > 30 ? '晶粒严重粗化' : (val > 12 ? '晶粒偏粗' : '细晶组织');
    }
    if (key === 'ratePeak') {
      var tPeak = run.extra && run.extra.tPeak;
      if (tPeak == null) tPeak = mv(run, 't90') * 0.3;
      return '极大值出现在 t ≈ ' + fmtNum(tPeak, 0) + ' min';
    }
    if (key === 't90') return val > 9999 ? '远超当前保温时间' : '工艺节奏参考';
    if (key === 'score') return val >= 85 ? '工艺窗口优良' : (val >= 65 ? '工艺尚可优化' : '工艺需调整');
    if (key === 'thickness') return '≈ ' + fmtNum(val / 1000, 2) + ' μm';
    if (key === 'rate') return '沉积效率指标';
    if (key === 'uniformity') return val >= 95 ? '满足量产要求' : '均匀性偏弱';
    if (key === 'rough') return val <= 2 ? '表面致密光滑' : '表面较粗糙';
    if (key === 'stress') return val < 0 ? '压应力' : '拉应力';
    if (key === 'penetration') return '浓度衰减至 10% 处';
    if (key === 'tPart') return '设定 ' + fmtNum(p.Tset, 0) + ' ℃ 是炉膛边界值';
    if (key === 'gap') return val > 60 ? '装炉位置造成的严重欠温' : (val > 30 ? '炉膛温度不均匀，样品明显未到温' : '接近设定温度');
    if (key === 'holdEff') {
      if (run.live && run.extra && run.extra.tRamp != null && run.extra.tEnd) {
        var nowT = state.frame * run.extra.tEnd;
        if (nowT < run.extra.tRamp) return '升温段 · 尚未进入保温';
      }
      return val < 1 ? '样品从未接近设定温度' : ('设定 ' + fmtNum(p.hold, 0) + ' min');
    }
    // 高碳钢退火态的矫顽力也很高（渗碳体多），不能一律归因为马氏体，按量级描述即可
    if (key === 'Hc') return val <= 200 ? '软磁可用水平' : (val <= 800 ? '磁性能一般' : (val <= 2500 ? '偏高，不宜做磁钢' : '矫顽力极高，已属硬磁范畴'));
    if (key === 'mu') return val >= 4000 ? '磁导率高' : (val >= 1500 ? '磁导率中等' : '磁导率低');
    if (key === 'HV') return val >= 500 ? '淬火态，硬而脆' : (val >= 300 ? '回火或贝氏体态' : (val >= 180 ? '正火态' : '退火态，软'));
    if (key === 'decarb') return val <= 0.15 ? '脱碳轻微' : (val <= 0.6 ? '脱碳明显' : '脱碳严重');
    if (key === 'fM') return val >= 80 ? '几乎全马氏体' : (val >= 20 ? '马氏体与珠光体混合' : '无明显马氏体');
    if (key === 'da') return val > 100 ? '反应控制' : (val > 1 ? '过渡区' : '扩散控制');
    if (key === 'grad') return '前沿陡峭程度';
    if (key === 'front') return '反应前沿平均速度';
    return '';
  }

  /* ----------------------------- 过程曲线 ----------------------------- */
  function buildSeriesChips() {
    var M = Sim.getModule(state.moduleId);
    var box = $('#seriesChips');
    box.innerHTML = '';
    M.seriesDefs.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'chip' + (state.seriesVisible[s.key] ? ' on' : '');
      b.dataset.key = s.key;
      b.innerHTML = '<span class="dot" style="background:' + s.color + '"></span>' + s.name;
      b.addEventListener('click', function () {
        state.seriesVisible[s.key] = !state.seriesVisible[s.key];
        b.classList.toggle('on', state.seriesVisible[s.key]);
        renderProcessChart();
      });
      box.appendChild(b);
    });
  }

  function renderProcessChart() {
    var run = state.current;
    if (!run) return;
    var M = Sim.getModule(state.moduleId);
    var series = M.seriesDefs
      .filter(function (s) { return state.seriesVisible[s.key]; })
      .map(function (s, i) {
        return {
          name: s.name,
          data: run.series[s.key],
          color: s.color,
          axis: s.axis,
          unit: s.unit,
          fill: i === 0,
          width: i === 0 ? 2.2 : 1.7,
          dashed: s.solid ? false : (s.axis === 'right')
        };
      });
    var primaryDef = metricDef(run, run.primaryKey);
    var tKey = paramDef('t');
    var markerOn = state.frame < 0.999;
    var rightVisible = series.filter(function (s) { return s.axis === 'right'; });
    var sameUnit = rightVisible.length > 1 && rightVisible.every(function (s) { return s.unit === rightVisible[0].unit; });
    var y2Label = rightVisible.length === 1
      ? ('右轴 · ' + rightVisible[0].name + (rightVisible[0].unit ? ' / ' + rightVisible[0].unit : ''))
      : (rightVisible.length > 1
        ? ('右轴 · ' + (sameUnit ? (rightVisible[0].unit === '℃' ? '温度' : '同量纲') + ' / ' + rightVisible[0].unit : '多指标'))
        : '');
    var xEnd = run.params.t != null ? run.params.t : ((run.extra && run.extra.tEnd) || 0);
    Charts.line($('#chartProcess'), {
      x: run.time,
      xMin: 0,
      xMax: xEnd > 0 ? xEnd : undefined,
      xLabel: '时间 / ' + (tKey ? tKey.unit : 'min'),
      yLabel: primaryDef.label + ' / ' + primaryDef.unit,
      y2Label: y2Label,
      xUnit: ' ' + (tKey ? tKey.unit : 'min'),
      xTipLabel: 't',
      series: series,
      markers: markerOn ? [{
        x: run.time[Math.round(state.frame * (run.time.length - 1))],
        y: seriesAt(run, run.primaryKey, state.frame),
        color: Charts.THEME.mark, label: '当前时刻'
      }] : []
    });
  }

  /* --------------------------- 场 / 组织可视化 --------------------------- */
  /* 各实验的界面契约：把运行结果整理成界面配置能直接用的上下文。
     实验侧只写「拿到这些数据该怎么描述」，不接触全局状态。 */
  function uiCtx(run) {
    run = run || state.current || {};
    var moduleId = run.moduleId || state.moduleId;
    var variantId = run.variantId || state.variantId;
    var M = Sim.getModule(moduleId);
    var p = run.params || {};
    var v = run.variant || Sim.findVariant(M, variantId);
    var map = run.metricMap || {};
    var extra = run.extra || {};

    function paramDefOf(key) {
      var d = null;
      M.paramDefs.forEach(function (x) { if (x.key === key) d = x; });
      return d;
    }
    function est(patch) {
      var q = {}; for (var k in p) q[k] = p[k];
      for (var k2 in patch) q[k2] = patch[k2];
      return Sim.estimate(moduleId, q, variantId);
    }

    return {
      run: run, M: M, p: p, v: v,
      extra: extra, field: run.field, theme: currentTheme(),
      mv: function (k) { return map[k]; },
      fmtNum: fmtNum, signed: signed,
      paramDef: paramDefOf, est: est
    };
  }

  function renderVizHeader() {
    var ui = Sim.getUI(state.moduleId);
    var viz = ui.viz || {};
    $('#vizTitle').textContent = viz.title || '过程可视化';
    $('#vizSub').textContent = viz.sub || '';
    $('#vizLegend').innerHTML = viz.legend ? viz.legend(uiCtx(state.current)) : '';
    $('#hudPUnit').textContent = metricDef(state.current, state.current.primaryKey).unit;
  }

  function drawViz() {
    var cv = $('#vizCanvas');
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    if (rect.width < 4) return;
    var dpr = window.devicePixelRatio || 1;
    var pw = Math.round(rect.width * dpr), ph = Math.round(rect.height * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    var run = state.current;
    if (run && run.field) {
      var prog = (run.live && run.fieldProg != null) ? run.fieldProg : state.frame;
      run.field.draw(ctx, rect.width, rect.height, prog);
    } else {
      ctx.fillStyle = cssVar('--canvas-bg', '#050a12');
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = cssVar('--txt3', 'rgba(140,170,205,0.5)');
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('正在计算场分布…', rect.width / 2, rect.height / 2);
    }
  }

  function updateHud() {
    var run = state.current;
    if (!run) return;
    var tk = paramDef('t');
    var unit = tk ? tk.unit : 'min';
    var tEnd = run.params.t != null ? run.params.t : ((run.extra && run.extra.tEnd) || 1);
    var t = tEnd * state.frame;
    $('#hudT').textContent = fmtNum(t, t < 10 ? 1 : 0);
    var pv;
    if (run.live) {
      pv = run.metricMap[run.primaryKey];
    } else {
      pv = seriesAt(run, run.primaryKey, state.frame);
    }
    $('#hudP').textContent = fmtNum(pv, 1);
    var def = metricDef(run, run.primaryKey);
    $('#hudPUnit').textContent = def.unit;
    $('#timeLabel').textContent = 't = ' + fmtNum(t, 1) + ' ' + unit;
    $('#timeline').value = Math.round(state.frame * 1000);
  }

  function bindBenchControls() {
    var btnPlay = $('#btnPlay');
    btnPlay.addEventListener('click', function () {
      if (state.live.on) {
        if (state.live.playing) stopLive();
        else startLive();
        return;
      }
      if (state.playing) stopPlay();
      else startPlay();
    });
    $('#btnRewind').addEventListener('click', function () {
      if (state.live.on) { liveReset(); return; }
      stopAll();
      state.frame = 0;
      updateHud();
      drawViz();
      renderProcessChart();
    });
    $('#timeline').addEventListener('input', function () {
      stopAll();
      state.frame = parseFloat(this.value) / 1000;
      updateHud();
      drawViz();
      renderProcessChart();
    });
    $('#btnRun').addEventListener('click', function () {
      // 实时模式下整件事交给 runSim（它会重置并开始演算），
      // 绝不能再启动 tick()，否则两套 rAF 同时推进，暂停键会失效
      if (state.live.on) { runSim({ preview: false }); return; }
      stopAll();
      runSim({ preview: false });
      state.frame = 1;
      updateHud();
      drawViz();
      setTimeout(function () { startPlay(); }, 120);
    });
  }

  /* ---------------------------- 实时演算 ---------------------------- */
  /* 时间换算：现实 1 秒推进多少模拟分钟（min/s）。这是绝对速率，与模块总时长无关，
     所以不同模块「多久走完」并不相同，状态条会直接给出预计秒数。
     滑杆 1~60 自由调节；没手动拖过时按模块总时长自动给一个值，让全程落在十几秒。 */
  var LIVE_RATE = 10;
  var LIVE_TARGET_SECONDS = 12.5;
  var LIVE_RATE_MIN = 1;
  var LIVE_RATE_MAX = 60;
  var liveTimer = null;

  function liveUnit() {
    var tk = paramDef('t');
    return tk ? tk.unit : 'min';
  }

  function liveSeconds(eng) {
    var L = state.live;
    if (!eng || !(eng.tEnd > 0) || !(L.rate > 0)) return 0;
    return eng.tEnd / L.rate;
  }

  function autoLiveRate(tEnd) {
    if (!(tEnd > 0)) return LIVE_RATE;
    return Math.max(LIVE_RATE_MIN, Math.min(LIVE_RATE_MAX, Math.round(tEnd / LIVE_TARGET_SECONDS)));
  }

  function syncRateUI() {
    var L = state.live;
    var r = L.rate > 0 ? L.rate : autoLiveRate(L.engine && L.engine.tEnd);
    var inp = $('#liveRate');
    var val = $('#liveRateVal');
    if (inp) inp.value = r;
    if (val) val.textContent = r;
  }

  function buildLiveRun(eng, snap) {
    var M = Sim.getModule(state.moduleId);
    var v = null;
    M.variants.forEach(function (x) { if (x.id === state.variantId) v = x; });
    var list = M.outputDefs.map(function (d) {
      var val = snap.metrics[d.key];
      if (val == null || !isFinite(val)) val = 0;
      return { key: d.key, label: d.label, unit: d.unit, digits: d.digits, value: val, primary: !!d.primary };
    });
    return {
      id: 'LIVE-' + state.moduleId,
      moduleId: state.moduleId,
      moduleName: M.name,
      variantId: state.variantId,
      variantName: v ? v.name : '',
      variant: v,
      params: eng.params,
      paramDefs: M.paramDefs,
      outputDefs: M.outputDefs,
      seriesDefs: M.seriesDefs,
      primaryKey: M.primaryKey,
      time: snap.time,
      series: snap.series,
      metrics: list,
      metricMap: snap.metrics,
      field: snap.field,
      fieldProg: snap.fieldProg,
      extra: snap.extra,
      live: true,
      ts: Date.now()
    };
  }

  function updateLiveMeta() {
    var eng = state.live.engine;
    if (eng && eng.tEnd > 0) {
      var sec = liveSeconds(eng);
      $('#liveMeta').textContent = '全程 ' + fmtNum(eng.tEnd, 0) + ' ' + liveUnit() +
        ' ≈ ' + fmtNum(sec, sec < 10 ? 1 : 0) + ' s';
    } else {
      $('#liveMeta').textContent = '';
    }
  }

  function bindLive() {
    $('#btnLive').addEventListener('click', function () {
      if (state.live.on) disableLive(true);
      else enableLive();
    });
    $('#liveRate').addEventListener('input', function (e) {
      var rt = parseInt(e.target.value, 10) || LIVE_RATE_MIN;
      state.live.rate = rt;
      state.live.rateAuto = false;   // 手动拖过之后，本模块内就固定这个速率
      $('#liveRateVal').textContent = rt;
      updateLiveMeta();
    });
    $('#btnKeep').addEventListener('click', keepLiveRun);
  }

  function enableLive() {
    var L = state.live;
    L.on = true;
    document.body.classList.add('live-on');
    $('#btnLive').setAttribute('aria-checked', 'true');
    $('#liveSpeed').hidden = false;
    $('#liveState').className = 'live-state on';
    $('#btnKeep').disabled = true;
    liveReset(true);          // 建引擎时顺带定下换算档位并刷新说明
    toast('实时演算已开启：结果不再预先算好，点 ▶ 逐步求解');
  }

  function disableLive(restore) {
    var L = state.live;
    stopLive();
    L.on = false;
    L.engine = null;
    L.done = false;
    // 绝对速率在不同模块意义不同，下次开启重新按模块自动挑档
    L.rate = null;
    L.rateAuto = true;
    document.body.classList.remove('live-on');
    $('#btnLive').setAttribute('aria-checked', 'false');
    $('#liveSpeed').hidden = true;
    $('#liveState').className = 'live-state';
    $('#liveState').textContent = '关闭时直接给出终值';
    $('#btnKeep').disabled = true;
    if (restore !== false) {
      runSim({ preview: true, silent: true });
      toast('已关闭实时演算，恢复直接给出终值');
    }
  }

  function liveReset(silent) {
    if (!state.live.on) return;
    stopLive();
    var eng = Sim.createLive(state.moduleId, state.params, state.variantId);
    if (state.live.rateAuto || !(state.live.rate > 0)) state.live.rate = autoLiveRate(eng.tEnd);
    state.live.engine = eng;
    state.live.tReal = 0;
    state.live.done = false;
    state.live.lastChart = 0;
    var snap = eng.snapshot();
    state.current = buildLiveRun(eng, snap);
    state.frame = 0;
    renderKpis();
    updateHud();
    drawViz();
    renderProcessChart();
    $('#btnPlay').textContent = '▶';
    $('#btnKeep').disabled = true;
    $('#liveState').className = 'live-state on';
    $('#liveState').textContent = '待开始 · 全程 ' + fmtNum(eng.tEnd, 0) + ' ' + liveUnit() +
      '（约 ' + fmtNum(liveSeconds(eng), 0) + ' s）';
    syncRateUI();
    updateLiveMeta();
    // 结果不再"已经摆在那里"：解读与诊断留到演算结束
    $('#insightGrid').innerHTML = '<div class="insight-item live-ph"><span class="ii">◷</span>' +
      '<span class="it">实时演算中：KPI 与过程曲线正随时间生长，实验解读与诊断建议在演算结束后生成。</span></div>';
    $('#adviceList').innerHTML = '<div class="advice live-ph">演算进行中，先观察主指标如何随时间与边界条件变化。</div>';
    $('#tabInfo').textContent = '实时演算 · 已记录 ' + state.runs.length + ' 组';
    if (!silent) toast('已重置到 t = 0');
  }

  function liveResetSoon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { liveSoftReset(true); }, 120);
  }

  /* 软重置：保留当前进度与播放状态，只按新参数重建引擎。
     拖动样品、调滑块都走这里，否则每动一下就回到 t = 0。 */
  function liveSoftReset(silent) {
    var L = state.live;
    if (!L.on) return;
    if (!L.engine) { liveReset(silent); return; }
    var keep = L.engine.progress;
    var wasPlaying = L.playing;
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = null;

    var eng = Sim.createLive(state.moduleId, state.params, state.variantId);
    if (L.rateAuto) L.rate = autoLiveRate(eng.tEnd);
    if (keep > 0.001 && !eng.done) eng.advance(keep * eng.tEnd);
    L.engine = eng;
    L.done = eng.done;
    L.playing = wasPlaying && !eng.done;
    L.last = performance.now();
    L.lastChart = 0;

    var snap = eng.snapshot();
    state.current = buildLiveRun(eng, snap);
    state.frame = snap.progress;
    renderKpis();
    updateHud();
    drawViz();
    renderProcessChart();
    syncRateUI();
    updateLiveMeta();
    $('#btnKeep').disabled = !L.done;

    if (L.done) { finishLive(); return; }

    $('#btnPlay').textContent = L.playing ? '❚❚' : '▶';
    $('#liveState').className = 'live-state on';
    $('#liveState').textContent = (L.playing ? '模拟 ' : '已暂停 · 模拟 ') +
      fmtNum(eng.t, eng.t < 10 ? 1 : 0) + ' / ' + fmtNum(eng.tEnd, 0) + ' ' + liveUnit() +
      (L.playing ? ' · 参数已更新' : '');
    if (L.playing) L.raf = requestAnimationFrame(liveTick);
    if (!silent && !L.playing) toast('参数已更新，演算从当前位置继续');
  }

  function startLive() {
    var L = state.live;
    stopPlay();          // 互斥：先停掉旧的终值回放循环
    if (!L.engine || L.engine.done) liveReset(true);
    if (!L.engine) return;
    L.playing = true;
    L.last = performance.now();
    $('#btnPlay').textContent = '❚❚';
    $('#liveState').className = 'live-state on';
    L.raf = requestAnimationFrame(liveTick);
  }

  function stopLive() {
    var L = state.live;
    L.playing = false;
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = null;
    $('#btnPlay').textContent = '▶';
    if (L.engine && !L.done) {
      $('#liveState').className = 'live-state on';
      $('#liveState').textContent = '已暂停 · 模拟 ' + fmtNum(L.engine.t, L.engine.t < 10 ? 1 : 0) +
        ' / ' + fmtNum(L.engine.tEnd, 0) + ' ' + liveUnit();
    }
  }

  function liveTick(ts) {
    var L = state.live;
    if (!L.playing || !L.engine) return;
    var dtReal = Math.min(0.12, Math.max(0, (ts - L.last) / 1000));
    L.last = ts;
    L.tReal += dtReal;
    var eng = L.engine;
    eng.advance(dtReal * (L.rate || LIVE_RATE));   // 现实 1 s → 模拟 L.rate 分钟
    // 切到数据/对比页时只推进求解，不重建快照也不重绘隐藏画布；切回实验台会补上一帧
    if (!isTabActive('bench')) {
      state.frame = eng.progress;
      $('#liveState').className = 'live-state on';
      $('#liveState').textContent = '模拟 ' + fmtNum(eng.t, eng.t < 10 ? 1 : 0) + ' / ' +
        fmtNum(eng.tEnd, 0) + ' ' + liveUnit() + ' · 实时 ' + fmtNum(L.tReal, 1) + ' s（后台推进）';
      if (eng.done) { finishLive(); return; }
      L.raf = requestAnimationFrame(liveTick);
      return;
    }
    var snap = eng.snapshot();
    state.current = buildLiveRun(eng, snap);
    state.frame = snap.progress;
    renderKpis();
    updateHud();
    drawViz();
    if (!L.lastChart || ts - L.lastChart > 90) {
      L.lastChart = ts;
      renderProcessChart();
    }
    $('#liveState').className = 'live-state on';
    $('#liveState').textContent = '模拟 ' + fmtNum(eng.t, eng.t < 10 ? 1 : 0) + ' / ' +
      fmtNum(eng.tEnd, 0) + ' ' + liveUnit() + ' · 实时 ' + fmtNum(L.tReal, 1) + ' s';
    if (eng.done) { finishLive(); return; }
    L.raf = requestAnimationFrame(liveTick);
  }

  function finishLive() {
    var L = state.live;
    L.playing = false;
    L.done = true;
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = null;
    var eng = L.engine;
    var snap = eng.snapshot();
    state.current = buildLiveRun(eng, snap);
    state.frame = 1;
    renderKpis();
    updateHud();
    drawViz();
    renderProcessChart();
    $('#btnPlay').textContent = '▶';
    $('#btnKeep').disabled = false;
    $('#liveState').className = 'live-state done';
    $('#liveState').textContent = '演算完成 · 实时 ' + fmtNum(L.tReal, 1) + ' s';
    $('#tabInfo').textContent = '实时演算完成 · 实时 ' + fmtNum(L.tReal, 1) + ' s · 已记录 ' + state.runs.length + ' 组';
    renderInsights();
    renderAdvice();
    toast('实时演算完成 · 实时用时 ' + fmtNum(L.tReal, 1) + ' s');
  }

  function keepLiveRun() {
    var eng = state.live.engine;
    if (!eng || !eng.done) return;
    var run = buildLiveRun(eng, eng.snapshot());
    state.seq[state.moduleId] = (state.seq[state.moduleId] || 0) + 1;
    run.seq = state.seq[state.moduleId];
    run.id = 'R' + run.seq + '-LIVE';
    state.current = run;
    state.runs.push(run);
    capRuns();
    persistRuns();
    renderData();
    renderCompare();
    $('#btnKeep').disabled = true;
    toast('已记入数据表 · ' + runLabel(run));
  }

  var PLAY_MS = 5200;
  function startPlay() {
    if (!state.current) return;
    stopLive();          // 互斥：实时引擎若还活着，先停掉
    if (state.frame >= 0.999) state.frame = 0;
    state.playing = true;
    $('#btnPlay').textContent = '❚❚';
    state.lastTs = performance.now();
    tick(performance.now());
  }
  function stopPlay() {
    state.playing = false;
    $('#btnPlay').textContent = '▶';
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    renderProcessChart();
  }

  /* 两套动画循环（终值回放 / 实时演算）必须一起停，否则 state.playing
     与 state.live.playing 会同时为真，按钮只处理其中一支，另一支停不下来 */
  function stopAll() {
    stopLive();
    stopPlay();
  }
  function tick(ts) {
    if (!state.playing) return;
    var dt = Math.min(80, ts - state.lastTs);
    state.lastTs = ts;
    state.frame = Math.min(1, state.frame + dt / PLAY_MS);
    // 页签不可见时只推进时间轴，不重绘隐藏画布
    if (isTabActive('bench')) {
      drawViz();
      updateHud();
      if (Math.random() < 0.34) renderProcessChart();
    }
    if (state.frame >= 1) {
      stopPlay();
      if (!isTabActive('bench')) { updateHud(); drawViz(); renderProcessChart(); }
      return;
    }
    state.raf = requestAnimationFrame(tick);
  }

  /* ----------------------------- 实验解读 ----------------------------- */
  function renderInsights() {
    var run = state.current;
    var items = buildInsights(run);
    var box = $('#insightGrid');
    box.innerHTML = items.map(function (it, i) {
      return '<div class="insight-item' + (it.warn ? ' warn' : '') + '">' +
        '<span class="ii">' + (i + 1) + '</span><span class="it">' + it.text + '</span></div>';
    }).join('');
  }

  function buildInsights(run) {
    var ui = Sim.getUI(run.moduleId || state.moduleId);
    if (!ui.insights) return [];
    return ui.insights(uiCtx(run));
  }

  function signed(v) { return (v >= 0 ? '+' : '') + fmtNum(v, 1); }

  /* --------------------------- 工艺诊断建议 --------------------------- */
  function renderAdvice() {
    var list = buildAdvice(state.current);
    $('#adviceList').innerHTML = list.map(function (a, i) {
      return '<div class="advice" style="--c:' + a.c + '"><span class="num">' + ('0' + (i + 1)).slice(-2) + '</span><span>' + a.t + '</span></div>';
    }).join('');
  }

  /* 诊断建议按「哪一组实验」生成：报告里要基于报告的那一组，不能拿当前预览工况的结论 */
  function buildAdvice(run) {
    var ui = Sim.getUI(run.moduleId || state.moduleId);
    if (!ui.advice) return [];
    return ui.advice(uiCtx(run));
  }

  function updateTabInfo() {
    var n = state.runs.filter(function (r) { return r.moduleId === state.moduleId; }).length;
    $('#tabInfo').textContent = state.live.on
      ? ('实时演算 · 已记录 ' + n + ' 组')
      : ('本次计算 ' + state.runMs.toFixed(1) + ' ms · 已记录 ' + n + ' 组');
  }

  /* --------------------------- 边界条件响应 --------------------------- */
  /* 同一组参数下的扫掠结果只算一次：切页签、切主题都不再重算 */
  var sweepCache = {};

  function cachedSweep(run, key, n) {
    var ck = state.moduleId + '|' + state.variantId + '|' + n + '|' + JSON.stringify(run.params);
    var bucket = sweepCache[ck];
    if (bucket && bucket[key]) return bucket[key];
    var res = Sim.sweep(state.moduleId, run.params, state.variantId, key, n);
    if (!bucket) {
      if (Object.keys(sweepCache).length > 24) sweepCache = {};
      bucket = sweepCache[ck] = {};
    }
    bucket[key] = res;
    return res;
  }

  function buildSweepSwitch() {
    var M = Sim.getModule(state.moduleId);
    var box = $('#sweepSwitch');
    box.innerHTML = '';
    M.paramDefs.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = shortName(d.key, d.label);
      if (d.key === state.sweepKey) b.className = 'active';
      b.dataset.key = d.key;
      b.addEventListener('click', function () {
        state.sweepKey = d.key;
        $$('#sweepSwitch button').forEach(function (x) { x.classList.toggle('active', x.dataset.key === d.key); });
        renderSweep();
      });
      box.appendChild(b);
    });
    // 扫掠图在 selectModule 完成本轮仿真后再渲染，避免读到上一个模块的 run
  }

  function shortName(key, label) {
    var map = { T: '温度', P: '压力', C: '配比', d0: '粒径', t: '时间', Q: '流量', C0: '浓度', cat: '催化', tort: '曲折度',
      Tset: '温度', ramp: '升温速率', hold: '保温', sx: '水平位置', sy: '垂直位置' };
    return map[key] || label;
  }

  function renderSweep() {
    var run = state.current;
    if (!run || run.moduleId !== state.moduleId) return;
    var M = Sim.getModule(state.moduleId);
    var key = state.sweepKey;
    var def = paramDef(key);
    if (!def) return;
    var pts = cachedSweep(run, key, 30);
    var pk = run.primaryKey;
    var pdef = metricDef(run, pk);

    var data = pts.map(function (pt) { return pt.metrics[pk]; });
    var scoreData = pts.map(function (pt) { return pt.metrics.score; });

    Charts.line($('#chartSweep'), {
      x: pts.map(function (pt) { return pt.x; }),
      xLabel: def.label + ' / ' + def.unit,
      yLabel: pdef.label + ' / ' + pdef.unit,
      xUnit: ' ' + def.unit,
      xTipLabel: def.label,
      series: [
        { name: pdef.label, data: data, color: PALETTE[0], fill: true, width: 2.2, unit: pdef.unit },
        { name: '综合评分', data: scoreData, color: PALETTE[1], axis: 'right', dashed: true, unit: '' }
      ],
      markers: [{
        x: run.params[key], y: mv(run, pk), color: Charts.THEME.mark,
        label: '当前 ' + fmtNum(run.params[key], digitsOf(def)) + ' ' + def.unit
      }],
      legend: true
    });

    var first = data[0], last = data[data.length - 1];
    var mid = data[Math.floor(data.length / 2)];
    var slope = (last - first) / (def.max - def.min);
    $('#sweepNote').innerHTML = '在其余条件固定为当前工况时，<b>' + def.label + '</b> 从 ' + def.min + ' ' + def.unit +
      ' 增至 ' + def.max + ' ' + def.unit + '，' + pdef.label + ' 由 <b>' + fmtNum(first, pdef.digits) + '</b> 变为 <b>' +
      fmtNum(last, pdef.digits) + ' ' + pdef.unit + '</b>，平均变化率约 <b>' + (slope >= 0 ? '+' : '') +
      fmtNum(slope, 3) + ' ' + pdef.unit + '/' + def.unit + '</b>。' +
      (Math.abs(slope) > 0 ? '曲线形态反映该边界条件的作用机制：单调段对应 Arrhenius 或幂律关系，出现平台段则说明体系进入了输运/饱和控制区。' : '');

    // 各参数影响幅度卡片
    var cards = [];
    M.paramDefs.forEach(function (d) {
      if (d.key === key) return;
      var s = cachedSweep(run, d.key, 8);
      if (!s.length) return;
      var v0 = s[0].metrics[pk], v1 = s[s.length - 1].metrics[pk];
      var range = Math.abs(v1 - v0);
      cards.push({ d: d, v0: v0, v1: v1, range: range });
    });
    cards.sort(function (a, b) { return b.range - a.range; });

    var maxR = 0;
    cards.forEach(function (c) { maxR = Math.max(maxR, c.range); });

    $('#sweepCards').innerHTML = cards.map(function (c) {
      var flag = c.range < maxR * 0.02 && maxR > 0.01 ? '<span style="color:var(--txt3);font-weight:400"> · 已饱和</span>' : '';
      return '<div class="sweep-card">' +
        '<h4>' + c.d.label + ' · 影响幅度 ' + fmtNum(c.range, 1) + flag + '</h4>' +
        '<div class="sc-row"><span>' + c.d.min + ' ' + c.d.unit + '</span><b>' + fmtNum(c.v0, pdef.digits) + '</b></div>' +
        '<div class="sc-row"><span>' + c.d.max + ' ' + c.d.unit + '</span><b>' + fmtNum(c.v1, pdef.digits) + '</b></div>' +
        '<div class="sc-row"><span>当前值</span><b style="color:var(--chart-1)">' + fmtNum(run.params[c.d.key], digitsOf(c.d)) + ' ' + c.d.unit + '</b></div>' +
        '</div>';
    }).join('');
  }

  /* ----------------------------- 对比分析 ----------------------------- */
  function bindTabs() {
    $$('#mainTabs .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('#mainTabs .tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $$('.tab-body').forEach(function (b) { b.classList.toggle('active', b.dataset.body === t.dataset.tab); });
        if (t.dataset.tab === 'response') renderSweep();
        if (t.dataset.tab === 'compare') renderCompare();
        if (t.dataset.tab === 'data') renderData();
        setTimeout(function () { drawViz(); renderProcessChart(); }, 30);
      });
    });
  }

  function bindCompare() {
    $('#btnAddCompare').addEventListener('click', function () {
      var run = state.current;
      if (!run) return;
      // 实时快照的 id 恒为 LIVE-<模块>，不在 state.runs 里，
      // 直接推进对比列表会得到一条永远解析不到的记录
      var recorded = state.runs.some(function (r) { return r.id === run.id; });
      if (!recorded) {
        toast(state.live.on ? '实时演算请先点「记入数据表」，再加入对比' : '该结果尚未记录', 'warn');
        return;
      }
      if (state.compare.indexOf(run.id) >= 0) { toast('该结果已在对比列表中', 'warn'); return; }
      if (state.compare.length >= 5) { toast('最多同时对比 5 组实验', 'warn'); return; }
      setCompare(state.compare.concat([run.id]));
      renderCompare();
      toast('已加入对比：' + runLabel(run));
    });
    $('#btnClearCompare').addEventListener('click', function () {
      setCompare([]);
      renderCompare();
      toast('对比列表已清空');
    });
    $('#cmpMetricSelect').addEventListener('change', function () {
      state.cmpMetric = this.value;
      renderCompare();
    });
  }

  function currentModuleRuns() {
    return state.runs.filter(function (r) { return r.moduleId === state.moduleId; });
  }

  /* 对比选择的写入口：同时更新当前模块的列表与按模块存档 */
  function setCompare(ids) {
    state.compare = ids;
    state.compareByModule[state.moduleId] = ids.slice();
    persistRuns();
  }

  function compareRuns() {
    var ids = state.compare;
    return ids.map(function (id) {
      return state.runs.filter(function (r) {
        return r.id === id && r.moduleId === state.moduleId;
      })[0];
    }).filter(Boolean);
  }

  function buildCompareMetricSelect() {
    var M = Sim.getModule(state.moduleId);
    var sel = $('#cmpMetricSelect');
    sel.innerHTML = M.outputDefs.map(function (d) {
      return '<option value="' + d.key + '">' + d.label + (d.unit ? ' / ' + d.unit : '') + '</option>';
    }).join('');
    var has = M.outputDefs.some(function (d) { return d.key === state.cmpMetric; });
    if (!has) state.cmpMetric = M.outputDefs[0].key;
    sel.value = state.cmpMetric;
  }

  function renderCompare() {
    var list = compareRuns();
    $('#cmpCount').textContent = list.length;
    $('#cmpHint').textContent = list.length
      ? '对比当前模块（' + Sim.getModule(state.moduleId).name + '）的 ' + list.length + ' 组工况'
      : '运行仿真后点击「加入当前结果」开始对比';

    var emptyA = $('#cmpEmptyA'), emptyB = $('#cmpEmptyB');
    if (!list.length) {
      $('#cmpChartSub').textContent = '归一化主指标随时间的演化';
      $('#cmpBarSub').textContent = '综合评分';
      emptyA.classList.remove('hidden');
      emptyB.classList.remove('hidden');
      // 空态叠层是半透明底，不清画布会透出上一个模块的旧曲线
      Charts.clear($('#chartCompare'));
      Charts.clear($('#chartCompareBar'));
      $('#compareTableWrap').innerHTML = '<div class="empty-state"><span class="es-ico">▦</span>' +
        '对比数据表为空<br>可同时对比最多 5 组实验条件</div>';
      return;
    }
    emptyA.classList.add('hidden');
    emptyB.classList.add('hidden');

    var run0 = list[0];
    var pk = run0.primaryKey;
    var pdef = metricDef(run0, pk);
    var cmpAxis = Sim.getUI(state.moduleId).compareAxis;
    var xMax = Math.max.apply(null, list.map(function (r) {
      return r.params.t != null ? r.params.t : ((r.extra && r.extra.tEnd) || 1);
    }));

    // 各组时长可能不同（只改保温时间就是这种情况）。原先前端只用一个 x 数组，
    // 短时长的曲线会被横向拉伸到最长那一组，结论会反过来，所以这里统一重采样。
    var ref = run0.time || [];
    var sameAxis = true, maxLen = ref.length;
    list.forEach(function (r) {
      var t = r.time || [];
      if (t.length > maxLen) maxLen = t.length;
      if (sameAxis) {
        if (t.length !== ref.length) sameAxis = false;
        else {
          for (var i = 0; i < ref.length; i++) {
            if (Math.abs(t[i] - ref[i]) > 1e-6) { sameAxis = false; break; }
          }
        }
      }
    });

    var grid = [];
    if (sameAxis) {
      grid = ref.concat([]);
    } else {
      var N = Math.max(2, maxLen);
      for (var gi = 0; gi < N; gi++) grid.push(xMax * gi / (N - 1));
    }

    function resample(r) {
      var d = r.series[pk], t = r.time;
      if (!d || !t || !t.length) return [];
      if (sameAxis) return d;
      var out = [], j = 0, last = t.length - 1;
      for (var i = 0; i < grid.length; i++) {
        var x = grid[i];
        // 超出该组结束时长的部分留空，曲线自然停在真实终点，不做延长
        if (x > t[last] + 1e-9) { out.push(null); continue; }
        while (j < last - 1 && t[j + 1] < x) j++;
        if (x <= t[0] || last === 0) { out.push(d[0]); continue; }
        var f = (x - t[j]) / Math.max(1e-12, t[j + 1] - t[j]);
        f = f < 0 ? 0 : (f > 1 ? 1 : f);
        var a = d[j], b = d[j + 1];
        if (a == null) { out.push(b == null ? null : b); continue; }
        if (b == null) { out.push(a); continue; }
        out.push(a + (b - a) * f);
      }
      return out;
    }

    var series = list.map(function (r, i) {
      var tu = paramDef('T') ? paramDef('T').unit : '';
      var tag = cmpAxis ? cmpAxis.tag(r.params) : (r.params.T + tu);
      return {
        name: (r.seq ? '#' + r.seq : r.variantId) + ' ' + r.variantId + ' ' + tag,
        data: resample(r),
        color: PALETTE[i % PALETTE.length],
        unit: pdef.unit,
        width: 2
      };
    });
    $('#cmpChartSub').textContent = pdef.label + ' / ' + pdef.unit +
      (cmpAxis ? cmpAxis.note : ' 随时间的演化');
    Charts.line($('#chartCompare'), {
      x: grid,
      xMin: 0, xMax: xMax,
      xLabel: '时间 / min', xUnit: ' min', xTipLabel: 't',
      yLabel: pdef.label + ' / ' + pdef.unit,
      series: series,
      legend: true, padLeft: 58
    });

    var md = metricDef(run0, state.cmpMetric);
    $('#cmpBarSub').textContent = md.label + (md.unit ? ' / ' + md.unit : '');
    Charts.bar($('#chartCompareBar'), {
      categories: list.map(function (r) {
        return runLabel(r) + (cmpAxis ? ' · ' + cmpAxis.short(r) : '');
      }),
      series: [{
        name: md.label,
        data: list.map(function (r) { return r.metricMap[state.cmpMetric]; }),
        color: PALETTE[0],
        unit: md.unit
      }],
      rotate: true,
      colorByCategory: true,
      yLabel: md.label
    });

    // 表格
    var paramCols = Sim.getModule(state.moduleId).paramDefs;
    var metricCols = run0.outputDefs;
    var html = '<table class="grid-table"><thead><tr><th>实验</th><th>材料体系</th>';
    paramCols.forEach(function (d) { html += '<th>' + d.label + ' / ' + d.unit + '</th>'; });
    metricCols.forEach(function (d) { html += '<th>' + d.label + (d.unit ? ' / ' + d.unit : '') + '</th>'; });
    html += '<th class="col-actions">操作</th></tr></thead><tbody>';
    list.forEach(function (r, i) {
      var color = PALETTE[i % PALETTE.length];
      html += '<tr><td><span class="row-dot" style="background:' + color + '"></span>' + runLabel(r) + '</td>' +
        '<td class="cell-dim">' + r.variantName + '</td>';
      paramCols.forEach(function (d) {
        html += '<td>' + fmtNum(r.params[d.key], digitsOf(d)) + '</td>';
      });
      metricCols.forEach(function (d) {
        var cls = d.key === pk ? 'cell-strong' : '';
        html += '<td class="' + cls + '">' + fmtMetric(r.metricMap[d.key], d) + '</td>';
      });
      html += '<td class="col-actions"><button class="link-btn" data-del="' + r.id + '">移除</button></td></tr>';
    });
    html += '</tbody></table>';
    $('#compareTableWrap').innerHTML = html;
    $$('#compareTableWrap [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        setCompare(state.compare.filter(function (id) { return id !== b.dataset.del; }));
        renderCompare();
      });
    });
  }

  /* ------------------------------ 数据表 ------------------------------ */
  function bindData() {
    $('#btnExport').addEventListener('click', exportCsv);
    $('#btnReport').addEventListener('click', openReport);
    $('#btnPrint').addEventListener('click', function () { window.print(); });
    $('#btnClearData').addEventListener('click', function () {
      var list = currentModuleRuns();
      if (!list.length) { toast('当前模块没有可清空的记录', 'warn'); return; }
      if (!window.confirm('确定清空当前模块的 ' + list.length + ' 条记录吗？此操作不可撤销。')) return;
      var removed = {};
      list.forEach(function (r) { removed[r.id] = true; });
      state.runs = state.runs.filter(function (r) { return !removed[r.id]; });
      setCompare(state.compare.filter(function (id) { return !removed[id]; }));
      persistRuns();
      renderData();
      renderCompare();
      toast('已清空本模块记录');
    });
  }

  function renderData() {
    var list = currentModuleRuns();
    $('#dataCount').textContent = list.length;
    var wrap = $('#dataTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state"><span class="es-ico">▤</span>' +
        '当前模块尚无实验记录<br>在「虚拟实验台」点击「运行仿真」后自动记录</div>';
      return;
    }
    var M = Sim.getModule(state.moduleId);
    var metricCols = list[0].outputDefs;
    var html = '<table class="grid-table"><thead><tr><th>#</th><th>材料体系</th>';
    M.paramDefs.forEach(function (d) { html += '<th>' + d.label + ' / ' + d.unit + '</th>'; });
    metricCols.forEach(function (d) { html += '<th>' + d.label + (d.unit ? ' / ' + d.unit : '') + '</th>'; });
    html += '<th class="col-note">备注</th><th class="col-time">时间</th><th class="col-actions">操作</th></tr></thead><tbody>';
    list.slice().reverse().forEach(function (r) {
      var isCur = state.current && r.id === state.current.id;
      html += '<tr class="' + (isCur ? 'current' : '') + '"><td>' + (r.seq || '·') + '</td><td class="cell-dim">' + r.variantName + '</td>';
      M.paramDefs.forEach(function (d) {
        html += '<td>' + fmtNum(r.params[d.key], digitsOf(d)) + '</td>';
      });
      metricCols.forEach(function (d) {
        var cls = d.primary ? 'cell-strong' : '';
        html += '<td class="' + cls + '">' + fmtMetric(r.metricMap[d.key], d) + '</td>';
      });
      html += '<td class="col-note"><input class="row-note" data-note="' + r.id + '" value="' + escHtml(r.note || '') +
        '" placeholder="写一句结论…" aria-label="第 ' + (r.seq || '') + ' 组备注"></td>';
      html += '<td class="col-time cell-dim">' + new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</td>';
      html += '<td class="col-actions"><button class="link-btn" data-add="' + r.id + '">对比</button>' +
        '<button class="link-btn danger" data-remove="' + r.id + '">删除</button></td></tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    $$('[data-add]', wrap).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.add;
        if (state.compare.indexOf(id) >= 0) { toast('已在对比列表中', 'warn'); return; }
        if (state.compare.length >= 5) { toast('最多同时对比 5 组实验', 'warn'); return; }
        setCompare(state.compare.concat([id]));
        renderCompare();
        toast('已加入对比');
      });
    });
    $$('[data-remove]', wrap).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.remove;
        state.runs = state.runs.filter(function (r) { return r.id !== id; });
        setCompare(state.compare.filter(function (cid) { return cid !== id; }));
        persistRuns();
        renderData();
        renderCompare();
        toast('已删除该条记录');
      });
    });
    $$('[data-note]', wrap).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var run = state.runs.filter(function (r) { return r.id === inp.dataset.note; })[0];
        if (!run) return;
        run.note = inp.value.trim();
        persistRuns();
        toast('备注已保存');
      });
    });
  }

  function exportCsv() {
    var list = currentModuleRuns();
    if (!list.length) { toast('暂无数据可导出', 'warn'); return; }
    var M = Sim.getModule(state.moduleId);
    var metricCols = list[0].outputDefs;
    var head = ['序号', '模块', '材料体系'];
    M.paramDefs.forEach(function (d) { head.push(d.label + '/' + d.unit); });
    metricCols.forEach(function (d) { head.push(d.label + (d.unit ? '/' + d.unit : '')); });
    head.push('备注');
    function csvCell(v) {
      var s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var rows = [head.map(csvCell).join(',')];
    list.forEach(function (r) {
      var row = [r.seq || '', r.moduleName, r.variantName];
      M.paramDefs.forEach(function (d) { row.push(r.params[d.key]); });
      metricCols.forEach(function (d) { row.push(r.metricMap[d.key].toFixed(3)); });
      row.push(r.note || '');
      rows.push(row.map(csvCell).join(','));
    });
    var csv = '\ufeff' + rows.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '虚拟仿真实验数据_' + M.name + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('已导出 ' + list.length + ' 条记录');
  }

  /* ------------------------------ AI 助手 ------------------------------ */
  function bindAi() {
    $('#btnOptimize').addEventListener('click', doOptimize);
    $('#btnSens').addEventListener('click', function () { runSensitivity(false); });
    initAiCollapse();
    bindAiChat();
    bindAiConfig();
    updateAiTag();
  }

  /* ---------- 右栏可收起：展开 / 收起两种形态 ---------- */
  var AI_COLLAPSE_KEY = 'hdu-lab-ai-collapsed';

  function setAiCollapsed(on, silent) {
    on = !!on;
    document.body.classList.toggle('ai-collapsed', on);
    var rail = $('#btnAiExpand');
    var btn = $('#btnAiCollapse');
    if (rail) rail.setAttribute('aria-expanded', on ? 'false' : 'true');
    if (btn) btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    try { localStorage.setItem(AI_COLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
    // 栏宽变化后中间实验区也会变宽，画布需要按新尺寸重画一次
    requestAnimationFrame(function () {
      drawViz();
      if (!on) {
        var cv = $('#sensCanvas');
        if (cv && cv.__chart) Charts.render(cv);
      }
    });
    if (!silent && !on) toast('AI 实验助手已展开');
  }

  function initAiCollapse() {
    var rail = $('#btnAiExpand');
    var btn = $('#btnAiCollapse');
    if (rail) rail.addEventListener('click', function () { setAiCollapsed(false); });
    if (btn) btn.addEventListener('click', function () { setAiCollapsed(true); });
    var saved = '0';
    try { saved = localStorage.getItem(AI_COLLAPSE_KEY) || '0'; } catch (e) {}
    setAiCollapsed(saved === '1', true);
  }

  /* ---------- 外部大模型：配置、上下文、对话 ---------- */
  var AI = window.AIAPI;
  var aiChat = { busy: false, stream: null, msgs: [], ctxAcked: false, pending: null };

  var AI_SYSTEM =
    '你是杭州电子科技大学材料科学与工程学院「虚拟仿真实验平台」的助教，负责解释实验现象、诊断工艺问题、' +
    '给出下一步实验建议。用户是正在做虚拟仿真的本科生。要求：先给结论再给依据；涉及数值时直接引用用户给的数据；' +
    '不要编造平台上没有的指标；不确定就说明；用简体中文，条理清楚，控制在 300 字以内。' +
    '可以用无序列表分段，但不要使用 Markdown 表格。';

  function aiMd(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 列表：先识别成段落标记，渲染成真正的列表
    var lines = s.split('\n');
    var out = [], inList = false, listType = '';
    function closeList() {
      if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; listType = ''; }
    }
    lines.forEach(function (line) {
      var t = line.trim();
      var um = t.match(/^[-*·•]\s+(.*)$/);
      var om = t.match(/^(\d+)[.、)]\s+(.*)$/);
      if (um) {
        if (!inList || listType !== 'ul') { closeList(); out.push('<ul>'); inList = true; listType = 'ul'; }
        out.push('<li>' + um[1] + '</li>');
        return;
      }
      if (om) {
        if (!inList || listType !== 'ol') { closeList(); out.push('<ol>'); inList = true; listType = 'ol'; }
        out.push('<li>' + om[2] + '</li>');
        return;
      }
      closeList();
      out.push(t === '' ? '<br>' : '<p>' + t + '</p>');
    });
    closeList();
    s = out.join('');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return s;
  }

  function aiScroll() {
    var box = $('#aiChat');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function aiPushMsg(role, text) {
    var box = $('#aiChat');
    if (!box) return null;
    var empty = $('#aiChatEmpty');
    if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
    var el = document.createElement('div');
    el.className = 'ai-msg ' + role;
    el.innerHTML = aiMd(text);
    box.appendChild(el);
    aiScroll();
    return el;
  }

  function updateAiTag() {
    if (!AI) return;
    var cfg = AI.readConfig();
    var on = AI.isConfigured(cfg);
    var tag = $('#aiTag');
    if (tag) {
      tag.textContent = on ? '已接入' : '本地模型';
      tag.classList.toggle('ok', on);
      tag.title = on ? (cfg.model + ' · ' + AI.endpoint(cfg.base)) : '当前只使用本地规则模型';
    }
    var chip = $('#aiModelChip');
    if (chip) {
      chip.textContent = on ? cfg.model : '未接入';
      chip.classList.toggle('on', on);
      chip.title = on ? AI.endpoint(cfg.base) : '';
    }
  }

  /* 把当前实验摊成一段纯文本，作为每次提问的前缀 */
  function buildAiContext() {
    var run = state.current;
    var M = Sim.getModule(state.moduleId);
    var L = [];
    L.push('【当前模块】' + M.name + (M.subtitle ? '（' + M.subtitle + '）' : ''));
    if (!run) return L.join('\n');
    L.push('【材料体系】' + run.variantName);
    L.push('【实验条件】' + M.paramDefs.map(function (d) {
      return d.label + ' ' + fmtNum(run.params[d.key], digitsOf(d)) + ' ' + d.unit;
    }).join('；'));
    var outs = (run.metrics || []).map(function (m) {
      return m.label + ' ' + fmtMetric(m.value, m) + (m.unit ? ' ' + m.unit : '');
    });
    if (outs.length) L.push('【结果指标】' + outs.join('；'));
    var adv = $$('#adviceList .advice');
    if (adv.length) {
      L.push('【平台本地诊断】' + adv.map(function (a) {
        return a.textContent.replace(/^\s*\d+[.、]?\s*/, '').trim();
      }).join(' / '));
    }
    var rec = state.runs.length;
    if (rec) L.push('【已记录实验】' + rec + ' 组' + (state.compare.length ? '，其中 ' + state.compare.length + ' 组在对比中' : ''));
    if (state.live.on && state.live.engine) {
      var eng = state.live.engine;
      L.push('【演算状态】实时演算进行到 ' + fmtNum(eng.t, 1) + ' / ' + fmtNum(eng.tEnd, 0) +
        ' ' + liveUnit() + '（现实 1 s ≈ 模拟 ' + state.live.rate + ' min）');
    }
    return L.join('\n');
  }

  function setAiBusy(on) {
    aiChat.busy = on;
    var btn = $('#btnAiSend');
    if (!btn) return;
    btn.textContent = on ? '停止' : '发送';
    btn.classList.toggle('danger', on);
    btn.classList.toggle('primary', !on);
  }

  function aiSend(text) {
    if (aiChat.busy) return;
    var q = String(text == null ? $('#aiInput').value : text).trim();
    if (!q) return;
    var cfg = AI.readConfig();
    if (!AI.isConfigured(cfg)) {
      toast('先接入一个外部大模型', 'warn');
      openAiConfig();
      return;
    }
    // 首次携带实验上下文前明确告知数据流向，学生确认后再发
    if (cfg.useContext !== false && !aiChat.ctxAcked) {
      aiChat.pending = q;
      var ep = $('#aiNoticeEp');
      if (ep) ep.textContent = AI.endpoint(cfg.base);
      $('#aiDataNotice').hidden = false;
      return;
    }
    doAiSend(q, cfg);
  }

  function doAiSend(q, cfg) {
    aiPushMsg('user', q);
    $('#aiInput').value = '';
    aiResizeInput();

    var sys = AI_SYSTEM;
    if (cfg.useContext !== false) sys += '\n\n以下是学生当前的实验状态，回答时请结合它：\n' + buildAiContext();

    var history = aiChat.msgs.slice(-8).map(function (m) { return { role: m.role, content: m.content }; });
    var messages = [{ role: 'system', content: sys }].concat(history, [{ role: 'user', content: q }]);
    aiChat.msgs.push({ role: 'user', content: q });

    var bubble = aiPushMsg('bot', '');
    bubble.innerHTML = '<span class="ai-cursor"></span>';
    var full = '';
    var status = $('#aiChatStatus');
    status.className = 'ai-status busy';
    status.textContent = '正在请求 ' + cfg.model + ' …';
    setAiBusy(true);

    // 停止后立刻重发时，旧请求的回调可能晚到，用序号挡掉
    aiChat.seq = (aiChat.seq || 0) + 1;
    var mySeq = aiChat.seq;
    function alive() { return aiChat.seq === mySeq; }

    function finish(ok, msg) {
      if (!alive()) return;
      aiChat.stream = null;
      setAiBusy(false);
      status.className = 'ai-status';
      status.textContent = msg || '';
      if (ok) aiChat.msgs.push({ role: 'assistant', content: full });
      aiScroll();
    }

    aiChat.stream = AI.streamChat(cfg, messages, {
      onDelta: function (d) {
        if (!alive()) return;
        full += d;
        bubble.innerHTML = aiMd(full) + '<span class="ai-cursor"></span>';
        aiScroll();
      },
      onDone: function () {
        if (!alive()) return;
        bubble.innerHTML = aiMd(full) || '（模型没有返回内容）';
        finish(true, '');
      },
      onError: function (msg) {
        if (!alive()) return;
        if (msg === '__aborted__') {
          if (full.trim()) {
            bubble.innerHTML = aiMd(full);
          } else {
            bubble.className = 'ai-msg bot err';
            bubble.textContent = '已停止生成';
          }
          finish(false, '已停止生成');
          return;
        }
        bubble.className = 'ai-msg bot err';
        bubble.textContent = msg;
        // 失败后给一个重试入口，不用重新打字
        var retry = document.createElement('button');
        retry.className = 'ai-retry';
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', function () {
          if (aiChat.busy) return;
          bubble.remove();
          aiSend(q);
        });
        bubble.appendChild(retry);
        finish(false, '');
      }
    });
  }

  function aiResizeInput() {
    var t = $('#aiInput');
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(96, t.scrollHeight + 2) + 'px';
  }

  function bindAiChat() {
    if (!AI) return;
    $('#btnAiSend').addEventListener('click', function () {
      if (aiChat.busy) {
        if (aiChat.stream) aiChat.stream.abort();
        return;
      }
      aiSend();
    });
    $('#aiInput').addEventListener('keydown', function (e) {
      // 中文输入法选词时按 Enter 也会触发，isComposing / keyCode 229 要放过
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        if (!aiChat.busy) aiSend();
      }
    });
    $('#aiInput').addEventListener('input', aiResizeInput);
    $('#aiQuick').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-q]') : null;
      if (!b || aiChat.busy) return;
      aiSend(b.dataset.q);
    });
    $('#btnAiConfig').addEventListener('click', openAiConfig);
    $('#btnAiConfig2').addEventListener('click', openAiConfig);
    var clearBtn = $('#btnAiClear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (aiChat.busy) { toast('正在生成，先停止再清空', 'warn'); return; }
      aiChat.msgs = [];
      aiChat.ctxAcked = false;
      var box = $('#aiChat');
      if (box) box.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'ai-chat-empty';
      empty.id = 'aiChatEmpty';
      empty.innerHTML = '<span class="ace-ico">✧</span>' +
        '<p>接入外部大模型后，可以把当前实验条件与结果一并发过去提问。</p>' +
        '<button class="btn ghost sm" id="btnAiConfig2" type="button">接入外部 API</button>';
      box.appendChild(empty);
      var c2 = $('#btnAiConfig2');
      if (c2) c2.addEventListener('click', openAiConfig);
      var st = $('#aiChatStatus');
      if (st) st.textContent = '';
    });
    var okBtn = $('#btnAiNoticeOk');
    if (okBtn) okBtn.addEventListener('click', function () {
      aiChat.ctxAcked = true;
      $('#aiDataNotice').hidden = true;
      var p = aiChat.pending;
      aiChat.pending = null;
      if (p) aiSend(p);
    });
    var cancelBtn = $('#btnAiNoticeCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      aiChat.pending = null;
      $('#aiDataNotice').hidden = true;
    });
  }

  function bindAiConfig() {
    if (!AI) return;
    $('#aiCfgPreset').addEventListener('change', function () {
      var id = this.value;
      var ps = AI.PRESETS.filter(function (p) { return p.id === id; })[0];
      if (!ps) return;
      if (ps.base) $('#aiCfgBase').value = ps.base;
      if (ps.model) $('#aiCfgModel').value = ps.model;
      setCfgStatus('', '');
    });
    $('#btnAiCfgSave').addEventListener('click', function () {
      var cfg = AI.saveConfig(readConfigForm());
      aiChat.ctxAcked = false;      // 换了接口，数据流向要重新告知
      updateAiTag();
      $('#aiConfigModal').classList.remove('open');
      toast(cfg.base && cfg.model ? '已保存：' + cfg.model : '配置已保存');
    });
    $('#btnAiCfgClear').addEventListener('click', function () {
      AI.clearConfig();
      fillAiConfigForm(AI.readConfig());
      updateAiTag();
      setCfgStatus('已清除本机保存的配置', '');
    });
    $('#btnAiCfgTest').addEventListener('click', function () {
      var btn = this;
      var cfg = readConfigForm();
      if (!cfg.base || !cfg.model) { setCfgStatus('先填接口地址和模型名', 'err'); return; }
      btn.disabled = true;
      setCfgStatus('正在请求 ' + AI.endpoint(cfg.base) + ' …', 'busy');
      AI.testConnection(cfg).then(function (r) {
        setCfgStatus(r.msg, r.ok ? 'ok' : 'err');
        btn.disabled = false;
      });
    });
  }

  function setCfgStatus(msg, kind) {
    var el = $('#aiCfgStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'ai-cfg-status' + (kind ? ' ' + kind : '');
  }

  function fillAiConfigForm(cfg) {
    $('#aiCfgPreset').innerHTML = AI.PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    $('#aiCfgPreset').value = cfg.preset || 'custom';
    $('#aiCfgBase').value = cfg.base || '';
    $('#aiCfgModel').value = cfg.model || '';
    $('#aiCfgKey').value = cfg.key || '';
    $('#aiCfgTemp').value = cfg.temp;
    $('#aiCfgMax').value = cfg.maxTokens;
    $('#aiCfgContext').checked = cfg.useContext !== false;
    setCfgStatus('', '');
  }

  function readConfigForm() {
    return {
      preset: $('#aiCfgPreset').value,
      base: $('#aiCfgBase').value.trim(),
      model: $('#aiCfgModel').value.trim(),
      key: $('#aiCfgKey').value.trim(),
      temp: parseFloat($('#aiCfgTemp').value),
      maxTokens: parseInt($('#aiCfgMax').value, 10),
      useContext: $('#aiCfgContext').checked
    };
  }

  function openAiConfig() {
    fillAiConfigForm(AI.readConfig());
    $('#aiConfigModal').classList.add('open');
    setTimeout(function () {
      var b = $('#aiCfgBase');
      if (b) b.focus();
    }, 80);
  }

  function buildAiForm() {
    var M = Sim.getModule(state.moduleId);
    var obj = $('#aiObjective');
    obj.innerHTML = M.objectives.map(function (o) {
      return '<option value="' + o.key + '">' + o.label + '</option>';
    }).join('');
    var cons = $('#aiConstraint');
    cons.innerHTML = M.constraints.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + '</option>';
    }).join('');
    if (M.constraints.length > 1) cons.value = M.constraints[1].id;
  }

  function doOptimize() {
    var run = state.current;
    if (!run) return;
    var btn = $('#btnOptimize');
    var status = $('#aiOptStatus');
    btn.disabled = true;
    status.className = 'ai-status busy';
    status.textContent = '正在评估参数组合…';
    $('#aiOptResult').innerHTML = '';
    var objKey = $('#aiObjective').value;
    var consId = $('#aiConstraint').value;
    var snap = JSON.parse(JSON.stringify(run.params));
    var variant = state.variantId;

    setTimeout(function () {
      var t0 = performance.now();
      var res = Sim.optimize(state.moduleId, snap, variant, objKey, 'max', consId);
      var ms = performance.now() - t0;
      status.className = 'ai-status';
      status.innerHTML = '已评估 <b>' + res.evaluated + '</b> 组条件（' + ms.toFixed(0) + ' ms），推荐方案如下：';
      renderOptResult(res);
      btn.disabled = false;
    }, 40);
  }

  function renderOptResult(res) {
    var M = Sim.getModule(state.moduleId);
    var box = $('#aiOptResult');
    box.innerHTML = res.candidates.map(function (c, i) {
      var params = M.paramDefs.map(function (d) {
        return '<span>' + shortName(d.key, d.label) + ' <b>' + fmtNum(c.p[d.key], digitsOf(d)) + '</b>' + d.unit + '</span>';
      }).join('');
      var kv = M.outputDefs.slice(0, 3).map(function (d) {
        return '<span>' + d.label + ' <b>' + fmtMetric(c.m[d.key], d) + '</b>' + d.unit + '</span>';
      }).join('');
      return '<div class="opt-card' + (i === 0 ? ' best' : '') + '">' +
        '<span class="opt-rank">' + (i === 0 ? '最优' : '备选 ' + i) + '</span>' +
        '<h4>' + (c.ok ? '满足全部约束' : '未完全满足约束') + '</h4>' +
        '<div class="opt-params">' + params + '</div>' +
        '<div class="opt-metrics">' + kv + '</div>' +
        '<button class="opt-apply" data-idx="' + i + '">应用到实验台</button>' +
        '</div>';
    }).join('');
    box.__cands = res.candidates;
    $$('.opt-apply', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var c = box.__cands[+b.dataset.idx];
        Object.keys(c.p).forEach(function (k) {
          var d = paramDef(k);
          if (d) state.params[k] = Math.max(d.min, Math.min(d.max, c.p[k]));
        });
        syncParamInputs();
        runSim({ preview: true });
        toast('已应用 AI 推荐参数，可运行仿真验证');
      });
    });
  }

  function runSensitivity(silent) {
    var run = state.current;
    if (!run) return;
    var pk = run.primaryKey;
    var pdef = metricDef(run, pk);
    var list = Sim.sensitivity(state.moduleId, run.params, state.variantId, pk, 0.15);
    state.sens = list;
    if (!list.length) return;
    Charts.tornado($('#sensCanvas'), {
      items: list.map(function (s) { return { label: s.label, low: s.low, high: s.high }; }),
      base: list[0].base
    });
    var sensEmpty = $('#sensEmpty');
    if (sensEmpty) sensEmpty.classList.add('hidden');
    var top = list[0];
    var span = (top.high - top.low);
    var maxEffect = 0;
    list.forEach(function (s) { maxEffect = Math.max(maxEffect, Math.abs(s.high - s.low)); });
    if (maxEffect < Math.max(0.5, Math.abs(top.base) * 0.01)) {
      $('#sensNote').innerHTML = '当前工况下 <b>' + pdef.label + '</b> 已接近饱和，各边界条件在 ±15% 量程内的扰动均不产生显著变化。' +
        '建议先调整到非饱和工况（如降低温度或缩短时间）再进行分析。';
      return;
    }
    $('#sensNote').innerHTML = '<span style="color:var(--chart-6)">■</span> 参数 −15% &nbsp;<span style="color:var(--chart-1)">■</span> 参数 +15%<br>' +
      '主指标 <b>' + pdef.label + '</b> 对 <b>' + top.label + '</b> 最敏感：' +
      '在 ±15% 量程内变化时，结果波动 <b>' + fmtNum(Math.abs(span), pdef.digits) + ' ' + pdef.unit + '</b>' +
      '（' + fmtNum(top.lowVal, digitsOf(paramDef(top.key))) + '→' + fmtNum(top.highVal, digitsOf(paramDef(top.key))) +
      ' ' + top.unit + '）。';
  }

  /* ------------------------------ 弹窗 ------------------------------ */
  function bindModal() {
    $$('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m) m.classList.remove('open');
      });
      // 焦点陷阱：Tab 在弹窗内循环，不会跑到背后的实验台去
      m.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', m)
          .filter(function (el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        var act = document.activeElement;
        if (e.shiftKey && (act === first || !m.contains(act))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (act === last || !m.contains(act))) {
          e.preventDefault(); first.focus();
        }
      });
    });
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById(b.dataset.close).classList.remove('open');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.modal').forEach(function (m) { m.classList.remove('open'); });
    });
  }

  /* ---------------------------- 术语资料库 ---------------------------- */
  var glState = { cat: 'all', q: '' };

  function glEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function glMark(s, q) {
    var out = glEsc(s);
    if (!q) return out;
    var safe = q.replace(/[&<>]/g, '');
    if (!safe) return out;
    var re = new RegExp('(' + safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return out.replace(re, '<mark>$1</mark>');
  }

  function glMatch(t, q) {
    if (!q) return true;
    // 只由符号/标点组成的查询（如 "(" "*"）没有检索意义，直接判为不匹配
    if (!/[\w\u4e00-\u9fa5]/.test(q)) return false;
    var G = window.GLOSSARY || {};
    var c = (G.catById || {})[t.cat] || {};
    var hay = [t.zh, t.en, t.abbr, t.sym, t.def, t.why, t.pit, c.name, c.short]
      .join(' ').toLowerCase();
    var words = q.split(/\s+/).filter(Boolean);
    return words.every(function (w) {
      // 中文按子串匹配；拉丁词按词边界匹配，避免 "Da" 命中 "boundary"
      if (/[\u4e00-\u9fa5]/.test(w)) return hay.indexOf(w) >= 0;
      var re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
      return re.test(hay);
    });
  }

  function moduleLabel(id) {
    try { return Sim.getModule(id).name; } catch (e) { return id; }
  }

  function renderGlossary() {
    var G = window.GLOSSARY;
    if (!G) return;
    var q = glState.q.trim().toLowerCase();

    var chips = '<button class="gl-cat' + (glState.cat === 'all' ? ' active' : '') + '" data-cat="all">' +
      '全部<em>' + G.terms.length + '</em></button>';
    G.cats.forEach(function (c) {
      var n = G.terms.filter(function (t) { return t.cat === c.id; }).length;
      chips += '<button class="gl-cat' + (glState.cat === c.id ? ' active' : '') + '" data-cat="' + c.id + '">' +
        c.short + '<em>' + n + '</em></button>';
    });
    $('#glCats').innerHTML = chips;

    var list = G.terms.filter(function (t) {
      return (glState.cat === 'all' || t.cat === glState.cat) && glMatch(t, q);
    });
    if (q) {
      // 标题命中优先，避免关键词只在正文里出现时把结果压到后面
      var score = function (t) {
        var s = 0;
        if (t.zh.toLowerCase().indexOf(q) >= 0) s += 4;
        if ((t.en + ' ' + (t.abbr || '') + ' ' + (t.sym || '')).toLowerCase().indexOf(q) >= 0) s += 2;
        return s;
      };
      list.sort(function (a, b) { return score(b) - score(a); });
    }

    $('#glCount').textContent = q || glState.cat !== 'all'
      ? '显示 ' + list.length + ' / ' + G.terms.length + ' 条'
      : '共 ' + G.terms.length + ' 条';

    if (!list.length) {
      $('#glBody').innerHTML = '<div class="gl-empty"><b>没有匹配的术语</b>' +
        '<p>换个说法试试：活化能、Damköhler、Da、边界、热滞后，或点上方分类。</p></div>';
      return;
    }

    var catName = {};
    G.cats.forEach(function (c) { catName[c.id] = c.short; });

    var html = '';
    list.forEach(function (t) {
      var sym = (t.sym || '').trim();
      var abbr = (t.abbr || '').trim();
      // 短符号（k、α、ΔT）放标题当徽标，长公式单独成行
      var badge = abbr || (sym.length <= 4 ? sym : '');
      var formula = sym && sym !== badge ? sym : '';
      html += '<article class="gl-item" data-id="' + t.id + '" tabindex="0" role="button" aria-expanded="false">' +
        '<div class="gl-item-head">' +
          '<div class="gl-item-title">' +
            '<h4><span class="gl-zh">' + glMark(t.zh, q) + '</span>' + (badge ? '<span class="gl-sym">' + glEsc(badge) + '</span>' : '') + '</h4>' +
            '<p class="gl-en">' + glMark(t.en, q) + (t.unit ? '<span class="gl-unit"> · ' + glEsc(t.unit) + '</span>' : '') + '</p>' +
          '</div>' +
          '<span class="gl-badge">' + (catName[t.cat] || '') + '</span>' +
          '<span class="gl-arrow">▾</span>' +
        '</div>' +
        (formula ? '<p class="gl-formula">' + glEsc(formula) + '</p>' : '') +
        '<p class="gl-def">' + glMark(t.def, q) + '</p>' +
        '<div class="gl-detail">' +
          '<div class="gl-line"><span class="gl-k">工程意义</span><p>' + glMark(t.why, q) + '</p></div>' +
          '<div class="gl-line"><span class="gl-k warn">常见误区</span><p>' + glMark(t.pit, q) + '</p></div>' +
          (t.rel && t.rel.length
            ? '<div class="gl-rel">相关：' + t.rel.map(function (rid) {
                var r = G.byId[rid];
                return r ? '<a data-rel="' + rid + '">' + glEsc(r.zh) + '</a>' : '';
              }).join('') + '</div>'
            : '') +
          (t.mod
            ? '<button class="gl-go" data-go="' + t.mod + '" data-param="' + (t.param || '') + '">' +
              '在「' + moduleLabel(t.mod) + '」中查看 →</button>'
            : '') +
        '</div>' +
      '</article>';
    });
    $('#glBody').innerHTML = html;
    $('#glBody').scrollTop = 0;
  }

  function openGlossary() {
    if (!window.GLOSSARY) { toast('术语资料库未加载', 'warn'); return; }
    glState.cat = 'all';
    glState.q = '';
    $('#glSearch').value = '';
    $('#glSearch').parentNode.classList.remove('has-q');
    renderGlossary();
    $('#glossaryModal').classList.add('open');
  }

  /* 从参数面板的小问号进来：直接定位到那一条术语并展开 */
  function openGlossaryAt(id) {
    var G = window.GLOSSARY;
    if (!G || !G.byId[id]) { openGlossary(); return; }
    glState.cat = G.byId[id].cat;
    glState.q = '';
    $('#glSearch').value = '';
    $('#glSearch').parentNode.classList.remove('has-q');
    renderGlossary();
    $('#glossaryModal').classList.add('open');
    setTimeout(function () {
      var el = $('#glBody .gl-item[data-id="' + id + '"]');
      if (!el) return;
      el.classList.add('open', 'flash');
      el.setAttribute('aria-expanded', 'true');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () { el.classList.remove('flash'); }, 1700);
    }, 130);
  }

  function gotoModuleParam(mod, param) {
    $$('.modal').forEach(function (m) { m.classList.remove('open'); });
    if (mod !== state.moduleId) selectModule(mod);
    if (!param) return;
    setTimeout(function () {
      var el = $('#paramList .param-item[data-key="' + param + '"]');
      if (!el) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(function () { el.classList.remove('flash'); }, 2200);
    }, 260);
  }

  function bindGlossary() {
    $('#btnGlossary').addEventListener('click', openGlossary);

    // 参数名旁的小问号（容器常驻，参数项会重建，用事件委托）
    $('#paramList').addEventListener('click', function (e) {
      var q = e.target.closest ? e.target.closest('.param-q') : null;
      if (!q) return;
      e.preventDefault();
      e.stopPropagation();
      openGlossaryAt(q.dataset.gloss);
    });

    $('#glSearch').addEventListener('input', function (e) {
      glState.q = e.target.value;
      // 输入关键词时自动回到「全部」，否则在某个分类下搜索会得到空结果
      if (glState.q.trim() && glState.cat !== 'all') glState.cat = 'all';
      $('#glSearch').parentNode.classList.toggle('has-q', !!glState.q);
      renderGlossary();
    });
    $('#glClear').addEventListener('click', function () {
      glState.q = '';
      $('#glSearch').value = '';
      $('#glSearch').parentNode.classList.remove('has-q');
      renderGlossary();
      $('#glSearch').focus();
    });
    $('#glCats').addEventListener('click', function (e) {
      var b = e.target.closest('.gl-cat');
      if (!b) return;
      glState.cat = b.dataset.cat;
      renderGlossary();
    });
    $('#glBody').addEventListener('click', function (e) {
      var jump = e.target.closest('.gl-go');
      if (jump) {
        e.stopPropagation();
        gotoModuleParam(jump.dataset.go, jump.dataset.param);
        return;
      }
      var rel = e.target.closest('[data-rel]');
      if (rel) {
        e.stopPropagation();
        var target = window.GLOSSARY.byId[rel.dataset.rel];
        if (target) {
          glState.cat = 'all';
          glState.q = target.zh;
          $('#glSearch').value = target.zh;
          $('#glSearch').parentNode.classList.add('has-q');
          renderGlossary();
          var card = $('#glBody .gl-item');
          if (card) card.classList.add('open');
        }
        return;
      }
      var item = e.target.closest('.gl-item');
      if (!item) return;
      var open = item.classList.toggle('open');
      item.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('#glBody').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest ? e.target.closest('.gl-item') : null;
      if (!item || e.target.closest('.gl-go')) return;
      e.preventDefault();
      item.click();
    });
  }

  function openGuide() {
    var M = Sim.getModule(state.moduleId);
    var ui = Sim.getUI(state.moduleId);
    $('#guideModule').textContent = M.name;
    var html = '';
    var aim = (ui.guide && ui.guide.aim) ? ui.guide.aim(M) : '';

    html += '<div class="guide-tip">术语不熟？点右上角「术语库」（' +
      (window.GLOSSARY ? window.GLOSSARY.count : '') +
      ' 条，支持中英文与符号搜索），' +
      '或点左侧参数名后的小问号，直接跳到该参数对应的词条。</div>';
    html += '<div class="guide-sec"><h3>一、实验目的</h3><p>' + aim + '</p></div>';

    html += '<div class="guide-sec"><h3>二、实验原理</h3>';
    M.notes.forEach(function (n) { html += '<p>· ' + n + '</p>'; });
    html += '</div>';

    html += '<div class="guide-sec"><h3>三、可调边界条件</h3><ul>';
    M.paramDefs.forEach(function (d) {
      html += '<li><b>' + d.label + '</b>（' + d.min + '~' + d.max + ' ' + d.unit + '）：' + d.hint + '</li>';
    });
    html += '</ul></div>';

    html += (ui.guide && ui.guide.steps) ? ui.guide.steps() : '';

    $('#guideBody').innerHTML = html;
    $('#guideModal').classList.add('open');
  }

  function openReport() {
    if (state.live.on && !state.live.done) {
      toast('实时演算尚未完成，请等演算结束或点「记入数据表」后再生成报告', 'warn');
      return;
    }
    var list = currentModuleRuns();
    if (!list.length) { toast('暂无实验记录，无法生成报告', 'warn'); return; }
    var M = Sim.getModule(state.moduleId);
    // 报告必须基于已经记录的数据，而不是左侧正在预览、可能换了材料的当前工况
    var run = list[list.length - 1];
    var mats = {};
    list.forEach(function (r) { mats[r.variantName] = 1; });
    var matNames = Object.keys(mats);
    var html = '';
    html += '<div class="report-head">' +
      '<h1 class="report-title">' + M.name + ' 虚拟仿真实验报告</h1>' +
      '<div class="report-meta">杭州电子科技大学 · 材料科学与工程虚拟仿真实验教学中心<br>' +
      '生成时间：' + new Date().toLocaleString('zh-CN') + ' ｜ 材料体系：' +
      (matNames.length === 1 ? matNames[0] : matNames.join(' / ')) +
      ' ｜ 记录组数：' + list.length + ' ｜ 分析基于第 ' + (run.seq || '·') + ' 组</div></div>';

    var aimTxt = (Sim.getUI(state.moduleId).reportAim || function () { return ''; })(M);
    html += '<div class="report-sec"><h3>一、实验目的</h3><p>' + aimTxt + '</p></div>';

    html += '<div class="report-sec"><h3>二、实验条件与结果</h3><table><thead><tr><th>序号</th>';
    M.paramDefs.forEach(function (d) { html += '<th>' + d.label + '(' + d.unit + ')</th>'; });
    list[0].outputDefs.forEach(function (d) { html += '<th>' + d.label + (d.unit ? '(' + d.unit + ')' : '') + '</th>'; });
    html += '</tr></thead><tbody>';
    list.forEach(function (r) {
      html += '<tr><td>' + (r.seq || '·') + '</td>';
      M.paramDefs.forEach(function (d) { html += '<td>' + fmtNum(r.params[d.key], digitsOf(d)) + '</td>'; });
      list[0].outputDefs.forEach(function (d) { html += '<td>' + fmtMetric(r.metricMap[d.key], d) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="report-sec"><h3>三、结果分析</h3>';
    buildInsights(run).forEach(function (it) {
      html += '<p>· ' + it.text.replace(/<b>/g, '').replace(/<\/b>/g, '') + '</p>';
    });
    html += '</div>';

    html += '<div class="report-sec"><h3>四、结论与建议</h3>';
    var best = list.slice().sort(function (a, b) { return b.metricMap.score - a.metricMap.score; })[0];
    html += '<p>在本次 ' + list.length + ' 组实验中，综合评分最高的是 <b>第 ' + (best.seq || '·') + ' 组</b>（' +
      best.variantName + '，' + (best.params.T != null ? 'T=' + best.params.T + ' ℃'
        : '设定 ' + best.params.Tset + ' ℃ / 位置 ' + best.params.sx + '% / 升温 ' + best.params.ramp + ' ℃·min⁻¹') +
        '，综合评分 ' + fmtNum(best.metricMap.score, 1) + '）。</p>';
    var adv = buildAdvice(run);
    if (adv.length) {
      html += '<p>' + adv.slice(0, 3).map(function (a) {
        return a.t.replace(/<[^>]+>/g, '').trim();
      }).join('</p><p>') + '</p>';
    }
    html += '</div>';

    html += '<div class="report-sign"><span>实验人：____________</span><span>指导教师：____________</span>' +
      '<span>日期：' + new Date().toLocaleDateString('zh-CN') + '</span></div>';

    $('#reportBody').innerHTML = html;
    $('#reportModal').classList.add('open');
  }

  /* ------------------------------ 启动 ------------------------------ */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
