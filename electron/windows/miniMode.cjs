/**
 * 迷你模式（S4）。
 *
 * 方案选择：**新建迷你窗 + 隐藏主窗**（题目给的 ②），不是同一窗口 setBounds（①）。
 * 理由（也是实测依据）：
 *  · 本批次的文件边界禁止改 App.vue —— ① 需要主窗口渲染层的条件视图，改不了；
 *  · ② 的音频宿主仍然是主窗口（只 hide，不销毁、不停渲染），播放状态不需要搬迁；
 *  · ② 的尺寸记忆天然简单：进入前把主窗 bounds 存起来，退出时原样还原。
 * 代价：迷你窗是一份独立的极简页面（electron/pages/mini.html），不共享 Vue 组件。
 *
 * 关键前提：主窗 hide() 之后音频必须继续播。
 * main.cjs 已关掉 background-media-suspend / renderer-backgrounding / timer-throttling，
 * 这三条正是为"窗口不可见也要继续放"设的（S3 踩过 AbortError）。
 */
'use strict';

const path = require('node:path');
const { BrowserWindow } = require('electron');
const registry = require('./registry.cjs');

const MINI_WIDTH = 340;
const MINI_HEIGHT = 120;

let miniWin = null;
/** 进入迷你模式前主窗的位置尺寸；退出时原样还原 */
let savedBounds = null;
let preloadPath = '';
let devServerUrl = '';

function configure(options) {
  preloadPath = options.preloadPath;
  devServerUrl = options.devServerUrl || '';
}

/** dev 走 vite 的 mini.html，prod 走 dist/mini.html（vite 第三入口） */
function pageTarget() {
  if (devServerUrl) {
    const base = devServerUrl.endsWith('/') ? devServerUrl : devServerUrl + '/';
    return { kind: 'url', value: base + 'mini.html' };
  }
  return { kind: 'file', value: path.join(__dirname, '..', '..', 'dist', 'mini.html') };
}

function isMini() {
  return Boolean(registry.getMini());
}

function createMiniWindow(mainWin) {
  const saved = mainWin.getBounds();
  savedBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };

  const win = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    minWidth: MINI_WIDTH,
    minHeight: MINI_HEIGHT,
    maxWidth: MINI_WIDTH,
    maxHeight: MINI_HEIGHT,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#14151a',
    title: '网易云音乐 · 迷你',
    // 迷你模式是"应用正在用的窗口"，要留在任务栏里，否则主窗被藏起来后无处可找
    skipTaskbar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const target = pageTarget();
  if (target.kind === 'url') {
    void win.loadURL(target.value);
  } else {
    void win.loadFile(target.value);
  }

  win.once('ready-to-show', () => {
    mainWin.hide();
    // 显示在原来主窗的左上角附近（不强制，用户可拖动）
    win.setPosition(savedBounds.x, savedBounds.y);
    win.show();
    mainWin.webContents.send('mini:enter');
    mainWin.webContents.send('mini:request-state');
  });

  win.on('closed', () => {
    if (registry.getMini() === win) registry.setMini(null);
    miniWin = null;
    restoreMain(mainWin);
  });

  registry.setMini(win);
  miniWin = win;
  return win;
}

function restoreMain(mainWin) {
  const main = mainWin && !mainWin.isDestroyed() ? mainWin : registry.getMain();
  if (!main) return false;
  if (savedBounds) {
    main.setBounds(savedBounds);
    savedBounds = null;
  }
  if (!main.isVisible()) main.show();
  main.focus();
  main.webContents.send('mini:exit');
  return true;
}

function enter(mainWin) {
  const main = mainWin && !mainWin.isDestroyed() ? mainWin : registry.getMain();
  if (!main) return false;
  if (isMini()) return true;
  createMiniWindow(main);
  return true;
}

function exit(mainWin) {
  const win = registry.getMini();
  if (win) {
    // closed 事件里会走 restoreMain；这里先置空引用避免二次还原
    registry.setMini(null);
    miniWin = null;
    win.close();
    return restoreMain(mainWin);
  }
  return restoreMain(mainWin);
}

function send(payload) {
  const win = registry.getMini();
  if (!win || win.webContents.isDestroyed()) return false;
  win.webContents.send('mini:data', payload);
  return true;
}

function destroyMiniWindow() {
  const win = registry.getMini();
  if (win) {
    registry.setMini(null);
    miniWin = null;
    win.destroy();
  }
}

module.exports = {
  configure,
  enter,
  exit,
  isMini,
  send,
  destroyMiniWindow,
  MINI_WIDTH,
  MINI_HEIGHT,
};
