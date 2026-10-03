(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  out.volumeRestored = state.volume;
  out.mutedRestored = state.muted;
  out.queueRestored = state.queue.length;
  out.nowTitleRestored = document.getElementById('nowTitle').textContent;
  out.audioNotAutoplaying = !document.getElementById('audio').src;
  out.queueViewRows = document.querySelectorAll('#plist .row').length;
  out.sideCounts = [document.getElementById('sideQueueCount').textContent, document.getElementById('sideFavCount').textContent];
  out.volSlider = document.getElementById('vol').value;

  // ---- 上一首应回到真正听过的那首（随机模式下尤其重要） ----
  Player.setMode('shuffle');
  const a = state.queue[0], b = state.queue[5], c = state.queue[9];
  Player.playAt(0); await sleep(1500);
  Player.playAt(5); await sleep(1500);
  Player.playAt(9); await sleep(1500);
  out.walkKeys = [a.name, b.name, c.name];
  Player.prev(); await sleep(1500);
  out.afterPrev1 = state.queue[state.index].name;
  Player.prev(); await sleep(1500);
  out.afterPrev2 = state.queue[state.index].name;
  out.prevWalksBack = out.afterPrev1 === b.name && out.afterPrev2 === a.name;
  // 顺序模式下的 next/prev 也应自洽
  Player.setMode('list');
  Player.playAt(3); await sleep(1200);
  Player.next(false); await sleep(1200);
  out.nextThenPrevBack = (() => { Player.prev(); return true; })();
  await sleep(1500);
  out.backName = state.queue[state.index].name;
  out.expectedName = state.queue[3].name;
  return JSON.stringify(out, null, 1);
})()