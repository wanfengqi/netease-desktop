(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40 && typeof Views === 'undefined'; i++) await sleep(500);
  document.querySelector('.src-tab[data-src="netease"]').click(); await sleep(300);
  document.getElementById('q').value = '陈奕迅';
  document.getElementById('btnSearch').click();
  for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
  const out = {};
  out.searchRows = document.querySelectorAll('#results .row').length;
  out.hasFavBtn = !!document.querySelector('#results .row .row-fav');
  const before = state.favorites.length;
  document.querySelector('#results .row .row-fav').click(); await sleep(250);
  out.favToggled = state.favorites.length === before + 1;
  out.favIconOn = document.querySelector('#results .row .row-fav').classList.contains('on');
  // 队列视图仍应有删除键
  Views.show('playlist'); await sleep(300);
  out.queueHasDel = !!document.querySelector('#plist .row .row-del');
  out.queueHasFav = !!document.querySelector('#plist .row .row-fav');
  Views.show('search');
  return JSON.stringify(out, null, 1);
})()