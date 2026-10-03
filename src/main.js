const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const IS_DEV = !app.isPackaged;

// 固定 userData 目录名：打包后 app.getName() 取 package.json 的 name（Netease），
// 会导致开发版与打包版读到两份不同的配置（收藏/皮肤/cookie 不同步）。
// 这里统一成 netease-desktop。
app.setName('netease-desktop');
let API_PORT = 3000;
let apiProc = null;
let mainWin = null;
let lyricWin = null;
let tray = null;

// ------------------------------------------------------------------ 配置
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); }
  catch { return {}; }
}
function saveConfig(patch) {
  const c = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2));
  return c;
}

// 皮肤存 userData/themes.json：{ current: 'id', custom: { id: {name, vars} } }
const themesPath = () => path.join(app.getPath('userData'), 'themes.json');
function loadThemes() {
  try { return JSON.parse(fs.readFileSync(themesPath(), 'utf8')); }
  catch { return { current: 'default', custom: {} }; }
}
function saveThemes(t) {
  fs.mkdirSync(path.dirname(themesPath()), { recursive: true });
  fs.writeFileSync(themesPath(), JSON.stringify(t, null, 2));
  return t;
}

// ------------------------------------------------------------------ 拉起 NeteaseCloudMusicApi
function findApiEntry() {
  // 打包后代码在 app.asar 里，但 spawn 无法执行 asar 内的文件 ——
  // electron-builder 的 asarUnpack 会把 API 解包到 app.asar.unpacked，优先用那个路径
  const roots = [
    app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
    app.getAppPath(),
  ];
  const names = ['app.js', 'server.js'];
  for (const root of roots) {
    for (const n of names) {
      const c = path.join(root, 'node_modules', 'NeteaseCloudMusicApi', n);
      if (fs.existsSync(c)) { log('API 入口: ' + c); return c; }
    }
  }
  log('未找到 API 入口，尝试过的路径: ' + roots.join(' | '));
  return null;
}

