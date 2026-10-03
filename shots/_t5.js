(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  for (let i = 0; i < 40 && !document.querySelector('.src-tab'); i++) await sleep(500);
  await sleep(2000);
  document.querySelector('.src-tab[data-src="migu"]').click();
  await sleep(400);
  document.getElementById('q').value = '晴天';
  document.getElementById('btnSearch').click();
  for (let i = 0; i < 40 && !document.querySelector('#results .row'); i++) await sleep(500);
  out.miguRows = document.querySelectorAll('#results .row').length;
  out.firstName = (document.querySelector('#results .row .row-name-text') || {}).textContent;
  out.firstSub = (document.querySelector('#results .row .row-artist-text') || {}).textContent;
  out.firstHasCover = !!document.querySelector('#results .row .row-cover').getAttribute('src');
  out.badgeMigu = !!document.querySelector('#results .row .badge-src');
  document.querySelectorAll('#results .row')[0].click();
  for (let i = 0; i < 30 && !document.getElementById('audio').src; i++) await sleep(500);
  await sleep(1500);
  out.miguPlays = !!document.getElementById('audio').src;
  out.miguDuration = Math.round(document.getElementById('audio').duration || 0);
  out.miguNowTitle = document.getElementById('nowTitle').textContent;
  out.miguLyricLines = document.querySelectorAll('#npLyricInner .np-line').length;
  out.mediaSessionArtist = navigator.mediaSession.metadata ? navigator.mediaSession.metadata.artist : null;
  return JSON.stringify(out, null, 1);
})()