/**
 * IPC 注册表（S2）：按域分组注册，main.cjs 只调用 registerAll()。
 *
 * 域：
 *   app   —— 版本信息
 *   win   —— 窗口控制（S0 已存在的 5 个，行为保持不变）
 *   netease —— 网易云代理请求 + 服务状态
 *   migu  —— 咪咕 SDK 白名单调用
 *   config —— 新配置读写 + 迁移状态
 *
 * 约定：所有 handler 都返回结构化对象而不是抛异常 —— 渲染层拿到的是
 * { ok, ... }，这样 transport 层能统一处理错误而不用区分传输失败与业务失败。
 */
'use strict';

const { app, ipcMain } = require('electron');
const netease = require('../services/neteaseApi.cjs');
const migu = require('../services/miguApi.cjs');
const config = require('../storage/config.cjs');

/** 每个域注册一次，重复 registerAll 会被这里挡住（热重载/多窗口安全） */
let registered = false;

function getWindow() {
  const { BrowserWindow } = require('electron');
  const wins = BrowserWindow.getAllWindows();
  return wins.length > 0 ? wins[0] : null;
}

function registerApp() {
  ipcMain.handle('app:versions', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    app: app.getVersion(),
  }));
}

function registerWin() {
  ipcMain.handle('win:minimize', () => {
    getWindow()?.minimize();
  });

  ipcMain.handle('win:toggle-maximize', () => {
    const win = getWindow();
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  ipcMain.handle('win:close', () => {
    getWindow()?.close();
  });

  ipcMain.handle('win:is-maximized', () => Boolean(getWindow()?.isMaximized()));
}

function registerNetease() {
  ipcMain.handle('netease:request', async (_event, payload) => {
    const req = payload && typeof payload === 'object' ? payload : {};
    return netease.request({
      path: req.path,
      params: req.params,
      cookie: req.cookie,
      timeoutMs: req.timeoutMs,
    });
  });

  ipcMain.handle('netease:status', () => netease.status());
}

function registerMigu() {
  ipcMain.handle('migu:call', async (_event, payload) => {
    const req = payload && typeof payload === 'object' ? payload : {};
    return migu.call(req.method, req.args, app.getAppPath());
  });

  ipcMain.handle('migu:fetch-text', (_event, url) => migu.fetchText(url));

  ipcMain.handle('migu:status', () => migu.status());
}

function registerConfig() {
  ipcMain.handle('config:load', () => config.load());
  ipcMain.handle('config:save', (_event, patch) => config.save(patch));
  ipcMain.handle('config:migrate-status', () => config.migrateReport());
}

/**
 * 一次性注册所有域。
 * @param {{ registerWindow?: boolean }} [opts] 保留开关，便于将来分窗口裁剪
 */
function registerAll(opts = {}) {
  const shortcuts = opts.shortcuts;
  if (shortcuts) {
    ipcMain.handle('shortcuts:status', () => shortcuts.getStatus());
    ipcMain.handle('shortcuts:set-lyric', (_event, value) => shortcuts.setLyric(value));
  }
  if (opts.tray) ipcMain.handle('tray:status', () => opts.tray);
  if (registered) return { registered: false, domains: [] };
  registered = true;
  registerApp();
  if (opts.registerWindow !== false) registerWin();
  registerNetease();
  registerMigu();
  registerConfig();
  return { registered: true, domains: ['app', 'win', 'netease', 'migu', 'config', 'local', 'downloads'] };
}

module.exports = { registerAll };