/** 找一个空闲端口，避免与已有实例/服务冲突 */
async function pickFreePort(start = 3300, end = 3400) {
  const netmod = require('net');
  for (let p = start; p <= end; p++) {
    const free = await new Promise(res => {
      const s = netmod.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (free) return p;
  }
  return start;
}

function startApiServer() {
  const entry = findApiEntry();
  if (!entry) { log('未找到 NeteaseCloudMusicApi，跳过自动启动'); return; }
  apiProc = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(API_PORT), ELECTRON_RUN_AS_NODE: '1' },
    cwd: path.dirname(entry),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // 节流：API 日志量大时 pipe 缓冲写满会阻塞子进程，必须持续消费并限量
  let logBudget = 200;
  const drain = (tag) => (d) => {
    if (logBudget-- > 0) log(tag + ' ' + d.toString().trim().slice(0, 400));
  };
  apiProc.stdout.on('data', drain('[api]'));
  apiProc.stderr.on('data', drain('[api:err]'));
  apiProc.on('exit', (code) => log('API 进程退出 code=' + code));
}

function log(...a) { if (IS_DEV) console.log('[main]', ...a); }

// 等 API 起来
async function waitForApi(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (apiProc && apiProc.exitCode !== null) { log('API 进程已退出，放弃等待'); return false; }
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/`);
      if (r.status >= 200) { log('API 就绪，端口 ' + API_PORT); return true; }
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  log('等待 API 超时');
  return false;
}

// ------------------------------------------------------------------ 主窗口
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1080, height: 700, minWidth: 860, minHeight: 560,
    frame: false,
    backgroundColor: '#f6f7f9',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { mainWin = null; });
  if (IS_DEV && process.env.DEVTOOLS) mainWin.webContents.openDevTools({ mode: 'detach' });
}

// ------------------------------------------------------------------ 桌面歌词窗口
function createLyricWindow() {
  if (lyricWin) { lyricWin.show(); return; }
  lyricWin = new BrowserWindow({
    width: 820, height: 150,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  lyricWin.loadFile(path.join(__dirname, 'renderer', 'lyric.html'));
  lyricWin.setAlwaysOnTop(true, 'screen-saver');
  lyricWin.on('closed', () => { lyricWin = null; });
}

// ------------------------------------------------------------------ 托盘
function createTray() {
  // 用应用图标缩放成托盘图标
  const iconPath = path.join(__dirname, 'renderer', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // 兜底：图标缺失时用 1x1 透明图，避免 Tray 构造失败
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('网易云音乐');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWin) mainWin.show(); else createMainWindow(); } },
    { label: '桌面歌词', click: () => createLyricWindow() },
    { type: 'separator' },
    { label: '播放/暂停', click: () => mainWin?.webContents.send('hotkey', 'toggle') },
    { label: '上一首', click: () => mainWin?.webContents.send('hotkey', 'prev') },
    { label: '下一首', click: () => mainWin?.webContents.send('hotkey', 'next') },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } else createMainWindow(); });
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('win:minimize', () => mainWin?.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWin) return false;
  if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize();
  return mainWin.isMaximized();
});
ipcMain.handle('win:close', () => mainWin?.close());
ipcMain.handle('win:isMaximized', () => mainWin?.isMaximized() ?? false);

ipcMain.handle('theme:load', () => loadThemes());
ipcMain.handle('theme:save', (_e, t) => saveThemes(t));

ipcMain.handle('lyric:toggle', () => {
  if (lyricWin) { lyricWin.close(); return false; }
  createLyricWindow(); return true;
});
ipcMain.handle('lyric:lock', (_e, locked) => { lyricWin?.setIgnoreMouseEvents(locked, { forward: true }); return locked; });

// 歌词窗口 ← 主窗口 同步
ipcMain.on('lyric:push', (_e, payload) => lyricWin?.webContents.send('lyric:data', payload));
ipcMain.on('lyric:theme', (_e, theme) => lyricWin?.webContents.send('lyric:theme', theme));

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, p) => saveConfig(p));

// 主进程代理请求 → 绕开 CORS，顺便带上 cookie
/**
 * IPC 传输瘦身：playlist/detail 等接口原始响应 300-500KB，
 * 直接结构化克隆过 IPC 会让渲染进程卡死/崩溃。
 * 这里只保留渲染层真正用到的字段。
 */
function slimPayload(path, body) {
  if (!body || typeof body !== 'object') return body;

  const pickTrack = (t) => ({
    id: t.id,
    name: t.name,
    ar: (t.ar || []).map(a => ({ name: a.name })),
    al: { name: t.al?.name || '', picUrl: t.al?.picUrl || '' },
    dt: t.dt || 0,
    fee: t.fee,
  });

  // 歌单详情：只留标题信息 + 精简曲目
  if (path.startsWith('/playlist/detail') && body.playlist) {
    const pl = body.playlist;
    return {
      code: body.code,
      playlist: {
        id: pl.id,
        name: pl.name,
        coverImgUrl: pl.coverImgUrl,
        trackCount: pl.trackCount,
        playCount: pl.playCount,
        creator: pl.creator ? { nickname: pl.creator.nickname } : undefined,
        tracks: (pl.tracks || []).map(pickTrack),
      },
    };
  }

  // 歌单搜索：只留卡片需要的字段
  if (path.startsWith('/cloudsearch') && body.result?.playlists) {
    return {
      code: body.code,
      result: {
        playlists: body.result.playlists.map(x => ({
          id: x.id,
          name: x.name,
          coverImgUrl: x.coverImgUrl,
          trackCount: x.trackCount,
          playCount: x.playCount,
          creator: x.creator ? { nickname: x.creator.nickname } : undefined,
        })),
      },
    };
  }

  return body;
}

ipcMain.handle('api:fetch', async (_e, { path: p, params = {}, cookie = '' }) => {
  const t0 = Date.now();
  const url = new URL('http://127.0.0.1:' + API_PORT + p);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  // 关键：cookie 走 query，NeteaseCloudMusicApi 支持 cookie 参数
  if (cookie) url.searchParams.set('cookie', cookie);
  log('→ ' + p + ' ' + JSON.stringify(params).slice(0, 120));
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 dsh-netease-desktop' },
      signal: AbortSignal.timeout(20000),   // 防止请求无限挂起
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    const before = text.length;
    body = slimPayload(p, body);
    log('← ' + p + ' ' + res.status + ' ' + (before / 1024).toFixed(0) + 'KB→' +
        (JSON.stringify(body).length / 1024).toFixed(0) + 'KB ' + (Date.now() - t0) + 'ms');
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    log('✗ ' + p + ' FAILED after ' + (Date.now() - t0) + 'ms: ' + e.message);
    return { ok: false, status: 0, body: { error: String(e.message) } };
  }
});

// ------------------------------------------------------------------ 咪咕音乐源
// migu-api-enhanced 是 ESM 包，主进程是 CJS —— 用动态 import 懒加载
let miguMod = null;
async function getMigu() {
  if (!miguMod) {
    // 打包后 SDK 被 unpack 出来，需要绝对路径导入
    const unpacked = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
    const entry = path.join(unpacked, 'node_modules', 'migu-api-enhanced', 'dist', 'index.mjs');
    if (fs.existsSync(entry)) {
      miguMod = await import(pathToFileURL(entry).href);
    } else {
      miguMod = await import('migu-api-enhanced');
    }
    log('咪咕 SDK 已加载，导出 ' + Object.keys(miguMod).length + ' 个接口');
  }
  return miguMod;
}

ipcMain.handle('migu:search', async (_e, keywords, page = 1) => {
  try {
    const m = await getMigu();
    return await m.searchSong(keywords, page);
  } catch (e) { log('咪咕搜索失败: ' + e.message); return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:url', async (_e, contentId, copyrightId, toneFlag = 'PQ', resourceType = '2') => {
  try {
    const m = await getMigu();
    // V1/V2 多数情况下不含 url 字段，H5V24 才是稳定返回播放地址的接口
    return await m.getUrlH5V24(contentId, copyrightId, toneFlag, resourceType);
  } catch (e) { log('咪咕取址失败: ' + e.message); return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:searchSinger', async (_e, keywords, page = 1) => {
  try {
    const mod = await getMigu();
    return await mod.searchSinger(keywords, page);
  } catch (e) { log('咪咕歌手搜索失败: ' + e.message); return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:singerAlbum', async (_e, singerId, page = 1) => {
  try {
    const mod = await getMigu();
    return await mod.getSingerAlbum(singerId, page);
  } catch (e) { return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:singerSong', async (_e, singerId, page = 1) => {
  try {
    const mod = await getMigu();
    return await mod.getSingerSong(singerId, page);
  } catch (e) { return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:albumSong', async (_e, albumId, page = 1) => {
  try {
    const mod = await getMigu();
    return await mod.getAlbumSong(albumId, page);
  } catch (e) { return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:searchPlaylist', async (_e, keywords, page = 1) => {
  try {
    const mod = await getMigu();
    return await mod.searchPlaylist(keywords, page);
  } catch (e) { log('咪咕歌单搜索失败: ' + e.message); return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:playlistSong', async (_e, playlistId, page = 1, size = 100) => {
  try {
    const mod = await getMigu();
    return await mod.getPlaylistSong(playlistId, page, size);
  } catch (e) { log('咪咕歌单取歌失败: ' + e.message); return { code: '-1', info: String(e.message) }; }
});

ipcMain.handle('migu:lyric', async (_e, contentId, type = 'lrc') => {
  try {
    const m = await getMigu();
    return await m.getLyric(contentId, type);
  } catch (e) { return { success: false, info: String(e.message) }; }
});

ipcMain.handle('migu:fetchText', async (_e, url) => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return await res.text();
  } catch (e) { return null; }
});

ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('dialog:saveImage', async (_e, dataUrl) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: 'cover.jpg', filters: [{ name: 'Image', extensions: ['jpg','png'] }] });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return filePath;
});

// ------------------------------------------------------------------ 生命周期
app.whenReady().then(async () => {
  API_PORT = await pickFreePort(3300, 3400);
  log('选用端口 ' + API_PORT);
  startApiServer();
  await waitForApi();
  createMainWindow();
  createTray();

  // 媒体键
  const bind = (accel, action) => {
    try { globalShortcut.register(accel, () => mainWin?.webContents.send('hotkey', action)); } catch {}
  };
  bind('MediaPlayPause', 'toggle');
  bind('MediaNextTrack', 'next');
  bind('MediaPreviousTrack', 'prev');
  bind('CommandOrControl+Alt+L', 'lyric');

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; if (apiProc) { try { apiProc.kill(); } catch {} } });
app.on('will-quit', () => globalShortcut.unregisterAll());