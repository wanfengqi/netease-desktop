(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  try {
    // ---- 歌词详情页 ----
    document.getElementById('nowBox').click();
    for (let i = 0; i < 20 && !document.querySelectorAll('#npLyricInner .np-line').length; i++) await sleep(400);
    out.npOpen = !document.getElementById('npOverlay').classList.contains('hidden');
    out.npLyricLines = document.querySelectorAll('#npLyricInner .np-line').length;
    out.npTitle = document.getElementById('npTitle').textContent;
    out.npCover = !!document.getElementById('npCover').getAttribute('src');
    out.npBgSet = document.getElementById('npBg').style.backgroundImage.slice(0, 30);
    out.npActiveLine = (document.querySelector('#npLyricInner .np-line.active') || {}).textContent || null;

    // ---- 歌词偏移微调 ----
    document.getElementById('npOffsetPlus').click();
    document.getElementById('npOffsetPlus').click();
    out.offsetLabel = document.getElementById('npOffsetLabel').textContent;
    out.offsetState = state.lyricOffset;
    document.getElementById('npOffsetReset').click();
    out.offsetAfterReset = document.getElementById('npOffsetLabel').textContent;

    // ---- 歌词页收藏 ----
    const favBefore = state.favorites.length;
    document.getElementById('npFav').click(); await sleep(200);
    out.npFavToggled = state.favorites.length === favBefore + 1;
    out.npFavOn = document.getElementById('npFav').classList.contains('on');

    // ---- 睡眠定时 ----
    Player.setSleepTimer(15);
    out.sleepBtnOn = document.getElementById('sleepBtn').classList.contains('on');
    out.sleepTitle = document.getElementById('sleepBtn').title;
    Player.setSleepTimer(0);
    out.sleepCleared = !document.getElementById('sleepBtn').classList.contains('on');

    // ---- 音量持久化 ----
    Player.setVolume(0.42); await sleep(1200);
    out.volState = state.volume;
    out.volSlider = document.getElementById('vol').value;
    out.volCssVar = document.getElementById('vol').style.getPropertyValue('--v');
    const saved = (await window.dsh.config.get());
    out.volSaved = saved.volume;
    out.queueSaved = Array.isArray(saved.queue) ? saved.queue.length : -1;

    // ---- 下一首播放 / 队列操作 ----
    const probe = JSON.parse(JSON.stringify(state.queue[5]));
    const beforeLen = state.queue.length;
    Player.playNext(probe); await sleep(100);
    out.playNextInsertedAt = state.queue.findIndex(s => Norm.key(s) === Norm.key(probe)) === state.index + 1;
    out.queueGrew = state.queue.length === beforeLen + 1;
    Player.removeAt(state.queue.length - 1);
    out.queueShrank = state.queue.length === beforeLen;

    // ---- 队列拖拽重排 ----
    document.querySelector('.nav-item[data-view="playlist"]').click(); await sleep(300);
    const nameBefore = state.queue[0].name;
    const keyBefore = state.currentKey;
    let rows = document.querySelectorAll('#plist .row');
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const rect = rows[3].getBoundingClientRect();
    rows[3].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: rect.top + rect.height * 0.8, clientX: rect.left + 8 }));
    rows[3].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: rect.top + rect.height * 0.8 }));
    await sleep(300);
    out.reorderNameChanged = state.queue[0].name !== nameBefore;
    out.reorderIndexFollowsSong = state.queue[state.index] && Norm.key(state.queue[state.index]) === keyBefore;
    out.dropMarksCleared = !document.querySelector('.row.drop-before, .row.drop-after');

    // ---- 键盘快捷键：→ 快进 5 秒 ----
    const t0 = document.getElementById('audio').currentTime;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(150);
    out.seekDelta = Math.round(document.getElementById('audio').currentTime - t0);

    // ---- 皮肤面板 ----
    document.getElementById('btnTheme').click(); await sleep(250);
    out.themePanelOpen = !document.getElementById('themeOverlay').classList.contains('hidden');
    out.themeCards = document.querySelectorAll('#themeGrid .theme-card').length;
    document.querySelectorAll('#themeGrid .theme-card')[1].click(); await sleep(250);
    out.themeAfterPick = document.documentElement.getAttribute('data-theme');
    document.getElementById('btnResetTheme').click();
    document.getElementById('btnThemeClose').click();
    out.themePanelClosed = document.getElementById('themeOverlay').classList.contains('hidden');
    out.themeBackToDefault = document.documentElement.getAttribute('data-theme');
  } catch (e) { out.ERROR = e.message + ' @ ' + (e.stack || '').split('\n')[1]; }
  return JSON.stringify(out, null, 1);
})()