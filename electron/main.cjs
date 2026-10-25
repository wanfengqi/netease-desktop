/**
 * 新架构主进程入口（S2）。
 *
 * 本文件只做三件事：应用生命周期、创建窗口、把各个域的 IPC 注册起来。
 * 具体能力全部在 electron/services/* 与 electron/storage/* 里：
 *   - 网易云：services/neteaseApi.cjs（子进程 + 端口 + 健康等待 + 代理）
 *   - 咪咕：services/miguApi.cjs（ESM 懒加载 + 白名单）
 *   - 配置：storage/config.cjs（新格式 + 旧 config.json 一次性迁移）
 *
 * 与旧版 src/main.js 完全独立：旧版仍由 `npm start` 使用，本文件仅供 `npm run dev`。
 * 注意：本文件不做 CommonJS -> ESM 迁移，扩展名固定 .cjs。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

/**
 * 后台媒体不能被节流（S3 实测踩到）。
 *
 * 现象：窗口被别的窗口遮住时，页面 visibilityState 变 hidden，
 * Chromium 会主动暂停媒体进程，play() 抛
 *   AbortError: "video-only background media was paused to save power"，
 * 于是"点了歌但没声音"。音乐播放器恰恰要求"最小化/被遮挡也继续放"，
 * 所以必须在 app ready 之前关掉这些开关（之后设置无效）。
 */
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// 注意：不要加 disable-backgrounding-occluded-windows，那会改变窗口遮挡语义，
// 只关媒体挂起就够（见上面三条）。

const netease = require('./services/neteaseApi.cjs');
const config = require('./storage/config.cjs');
const { registerAll } = require('./ipc/index.cjs');

// 与旧版共用同一个 userData 目录名 —— 迁移要能读到旧的 config.json；
// 但配置文件本身分开（next-config.json vs config.json），互不覆盖。
app.setName('netease-desktop');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const IS_DEV = Boolean(DEV_SERVER_URL);
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 520,
    backgroundColor: '#14151a',
    title: '网易云音乐 · 重构版',
    show: false,
    // S3：渲染层自绘标题栏（TitleBar.vue），因此去掉原生边框。
    // 拖拽靠 -webkit-app-region: drag，按钮靠 no-drag —— 见 TitleBar.vue 注释。
    frame: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 遮挡/最小化时也不要降频定时器与媒体（同上，音乐播放器的基本要求）
      backgroundThrottling: false,
    },
  });

  // 无边框窗口：拖拽带与 no-drag 减法由渲染层负责
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => {
    mainWin = null;
  });

  if (IS_DEV) {
    mainWin.loadURL(DEV_SERVER_URL);
  } else {
    mainWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  console.log('[main] window created, dev=' + IS_DEV + ', url=' + (IS_DEV ? DEV_SERVER_URL : 'dist/index.html'));
}

/** 联网能力预热：在窗口出现前后台拉起 API 子进程，失败只记日志不影响启动 */
async function warmup() {
  try {
    config.init(app.getPath('userData'));
    const before = config.migrateReport();
    // 主动 load 一次：首次启动要在这里完成旧 config.json -> next-config.json 的迁移，
    // 不能等渲染层第一次调 config:load 才发生（那时窗口已经在画了）。
    config.load();
    const after = config.migrateReport();
    console.log('[main] config file=' + config.nextPath() +
      ' before=' + before.status + ' after=' + after.status);
  } catch (err) {
    console.warn('[main] 配置初始化失败: ' + err.message);
  }

  const ok = await netease.ensureReady(app.getAppPath()).catch(() => false);
  const st = netease.status();
  console.log('[main] netease api ready=' + ok + ' port=' + st.port + ' pid=' + st.pid);
}

app.whenReady().then(() => {
  registerAll();
  createWindow();
  void warmup();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  netease.stop();
});
