/* ============================================================
   渲染层逻辑：播放器 + 皮肤系统
   ============================================================ */
const $ = (s) => document.querySelector(s);
const audio = $('#audio');

let state = {
  queue: [],        // 播放列表
  index: -1,        // 当前索引
  source: 'netease', // 当前音源：netease | migu
  playMode: 'list',  // 播放模式：list=列表循环 | one=单曲循环 | shuffle=随机 | order=顺序播放
  shuffleHistory: [],// 随机播放已播过的索引，避免短时间内重复
  tab: 'song',       // 搜索分栏：song | playlist
  playlists: [],     // 当前搜索到的歌单
  artists: [],       // 当前搜索到的歌手
  artist: null,      // 当前打开的歌手
  arTab: 'album',    // 歌手页分栏：album | song
  favorites: [],     // 收藏的歌曲（含完整歌曲对象，便于直接播放）
  history: [],       // 搜索历史词（最多 MAX_HISTORY 条，去重、最新在前）
  account: null,     // 网易云账号信息（登录后）
  lastQuery: '',     // 上次搜索词（切换分栏时复用）
  cookie: '',
  user: null,
  themes: { current: 'default', custom: {} },
  allThemes: {},    // id -> theme 对象
  muted: false, prevVol: 70,
};

// ---------------------------------------------------------- 工具
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2000);
}
async function api(path, params = {}) {
  const r = await window.dsh.api(path, params, state.cookie);
  return r.body;
}

// ==========================================================
//                     皮肤系统
// ==========================================================

/** 重建 allThemes 索引 */
function indexThemes() {
  state.allThemes = {};
  for (const [id, t] of Object.entries(BUILTIN_THEMES)) {
    state.allThemes[id] = { ...t, id };
  }
  for (const [id, t] of Object.entries(state.themes.custom || {})) {
    state.allThemes[id] = { ...t, id, builtin: false };
  }
}

/** 应用皮肤（同时同步给歌词窗口和标题栏亮暗） */
function useTheme(id, persist = true) {
  const theme = state.allThemes[id];
  if (!theme) { toast('找不到皮肤：' + id); return; }
  applyTheme(theme);
  if (persist) {
    state.themes.current = id;
    window.dsh.theme.save(state.themes);
  }
  window.dsh.theme.pushToLyric(theme);
  renderThemeGrids();
}

/** 保存一套自定义皮肤并立即应用 */
function saveCustomTheme(theme) {
  state.themes.custom = state.themes.custom || {};
  state.themes.custom[theme.id] = { name: theme.name, vars: theme.vars };
  indexThemes();
  useTheme(theme.id);
}

function deleteCustomTheme(id, ev) {
  ev.stopPropagation();
  delete state.themes.custom[id];
  window.dsh.theme.save(state.themes);
  indexThemes();
  if (state.themes.current === id) useTheme('default');
  else renderThemeGrids();
  toast('已删除皮肤');
}

/** 用一组 vars 渲染一张预览卡 */
function themeCard(theme, isCustom) {
  const v = theme.vars;
  const card = document.createElement('div');
  card.className = 'theme-card' + (state.themes.current === theme.id ? ' active' : '');
  card.innerHTML = `
    ${isCustom ? '<button class="tc-del" title="删除">✕</button>' : ''}
    <div class="tc-preview">
      <div class="tc-side" style="background:${v['--titlebar']}"></div>
      <div class="tc-main" style="background:${v['--bg']}">
        <div class="tc-line w80" style="background:${v['--accent']}"></div>
        <div class="tc-line w60" style="background:${v['--text-3']}"></div>
        <div class="tc-line w40" style="background:${v['--border']}"></div>
      </div>
    </div>
    <div class="tc-name">${theme.name}</div>`;
  card.onclick = () => useTheme(theme.id);
  if (isCustom) card.querySelector('.tc-del').onclick = (e) => deleteCustomTheme(theme.id, e);
  return card;
}

function renderThemeGrids() {
  const g = $('#themeGrid'); g.innerHTML = '';
  for (const [id, t] of Object.entries(BUILTIN_THEMES)) {
    g.appendChild(themeCard({ ...t, id }, false));
  }
  const cg = $('#customGrid'); cg.innerHTML = '';
  const customs = Object.entries(state.themes.custom || {});
  if (!customs.length) {
    cg.innerHTML = '<div class="tp-hint">还没有自定义皮肤 —— 上面用封面或取色器生成一套</div>';
  } else {
    for (const [id, t] of customs) cg.appendChild(themeCard({ ...t, id }, true));
  }
}

function openThemePanel() { renderThemeGrids(); $('#themeOverlay').classList.remove('hidden'); }
function closeThemePanel() { $('#themeOverlay').classList.add('hidden'); }

// ==========================================================
//                     播放器
// ==========================================================
/* ==========================================================
   歌单
   ========================================================== */

/** 搜索歌单 —— 按音源分发 */
async function doSearchPlaylists(q) {
  if (state.source === 'migu') {
    const r = await window.dsh.migu.searchPlaylist(q, 1);
    if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕歌单搜索失败');
    return (r.data?.items || []).map(it => {
      const ml = it.musicList || {};
      return {
        source: 'migu',
        id: ml.musicListId,
        name: ml.title || ml.name || '(未命名歌单)',
        cover: miguImg(ml.imgItem?.img || ml.originalImgUrl || ''),
        creator: ml.ownerName || '',
        count: ml.musicNum || 0,
        playCount: ml.opNumItem?.playNumDesc || '',
      };
    });
  }
  // 网易云：cloudsearch type=1000 返回歌单
  const r = await api('/cloudsearch', { keywords: q, type: 1000, limit: 40 });
  return (r?.result?.playlists || []).map(p => ({
    source: 'netease',
    id: p.id,
    name: p.name,
    cover: p.coverImgUrl || '',
    creator: p.creator?.nickname || '',
    count: p.trackCount || 0,
    playCount: p.playCount ? fmtCount(p.playCount) : '',
  }));
}

