const cdp = require('../tools/cdp.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const P = process.env.CDP_PORT || '9333';
process.env.CDP_PORT = P;

(async () => {
  const c = await cdp.connect();
  const ev = (e) => cdp.evaluate(c.send, e);
  await ev("(function(){ if (!Views.isNpOpen()) Views.openNp(); return 1; })()");
  await sleep(500);
  const box = JSON.parse(await ev("(function(){ var b=document.getElementById('npClose').getBoundingClientRect(); return JSON.stringify({x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}); })()"));
  const cx = box.x + Math.round(box.w / 2), cy = box.y + Math.round(box.h / 2);
  console.log('npClose box = ' + JSON.stringify(box) + '  center=(' + cx + ',' + cy + ')');
  console.log('hit test    = ' + await ev("(function(){ var e=document.elementFromPoint(" + cx + "," + cy + "); return e ? e.tagName+'#'+e.id+'.'+(e.className||'') : 'null'; })()"));
  console.log('ancestors   = ' + await ev("(function(){ var e=document.elementFromPoint(" + cx + "," + cy + "); var out=[]; while(e && out.length<6){ out.push(e.tagName+'#'+(e.id||'')+(e.className?'.'+String(e.className).replace(/ /g,'.'):'')); e=e.parentElement; } return out.join('  <  '); })()"));
  console.log('onclick set = ' + await ev("(function(){ return typeof document.getElementById('npClose').onclick; })()"));

  // 真正的鼠标事件（走命中测试，和用户点击等价）
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
  await sleep(500);
  console.log('real click  → npOpen = ' + await ev("(function(){ return Views.isNpOpen(); })()"));
  console.log('            → hidden = ' + await ev("(function(){ return document.getElementById('npOverlay').classList.contains('hidden'); })()"));

  // 对照：程序化 click()
  await ev("(function(){ if (!Views.isNpOpen()) Views.openNp(); document.getElementById('npClose').click(); return 1; })()");
  await sleep(400);
  console.log('js click    → npOpen = ' + await ev("(function(){ return Views.isNpOpen(); })()"));

  // 对照：顶栏另一个按钮（桌面歌词）是否也点不动
  await ev("(function(){ if (!Views.isNpOpen()) Views.openNp(); return 1; })()");
  const b2 = JSON.parse(await ev("(function(){ var b=document.getElementById('npDesktopLyric').getBoundingClientRect(); return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}); })()"));
  console.log('desktopLyric hit = ' + await ev("(function(){ var e=document.elementFromPoint(" + b2.x + "," + b2.y + "); return e ? e.tagName+'#'+e.id : 'null'; })()"));
  c.close();
})();
