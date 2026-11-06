/* NJV 工作台 · 中英切换（零依赖、无外部请求、无 key）
 *
 * 三层机制：
 *  ① 结构化替换：页面上每个"含中文的静态元素"都带 data-en="英文 HTML"。
 *     切英文 = 用 data-en 覆盖该元素；切回中文 = 还原首次进入时缓存的原文。
 *  ② JS 字符串：页面源码里动态拼接的中文用 L("中文","English") 包装，
 *     渲染时直接产出当前语言的文案（精确英文，不是运行时猜测）。
 *  ③ 术语表替换：数据驱动的中文标签（品类、邮区名等）由 NJV_TERMS 术语表
 *     按子串替换，并监听 DOM 变更，保证后渲染的内容也会被翻译。
 *  ④ 属性级替换：placeholder / title / aria-label 这类"看得见但不在文本节点里"
 *     的文案，由 NJV_ATTR_EN 短句表处理（支持切回中文还原）。
 *
 * 为什么能杜绝"中英混杂"（上次踩过的坑）：
 *   .workbuddy/check_lang.py 强制校验五件事 ——
 *     ① 每个含中文的文本节点，其祖先链上必须存在 data-en 元素（否则漏翻）；
 *     ② data-en 的值里不得再含中文（否则翻完还是中文）；
 *     ③ data-en 元素之间不得互相嵌套（否则外层替换会吃掉内层）；
 *     ④ 中文 aria-label 必须有 data-en-aria；
 *     ⑤ data-en 取值不得为空。
 *   再由 check_en_runtime.py 用 headless Chrome 扫渲染后的文本与可读属性，
 *   以及运行时的残留中文计数（console.warn），任何漏翻都会被暴露。
 */