function fmtCount(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

/** 拉取歌单内的歌曲（也用于专辑：pl._album === true） */
async function fetchPlaylistSongs(pl) {
  // 专辑走各自的专辑接口
  if (pl._album) {
    if (pl.source === 'migu') {
      const r = await window.dsh.migu.albumSong(pl.id, 1);
      if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕专辑读取失败');
      // 咪咕 getAlbumSong 返回的是 data.songList（不是 contents）
      const list = r.data?.songList || [];
      return list.map(s => ({
        source: 'migu',
        id: s.contentId || s.songId,
        contentId: s.contentId || s.songId,
        copyrightId: s.copyrightId,
        resourceType: s.resourceType || '2',
        name: s.songName || '',
        artists: (s.singerList || []).map(x => ({ name: x.name })),
        artistText: (s.singerList || []).map(x => x.name).join(' / '),
        album: { name: s.album || pl.name, picUrl: miguImg(s.img1 || s.img2 || s.img3 || pl.cover || '') },
        duration: (s.duration || 0) * 1000,
        vip: (s.showTags || []).includes('vip'),
      })).filter(s => s.id);
    }
    const r = await api('/album', { id: pl.id });
    const songs = r?.songs || [];
    return songs.map(t => ({
      source: 'netease', id: t.id,
      name: t.name, artists: t.ar || [],
      artistText: (t.ar || []).map(a => a.name).join(' / '),
      album: { name: t.al?.name || pl.name, picUrl: t.al?.picUrl || pl.cover || '' },
      duration: t.dt || 0, vip: t.fee === 1,
    }));
  }

  if (pl.source === 'migu') {
    const r = await window.dsh.migu.playlistSong(pl.id, 1, 100);
    if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕歌单读取失败');
    // 咪咕歌单歌曲可能直接是 song 结构，也可能只有 contentId
    const raw = r.data?.items || r.data?.songList || r.data?.list || [];
    return raw.map(x => {
      const s = x.song || x;
      return {
        source: 'migu',
        id: s.contentId || s.id,
        contentId: s.contentId || s.id,
        copyrightId: s.copyrightId,
        resourceType: s.resourceType || '2',
        name: s.songName || s.name,
        artists: (s.singerList || []).map(y => ({ name: y.name })),
        artistText: (s.singerList || []).map(y => y.name).join(' / '),
        album: { name: s.album || '', picUrl: miguImg(s.img1 || s.img2 || s.img3 || '') },
        duration: (s.duration || 0) * 1000,
        vip: (s.showTags || []).includes('vip'),
      };
    }).filter(s => s.id);
  }
  const r = await api('/playlist/detail', { id: pl.id });
  const tracks = r?.playlist?.tracks || [];
  return tracks.map(t => ({
    source: 'netease',
    id: t.id,
    name: t.name,
    artists: t.ar || [],
    artistText: (t.ar || []).map(a => a.name).join(' / '),
    album: { name: t.al?.name || '', picUrl: t.al?.picUrl || '' },
    duration: t.dt || 0,
    vip: t.fee === 1,
  }));
}

/** 打开歌单详情 */
async function openPlaylist(pl) {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-pl').classList.remove('hidden');

  $('#plCover').src = pl.cover || '';
  $('#plName').textContent = pl.name;
  $('#plInfo').textContent = (pl.creator ? pl.creator + ' · ' : '') + pl.count + ' 首' + (pl.playCount ? ' · 播放 ' + pl.playCount : '');
  $('#plSongs').innerHTML = '<div class="empty">加载中…</div>';

  try {
    const songs = await fetchPlaylistSongs(pl);
    if (!songs.length) {
      $('#plSongs').innerHTML = '<div class="empty">' +
        (pl._album ? '该专辑暂无可播放曲目（数字专辑需在咪咕客户端购买）' : '该歌单没有可取到的歌曲') +
        '</div>';
      return;
    }
    state.queue = songs;
    renderSongList($('#plSongs'), songs, (i) => playAt(i));
    toast('已载入 ' + songs.length + ' 首');
  } catch (e) {
    $('#plSongs').innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

/** 通用歌曲列表渲染（搜索结果 / 歌单详情共用） */
function renderSongList(box, songs, onPick) {
  box.innerHTML = '';
  songs.forEach((s, i) => {
    const artists = (s.artists || s.ar || []).map(a => a.name).join(' / ');
    const album = s.album || s.al || {};
    const row = document.createElement('div');
    row.className = 'row' + (state.queue === songs && i === state.index ? ' playing' : '');
    row.innerHTML = `
      <span class="row-idx">${i + 1}</span>
      <img class="row-cover" src="${album.picUrl || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="row-meta">
        <div class="row-name">${esc(s.name)}${s.vip ? '<span class="badge-vip">VIP</span>' : ''}${s.source === 'migu' ? '<span class="badge-src">咪咕</span>' : ''}</div>
        <div class="row-artist">${esc(artists)} — ${esc(album.name || '')}</div>
      </div>
      <span class="row-dur">${fmtTime((s.duration || s.dt || 0) / 1000)}</span>
      <button class="row-fav ${isFavorite(s) ? 'on' : ''}" title="收藏">${isFavorite(s) ? '♥' : '♡'}</button>`;
    row.dataset.favKey = favKey(s);
    row.onclick = () => onPick(i);
    const fb = row.querySelector('.row-fav');
    fb.onclick = (e) => toggleFavorite(s, e);
    box.appendChild(row);
  });
}

/** 渲染歌手卡片列表 */
function renderArtistCards(box, list) {
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">没有找到歌手</div>'; return; }
  list.forEach(ar => {
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.innerHTML = `
      <img class="pl-row-cover" style="border-radius:50%" src="${ar.avatar}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="pl-row-meta">
        <div class="pl-row-name">${esc(ar.name)}</div>
        <div class="pl-row-sub">歌曲 ${ar.songNum || '-'} · 专辑 ${ar.albumNum || '-'}</div>
      </div>
      <span class="pl-row-count">${ar.source === 'migu' ? '咪咕' : '网易云'}</span>`;
    row.onclick = () => openArtist(ar);
    box.appendChild(row);
  });
}

/** 渲染歌单卡片列表 */
function renderPlaylistCards(box, lists) {
  box.innerHTML = '';
  if (!lists.length) { box.innerHTML = '<div class="empty">没有找到歌单</div>'; return; }
  lists.forEach(pl => {
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.innerHTML = `
      <img class="pl-row-cover" src="${pl.cover}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="pl-row-meta">
        <div class="pl-row-name">${esc(pl.name)}</div>
        <div class="pl-row-sub">${esc(pl.creator || '')}${pl.playCount ? ' · 播放 ' + pl.playCount : ''}</div>
      </div>
      <span class="pl-row-count">${pl.count} 首</span>`;
    row.onclick = () => openPlaylist(pl);
    box.appendChild(row);
  });
}

/* ==========================================================
   歌手主页
   ========================================================== */

/** 搜索歌手 —— 按音源分发 */
async function doSearchArtists(q) {
  if (state.source === 'migu') {
    const r = await window.dsh.migu.searchSinger(q, 1);
    if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕歌手搜索失败');
    return (r.data?.items || []).map(it => {
      const s = it.singer || {};
      // imgs 是尺寸数组，优先取 imgSizeType=02（中等尺寸）
      const imgs = s.imgs || [];
      const pick = imgs.find(x => x.imgSizeType === '02') || imgs[0] || {};
      return {
        source: 'migu',
        id: s.singerId,
        name: s.singer,
        avatar: pick.img || '',
        songNum: s.songNum || 0,
        albumNum: s.albumNum || 0,
        brief: (s.summary || '').replace(/\s+/g, ' ').trim(),
      };
    }).filter(a => a.id);
  }
  // 网易云：cloudsearch type=100 返回歌手
  const r = await api('/cloudsearch', { keywords: q, type: 100, limit: 40 });
  return (r?.result?.artists || []).map(a => ({
    source: 'netease',
    id: a.id,
    name: a.name,
    avatar: a.picUrl || a.img1v1Url || '',
    songNum: a.musicSize || 0,
    albumNum: a.albumSize || 0,
    brief: (a.briefDesc || '').replace(/\s+/g, ' ').trim(),
  }));
}

/** 拉取歌手的过往专辑 */
async function fetchArtistAlbums(ar) {
  if (ar.source === 'migu') {
    const r = await window.dsh.migu.singerAlbum(ar.id, 1);
    if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕专辑读取失败');
    return (r.data?.contents || [])
      .filter(x => x.view === 'ZJ-Album-Item')
      .map(x => ({
        id: x.resId,
        name: x.txt || '(未命名专辑)',
        cover: miguImg(x.img || ''),
        date: x.txt3 || '',
        size: 0,
      }));
  }
  const r = await api('/artist/album', { id: ar.id, limit: 100 });
  return (r?.hotAlbums || []).map(a => ({
    id: a.id,
    name: a.name,
    cover: a.picUrl || '',
    date: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : '',
    size: a.size || 0,
  }));
}

/** 拉取歌手的热门歌曲 */
async function fetchArtistSongs(ar) {
  if (ar.source === 'migu') {
    const r = await window.dsh.migu.singerSong(ar.id, 1);
    if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕歌手歌曲读取失败');
    // 结构：data.contents[] 里 view==='ZJ-Singer-Song-Scroll' 的那块才有歌曲
    const blocks = r.data?.contents || [];
    const wrap = blocks.find(x => x.view === 'ZJ-Singer-Song-Scroll');
    const items = wrap?.contents || [];
    return items.map(x => ({
      source: 'migu',
      id: x.resId,
      contentId: x.resId,
      name: x.txt || '',
      artists: [{ name: x.txt2 || ar.name }],
      artistText: x.txt2 || ar.name,
      album: { name: x.txt3 || '', picUrl: miguImg(x.img || '') },
      duration: 0,
      vip: false,
    })).filter(s => s.id);
  }
  const r = await api('/artists', { id: ar.id });
  const songs = r?.hotSongs || [];
  return songs.map(t => ({
    source: 'netease',
    id: t.id,
    name: t.name,
    artists: t.ar || [],
    artistText: (t.ar || []).map(a => a.name).join(' / '),
    album: { name: t.al?.name || '', picUrl: t.al?.picUrl || '' },
    duration: t.dt || 0,
    vip: t.fee === 1,
  }));
}

/** 打开歌手主页 */
async function openArtist(ar) {
  state.artist = ar;
  state.arTab = 'album';
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-artist').classList.remove('hidden');

  $('#arAvatar').src = ar.avatar || '';
  $('#arName').textContent = ar.name;
  $('#arStats').innerHTML =
    '<span>歌曲 <b>' + (ar.songNum || '-') + '</b></span>' +
    '<span>专辑 <b>' + (ar.albumNum || '-') + '</b></span>';
  const brief = $('#arBrief');
  brief.textContent = ar.brief || '暂无简介';
  brief.classList.toggle('expanded', false);
  brief.onclick = () => brief.classList.toggle('expanded');

  document.querySelectorAll('.artab').forEach(t =>
    t.classList.toggle('active', t.dataset.ar === state.arTab));
  $('#arBody').innerHTML = '<div class="empty">加载中…</div>';

  await loadArtistTab();
}

/** 按当前分栏加载歌手内容 */
async function loadArtistTab() {
  const ar = state.artist;
  if (!ar) return;
  const box = $('#arBody');

  if (state.arTab === 'album') {
    try {
      const albums = await fetchArtistAlbums(ar);
      $('#arAlbumCount').textContent = albums.length;
      if (!albums.length) { box.innerHTML = '<div class="empty">没有取到专辑</div>'; return; }
      const grid = document.createElement('div');
      grid.className = 'album-grid';
      albums.forEach(al => {
        const card = document.createElement('div');
        card.className = 'album-card';
        card.innerHTML = `
          <img class="album-cover" src="${al.cover}" loading="lazy" onerror="this.style.visibility='hidden'">
          <div class="album-name" title="${esc(al.name)}">${esc(al.name)}</div>
          <div class="album-date">${al.date || ''}${al.size ? ' · ' + al.size + ' 首' : ''}</div>`;
        card.onclick = () => openAlbumAsPlaylist(al, ar);
        grid.appendChild(card);
      });
      box.innerHTML = '';
      box.appendChild(grid);
    } catch (e) {
      box.innerHTML = '<div class="empty">专辑加载失败：' + esc(e.message) + '</div>';
    }
    return;
  }

  // 热门歌曲
  try {
    const songs = await fetchArtistSongs(ar);
    if (!songs.length) { box.innerHTML = '<div class="empty">没有取到歌曲</div>'; return; }
    state.queue = songs;
    renderSongList(box, songs, (i) => playAt(i));
    toast('已载入 ' + songs.length + ' 首');
  } catch (e) {
    box.innerHTML = '<div class="empty">歌曲加载失败：' + esc(e.message) + '</div>';
  }
}

/** 点专辑 → 当作歌单打开（复用歌单详情视图） */
async function openAlbumAsPlaylist(al, ar) {
  const fake = {
    source: ar.source,
    id: al.id,
    name: al.name,
    cover: al.cover,
    creator: ar.name,
    count: al.size || 0,
    playCount: '',
    _album: true,
  };
  await openPlaylist(fake);
}

/* ==========================================================
   收藏
   ========================================================== */
// 同一首歌曲的唯一键：音源 + id（避免两个源的 id 撞车）
const favKey = (s) => (s.source || 'netease') + ':' + s.id;

function isFavorite(s) {
  if (!s) return false;
  const k = favKey(s);
  return state.favorites.some(x => favKey(x) === k);
}

function persistFavorites() {
  window.dsh.config.set({ favorites: state.favorites });
}

function toggleFavorite(s, ev) {
  if (ev) ev.stopPropagation();
  if (!s) return;
  const k = favKey(s);
  const i = state.favorites.findIndex(x => favKey(x) === k);
  if (i >= 0) {
    state.favorites.splice(i, 1);
    toast('已取消收藏');
  } else {
    state.favorites.unshift(s);
    toast('已收藏：' + s.name);
  }
  persistFavorites();
  refreshFavCount();
  // 立即刷新可见的心形状态，不必整页重渲染
  document.querySelectorAll('.row').forEach(row => {
    if (row.dataset.favKey === k) {
      const btn = row.querySelector('.row-fav');
      if (btn) {
        const on = isFavorite(s);
        btn.classList.toggle('on', on);
        btn.textContent = on ? '♥' : '♡';
      }
    }
  });
}

function refreshFavCount() {
  const el = $('#favCount');
  if (el) el.textContent = state.favorites.length;
}

/** 渲染收藏页 */
function renderFavorites() {
  const box = $('#favList');
  refreshFavCount();
  if (!state.favorites.length) {
    box.innerHTML = '<div class="empty">还没有收藏的歌曲<br><span class="hint-sub">在歌曲列表点 ♡ 即可收藏</span></div>';
    return;
  }
  box.innerHTML = '';
  state.favorites.forEach((s, i) => {
    const artists = (s.artists || s.ar || []).map(a => a.name).join(' / ');
    const album = s.album || s.al || {};
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.favKey = favKey(s);
    row.innerHTML = `
      <span class="row-idx">${i + 1}</span>
      <img class="row-cover" src="${album.picUrl || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="row-meta">
        <div class="row-name">${esc(s.name)}${s.vip ? '<span class="badge-vip">VIP</span>' : ''}${s.source === 'migu' ? '<span class="badge-src">咪咕</span>' : ''}</div>
        <div class="row-artist">${esc(artists)} — ${esc(album.name || '')}</div>
      </div>
      <span class="row-dur">${fmtTime((s.duration || s.dt || 0) / 1000)}</span>
      <button class="row-fav on" title="取消收藏">♥</button>`;
    row.onclick = (e) => {
      if (e.target.classList.contains('row-fav')) return;
      state.queue = state.favorites.slice();
      playAt(i);
    };
    row.querySelector('.row-fav').onclick = (e) => toggleFavorite(s, e);
    box.appendChild(row);
  });
}

/* ==========================================================
   搜索历史
   ========================================================== */
const MAX_HISTORY = 12;

function persistHistory() {
  window.dsh.config.set({ searchHistory: state.history });
}

/** 记录一条搜索词（去重 + 最新在前 + 限量） */
function pushHistory(word) {
  const w = String(word || '').trim();
  if (!w) return;
  // 大小写不敏感去重：先移除同名旧项再插到最前
  state.history = [w, ...state.history.filter(x => x.toLowerCase() !== w.toLowerCase())]
    .slice(0, MAX_HISTORY);
  persistHistory();
  renderHistory();
}

function removeHistory(word, ev) {
  if (ev) ev.stopPropagation();
  state.history = state.history.filter(x => x !== word);
  persistHistory();
  renderHistory();
}

function clearHistory(ev) {
  if (ev) ev.stopPropagation();
  if (!state.history.length) return;
  state.history = [];
  persistHistory();
  renderHistory();
  toast('已清空搜索历史');
}

/** 渲染历史下拉 */
function renderHistory() {
  const box = $('#qHistory');
  if (!box) return;
  if (!state.history.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="qh-head">
      <span>搜索历史</span>
      <button class="qh-clear" id="qhClear">清空</button>
    </div>`;
  state.history.forEach(w => {
    const d = document.createElement('div');
    d.className = 'qh-item';
    d.innerHTML = `<span class="qh-icon">🕘</span><span class="qh-text"></span><button class="qh-del" title="删除">✕</button>`;
    d.querySelector('.qh-text').textContent = w;      // 用 textContent 避免 XSS
    d.onclick = () => { $('#q').value = w; hideHistory(); doSearch(); };
    d.querySelector('.qh-del').onclick = (e) => removeHistory(w, e);
    box.appendChild(d);
  });
  box.querySelector('#qhClear').onclick = clearHistory;
}

function showHistory() {
  if (!state.history.length) return;
  renderHistory();
  $('#qHistory').classList.remove('hidden');
}
function hideHistory() {
  const box = $('#qHistory');
  if (box) box.classList.add('hidden');
}

async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  state.lastQuery = q;
  hideHistory();
  pushHistory(q);              // 记录搜索历史
  const box = $('#results');
  box.innerHTML = '<div class="empty">搜索中…</div>';

  // 歌手分栏
  if (state.tab === 'artist') {
    try {
      state.artists = await doSearchArtists(q);
      renderArtistCards(box, state.artists);
    } catch (e) {
      box.innerHTML = '<div class="empty">歌手搜索失败：' + esc(e.message) + '</div>';
    }
    return;
  }

  // 歌单分栏
  if (state.tab === 'playlist') {
    try {
      state.playlists = await doSearchPlaylists(q);
      renderPlaylistCards(box, state.playlists);
    } catch (e) {
      box.innerHTML = '<div class="empty">歌单搜索失败：' + esc(e.message) + '</div>';
    }
    return;
  }

  let songs = [];
  try {
    if (state.source === 'migu') {
      songs = await miguSearch(q, 40);
    } else {
      const r = await api('/search', { keywords: q, limit: 40 });
      songs = (r?.result?.songs || []).map(s => ({ ...s, source: 'netease' }));
      // 网易云搜索接口只返回 picId、不返回 picUrl —— 用 /song/detail 批量补齐封面
      if (songs.length) await fillCovers(songs);
    }
  } catch (e) {
    box.innerHTML = '<div class="empty">搜索失败：' + esc(e.message) + '</div>';
    return;
  }
  if (!songs.length) { box.innerHTML = '<div class="empty">没有找到结果</div>'; return; }

  renderSongList(box, songs, (i) => { state.queue = songs; playAt(i); });
}

/** 用 picId 拼网易云封面地址（详情接口不可用时的兜底） */
function picUrlFromId(picId, size = 200) {
  if (!picId) return '';
  // 网易云 CDN 规则：picId 需加密，这里直接用图片服务端的公开规则拼接
  try {
    const s = String(picId);
    // 网易云图片服务接受 picId 的 base64 变体；最常见的可用形式是直接走 /public/ 路径
    return `https://p3.music.126.net/${encodeURIComponent(s)}/109951171836582062.jpg?param=${size}y${size}`;
  } catch { return ''; }
}

/** 批量补齐封面 picUrl 和时长 —— /song/detail 支持一次传多个 id */
async function fillCovers(songs) {
  if (!Array.isArray(songs) || !songs.length) return;
  songs.forEach(s => { if (!s.source) s.source = 'netease'; });   // 标记音源，收藏去重靠它
  const ids = songs.filter(s => s.id != null).map(s => s.id).join(',');
  if (!ids) return;
  try {
    const d = await api('/song/detail', { ids });
    const details = d?.songs || [];
    if (!details.length) { console.warn('song/detail 未返回数据，封面将留空'); return; }
    const map = new Map(details.map(x => [x.id, x]));
    for (const s of songs) {
      const det = map.get(s.id);
      if (!det) continue;
      const al = det.al || det.album || {};
      if (al.picUrl) {
        s.album = s.album || {};
        s.album.picUrl = al.picUrl;
        s.album.name = s.album.name || al.name;
      }
      if (det.dt && !s.duration) s.duration = det.dt;
    }
  } catch (e) {
    console.warn('补封面失败', e);
    toast('封面加载失败：' + e.message);
  }
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function updateSourceHint() {
  $('#srcHint').textContent = state.source === 'migu'
    ? '咪咕：免登录可直接播放，部分歌曲为会员专享'
    : (state.cookie ? '网易云：已登录' : '网易云：需登录才能听 VIP 歌曲');
  $('#q').placeholder = state.source === 'migu'
    ? '搜索咪咕曲库（歌曲 / 歌手 / 专辑）…'
    : '搜索网易云曲库（歌曲 / 歌手 / 专辑）…';
}

async function playAt(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const s = state.queue[i];
  const album = s.album || s.al || {};
  const artists = (s.artists || s.ar || []).map(a => a.name).join(' / ');

  $('#nowTitle').textContent = s.name;
  $('#nowArtist').textContent = artists;
  $('#cover').src = album.picUrl || '';
  $('#btnPlay').textContent = '⏸';

  let url = null;
  try {
    if (s.source === 'migu') {
      const info = await miguSongUrl(s);
      url = info.url;
    } else {
      const urlRes = await api('/song/url/v1', { id: s.id, level: 'exhigh' });
      url = urlRes?.data?.[0]?.url;
    }
  } catch (e) {
    toast('取播放地址失败：' + e.message);
  }
  if (!url) { toast('该歌曲无版权或需要登录/VIP'); $('#btnPlay').textContent = '▶'; return; }
  audio.src = url;
  audio.volume = $('#vol').value / 100;
  try { await audio.play(); } catch (e) { toast('播放失败：' + e.message); }

  renderPlaylist();
  pushLyric(s);
  syncNpFromPlayer();
}

function renderPlaylist() {
  const box = $('#plist');
  $('#plCount').textContent = state.queue.length;
  if (!state.queue.length) { box.innerHTML = '<div class="empty">列表为空</div>'; return; }
  box.innerHTML = '';
  state.queue.forEach((s, i) => {
    const artists = (s.artists || s.ar || []).map(a => a.name).join(' / ');
    const album = s.album || s.al || {};
    const row = document.createElement('div');
    row.className = 'row' + (i === state.index ? ' playing' : '');
    row.innerHTML = `
      <span class="row-idx">${i === state.index ? '♪' : i + 1}</span>
      <img class="row-cover" src="${album.picUrl || ''}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="row-meta">
        <div class="row-name">${esc(s.name)}</div>
        <div class="row-artist">${esc(artists)}</div>
      </div>
      <button class="row-fav ${isFavorite(s) ? 'on' : ''}" title="收藏">${isFavorite(s) ? '♥' : '♡'}</button>
      <button class="row-del" title="移除">✕</button>`;
    row.dataset.favKey = favKey(s);
    row.onclick = (e) => {
      if (e.target.classList.contains('row-del') || e.target.classList.contains('row-fav')) return;
      playAt(i);
    };
    row.querySelector('.row-fav').onclick = (e) => toggleFavorite(s, e);
    row.querySelector('.row-del').onclick = (e) => {
      e.stopPropagation();
      state.queue.splice(i, 1);
      if (i < state.index) state.index--;
      else if (i === state.index) { audio.pause(); state.index = -1; }
      renderPlaylist();
    };
    box.appendChild(row);
  });
}

/** 挑下一首的索引（按播放模式） */
function pickNextIndex(auto = false) {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.playMode === 'one' && auto) return state.index;      // 单曲循环：自动续播同一首
  if (state.playMode === 'shuffle') {
    if (n === 1) return 0;
    let i, guard = 0;
    do { i = Math.floor(Math.random() * n); guard++; }
    while (i === state.index && guard < 50);                      // 避免随机到当前这首
    return i;
  }
  if (state.playMode === 'order' && auto) {                       // 顺序播放：到底就停
    return state.index + 1 < n ? state.index + 1 : -1;
  }
  return (state.index + 1) % n;                                   // 列表循环
}

function pickPrevIndex() {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.playMode === 'shuffle') return Math.floor(Math.random() * n);
  return (state.index - 1 + n) % n;
}

/** auto=true 表示由歌曲自然播完触发，此时单曲循环/顺序播放才有特殊行为 */
function next(auto = false) {
  const i = pickNextIndex(auto);
  if (i < 0) { audio.pause(); toast('已播放到列表末尾'); return; }
  playAt(i);
}
function prev() { const i = pickPrevIndex(); if (i >= 0) playAt(i); }
function toggle() { audio.paused ? audio.play().catch(()=>{}) : audio.pause(); }

/** 循环切换播放模式 */
const PLAY_MODES = [
  { id: 'list',    icon: '🔁', label: '列表循环' },
  { id: 'one',     icon: '🔂', label: '单曲循环' },
  { id: 'shuffle', icon: '🔀', label: '随机播放' },
  { id: 'order',   icon: '➡️', label: '顺序播放' },
];
function cyclePlayMode() {
  const idx = PLAY_MODES.findIndex(m => m.id === state.playMode);
  const nextMode = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
  state.playMode = nextMode.id;
  window.dsh.config.set({ playMode: state.playMode });
  updatePlayModeBtn();
  updateNpModeBtn();
  toast(nextMode.label);
}
function updatePlayModeBtn() {
  const m = PLAY_MODES.find(x => x.id === state.playMode) || PLAY_MODES[0];
  const btn = $('#btnMode');
  if (btn) { btn.textContent = m.icon; btn.title = m.label + '（点击切换）'; }
}

// ---------------------------------------------------------- 歌词
let lyricLines = [], lyricDelay = 0;
let npOpen = false;        // 歌词详情页是否打开
let npActiveIdx = -1;      // 当前高亮歌词行
let lyricOffset = 0;       // 用户手动偏移（秒），用于修正不同源的歌词时轴
async function pushLyric(song) {
  let raw = '';
  try {
    if (song && song.source === 'migu') {
      raw = await miguLyric(song.contentId);
    } else {
      const id = song && song.id != null ? song.id : song;
      const r = await api('/lyric', { id });
      raw = r?.lrc?.lyric || '';
    }
  } catch (e) { console.warn('歌词获取失败', e); }
  lyricLines = parseLrc(raw);
  lyricDelay = 0;
  window.dsh.lyric.push({ lines: lyricLines, title: $('#nowTitle').textContent });
  if (npOpen) { renderNpLyric(); updateNpLyric(audio.currentTime); }
}
function parseLrc(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!m.length) continue;
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!content) continue;
    for (const t of m) out.push({ time: (+t[1]) * 60 + parseFloat(t[2]), text: content });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ==========================================================
//                     登录
// ==========================================================
let qrTimer = null;
async function loadQr() {
  clearInterval(qrTimer);
  $('#qrMask').textContent = '加载中…'; $('#qrMask').classList.remove('hidden');
  const k = await api('/login/qr/key', { timestamp: Date.now() });
  const key = k?.data?.unikey;
  if (!key) { $('#qrMask').textContent = '获取二维码失败'; return; }
  const c = await api('/login/qr/create', { key, qrimg: true, timestamp: Date.now() });
  const img = c?.data?.qrimg;
  if (!img) { $('#qrMask').textContent = '生成二维码失败'; return; }
  $('#qrImg').src = img;
  $('#qrMask').classList.add('hidden');
  $('#loginTip').textContent = '用网易云音乐 App 扫码登录（二维码 2 分钟内有效）';

  qrTimer = setInterval(async () => {
    const r = await api('/login/qr/check', { key, timestamp: Date.now() });
    const code = r?.code;
    if (code === 800) { $('#loginTip').textContent = '二维码已过期，请刷新'; clearInterval(qrTimer); }
    else if (code === 801) { $('#loginTip').textContent = '等待扫码…'; }
    else if (code === 802) { $('#loginTip').textContent = '已扫码，请在手机上确认'; }
    else if (code === 803) {
      clearInterval(qrTimer);
      $('#loginTip').textContent = '登录成功！';
      // cookie 从响应里取
      const ck = r.cookie || '';
      if (ck) { state.cookie = ck; window.dsh.config.set({ cookie: ck }); }
      toast('登录成功，登录状态已记住');
      await refreshLoginState();
      renderLoginView();
    }
  }, 2000);
}

/** 判断账号是否已登录；出错时不轻易清 cookie */
async function refreshLoginState() {
  if (!state.cookie) {
    $('#loginBadge').textContent = '未登录';
    state.account = null;
    return false;
  }
  let r;
  try {
    r = await api('/login/status', { timestamp: Date.now() });
  } catch (e) {
    // 网络/服务异常：保留 cookie，别把用户登出
    console.warn('登录状态查询失败（保留登录态）', e);
    $('#loginBadge').textContent = '登录态待确认';
    return true;
  }
  // 只有明确拿到「未登录」判定才清除；请求本身失败不清
  const p = r?.data?.profile || r?.profile;
  if (p) {
    state.account = p;
    $('#loginBadge').textContent = p.nickname || '已登录';
    return true;
  }
  // 尝试刷新 token，某些情况下 cookie 能被续期
  const refreshed = await tryRefreshToken();
  if (refreshed) return true;
  // 确实是未登录（返回体里没有 profile，且 code 正常）
  if (r && (r.code === 200 || r.code === 301 || r.data?.code === 200)) {
    state.cookie = ''; state.account = null;
    window.dsh.config.set({ cookie: '' });
    $('#loginBadge').textContent = '未登录';
    return false;
  }
  return true;   // 返回体异常，保守起见保留
}

/** 尝试用 refresh 接口续期登录态 */
async function tryRefreshToken() {
  try {
    const r = await api('/login/token/refresh', { timestamp: Date.now() });
    const ck = r?.cookie;
    if (r?.code === 200 && ck) {
      state.cookie = ck;
      window.dsh.config.set({ cookie: ck });
      const st = await api('/login/status', { timestamp: Date.now() });
      const p = st?.data?.profile || st?.profile;
      if (p) {
        state.account = p;
        $('#loginBadge').textContent = p.nickname || '已登录';
        console.log('登录态已续期');
        return true;
      }
    }
  } catch (e) { /* 续期失败不致命 */ }
  return false;
}

/** 打开登录页时决定显示「账号」还是「二维码」 */
async function renderLoginView() {
  const ok = await refreshLoginState();
  const acc = $('#accountSection'), qr = $('#qrSection');
  if (ok && state.account) {
    acc.classList.remove('hidden');
    qr.classList.add('hidden');
    const p = state.account;
    if (p.avatarUrl) $('#accAvatar').src = p.avatarUrl;
    $('#accNick').textContent = p.nickname || '已登录';
    $('#accSub').textContent = '用户 ID ' + (p.userId || '-') +
      (p.vipType ? ' · VIP' : '') + ' · 登录状态已保存';
    return;
  }
  acc.classList.add('hidden');
  qr.classList.remove('hidden');
  loadQr();
}

function logout() {
  state.cookie = ''; state.account = null;
  window.dsh.config.set({ cookie: '' });
  $('#loginBadge').textContent = '未登录';
  toast('已退出登录');
  // 回到二维码界面
  $('#accountSection').classList.add('hidden');
  $('#qrSection').classList.remove('hidden');
  loadQr();
}

// ==========================================================
//                 歌词详情页（Now Playing）
// ==========================================================

function openNp() {
  npOpen = true;
  $('#npOverlay').classList.remove('hidden');
  syncNpFromPlayer();
  renderNpLyric();
  // 打开时立即定位到当前唱到的那一行（不带动画）
  const idx = currentLyricIndex(audio.currentTime);
  npActiveIdx = idx;
  if (idx >= 0) {
    const nodes = $('#npLyricInner').querySelectorAll('.np-line');
    nodes.forEach((n, i) => {
      n.classList.toggle('active', i === idx);
      n.classList.toggle('near', Math.abs(i - idx) === 1);
    });
  }
  requestAnimationFrame(() => scrollNpToActive(false));
}
function closeNp() {
  npOpen = false;
  $('#npOverlay').classList.add('hidden');
}

/** 把播放器状态同步到歌词页 */
function syncNpFromPlayer() {
  const s = state.queue[state.index];
  $('#npCover').src = $('#cover').src || '';
  $('#npBg').style.backgroundImage = $('#cover').src ? 'url("' + $('#cover').src + '")' : 'none';
  $('#npTitle').textContent = $('#nowTitle').textContent;
  $('#npArtist').textContent = $('#nowArtist').textContent;
  const album = (s && (s.album || s.al)) || {};
  $('#npAlbum').textContent = album.name || '';
  $('#npTopTitle').textContent = $('#nowTitle').textContent;
  $('#npPlay').textContent = audio.paused ? '▶' : '⏸';
  $('#npVol').value = $('#vol').value;
  updateNpModeBtn();
}

function updateNpModeBtn() {
  const m = PLAY_MODES.find(x => x.id === state.playMode) || PLAY_MODES[0];
  const b = $('#npMode');
  if (b) { b.textContent = m.icon; b.title = m.label + '（点击切换）'; }
}

/** 渲染歌词页的歌词列表；可点行跳转 */
function renderNpLyric() {
  const box = $('#npLyricInner');
  if (!lyricLines.length) {
    box.innerHTML = '<div class="empty">暂无歌词</div>';
    npActiveIdx = -1;
    return;
  }
  box.innerHTML = '';
  lyricLines.forEach((ln, i) => {
    const d = document.createElement('div');
    d.className = 'np-line';
    d.textContent = ln.text;
    d.dataset.idx = i;
    d.onclick = () => {                       // 点歌词跳到该处
      audio.currentTime = Math.max(0, ln.time + lyricOffset);
      if (audio.paused) audio.play().catch(() => {});
    };
    box.appendChild(d);
  });
  npActiveIdx = -1;
}

/** 计算当前应在哪一行 */
function currentLyricIndex(t) {
  if (!lyricLines.length) return -1;
  const tt = t - lyricOffset;
  let lo = 0, hi = lyricLines.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyricLines[mid].time <= tt) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx;
}

