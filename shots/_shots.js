/* 一次性截图驱动：按顺序摆好界面状态并各截一张 */
const cdp = require('../tools/cdp.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PRE = "(async function(){ document.getElementById('q').value='周杰伦'; document.getElementById('btnSearch').click(); for (var i=0;i<40 && !document.querySelector('#results .row');i++) await new Promise(function(r){setTimeout(r,500)}); return 'searched rows='+document.querySelectorAll('#results .row').length; })()";

const PLAN = [
  { name: 'after-1-search.png', expr: "(function(){ Views.show('search'); Views.refreshPlayState(); return 'search rows='+document.querySelectorAll('#results .row').length; })()" },
  { name: 'after-2-queue.png', expr: "(function(){ Views.show('playlist'); return 'queue rows='+document.querySelectorAll('#plist .row').length; })()" },
  { name: 'after-3-queue-menu.png', expr: "(function(){ var r=document.querySelectorAll('#plist .row')[2]; var b=r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:b.left+240,clientY:b.top+16})); return 'menu items='+document.querySelectorAll('.ctx-menu .ctx-item').length; })()" },
  { name: 'after-4-np.png', expr: "(function(){ UI.closeMenu(); document.getElementById('audio').currentTime=62; Views.openNp(); return 'np lines='+document.querySelectorAll('#npLyricInner .np-line').length; })()" },
  { name: 'after-5-theme.png', expr: "(function(){ Views.closeNp(); document.getElementById('btnTheme').click(); return 'theme cards='+document.querySelectorAll('#themeGrid .theme-card').length; })()" },
  { name: 'after-6-recent.png', expr: "(function(){ document.getElementById('btnThemeClose').click(); document.querySelector('.nav-item[data-view=\"recent\"]').click(); return 'recent rows='+document.querySelectorAll('#recentList .row').length; })()" },
  { name: 'after-7-favorites.png', expr: "(function(){ document.querySelector('.nav-item[data-view=\"favorites\"]').click(); return 'fav rows='+document.querySelectorAll('#favList .row').length; })()" },
];

(async () => {
  const c = await cdp.connect();
  console.log('pre: ' + await cdp.evaluate(c.send, PRE));
  for (const step of PLAN) {
    let r;
    try { r = await cdp.evaluate(c.send, step.expr); } catch (e) { r = 'ERR ' + e.message; }
    await sleep(step.name.indexOf('np') >= 0 ? 1800 : 700);
    await cdp.shot(c.send, 'shots/' + step.name);
    console.log(step.name + '  <- ' + r);
  }
  console.log('viewport: ' + await cdp.evaluate(c.send, "JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})"));
  c.close();
})();
