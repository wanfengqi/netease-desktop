'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const mm = require('music-metadata');
const media = require('./localMedia.cjs');
const EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.ape']);
const SKIPPED = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'appdata']);
function fallback(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const split = base.split(/\s+-\s+/, 2);
  return { name: split.length === 2 ? split[1] : base, artistText: split.length === 2 ? split[0] : '未知歌手' };
}
async function atomicWrite(file, value) {
  const temp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}
class LocalLibrary {
  constructor() { this.userData = ''; this.directories = []; this.songs = new Map(); this.cache = new Map(); this.progressListeners = new Set(); this.active = null; }
  init(userData) { this.userData = userData; this.file = path.join(userData, 'next-local-library.json'); }
  async load() {
    let saved = { directories: [], songs: [] };
    try { saved = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.warn('[local] load failed', error.message); }
    this.directories = Array.isArray(saved.directories) ? saved.directories.filter((x) => typeof x === 'string') : [];
    this.songs = new Map(Array.isArray(saved.songs) ? saved.songs.filter((x) => x && typeof x.localPath === 'string').map((x) => [x.localPath, x]) : []);
    this.cache = new Map(Array.from(this.songs).map(([p, s]) => [p, { mtimeMs: s.mtimeMs, size: s.size, song: s }]));
    for (const p of this.songs.keys()) media.registerFile(p);
    return this.state();
  }
  state() { return { ok: true, directories: [...this.directories], songs: Array.from(this.songs.values()), scanning: Boolean(this.active), progress: this.active?.progress ?? null }; }
  onProgress(fn) { this.progressListeners.add(fn); return () => this.progressListeners.delete(fn); }
  emit(progress) { if (this.active) this.active.progress = progress; for (const fn of this.progressListeners) fn({ ok: true, ...progress }); }
  async addDirectory(directory) {
    const resolved = path.resolve(directory);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('所选路径不是目录');
    if (!this.directories.includes(resolved)) this.directories.push(resolved);
    await this.save(); return this.state();
  }
  async removeDirectory(directory) {
    this.directories = this.directories.filter((x) => x !== directory);
    for (const song of this.songs.values()) if (this.inRoots(song.localPath, [directory])) { this.songs.delete(song.localPath); this.cache.delete(song.localPath); media.unregisterFile(song.localPath); }
    await this.save(); return this.state();
  }
  inRoots(file, roots) { return roots.some((root) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }); }
  async scan(options = {}) {
    if (this.active) throw new Error('已有扫描正在进行');
    const roots = Array.isArray(options.directories) ? options.directories : this.directories;
    const active = this.active = { cancelled: false, progress: null };
    const seen = new Set(); const failures = []; let parsed = 0; let reused = 0; let scanned = 0; let failed = 0; let total = 0;
    try {
      for (const root of roots) {
        const files = []; await this.walk(path.resolve(root), files, 0, options.maxDepth ?? 6, active);
        total += files.length;
        for (const file of files) {
          if (active.cancelled) throw new Error('SCAN_CANCELLED');
          seen.add(file);
          const stat = await fs.stat(file);
          const previous = this.cache.get(file);
          let song;
          if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) { song = previous.song; reused += 1; }
          else {
            try { song = await this.parse(file, stat, options.cover !== false); parsed += 1; }
            catch (error) { failed += 1; failures.push({ path: file, error: error.message }); this.songs.delete(file); this.cache.delete(file); scanned += 1; this.emit({ current: scanned, total, parsed, reused, failed, cancelled: false }); continue; }
          }
          this.songs.set(file, song); this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, song }); media.registerFile(file);
          scanned += 1; this.emit({ current: scanned, total, parsed, reused, failed, cancelled: false });
        }
      }
      for (const existing of Array.from(this.songs.keys())) if (!active.cancelled && this.inRoots(existing, roots) && !seen.has(existing)) { this.songs.delete(existing); this.cache.delete(existing); media.unregisterFile(existing); }
      await this.save();
      const result = { ...this.state(), songs: Array.from(this.songs.values()).filter((s) => seen.has(s.localPath)), scanned, total, parsed, reused, failed, failures, cancelled: false };
      return result;
    } catch (error) {
      if (error.message === 'SCAN_CANCELLED') { await this.save(); return { ...this.state(), scanned, total, parsed, reused, failed, failures, cancelled: true }; }
      throw error;
    } finally { this.active = null; }
  }
  cancel() { if (!this.active) return false; this.active.cancelled = true; this.emit({ ...(this.active.progress ?? { current: 0, total: 0, parsed: 0, reused: 0, failed: 0 }), cancelled: true }); return true; }
  async walk(directory, files, depth, maxDepth, active) {
    if (active.cancelled || depth > maxDepth) return;
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (active.cancelled) return;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!SKIPPED.has(entry.name.toLowerCase()) && depth < maxDepth) await this.walk(full, files, depth + 1, maxDepth, active); }
      else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  async parse(filePath, stat, withCover) {
    const data = await mm.parseFile(filePath, { duration: true, skipCovers: !withCover });
    const common = data.common; const backup = fallback(filePath); const cover = mm.selectCover(common.picture);
    const song = { id: filePath, source: 'local', localPath: filePath, name: common.title || backup.name, artistText: common.artist || common.artists?.join(' / ') || backup.artistText, artists: [{ name: common.artist || common.artists?.join(' / ') || backup.artistText }], album: { name: common.album || '', picUrl: cover && withCover ? 'data:' + cover.format + ';base64,' + cover.data.toString('base64') : '' }, duration: Math.round((data.format.duration || 0) * 1000), mtimeMs: stat.mtimeMs, size: stat.size };
    return song;
  }
  async save() { await fs.mkdir(this.userData, { recursive: true }); await atomicWrite(this.file, { version: 1, directories: this.directories, songs: Array.from(this.songs.values()) }); }
}
module.exports = { LocalLibrary, fallback, EXTENSIONS, SKIPPED };
