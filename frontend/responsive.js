/* NJV · SG 需求情报工作台 —— 统一响应式行为层
 * 1) 给所有 <table> 包一层可横向滚动的 .tbl-scroll（保持 table 原生布局不变）
 * 2) 把按像素绝对定位的地图画布（#mapfit）按容器宽度等比缩放，而不是溢出屏幕
 * 3) 把内容高度 postMessage 给父框架，让手机端 iframe 自然撑开、只有一条滚动条
 * 桌面端：第 3 条由父框架忽略；第 2 条 scale 恒为 1，视觉零变化。
 */
(function () {
  'use strict';

  function wrapTables() {
    if (!document.querySelectorAll) return;
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], p = t.parentElement;
      if (p && p.classList && p.classList.contains('tbl-scroll')) continue;
      if (t.closest && t.closest('.tbl-scroll')) continue;
      var box = document.createElement('div');
      box.className = 'tbl-scroll';
      if (t.parentNode) { t.parentNode.insertBefore(box, t); box.appendChild(t); }
    }
  }

  function fitPixelMap() {
    var inner = document.getElementById('mapfit');
    if (!inner) return;
    var host = inner.parentElement;
    var grid = document.getElementById('grid');
    if (!host || !grid) return;
    var w = grid.offsetWidth, h = grid.offsetHeight;
    if (!w || !h) return;
    var cs = window.getComputedStyle(host);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var avail = host.clientWidth - padX;
    var s = avail > 0 ? Math.min(1, avail / w) : 1;
    if (!isFinite(s) || s <= 0) s = 1;
    inner.style.width = w + 'px';
    inner.style.height = h + 'px';
    inner.style.transform = 'scale(' + s + ')';
    host.style.height = Math.ceil(h * s + padY) + 'px';
  }

  function notifyHeight() {
    try {
      if (window.parent === window) return;
      var h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      );
      if (h > 0) window.parent.postMessage({ __njvFrameHeight: h }, '*');
    } catch (e) { /* 跨域 / 无父框架，忽略 */ }
  }

  function run() {
    wrapTables();
    fitPixelMap();
    notifyHeight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // 字体、动画、Leaflet 等会在 load 之后才定高，补两拍
  window.addEventListener('load', function () {
    setTimeout(run, 60);
    setTimeout(run, 450);
  });

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { fitPixelMap(); notifyHeight(); }, 120);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { fitPixelMap(); notifyHeight(); }, 250);
  });

  // 子页面交互（筛选、展开）改变内容高度时通知父框架
  if (window.ResizeObserver && document.body) {
    var nt;
    try {
      new ResizeObserver(function () {
        clearTimeout(nt);
        nt = setTimeout(notifyHeight, 120);
      }).observe(document.body);
    } catch (e) { /* noop */ }
  }
})();
