/* =========================================================================
 *  亮暗主题切换 · 扩散圆过渡
 *  -------------------------------------------------------------------------
 *  做法：以主题按钮为圆心，先把「新主题」的一帧快照裁成 0 半径的圆，
 *  再让它像墨水一样向外洇开，把旧主题盖住。
 *
 *  优先用浏览器原生的 View Transitions API（Chrome/Edge 111+），
 *  它能在同一帧里截取切换前后的画面，所以圆里看到的是**完整的新界面**，
 *  而不是一块纯色。圆心坐标通过 CSS 变量 --theme-x/--theme-y 传给伪元素。
 *
 *  不支持该 API 的浏览器退回到遮罩圆：铺一层新主题底色的圆盖住旧画面，
 *  盖满后切换主题再淡出，观感接近但内容是纯色。
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'hdu-lab-theme';
  var DURATION = 620;

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function read() {
    try {
      var t = localStorage.getItem(KEY);
      return (t === 'light' || t === 'dark') ? t : 'dark';
    } catch (e) { return 'dark'; }
  }

  function save(t) {
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }

  function prefersReduced() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* 圆心默认取主题按钮的中心；按钮不存在就取视口中心 */
  function originPoint(btn) {
    if (btn && btn.getBoundingClientRect) {
      var r = btn.getBoundingClientRect();
      if (r.width || r.height) {
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }
    return { x: Math.round(global.innerWidth / 2), y: Math.round(global.innerHeight / 2) };
  }

  /* 覆盖整个视口所需的半径：取圆心到最远角的距离 */
  function coverRadius(x, y) {
    var w = global.innerWidth || 1, h = global.innerHeight || 1;
    var dx = Math.max(x, w - x), dy = Math.max(y, h - y);
    return Math.ceil(Math.sqrt(dx * dx + dy * dy));
  }

  /* 读取目标主题的底色与底图，供遮罩圆使用 */
  function themePaintOf(t) {
    var root = document.documentElement;
    var cur = root.getAttribute('data-theme');
    var bg = '', img = '';
    try {
      root.setAttribute('data-theme', t);
      var cs = getComputedStyle(root);
      bg = (cs.getPropertyValue('--bg') || '').trim();
      img = (cs.getPropertyValue('--body-img') || '').trim();
    } catch (e) {}
    if (cur) root.setAttribute('data-theme', cur);
    else root.removeAttribute('data-theme');
    return { bg: bg, img: img };
  }

  /* ------------------------------ 遮罩圆（回退方案） ------------------------------ */
  function veilSwitch(next, apply, p) {
    var paint = themePaintOf(next);
    var veil = document.createElement('div');
    veil.className = 'theme-veil';
    if (paint.bg) veil.style.backgroundColor = paint.bg;
    if (paint.img) veil.style.backgroundImage = paint.img;
    veil.style.setProperty('--theme-x', p.x + 'px');
    veil.style.setProperty('--theme-y', p.y + 'px');
    veil.style.setProperty('--theme-r', coverRadius(p.x, p.y) + 'px');
    document.body.appendChild(veil);
    void veil.offsetWidth;          // 强制回流，确保下面的 class 变化能触发过渡
    veil.classList.add('in');
    setTimeout(function () {
      apply();
      veil.classList.remove('in');
      veil.classList.add('out');
      setTimeout(function () { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 420);
    }, Math.round(DURATION * 0.62));
  }

  /* 连点时只保留最后一次过渡：前一次的收尾不能把新一次的状态清掉 */
  var token = 0;

  /* -------------------------------- 主入口 -------------------------------- */
  /**
   * @param {string} next   目标主题：'light' | 'dark'
   * @param {object} opts   { button, apply, done }
   *   apply：真正改变主题的回调（改 data-theme、重绘画布等）
   *   done：过渡结束后的回调（弹提示等）
   */
  function switchTo(next, opts) {
    opts = opts || {};
    var root = document.documentElement;
    var apply = opts.apply || function () {
      root.setAttribute('data-theme', next);
      save(next);
    };
    var done = opts.done || function () {};

    if (prefersReduced()) {          // 用户要求减少动效：直接切，不做动画
      apply();
      done();
      return;
    }

    var p = originPoint(opts.button);
    var hasVT = typeof document.startViewTransition === 'function';

    if (!hasVT) {
      veilSwitch(next, apply, p);
      setTimeout(done, DURATION);
      return;
    }

    root.style.setProperty('--theme-x', p.x + 'px');
    root.style.setProperty('--theme-y', p.y + 'px');
    root.style.setProperty('--theme-r', coverRadius(p.x, p.y) + 'px');
    root.classList.add('theme-vt');

    var myToken = ++token;
    var vt;
    try {
      vt = document.startViewTransition(function () { apply(); });
    } catch (e) {
      root.classList.remove('theme-vt');
      apply();
      done();
      return;
    }

    var settle = function () {
      if (myToken !== token) return;      // 已被更新的那一次接管，状态不重复清理
      root.classList.remove('theme-vt');
      root.style.removeProperty('--theme-x');
      root.style.removeProperty('--theme-y');
      root.style.removeProperty('--theme-r');
      done();
    };
    vt.finished.then(settle, settle);
  }

  global.Theme = {
    KEY: KEY,
    current: current,
    read: read,
    save: save,
    switchTo: switchTo,
    originPoint: originPoint
  };
})(typeof window !== 'undefined' ? window : globalThis);
