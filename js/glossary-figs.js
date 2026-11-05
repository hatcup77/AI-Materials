/* =========================================================================
   专业术语配图 · 数据层
   每张图返回 { svg, cap }：svg 是内联 SVG，cap 是图注。
   app.js 在术语条目展开时把它插到 .gl-detail 顶部。
   只画「关系与形态」，不描摹实物照片；坐标与量级按公开文献的典型值取。
   ========================================================================= */
(function (global) {
  'use strict';

  var C = ['#4f9df7', '#3ddbe8', '#a78bfa', '#ffb347', '#7dd39a', '#e08fb8'];
  var INK = '#8aa2c0';

  function n1(v) { return Math.round(v * 10) / 10; }

  function head(w, h) {
    return '<svg class="gf" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">' +
      '<defs><marker id="gfArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">' +
      '<path d="M0 0 L7 3.5 L0 7 Z" fill="' + INK + '"/></marker></defs>';
  }

  function t(x, y, s, cls, anchor) {
    return '<text class="' + (cls || 'gf-t') + '" x="' + n1(x) + '" y="' + n1(y) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + s + '</text>';
  }
  function ln(x1, y1, x2, y2, stroke, o) {
    o = o || {};
    return '<line x1="' + n1(x1) + '" y1="' + n1(y1) + '" x2="' + n1(x2) + '" y2="' + n1(y2) +
      '" stroke="' + stroke + '" stroke-width="' + (o.w || 1) + '"' +
      (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
      (o.arrow ? ' marker-end="url(#gfArrow)"' : '') + '/>';
  }
  function rc(x, y, w, h, o) {
    o = o || {};
    return '<rect x="' + n1(x) + '" y="' + n1(y) + '" width="' + n1(w) + '" height="' + n1(h) +
      '" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || 'none') +
      '" stroke-width="' + (o.w || 1) + '"' + (o.rx ? ' rx="' + o.rx + '"' : '') +
      (o.op != null ? ' fill-opacity="' + o.op + '"' : '') + '/>';
  }
  function ci(cx, cy, r, o) {
    o = o || {};
    return '<circle cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="' + n1(r) + '" fill="' + (o.fill || 'none') +
      '" stroke="' + (o.stroke || 'none') + '" stroke-width="' + (o.w || 1) + '"' +
      (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
      (o.op != null ? ' fill-opacity="' + o.op + '"' : '') + '/>';
  }
  function pa(d, o) {
    o = o || {};
    return '<path d="' + d + '" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || 'none') +
      '" stroke-width="' + (o.w || 1.6) + '" stroke-linejoin="round" stroke-linecap="round"' +
      (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
      (o.op != null ? ' fill-opacity="' + o.op + '"' : '') + '/>';
  }

  /* 直角坐标绘图：给数据范围，自动换算成像素 */
  function plot(o) {
    var w = o.w || 560, h = o.h || 190;
    var pl = o.pl || 46, pr = 18, pt = 18, pb = o.pb || 30;
    var iw = w - pl - pr, ih = h - pt - pb;
    var xr = o.xr, yr = o.yr;
    function X(v) { return pl + (v - xr[0]) / (xr[1] - xr[0]) * iw; }
    function Y(v) { return pt + (1 - (v - yr[0]) / (yr[1] - yr[0])) * ih; }
    var s = head(w, h);

    (o.bands || []).forEach(function (b) {
      var y0 = Y(Math.max(b.y0, yr[0])), y1 = Y(Math.min(b.y1, yr[1]));
      s += '<rect class="gf-band" x="' + n1(pl) + '" y="' + n1(Math.min(y0, y1)) + '" width="' + n1(iw) +
        '" height="' + n1(Math.abs(y1 - y0)) + '" fill="' + C[b.c || 0] + '"/>';
      if (b.l) s += t(pl + 7, n1((y0 + y1) / 2 + 3), b.l, 'gf-l');
    });

    (o.yt || []).forEach(function (v) {
      s += '<line class="gf-grid" x1="' + n1(pl) + '" y1="' + n1(Y(v)) + '" x2="' + n1(pl + iw) + '" y2="' + n1(Y(v)) + '"/>';
      s += t(pl - 6, n1(Y(v) + 3), v, 'gf-t', 'end');
    });
    (o.xt || []).forEach(function (v) {
      s += '<line class="gf-grid" x1="' + n1(X(v)) + '" y1="' + n1(pt) + '" x2="' + n1(X(v)) + '" y2="' + n1(pt + ih) + '"/>';
      s += t(n1(X(v)), n1(pt + ih + 12), v, 'gf-t', 'middle');
    });

    s += '<line class="gf-axis" x1="' + n1(pl) + '" y1="' + n1(pt) + '" x2="' + n1(pl) + '" y2="' + n1(pt + ih) + '"/>';
    s += '<line class="gf-axis" x1="' + n1(pl) + '" y1="' + n1(pt + ih) + '" x2="' + n1(pl + iw) + '" y2="' + n1(pt + ih) + '"/>';

    (o.hl || []).forEach(function (l) {
      s += ln(pl, Y(l.y), pl + iw, Y(l.y), l.c != null ? C[l.c] : 'var(--line2)', { dash: l.dash || '4 3', w: l.w || 1 });
      if (l.l) s += t(pl + iw - 3, Y(l.y) - 4, l.l, 'gf-t', 'end');
    });
    (o.vl || []).forEach(function (l) {
      s += ln(X(l.x), pt, X(l.x), pt + ih, l.c != null ? C[l.c] : 'var(--line2)', { dash: l.dash || '4 3', w: l.w || 1 });
    });

    (o.s || []).forEach(function (se) {
      var d = se.p.map(function (p, i) { return (i ? 'L' : 'M') + n1(X(p[0])) + ' ' + n1(Y(p[1])); }).join(' ');
      if (se.close) d += ' Z';
      s += '<path d="' + d + '" fill="' + (se.fill || 'none') + '"' +
        (se.op != null ? ' fill-opacity="' + se.op + '"' : '') +
        ' stroke="' + C[se.c || 0] + '" stroke-width="' + (se.w || 1.8) +
        '" stroke-linejoin="round" stroke-linecap="round"' +
        (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + '/>';
    });

    (o.n || []).forEach(function (it) {
      s += t(X(it.x), Y(it.y), it.t, it.cls || 'gf-l', it.a);
    });

    if (o.xl) s += t(pl + iw / 2, h - 5, o.xl, 'gf-t', 'middle');
    if (o.yl) s += t(4, pt - 6, o.yl, 'gf-t');
    if (o.raw) s += o.raw;
    return s + '</svg>';
  }

  function erfc(x) {
    var z = Math.abs(x), tt = 1 / (1 + 0.5 * z);
    var y = tt * Math.exp(-z * z - 1.26551223 + tt * (1.00002368 + tt * (0.37409196 + tt * (0.09678418 +
      tt * (-0.18628806 + tt * (0.27886807 + tt * (-1.13520398 + tt * (1.48851587 +
      tt * (-0.82215223 + tt * 0.17087277)))))))));
    return x >= 0 ? y : 2 - y;
  }

  function seq(a, b, n, f) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var v = a + (b - a) * i / n;
      out.push([v, f(v)]);
    }
    return out;
  }

  /* ------------------------------ 通用 ------------------------------ */

  function figActEnergy() {
    var s = head(560, 172);
    s += pa('M56 118 L150 118 C 196 118 214 44 268 44 C 306 44 324 146 372 146 L520 146', { stroke: C[0], w: 1.9 });
    s += ln(56, 118, 520, 118, C[1], { dash: '4 4' });
    s += ln(56, 146, 520, 146, C[3], { dash: '4 4' });
    s += ln(268, 116, 268, 48, INK, { arrow: true, dash: '3 3' });
    s += t(276, 90, 'Eₐ', 'gf-l');
    s += ln(470, 144, 470, 120, INK, { arrow: true });
    s += t(478, 136, 'ΔH', 'gf-l');
    s += t(60, 111, '反应物', 'gf-t');
    s += t(516, 160, '产物', 'gf-t', 'end');
    s += t(268, 34, '过渡态', 'gf-t', 'middle');
    s += t(288, 166, '反应坐标', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '势垒高度就是活化能 Eₐ，Eₐ 只能靠升温用 kT 去翻越，这也是速率对温度呈指数敏感的根源。' };
  }

  function figArrhenius() {
    var svg = plot({
      w: 560, h: 186, xr: [0.8, 2.0], yr: [-6, 2],
      xt: [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0], yt: [-6, -4, -2, 0, 2],
      xl: '1000/T（K⁻¹，向右为降温）', yl: 'ln k',
      s: [{ p: [[0.8, 1.7], [2.0, -5.5]], c: 0 }, { p: [[0.8, 0.5], [2.0, -3.5]], c: 1 }],
      n: [{ x: 1.0, y: 1.35, t: '高 Eₐ', cls: 'gf-l' }, { x: 1.62, y: -2.2, t: '低 Eₐ', cls: 'gf-l' },
        { x: 1.28, y: -5.4, t: '两条线交叉：高温看活化能，低温看指前因子' }]
    });
    return { svg: svg, cap: 'ln k 对 1/T 应是直线，斜率就是 −Eₐ/R；折点意味着换了控制步骤。' };
  }

  function figFick() {
    var svg = plot({
      w: 560, h: 190, xr: [0, 5], yr: [0, 1.05],
      xt: [0, 1, 2, 3, 4, 5], yt: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
      xl: '距表面深度', yl: 'C/C₀',
      s: [
        { p: seq(0, 5, 40, function (x) { return erfc(x / (2 * 0.5)); }), c: 0 },
        { p: seq(0, 5, 40, function (x) { return erfc(x / (2 * 1.0)); }), c: 1 },
        { p: seq(0, 5, 40, function (x) { return erfc(x / (2 * 1.7)); }), c: 2 }
      ],
      n: [{ x: 0.34, y: 0.70, t: 't₁' }, { x: 1.02, y: 0.57, t: 't₂' }, { x: 2.24, y: 0.46, t: 't₃' },
        { x: 4.9, y: 0.28, t: '扩散越久，前沿越深、越平缓', a: 'end' }]
    });
    return { svg: svg, cap: '半无限介质中恒定表面浓度下的解是余误差函数，前沿位置随 √t 推移。' };
  }

  function figBiot() {
    var svg = plot({
      w: 560, h: 186, xr: [0, 1], yr: [0, 1.05], xt: [0, 0.5, 1], yt: [0, 0.25, 0.5, 0.75, 1.0],
      xl: '位置（左为表面，右为心部）', yl: 'T / T∞',
      s: [
        { p: [[0, 0.97], [0.5, 0.96], [1, 0.945]], c: 4 },
        { p: seq(0, 1, 30, function (x) { return 0.32 + 0.68 * Math.pow(Math.cos(x * Math.PI / 2), 1.5); }), c: 3 }
      ],
      n: [{ x: 0.06, y: 1.01, t: 'Bi ≪ 0.1：内部近似均匀' }, { x: 0.5, y: 0.55, t: 'Bi ≫ 1：心部明显滞后' }]
    });
    return { svg: svg, cap: 'Bi = hL/λ 小于 0.1 时可当集总热容处理，大于 10 就必须解内部温度梯度。' };
  }

  function figBoundary() {
    var s = head(560, 176);
    var xs = [16, 206, 396], W = 148, y0 = 42, H = 84;
    xs.forEach(function (x, i) {
      s += rc(x, y0, W, H, { fill: 'rgba(79,157,247,0.06)', stroke: 'var(--line2)', rx: 3 });
      s += t(x + W / 2, y0 + H / 2 + 4, '介质', 'gf-t', 'middle');
    });
    // 第一类：固定边界温度
    s += ln(xs[0], y0, xs[0], y0 + H, C[0], { w: 2.4 });
    s += t(xs[0] + 8, y0 - 8, 'T = T₀', 'gf-l');
    s += t(xs[0] + W / 2, y0 + H + 22, '第一类 · 固定温度', 'gf-l', 'middle');
    // 第二类：绝热
    s += ln(xs[1], y0, xs[1], y0 + H, C[1], { w: 2, dash: '5 4' });
    for (var k = 0; k < 5; k++) {
      s += ln(xs[1] + 2, y0 + 8 + k * 17, xs[1] + 12, y0 + 16 + k * 17, 'var(--line2)', { w: 1 });
    }
    s += t(xs[1] + 16, y0 - 8, '∂T/∂n = 0', 'gf-l');
    s += t(xs[1] + W / 2, y0 + H + 22, '第二类 · 绝热', 'gf-l', 'middle');
    // 第三类：对流
    s += ln(xs[2], y0, xs[2], y0 + H, C[3], { w: 2.4 });
    for (var j = 0; j < 3; j++) {
      var yy = y0 + 18 + j * 24;
      s += ln(xs[2] - 26, yy, xs[2] - 4, yy, INK, { arrow: true });
      s += '<path d="M' + (xs[2] - 20) + ' ' + (yy - 3) + ' q 4 3 0 6 q -4 3 0 6" fill="none" stroke="' + INK + '" stroke-width="0.9"/>';
    }
    s += t(xs[2] + 8, y0 - 8, 'h·(T∞ − Tₛ)', 'gf-l');
    s += t(xs[2] + W / 2, y0 + H + 22, '第三类 · 对流换热', 'gf-l', 'middle');
    s += t(280, 166, '边界条件定了，解才定；同一炉子换个摆放位置，本质是换了边界。', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '三类边界分别约束温度本身、热流为零、以及表面换热强度，模型中写错一类，温度场就整体偏移。' };
  }

  function figThermalLag() {
    var setp = [[0, 20], [9.4, 20], [9.6, 1000], [120, 1000]];
    var smp = seq(10, 120, 44, function (x) { return 1000 - 980 * Math.exp(-(x - 10) / 18); });
    var svg = plot({
      w: 560, h: 196, xr: [0, 120], yr: [0, 1100], xt: [0, 20, 40, 60, 80, 100, 120],
      yt: [0, 200, 400, 600, 800, 1000], xl: '时间 / min', yl: '温度 / ℃',
      s: [{ p: setp, c: 1, dash: '5 3' }, { p: smp, c: 3 }],
      n: [{ x: 46, y: 1058, t: '设定值' }, { x: 20, y: 130, t: '样品温度' },
        { x: 24, y: 320, t: '滞后由热时间常数 τ 决定' }]
    });
    return { svg: svg, cap: '样品温度按一阶滞后逼近设定值，τ 越大，保温计时越不能从程序升温那一刻算起。' };
  }

  /* ------------------------------ 固相 ------------------------------ */

  function figJmak() {
    var svg = plot({
      w: 560, h: 190, xr: [0, 3], yr: [0, 1.02], xt: [0, 0.5, 1, 1.5, 2, 2.5, 3],
      yt: [0, 0.25, 0.5, 0.75, 1.0], xl: '时间（以 1/k 为单位）', yl: '转化率 α',
      s: [
        { p: seq(0, 3, 40, function (x) { return 1 - Math.exp(-Math.pow(x, 0.8)); }), c: 4 },
        { p: seq(0, 3, 40, function (x) { return 1 - Math.exp(-Math.pow(x, 2)); }), c: 0 },
        { p: seq(0, 3, 40, function (x) { return 1 - Math.exp(-Math.pow(x, 4)); }), c: 2 }
      ],
      n: [{ x: 0.55, y: 0.86, t: 'n = 0.8' }, { x: 1.55, y: 0.55, t: 'n = 2' },
        { x: 2.15, y: 0.62, t: 'n = 4' }, { x: 0.16, y: 0.12, t: 'n 越大，诱导期越长、转变越集中' }]
    });
    return { svg: svg, cap: 'JMAK 的 S 形来自成核与长大竞争，Avrami 指数 n 决定曲线陡缓，也提示转变受哪个环节控制。' };
  }

  function figShrinkingCore() {
    var s = head(560, 186);
    var xs = [96, 226, 356], R = 52;
    var inner = [40, 26, 12], lab = ['初期', '中期', '后期'];
    xs.forEach(function (cx, i) {
      s += ci(cx, 92, R, { stroke: C[1], w: 1.3, dash: '3 3' });
      s += ci(cx, 92, inner[i], { fill: C[3], op: 0.25, stroke: C[3], w: 1.5 });
      s += ln(cx - R + 2, 92, cx - inner[i] - 4, 92, C[4], { arrow: true });
      s += ln(cx + R - 2, 92, cx + inner[i] + 4, 92, C[4], { arrow: true });
      s += t(cx, 160, lab[i], 'gf-t', 'middle');
    });
    s += t(96, 30, '反应界面', 'gf-l', 'middle');
    s += t(226, 30, '产物层增厚', 'gf-l', 'middle');
    s += t(356, 30, '核将耗尽', 'gf-l', 'middle');
    s += '<path d="M430 78 C 466 78 466 106 430 106" fill="none" stroke="' + INK + '" stroke-width="1"/>';
    s += t(440, 72, '界面内移', 'gf-t');
    return { svg: s + '</svg>', cap: '缩核模型把反应简化为界面匀速内移，速率由穿过产物层的扩散和界面反应串联决定。' };
  }

  function figDensity() {
    var pts = [[0, 0.52], [8, 0.585], [16, 0.625], [24, 0.685], [32, 0.775], [40, 0.845],
      [48, 0.895], [56, 0.918], [70, 0.938], [90, 0.952], [110, 0.961], [120, 0.966]];
    var svg = plot({
      w: 560, h: 196, xr: [0, 120], yr: [0.5, 1.0], xt: [0, 20, 40, 60, 80, 100, 120],
      yt: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0], xl: '保温时间 / min', yl: '相对密度',
      bands: [{ y0: 0.99, y1: 1.0, c: 4 }],
      s: [{ p: pts, c: 0 }],
      vl: [{ x: 20 }, { x: 60 }],
      n: [{ x: 2, y: 0.985, t: '理论密度线' }, { x: 21, y: 0.55, t: '初期 · 颗粒重排' },
        { x: 41, y: 0.60, t: '中期 · 扩散致密化' }, { x: 78, y: 0.985, t: '后期 · 孔隙闭合' }]
    });
    return { svg: svg, cap: '烧结密度曲线分三段：初期靠重排，中期靠扩散，后期只剩孤立孔隙回缩，所以末段越来越慢。' };
  }

  function figPerovskite() {
    var s = head(560, 214);
    var cx = 280, cy = 104, k = 52;
    function P(x, y, z) { return [cx + (x - z) * 0.9 * k, cy - y * k + (x + z) * 0.42 * k]; }
    var E = [];
    [0, 1].forEach(function (x) { [0, 1].forEach(function (y) { [0, 1].forEach(function (z) { E.push([x, y, z]); }); }); });
    // 12 条棱
    var edges = [];
    E.forEach(function (a, i) {
      E.forEach(function (b, j) {
        if (j <= i) return;
        var d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (d === 1) edges.push([a, b]);
      });
    });
    // 三个可见面先铺一层浅色，否则等轴测投影只剩一个六边形轮廓
    var faces = [
      { v: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], op: 0.24 },
      { v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], op: 0.09 },
      { v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], op: 0.03 }
    ];
    faces.forEach(function (f) {
      var d = f.v.map(function (v, i) {
        var p = P(v[0], v[1], v[2]);
        return (i ? 'L' : 'M') + n1(p[0]) + ' ' + n1(p[1]);
      }).join(' ') + ' Z';
      s += pa(d, { fill: C[0], op: f.op, stroke: 'none' });
    });
    edges.forEach(function (e) {
      var p1 = P(e[0][0], e[0][1], e[0][2]), p2 = P(e[1][0], e[1][1], e[1][2]);
      s += ln(p1[0], p1[1], p2[0], p2[1], 'var(--line2)', { w: 1 });
    });
    // 面心氧
    var oxy = [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]];
    oxy.forEach(function (o) {
      var p = P(o[0], o[1], o[2]);
      s += ci(p[0], p[1], 3.4, { fill: C[1], op: 0.9 });
    });
    // 体心 B
    var pb = P(0.5, 0.5, 0.5);
    s += ci(pb[0], pb[1], 5.6, { fill: C[3], op: 0.95 });
    // 顶点 A
    E.forEach(function (v) {
      var p = P(v[0], v[1], v[2]);
      s += ci(p[0], p[1], 4.4, { fill: C[0], op: 0.95 });
    });
    s += ci(440, 60, 5, { fill: C[0] }); s += t(452, 64, 'A 位（稀土 / 碱土）', 'gf-l');
    s += ci(440, 88, 6, { fill: C[3] }); s += t(452, 92, 'B 位（过渡金属）', 'gf-l');
    s += ci(440, 116, 3.6, { fill: C[1] }); s += t(452, 120, 'O 位（面心）', 'gf-l');
    s += t(280, 204, 'ABO₃ 钙钛矿：BO₆ 八面体共顶连接，A 位填在空腔里', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '钙钛矿的性能几乎都由 B 位离子决定，A 位主要负责撑住骨架与容忍度。' };
  }

  /* ------------------------------ CVD ------------------------------ */

  function figLangmuir() {
    var svg = plot({
      w: 560, h: 182, xr: [0, 6], yr: [0, 1.05], xt: [0, 1, 2, 3, 4, 5, 6],
      yt: [0, 0.25, 0.5, 0.75, 1.0], xl: '分压 p', yl: '覆盖度 θ',
      hl: [{ y: 1, c: 3, l: '饱和覆盖' }],
      s: [{ p: seq(0, 6, 40, function (p) { return 1.2 * p / (1 + 1.2 * p); }), c: 0 }],
      n: [{ x: 3.6, y: 0.62, t: '低压段近似线性' }, { x: 4.4, y: 0.92, t: '高压段趋于饱和' }]
    });
    return { svg: svg, cap: 'Langmuir 吸附在低压时速率随分压线性上升，高压时表面被占满，再加压也不加速。' };
  }

  function figSeriesRes() {
    var rMt = 4;
    var svg = plot({
      w: 560, h: 196, xr: [0.7, 1.7], yr: [0, 5], xt: [0.7, 0.9, 1.1, 1.3, 1.5, 1.7],
      yt: [0, 1, 2, 3, 4, 5], xl: '1000/T（向右为降温）', yl: '沉积速率',
      hl: [{ y: rMt, c: 1, l: '输运上限' }],
      s: [
        { p: seq(0.7, 1.7, 40, function (x) {
          return Math.min(30 * Math.exp(-7.5 * (x - 0.75)), 5.2);
        }).filter(function (pt) { return pt[1] < 5.1; }), c: 2, dash: '4 3' },
        { p: seq(0.7, 1.7, 40, function (x) {
          var rk = 30 * Math.exp(-7.5 * (x - 0.75));
          return 1 / (1 / rk + 1 / rMt);
        }), c: 0, w: 2.1 }
      ],
      n: [{ x: 0.72, y: 4.4, t: '高温段：输运控制' }, { x: 1.28, y: 1.6, t: '低温段：表面反应控制' }]
    });
    return { svg: svg, cap: '表面反应与质量输运是串联阻力，速率取两者倒数和的倒数，于是曲线出现高温平台。' };
  }

  function figAld() {
    var svg = plot({
      w: 560, h: 182, xr: [0, 3], yr: [0, 0.14], xt: [0, 0.5, 1, 1.5, 2, 2.5, 3],
      yt: [0, 0.04, 0.08, 0.12], xl: '单脉冲前驱体剂量（相对值）', yl: '每周期增厚 / nm',
      hl: [{ y: 0.11, c: 3, l: '自限制饱和 ≈ 一个原子层' }],
      s: [{ p: seq(0, 3, 40, function (x) { return 0.11 * (1 - Math.exp(-2.3 * x)); }), c: 0 }],
      n: [{ x: 0.12, y: 0.035, t: '剂量不足，台阶未铺满' }]
    });
    return { svg: svg, cap: 'ALD 靠表面化学吸附自饱和，剂量超过饱和点后厚度不再增加，所以台阶和高深宽比孔也能均匀覆盖。' };
  }

  function figConformal() {
    var s = head(560, 196);
    var panels = [
      { x: 10, name: 'PVD · 阴影效应', top: 4, side: 1, bot: 1.6, over: 1, note: '顶部厚、侧壁薄、拐角悬垂' },
      { x: 196, name: 'CVD · 部分保形', top: 4, side: 2.2, bot: 3, over: 0, note: '侧壁偏薄，底角略薄' },
      { x: 382, name: 'ALD · 完全保形', top: 3, side: 3, bot: 3, over: 0, note: '各向等厚' }
    ];
    function seg(x1, y1, x2, y2, w) {
      return '<line x1="' + n1(x1) + '" y1="' + n1(y1) + '" x2="' + n1(x2) + '" y2="' + n1(y2) +
        '" stroke="' + C[3] + '" stroke-width="' + n1(w) + '" stroke-linecap="butt"/>';
    }
    panels.forEach(function (p) {
      var x = p.x, y = 52, W = 168, H = 62, tx0 = x + 44, tx1 = x + 116, dep = 30, bot = y + H;
      // 基体：先铺底，再在表面按段画膜，膜的厚度就是线宽，侧壁自然是竖直的
      s += pa('M' + x + ' ' + y + ' L' + tx0 + ' ' + y + ' L' + tx0 + ' ' + (y + dep) +
        ' L' + tx1 + ' ' + (y + dep) + ' L' + tx1 + ' ' + y + ' L' + (x + W) + ' ' + y +
        ' L' + (x + W) + ' ' + bot + ' L' + x + ' ' + bot + ' Z',
        { fill: 'rgba(79,157,247,0.07)', stroke: 'var(--line2)', w: 1 });
      s += seg(x, y, tx0, y, p.top);
      s += seg(tx0, y - p.top / 2, tx0, y + dep, p.side);
      s += seg(tx0, y + dep, tx1, y + dep, p.bot);
      s += seg(tx1, y + dep, tx1, y - p.top / 2, p.side);
      s += seg(tx1, y, x + W, y, p.top);
      if (p.over) {
        s += '<path d="M' + (tx0 - 8) + ' ' + (y - p.top) + ' q 7 12 0 20" fill="none" stroke="' + C[5] + '" stroke-width="1.6"/>';
        s += '<path d="M' + (tx1 + 8) + ' ' + (y - p.top) + ' q -7 12 0 20" fill="none" stroke="' + C[5] + '" stroke-width="1.6"/>';
      }
      s += t(x + W / 2, 32, p.name, 'gf-l', 'middle');
      s += t(x + W / 2, 140, p.note, 'gf-t', 'middle');
    });
    s += t(280, 176, '同一条线上，线宽就是膜厚：侧壁与顶面一样粗才算完全保形', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '保形性看侧壁与底部厚度是否等于顶面；PVD 受入射方向限制，ALD 由表面化学决定，与几何无关。' };
  }

  /* ------------------------------ 反应扩散 ------------------------------ */

  function figDamkohler() {
    var svg = plot({
      w: 560, h: 190, xr: [0, 5], yr: [0, 1.05], xt: [0, 1, 2, 3, 4, 5],
      yt: [0, 0.25, 0.5, 0.75, 1.0], xl: '深度', yl: 'C/C₀',
      s: [
        { p: seq(0, 5, 40, function (x) { return Math.exp(-Math.sqrt(0.1) * x); }), c: 4 },
        { p: seq(0, 5, 40, function (x) { return Math.exp(-Math.sqrt(10) * x); }), c: 0 },
        { p: seq(0, 5, 40, function (x) { return Math.exp(-Math.sqrt(100) * x); }), c: 3 }
      ],
      n: [{ x: 2.4, y: 0.62, t: 'Da = 0.1：反应慢，浓度缓慢衰减' },
        { x: 1.1, y: 0.16, t: 'Da = 10：出现明显前沿' },
        { x: 0.28, y: 0.34, t: 'Da = 100' }]
    });
    return { svg: svg, cap: 'Da 是反应速率与扩散速率之比，它决定前沿是尖锐的一层还是弥散的一整片。' };
  }

  function figPenetration() {
    var svg = plot({
      w: 560, h: 182, xr: [0, 60], yr: [0, 140], xt: [0, 15, 30, 45, 60],
      yt: [0, 35, 70, 105, 140], xl: '时间 / min', yl: '前沿位置 / μm',
      s: [
        { p: seq(0, 60, 40, function (x) { return 2 * Math.sqrt(60 * x); }), c: 0, w: 2.1 },
        { p: [[0, 0], [60, 120]], c: 2, dash: '4 3' }
      ],
      n: [{ x: 32, y: 96, t: '√t 实际推进' }, { x: 46, y: 78, t: '若按线性外推会高估' }]
    });
    return { svg: svg, cap: '扩散深度随 √t 增长，时间翻四倍深度才翻一倍，这就是保温时间不能凭感觉加的原因。' };
  }

  function figUndercut() {
    var s = head(560, 176);
    function panel(x, iso, name, note) {
      s += rc(x, 40, 168, 60, { fill: 'rgba(79,157,247,0.07)', stroke: 'var(--line2)' });
      s += rc(x + 46, 26, 76, 14, { fill: C[2], op: 0.5, stroke: C[2], rx: 2 });
      if (iso) {
        // 用二次曲线显式画向下鼓的蚀坑，避免弧线 flags 方向搞反
        // 蚀坑比掩模开口更宽，才能看出「钻到掩模底下」这层意思
        s += pa('M' + (x + 36) + ' 40 Q' + (x + 84) + ' 118 ' + (x + 132) + ' 40 Z',
          { fill: 'rgba(79,157,247,0.16)', stroke: C[3], w: 1.5 });
        s += t(x + 84, 76, '侧向钻蚀', 'gf-t', 'middle');
      } else {
        s += rc(x + 50, 40, 68, 30, { fill: 'rgba(79,157,247,0.16)', stroke: C[1], w: 1.5 });
        s += t(x + 84, 82, '侧壁垂直', 'gf-t', 'middle');
      }
      s += t(x + 84, 22, name, 'gf-l', 'middle');
      s += t(x + 84, 122, note, 'gf-t', 'middle');
    }
    panel(20, true, '各向同性刻蚀', '横向与纵向速率相同');
    panel(230, false, '各向异性刻蚀', '纵向远快于横向');
    s += rc(440, 34, 100, 72, { fill: 'rgba(255,179,71,0.10)', stroke: C[3], dash: '4 3' });
    s += t(490, 56, '图形转移', 'gf-l', 'middle');
    s += t(490, 74, '靠掩模挡住', 'gf-t', 'middle');
    s += t(490, 90, '未保护区域', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '湿法刻蚀在高温或低浓度下各向同性，横向钻蚀会把线宽吃掉，这就是 45 ℃ 以上容易失控的原因。' };
  }

  /* ------------------------------ 马弗炉 ------------------------------ */

  function figFurnace() {
    var s = head(560, 214);
    var CX = 182, CY = 95;
    s += rc(24, 22, 316, 146, { fill: 'rgba(79,157,247,0.04)', stroke: 'var(--line2)', rx: 6 });
    s += rc(38, 36, 288, 118, { fill: 'none', stroke: 'var(--line2)', rx: 3 });
    // 两侧加热元件
    for (var i = 0; i < 7; i++) {
      var y = 48 + i * 17;
      s += '<path d="M24 ' + y + ' q 7 -5 14 0" fill="none" stroke="' + C[3] + '" stroke-width="1.8"/>';
      s += '<path d="M312 ' + y + ' q 7 -5 14 0" fill="none" stroke="' + C[3] + '" stroke-width="1.8"/>';
    }
    s += t(24, 16, '加热元件（设定 1050 ℃）', 'gf-t');
    // 等温线：左缘向炉门方向内凹，表达边缘散热
    function iso(w, h, bow) {
      var x0 = CX - w / 2, x1 = CX + w / 2, y0 = CY - h / 2, y1 = CY + h / 2;
      return 'M' + n1(x0) + ' ' + n1(y0) + ' L' + n1(x1) + ' ' + n1(y0) + ' L' + n1(x1) + ' ' + n1(y1) +
        ' L' + n1(x0) + ' ' + n1(y1) + ' Q' + n1(x0 + bow) + ' ' + n1(CY) + ' ' + n1(x0) + ' ' + n1(y0);
    }
    [[250, 96, 16], [208, 80, 13], [166, 64, 10], [124, 48, 7]].forEach(function (o, i) {
      s += pa(iso(o[0], o[1], o[2]), { stroke: C[0], w: i === 0 ? 1.2 : 1, dash: '4 3', stroke2: 0 });
    });
    s += t(CX, CY - 3, '恒温区', 'gf-t', 'middle');
    s += t(CX, CY + 9, '1050 ℃', 'gf-t', 'middle');
    // 样品
    s += rc(96, 104, 24, 11, { fill: C[4], op: 0.5, stroke: C[4] });
    s += t(96, 100, '①', 'gf-t');
    s += rc(258, 74, 24, 11, { fill: C[4], op: 0.5, stroke: C[4] });
    s += t(258, 70, '②', 'gf-t');
    s += t(24, 188, '① 靠炉门：968 ℃', 'gf-l');
    s += t(180, 188, '② 靠炉壁：1032 ℃', 'gf-l');
    // 右侧说明
    s += t(366, 52, '同一设定温度', 'gf-l');
    s += t(366, 70, '样品位置不同', 'gf-l');
    s += t(366, 88, '实际温度就不同', 'gf-l');
    s += t(366, 118, '等温线在近门处', 'gf-t');
    s += t(366, 134, '向里凹陷，近壁处', 'gf-t');
    s += t(366, 150, '被辐射顶高', 'gf-t');
    s += t(366, 176, '这就是边界效应', 'gf-t');
    return { svg: s + '</svg>', cap: '炉膛内不是等温体：炉门散热让等温线塌陷，炉壁辐射让边缘偏热，样品摆哪儿就决定了它真实经历了什么温度。' };
  }

  /* ------------------------------ 热处理 ------------------------------ */

  function figCct() {
    /* 鼻尖取在 570 ℃ 附近、约 3 s，对应 45 钢 70 ℃/s 量级的临界冷速；
       水冷 150 ℃/s 必须整条曲线落在 C 形曲线左侧，才算「躲开扩散转变」。 */
    var A1 = 727, Ms = 350;
    var pStart = [[3.6, 727], [2.9, 705], [2.2, 680], [1.5, 650], [0.95, 620], [0.60, 590], [0.52, 570], [0.60, 550], [0.78, 540]];
    var pFin = [[4.1, 727], [3.5, 705], [2.8, 680], [2.1, 650], [1.6, 620], [1.30, 590], [1.22, 570], [1.30, 550], [1.45, 540]];
    var bStart = [[0.9, 535], [1.0, 505], [1.15, 470], [1.4, 435], [1.75, 405], [2.1, 390]];
    var bFin = [[1.7, 535], [1.85, 505], [2.0, 470], [2.3, 435], [2.65, 405], [3.0, 390]];
    function band(a1, a2) { return a1.concat(a2.slice().reverse()); }
    function cool(rate) {
      return [800, 700, 600, 500, 400, 300].map(function (T) {
        return [Math.log10(Math.max((830 - T) / rate, 0.06)), T];
      });
    }
    var svg = plot({
      w: 560, h: 236, xr: [-1, 4.2], yr: [200, 900],
      xt: [-1, 0, 1, 2, 3, 4], yt: [200, 300, 400, 500, 600, 700, 800, 900],
      xl: '时间 / s（对数刻度）', yl: '温度 / ℃',
      hl: [{ y: A1, c: 1, l: 'A₁ 727 ℃' }, { y: Ms, c: 4, l: 'Ms 350 ℃' }],
      s: [
        { p: band(pStart, pFin), close: true, fill: C[0], op: 0.14, c: 0, w: 1.4 },
        { p: band(bStart, bFin), close: true, fill: C[2], op: 0.16, c: 2, w: 1.4 },
        { p: pFin, c: 0, dash: '4 3', w: 1.2 },
        { p: bFin, c: 2, dash: '4 3', w: 1.2 },
        { p: cool(0.05), c: 4 }, { p: cool(1), c: 3 }, { p: cool(150), c: 5, w: 2.1 }
      ],
      n: [{ x: 1.25, y: 638, t: 'P 珠光体' }, { x: 1.62, y: 468, t: 'B 贝氏体' },
        { x: 2.35, y: 292, t: 'M 马氏体' },
        { x: 3.30, y: 768, t: '炉冷' }, { x: 2.62, y: 604, t: '空冷' }, { x: -0.94, y: 742, t: '水冷' }]
    });
    return { svg: svg, cap: '冷速决定曲线从哪个区间穿过：慢冷撞上 P 区，空冷擦过鼻尖，水冷整条曲线躲开扩散转变直接落到 Ms 以下。' };
  }

  function figPearlite() {
    var s = head(560, 200);
    var rows = [
      { y: 34, name: 'P 珠光体', pitch: 15, T: 'A₁ ~ 650 ℃', lam: '0.6 ~ 1.0 μm', hv: '190 ~ 230 HV' },
      { y: 84, name: 'S 索氏体', pitch: 6, T: '650 ~ 600 ℃', lam: '0.25 ~ 0.3 μm', hv: '240 ~ 320 HV' },
      { y: 134, name: 'T 托氏体', pitch: 2.6, T: '600 ~ 550 ℃', lam: '0.1 ~ 0.15 μm', hv: '330 ~ 400 HV' }
    ];
    rows.forEach(function (r) {
      var x0 = 120, W = 190, H = 26;
      s += rc(x0, r.y, W, H, { fill: 'rgba(79,157,247,0.05)', stroke: 'var(--line2)', rx: 2 });
      var n = Math.floor(W / r.pitch);
      for (var i = 0; i < n; i++) {
        s += rc(x0 + i * r.pitch, r.y, r.pitch * 0.45, H, { fill: C[2], op: 0.55 });
      }
      s += t(8, r.y + 12, r.name, 'gf-l');
      s += t(8, r.y + 24, r.T, 'gf-t');
      s += t(x0 + W + 10, r.y + 12, 'λ ' + r.lam, 'gf-t');
      s += t(x0 + W + 10, r.y + 24, r.hv, 'gf-t');
    });
    s += ln(510, 40, 510, 156, INK, { arrow: true });
    s += t(516, 100, '硬', 'gf-t');
    s += t(516, 116, '度', 'gf-t');
    s += t(516, 132, '升', 'gf-t');
    s += t(516, 148, '高', 'gf-t');
    s += t(280, 190, '同一类组织，只是片层间距不同', 'gf-t', 'middle');
    return { svg: s + '</svg>', cap: '珠光体、索氏体、托氏体本质相同，差别只在片间距，而片间距由转变温度（也就是冷速）决定，约为 8.02/ΔT 微米。' };
  }

  function figCoercivity() {
    var s = head(560, 214);
    function loop(cx, k, amp, hc, a, label, sub, name) {
      var cy = 88;
      function B(H, up) { return Math.tanh(a * (H + (up ? hc : -hc))); }
      var up = [], dn = [];
      for (var i = 0; i <= 48; i++) {
        var H = -1 + 2 * i / 48;
        up.push([cx + H * k, cy - B(H, true) * amp]);
        dn.push([cx + H * k, cy - B(H, false) * amp]);
      }
      s += ln(cx - k - 8, cy, cx + k + 8, cy, 'var(--line-soft2)', { w: 1 });
      s += ln(cx, cy - amp - 8, cx, cy + amp + 8, 'var(--line-soft2)', { w: 1 });
      function poly(pts) {
        return pts.map(function (p, i) { return (i ? 'L' : 'M') + n1(p[0]) + ' ' + n1(p[1]); }).join(' ');
      }
      s += pa(poly(up), { stroke: C[0], w: 1.8 });
      s += pa(poly(dn), { stroke: C[0], w: 1.8 });
      // 两端用圆弧收口，避免 tanh 模型在 ±Hmax 处留开口
      var e1 = up[48], e2 = dn[48], f1 = up[0], f2 = dn[0];
      s += pa('M' + n1(e1[0]) + ' ' + n1(e1[1]) + ' Q ' + n1(e1[0] + 8) + ' ' + n1((e1[1] + e2[1]) / 2) +
        ' ' + n1(e2[0]) + ' ' + n1(e2[1]), { stroke: C[0], w: 1.6 });
      s += pa('M' + n1(f1[0]) + ' ' + n1(f1[1]) + ' Q ' + n1(f1[0] - 8) + ' ' + n1((f1[1] + f2[1]) / 2) +
        ' ' + n1(f2[0]) + ' ' + n1(f2[1]), { stroke: C[0], w: 1.6 });
      s += t(cx, 18, name, 'gf-t', 'middle');
      s += t(cx, cy + amp + 30, label, 'gf-l', 'middle');
      s += t(cx, cy + amp + 46, sub, 'gf-t', 'middle');
    }
    loop(150, 76, 54, 0.05, 9, '软磁', 'Hc 小，回线窄，磁滞损耗低', '电磁纯铁 / 硅钢');
    loop(404, 76, 54, 0.45, 1.7, '硬磁', 'Hc 大，回线宽，不易退磁', '淬火马氏体钢');
    return { svg: s + '</svg>', cap: '同样扫到饱和，回线越窄损耗越小；矫顽力由畴壁钉扎决定，碳化物、晶界、缺陷越多，Hc 越高。' };
  }

  function figCarbon() {
    var a3 = seq(0, 0.77, 8, function (c) { return 912 - 203 * Math.sqrt(c); });
    a3[a3.length - 1][1] = 727;
    var acm = [[0.77, 727], [1.0, 828], [1.4, 958], [1.8, 1062], [2.11, 1147]];
    var svg = plot({
      w: 560, h: 226, xr: [0, 2.3], yr: [600, 1200], xt: [0, 0.5, 1.0, 1.5, 2.0],
      yt: [600, 700, 800, 900, 1000, 1100, 1200], xl: '碳质量分数 / %', yl: '温度 / ℃',
      hl: [{ y: 727, c: 1, l: 'A₁ 727 ℃' }],
      s: [{ p: a3, c: 3 }, { p: acm, c: 5 }],
      n: [{ x: 0.18, y: 1110, t: 'γ 奥氏体' }, { x: 1.62, y: 1110, t: 'γ + Fe₃C' },
        { x: 0.1, y: 660, t: 'α + 珠光体' }, { x: 1.5, y: 660, t: '珠光体 + Fe₃C' },
        { x: 0.14, y: 772, t: 'α + γ' }]
    });
    // 45 钢标记
    var X = function (v) { return 46 + v / 2.3 * (560 - 46 - 18); };
    var Y = function (v) { return 18 + (1 - (v - 600) / 600) * (226 - 18 - 30); };
    svg = svg.replace('</svg>',
      ln(X(0.45), Y(600), X(0.45), Y(776), C[0], { dash: '3 3' }) +
      ci(X(0.45), Y(776), 3.2, { fill: C[0] }) +
      t(X(0.45) + 6, Y(776) - 6, '45 钢 Ac₃ ≈ 776 ℃', 'gf-l') +
      ci(X(0.77), Y(727), 3.2, { fill: C[3] }) +
      t(X(0.77) + 5, Y(727) + 14, 'S 0.77', 'gf-t') +
      ci(X(2.11), Y(1147), 3.2, { fill: C[5] }) +
      t(X(2.11) - 7, Y(1147) - 7, 'E 2.11', 'gf-t', 'end') + '</svg>');
    return { svg: svg, cap: '亚共析钢加热到 Ac₃ 以上才完全奥氏体化，只到 Ac₁ 与 Ac₃ 之间属于不完全奥氏体化，会有先共析铁素体残留。' };
  }

  /* ------------------------------ 数值 ------------------------------ */

  function figStability() {
    var svg = plot({
      w: 560, h: 186, xr: [0, 2], yr: [0, 2], xt: [0, 0.5, 1.0, 1.5, 2.0],
      yt: [0, 0.5, 1.0, 1.5, 2.0],
      xl: '网格间距 Δx', yl: '允许时间步 Δt',
      bands: [{ y0: 1.7, y1: 2, c: 5 }],
      s: [{ p: seq(0, 2, 40, function (x) { return x * x / 2; }), c: 0, w: 2 }],
      n: [{ x: 1.15, y: 0.28, t: '稳定区 Δt ≤ Δx²/2α' }, { x: 1.1, y: 1.86, t: '越界后振荡发散' }]
    });
    return { svg: svg, cap: '显式差分的时间步受网格平方限制，网格加密一倍，步长要减到四分之一，这正是它慢的原因。' };
  }

  var FIGS = {
    'act-energy': figActEnergy,
    'arrhenius': figArrhenius,
    'fick': figFick,
    'biot': figBiot,
    'boundary-condition': figBoundary,
    'thermal-lag': figThermalLag,
    'jmak': figJmak,
    'shrinking-core': figShrinkingCore,
    'relative-density': figDensity,
    'perovskite-structure': figPerovskite,
    'langmuir': figLangmuir,
    'series-resistance': figSeriesRes,
    'ald-self-limit': figAld,
    'conformality': figConformal,
    'damkohler': figDamkohler,
    'penetration-depth': figPenetration,
    'undercut': figUndercut,
    'furnace-field': figFurnace,
    'cct-curve': figCct,
    'pearlite-series': figPearlite,
    'coercivity': figCoercivity,
    'carbon-content': figCarbon,
    'explicit-stability': figStability
  };

  global.GlossaryFigs = FIGS;
})(typeof window !== 'undefined' ? window : this);
