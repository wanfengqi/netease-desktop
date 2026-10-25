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
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (patch) => ipcRenderer.invoke('config:save', patch),
    migrateStatus: () => ipcRenderer.invoke('config:migrate-status'),
  },
});
