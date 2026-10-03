/* ============================================================
   通用 UI 组件层
   ------------------------------------------------------------
   把三个列表视图（搜索结果 / 播放列表 / 收藏 / 最近播放）里
   重复了三遍的"歌曲行"代码收敛成一个函数；顺带提供骨架屏、
   右键菜单、空状态、可拖动进度条这些复用组件。
   ============================================================ */
const UI = (() => {

  /** 图片加载失败 → 换成音符占位，而不是留一块空白/破图 */
  function onImgError(img) {
    img.onerror = null;
    img.classList.add('img-fallback');
    img.removeAttribute('src');
  }

  /** 骨架屏（替换"加载中…"白屏） */
  function skeleton(box, rows) {
    var one = '<div class="sk-row"><div class="sk sk-cover"></div>' +
      '<div class="sk-lines"><div class="sk sk-line w60"></div><div class="sk sk-line w35"></div></div>' +
      '<div class="sk sk-dur"></div></div>';
    var html = '';
    for (var i = 0; i < (rows || 8); i++) html += one;
    box.innerHTML = '<div class="sk-list">' + html + '</div>';
  }

  /** 空状态 */
  function empty(box, icon, title, sub) {
    box.innerHTML = '<div class="empty-state"><div class="es-ico">' + Icons.svg(icon) + '</div>' +
      '<div class="es-title">' + title + '</div>' +
      (sub ? '<div class="es-sub">' + sub + '</div>' : '') + '</div>';
  }

  /**
   * 构造一行歌曲。所有列表视图共用，保证行为一致。
   * @param song  统一歌曲对象（见 normalize.js）
   * @param opts  { index, playing, showAlbum, actions:['fav','del'], fav, onPick, onFav, onDel, onMenu }
   */
  function songRow(song, opts) {
    opts = opts || {};
    var actions = opts.actions || [];
    var row = document.createElement('div');
    var playing = !!opts.playing;
    var fav = !!opts.fav;
    row.className = 'row' + (playing ? ' playing' : '');
    row.dataset.key = Norm.key(song);

    row.innerHTML =
      '<div class="row-lead">' +
        '<span class="row-idx" data-num="' + (opts.index != null ? opts.index + 1 : '') + '">' +
          (playing ? '<span class="eq"><i></i><i></i><i></i></span>' : (opts.index != null ? opts.index + 1 : '')) +
        '</span>' +
        '<button class="row-play" title="播放">' + Icons.svg('play') + '</button>' +
      '</div>' +
      '<div class="row-cover-wrap"><img class="row-cover" loading="lazy" alt=""></div>' +
      '<div class="row-meta">' +
        '<div class="row-name"><span class="row-name-text"></span>' +
          (song.vip ? '<span class="badge-vip">VIP</span>' : '') +
          (song.source === 'migu' ? '<span class="badge-src">咪咕</span>' : '') +
        '</div>' +
        '<div class="row-artist"><span class="row-artist-text"></span></div>' +
      '</div>' +
      '<span class="row-dur">' + fmtTime((song.duration || 0) / 1000) + '</span>' +
      (actions.indexOf('fav') >= 0
        ? '<button class="row-fav' + (fav ? ' on' : '') + '" title="' + (fav ? '取消收藏' : '收藏') + '">' +
          Icons.svg(fav ? 'heartOn' : 'heart') + '</button>'
        : '') +
      (actions.indexOf('del') >= 0
        ? '<button class="row-del" title="从列表移除">' + Icons.svg('close') + '</button>'
        : '') +
      '<button class="row-more" title="更多操作">' + Icons.svg('more') + '</button>';

    // 文本一律 textContent 写入：歌名里的 < > 不会变成标签
    var cover = row.querySelector('.row-cover');
    var pic = (song.album && song.album.picUrl) || '';
    if (pic) { cover.src = pic; cover.onerror = function () { onImgError(cover); }; }
    else onImgError(cover);
    row.querySelector('.row-name-text').textContent = song.name || '';
    var sub = song.artistText || '';
    if (opts.showAlbum !== false && song.album && song.album.name) sub += ' — ' + song.album.name;
    row.querySelector('.row-artist-text').textContent = sub;

    row.onclick = function (e) {
      if (e.target.closest('.row-fav') || e.target.closest('.row-del') || e.target.closest('.row-more')) return;
      if (opts.onPick) opts.onPick();
    };
    row.oncontextmenu = function (e) { e.preventDefault(); if (opts.onMenu) opts.onMenu(e); };
    var favBtn = row.querySelector('.row-fav');
    if (favBtn) favBtn.onclick = function (e) { e.stopPropagation(); if (opts.onFav) opts.onFav(e); };
    var delBtn = row.querySelector('.row-del');
    if (delBtn) delBtn.onclick = function (e) { e.stopPropagation(); if (opts.onDel) opts.onDel(e); };
    row.querySelector('.row-more').onclick = function (e) { e.stopPropagation(); if (opts.onMenu) opts.onMenu(e); };
    return row;
  }

  /** 批量渲染歌曲列表（DocumentFragment 一次性插入，长列表不抖） */
  function songList(box, songs, makeOpts) {
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    songs.forEach(function (s, i) { frag.appendChild(songRow(s, makeOpts(s, i))); });
    box.appendChild(frag);
  }

  /** 只改"哪一行在播"的高亮，不整表重建 */
  function refreshPlaying(box, currentKey) {
    box.querySelectorAll('.row').forEach(function (row) {
      var on = row.dataset.key === currentKey;
      row.classList.toggle('playing', on);
      var idx = row.querySelector('.row-idx');
      if (idx) idx.innerHTML = on ? '<span class="eq"><i></i><i></i><i></i></span>' : (idx.dataset.num || '');
    });
  }

  /** 同步某一行的收藏状态（不整表重建） */
  function refreshFav(box, key, on) {
    box.querySelectorAll('.row').forEach(function (row) {
      if (row.dataset.key !== key) return;
      var b = row.querySelector('.row-fav');
      if (!b) return;
      b.classList.toggle('on', on);
      b.title = on ? '取消收藏' : '收藏';
      b.innerHTML = Icons.svg(on ? 'heartOn' : 'heart');
    });
  }

  // ---------------------------------------------------------- 右键/更多菜单
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  /** 弹出菜单。items: [{ label, icon, onClick, danger, checked } | { sep:true }] */
  function menu(items, x, y) {
    closeMenu();
    var el = document.createElement('div');
    el.className = 'ctx-menu';
    items.forEach(function (it) {
      if (it.sep) {
        var sp = document.createElement('div');
        sp.className = 'ctx-sep';
        el.appendChild(sp);
        return;
      }
      var b = document.createElement('button');
      b.className = 'ctx-item' + (it.danger ? ' danger' : '');
      b.innerHTML = '<span class="ctx-ico">' + Icons.svg(it.icon || 'note') + '</span>' +
        '<span class="ctx-label"></span>' +
        (it.checked ? '<span class="ctx-check">' + Icons.svg('check') + '</span>' : '');
      b.querySelector('.ctx-label').textContent = it.label;
      b.onclick = function (e) { e.stopPropagation(); closeMenu(); if (it.onClick) it.onClick(); };
      el.appendChild(b);
    });
    document.body.appendChild(el);
    var r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    menuEl = el;
    return el;
  }
  document.addEventListener('click', closeMenu);
  window.addEventListener('blur', closeMenu);

  // ---------------------------------------------------------- 可拖动的进度条
  /** 点击跳转 + 按住拖动 + 指针捕获。onSeek(ratio 0..1) 由调用方决定怎么 seek */
  function draggableBar(bar, onSeek) {
    var dragging = false;
    var ratioAt = function (clientX) {
      var r = bar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    };
    bar.addEventListener('pointerdown', function (e) {
      dragging = true;
      bar.classList.add('dragging');
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      onSeek(ratioAt(e.clientX));
    });
    bar.addEventListener('pointermove', function (e) { if (dragging) onSeek(ratioAt(e.clientX)); });
    var end = function (e) {
      if (!dragging) return;
      dragging = false;
      bar.classList.remove('dragging');
      try { if (e.pointerId != null) bar.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    return { isDragging: function () { return dragging; } };
  }

  return { songRow: songRow, songList: songList, refreshPlaying: refreshPlaying,
    refreshFav: refreshFav, skeleton: skeleton, empty: empty, menu: menu,
    closeMenu: closeMenu, draggableBar: draggableBar, onImgError: onImgError };
})();
