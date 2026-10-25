'use strict';
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const media = require('./localMedia.cjs');
function safeName(value) { const cleaned = String(value || '未命名').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.{2,}/g, '_').replace(/[. ]+$/g, '').slice(0, 100); return cleaned && cleaned !== '.' && !/_+$/.test(cleaned) ? cleaned : '未命名'; }
function safeExtension(value) { const ext = String(value || '').toLowerCase(); return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.audio'; }
function errorMessage(error) { return error && error.message ? error.message : String(error); }
class Downloads {
  constructor() { this.records = new Map(); this.controllers = new Map(); this.listeners = new Set(); this.running = 0; this.pending = []; this.directory = ''; }
  init(userData) { this.userData = userData; this.file = path.join(userData, 'next-downloads.json'); }
  async load() {
    let saved = { directory: '', records: [] };
    try { saved = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.warn('[downloads] load failed', error.message); }
    this.directory = typeof saved.directory === 'string' ? saved.directory : '';
    const rows = Array.isArray(saved.records) ? saved.records : [];
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.song || typeof row.localPath !== 'string') continue;
      const record = { ...row, status: row.status === 'completed' ? 'completed' : 'failed', error: row.status === 'completed' ? '' : '上次启动前下载中断，请重试', received: 0 };
      if (record.status === 'completed') media.registerFile(record.localPath);
      this.records.set(record.id, record);
    }
    return this.list();
  }
  list() { return { ok: true, directory: this.directory, records: Array.from(this.records.values()) }; }
  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(record) { const { urlForRun, ...safeRecord } = record; for (const fn of this.listeners) fn({ ok: true, record: { ...safeRecord } }); }
  async setDirectory(directory) {
    const resolved = path.resolve(directory); const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('下载路径不是目录');
    this.directory = resolved; await this.save(); return this.list();
  }
  targetFor(song, directory = this.directory, url = '') {
    if (!directory) throw new Error('请先选择下载目录');
    const urlExt = path.extname(new URL(url, 'http://download.invalid').pathname);
    const ext = safeExtension(song.format || urlExt || '.audio');
    return path.join(path.resolve(directory), safeName(song.artistText) + ' - ' + safeName(song.name) + ext);
  }
  enqueue(items, directory = this.directory) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('没有可下载的歌曲');
    const added = [];
    for (const item of items) {
      if (!item || !item.song || typeof item.url !== 'string') throw new Error('下载参数不完整');
      const parsed = new URL(item.url); if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只允许 HTTP(S) 下载地址');
      const id = item.song.source + ':' + String(item.song.id);
      const old = this.records.get(id);
      if (old && (old.status === 'downloading' || old.status === 'queued')) continue;
      let target = this.targetFor(item.song, directory, item.url);
      const collision = Array.from(this.records.values()).find((record) => record.id !== id && record.localPath === target);
      if (collision) target = target.slice(0, -path.extname(target).length) + ' [' + safeName(id) + ']' + path.extname(target);
      const record = { id, song: { ...item.song, localPath: target }, status: 'queued', progress: 0, received: 0, total: 0, localPath: target, size: 0, sha256: '', error: '', createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
      this.records.set(id, record); this.pending.push(record); added.push(record); this.notify(record);
    }
    void this.save(); return { ...this.list(), added };
  }
  retry(id, url) {
    const record = this.records.get(id); if (!record) throw new Error('下载记录不存在');
    return this.start([{ song: record.song, url }]);
  }
  pump() {
    while (this.running < 2 && this.pending.length > 0) {
      const record = this.pending.shift(); if (!record || this.records.get(record.id)?.status !== 'queued') continue;
      this.running += 1;
      void this.download(record).catch((error) => this.fail(record, errorMessage(error))).finally(() => { this.running -= 1; this.pump(); });
    }
  }
  start(items, directory) { const urls = new Map(items.map((x) => [x.song.source + ':' + String(x.song.id), x.url])); const result = this.enqueue(items, directory); for (const record of result.added) record.urlForRun = urls.get(record.id); this.pump(); return result; }
  async download(record) {
    record.status = 'downloading'; record.error = ''; record.updatedAt = Date.now(); this.notify(record); await this.save();
    const controller = new AbortController(); this.controllers.set(record.id, controller);
    const temp = record.localPath + '.part-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    let handle;
    try {
      await fs.mkdir(path.dirname(record.localPath), { recursive: true });
      const response = await this.request(record.urlForRun, controller.signal);
      try {
        if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); throw new Error('HTTP ' + response.statusCode); }
        const length = Number(response.headers['content-length'] || 0); record.total = Number.isFinite(length) && length > 0 ? length : 0; this.notify(record);
        const hash = crypto.createHash('sha256'); let received = 0;
        response.on('data', (chunk) => { received += chunk.length; hash.update(chunk); record.received = received; record.progress = record.total > 0 ? Math.min(1, received / record.total) : 0; this.notify(record); });
        await pipeline(response, createWriteStream(temp, { flags: 'wx' }));
        if (received === 0) throw new Error('下载内容为空');
        if (record.total > 0 && received !== record.total) throw new Error('下载不完整：' + received + '/' + record.total);
        handle = await fs.open(temp, 'r+');
        await handle.sync(); await handle.close(); handle = undefined;
        if (controller.signal.aborted) throw new Error('DOWNLOAD_CANCELLED');
        await fs.rename(temp, record.localPath);
        record.status = 'completed'; record.progress = 1; record.received = received; record.size = received; record.sha256 = hash.digest('hex'); record.song = { ...record.song, localPath: record.localPath }; record.updatedAt = Date.now();
        media.registerFile(record.localPath); delete record.urlForRun; this.notify(record); await this.save();
      } finally { response.destroy(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
      delete record.urlForRun;
      if (controller.signal.aborted || error.message === 'DOWNLOAD_CANCELLED') { record.status = 'cancelled'; record.error = '已取消'; record.updatedAt = Date.now(); this.notify(record); await this.save(); }
      else throw error;
    } finally { this.controllers.delete(record.id); }
  }
  request(url, signal) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const request = client.get(url, { signal, headers: { 'User-Agent': 'netease-desktop/1.0' } }, resolve);
      request.once('error', reject);
    });
  }
  async fail(record, message) { delete record.urlForRun; record.status = 'failed'; record.error = message; record.updatedAt = Date.now(); this.notify(record); await this.save(); }
  cancel(id) { const record = this.records.get(id); if (!record) return false; if (record.status === 'queued') { record.status = 'cancelled'; record.error = '已取消'; this.notify(record); void this.save(); return true; } const controller = this.controllers.get(id); if (!controller) return false; controller.abort(); return true; }
  async remove(id, deleteFile) {
    const record = this.records.get(id); if (!record) throw new Error('下载记录不存在');
    if (this.controllers.has(id) || record.status === 'queued') throw new Error('请先取消下载');
    if (deleteFile) { await fs.unlink(record.localPath).catch((error) => { if (error.code !== 'ENOENT') throw error; }); media.unregisterFile(record.localPath); }
    this.records.delete(id); await this.save(); return this.list();
  }
  async idle() { while (this.running > 0 || this.pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 10)); }
  async save() { const previous = this.saving || Promise.resolve(); const next = previous.then(async () => { await fs.mkdir(this.userData, { recursive: true }); const temp = this.file + '.' + process.pid + '.tmp'; const records = Array.from(this.records.values()).map(({ urlForRun, ...record }) => record); await fs.writeFile(temp, JSON.stringify({ version: 1, directory: this.directory, records }, null, 2), 'utf8'); await fs.rename(temp, this.file); }); this.saving = next.catch(() => {}); return next; }
}
module.exports = { Downloads, safeName, safeExtension };
