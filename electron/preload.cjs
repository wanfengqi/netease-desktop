/**
 * 新架构 preload（S2）。
 *
 * 安全边界：
 *  - contextIsolation 保持 true，nodeIntegration false；
 *  - 只暴露白名单方法，**不透传 ipcRenderer**，渲染层拿不到任意通道能力；
 *  - 咪咕只能调主进程 FUNCTIONS 白名单里的方法（主进程二次校验）。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 咪咕可调用方法清单 —— 与 electron/services/miguApi.cjs 的 FUNCTIONS 保持一致 */
const MIGU_METHODS = [
  'searchSong', 'searchSinger', 'searchAlbum', 'searchPlaylist',
  'getUrlH5V24', 'getLyric',
  'getSingerSong', 'getSingerAlbum', 'getAlbumSong', 'getPlaylistSong',
  'getSongInfo', 'getAlbumInfo',
  'getTodayRecommend', 'getRankIndex', 'getRecommendPlaylist', 'getNewSongList',
  'getSimilarSongRecommend', 'getSearchHot',
];

const migu = {};
for (const method of MIGU_METHODS) {
  migu[method] = (...args) => ipcRenderer.invoke('migu:call', { method, args });
}

contextBridge.exposeInMainWorld('api', {
  app: {
    versions: () => ipcRenderer.invoke('app:versions'),
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    // S4 迷你模式：隐藏主窗 + 新建迷你窗（见 electron/windows/miniMode.cjs）
    enterMini: () => ipcRenderer.invoke('win:enter-mini'),
    exitMini: () => ipcRenderer.invoke('win:exit-mini'),
    isMini: () => ipcRenderer.invoke('win:is-mini'),
    onMiniData: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('mini:data', listener);
      return () => ipcRenderer.removeListener('mini:data', listener);
    },
    onMiniExit: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('mini:exit', listener);
      return () => ipcRenderer.removeListener('mini:exit', listener);
    },
    // 迷你窗起来后会来要一次当前状态（主窗口收到后把 title/cover/playing 推过去）
    onMiniRequestState: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('mini:request-state', listener);
      return () => ipcRenderer.removeListener('mini:request-state', listener);
    },
    pushMini: (payload) => ipcRenderer.send('mini:push', payload),
  },
  // 迷你窗自己用的通道（cmd → 主窗口，onData ← 主窗口）
  mini: {
    cmd: (command) => ipcRenderer.send('mini:cmd', command),
    requestState: () => ipcRenderer.send('mini:request'),
    onData: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('mini:data', listener);
      return () => ipcRenderer.removeListener('mini:data', listener);
    },
    // 主窗口侧：迷你窗发来的播放指令（同一个 preload 服务三个窗口，方法按需取用）
    onCmd: (handler) => {
      const listener = (_event, command) => handler(command);
      ipcRenderer.on('mini:cmd', listener);
      return () => ipcRenderer.removeListener('mini:cmd', listener);
    },
  },
  // S4 桌面歌词窗：歌词窗与主窗是两个渲染进程，能力都收敛在这组白名单里
  lyric: {
    toggle: () => ipcRenderer.invoke('lyric:toggle'),
    close: () => ipcRenderer.invoke('lyric:close'),
    isOpen: () => ipcRenderer.invoke('lyric:is-open'),
    lock: (locked) => ipcRenderer.invoke('lyric:lock', locked),
    isLocked: () => ipcRenderer.invoke('lyric:is-locked'),
    push: (payload) => ipcRenderer.send('lyric:push', payload),
    cmd: (command) => ipcRenderer.send('lyric:cmd', command),
    request: () => ipcRenderer.send('lyric:request'),
    onData: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('lyric:data', listener);
      return () => ipcRenderer.removeListener('lyric:data', listener);
    },
    onLocked: (handler) => {
      const listener = (_event, locked) => handler(locked);
      ipcRenderer.on('lyric:locked', listener);
      return () => ipcRenderer.removeListener('lyric:locked', listener);
    },
    onCmd: (handler) => {
      const listener = (_event, command) => handler(command);
      ipcRenderer.on('lyric:cmd', listener);
      return () => ipcRenderer.removeListener('lyric:cmd', listener);
    },
    onWindowReady: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('lyric:window-ready', listener);
      return () => ipcRenderer.removeListener('lyric:window-ready', listener);
    },
    onClosed: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('lyric:closed', listener);
      return () => ipcRenderer.removeListener('lyric:closed', listener);
    },
  },
  netease: {
    request: (path, params, cookie) => ipcRenderer.invoke('netease:request', { path, params, cookie }),
    status: () => ipcRenderer.invoke('netease:status'),
  },
  migu: {
    ...migu,
    fetchText: (url) => ipcRenderer.invoke('migu:fetch-text', url),
    status: () => ipcRenderer.invoke('migu:status'),
  },
  dialog: {
    chooseDirectory: (title) => ipcRenderer.invoke('dialog:chooseDir', { title }),
  },
  local: {
    state: () => ipcRenderer.invoke('local:state'),
    addDirectory: (directory) => ipcRenderer.invoke('local:add-directory', directory),
    removeDirectory: (directory) => ipcRenderer.invoke('local:remove-directory', directory),
    scan: (options) => ipcRenderer.invoke('local:scan', options),
    cancel: () => ipcRenderer.invoke('local:cancel'),
    mediaUrl: (localPath) => ipcRenderer.invoke('local:media-url', localPath),
    onProgress: (handler) => { const listener = (_event, payload) => handler(payload); ipcRenderer.on('local:progress', listener); return () => ipcRenderer.removeListener('local:progress', listener); },
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    setDirectory: (directory) => ipcRenderer.invoke('downloads:set-directory', directory),
    start: (items) => ipcRenderer.invoke('downloads:start', items),
    cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
    retry: (id, url) => ipcRenderer.invoke('downloads:retry', id, url),
    remove: (id, deleteFile) => ipcRenderer.invoke('downloads:remove', id, deleteFile),
    onProgress: (handler) => { const listener = (_event, payload) => handler(payload); ipcRenderer.on('downloads:progress', listener); return () => ipcRenderer.removeListener('downloads:progress', listener); },
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (patch) => ipcRenderer.invoke('config:save', patch),
    migrateStatus: () => ipcRenderer.invoke('config:migrate-status'),
  },
});
