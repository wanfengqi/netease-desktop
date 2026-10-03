const cdp = require('../tools/cdp.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PLAN = [
  { name: 'pkg-1-playing.png', expr: "(function(){ Views.show('search'); Views.refreshPlayState(); return 'search rows='+document.querySelectorAll('#results .row').length; })()" },
  { name: 'pkg-2-queue.png', expr: "(function(){ Views.show('playlist'); return 'queue rows='+document.querySelectorAll('#plist .row').length; })()" },
  { name: 'pkg-3-np.png', expr: "(function(){ document.getElementById('audio').currentTime=40; Views.openNp(); return 'np lines='+document.querySelectorAll('#npLyricInner .np-line').length; })()" },
  { name: 'pkg-4-recent.png', expr: "(function(){ Views.closeNp(); document.querySelector('.nav-item[data-view=\"recent\"]').click(); return 'recent rows='+document.querySelectorAll('#recentList .row').length; })()" },
];
(async () => {
  const c = await cdp.connect();
  for (const s of PLAN) {
    let r; try { r = await cdp.evaluate(c.send, s.expr); } catch (e) { r = 'ERR ' + e.message; }
    await sleep(s.name.indexOf('np') >= 0 ? 1800 : 700);
    await cdp.shot(c.send, 'shots/' + s.name);
    console.log(s.name + '  <- ' + r);
  }
  c.close();
})();