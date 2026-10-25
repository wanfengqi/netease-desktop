/**
 * 咪咕音乐服务（S2）。
 *
 * migu-api-enhanced 是 ESM 包（dist/index.mjs，377 个导出里的 110 个 API），
 * 而主进程是 CJS —— 因此**禁止顶层 require**，一律 await import() 懒加载。
 * 加载一次后缓存 module 对象，失败时清空缓存允许重试。
 *
 * 安全边界：渲染层不能直呼任意导出，只能调 FUNCTIONS 白名单里的方法，
 * 且参数个数/类型在主进程校验后再转发。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** 白名单：IPC 方法名 -> { fn: SDK 导出名, args: 参数名列表（仅用于文档与校验） } */
const FUNCTIONS = {
  searchSong: { fn: 'searchSong', args: ['keywords', 'page'] },
  searchSinger: { fn: 'searchSinger', args: ['keywords', 'page'] },
  searchAlbum: { fn: 'searchAlbum', args: ['keywords', 'page'] },
  searchPlaylist: { fn: 'searchPlaylist', args: ['keywords', 'page'] },
  getUrlH5V24: { fn: 'getUrlH5V24', args: ['contentId', 'copyrightId', 'toneFlag'] },
  getLyric: { fn: 'getLyric', args: ['contentId', 'type'] },
  getSingerSong: { fn: 'getSingerSong', args: ['singerId', 'page'] },
  getSingerAlbum: { fn: 'getSingerAlbum', args: ['singerId', 'page'] },
  getAlbumSong: { fn: 'getAlbumSong', args: ['albumId', 'page'] },
  getPlaylistSong: { fn: 'getPlaylistSong', args: ['playlistId', 'page', 'size'] },
  getSongInfo: { fn: 'getSongInfo', args: ['contentIds'] },
  getAlbumInfo: { fn: 'getAlbumInfo', args: ['albumId'] },
  getTodayRecommend: { fn: 'getTodayRecommend', args: ['pacmToken'] },
  getRankIndex: { fn: 'getRankIndex', args: [] },
  getRecommendPlaylist: { fn: 'getRecommendPlaylist', args: [] },
  getNewSongList: { fn: 'getNewSongList', args: [] },
  getSimilarSongRecommend: { fn: 'getSimilarSongRecommend', args: ['contentId'] },
  getSearchHot: { fn: 'getSearchHot', args: [] },
};

let mod = null;
let loading = null;
let loadError = '';

function log(...args) {
  console.log('[migu]', ...args);
}

/** 打包后 SDK 在 asar.unpacked 里，动态 import 需要绝对 file URL */
function candidateEntries(appPath) {
  const out = [];
  if (typeof appPath === 'string' && appPath) {
    out.push(path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'migu-api-enhanced', 'dist', 'index.mjs'));
  }
  out.push(path.join(__dirname, '..', '..', 'node_modules', 'migu-api-enhanced', 'dist', 'index.mjs'));
  return out;
}

async function getModule(appPath) {
  if (mod) return mod;
  if (loading) return loading;
  loading = (async () => {
    try {
      for (const entry of candidateEntries(appPath)) {
        if (fs.existsSync(entry)) {
          mod = await import(pathToFileURL(entry).href);
          log('SDK 已加载（unpacked 路径），导出 ' + Object.keys(mod).length + ' 个');
          return mod;
        }
      }
      mod = await import('migu-api-enhanced');
      log('SDK 已加载（包名解析），导出 ' + Object.keys(mod).length + ' 个');
      return mod;
    } catch (err) {
      loadError = String(err && err.message);
      log('SDK 加载失败: ' + loadError);
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * 调用白名单内的方法。
 * @param {string} method
 * @param {unknown[]} args
 * @param {string} [appPath]
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
 */
async function call(method, args, appPath) {
  const spec = FUNCTIONS[method];
  if (!spec) return { ok: false, error: '未授权的方法: ' + String(method) };
  const list = Array.isArray(args) ? args : [];
  try {
    const sdk = await getModule(appPath);
    const fn = sdk[spec.fn];
    if (typeof fn !== 'function') return { ok: false, error: 'SDK 缺少导出: ' + spec.fn };
    const data = await fn.apply(sdk, list);
    return { ok: true, data };
  } catch (err) {
    log(method + ' 失败: ' + (err && err.message));
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/** 拉纯文本（咪咕 lrcUrl 是文本地址）。只允许 http(s)，避免 file:// 读取本地文件。 */
async function fetchText(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: '只允许 http(s) 地址' };
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
}

function status() {
  return {
    loaded: Boolean(mod),
    loadError,
    methods: Object.keys(FUNCTIONS),
    exportCount: mod ? Object.keys(mod).length : 0,
  };
}

module.exports = { call, fetchText, status, FUNCTIONS };
