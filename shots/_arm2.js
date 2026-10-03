(async function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && typeof Views === 'undefined'; i++) await sleep(500);
  window.__origCloseNp = window.__origCloseNp || Views.closeNp;
  window.__closeCount = 0;
  window.__ev2 = [];
  document.getElementById('npClose').onclick = function () { window.__closeCount++; window.__origCloseNp(); };
  ['mousedown', 'mouseup', 'click'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      var el = e.target, chain = [];
      while (el && chain.length < 4) { chain.push(el.tagName + (el.id ? '#' + el.id : '')); el = el.parentElement; }
      window.__ev2.push(t + ' -> ' + chain.join('<'));
    }, true);
  });
  if (!Views.isNpOpen()) Views.openNp();
  var b = document.getElementById('npClose').getBoundingClientRect();
  return JSON.stringify({
    npOpen: Views.isNpOpen(),
    bodyClass: document.body.className,
    titlebarDrag: getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion,
    btnCenter: [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)],
    sx: window.screenX, sy: window.screenY
  });
})()