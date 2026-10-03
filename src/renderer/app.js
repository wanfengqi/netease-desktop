/* ============================================================
   应用入口：全局状态 + 工具函数 + 标题栏/快捷键 + 皮肤面板 + 启动
   ------------------------------------------------------------
   模块分工（按 index.html 的加载顺序）：
     themes.js     皮肤定义与取色算法
     icons.js      图标库（内联 SVG）
     normalize.js  音源归一化（唯一允许出现音源差异的地方之一）
     migu.js       咪咕传输适配
     ui.js         通用组件（歌曲行/骨架屏/右键菜单/可拖进度条）
     player.js     播放引擎（队列/取址/媒体控制/睡眠定时）
     views.js      视图渲染与歌词
     app.js        就是本文件：状态、启动、全局事件
   ============================================================ */
var state = {
  cfg: {},
  queue: [],          // 播放队列
  index: -1,          // 当前索引
  currentKey: '',     // 当前歌曲的 source:id —— 高亮/去重都以它为准
  source: 'netease',  // 当前音源：netease | migu
  playMode: 'list',   // list | one | shuffle | order
  tab: 'song',        // 搜索分栏：song | playlist | artist
  playlists: [],      // 上次搜到的歌单
  artists: [],        // 上次搜到的歌手
  artist: null,       // 当前打开的歌手
  arTab: 'album',
  favorites: [],
  recent: [],         // 最近播放
  history: [],        // 搜索历史
  account: null,
  lastQuery: '',
  cookie: '',
  volume: 0.7,
  muted: false,
  lyricOffset: 0,
  sleepTimer: null,
  sleepEndAt: 0,
  shuffleStack: [],   // 播放跳转历史：随机模式下"上一首"要能回到真正听过的那首
  searchSeq: 0,       // 搜索请求序号：丢弃过期响应，防止慢请求覆盖新结果
  themes: { current: 'default', custom: {} },
  allThemes: {},
};

// ---------------------------------------------------------- 工具
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  var m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

var toastTimer;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
}

/** 统一的网易云 API 代理调用（cookie 由主进程透传） */
async function api(path, params) {
  var r = await window.dsh.api(path, params || {}, state.cookie);
  return r.body;
}

/** 把所有 data-icon="xxx" 的占位元素换成内联 SVG */
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(function (n) {
    Icons.set(n, n.dataset.icon);
  });
}

// ==========================================================
//                     皮肤系统（面板部分）
// ==========================================================
function indexThemes() {
  state.allThemes = {};
  Object.keys(BUILTIN_THEMES).forEach(function (id) {
    state.allThemes[id] = Object.assign({}, BUILTIN_THEMES[id], { id: id });
  });
  Object.keys(state.themes.custom || {}).forEach(function (id) {
    state.allThemes[id] = Object.assign({}, state.themes.custom[id], { id: id, builtin: false });
  });
}

function useTheme(id, persist) {
  var theme = state.allThemes[id];
  if (!theme) { toast('找不到皮肤：' + id); return; }
  applyTheme(theme);
  if (persist !== false) {
    state.themes.current = id;
    window.dsh.theme.save(state.themes);
  }
  window.dsh.theme.pushToLyric(theme);
  renderThemeGrids();
}

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

function themeCard(theme, isCustom) {
  var v = theme.vars;
  var card = document.createElement('div');
  card.className = 'theme-card' + (state.themes.current === theme.id ? ' active' : '');
  card.innerHTML =
    (isCustom ? '<button class="tc-del" title="删除">' + Icons.svg('close') + '</button>' : '') +
    '<div class="tc-preview">' +
      '<div class="tc-side" style="background:' + v['--titlebar'] + '"></div>' +
      '<div class="tc-main" style="background:' + v['--bg'] + '">' +
        '<div class="tc-line w80" style="background:' + v['--accent'] + '"></div>' +
        '<div class="tc-line w60" style="background:' + v['--text-3'] + '"></div>' +
        '<div class="tc-line w40" style="background:' + v['--border'] + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="tc-name"></div>';
  card.querySelector('.tc-name').textContent = theme.name;
  card.onclick = function () { useTheme(theme.id); };
  if (isCustom) card.querySelector('.tc-del').onclick = function (e) { deleteCustomTheme(theme.id, e); };
  return card;
}

