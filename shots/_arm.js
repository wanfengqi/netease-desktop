(function () {
  window.__origCloseNp = window.__origCloseNp || Views.closeNp;
  window.__closeCount = 0;
  window.__ev2 = [];
  document.getElementById('npClose').onclick = function () { window.__closeCount++; window.__origCloseNp(); };
  ['mousedown', 'mouseup', 'click'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      var el = e.target;
      var chain = [];
      while (el && chain.length < 4) { chain.push(el.tagName + (el.id ? '#' + el.id : '')); el = el.parentElement; }
      window.__ev2.push(t + ' -> ' + chain.join('<') + ' @' + e.clientX + ',' + e.clientY);
    }, true);
  });
  document.getElementById('npOverlay').style.animation = 'none';
  if (!Views.isNpOpen()) Views.openNp();
  return 'armed npOpen=' + Views.isNpOpen() + ' btnCenter=' + JSON.stringify((function () {
    var b = document.getElementById('npClose').getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  })());
})()