/**
 * 窗口注册表（S4）。
 *
 * 为什么需要：ipc 里原先用 BrowserWindow.getAllWindows()[0] 当"主窗口"。
 * S4 多了桌面歌词窗，它可能排在第 0 位 —— 那样"最小化/关闭"会砸到歌词窗上，
 * 关主窗口时也会把歌词窗当成主窗口。窗口引用必须显式持有，不做位置猜测。
 */
'use strict';

let mainWin = null;
let lyricWin = null;
let miniWin = null;

function setMain(win) {
  mainWin = win;
}

function getMain() {
  if (mainWin && !mainWin.isDestroyed()) return mainWin;
  return null;
}

function setLyric(win) {
  lyricWin = win;
}

function getLyric() {
  if (lyricWin && !lyricWin.isDestroyed()) return lyricWin;
  return null;
}

function clearLyric(win) {
  if (lyricWin === win) lyricWin = null;
}

function setMini(win) {
  miniWin = win;
}

function getMini() {
  if (miniWin && !miniWin.isDestroyed()) return miniWin;
  return null;
}

module.exports = { setMain, getMain, setLyric, getLyric, clearLyric, setMini, getMini };
