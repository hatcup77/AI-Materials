/* =========================================================================
 *  AI+ 虚拟仿真材料实验平台 · 图表渲染引擎
 *  纯 Canvas 实现：折线图（双轴 / 悬停 / 标记点）、柱状图、龙卷风图
 * ========================================================================= */
(function (global) {
  'use strict';

  var PALETTE = ['#3ddbe8', '#ffb347', '#a78bfa', '#66e3a0', '#ff7b93', '#7fc4ff'];

  /* 主题色板：全部由 CSS 变量驱动，切换亮/暗主题时同步刷新 */
  var T = {
    axis: 'rgba(150,175,210,0.62)',
    axisMid: 'rgba(150,175,210,0.6)',
    axisDim: 'rgba(150,175,210,0.55)',
    axisSoft: 'rgba(150,175,210,0.5)',
    grid: 'rgba(140,175,225,0.10)',
    gridSoft: 'rgba(140,175,225,0.07)',
    gridStrong: 'rgba(140,175,225,0.22)',
    legend: 'rgba(190,210,235,0.85)',
    cross: 'rgba(200,225,255,0.35)',
    hover: 'rgba(255,255,255,0.5)',
    tipBg: 'rgba(9,15,27,0.94)',
    tipBorder: 'rgba(130,180,240,0.28)',
    tipTitle: 'rgba(210,230,255,0.95)',
    tipTxt: '#dbe8fb',
    ring: '#0a1120',
    mark: '#ffffff'
  };

  var VARMAP = {
    axis: '--chart-axis', axisMid: '--chart-axis-mid', axisDim: '--chart-axis-dim',
    axisSoft: '--chart-axis-soft', grid: '--chart-grid', gridSoft: '--chart-grid-soft',
    gridStrong: '--chart-grid-strong', legend: '--chart-legend', cross: '--chart-cross',
    hover: '--chart-hover', tipBg: '--chart-tip-bg', tipBorder: '--chart-tip-border',
    tipTitle: '--chart-tip-title', tipTxt: '--chart-tip-txt', ring: '--chart-ring',
    mark: '--chart-mark'
  };

  function syncTheme() {
    if (!global.getComputedStyle) return;
    var cs = getComputedStyle(document.documentElement);
    Object.keys(VARMAP).forEach(function (k) {
      var v = cs.getPropertyValue(VARMAP[k]);
      if (v && v.trim()) T[k] = v.trim();
    });
    for (var i = 1; i <= 6; i++) {
      var c = cs.getPropertyValue('--chart-' + i);
      if (c && c.trim()) PALETTE[i - 1] = c.trim();   // 原地修改，外部引用保持有效
    }
  }
  syncTheme();

  var FONT = '"Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function prep(canvas) {
    var dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(20, rect.width), h = Math.max(20, rect.height);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw; canvas.height = ph;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 1e-6; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return ticks;
  }

  function fmtNum(v, digits) {
    if (!isFinite(v)) return '无';
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (digits != null) return v.toFixed(digits);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // 依据刻度间隔决定小数位，保证同一坐标轴格式统一
  function tickDecimals(ticks) {
    if (!ticks || ticks.length < 2) return 0;
    var step = Math.abs(ticks[1] - ticks[0]);
    if (!step || !isFinite(step)) return 0;
    return Math.max(0, Math.min(3, Math.ceil(-Math.log(step) / Math.LN10)));
  }
  function fmtTick(v, d) {
    if (!isFinite(v)) return '无';
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
    return v.toFixed(d);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* -------------------------- 悬停交互注册 -------------------------- */
  function attach(canvas, kind) {
    if (canvas.__wired) return;
    canvas.__wired = true;
    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      canvas.__hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      schedule(canvas);
    });
    canvas.addEventListener('mouseleave', function () {
      canvas.__hover = null;
      schedule(canvas);
    });
  }

  var pending = new WeakMap();
  function schedule(canvas) {
    if (pending.get(canvas)) return;
    var id = global.requestAnimationFrame(function () {
      pending.delete(canvas);
      render(canvas);
    });
    pending.set(canvas, id);
  }

  function render(canvas) {
    var cfg = canvas.__chart;
    if (!cfg || !canvas.clientWidth || !canvas.clientHeight) return;
    syncTheme();
    if (cfg.type === 'line') drawLine(canvas, cfg);
    else if (cfg.type === 'bar') drawBar(canvas, cfg);
    else if (cfg.type === 'tornado') drawTornado(canvas, cfg);
  }

  function observe(canvas) {
    if (canvas.__observed) return;
    canvas.__observed = true;
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { schedule(canvas); });
      ro.observe(canvas);
      canvas.__ro = ro;
    } else {
      global.addEventListener('resize', function () { schedule(canvas); });
    }
  }

  /* =============================== 折线图 =============================== */
  function line(canvas, cfg) {
    cfg.type = 'line';
    canvas.__chart = cfg;
    attach(canvas);
    observe(canvas);
    render(canvas);
  }

  function drawLine(canvas, cfg) {
    var P = prep(canvas);
    var ctx = P.ctx, W = P.w, H = P.h;
    var series = (cfg.series || []).filter(function (s) { return s.visible !== false && s.data && s.data.length; });
    if (!series.length) {
      ctx.fillStyle = T.axisSoft;
      ctx.font = '12px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }
    var pad = { l: cfg.padLeft || 58, r: 62, t: 20, b: 34 };
    var hasRight = series.some(function (s) { return s.axis === 'right'; });
    if (!hasRight || cfg.showRight === false) pad.r = 20;
    if (cfg.legend) pad.t = 34;

    var xs = cfg.x || [];
    var xMin = cfg.xMin != null ? cfg.xMin : Math.min.apply(null, xs);
    var xMax = cfg.xMax != null ? cfg.xMax : Math.max.apply(null, xs);
    if (xMax === xMin) xMax = xMin + 1;

    var left = series.filter(function (s) { return s.axis !== 'right'; });
    var right = series.filter(function (s) { return s.axis === 'right'; });

    function extent(list) {
      var mn = Infinity, mx = -Infinity;
      list.forEach(function (s) {
        s.data.forEach(function (v) {
          if (v == null || !isFinite(v)) return;
          if (v < mn) mn = v; if (v > mx) mx = v;
        });
      });
      if (mn === Infinity) { mn = 0; mx = 1; }
      return [mn, mx];
    }
    var eL = extent(left.length ? left : right);
    var eR = extent(right);
    var yMin = cfg.yMin != null ? cfg.yMin : eL[0];
    var yMax = cfg.yMax != null ? cfg.yMax : eL[1];
    if (cfg.yFromZero) { yMin = Math.min(0, yMin); }
    var padY = (yMax - yMin) * 0.12 || 1;
    if (cfg.yMin == null) yMin -= padY * (cfg.yFromZero ? 0 : 1);
    if (cfg.yMax == null) yMax += padY * 0.7;
    if (cfg.yFromZero) yMin = Math.max(0, yMin);

    var y2Min = cfg.y2Min != null ? cfg.y2Min : eR[0];
    var y2Max = cfg.y2Max != null ? cfg.y2Max : eR[1];
    var pad2 = (y2Max - y2Min) * 0.15 || 1;
    y2Min -= pad2 * 0.6; y2Max += pad2 * 0.6;

    var x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;
    function sx(v) { return x0 + (v - xMin) / (xMax - xMin) * (x1 - x0); }
    function sy(v) { return y1 - (v - yMin) / (yMax - yMin) * (y1 - y0); }
    function sy2(v) { return y1 - (v - y2Min) / (y2Max - y2Min) * (y1 - y0); }

    // 网格
    var yt = niceTicks(yMin, yMax, 4);
    var yd = tickDecimals(yt);
    ctx.font = '10.5px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yt.forEach(function (v) {
      var y = sy(v);
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = T.axis;
      ctx.fillText(fmtTick(v, yd), x0 - 8, y);
    });
    if (right.length && cfg.showRight !== false) {
      var y2t = niceTicks(y2Min, y2Max, 4);
      var y2d = tickDecimals(y2t);
      ctx.textAlign = 'left';
      y2t.forEach(function (v) {
        ctx.fillStyle = T.axisDim;
        ctx.fillText(fmtTick(v, y2d), x1 + 8, sy2(v));
      });
    }
    var xt = niceTicks(xMin, xMax, 5);
    var xd = tickDecimals(xt);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xt.forEach(function (v) {
      ctx.strokeStyle = T.gridSoft;
      ctx.beginPath(); ctx.moveTo(sx(v), y0); ctx.lineTo(sx(v), y1); ctx.stroke();
      ctx.fillStyle = T.axis;
      ctx.fillText(fmtTick(v, xd), sx(v), y1 + 8);
    });

    // 轴线
    ctx.strokeStyle = T.gridStrong;
    ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();

    // 曲线
    series.forEach(function (s, si) {
      var scale = s.axis === 'right' ? sy2 : sy;
      var color = s.color || PALETTE[si % PALETTE.length];
      var pts = [];
      s.data.forEach(function (v, i) {
        if (v == null || !isFinite(v)) return;
        pts.push([sx(xs[i]), scale(v)]);
      });
      if (!pts.length) return;

      if (s.fill) {
        var grad = ctx.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, hexA(color, 0.30));
        grad.addColorStop(1, hexA(color, 0.01));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], y1);
        pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
        ctx.lineTo(pts[pts.length - 1][0], y1);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.beginPath();
      pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || 2;
      ctx.lineJoin = 'round';
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.shadowColor = hexA(color, 0.55);
      ctx.shadowBlur = s.dashed ? 0 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
    });

    // 末端数值点
    series.forEach(function (s, si) {
      if (s.endDot === false) return;
      var scale = s.axis === 'right' ? sy2 : sy;
      var color = s.color || PALETTE[si % PALETTE.length];
      for (var i = s.data.length - 1; i >= 0; i--) {
        if (s.data[i] != null && isFinite(s.data[i])) {
          ctx.beginPath();
          ctx.arc(sx(xs[i]), scale(s.data[i]), 3.2, 0, 6.2832);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx(xs[i]), scale(s.data[i]), 6.5, 0, 6.2832);
          ctx.fillStyle = hexA(color, 0.18);
          ctx.fill();
          break;
        }
      }
    });

    // 标记点（当前工况）
    (cfg.markers || []).forEach(function (mk) {
      var mx = sx(mk.x);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = hexA(mk.color || T.mark, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke();
      ctx.setLineDash([]);
      var my = (mk.axis === 'right' ? sy2 : sy)(mk.y);
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, 6.2832);
      ctx.strokeStyle = mk.color || T.mark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, 6.2832);
      ctx.fillStyle = mk.color || T.mark;
      ctx.fill();
      if (mk.label) {
        ctx.font = '10.5px ' + FONT;
        var lw = ctx.measureText(mk.label).width;
        var bx = clamp(mx + 8, x0 + 2, x1 - lw - 14);
        var by = clamp(my - 26, y0 + 2, y1 - 18);
        ctx.fillStyle = T.tipBg;
        roundRect(ctx, bx - 5, by - 3, lw + 10, 16, 4); ctx.fill();
        ctx.strokeStyle = hexA(mk.color || T.mark, 0.3); ctx.stroke();
        ctx.fillStyle = mk.color || T.tipTxt;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(mk.label, bx, by + 5);
      }
    });

    // 轴标题（纵向排布，避免与刻度/图例重叠）
    ctx.font = '10.5px ' + FONT;
    ctx.fillStyle = T.axisMid;
    if (cfg.xLabel) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.xLabel, x1, H - 2);
    }
    if (cfg.yLabel) {
      ctx.save();
      ctx.translate(x0 - 44, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cfg.yLabel, 0, 0);
      ctx.restore();
    }
    if (cfg.y2Label && right.length) {
      ctx.save();
      ctx.font = '10px ' + FONT;
      ctx.fillStyle = T.axisDim;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.y2Label, x1 + pad.r - 2, y0 - 6);
      ctx.restore();
    }

    // 图例（单行放不下时自动换行，最多两行以配合 pad.t）
    if (cfg.legend) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '10.5px ' + FONT;
      var lx = x0, ly = 11, row = 0;
      var maxX = x1 + pad.r - 4;
      series.forEach(function (s, si) {
        var color = s.color || PALETTE[si % PALETTE.length];
        var w = 17 + ctx.measureText(s.name).width + 16;
        if (row === 0 && lx + w > maxX) {
          // 尝试整体折到第二行，重新从左侧开始
          row = 1; lx = x0; ly = 25;
        }
        if (lx + w > maxX && row === 1) return; // 两行仍放不下的条目直接省略
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly - 1, 12, 2.5);
        ctx.fillStyle = T.legend;
        ctx.fillText(s.name, lx + 17, ly);
        lx += w;
      });
    }

    // 悬停
    var hv = canvas.__hover;
    if (hv && hv.x > x0 - 6 && hv.x < x1 + 6 && hv.y > y0 - 10 && hv.y < y1 + 6) {
      var xv = xMin + (hv.x - x0) / (x1 - x0) * (xMax - xMin);
      var bestI = 0, bestD = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var d = Math.abs(xs[i] - xv);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      var hx = sx(xs[bestI]);
      ctx.strokeStyle = T.cross;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(hx, y0); ctx.lineTo(hx, y1); ctx.stroke();
      ctx.setLineDash([]);

      var lines = [{ t: (cfg.xTipLabel || 'x') + ' = ' + fmtNum(xs[bestI]) + (cfg.xUnit || ''), c: T.tipTitle }];
      series.forEach(function (s, si) {
        var color = s.color || PALETTE[si % PALETTE.length];
        var v = s.data[bestI];
        if (v == null || !isFinite(v)) return;
        var scale = s.axis === 'right' ? sy2 : sy;
        ctx.beginPath();
        ctx.arc(hx, scale(v), 3.5, 0, 6.2832);
        ctx.fillStyle = T.ring; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        lines.push({ t: s.name + '  ' + fmtNum(v) + (s.unit ? ' ' + s.unit : ''), c: color });
      });
      ctx.font = '11px ' + FONT;
      var bw = 0;
      lines.forEach(function (l) { bw = Math.max(bw, ctx.measureText(l.t).width); });
      bw += 18;
      var bh = lines.length * 16 + 8;
      var bx2 = hx + 12; if (bx2 + bw > x1) bx2 = hx - bw - 12;
      var by2 = clamp(hv.y - bh / 2, y0, y1 - bh);
      ctx.fillStyle = T.tipBg;
      roundRect(ctx, bx2, by2, bw, bh, 6); ctx.fill();
      ctx.strokeStyle = T.tipBorder; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      lines.forEach(function (l, i2) {
        ctx.fillStyle = l.c;
        ctx.fillText(l.t, bx2 + 9, by2 + 12 + i2 * 16);
      });
    }
  }

  function hexA(hex, a) {
    if (!hex) return 'rgba(255,255,255,' + a + ')';
    if (hex[0] !== '#') return hex;
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* =============================== 柱状图 =============================== */
  function bar(canvas, cfg) {
    cfg.type = 'bar';
    canvas.__chart = cfg;
    attach(canvas);
    observe(canvas);
    render(canvas);
  }

  function drawBar(canvas, cfg) {
    var P = prep(canvas);
    var ctx = P.ctx, W = P.w, H = P.h;
    var cats = cfg.categories || [];
    var series = (cfg.series || []).filter(function (s) { return s.visible !== false; });
    var pad = { l: 50, r: 16, t: 26, b: cfg.rotate ? 58 : 40 };
    var x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;

    var mx = 0, mn = 0;
    series.forEach(function (s) {
      s.data.forEach(function (v) { if (isFinite(v)) { mx = Math.max(mx, v); mn = Math.min(mn, v); } });
    });
    if (mx === mn) mx = mn + 1;
    mx = mx + (mx - mn) * 0.16;
    var yt = niceTicks(cfg.fromZero === false ? mn : Math.min(0, mn), mx, 4);
    var yd = tickDecimals(yt);

    function sy(v) { return y1 - (v - Math.min(0, mn)) / (mx - Math.min(0, mn)) * (y1 - y0); }

    ctx.font = '10.5px ' + FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) {
      ctx.strokeStyle = T.grid;
      ctx.beginPath(); ctx.moveTo(x0, sy(v)); ctx.lineTo(x1, sy(v)); ctx.stroke();
      ctx.fillStyle = T.axisMid;
      ctx.fillText(fmtTick(v, yd), x0 - 8, sy(v));
    });

    var n = cats.length;
    var groupW = (x1 - x0) / Math.max(1, n);
    var inner = groupW * 0.62;
    var bw = inner / Math.max(1, series.length);

    cats.forEach(function (c, ci) {
      series.forEach(function (s, si) {
        var v = s.data[ci];
        if (!isFinite(v)) return;
        var bx = x0 + groupW * ci + (groupW - inner) / 2 + bw * si;
        var yTop = sy(Math.max(0, v)), yBot = sy(Math.min(0, v));
        var color = cfg.colorByCategory ? PALETTE[ci % PALETTE.length] : (s.color || PALETTE[si % PALETTE.length]);
        var grad = ctx.createLinearGradient(0, yTop, 0, yBot);
        grad.addColorStop(0, hexA(color, 0.95));
        grad.addColorStop(1, hexA(color, 0.35));
        ctx.fillStyle = grad;
        var rw = Math.max(2, bw - 3);
        roundRect(ctx, bx + 1.5, yTop, rw, Math.max(2, yBot - yTop), 3);
        ctx.fill();
        // 悬停高亮
        if (canvas.__hover) {
          var hx = canvas.__hover.x, hy = canvas.__hover.y;
          if (hx > bx && hx < bx + bw && hy > y0 && hy < y1) {
            ctx.strokeStyle = T.hover;
            ctx.lineWidth = 1;
            roundRect(ctx, bx + 1.5, yTop, rw, Math.max(2, yBot - yTop), 3);
            ctx.stroke();
            ctx.font = '11px ' + FONT;
            var label = fmtNum(v) + (s.unit ? ' ' + s.unit : '');
            var lw = ctx.measureText(label).width;
            var lxp = clamp(bx + bw / 2 - lw / 2 - 6, 2, W - lw - 14);
            ctx.fillStyle = T.tipBg;
            roundRect(ctx, lxp, yTop - 26, lw + 12, 20, 5); ctx.fill();
            ctx.strokeStyle = hexA(color, 0.5); ctx.stroke();
            ctx.fillStyle = T.tipTxt; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(label, lxp + 6, yTop - 15);
            ctx.textAlign = 'right';
          }
        }
      });
      // 类别标签
      ctx.fillStyle = T.axisDim;
      ctx.font = '10.5px ' + FONT;
      if (cfg.rotate) {
        ctx.save();
        ctx.translate(x0 + groupW * ci + groupW / 2, y1 + 10);
        ctx.rotate(-Math.PI / 5);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(c, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(c, x0 + groupW * ci + groupW / 2, y1 + 9);
      }
    });

    ctx.strokeStyle = T.gridStrong;
    ctx.beginPath(); ctx.moveTo(x0, sy(Math.min(0, mn)) + 0.5); ctx.lineTo(x1, sy(Math.min(0, mn)) + 0.5); ctx.stroke();

    if (cfg.yLabel) {
      ctx.fillStyle = T.axisMid;
      ctx.font = '10.5px ' + FONT;
      ctx.save();
      ctx.translate(x0 - 44, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cfg.yLabel, 0, 0);
      ctx.restore();
    }
    if (cfg.legend && series.length > 1) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      var lx = x0;
      series.forEach(function (s, si) {
        var color = s.color || PALETTE[si % PALETTE.length];
        ctx.fillStyle = color; ctx.fillRect(lx, 8, 10, 8);
        ctx.fillStyle = T.legend; ctx.font = '10.5px ' + FONT;
        ctx.fillText(s.name, lx + 15, 12);
        lx += 15 + ctx.measureText(s.name).width + 14;
      });
    }
  }

  /* ============================== 龙卷风图 ============================== */
  function tornado(canvas, cfg) {
    cfg.type = 'tornado';
    canvas.__chart = cfg;
    attach(canvas);
    observe(canvas);
    render(canvas);
  }

  function drawTornado(canvas, cfg) {
    var P = prep(canvas);
    var ctx = P.ctx, W = P.w, H = P.h;
    var items = cfg.items || [];
    var pad = { l: 84, r: 74, t: 20, b: 16 };
    var x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;
    if (!items.length || x1 <= x0 || y1 <= y0) return;

    var mn = Infinity, mx = -Infinity;
    items.forEach(function (it) {
      mn = Math.min(mn, it.low - cfg.base, it.high - cfg.base);
      mx = Math.max(mx, it.low - cfg.base, it.high - cfg.base);
    });
    var lim = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
    lim *= 1.15;
    var cx = (x0 + x1) / 2;
    function sx(v) { return cx + v / lim * ((x1 - x0) / 2); }

    var rowH = (y1 - y0) / items.length;
    var bh = Math.min(22, rowH * 0.62);

    // 中心轴
    ctx.strokeStyle = T.cross;
    ctx.beginPath(); ctx.moveTo(cx, y0 - 4); ctx.lineTo(cx, y1 + 4); ctx.stroke();
    ctx.font = '10px ' + FONT;
    ctx.fillStyle = T.axisSoft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('基准值', cx, y0 - 8);

    items.forEach(function (it, i) {
      var cy = y0 + rowH * i + rowH / 2;
      var lowD = it.low - cfg.base, highD = it.high - cfg.base;
      // 低值条
      var a = sx(Math.min(0, lowD)), b = sx(Math.max(0, lowD));
      ctx.fillStyle = hexA(PALETTE[5], 0.75);
      roundRect(ctx, a, cy - bh / 2, Math.max(2, b - a), bh, 3); ctx.fill();
      // 高值条
      var a2 = sx(Math.min(0, highD)), b2 = sx(Math.max(0, highD));
      ctx.fillStyle = hexA(PALETTE[0], 0.85);
      roundRect(ctx, a2, cy - bh / 2, Math.max(2, b2 - a2), bh, 3); ctx.fill();

      // 参数名
      ctx.fillStyle = T.tipTxt;
      ctx.font = '10.5px ' + FONT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, pad.l - 10, cy);

      // 数值
      var txt = (lowD >= 0 ? '+' : '') + fmtNum(lowD, 1) + '/' + (highD >= 0 ? '+' : '') + fmtNum(highD, 1);
      ctx.font = '9.5px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = T.axis;
      ctx.fillText(txt, x1 + 6, cy);
    });
  }

  var Charts = {
    line: line, bar: bar, tornado: tornado,
    PALETTE: PALETTE,
    clear: function (canvas) {
      if (!canvas) return;
      canvas.__chart = null;
      var dpr = global.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      var ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    render: function (canvas) { schedule(canvas); }
  };

  Charts.THEME = T;
  Charts.syncTheme = syncTheme;

  global.Charts = Charts;
})(typeof window !== 'undefined' ? window : globalThis);
