/**
 * 歌单导入导出（S6）—— 纯逻辑层：不碰 DOM、不碰 IPC、不碰剪贴板。
 *
 * 为什么单独成层：原生文件对话框需要新 IPC（dialog.showSaveDialog / showOpenDialog），
 * 而 electron/ 归 S4 那一路，本阶段不能碰。所以先把"格式 / 校验 / 残缺提示"钉死在纯函数里，
 * UI 先用剪贴板过渡；将来换成文件对话框时，这一层**一行都不用改**。
 *
 * 文件格式（version 1）：
 * {
 *   "kind": "netease-desktop/playlist",   // 防"导错文件"
 *   "version": 1,
 *   "exportedAt": 1730000000000,
 *   "name": "我的歌单",
 *   "description": "",
 *   "cover": "",
 *   "count": 2,
 *   "songs": [{ "key": "netease:123", "source": "netease", "id": 123, "name": "晴天", ... }]
 * }
 *
 * 铁律：歌曲身份只认 key = `source:id`（网易云与咪咕的 id 会撞车），
 * 所以导出必须带 key，导入也必须按 key 去重；只有 id 的残缺数据要能补出 key。
 */
import { key as songKey } from '../data/normalize';
import type { Song, SongSource } from '../data/normalize';

export const PLAYLIST_FILE_KIND = 'netease-desktop/playlist';
export const PLAYLIST_FILE_VERSION = 1;

const KNOWN_SOURCES: readonly SongSource[] = ['netease', 'migu'];

/** 导出文件里的单首歌：既有跨源身份 key，也有展示字段（换机器也能直接还原） */
export interface ExportedSong {
  key: string;
  source: SongSource;
  id: string | number;
  name: string;
  artistText: string;
  album: string;
  duration: number;
  vip?: boolean;
  contentId?: string;
  copyrightId?: string;
  resourceType?: string;
}

export interface PlaylistFile {
  kind: string;
  version: number;
  exportedAt: number;
  name: string;
  description: string;
  cover: string;
  count: number;
  songs: ExportedSong[];
}

/** 导出输入：只要"名字 + 歌"，不依赖 playlists store 的类型，避免循环依赖 */
export interface PlaylistExportInput {
  name: string;
  description?: string;
  cover?: string;
  songs: readonly Song[];
}

export interface ExportResult {
  json: string;
  file: PlaylistFile;
  /** 没有身份键（缺 id）或重复而被丢弃的条目数 */
  skipped: number;
}

export type ImportIssueLevel = 'error' | 'warning';

export interface ImportIssue {
  level: ImportIssueLevel;
  /** 稳定 code，测试与 UI 都按它分支，不要靠文案匹配 */
  code: string;
  message: string;
  /** 出问题的位置，如 songs[3]；顶层问题为空 */
  path?: string;
}

export interface ImportedPlaylist {
  name: string;
  description: string;
  cover: string;
  songs: Song[];
}

