/* 页面访问量计数：使用 abacus 免费计数服务（无需后端，跨域可用）
 * /hit 每次加载 +1 并返回累计值；失败则静默隐藏。
 */
(function () {
  'use strict';
  var box = document.getElementById('visits');
  var numEl = document.getElementById('visits-num');
  if (!box || !numEl || typeof fetch === 'undefined') { if (box) box.style.display = 'none'; return; }

  var HIT = 'https://abacus.jasoncameron.dev/hit/arknights-sorter-katatsu/pageviews';
  fetch(HIT)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && typeof d.value === 'number') {
        numEl.textContent = d.value.toLocaleString('en-US');
      } else {
        box.style.display = 'none';
      }
    })
    .catch(function () { box.style.display = 'none'; });
})();
