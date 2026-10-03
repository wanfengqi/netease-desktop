(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  try {
    // ---- 1) 音源切换（修复点：原代码这里引用未定义的 cfg 会抛错并中断） ----
    const tabs = document.querySelectorAll('.src-tab');
    tabs[1].click(); await sleep(400);
    out.sourceAfterMigu = state.source;
    out.miguTabActive = document.querySelector('.src-tab.active').dataset.src;
    tabs[0].click(); await sleep(400);
    out.sourceBackNetease = state.source;

    // ---- 2) 搜索 ----
    document.getElementById('q').value = '周杰伦';
    document.getElementById('btnSearch').click();
    for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
    out.searchRows = document.querySelectorAll('#results .row').length;
    out.resultBarShown = !document.getElementById('resultBar').classList.contains('hidden');
    out.skeletonCleared = !document.querySelector('#results .sk-list');
    out.rowHasPlayBtn = !!document.querySelector('#results .row .row-play');
    out.rowCover = (document.querySelector('#results .row .row-cover') || {}).getAttribute
      ? String(document.querySelector('#results .row .row-cover').getAttribute('src')).slice(0, 46) : '';
    out.historyRecorded = state.history[0];

    // ---- 3) 播放 ----
    document.querySelectorAll('#results .row')[0].click();
    for (let i = 0; i < 30 && !document.getElementById('audio').src; i++) await sleep(500);
    await sleep(1200);
    out.audioHasSrc = !!document.getElementById('audio').src;
    out.nowTitle = document.getElementById('nowTitle').textContent;
    out.currentKey = state.currentKey;
    out.playingRowKey = (document.querySelector('#results .row.playing') || {}).dataset
      ? document.querySelector('#results .row.playing').dataset.key : null;
    out.eqVisible = !!document.querySelector('#results .row.playing .eq');
    out.mediaSessionTitle = navigator.mediaSession && navigator.mediaSession.metadata
      ? navigator.mediaSession.metadata.title : null;
    out.recentLen = state.recent.length;
    out.playIconIsPause = /rect/.test(document.getElementById('btnPlay').innerHTML);
    out.bufWidth = document.getElementById('barBuf').style.width;

    // ---- 4) 右键菜单 ----
    const r2 = document.querySelectorAll('#results .row')[1];
    r2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }));
    await sleep(250);
    out.menuItems = Array.from(document.querySelectorAll('.ctx-menu .ctx-label')).map(e => e.textContent);
    UI.closeMenu();
    out.menuClosed = !document.querySelector('.ctx-menu');

    // ---- 5) 最近播放 / 队列视图 ----
    document.querySelector('.nav-item[data-view="recent"]').click(); await sleep(400);
    out.recentRows = document.querySelectorAll('#recentList .row').length;
    out.recentVisible = !document.getElementById('view-recent').classList.contains('hidden');
    document.querySelector('.nav-item[data-view="playlist"]').click(); await sleep(300);
    out.queueRows = document.querySelectorAll('#plist .row').length;
    out.queueDraggable = document.querySelector('#plist .row').draggable;
    out.sideQueueCount = document.getElementById('sideQueueCount').textContent;
  } catch (e) { out.ERROR = e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join(' | '); }
  return JSON.stringify(out, null, 1);
})()