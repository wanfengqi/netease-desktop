(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 60 && typeof Player === 'undefined'; i++) await sleep(500);
  await sleep(6000);                       // 等内置 API 子进程起来
  out.modules = [typeof Player, typeof Views, typeof UI, typeof Norm, typeof Icons].join(',');
  out.svgs = document.querySelectorAll('svg').length;
  out.queueRestored = state.queue.length;
  out.volRestored = state.volume;
  // 搜索（会走打包后的 NeteaseCloudMusicApi）
  document.getElementById('q').value = '五月天';
  document.getElementById('btnSearch').click();
  for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
  out.searchRows = document.querySelectorAll('#results .row').length;
  out.first = (document.querySelector('#results .row .row-name-text') || {}).textContent;
  // 播放
  document.querySelectorAll('#results .row')[0].click();
  for (let i = 0; i < 30 && !document.getElementById('audio').src; i++) await sleep(500);
  await sleep(1500);
  out.plays = !!document.getElementById('audio').src;
  out.nowTitle = document.getElementById('nowTitle').textContent;
  out.mediaSession = navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : null;
  return JSON.stringify(out, null, 1);
})()