/**
 * 配置读写（S2）。
 *
 * 文件位置：<userData>/next-config.json —— 与旧版 config.json **分开**，
 * 旧版继续独占 config.json，两版同时跑互不踩踏。
 *
 * 首次启动（next-config.json 不存在）时读旧 config.json 做一次迁移，
 * 之后只写自己的文件；旧文件仅读不写。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { migrateLegacyConfig, defaultConfig } = require('./migrate.cjs');

const NEXT_FILE = 'next-config.json';
const LEGACY_FILE = 'config.json';

let userDataDir = '';
let cache = null;

function init(dir) {
  userDataDir = dir;
  cache = null;
  return nextPath();
}

function nextPath() {
  return path.join(userDataDir, NEXT_FILE);
}

function legacyPath() {
  return path.join(userDataDir, LEGACY_FILE);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 读取配置；不存在则从旧 config.json 迁移一次并落盘 */
function load() {
  if (cache) return cache;
  const own = readJson(nextPath());
  if (own && typeof own === 'object') {
    cache = { ...defaultConfig(), ...own };
    return cache;
  }
  const legacy = readJson(legacyPath());
  const { config, report } = migrateLegacyConfig(legacy);
  if (report.migrated) {
    config.migratedFrom = legacyPath();
    config.updatedAt = Date.now();
    console.log('[config] 已从旧 config.json 迁移：保留 ' + report.carried.length + ' 个键' +
      (report.unknown.length ? '，未知键 ' + report.unknown.join(',') : ''));
    writeJson(nextPath(), config);
  }
  cache = config;
  return cache;
}

/** 浅合并写入；返回合并后的完整配置 */
function save(patch) {
  const current = load();
  const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
  next.version = current.version;
  if (current.migratedFrom) next.migratedFrom = current.migratedFrom;
  next.updatedAt = Date.now();
  cache = next;
  writeJson(nextPath(), next);
  return next;
}

function migrateReport() {
  const own = readJson(nextPath());
  if (own) return { status: 'already-migrated', file: nextPath(), keys: Object.keys(own) };
  const legacy = readJson(legacyPath());
  if (!legacy) return { status: 'no-legacy', file: legacyPath(), keys: [] };
  const { report } = migrateLegacyConfig(legacy);
  return { status: 'pending-migration', file: legacyPath(), ...report };
}

module.exports = { init, load, save, nextPath, legacyPath, migrateReport };
