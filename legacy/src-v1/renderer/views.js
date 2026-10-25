/* ============================================================
   视图层
   ------------------------------------------------------------
   职责：导航切换 + 每个页面的渲染（搜索 / 歌单·专辑 / 歌手 /
        播放列表 / 收藏 / 最近播放 / 登录 / 歌词详情页）+ 歌词加载。
   播放动作一律交给 Player；这里只管"显示什么、点了做什么"。
   ============================================================ */
const Views = (() => {
  const el = (id) => document.getElementById(id);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

  // 歌词详情页状态
  let npOpen = false, npActiveIdx = -1;
  let lyricLines = [];

  // 当前视图的重绘入口（换歌后刷新高亮用）
  let currentListBox = null, currentListSongs = null, currentListOpts = null;

  // ==========================================================
  //                     导航
  // ==========================================================
  const VIEW_IDS = ['search', 'playlist', 'favorites', 'recent', 'login', 'artist', 'pl'];

  function show(view) {
    VIEW_IDS.forEach(function (v) {
      var node = el('view-' + v);
      if (node) node.classList.toggle('hidden', v !== view);
    });
    // 侧栏高亮：只有"主视图"才对应侧栏项
    $$('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.view === view);
    });
    // 侧栏子视图（歌手/歌单详情）没有对应导航项时，保持"搜索"高亮
    if (view === 'artist' || view === 'pl') {
      var s = document.querySelector('.nav-item[data-view="search"]');
      if (s) s.classList.add('active');
    }
    if (view === 'login') renderLoginView();
    if (view === 'favorites') renderFavorites();
    if (view === 'recent') renderRecent();
    if (view === 'playlist') renderQueueView();
  }

  function goSearch() { show('search'); }

  // ==========================================================
  //                     搜索
  // ==========================================================
  function updateSourceHint() {
    var h = el('srcHint');
    if (h) h.textContent = state.source === 'migu'
      ? '咪咕：免登录可直接播放，部分歌曲为会员专享'
      : (state.cookie ? '网易云：已登录' : '网易云：需登录才能听 VIP 歌曲');
    var q = el('q');
    if (q) q.placeholder = searchPlaceholder();
  }

  function searchPlaceholder() {
    if (state.tab === 'playlist') return '搜索歌单…';
    if (state.tab === 'artist') return '搜索歌手…';
    return state.source === 'migu' ? '搜索咪咕曲库（歌曲 / 歌手 / 专辑）…' : '搜索网易云曲库（歌曲 / 歌手 / 专辑）…';
  }

  /** 搜索结果工具条：N 首 + 播放全部 / 随机播放 */
  function showResultBar(songs) {
    var bar = el('resultBar');
    if (!bar) return;
    if (!songs || !songs.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    el('resultCount').textContent = '找到 ' + songs.length + ' 首';
    el('btnResPlayAll').onclick = function () { Player.playFromList(songs, 0); };
    el('btnResShuffle').onclick = function () {
      Player.setMode('shuffle');
      Player.playFromList(songs, Math.floor(Math.random() * songs.length));
    };
  }

  async function doSearch(opts) {
    opts = opts || {};
    var q = el('q').value.trim();
    if (!q) return;
    if (opts.record !== false) pushHistory(q);
    state.lastQuery = q;
    hideHistory();
    var seq = ++state.searchSeq;
    var box = el('results');
    el('resultBar').classList.add('hidden');
    UI.skeleton(box, 8);

    try {
      if (state.tab === 'artist') {
        state.artists = await doSearchArtists(q);
        if (seq !== state.searchSeq) return;
        renderArtistCards(box, state.artists);
        return;
      }
      if (state.tab === 'playlist') {
        state.playlists = await doSearchPlaylists(q);
        if (seq !== state.searchSeq) return;
        renderPlaylistCards(box, state.playlists);
        return;
      }
      var songs = await doSearchSongs(q);
      if (seq !== state.searchSeq) return;              // 丢弃过期响应（切分栏/切音源后的旧请求）
      if (!songs.length) { UI.empty(box, 'search', '没有找到结果', '换个关键词，或换个音源试试'); return; }
      showResultBar(songs);
      renderSongs(box, songs);
    } catch (e) {
      if (seq !== state.searchSeq) return;
      UI.empty(box, 'note', '搜索失败', esc(e.message));
    }
  }

  /** 搜歌 —— 按音源分发，统一返回归一化后的歌曲对象 */
  async function doSearchSongs(q) {
    if (state.source === 'migu') return await miguSearch(q, 40);
    var r = await api('/search', { keywords: q, limit: 40 });
    var songs = ((r && r.result && r.result.songs) || []).map(function (s) { return Norm.neteaseSong(s); });
    if (songs.length) await fillCovers(songs);
    return songs;
  }

  /** 网易云搜索接口只返回 picId，用 /song/detail 批量补封面与时长 */
  async function fillCovers(songs) {
    var ids = songs.filter(function (s) { return s.id != null; }).map(function (s) { return s.id; }).join(',');
    if (!ids) return;
    try {
      var d = await api('/song/detail', { ids: ids });
      var details = (d && d.songs) || [];
      if (!details.length) return;
      var map = new Map(details.map(function (x) { return [x.id, x]; }));
      songs.forEach(function (s) {
        var det = map.get(s.id);
        if (!det) return;
        var al = det.al || det.album || {};
        if (al.picUrl && !s.album.picUrl) s.album.picUrl = al.picUrl;
        if (al.name && !s.album.name) s.album.name = al.name;
        if (det.dt && !s.duration) s.duration = det.dt;
      });
    } catch (e) { console.warn('补封面失败', e); }
  }

  /** 搜索引擎用的歌单查询 */
  async function doSearchPlaylists(q) {
    if (state.source === 'migu') {
      var r = await window.dsh.migu.searchPlaylist(q, 1);
      if (!r || r.code !== '000000') throw new Error((r && r.info) || '咪咕歌单搜索失败');
      return ((r.data && r.data.items) || []).map(Norm.miguPlaylistItem).filter(function (p) { return p.id; });
    }
    var res = await api('/cloudsearch', { keywords: q, type: 1000, limit: 40 });
    return ((res && res.result && res.result.playlists) || []).map(Norm.neteasePlaylist);
  }

  async function doSearchArtists(q) {
    if (state.source === 'migu') {
      var r = await window.dsh.migu.searchSinger(q, 1);
      if (!r || r.code !== '000000') throw new Error((r && r.info) || '咪咕歌手搜索失败');
      return ((r.data && r.data.items) || []).map(Norm.miguArtist).filter(function (a) { return a.id; });
    }
    var res = await api('/cloudsearch', { keywords: q, type: 100, limit: 40 });
    return ((res && res.result && res.result.artists) || []).map(Norm.neteaseArtist);
  }

  // ==========================================================
  //              列表渲染（歌曲行统一由 UI.songRow 生成）
  // ==========================================================
  function songMenuItems(song, ctx) {
    ctx = ctx || {};
    var fav = isFavorite(song);
    var items = [
      { label: '播放', icon: 'play', onClick: function () { ctx.onPlay ? ctx.onPlay() : Player.playAt(ctx.index); } },
      { label: '下一首播放', icon: 'queue', onClick: function () { Player.playNext(song); } },
      { label: '加入播放列表', icon: 'plus', onClick: function () { Player.addToQueue(song); } },
      { sep: true },
      {
        label: fav ? '取消收藏' : '收藏', icon: fav ? 'heartOn' : 'heart',
        onClick: function () { toggleFavorite(song); },
      },
      {
        label: '查看评论', icon: 'comment',
        onClick: function () { Comments.openFor(song); },
      },
      { sep: true },
      {
        label: '复制歌名', icon: 'copy',
        onClick: function () {
          var txt = song.name + ' - ' + (song.artistText || '');
          navigator.clipboard.writeText(txt).then(function () { toast('已复制：' + txt); },
            function () { toast('复制失败'); });
        },
      },
    ];
    if (ctx.onRemove) {
      items.push({ sep: true });
      items.push({ label: '从列表移除', icon: 'trash', danger: true, onClick: ctx.onRemove });
    }
    return items;
  }

  function rowOpts(songs, i, ctx) {
    ctx = ctx || {};
    return {
      index: i,
      playing: Norm.key(songs[i]) === state.currentKey,
      // 默认给每行一个收藏键（搜索结果/歌单/歌手/最近播放都要能直接收藏），
      // 队列视图会额外传 'del' 来显示"从列表移除"。
      actions: ctx.actions || ['fav'],
      fav: isFavorite(songs[i]),
      showAlbum: ctx.showAlbum,
      onPick: function () { Player.playFromList(songs, i); },
      onFav: function () { toggleFavorite(songs[i]); },
      onDel: ctx.onDelete ? function () { ctx.onDelete(i); } : null,
      onMenu: function (e) {
        UI.menu(songMenuItems(songs[i], {
          index: i, onPlay: function () { Player.playFromList(songs, i); },
          onRemove: ctx.onDelete ? function () { ctx.onDelete(i); } : null,
        }), e.clientX, e.clientY);
      },
    };
  }

  /** 把某个列表渲染成歌曲行，并记下它是"当前视图"以便换歌时只刷高亮 */
  function renderSongs(box, songs, ctx) {
    ctx = ctx || {};
    UI.songList(box, songs, function (s, i) { return rowOpts(songs, i, ctx); });
    currentListBox = box; currentListSongs = songs; currentListOpts = ctx;
  }

  function renderArtistCards(box, list) {
    box.innerHTML = '';
    if (!list.length) { UI.empty(box, 'user', '没有找到歌手', '换个关键词试试'); return; }
    var frag = document.createDocumentFragment();
    list.forEach(function (ar) {
      var row = document.createElement('div');
      row.className = 'pl-row';
      row.innerHTML = '<img class="pl-row-cover round" loading="lazy" alt="">' +
        '<div class="pl-row-meta"><div class="pl-row-name"></div>' +
        '<div class="pl-row-sub"></div></div>' +
        '<span class="pl-row-count">' + (ar.source === 'migu' ? '咪咕' : '网易云') + '</span>' +
        '<span class="pl-row-arrow">' + Icons.svg('chevronR') + '</span>';
      var img = row.querySelector('img');
      if (ar.avatar) { img.src = ar.avatar; img.onerror = function () { UI.onImgError(img); }; }
      else UI.onImgError(img);
      row.querySelector('.pl-row-name').textContent = ar.name;
      row.querySelector('.pl-row-sub').textContent = '歌曲 ' + (ar.songNum || '-') + ' · 专辑 ' + (ar.albumNum || '-');
      row.onclick = function () { openArtist(ar); };
      frag.appendChild(row);
    });
    box.appendChild(frag);
  }

  function renderPlaylistCards(box, lists) {
    box.innerHTML = '';
    if (!lists.length) { UI.empty(box, 'list', '没有找到歌单', '换个关键词试试'); return; }
    var frag = document.createDocumentFragment();
    lists.forEach(function (pl) {
      var row = document.createElement('div');
      row.className = 'pl-row';
      row.innerHTML = '<img class="pl-row-cover" loading="lazy" alt="">' +
        '<div class="pl-row-meta"><div class="pl-row-name"></div><div class="pl-row-sub"></div></div>' +
        '<span class="pl-row-count"></span><span class="pl-row-arrow">' + Icons.svg('chevronR') + '</span>';
      var img = row.querySelector('img');
      if (pl.cover) { img.src = pl.cover; img.onerror = function () { UI.onImgError(img); }; }
      else UI.onImgError(img);
      row.querySelector('.pl-row-name').textContent = pl.name;
      row.querySelector('.pl-row-sub').textContent = pl.creator + (pl.playCount ? ' · 播放 ' + pl.playCount : '');
      row.querySelector('.pl-row-count').textContent = pl.count + ' 首';
      row.onclick = function () { openPlaylist(pl); };
      frag.appendChild(row);
    });
    box.appendChild(frag);
  }

  // ==========================================================
  //                     歌单 / 专辑详情
  // ==========================================================
  async function openPlaylist(pl) {
    show('pl');
    el('plCover').src = pl.cover || '';
    el('plName').textContent = pl.name;
    el('plInfo').textContent = (pl.creator ? pl.creator + ' · ' : '') + pl.count + ' 首' + (pl.playCount ? ' · 播放 ' + pl.playCount : '');
    var bg = el('plBg');
    bg.style.backgroundImage = pl.cover ? 'url("' + pl.cover + '")' : 'none';
    var box = el('plSongs');
    UI.skeleton(box, 8);

    try {
      var songs = await fetchPlaylistSongs(pl);
      if (!songs.length) {
        UI.empty(box, 'disc', pl._album ? '该专辑暂无可播放曲目' : '该歌单没有可取到的歌曲',
          pl._album ? '数字专辑需在咪咕客户端购买后才能取到曲目' : '');
        return;
      }
      currentListBox = box; currentListSongs = songs; currentListOpts = {};
      renderSongs(box, songs);
      var playAll = el('btnPlPlayAll'), shuffle = el('btnPlShuffle');
      playAll.onclick = function () { Player.playFromList(songs, 0); };
      shuffle.onclick = function () {
        Player.setMode('shuffle');
        Player.playFromList(songs, Math.floor(Math.random() * songs.length));
      };
      toast('已载入 ' + songs.length + ' 首');
    } catch (e) {
      UI.empty(box, 'note', '加载失败', esc(e.message));
    }
  }

  /** 拉取歌单/专辑曲目（_album=true 时走专辑接口） */
  async function fetchPlaylistSongs(pl) {
    if (pl._album) {
      if (pl.source === 'migu') {
        var ra = await window.dsh.migu.albumSong(pl.id, 1);
        if (!ra || ra.code !== '000000') throw new Error((ra && ra.info) || '咪咕专辑读取失败');
        var list = (ra.data && ra.data.songList) || [];   // 注意：专辑曲目在 data.songList，不是 contents
        return list.map(function (s) { return Norm.miguSong(s, { albumName: pl.name, fallbackCover: pl.cover }); })
          .filter(function (s) { return s.id; });
      }
      var rn = await api('/album', { id: pl.id });
      return ((rn && rn.songs) || []).map(function (t) { return Norm.neteaseSong(t); });
    }
    if (pl.source === 'migu') {
      var r = await window.dsh.migu.playlistSong(pl.id, 1, 100);
      if (!r || r.code !== '000000') throw new Error((r && r.info) || '咪咕歌单读取失败');
      var raw = (r.data && (r.data.items || r.data.songList || r.data.list)) || [];
      return raw.map(function (x) { return Norm.miguSong(x.song || x, { fallbackCover: pl.cover }); })
        .filter(function (s) { return s.id; });
    }
    var res = await api('/playlist/detail', { id: pl.id });
    return (((res || {}).playlist || {}).tracks || []).map(function (t) { return Norm.neteaseSong(t); });
  }

  function openAlbumAsPlaylist(al, ar) {
    return openPlaylist({
      source: ar.source, id: al.id, name: al.name, cover: al.cover,
      creator: ar.name, count: al.size || 0, playCount: '', _album: true,
    });
  }

  // ==========================================================
  //                     歌手主页
  // ==========================================================
  async function openArtist(ar) {
    state.artist = ar;
    state.arTab = 'album';
    show('artist');
    var img = el('arAvatar');
    if (ar.avatar) { img.src = ar.avatar; img.onerror = function () { UI.onImgError(img); }; }
    else UI.onImgError(img);
    el('arBg').style.backgroundImage = ar.avatar ? 'url("' + ar.avatar + '")' : 'none';
    el('arName').textContent = ar.name;
    el('arStats').innerHTML = '<span>歌曲 <b>' + (ar.songNum || '-') + '</b></span>' +
      '<span>专辑 <b>' + (ar.albumNum || '-') + '</b></span>';
    var brief = el('arBrief');
    brief.textContent = ar.brief || '暂无简介';
    brief.classList.toggle('expanded', false);
    brief.onclick = function () { brief.classList.toggle('expanded'); };
    $$('.artab').forEach(function (t) { t.classList.toggle('active', t.dataset.ar === state.arTab); });
    await loadArtistTab();
  }

  async function loadArtistTab() {
    var ar = state.artist;
    if (!ar) return;
    var box = el('arBody');
    UI.skeleton(box, 6);
    if (state.arTab === 'album') {
      try {
        var albums = await fetchArtistAlbums(ar);
        el('arAlbumCount').textContent = albums.length;
        if (!albums.length) { UI.empty(box, 'disc', '没有取到专辑'); return; }
        box.innerHTML = '';
        var grid = document.createElement('div');
        grid.className = 'album-grid';
        albums.forEach(function (al) {
          var card = document.createElement('div');
          card.className = 'album-card';
          card.innerHTML = '<div class="album-cover-wrap"><img class="album-cover" loading="lazy" alt="">' +
            '<button class="album-play" title="播放">' + Icons.svg('play') + '</button></div>' +
            '<div class="album-name"></div><div class="album-date"></div>';
          var img = card.querySelector('img');
          if (al.cover) { img.src = al.cover; img.onerror = function () { UI.onImgError(img); }; }
          else UI.onImgError(img);
          card.querySelector('.album-name').textContent = al.name;
          card.querySelector('.album-name').title = al.name;
          card.querySelector('.album-date').textContent = al.date + (al.size ? ' · ' + al.size + ' 首' : '');
          card.onclick = function () { openAlbumAsPlaylist(al, ar); };
          grid.appendChild(card);
        });
        box.appendChild(grid);
      } catch (e) { UI.empty(box, 'note', '专辑加载失败', esc(e.message)); }
      return;
    }
    try {
      var songs = await fetchArtistSongs(ar);
      if (!songs.length) { UI.empty(box, 'note', '没有取到歌曲'); return; }
      currentListBox = box; currentListSongs = songs; currentListOpts = {};
      renderSongs(box, songs);
      toast('已载入 ' + songs.length + ' 首');
    } catch (e) { UI.empty(box, 'note', '歌曲加载失败', esc(e.message)); }
  }

  async function fetchArtistAlbums(ar) {
    if (ar.source === 'migu') {
      var r = await window.dsh.migu.singerAlbum(ar.id, 1);
      if (!r || r.code !== '000000') throw new Error((r && r.info) || '咪咕专辑读取失败');
      return ((r.data && r.data.contents) || [])
        .filter(function (x) { return x.view === 'ZJ-Album-Item'; }).map(Norm.miguAlbum);
    }
    var res = await api('/artist/album', { id: ar.id, limit: 100 });
    return ((res && res.hotAlbums) || []).map(Norm.neteaseAlbum);
  }

  async function fetchArtistSongs(ar) {
    if (ar.source === 'migu') {
      var r = await window.dsh.migu.singerSong(ar.id, 1);
      if (!r || r.code !== '000000') throw new Error((r && r.info) || '咪咕歌手歌曲读取失败');
      var blocks = (r.data && r.data.contents) || [];
      var wrap = blocks.filter(function (x) { return x.view === 'ZJ-Singer-Song-Scroll'; })[0];
      var items = (wrap && wrap.contents) || [];
      return items.map(function (x) { return Norm.miguSingerSong(x, ar.name); }).filter(function (s) { return s.id; });
    }
    var res = await api('/artists', { id: ar.id });
    return ((res && res.hotSongs) || []).map(function (t) { return Norm.neteaseSong(t); });
  }

  // ==========================================================
  //                     收藏 / 最近播放 / 播放队列
  // ==========================================================
  function isFavorite(s) {
    if (!s) return false;
    var k = Norm.key(s);
    return state.favorites.some(function (x) { return Norm.key(x) === k; });
  }

  function toggleFavorite(s, ev) {
    if (ev) ev.stopPropagation();
    if (!s) return;
    var k = Norm.key(s);
    var i = state.favorites.findIndex(function (x) { return Norm.key(x) === k; });
    var on;
    if (i >= 0) { state.favorites.splice(i, 1); on = false; toast('已取消收藏'); }
    else { state.favorites.unshift(s); on = true; toast('已收藏：' + s.name); }
    window.dsh.config.set({ favorites: state.favorites });
    paintCounts();
    UI.refreshFav(el('favList'), k, on);
    UI.refreshFav(el('results'), k, on);
    UI.refreshFav(el('plist'), k, on);
    UI.refreshFav(el('recentList'), k, on);
    syncNpFav();
  }

  function paintCounts() {
    var f = el('favCount'); if (f) f.textContent = state.favorites.length;
    var sf = el('sideFavCount'); if (sf) sf.textContent = state.favorites.length;
    var q = el('plCount'); if (q) q.textContent = state.queue.length;
    var sq = el('sideQueueCount'); if (sq) sq.textContent = state.queue.length;
    var r = el('recentCount'); if (r) r.textContent = state.recent.length;
  }

  function renderFavorites() {
    var box = el('favList');
    paintCounts();
    if (!state.favorites.length) {
      UI.empty(box, 'heart', '还没有收藏的歌曲', '在歌曲列表点 ♡ 即可收藏');
      return;
    }
    el('btnFavPlayAll').onclick = function () { Player.playFromList(state.favorites, 0); };
    el('btnFavClearAll').onclick = function () {
      if (!state.favorites.length) return toast('收藏是空的');
      state.favorites = [];
      window.dsh.config.set({ favorites: [] });
      renderFavorites();
      toast('已清空收藏');
    };
    renderSongs(box, state.favorites);
  }

  function renderRecent() {
    var box = el('recentList');
    paintCounts();
    if (!state.recent.length) {
      UI.empty(box, 'clock', '还没有播放记录', '播放过的歌曲会自动出现在这里');
      return;
    }
    el('btnRecentPlayAll').onclick = function () { Player.playFromList(state.recent, 0); };
    el('btnRecentClear').onclick = function () {
      state.recent = [];
      window.dsh.config.set({ recent: [] });
      renderRecent();
      toast('已清空播放记录');
    };
    renderSongs(box, state.recent);
  }

  function renderQueueView() {
    var box = el('plist');
    if (!box) return;
    paintCounts();
    if (!state.queue.length) { UI.empty(box, 'list', '播放列表是空的', '搜索或打开歌单，点歌曲即可加入'); return; }
    el('btnClearQueue').onclick = function () {
      if (!state.queue.length) return toast('列表已经是空的');
      Player.clearQueue();
      toast('已清空播放列表');
    };
    el('btnShufflePlay').onclick = function () {
      if (!state.queue.length) return toast('列表为空');
      Player.setMode('shuffle');
      Player.playAt(Math.floor(Math.random() * state.queue.length));
      toast('随机播放');
    };
    renderSongs(box, state.queue, {
      actions: ['fav', 'del'],
      onDelete: function (i) { Player.removeAt(i); },
    });
    enableQueueDrag(box);
  }

  /** 队列拖拽排序 —— 拖完按"当前歌曲的 key"重算索引，避免索引错位 */
  function enableQueueDrag(box) {
    var dragIdx = -1;
    box.querySelectorAll('.row').forEach(function (row, i) {
      row.draggable = true;
      row.addEventListener('dragstart', function (e) {
        dragIdx = i;
        row.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); clearDropMarks(box); });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        clearDropMarks(box);
        row.classList.add(e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'drop-before' : 'drop-after');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        if (dragIdx < 0 || dragIdx === i) return;
        var after = row.classList.contains('drop-after');
        var item = state.queue.splice(dragIdx, 1)[0];
        var to = i > dragIdx ? i - 1 : i;
        state.queue.splice(after ? to + 1 : to, 0, item);
        state.index = state.queue.findIndex(function (s) { return Norm.key(s) === state.currentKey; });
        Player.persistQueue();
        renderQueueView();
        refreshPlayState();
        toast('已调整播放顺序');
      });
    });
  }
  function clearDropMarks(box) {
    box.querySelectorAll('.row').forEach(function (r) { r.classList.remove('drop-before', 'drop-after'); });
  }

  // ==========================================================
  //                     搜索历史
  // ==========================================================
  const MAX_HISTORY = 12;
  function persistHistory() { window.dsh.config.set({ searchHistory: state.history }); }

  function pushHistory(word) {
    var w = String(word || '').trim();
    if (!w) return;
    state.history = [w].concat(state.history.filter(function (x) { return x.toLowerCase() !== w.toLowerCase(); })).slice(0, MAX_HISTORY);
    persistHistory();
    renderHistory();
  }
  function removeHistory(word, ev) {
    if (ev) ev.stopPropagation();
    state.history = state.history.filter(function (x) { return x !== word; });
    persistHistory(); renderHistory();
  }
  function clearHistory(ev) {
    if (ev) ev.stopPropagation();
    state.history = []; persistHistory(); renderHistory(); hideHistory();
    toast('已清空搜索历史');
  }

  function renderHistory() {
    var box = el('qHistory');
    if (!box) return;
    if (!state.history.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = '<div class="qh-head"><span>搜索历史</span>' +
      '<button class="qh-clear" id="qhClear">清空</button></div>';
    state.history.forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'qh-item';
      d.innerHTML = '<span class="qh-icon">' + Icons.svg('clock') + '</span><span class="qh-text"></span>' +
        '<button class="qh-del" title="删除">' + Icons.svg('close') + '</button>';
      d.querySelector('.qh-text').textContent = w;       // textContent 防 XSS
      d.onclick = function () { el('q').value = w; hideHistory(); doSearch({ record: true }); };
      d.querySelector('.qh-del').onclick = function (e) { removeHistory(w, e); };
      box.appendChild(d);
    });
    box.querySelector('#qhClear').onclick = clearHistory;
  }
  function showHistory() {
    if (!state.history.length) return;
    renderHistory();
    el('qHistory').classList.remove('hidden');
  }
  function hideHistory() { var b = el('qHistory'); if (b) b.classList.add('hidden'); }

  // ==========================================================
  //                     登录
  // ==========================================================
  let qrTimer = null;
  async function loadQr() {
    clearInterval(qrTimer);
    el('qrMask').textContent = '加载中…'; el('qrMask').classList.remove('hidden');
    var k = await api('/login/qr/key', { timestamp: Date.now() });
    var key = k && k.data && k.data.unikey;
    if (!key) { el('qrMask').textContent = '获取二维码失败'; return; }
    var c = await api('/login/qr/create', { key: key, qrimg: true, timestamp: Date.now() });
    var img = c && c.data && c.data.qrimg;
    if (!img) { el('qrMask').textContent = '生成二维码失败'; return; }
    el('qrImg').src = img;
    el('qrMask').classList.add('hidden');
    el('loginTip').textContent = '用网易云音乐 App 扫码登录（二维码 2 分钟内有效）';
    qrTimer = setInterval(async function () {
      var r = await api('/login/qr/check', { key: key, timestamp: Date.now() });
      var code = r && r.code;
      if (code === 800) { el('loginTip').textContent = '二维码已过期，请刷新'; clearInterval(qrTimer); }
      else if (code === 801) el('loginTip').textContent = '等待扫码…';
      else if (code === 802) el('loginTip').textContent = '已扫码，请在手机上确认';
      else if (code === 803) {
        clearInterval(qrTimer);
        el('loginTip').textContent = '登录成功！';
        if (r.cookie) { state.cookie = r.cookie; window.dsh.config.set({ cookie: r.cookie }); }
        toast('登录成功，登录状态已记住');
        await refreshLoginState();
        renderLoginView();
        updateSourceHint();
      }
    }, 2000);
  }

  /** 判断登录态；网络异常时绝不清 cookie */
  async function refreshLoginState() {
    if (!state.cookie) { el('loginBadge').textContent = '未登录'; state.account = null; return false; }
    var r;
    try { r = await api('/login/status', { timestamp: Date.now() }); }
    catch (e) {
      console.warn('登录状态查询失败（保留登录态）', e);
      el('loginBadge').textContent = '登录态待确认';
      return true;
    }
    var p = (r && ((r.data && r.data.profile) || r.profile));
    if (p) { state.account = p; el('loginBadge').textContent = p.nickname || '已登录'; return true; }
    if (await tryRefreshToken()) return true;
    if (r && (r.code === 200 || r.code === 301 || (r.data && r.data.code === 200))) {
      state.cookie = ''; state.account = null;
      window.dsh.config.set({ cookie: '' });
      el('loginBadge').textContent = '未登录';
      return false;
    }
    return true;   // 返回体异常 → 保守保留
  }

  async function tryRefreshToken() {
    try {
      var r = await api('/login/token/refresh', { timestamp: Date.now() });
      if (r && r.code === 200 && r.cookie) {
        state.cookie = r.cookie;
        window.dsh.config.set({ cookie: r.cookie });
        var st = await api('/login/status', { timestamp: Date.now() });
        var p = st && ((st.data && st.data.profile) || st.profile);
        if (p) { state.account = p; el('loginBadge').textContent = p.nickname || '已登录'; return true; }
      }
    } catch (e) { /* 续期失败不致命 */ }
    return false;
  }

  async function renderLoginView() {
    var ok = await refreshLoginState();
    var acc = el('accountSection'), qr = el('qrSection');
    if (ok && state.account) {
      acc.classList.remove('hidden'); qr.classList.add('hidden');
      var p = state.account;
      if (p.avatarUrl) el('accAvatar').src = p.avatarUrl;
      el('accNick').textContent = p.nickname || '已登录';
      el('accSub').textContent = '用户 ID ' + (p.userId || '-') + (p.vipType ? ' · VIP' : '') + ' · 登录状态已保存';
      return;
    }
    acc.classList.add('hidden'); qr.classList.remove('hidden');
    loadQr();
  }

  function logout() {
    state.cookie = ''; state.account = null;
    window.dsh.config.set({ cookie: '' });
    el('loginBadge').textContent = '未登录';
    toast('已退出登录');
    el('accountSection').classList.add('hidden');
    el('qrSection').classList.remove('hidden');
    loadQr();
  }

  // ==========================================================
  //                     歌词
  // ==========================================================
  async function loadLyric(song) {
    var raw = '';
    try {
      if (song && song.source === 'migu') {
        raw = await MiguProvider.miguLyric(song.contentId);
      } else if (song && song.id != null) {
        var r = await api('/lyric', { id: song.id });
        raw = (r && r.lrc && r.lrc.lyric) || '';
      }
    } catch (e) { console.warn('歌词获取失败', e); }
    lyricLines = parseLrc(raw);
    pushLyricToWindow();
    if (npOpen) { renderNpLyric(); updateNpLyric(Player.audio.currentTime); }
  }

  function parseLrc(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (line) {
      var m = Array.from(line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g));
      if (!m.length) return;
      var content = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!content) return;
      m.forEach(function (t) { out.push({ time: (+t[1]) * 60 + parseFloat(t[2]), text: content }); });
    });
    return out.sort(function (a, b) { return a.time - b.time; });
  }

  /** 把歌词推给桌面歌词窗；偏移在这里就折算好，两个窗口才一致 */
  function pushLyricToWindow() {
    var lines = state.lyricOffset
      ? lyricLines.map(function (l) { return { time: l.time - state.lyricOffset, text: l.text }; })
      : lyricLines;
    window.dsh.lyric.push({ lines: lines, title: el('nowTitle').textContent, idle: lines.length === 0 });
  }

  function setLyricOffset(delta, absolute) {
    state.lyricOffset = absolute != null ? absolute : Math.round((state.lyricOffset + delta) * 10) / 10;
    if (state.lyricOffset > 10) state.lyricOffset = 10;
    if (state.lyricOffset < -10) state.lyricOffset = -10;
    window.dsh.config.set({ lyricOffset: state.lyricOffset });
    paintLyricOffset();
    pushLyricToWindow();
    npActiveIdx = -1;
    updateNpLyric(Player.audio.currentTime);
  }

  function paintLyricOffset() {
    var lab = el('npOffsetLabel');
    if (lab) lab.textContent = (state.lyricOffset > 0 ? '+' : '') + state.lyricOffset.toFixed(1) + 's';
  }

  function currentLyricIndex(t) {
    if (!lyricLines.length) return -1;
    var tt = t - state.lyricOffset;
    var lo = 0, hi = lyricLines.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lyricLines[mid].time <= tt) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx;
  }

  function openNp() {
    npOpen = true;
    el('npOverlay').classList.remove('hidden');
    syncOverlayClass();
    syncNp();
    renderNpLyric();
    var idx = currentLyricIndex(Player.audio.currentTime);
    npActiveIdx = idx;
    paintNpActive(idx);
    requestAnimationFrame(function () { scrollNpToActive(false); });
  }
  function closeNp() {
    npOpen = false;
    el('npOverlay').classList.add('hidden');
    syncOverlayClass();
  }

  /**
   * 全屏浮层盖住标题栏时，必须把标题栏那条 -webkit-app-region:drag 关掉。
   * Electron 只对「拖拽元素的子孙」里的 no-drag 做减法，浮层不是 .titlebar 的子孙，
   * 所以光给浮层加 no-drag 没用 —— 落在顶部 38px 里的按钮照样收不到鼠标事件。
   */
  function syncOverlayClass() {
    var cm = el('cmOverlay');
    var eq = el('eqOverlay');
    var open = !el('npOverlay').classList.contains('hidden') ||
               !el('themeOverlay').classList.contains('hidden') ||
               (!!cm && !cm.classList.contains('hidden')) ||
               (!!eq && !eq.classList.contains('hidden'));
    document.body.classList.toggle('overlay-open', open);
  }
  function toggleNp() { npOpen ? closeNp() : openNp(); }

  /** 把播放器状态同步到歌词页 */
  function syncNp() {
    var s = state.queue[state.index];
    var cover = el('cover');
    el('npCover').src = cover.src || '';
    el('npBg').style.backgroundImage = cover.src ? 'url("' + cover.src + '")' : 'none';
    el('npTitle').textContent = el('nowTitle').textContent;
    el('npArtist').textContent = el('nowArtist').textContent;
    el('npAlbum').textContent = (s && s.album && s.album.name) || '';
    el('npTopTitle').textContent = el('nowTitle').textContent;
    syncNpPlayState();
    syncNpFav();
  }

  function syncNpPlayState() {
    var a = Player.audio;
    Icons.set(el('npPlay'), a.paused ? 'play' : 'pause');
    Icons.set(el('btnPlay'), a.paused ? 'play' : 'pause');
  }

  function syncNpFav() {
    var s = state.queue[state.index];
    var b = el('npFav');
    if (!b) return;
    var on = isFavorite(s);
    b.classList.toggle('on', on);
    b.title = on ? '取消收藏' : '收藏';
    Icons.set(b, on ? 'heartOn' : 'heart');
  }

  function renderNpLyric() {
    var box = el('npLyricInner');
    if (!lyricLines.length) {
      box.innerHTML = '<div class="empty-state small"><div class="es-ico">' + Icons.svg('text') + '</div>' +
        '<div class="es-title">暂无歌词</div><div class="es-sub">纯音乐或接口未返回歌词</div></div>';
      npActiveIdx = -1;
      return;
    }
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    lyricLines.forEach(function (ln, i) {
      var d = document.createElement('div');
      d.className = 'np-line';
      d.textContent = ln.text;
      d.dataset.idx = i;
      d.onclick = function () {
        Player.audio.currentTime = Math.max(0, ln.time + state.lyricOffset);
        if (Player.audio.paused) Player.audio.play().catch(function () {});
      };
      frag.appendChild(d);
    });
    box.appendChild(frag);
    npActiveIdx = -1;
  }

  function paintNpActive(idx) {
    var nodes = el('npLyricInner').querySelectorAll('.np-line');
    Array.prototype.forEach.call(nodes, function (n, i) {
      n.classList.toggle('active', i === idx);
      n.classList.toggle('near', Math.abs(i - idx) === 1);
    });
  }

  function updateNpLyric(t) {
    if (!npOpen) return;
    var idx = currentLyricIndex(t);
    if (idx === npActiveIdx) return;
    npActiveIdx = idx;
    paintNpActive(idx);
    scrollNpToActive(true);
  }

  function scrollNpToActive(smooth) {
    var box = el('npLyricInner'), scroller = el('npLyricScroll');
    if (!box || !scroller || npActiveIdx < 0) return;
    var node = box.querySelectorAll('.np-line')[npActiveIdx];
    if (!node) return;
    var target = node.offsetTop - scroller.clientHeight / 2 + node.offsetHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  function paintNpProgress(p, cur, dur) {
    if (!npOpen) return;
    var f = el('npBarFill'), d = el('npBarDot');
    if (f) f.style.width = p + '%';
    if (d) d.style.left = p + '%';
    var c1 = el('npCur'), c2 = el('npDur');
    if (c1) c1.textContent = fmtTime(cur);
    if (c2) c2.textContent = fmtTime(dur);
  }

  // ==========================================================
  //                  换歌 / 状态刷新
  // ==========================================================
  /** Player 换歌后调用：刷新歌词 + 高亮 + 歌词页 */
  function onSongChange(song) {
    loadLyric(song);
    syncNp();
    refreshPlayState();
    // 评论浮层跟着换歌：要么刷新成新歌的评论，要么自动关闭，绝不残留上一首
    Comments.onSongChange(song);
  }

  /** 只刷"哪一行在播"，不重建列表 */
  function refreshPlayState() {
    ['results', 'plSongs', 'favList', 'recentList', 'plist', 'arBody'].forEach(function (id) {
      var box = el(id);
      if (box) UI.refreshPlaying(box, state.currentKey);
    });
    paintCounts();
    syncNp();
  }

  // ==========================================================
  //                     事件绑定
  // ==========================================================
  let searchTimer = null;

  function init() {
    // ---- 侧边导航 ----
    $$('.nav-item').forEach(function (n) {
      n.onclick = function () { show(n.dataset.view); };
    });

    // ---- 搜索栏 ----
    el('btnSearch').onclick = function () { doSearch({ record: true }); };
    el('q').addEventListener('focus', function () {
      if (!el('q').value.trim()) showHistory();
    });
    // 输入即搜（防抖 500ms）：主流播放器的搜索体验，不必回车
    el('q').addEventListener('input', function () {
      var v = el('q').value.trim();
      clearTimeout(searchTimer);
      if (!v) { showHistory(); return; }
      hideHistory();
      searchTimer = setTimeout(function () { doSearch({ record: false }); }, 500);
    });
    el('q').onkeydown = function (e) {
      if (e.key === 'Enter') { el('q').blur(); clearTimeout(searchTimer); doSearch({ record: true }); return; }
      if (e.key === 'Escape') { hideHistory(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!state.history.length) return;
        e.preventDefault();
        var cur = el('q').value.trim();
        var idx = state.history.indexOf(cur);
        idx = e.key === 'ArrowDown' ? (idx + 1) % state.history.length
          : (idx <= 0 ? state.history.length - 1 : idx - 1);
        el('q').value = state.history[idx];
      }
    };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.q-wrap')) hideHistory();
    });

    // ---- 结果分栏 ----
    $$('.rtab').forEach(function (t) {
      t.onclick = function () {
        $$('.rtab').forEach(function (x) { x.classList.toggle('active', x === t); });
        state.tab = t.dataset.tab;
        el('q').placeholder = searchPlaceholder();
        if (state.lastQuery) doSearch({ record: false });
        else UI.empty(el('results'), 'search', '输入关键词开始搜索', '支持歌曲 / 歌单 / 歌手');
      };
    });

    // ---- 音源切换：只影响搜索，不打断正在播放的歌 ----
    $$('.src-tab').forEach(function (tab) {
      tab.onclick = function () {
        $$('.src-tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        state.source = tab.dataset.src;
        window.dsh.config.set({ source: state.source });
        updateSourceHint();
        if (state.lastQuery) doSearch({ record: false });
        else UI.empty(el('results'), 'search', '已切换到' + (state.source === 'migu' ? '咪咕' : '网易云'), '输入关键词开始搜索');
        el('q').focus();
      };
    });

    // ---- 返回 / 分栏 ----
    el('btnPlBack').onclick = goSearch;
    el('btnArBack').onclick = goSearch;
    $$('.artab').forEach(function (t) {
      t.onclick = function () {
        $$('.artab').forEach(function (x) { x.classList.toggle('active', x === t); });
        state.arTab = t.dataset.ar;
        loadArtistTab();
      };
    });

    // ---- 登录 ----
    el('btnLogout').onclick = logout;
    el('btnQrRefresh').onclick = loadQr;

    // ---- 歌曲评论浮层 ----
    Comments.init();

    // ---- 歌词详情页 ----
    el('nowBox').onclick = toggleNp;
    el('npClose').onclick = closeNp;
    el('npDesktopLyric').onclick = function () { el('btnLyric').click(); };
    el('npFav').onclick = function () { toggleFavorite(state.queue[state.index]); };
    el('npOffsetMinus').onclick = function () { setLyricOffset(-0.5); };
    el('npOffsetPlus').onclick = function () { setLyricOffset(0.5); };
    el('npOffsetReset').onclick = function () { setLyricOffset(0, 0); toast('歌词偏移已重置'); };
  }

  return {
    init: init, show: show, goSearch: goSearch,
    doSearch: doSearch, updateSourceHint: updateSourceHint, searchPlaceholder: searchPlaceholder,
    showHistory: showHistory, hideHistory: hideHistory, renderHistory: renderHistory,
    openPlaylist: openPlaylist, openArtist: openArtist, loadArtistTab: loadArtistTab,
    renderFavorites: renderFavorites, renderRecent: renderRecent, renderQueueView: renderQueueView,
    renderLoginView: renderLoginView, logout: logout,
    isFavorite: isFavorite, toggleFavorite: toggleFavorite, paintCounts: paintCounts,
    onSongChange: onSongChange, refreshPlayState: refreshPlayState,
    openNp: openNp, closeNp: closeNp, toggleNp: toggleNp, syncNp: syncNp,
    syncOverlayClass: syncOverlayClass,
    updateNpLyric: updateNpLyric, paintNpProgress: paintNpProgress,
    setLyricOffset: setLyricOffset, paintLyricOffset: paintLyricOffset,
    syncNpPlayState: syncNpPlayState,
    isNpOpen: function () { return npOpen; },
  };
})();
