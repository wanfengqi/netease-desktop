(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  const cur = state.queue[state.index];
  out.songKey = Norm.key(cur);
  out.songName = cur.name;
  out.favBefore = state.favorites.map(s => Norm.key(s));
  out.isFavNow = Views.isFavorite(cur);
  document.getElementById('npFav').click(); await sleep(250);
  out.afterFirstClick = Views.isFavorite(cur);
  out.favLenAfter1 = state.favorites.length;
  document.getElementById('npFav').click(); await sleep(250);
  out.afterSecondClick = Views.isFavorite(cur);
  out.favLenAfter2 = state.favorites.length;
  out.npFavIconOn = document.getElementById('npFav').classList.contains('on');
  // 顶栏/侧栏计数一致性
  out.countsMatch = document.getElementById('favCount').textContent === String(state.favorites.length)
    && document.getElementById('sideFavCount').textContent === String(state.favorites.length);
  // 暂停/继续
  Player.toggle(); await sleep(300);
  out.pausedAfterToggle = document.getElementById('audio').paused;
  out.playBtnIconWhenPaused = /path/.test(document.getElementById('btnPlay').innerHTML);
  Player.toggle(); await sleep(300);
  out.playingAfterToggle = !document.getElementById('audio').paused;
  // 上一首/下一首
  const k0 = state.currentKey;
  Player.next(false); await sleep(2500);
  out.nextChanged = state.currentKey !== k0;
  Player.prev(); await sleep(2500);
  out.prevBack = state.currentKey === k0;
  return JSON.stringify(out, null, 1);
})()