(function () {
  var KEY = 'njv_lang';
  var state = { lang: 'zh' };
  var TERMS = window.NJV_TERMS || {};
  var ATTR_EN = window.NJV_ATTR_EN || {};
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  var termKeys = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });

  function stored() { try { return localStorage.getItem(KEY) || 'zh'; } catch (e) { return 'zh'; } }
  function store(l) { try { localStorage.setItem(KEY, l); } catch (e) {} }
  function fromQuery() {
    try { var m = /[?&]lang=(en|zh)/.exec(location.search); return m ? m[1] : null; } catch (e) { return null; }
  }

  /* ② JS 字符串助手：L("中文","English") → 返回当前语言的文案。
   *    必须在页面自身脚本之前加载（本文件放在 <head> 内联加载）。 */
  function L(zh, en) { return state.lang === 'en' ? en : zh; }
  window.L = L;

  function setContent(el, html) {
    // 叶子元素（无子节点）用 textContent：兼容 SVG <text>（SVGElement.innerHTML 行为不一）
    if (el.children.length === 0) el.textContent = html; else el.innerHTML = html;
  }

  function swap(el, html) {
    if (el.__zh === undefined) el.__zh = el.innerHTML;
    if (state.lang === 'en') { setContent(el, html); el.setAttribute('data-en-on', '1'); }
    else if (el.getAttribute('data-en-on') === '1') { setContent(el, el.__zh); el.removeAttribute('data-en-on'); }
  }

  // ── ③ 术语表替换（数据驱动的中文标签：品类 / 邮区名等） ──────────────
  function translateTerms(root) {
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return 0;
    var nodes = [], n;
    if (scope.nodeType === 3) {
      nodes.push(scope);
    } else {
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
      while ((n = walker.nextNode())) nodes.push(n);
    }
    var left = 0;
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i], p = nd.parentNode;
      if (!p || p.nodeType !== 1) continue;
      if (p.closest && p.closest('script,style')) continue;
      if (p.closest && p.closest('[data-en]')) continue;   // 已被结构化翻译覆盖
      var t = nd.nodeValue;
      if (!t || !/[\u4e00-\u9fff]/.test(t)) continue;
      if (nd.__zh === undefined) nd.__zh = t;
      var out = nd.__zh;
      for (var k = 0; k < termKeys.length; k++) {
        var key = termKeys[k];
        if (out.indexOf(key) >= 0) out = out.split(key).join(TERMS[key]);
      }
      if (state.lang === 'en') {
        // 已是我们自己写入的英文 → 不重复处理（避免 MutationObserver 自激）
        if (nd.nodeValue !== out) { nd.__en = out; nd.nodeValue = out; }
        if (/[\u4e00-\u9fff]/.test(out)) left++;
      } else {
        if (nd.nodeValue !== nd.__zh) { nd.nodeValue = nd.__zh; }
      }
    }
    return left;
  }

  // ── ④ 属性级替换（placeholder / title / aria-label） ──────────────────
  // 这些文案不在文本节点里，check_lang.py 扫不到，但用户看得到：
  //   搜索框 placeholder、iframe 悬停 title、读屏 aria-label。
  // 目标英文优先级：元素自带的 data-en-* 属性 > ATTR_EN 整句表 > 术语表逐词兜底。
  // 中文原值缓存在 el.__zhAttr 上，切回中文可精确还原。
  var ATTR_SPEC = [
    { name: 'placeholder', marker: 'data-en-ph' },
    { name: 'title', marker: 'data-en-title' },
    { name: 'aria-label', marker: 'data-en-aria' }
  ];

  function enAttrValue(el, zh, marker) {
    if (el.hasAttribute(marker)) return el.getAttribute(marker);
    if (ATTR_EN[zh]) return ATTR_EN[zh];
    var out = zh;
    for (var i = 0; i < termKeys.length; i++) {
      var k = termKeys[i];
      if (out.indexOf(k) >= 0) out = out.split(k).join(TERMS[k]);
    }
    return out;
  }

  function swapAttrs(root) {
    var scope = root || document;
    var nodes = [];
    if (scope.nodeType === 1) nodes.push(scope);   // 动态新增节点：属性可能就在节点自身
    if (scope.querySelectorAll) {
      var extra = scope.querySelectorAll('[placeholder],[title],[aria-label]');
      for (var e = 0; e < extra.length; e++) nodes.push(extra[e]);
    }
    for (var a = 0; a < ATTR_SPEC.length; a++) {
      var name = ATTR_SPEC[a].name, marker = ATTR_SPEC[a].marker;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!el.hasAttribute || !el.hasAttribute(name)) continue;
        if (!el.__zhAttr) el.__zhAttr = {};
        var cur = el.getAttribute(name) || '';
        if (el.__zhAttr[name] === undefined) {
          if (!CJK.test(cur)) continue;          // 本来就是英文，无需接管
          el.__zhAttr[name] = cur;
        }
        var zh = el.__zhAttr[name];
        var target = state.lang === 'en' ? enAttrValue(el, zh, marker) : zh;
        if (el.getAttribute(name) !== target) el.setAttribute(name, target);
      }
    }
  }

  function apply(scope) {
    var root = scope || document;
    var els = root.querySelectorAll('[data-en]');
    for (var i = 0; i < els.length; i++) swap(els[i], els[i].getAttribute('data-en'));
    swapAttrs(root);
    var r = document.documentElement;
    r.setAttribute('data-lang', state.lang);
    r.setAttribute('lang', state.lang === 'en' ? 'en' : 'zh-CN');
    var tz = r.getAttribute('data-title-zh'), te = r.getAttribute('data-title-en');
    if (tz && te) document.title = state.lang === 'en' ? te : tz;
    var btn = document.getElementById('langBtn');
    if (btn) btn.textContent = state.lang === 'en' ? '中文' : 'EN';
    var left = translateTerms(root);
    if (state.lang === 'en' && left) console.warn('[i18n] EN 模式仍有 ' + left + ' 处中文未翻译');
    try { store(state.lang); } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('njvlang', { detail: { lang: state.lang, left: left } }));
    } catch (e) {}
  }

  function broadcast(l) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ __njvLang: l }, '*');
      var fs = document.querySelectorAll('iframe.frame');
      for (var i = 0; i < fs.length; i++) {
        try { fs[i].contentWindow.postMessage({ __njvLang: l }, '*'); } catch (e) {}
      }
    } catch (e) {}
  }

  function setLang(l, send) {
    state.lang = (l === 'en') ? 'en' : 'zh';
    apply();
    if (send !== false) broadcast(state.lang);
  }

  // 同步解析当前语言：URL ?lang= 优先，其次 localStorage，最后中文
  state.lang = fromQuery() || stored();

  // ── 监听 DOM 变更：JS 动态渲染的数据标签（品类/邮区）也实时翻译 ──────
  var mo = null;
  function startObserver() {
    if (mo || !window.MutationObserver) return;
    mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            translateTerms(m.addedNodes[j]);
            if (m.addedNodes[j].nodeType === 1) swapAttrs(m.addedNodes[j]);
          }
        } else if (m.type === 'characterData') {
          var nd = m.target;
          if (!nd || !nd.parentNode) continue;
          // 我们自己写入的英文（__en）→ 跳过，避免自激循环
          if (nd.__en !== undefined && nd.nodeValue === nd.__en) continue;
          // 页面 JS 重新渲染的新内容 → 重新缓存中文原值
          nd.__zh = nd.nodeValue; nd.__en = undefined;
          translateTerms(nd);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // 独立打开（未嵌在 index.html 内）时，若页面没有自带切换按钮则注入一个
  function ensureBtn() {
    if (document.getElementById('langBtn')) return;
    if (window.parent && window.parent !== window) return;   // 嵌在父页内，用父页的按钮
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'langBtn'; b.className = 'langbtn';
    b.textContent = state.lang === 'en' ? '中文' : 'EN';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#0f172a;color:#fff;'
      + 'border:0;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;'
      + 'box-shadow:0 6px 20px rgba(15,23,42,.28);font-family:inherit;';
    b.addEventListener('click', function () { setLang(state.lang === 'en' ? 'zh' : 'en', true); });
    document.body.appendChild(b);
  }

  function init() {
    apply();
    ensureBtn();
    startObserver();
    var btn = document.getElementById('langBtn');
    if (btn && !btn.__bound) {
      btn.__bound = 1;
      btn.addEventListener('click', function () { setLang(state.lang === 'en' ? 'zh' : 'en', true); });
    }
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (d && d.__njvLang && d.__njvLang !== state.lang) { state.lang = d.__njvLang; apply(); }
    });
    // 独立打开（未嵌在 index.html 内）时才显示本页自带的切换按钮
    if (window.parent && window.parent !== window && btn) btn.style.display = 'none';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.NJVLang = {
    current: function () { return state.lang; },
    set: setLang,
    apply: apply,
    terms: function () { return TERMS; },
    L: L
  };
})();
