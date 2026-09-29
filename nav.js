/* ============================================================
   全站导航高亮脚本（Day 9 起）
   ------------------------------------------------------------
   作用：给当前页面对应的导航项加上高亮 class，不用每页手写。
   规则八.1：中文注释，命名简单直白。

   原理：每页的 <body> 上会写一个 data-page="xxx"，
        这个脚本找到导航里 data-nav="xxx" 的那一项，
        给它加 .nav-current，当前页就亮起来了。
   ============================================================ */
(function () {
  // 把"高亮当前页导航项"这步单独抽出来，方便在多个时机调用
  function markCurrent() {
    // 当前页的名字，从 <body data-page="..."> 读出来
    var currentPage = document.body.getAttribute("data-page");
    if (!currentPage) {
      return; // 没写 data-page 就不做任何事，静默退出
    }

    // 找到导航里名字对得上的那一项，给它加高亮
    var link = document.querySelector('.site-nav a[data-nav="' + currentPage + '"]');
    if (link) {
      link.classList.add("nav-current");
    }
  }

  // 关键：越早执行越好，避免"页面已经出来了、导航高亮才晚半拍补上"的闪烁。
  // 脚本虽然放在 </body> 末尾，但浏览器是从上往下解析的，
  // 跑到这里时导航栏（<nav>）早就解析完了，所以此时高亮是"随页面一起出来"的，不闪。
  // 再补一个兜底：万一脚本因为加载顺序被推迟，等文档完全就绪后再执行一次，
  // 保证高亮一定到位（重复调用没关系，class 只会加一次）。
  markCurrent();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markCurrent);
  }
})();
