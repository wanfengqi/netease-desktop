(function () {
  var g = function (sel) { var e = document.querySelector(sel); if (!e) return null; var b = e.getBoundingClientRect(); return [Math.round(b.x + b.width/2), Math.round(b.y + b.height/2)]; };
  return JSON.stringify({
    npOpen: Views.isNpOpen(),
    bodyClass: document.body.className,
    titlebarDrag: getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion,
    tbActionsDrag: getComputedStyle(document.querySelector('.tb-actions')).webkitAppRegion,
    btnTheme: g('#btnTheme'),
    btnLyric: g('#btnLyric'),
    btnMin: g('#btnMin'),
    sx: window.screenX, sy: window.screenY
  });
})()