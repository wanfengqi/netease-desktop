const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close:    () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  },
  api: (path, params, cookie) => ipcRenderer.invoke('api:fetch', { path, params, cookie }),
  theme: {
    load: () => ipcRenderer.invoke('theme:load'),
    save: (t) => ipcRenderer.invoke('theme:save', t),
    pushToLyric: (theme) => ipcRenderer.send('lyric:theme', theme),
  },
  lyric: {
    toggle: () => ipcRenderer.invoke('lyric:toggle'),
    lock: (v) => ipcRenderer.invoke('lyric:lock', v),
    push: (payload) => ipcRenderer.send('lyric:push', payload),
    onData: (cb) => ipcRenderer.on('lyric:data', (_e, d) => cb(d)),
    onTheme: (cb) => ipcRenderer.on('lyric:theme', (_e, d) => cb(d)),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (p) => ipcRenderer.invoke('config:set', p),
  },
  migu: {
    search: (kw, page) => ipcRenderer.invoke('migu:search', kw, page),
    url: (cid, copyId, tone, rt) => ipcRenderer.invoke('migu:url', cid, copyId, tone, rt),
    searchSinger: (kw, page) => ipcRenderer.invoke('migu:searchSinger', kw, page),
    singerAlbum: (sid, page) => ipcRenderer.invoke('migu:singerAlbum', sid, page),
    singerSong: (sid, page) => ipcRenderer.invoke('migu:singerSong', sid, page),
    albumSong: (aid, page) => ipcRenderer.invoke('migu:albumSong', aid, page),
    searchPlaylist: (kw, page) => ipcRenderer.invoke('migu:searchPlaylist', kw, page),
    playlistSong: (pid, page, size) => ipcRenderer.invoke('migu:playlistSong', pid, page, size),
    lyric: (cid, type) => ipcRenderer.invoke('migu:lyric', cid, type),
    fetchText: (u) => ipcRenderer.invoke('migu:fetchText', u),
  },
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, a) => cb(a)),
  openExternal: (u) => ipcRenderer.invoke('shell:open', u),
});