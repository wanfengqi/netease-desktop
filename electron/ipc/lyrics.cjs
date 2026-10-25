/**
 * 桌面歌词 / 迷你模式的 IPC（S4）。
 *
 * 通道分工（三端：主窗口 / 歌词窗 / 迷你窗，注意两边都是**渲染进程**，不共享内存）：
 *   主窗口 → 主进程 → 歌词窗：lyric:push（track 行集 / tick 进度）、lyric:locked
 *   歌词窗 → 主进程 → 主窗口：lyric:cmd（toggle / prev / next / offset- / offset+ / close）
 *   主窗口 → 主进程 → 迷你窗：mini:push（title / artist / cover / playing / progress）
 *   迷你窗 → 主进程 → 主窗口：mini:cmd（toggle / prev / next）
 *   主进程 → 主窗口：lyric:window-ready / lyric:closed / mini:enter / mini:exit / mini:request-state
 *
 * 所有 handler 返回结构化值，不抛异常（与 electron/ipc/index.cjs 的约定一致）。
 */
'use strict';

const { ipcMain } = require('electron');
const registry = require('../windows/registry.cjs');
const lyric = require('../windows/lyricWin.cjs');
const mini = require('../windows/miniMode.cjs');

let registered = false;

/** 主窗口存在且渲染层还活着时才转发，避免窗口销毁瞬间的 "Object has been destroyed" */
function sendToMain(channel, payload) {
  const main = registry.getMain();
  if (!main || main.webContents.isDestroyed()) return false;
  main.webContents.send(channel, payload);
  return true;
}

function registerLyric() {
  ipcMain.handle('lyric:toggle', () => lyric.toggleLyricWindow(registry.getMain()));

  ipcMain.handle('lyric:close', () => {
    lyric.closeLyricWindow();
    return false;
  });

  ipcMain.handle('lyric:is-open', () => lyric.isOpen());

  ipcMain.handle('lyric:lock', (_event, locked) => lyric.applyLock(Boolean(locked)));

  ipcMain.handle('lyric:is-locked', () => lyric.isLocked());

  ipcMain.on('lyric:push', (_event, payload) => {
    lyric.send(payload);
  });

  ipcMain.on('lyric:cmd', (_event, cmd) => {
    sendToMain('lyric:cmd', cmd);
  });

  ipcMain.on('lyric:request', () => {
    sendToMain('lyric:window-ready');
  });
}

function registerMini() {
  ipcMain.handle('win:enter-mini', () => mini.enter(registry.getMain()));
  ipcMain.handle('win:exit-mini', () => mini.exit(registry.getMain()));
  ipcMain.handle('win:is-mini', () => mini.isMini());

  ipcMain.on('mini:push', (_event, payload) => {
    mini.send(payload);
  });

  ipcMain.on('mini:cmd', (_event, cmd) => {
    sendToMain('mini:cmd', cmd);
  });

  ipcMain.on('mini:request', () => {
    sendToMain('mini:request-state');
  });

  // 迷你窗存在时，主窗口的播放状态变化要转发过去（由主窗口主动 push，这里只做脏转发）
  ipcMain.on('mini:sync', (_event, payload) => {
    mini.send(payload);
  });
}

function registerAll() {
  if (registered) return { registered: false, domains: [] };
  registered = true;
  registerLyric();
  registerMini();
  return { registered: true, domains: ['lyric', 'win-mode'] };
}

module.exports = { registerAll };
