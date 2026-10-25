'use strict';
const { dialog } = require('electron');
const { LocalLibrary } = require('../services/localLibrary.cjs');
const { Downloads } = require('../services/downloads.cjs');
const media = require('../services/localMedia.cjs');
const library = new LocalLibrary();
const downloads = new Downloads();
function ok(promise) { return Promise.resolve(promise).catch((error) => ({ ok: false, error: error.message || String(error) })); }
async function registerAll(getWindow) {
  library.init(require('electron').app.getPath('userData'));
  downloads.init(require('electron').app.getPath('userData'));
  const { ipcMain } = require('electron');
  await Promise.all([library.load(), downloads.load()]);
  library.onProgress((progress) => getWindow()?.webContents.send('local:progress', progress));
  downloads.onProgress((payload) => getWindow()?.webContents.send('downloads:progress', payload));
  ipcMain.handle('dialog:chooseDir', async (_event, options) => { const result = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory', 'createDirectory'], title: options?.title || '选择目录' }); return result.canceled ? null : result.filePaths[0] || null; });
  ipcMain.handle('local:state', () => library.state());
  ipcMain.handle('local:add-directory', (_event, directory) => ok(library.addDirectory(directory)));
  ipcMain.handle('local:remove-directory', (_event, directory) => ok(library.removeDirectory(directory)));
  ipcMain.handle('local:scan', (_event, options) => ok(library.scan(options)));
  ipcMain.handle('local:cancel', () => library.cancel());
  ipcMain.handle('local:media-url', (_event, filePath) => { for (const song of library.songs.values()) if (song.localPath === filePath) return media.mediaUrl(filePath); for (const record of downloads.records.values()) if (record.status === 'completed' && record.localPath === filePath) return media.mediaUrl(filePath); return null; });
  ipcMain.handle('downloads:list', () => downloads.list());
  ipcMain.handle('downloads:set-directory', (_event, directory) => ok(downloads.setDirectory(directory)));
  ipcMain.handle('downloads:start', (_event, items) => ok(downloads.start(items)));
  ipcMain.handle('downloads:cancel', (_event, id) => downloads.cancel(id));
  ipcMain.handle('downloads:retry', (_event, id, url) => ok(downloads.retry(id, url)));
  ipcMain.handle('downloads:remove', (_event, id, deleteFile) => ok(downloads.remove(id, Boolean(deleteFile))));
  return { local: library, downloads };
}
module.exports = { registerAll, library, downloads };
