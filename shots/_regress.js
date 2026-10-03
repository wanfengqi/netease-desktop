(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  try {
    // 复位
    Views.setLyricOffset(0, 0);
    if (Views.isNpOpen()) Views.closeNp();
    await sleep(300);
    out.overlayClassCleared = document.body.className === '';
    out.titlebarDragRestored = getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion === 'drag';

    // 搜索
    document.getElementById('q').value = '陈奕迅';
    document.getElementById('btnSearch').click();
    for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
    out.searchRows = document.querySelectorAll('#results .row').length;
    // 播放
    document.querySelectorAll('#results .row')[0].click();
    for (let i = 0; i < 30 && !document.getElementById('audio').src; i++) await sleep(500);
    await sleep(1200);
    out.plays = !!document.getElementById('audio').src;
    out.title = document.getElementById('nowTitle').textContent;
    out.mediaSession = navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : null;
    // 右键菜单
    var r2 = document.querySelectorAll('#results .row')[1];
    r2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }));
    await sleep(250);
    out.menuItems = Array.from(document.querySelectorAll('.ctx-menu .ctx-label')).map(function (e) { return e.textContent; }).length;
    UI.closeMenu();
    // 收藏
    var before = state.favorites.length;
    document.querySelectorAll('#results .row')[0].querySelector('.row-fav').click();
    await sleep(200);
    out.favToggled = state.favorites.length !== before;
    // 队列视图 + 侧栏计数
    Views.show('playlist');
    await sleep(300);
    out.queueRows = document.querySelectorAll('#plist .row').length;
    out.sideQueue = document.getElementById('sideQueueCount').textContent;
    // 最近播放
    Views.show('recent');
    await sleep(300);
    out.recentRows = document.querySelectorAll('#recentList .row').length;
    // 歌词页开合
    Views.openNp(); await sleep(600);
    out.npLines = document.querySelectorAll('#npLyricInner .np-line').length;
    Views.closeNp(); await sleep(300);
    out.npClosed = !Views.isNpOpen();
    Views.show('search');
  } catch (e) { out.ERROR = e.message; }
  return JSON.stringify(out, null, 1);
})()