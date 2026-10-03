(function () {
  window.__ev2 = [];
  document.getElementById('npOverlay').style.animation = 'none';
  var b = document.getElementById('npClose').getBoundingClientRect();
  return JSON.stringify({ btnCenter: [Math.round(b.x + b.width/2), Math.round(b.y + b.height/2)], sx: window.screenX, sy: window.screenY, npOpen: Views.isNpOpen() });
})()