export type ImportResult =
  | { ok: true; playlist: ImportedPlaylist; issues: ImportIssue[] }
  | { ok: false; issues: ImportIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is SongSource {
  return typeof value === 'string' && (KNOWN_SOURCES as readonly string[]).includes(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asId(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** `netease:123` → { source, id }；格式不对返回 null */
function splitKey(raw: unknown): { source: SongSource; id: string } | null {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const source = raw.slice(0, at);
  const id = raw.slice(at + 1).trim();
  if (!isSource(source) || id === '') return null;
  return { source, id };
}

/** 统一歌曲 → 导出项（可选字段只在有值时出现，避免一堆空串） */
export function toExportedSong(song: Song): ExportedSong {
  const out: ExportedSong = {
    key: songKey(song),
    source: song.source,
    id: song.id,
    name: song.name,
    artistText: song.artistText,
    album: song.album?.name ?? '',
    duration: Number.isFinite(song.duration) ? song.duration : 0,
  };
  if (song.vip) out.vip = true;
  if (song.contentId) out.contentId = song.contentId;
  if (song.copyrightId) out.copyrightId = song.copyrightId;
  if (song.resourceType) out.resourceType = song.resourceType;
  return out;
}

/**
 * 导出歌单。没有身份键的歌无法在别的机器上定位，直接跳过并计数，
 * 重复的 key 只留第一首（顺序即用户排序）。
 */
export function exportPlaylist(input: PlaylistExportInput, now: number = Date.now()): ExportResult {
  const songs: ExportedSong[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const song of input.songs) {
    const k = songKey(song);
    if (!k || seen.has(k)) {
      skipped += 1;
      continue;
    }
    seen.add(k);
    songs.push(toExportedSong(song));
  }
  const file: PlaylistFile = {
    kind: PLAYLIST_FILE_KIND,
    version: PLAYLIST_FILE_VERSION,
    exportedAt: now,
    name: input.name.trim() || '(未命名歌单)',
    description: input.description ?? '',
    cover: input.cover ?? '',
    count: songs.length,
    songs,
  };
  return { json: JSON.stringify(file, null, 2), file, skipped };
}

/** 只要文本的便捷入口（UI 复制到剪贴板用这个） */
export function exportPlaylistJSON(input: PlaylistExportInput, now: number = Date.now()): string {
  return exportPlaylist(input, now).json;
}

/** 单首歌的校验与重建：能救的救（缺歌名补占位），救不了的丢弃并留可见提示 */
function songFromRecord(
  raw: unknown,
  index: number,
  issues: ImportIssue[],
): Song | null {
  const path = 'songs[' + index + ']';
  const where = '第 ' + (index + 1) + ' 首';
  if (!isRecord(raw)) {
    issues.push({ level: 'warning', code: 'song-not-object', message: where + '不是对象，已跳过', path });
    return null;
  }

  const keyInfo = splitKey(raw.key);
  const source = isSource(raw.source) ? raw.source : keyInfo?.source;
  if (!source) {
    issues.push({
      level: 'warning',
      code: 'song-unknown-source',
      message: where + '的音源无法识别（只支持 netease / migu），已跳过',
      path,
    });
    return null;
  }

  const id = asId(raw.id) ?? keyInfo?.id ?? null;
  if (id === null) {
    issues.push({
      level: 'warning',
      code: 'song-missing-id',
      message: where + '缺少 id（也没有可解析的 key），无法定位这首歌，已跳过',
      path,
    });
    return null;
  }

  const name = asString(raw.name).trim();
  const artistText = asString(raw.artistText).trim();
  const rawArtists = Array.isArray(raw.artists) ? raw.artists : [];
  const artists = rawArtists
    .map((a) => (isRecord(a) ? asString(a.name).trim() : ''))
    .filter((n) => n !== '')
    .map((n) => ({ name: n }));
  const finalArtists = artists.length > 0
    ? artists
    : artistText === ''
      ? []
      : artistText.split(' / ').map((n) => ({ name: n.trim() })).filter((a) => a.name !== '');

  if (name === '') {
    issues.push({
      level: 'warning',
      code: 'song-missing-name',
      message: where + '缺少歌名，已用「未知歌曲」占位（身份 ' + source + ':' + String(id) + ' 仍有效）',
      path,
    });
  }
  if (finalArtists.length === 0) {
    issues.push({
      level: 'warning',
      code: 'song-missing-artist',
      message: where + '缺少歌手信息，播放不受影响',
      path,
    });
  }

  const albumField = raw.album;
  const albumName = isRecord(albumField) ? asString(albumField.name) : asString(albumField);
  const picUrl = isRecord(albumField) ? asString(albumField.picUrl) : '';
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : 0;

  const song: Song = {
    id,
    source,
    name: name === '' ? '未知歌曲' : name,
    artistText: artistText !== '' ? artistText : finalArtists.map((a) => a.name).join(' / '),
    artists: finalArtists,
    album: { name: albumName, picUrl },
    duration,
    vip: raw.vip === true,
  };
  const contentId = asString(raw.contentId);
  const copyrightId = asString(raw.copyrightId);
  const resourceType = asString(raw.resourceType);
  if (contentId) song.contentId = contentId;
  if (copyrightId) song.copyrightId = copyrightId;
  if (resourceType) song.resourceType = resourceType;
  return song;
}

/**
 * 解析导入文本。永不抛异常：一切失败都变成 { ok:false, issues }，
 * 部分残缺变成 { ok:true, issues:[warning] } —— UI 直接把 issues 逐条显示给用户。
 */
export function importPlaylistJSON(text: string): ImportResult {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw === '') {
    return {
      ok: false,
      issues: [{ level: 'error', code: 'empty-input', message: '内容为空：请先粘贴导出的 JSON 文本' }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ level: 'error', code: 'invalid-json', message: '不是合法的 JSON：' + detail }],
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      issues: [{
        level: 'error',
        code: 'not-object',
        message: Array.isArray(parsed)
          ? '顶层是数组：本应用导出的是「歌单对象」，请检查是否只拷贝了 songs 部分'
          : '顶层不是对象：无法识别为歌单文件',
      }],
    };
  }

  const issues: ImportIssue[] = [];

  const kind = parsed.kind;
  if (typeof kind === 'string' && kind !== PLAYLIST_FILE_KIND) {
    return {
      ok: false,
      issues: [{
        level: 'error',
        code: 'wrong-kind',
        message: '不是本应用的歌单文件（kind=' + kind + '，期望 ' + PLAYLIST_FILE_KIND + '）',
      }],
    };
  }
  if (kind === undefined) {
    issues.push({
      level: 'warning',
      code: 'missing-kind',
      message: '文件缺少 kind 标记：已按歌单格式尽力解析',
    });
  }

  const version = parsed.version;
  if (typeof version === 'number' && Number.isFinite(version) && version > PLAYLIST_FILE_VERSION) {
    return {
      ok: false,
      issues: [{
        level: 'error',
        code: 'unsupported-version',
        message: '文件版本 ' + String(version) + ' 高于当前支持版本 ' + String(PLAYLIST_FILE_VERSION) + '，请升级应用后再导入',
      }],
    };
  }
  if (version !== undefined && typeof version !== 'number') {
    issues.push({ level: 'warning', code: 'bad-version', message: 'version 字段不是数字：已忽略' });
  }

  const rawSongs = parsed.songs;
  if (!Array.isArray(rawSongs)) {
    return {
      ok: false,
      issues: [
        ...issues,
        {
          level: 'error',
          code: 'missing-songs',
          message: '缺少 songs 数组：无法确定这个歌单里有哪些歌',
        },
      ],
    };
  }

  const name = asString(parsed.name).trim();
  if (name === '') {
    issues.push({
      level: 'warning',
      code: 'missing-name',
      message: '文件里没有歌单名，已用「(未命名歌单)」',
    });
  }

  const songs: Song[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSongs.length; i += 1) {
    const song = songFromRecord(rawSongs[i], i, issues);
    if (!song) continue;
    const k = songKey(song);
    if (seen.has(k)) {
      issues.push({
        level: 'warning',
        code: 'duplicate-song',
        message: '第 ' + (i + 1) + ' 首与前面的 ' + k + ' 重复，已跳过',
        path: 'songs[' + i + ']',
      });
      continue;
    }
    seen.add(k);
    songs.push(song);
  }

  if (rawSongs.length > 0 && songs.length === 0) {
    issues.push({
      level: 'error',
      code: 'songs-all-invalid',
      message: '文件里有 ' + String(rawSongs.length) + ' 条歌曲，但没有一条能被识别（详见下面的逐条提示）',
    });
    return { ok: false, issues };
  }

  if (rawSongs.length === 0) {
    issues.push({
      level: 'warning',
      code: 'empty-songs',
      message: '该文件不含歌曲：导入后会得到一个空歌单',
    });
  }

  return {
    ok: true,
    playlist: {
      name: name === '' ? '(未命名歌单)' : name,
      description: asString(parsed.description),
      cover: asString(parsed.cover),
      songs,
    },
    issues,
  };
}

/** 一行摘要（toast / 面板标题用） */
export function summarizeImport(result: ImportResult): string {
  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  if (!result.ok) {
    const first = errors[0]?.message ?? '未知原因';
    return errors.length > 1 ? '导入失败：' + first + '（另有 ' + (errors.length - 1) + ' 条错误）' : '导入失败：' + first;
  }
  const head = '已解析《' + result.playlist.name + '》：' + String(result.playlist.songs.length) + ' 首';
  return warnings.length === 0 ? head + '，无异常' : head + '，' + String(warnings.length) + ' 条提示';
}