/** 同步高亮 + 滚动 */
function updateNpLyric(t) {
  if (!npOpen) return;
  const idx = currentLyricIndex(t);
  if (idx === npActiveIdx) return;
  npActiveIdx = idx;

  const box = $('#npLyricInner');
  const nodes = box.querySelectorAll('.np-line');
  nodes.forEach((n, i) => {
    n.classList.toggle('active', i === idx);
    n.classList.toggle('near', Math.abs(i - idx) === 1);
  });
  scrollNpToActive(true);
}

/** 把当前行滚到视口中间 */
function scrollNpToActive(smooth) {
  const box = $('#npLyricInner');
  const scroller = $('#npLyricScroll');
  if (!box || !scroller || npActiveIdx < 0) return;
  const el = box.querySelectorAll('.np-line')[npActiveIdx];
  if (!el) return;
  const target = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
  scroller.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}

// ==========================================================
//                     事件绑定
// ==========================================================
function bind() {
  // 窗口
  $('#btnMin').onclick = () => window.dsh.win.minimize();
  $('#btnMax').onclick = () => window.dsh.win.maximize();
  $('#btnClose').onclick = () => window.dsh.win.close();

  // 导航
  document.querySelectorAll('.nav-item').forEach(n => {
    n.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
      n.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      $('#view-' + n.dataset.view).classList.remove('hidden');
      if (n.dataset.view === 'login') renderLoginView();
      if (n.dataset.view === 'favorites') renderFavorites();
      if (n.dataset.view === 'playlist') renderPlaylist();
    };
  });

  // 搜索分栏切换（单曲 / 歌单）
  document.querySelectorAll('.rtab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.rtab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.tab = t.dataset.tab;
      $('#q').placeholder = state.tab === 'playlist' ? '搜索歌单…'
        : state.tab === 'artist' ? '搜索歌手…'
        : (state.source === 'migu' ? '搜索咪咕曲库（歌曲 / 歌手 / 专辑）…' : '搜索网易云曲库（歌曲 / 歌手 / 专辑）…');
      if (state.lastQuery) doSearch();
      else $('#results').innerHTML = '<div class="empty">输入关键词开始搜索' + (state.tab === 'playlist' ? '歌单' : '') + '</div>';
    };
  });

  // ---- 播放列表页 ----
  $('#btnClearQueue').onclick = () => {
    if (!state.queue.length) return toast('列表已经是空的');
    state.queue = []; state.index = -1;
    audio.pause();
    renderPlaylist();
    toast('已清空播放列表');
  };
  $('#btnShufflePlay').onclick = () => {
    if (!state.queue.length) return toast('列表为空');
    state.playMode = 'shuffle';
    window.dsh.config.set({ playMode: 'shuffle' });
    updatePlayModeBtn(); updateNpModeBtn();
    playAt(Math.floor(Math.random() * state.queue.length));
    toast('随机播放');
  };

  // ---- 我的收藏 ----
  $('#btnFavPlayAll').onclick = () => {
    if (!state.favorites.length) return toast('还没有收藏的歌曲');
    state.queue = state.favorites.slice();
    playAt(0);
  };
  $('#btnFavClearAll').onclick = () => {
    if (!state.favorites.length) return toast('收藏是空的');
    state.favorites = [];
    persistFavorites();
    renderFavorites();
    toast('已清空收藏');
  };

  // 歌手页：返回 / 分栏
  $('#btnArBack').onclick = () => {
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
    document.querySelector('.nav-item[data-view="search"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $('#view-search').classList.remove('hidden');
  };
  document.querySelectorAll('.artab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.artab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.arTab = t.dataset.ar;
      loadArtistTab();
    };
  });

  // 歌单详情：返回 / 播放全部
  $('#btnPlBack').onclick = () => {
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
    document.querySelector('.nav-item[data-view="search"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $('#view-search').classList.remove('hidden');
  };
  $('#btnPlPlayAll').onclick = () => { if (state.queue.length) playAt(0); };

  // 播放模式
  $('#btnMode').onclick = cyclePlayMode;

  // 音源切换
  document.querySelectorAll('.src-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.src-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.source = tab.dataset.src;
      window.dsh.config.set({ source: state.source });
      updateSourceHint();
  if (cfg.playMode) state.playMode = cfg.playMode;
  if (Array.isArray(cfg.favorites)) {
    // 兼容早期版本存的收藏（可能缺 source 字段）
    state.favorites = cfg.favorites.map(f => ({ ...f, source: f.source || 'netease' }));
  }
  refreshFavCount();
  updatePlayModeBtn();
      // 换源后清空旧结果，避免不同源的结果混在一起
      $('#results').innerHTML = '<div class="empty">已切换到' + (state.source === 'migu' ? '咪咕' : '网易云') + '，输入关键词搜索</div>';
      state.queue = []; state.index = -1;
      $('#q').focus();
    };
  });

  // 搜索：历史下拉交互
  $('#q').addEventListener('focus', () => {
    // 已输入内容时不弹历史（避免挡住正在输入的关键词）
    if (!$('#q').value.trim()) showHistory();
  });
  $('#q').addEventListener('input', () => {
    if ($('#q').value.trim()) hideHistory();
    else showHistory();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.q-wrap')) hideHistory();
  });

  // 搜索
  $('#btnSearch').onclick = doSearch;
  $('#q').onkeydown = (e) => {
    if (e.key === 'Enter') { hideHistory(); doSearch(); return; }
    if (e.key === 'Escape') { hideHistory(); return; }
    // ↑ / ↓ 在历史项间移动并填入输入框
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!state.history.length) return;
      e.preventDefault();
      const cur = $('#q').value.trim();
      let idx = state.history.indexOf(cur);
      idx = e.key === 'ArrowDown'
        ? (idx + 1) % state.history.length
        : (idx <= 0 ? state.history.length - 1 : idx - 1);
      $('#q').value = state.history[idx];
    }
  };

  // 播放控制
  $('#btnPlay').onclick = toggle;
  $('#btnNext').onclick = next;
  $('#btnPrev').onclick = prev;
  audio.onplay  = () => { $('#btnPlay').textContent = '⏸'; $('#npPlay').textContent = '⏸'; };
  audio.onpause = () => { $('#btnPlay').textContent = '▶'; $('#npPlay').textContent = '▶'; };
  audio.onended = () => next(true);   // 自然播完：让单曲循环/顺序播放生效
  audio.ontimeupdate = () => {
    const p = audio.currentTime / (audio.duration || 1) * 100;
    $('#barFill').style.width = p + '%';
    $('#barDot').style.left = p + '%';
    $('#tCur').textContent = fmtTime(audio.currentTime);
    $('#tDur').textContent = fmtTime(audio.duration);
    // 同步歌词详情页的进度
    if (npOpen) {
      $('#npCur').textContent = fmtTime(audio.currentTime);
      $('#npDur').textContent = fmtTime(audio.duration);
      $('#npBarFill').style.width = p + '%';
      $('#npBarDot').style.left = p + '%';
    }
    updateNpLyric(audio.currentTime);
    window.dsh.lyric.push({ time: audio.currentTime, playing: !audio.paused });
  };
  $('#bar').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
  };

  // 音量
  $('#vol').oninput = (e) => { audio.volume = e.target.value / 100; state.muted = false; $('#btnMute').textContent = '🔊'; };
  $('#btnMute').onclick = () => {
    state.muted = !state.muted;
    audio.muted = state.muted;
    $('#btnMute').textContent = state.muted ? '🔇' : '🔊';
  };

  // 皮肤面板
  $('#btnTheme').onclick = openThemePanel;
  $('#btnThemeClose').onclick = closeThemePanel;
  $('#themeOverlay').onclick = (e) => { if (e.target.id === 'themeOverlay') closeThemePanel(); };
  $('#btnResetTheme').onclick = () => { useTheme('default'); toast('已恢复默认皮肤'); };

  // 取色生成皮肤
  $('#colorPick').oninput = (e) => { $('#colorHex').value = e.target.value; };
  $('#colorHex').oninput = (e) => {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) $('#colorPick').value = e.target.value;
  };
  $('#btnFromColor').onclick = () => {
    const hex = $('#colorHex').value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return toast('请输入 #RRGGBB 格式');
    saveCustomTheme(buildThemeFromColor(hex, '自定义 ' + hex.toUpperCase()));
    toast('已生成并应用皮肤');
  };

  // 从封面取色
  $('#btnFromCover').onclick = () => {
    const img = $('#cover');
    if (!img.src || !img.naturalWidth) return toast('先播放一首歌再试');
    try {
      const { hex } = extractDominantColor(img);
      saveCustomTheme(buildThemeFromColor(hex, '封面取色 ' + hex.toUpperCase()));
      toast('已从封面生成皮肤：' + hex.toUpperCase());
    } catch (e) { toast('取色失败：' + e.message); }
  };

  // ---- 歌词详情页 ----
  $('#nowBox').onclick = () => (npOpen ? closeNp() : openNp());
  $('#npClose').onclick = closeNp;
  $('#npPrev').onclick = prev;
  $('#npNext').onclick = next;
  $('#npPlay').onclick = toggle;
  $('#npMode').onclick = () => { cyclePlayMode(); updateNpModeBtn(); };
  $('#npDesktopLyric').onclick = () => $('#btnLyric').click();

  // 歌词页音量
  $('#npVol').oninput = (e) => {
    audio.volume = e.target.value / 100;
    $('#vol').value = e.target.value;
  };
  $('#npMute').onclick = () => $('#btnMute').click();

  // 歌词页进度拖动
  const npSeek = (e) => {
    const r = $('#npBar').getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
  };
  $('#npBar').onclick = npSeek;

  // 桌面歌词
  $('#btnLyric').onclick = async () => {
    const on = await window.dsh.lyric.toggle();
    toast(on ? '桌面歌词已开启' : '桌面歌词已关闭');
  };

  // 全局快捷键转发
  window.dsh.onHotkey((a) => {
    if (a === 'toggle') toggle();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
    else if (a === 'lyric') $('#btnLyric').click();
  });

  // Ctrl+F 聚焦搜索
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); $('#q').focus(); }
    if (e.key === 'Escape') { if (npOpen) closeNp(); else closeThemePanel(); }
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
  });
}

