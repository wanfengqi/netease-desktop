(async function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60 && typeof Views === 'undefined'; i++) await sleep(500);
  await sleep(4000);
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
  // 顺带验证收藏键回归是否修好
  document.getElementById('q').value = '陈奕迅';
  document.getElementById('btnSearch').click();
  for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
  var hasFav = !!document.querySelector('#results .row .row-fav');
  var favBefore = state.favorites.length;
  if (hasFav) { document.querySelector('#results .row .row-fav').click(); }
  await sleep(300);
  var favToggled = state.favorites.length !== favBefore;
  // 打开歌词页并冻结入场动画，保证测量=视觉位置
  if (!Views.isNpOpen()) Views.openNp();
  document.getElementById('npOverlay').style.animation = 'none';
  await sleep(300);
  var b = document.getElementById('npClose').getBoundingClientRect();
  return JSON.stringify({
    searchRows: document.querySelectorAll('#results .row').length,
    hasFavBtn: hasFav,
    favToggled: favToggled,
    bodyClass: document.body.className,
    titlebarDrag: getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion,
    btnCenter: [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)],
    sx: window.screenX, sy: window.screenY
  });
})()