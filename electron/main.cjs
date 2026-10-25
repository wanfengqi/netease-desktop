// 新架构的主进程入口（S0 骨架）。
// 与旧版 src/main.js 完全独立：旧版仍由 `npm start` 使用，本文件仅供 `npm run dev`。
// 注意：本文件不做 CommonJS -> ESM 迁移（S0 不做），扩展名固定 .cjs。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

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
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 渲染层自己画标题栏，先保留原生边框以免新壳不可拖动
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

function registerIpc() {
  ipcMain.handle('app:versions', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    app: app.getVersion(),
  }));

  ipcMain.handle('win:minimize', () => {
    mainWin?.minimize();
  });

  ipcMain.handle('win:toggle-maximize', () => {
    if (!mainWin) return false;
    if (mainWin.isMaximized()) {
      mainWin.unmaximize();
      return false;
    }
    mainWin.maximize();
    return true;
  });

  ipcMain.handle('win:close', () => {
    mainWin?.close();
  });

  ipcMain.handle('win:is-maximized', () => Boolean(mainWin?.isMaximized()));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
