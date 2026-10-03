(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  out.nowPlaying = document.getElementById('nowTitle').textContent;
  Views.openNp();
  for (let i = 0; i < 20 && !document.querySelectorAll('#npLyricInner .np-line').length; i++) await sleep(400);
  out.npLines = document.querySelectorAll('#npLyricInner .np-line').length;
  out.firstLines = Array.from(document.querySelectorAll('#npLyricInner .np-line')).slice(0, 3).map(n => n.textContent);
  out.activeExists = !!document.querySelector('#npLyricInner .np-line.active');
  Views.closeNp();
  return JSON.stringify(out, null, 1);
})()