// ==========================================================
//                     启动
// ==========================================================
// 全局错误兜底：任何异常都显示出来，不要静默白屏
window.onerror = (msg, src, line, col, err) => {
  console.error('RENDERER ERROR:', msg, src, line, col, err);
  toast('出错了：' + msg);
};
window.onunhandledrejection = (e) => {
  console.error('UNHANDLED REJECTION:', e.reason);
  toast('请求失败：' + (e.reason?.message || e.reason));
};

(async function init() {
  try { bind(); } catch (e) { console.error('bind failed', e); }
  const cfg = await window.dsh.config.get();
  if (cfg.cookie) { state.cookie = cfg.cookie; refreshLoginState(); }
  if (cfg.source) {
    state.source = cfg.source;
    document.querySelectorAll('.src-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.src === state.source);
    });
  }
  updateSourceHint();
  // 播放模式
  if (cfg.playMode) state.playMode = cfg.playMode;
  updatePlayModeBtn();
  // 收藏（兼容早期版本可能缺 source 字段的旧数据）
  if (Array.isArray(cfg.favorites)) {
    state.favorites = cfg.favorites.map(f => ({ ...f, source: f.source || 'netease' }));
  }
  refreshFavCount();
  // 搜索历史
  if (Array.isArray(cfg.searchHistory)) state.history = cfg.searchHistory.slice(0, MAX_HISTORY);
  const t = await window.dsh.theme.load();
  state.themes = { current: t.current || 'default', custom: t.custom || {} };
  indexThemes();
  useTheme(state.themes.current, false);
  renderPlaylist();
})();