/**
 * 旧版 config.json -> 新版配置格式的纯函数迁移（S2）。
 *
 * 纯函数：不碰 fs、不碰 electron，只做「旧格式 -> 新格式」的判定与补齐，
 * 这样单元测试可以直接喂样本，不用起 Electron。
 *
 * 硬约束：**旧键一个都不能丢**。已知键走规范化分支，未知键原样进 extra。
 *
 * 旧格式（src/main.js loadConfig/saveConfig 的产物，实测 13 个键）：
 *   cookie / source / playMode / favorites / searchHistory / windowBounds /
 *   recent / queue / queueIndex / lyricOffset / volume / equalizer / muted
 */
'use strict';

const CONFIG_VERSION = 2;

const PLAY_MODES = ['list', 'one', 'shuffle', 'order'];
const SOURCES = ['netease', 'migu'];

/** 旧版 13 个已知键；不在此集合里的键原样保留到 extra */
const KNOWN_KEYS = [
  'cookie', 'source', 'playMode', 'favorites', 'searchHistory', 'windowBounds',
  'recent', 'queue', 'queueIndex', 'lyricOffset', 'volume', 'equalizer', 'muted',
];

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    source: 'netease',
    playMode: 'list',
    volume: 0.8,
    muted: false,
    lyricOffset: 0,
    equalizer: { enabled: false, preset: 'flat', bands: Array(10).fill(0) },
    favorites: [],
    recent: [],
    queue: [],
    queueIndex: -1,
    searchHistory: [],
    cookie: '',
    windowBounds: null,
    extra: {},
    migratedFrom: '',
    updatedAt: 0,
  };
}

function clampVolume(v, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/** 队列/收藏里是旧版 Song，保持原样但剔除明显非法项（没有 id 的） */
function asSongArray(v) {
  return asArray(v).filter((s) => s && typeof s === 'object' && s.id !== null && s.id !== undefined && s.id !== '');
}

function asStringArray(v) {
  return asArray(v).filter((x) => typeof x === 'string' && x !== '');
}

function normalizeBounds(v) {
  if (!v || typeof v !== 'object') return null;
  const { x, y, width, height } = v;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  const out = { width: Math.max(560, width), height: Math.max(360, height) };
  if (typeof x === 'number') out.x = x;
  if (typeof y === 'number') out.y = y;
  return out;
}

function normalizeEqualizer(v) {
  const raw = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const source = Array.isArray(raw.bands) && raw.bands.length ? raw.bands : asArray(raw.gains);
  const bands = Array.from({ length: 10 }, (_, i) => {
    const oldIndex = Math.min(source.length - 1, Math.round(i * (source.length - 1) / 9));
    const value = Number(source.length === 10 ? source[i] : source[oldIndex]);
    return Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
  });
  return { enabled: Boolean(raw.enabled ?? raw.on), preset: typeof raw.preset === 'string' ? raw.preset : 'flat', bands };
}

/**
 * @param {unknown} raw 旧 config.json 解析后的对象（可能为 null / 垃圾）
 * @returns {{ config: object, report: { migrated: boolean, carried: string[], unknown: string[], dropped: string[] } }}
 */
function migrateLegacyConfig(raw) {
  const report = { migrated: false, carried: [], unknown: [], dropped: [] };
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: base, report };
  }

  const out = { ...base };
  const extra = {};

  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.includes(k)) {
      extra[k] = v;
      report.unknown.push(k);
      continue;
    }
    report.carried.push(k);
  }

  if (typeof raw.cookie === 'string') out.cookie = raw.cookie;
  if (SOURCES.includes(raw.source)) out.source = raw.source;
  else if (raw.source !== undefined) report.dropped.push('source');
  if (PLAY_MODES.includes(raw.playMode)) out.playMode = raw.playMode;
  else if (raw.playMode !== undefined) report.dropped.push('playMode');

  out.volume = clampVolume(raw.volume, base.volume);
  out.muted = Boolean(raw.muted);
  out.lyricOffset = Number.isFinite(Number(raw.lyricOffset)) ? Number(raw.lyricOffset) : base.lyricOffset;
  out.equalizer = normalizeEqualizer(raw.equalizer);
  out.favorites = asSongArray(raw.favorites);
  out.recent = asSongArray(raw.recent);
  out.queue = asSongArray(raw.queue);
  out.queueIndex = Number.isFinite(Number(raw.queueIndex)) ? Math.trunc(Number(raw.queueIndex)) : base.queueIndex;
  if (out.queueIndex >= out.queue.length) out.queueIndex = Math.max(-1, out.queue.length - 1);
  out.searchHistory = asStringArray(raw.searchHistory);
  out.windowBounds = normalizeBounds(raw.windowBounds);
  out.extra = extra;

  report.migrated = true;
  return { config: out, report };
}

module.exports = { CONFIG_VERSION, KNOWN_KEYS, PLAY_MODES, SOURCES, defaultConfig, migrateLegacyConfig, normalizeEqualizer };
