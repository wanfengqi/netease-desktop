(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40 && typeof Views === 'undefined'; i++) await sleep(500);
  window.__ev = [];
  ['mousedown','mouseup','click'].forEach(function(t){ document.addEventListener(t, function(e){ window.__ev.push(t+':'+(e.target.id||e.target.tagName)); }, true); });
  if (!Views.isNpOpen()) Views.openNp();
  await sleep(1200);
  var b = document.getElementById('npClose').getBoundingClientRect();
  return JSON.stringify({
    bodyClass: document.body.className,
    titlebarDrag: getComputedStyle(document.querySelector('.titlebar')).webkitAppRegion,
    npDrag: getComputedStyle(document.getElementById('npOverlay')).webkitAppRegion,
    btn: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    sx: window.screenX, sy: window.screenY
  });
})()