function renderThemeGrids() {
  var g = document.getElementById('themeGrid');
  g.innerHTML = '';
  Object.keys(BUILTIN_THEMES).forEach(function (id) {
    g.appendChild(themeCard(Object.assign({}, BUILTIN_THEMES[id], { id: id }), false));
  });
  var cg = document.getElementById('customGrid');
  cg.innerHTML = '';
  var customs = Object.keys(state.themes.custom || {});
  if (!customs.length) {
    cg.innerHTML = '<div class="tp-hint">还没有自定义皮肤 —— 上面用封面或取色器生成一套</div>';
  } else {
    customs.forEach(function (id) {
      cg.appendChild(themeCard(Object.assign({}, state.themes.custom[id], { id: id }), true));
    });
  }
}

function openThemePanel() {
  renderThemeGrids();
  document.getElementById('themeOverlay').classList.remove('hidden');
  Views.syncOverlayClass();
}
function closeThemePanel() {
  document.getElementById('themeOverlay').classList.add('hidden');
  Views.syncOverlayClass();
}

// ==========================================================
//                     标题栏 / 全局事件
// ==========================================================
async function syncMaxIcon() {
  var on = await window.dsh.win.isMaximized();
  Icons.set(document.getElementById('btnMax'), on ? 'restore' : 'max');
}

function bindTitlebar() {
  document.getElementById('btnMin').onclick = function () { window.dsh.win.minimize(); };
  document.getElementById('btnMax').onclick = async function () {
    await window.dsh.win.maximize();
    syncMaxIcon();
  };
  document.getElementById('btnClose').onclick = function () { window.dsh.win.close(); };
  window.addEventListener('resize', syncMaxIcon);

  // 桌面歌词
  document.getElementById('btnLyric').onclick = async function () {
    var on = await window.dsh.lyric.toggle();
    toast(on ? '桌面歌词已开启' : '桌面歌词已关闭');
  };

  // 睡眠定时
  document.getElementById('sleepBtn').onclick = function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    UI.menu([
      { label: '15 分钟后停止', icon: 'moon', onClick: function () { Player.setSleepTimer(15); } },
      { label: '30 分钟后停止', icon: 'moon', onClick: function () { Player.setSleepTimer(30); } },
      { label: '60 分钟后停止', icon: 'moon', onClick: function () { Player.setSleepTimer(60); } },
      { sep: true },
      { label: '关闭睡眠定时', icon: 'close', danger: !!state.sleepEndAt, onClick: function () { Player.setSleepTimer(0); } },
    ], r.left, r.bottom + 4);
  };

  // 皮肤面板
  document.getElementById('btnTheme').onclick = openThemePanel;
  document.getElementById('btnThemeClose').onclick = closeThemePanel;
  document.getElementById('themeOverlay').onclick = function (e) {
    if (e.target.id === 'themeOverlay') closeThemePanel();
  };
  document.getElementById('btnResetTheme').onclick = function () { useTheme('default'); toast('已恢复默认皮肤'); };

  document.getElementById('colorPick').oninput = function (e) { document.getElementById('colorHex').value = e.target.value; };
  document.getElementById('colorHex').oninput = function (e) {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) document.getElementById('colorPick').value = e.target.value;
  };
  document.getElementById('btnFromColor').onclick = function () {
    var hex = document.getElementById('colorHex').value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return toast('请输入 #RRGGBB 格式');
    saveCustomTheme(buildThemeFromColor(hex, '自定义 ' + hex.toUpperCase()));
    toast('已生成并应用皮肤');
  };
  document.getElementById('btnFromCover').onclick = function () {
    var img = document.getElementById('cover');
    if (!img.src || !img.naturalWidth) return toast('先播放一首歌再试');
    try {
      var hex = extractDominantColor(img).hex;
      saveCustomTheme(buildThemeFromColor(hex, '封面取色 ' + hex.toUpperCase()));
      toast('已从封面生成皮肤：' + hex.toUpperCase());
    } catch (e) { toast('取色失败：' + e.message); }
  };
}

