/**
 * 桌面歌词窗口（S4）。
 *
 * 参考旧版 src/main.js:createLyricWindow + src/renderer/lyric.html（只读参考，未改旧文件）。
 * 与旧版的差异（都是旧版踩过的坑）：
 *  1. 主窗口关闭/退出时**主动**销毁歌词窗 —— 旧版没有这条，主窗关掉后歌词窗会变成孤儿窗口，
 *     任务栏里看不见、也没有入口能关掉它。
 *  2. skipTaskbar: true 保证歌词窗不占任务栏（旧版已设，这里显式写清理由）。
 *  3. 锁定用 setIgnoreMouseEvents(true, { forward: true })，并额外注册一个全局快捷键
 *     Cmd/Ctrl+Alt+L 解锁 —— 鼠标穿透之后窗口自己收不到点击，没有这条路就永久锁死（旧版的缺陷）。
 */
'use strict';

const path = require('node:path');
const { BrowserWindow, globalShortcut } = require('electron');
const registry = require('../windows/registry.cjs');

const LOCK_SHORTCUT = 'CommandOrControl+Alt+L';

let lyricWin = null;
let locked = false;
let devServerUrl = '';
let preloadPath = '';

function configure(options) {
  devServerUrl = options.devServerUrl || '';
  preloadPath = options.preloadPath;
}

function isOpen() {
  return Boolean(registry.getLyric());
}

function isLocked() {
  return locked;
}

/** 歌词窗的页面地址：dev 走 vite，prod 走 dist/lyric.html（vite 多入口产物） */
function pageTarget() {
  if (devServerUrl) {
    const base = devServerUrl.endsWith('/') ? devServerUrl : devServerUrl + '/';
    return { kind: 'url', value: base + 'lyric.html' };
  }
  return { kind: 'file', value: path.join(__dirname, '..', '..', 'dist', 'lyric.html') };
}

function applyLock(next) {
  const win = registry.getLyric();
  locked = Boolean(next);
  if (win) {
    // forward: true —— 锁定后仍把鼠标移动事件转发给窗口，工具栏才能浮出来（只是收不到点击）
    win.setIgnoreMouseEvents(locked, { forward: true });
  }
  if (locked) {
    if (!globalShortcut.isRegistered(LOCK_SHORTCUT)) {
      globalShortcut.register(LOCK_SHORTCUT, () => applyLock(false));
    }
  } else {
    globalShortcut.unregister(LOCK_SHORTCUT);
  }
  return locked;
}

function createLyricWindow(mainWin) {
  const existing = registry.getLyric();
  if (existing) {
    existing.show();
    return existing;
  }

  const win = new BrowserWindow({
    width: 820,
    height: 150,
    minWidth: 320,
    minHeight: 90,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    // 不占任务栏：桌面歌词是"贴在桌面上的一层字"，不是应用窗口
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 歌词要跟着 500ms 一次的进度更新，被遮挡时不能降频
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' 层级高于普通置顶，能压在多数全屏应用之上（旧版同做法）
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setSkipTaskbar(true);

  const target = pageTarget();
  if (target.kind === 'url') {
    void win.loadURL(target.value);
  } else {
    void win.loadFile(target.value);
  }

  win.once('ready-to-show', () => {
    win.show();
    // 主窗口关闭后歌词窗不许活下来（见文件头第 1 条）
    const main = registry.getMain();
    if (main) {
      main.once('closed', () => destroyLyricWindow());
    }
    main?.webContents.send('lyric:window-ready');
  });

  win.on('closed', () => {
    registry.clearLyric(win);
    applyLock(false);
    const main = registry.getMain();
    main?.webContents.send('lyric:closed');
  });

  registry.setLyric(win);
  lyricWin = win;
  return win;
}

function closeLyricWindow() {
  const win = registry.getLyric();
  if (win) win.close();
}

function destroyLyricWindow() {
  const win = registry.getLyric();
  if (win) {
    // 主窗口已关，不能再走 close()（可能触发 'closed' 里的 mainWin 通知链），直接销毁
    win.destroy();
  }
}

function toggleLyricWindow(mainWin) {
  if (isOpen()) {
    closeLyricWindow();
    return false;
  }
  createLyricWindow(mainWin);
  return true;
}

function send(payload) {
  const win = registry.getLyric();
  if (!win || win.webContents.isDestroyed()) return false;
  win.webContents.send('lyric:data', payload);
  return true;
}

function dispose() {
  globalShortcut.unregister(LOCK_SHORTCUT);
}

module.exports = {
  configure,
  createLyricWindow,
  closeLyricWindow,
  destroyLyricWindow,
  toggleLyricWindow,
  isOpen,
  isLocked,
  applyLock,
  send,
  dispose,
  LOCK_SHORTCUT,
};