function bindKeyboard() {
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); document.getElementById('q').focus(); return; }
    if (e.key === 'Escape') {
      UI.closeMenu();
      if (Views.isNpOpen()) Views.closeNp();
      else closeThemePanel();
      return;
    }
    if (typing) return;
    var a = Player.audio;
    if (e.code === 'Space') { e.preventDefault(); Player.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); a.currentTime = Math.min(a.duration || 1e9, a.currentTime + 5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); a.currentTime = Math.max(0, a.currentTime - 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); Player.setVolume(state.volume + 0.05); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); Player.setVolume(state.volume - 0.05); }
    else if (e.key === 'm' || e.key === 'M') { Player.setMuted(!state.muted); }
    else if (e.key === 'l' || e.key === 'L') { document.getElementById('btnLyric').click(); }
  });
}

// ==========================================================
//                     启动
// ==========================================================
// 全局错误兜底：任何异常都显示出来，不要静默白屏
window.onerror = function (msg, src, line, col, err) {
  console.error('RENDERER ERROR:', msg, src, line, col, err);
  toast('出错了：' + msg);
};
window.onunhandledrejection = function (e) {
  console.error('UNHANDLED REJECTION:', e.reason);
  toast('请求失败：' + (e.reason && e.reason.message ? e.reason.message : e.reason));
};

(async function init() {
  hydrateIcons();

  // 1) 配置（先读配置，Player.init 里的音量恢复依赖它）
  var cfg = await window.dsh.config.get();
  state.cfg = cfg || {};
  if (cfg.cookie) state.cookie = cfg.cookie;
  if (cfg.source) state.source = cfg.source;
  if (cfg.playMode) state.playMode = cfg.playMode;
  if (Array.isArray(cfg.favorites)) {
    state.favorites = cfg.favorites.map(function (f) { return Object.assign({}, f, { source: f.source || 'netease' }); });
  }
  if (Array.isArray(cfg.recent)) {
    state.recent = cfg.recent.map(function (f) { return Object.assign({}, f, { source: f.source || 'netease' }); });
  }
  if (Array.isArray(cfg.searchHistory)) state.history = cfg.searchHistory.slice(0, 12);
  if (typeof cfg.lyricOffset === 'number') state.lyricOffset = cfg.lyricOffset;

  // 2) 事件绑定（Views 内部包含搜索/导航/歌词页；标题栏与键盘在这里）
  Views.init();
  bindTitlebar();
  bindKeyboard();

  // 3) 把配置回填到界面
  document.querySelectorAll('.src-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.src === state.source);
  });
  Views.updateSourceHint();
  Views.paintLyricOffset();

  // 4) 皮肤
  var t = await window.dsh.theme.load();
  state.themes = { current: t.current || 'default', custom: t.custom || {} };
  indexThemes();
  useTheme(state.themes.current, false);

  // 5) 播放引擎（内部会恢复音量、初始化进度条拖动、媒体控制）
  Player.init();
  Player.applyModeToUi();

  // 6) 列表与上次的播放队列
  if (!Player.restoreQueue()) {
    Views.renderQueueView();
  }
  Views.refreshPlayState();
  syncMaxIcon();

  // 7) 登录态与媒体键（不阻塞界面）
  if (state.cookie) Views.renderLoginView().then(function () { Views.updateSourceHint(); });
  window.dsh.onHotkey(function (a) {
    if (a === 'toggle') Player.toggle();
    else if (a === 'next') Player.next(false);
    else if (a === 'prev') Player.prev();
    else if (a === 'lyric') document.getElementById('btnLyric').click();
  });
})();
