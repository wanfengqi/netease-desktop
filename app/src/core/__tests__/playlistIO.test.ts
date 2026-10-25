import { describe, expect, it } from 'vitest';
import { key } from '../../data/normalize';
import type { Song, SongSource } from '../../data/normalize';
import {
  PLAYLIST_FILE_KIND,
  PLAYLIST_FILE_VERSION,
  exportPlaylist,
  exportPlaylistJSON,
  importPlaylistJSON,
  summarizeImport,
} from '../playlistIO';

function song(
  id: string | number,
  name = '晴天',
  source: SongSource = 'netease',
  extra: Partial<Song> = {},
): Song {
  return {
    id,
    source,
    name,
    artistText: '周杰伦',
    artists: [{ name: '周杰伦' }],
    album: { name: '叶惠美', picUrl: 'http://x/a.jpg' },
    duration: 269000,
    ...extra,
  };
}

const A = song(123, '晴天');
const B = song(456, '以父之名');
/** 与 A 的 id 相同、音源不同 —— 必须是两条 */
const MIGU_A = song(123, '晴天(咪咕)', 'migu');

describe('playlistIO 导出', () => {
  it('导出文件带 kind/version/count，且 key 是 source:id', () => {
    const { file, json, skipped } = exportPlaylist({ name: '我的歌单', songs: [A, B] }, 1700000000000);
    expect(skipped).toBe(0);
    expect(file.kind).toBe(PLAYLIST_FILE_KIND);
    expect(file.version).toBe(PLAYLIST_FILE_VERSION);
    expect(file.count).toBe(2);
    expect(file.exportedAt).toBe(1700000000000);
    expect(file.songs.map((s) => s.key)).toEqual(['netease:123', 'netease:456']);
    // 展示字段齐全，换机器也能直接渲染
    expect(file.songs[0]).toMatchObject({
      source: 'netease',
      id: 123,
      name: '晴天',
      artistText: '周杰伦',
      album: '叶惠美',
      duration: 269000,
    });
    expect(JSON.parse(json).songs).toHaveLength(2);
  });

  it('同一音源同 id 只导出一条；网易云 123 与咪咕 123 都要保留', () => {
    const { file, skipped } = exportPlaylist({ name: 'x', songs: [A, A, MIGU_A] }, 1);
    expect(file.songs.map((s) => s.key)).toEqual(['netease:123', 'migu:123']);
    expect(skipped).toBe(1);
    expect(file.count).toBe(2);
  });

  it('缺 id 的歌被跳过并计数（不产生 "netease:undefined" 这种假键）', () => {
    const broken = song('', '没有 id');
    expect(key(broken)).toBe('');
    const { file, skipped } = exportPlaylist({ name: 'x', songs: [A, broken] }, 1);
    expect(file.songs.map((s) => s.key)).toEqual(['netease:123']);
    expect(skipped).toBe(1);
  });

  it('空歌单导出合法（count=0，songs=[]），名字为空回落占位名', () => {
    const file = JSON.parse(exportPlaylistJSON({ name: '   ', songs: [] }, 5));
    expect(file.count).toBe(0);
    expect(file.songs).toEqual([]);
    expect(file.name).toBe('(未命名歌单)');
  });

  it('咪咕专属播放字段（contentId/copyrightId/resourceType）一并导出', () => {
    const migu = song('600907', '稻香', 'migu', {
      contentId: '6009070001',
      copyrightId: 'cr-1',
      resourceType: '2',
    });
    const { file } = exportPlaylist({ name: 'x', songs: [migu] }, 1);
    expect(file.songs[0]).toMatchObject({
      contentId: '6009070001',
      copyrightId: 'cr-1',
      resourceType: '2',
    });
  });
});

describe('playlistIO 导入 - 正常', () => {
  it('导出→导入 往返，歌曲身份与展示字段一致', () => {
    const json = exportPlaylistJSON({ name: '我的歌单', description: '描述', songs: [A, B, MIGU_A] }, 1);
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.playlist.name).toBe('我的歌单');
    expect(result.playlist.description).toBe('描述');
    expect(result.playlist.songs.map((s) => key(s))).toEqual([
      'netease:123',
      'netease:456',
      'migu:123',
    ]);
    expect(result.playlist.songs[0].artists).toEqual([{ name: '周杰伦' }]);
    expect(result.playlist.songs[0].duration).toBe(269000);
  });

  it('没有 kind 标记也能导入（给出 warning，不拦）', () => {
    const json = JSON.stringify({ name: '裸歌单', songs: [{ source: 'netease', id: 7, name: '七里香' }] });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs).toHaveLength(1);
    expect(result.issues.some((i) => i.code === 'missing-kind')).toBe(true);
  });

  it('只有 key 没有 id 时，从 key 里补出 source 与 id', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [{ key: 'migu:600907', name: '稻香' }],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(key(result.playlist.songs[0])).toBe('migu:600907');
    expect(result.playlist.songs[0].source).toBe('migu');
  });
});

describe('playlistIO 导入 - 残缺数据', () => {
  it('重复 key 只留一条，并给出 duplicate-song 提示', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [
        { source: 'netease', id: 1, name: 'A' },
        { source: 'netease', id: 1, name: 'A(重复)' },
      ],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs).toHaveLength(1);
    expect(result.issues.some((i) => i.code === 'duplicate-song')).toBe(true);
  });

  it('缺 id 且 key 无法解析的条目被跳过，其余照常导入', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [{ source: 'netease', id: 1, name: 'A' }, { source: 'netease', name: '没有 id' }, 'not-an-object'],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs).toHaveLength(1);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('song-missing-id');
    expect(codes).toContain('song-not-object');
  });

  it('未知音源被跳过（不给一个不存在的音源硬造身份）', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [{ source: 'qq', id: 1, name: 'A' }, { source: 'netease', id: 2, name: 'B' }],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs.map((s) => key(s))).toEqual(['netease:2']);
    expect(result.issues.some((i) => i.code === 'song-unknown-source')).toBe(true);
  });

  it('缺歌名用占位、缺歌手不拦 —— 身份还在就能播', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [{ source: 'netease', id: 9 }],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs[0].name).toBe('未知歌曲');
    expect(result.playlist.songs[0].artists).toEqual([]);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('song-missing-name');
    expect(codes).toContain('song-missing-artist');
  });

  it('全部条目都不可识别 → ok:false，且说明有 N 条', () => {
    const json = JSON.stringify({
      kind: PLAYLIST_FILE_KIND,
      version: 1,
      name: 'x',
      songs: [{ source: 'netease' }, { source: 'netease' }],
    });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = result.issues.find((i) => i.code === 'songs-all-invalid');
    expect(all).toBeDefined();
    expect(all?.message).toContain('2 条');
  });

  it('空 songs 数组 → ok:true 但提示会得到空歌单', () => {
    const json = JSON.stringify({ kind: PLAYLIST_FILE_KIND, version: 1, name: 'x', songs: [] });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlist.songs).toEqual([]);
    expect(result.issues.some((i) => i.code === 'empty-songs')).toBe(true);
  });

  it('版本高于当前 → 明确拒绝（不是静默按老格式解析）', () => {
    const json = JSON.stringify({ kind: PLAYLIST_FILE_KIND, version: 99, name: 'x', songs: [] });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('unsupported-version');
    expect(result.issues[0].message).toContain('99');
  });

  it('kind 不对 → 拒绝（防止把别的 JSON 导进来）', () => {
    const json = JSON.stringify({ kind: 'something/else', songs: [] });
    const result = importPlaylistJSON(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('wrong-kind');
  });
});

describe('playlistIO 导入 - 空 / 非法输入', () => {
  it('空串 → empty-input', () => {
    for (const input of ['', '   ', '\n\t ']) {
      const result = importPlaylistJSON(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].code).toBe('empty-input');
    }
  });

  it('非法 JSON → invalid-json，且带上解析器的原始报错', () => {
    const result = importPlaylistJSON('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('invalid-json');
    expect(result.issues[0].message.length).toBeGreaterThan('不是合法的 JSON：'.length);
  });

  it('顶层是数组 → not-object，并提示可能只拷贝了 songs 部分', () => {
    const result = importPlaylistJSON('[{"source":"netease","id":1}]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('not-object');
    expect(result.issues[0].message).toContain('数组');
  });

  it('顶层是数字/字符串 → not-object', () => {
    for (const input of ['42', '"hello"', 'null']) {
      const result = importPlaylistJSON(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].code).toBe('not-object');
    }
  });

  it('缺 songs 数组 → missing-songs', () => {
    const result = importPlaylistJSON(JSON.stringify({ kind: PLAYLIST_FILE_KIND, version: 1, name: 'x' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[result.issues.length - 1].code).toBe('missing-songs');
  });
});

describe('playlistIO 摘要', () => {
  it('成功且无异常只说首数', () => {
    const json = exportPlaylistJSON({ name: 'x', songs: [A] }, 1);
    expect(summarizeImport(importPlaylistJSON(json))).toBe('已解析《x》：1 首，无异常');
  });

  it('成功但有 warning 时报条数', () => {
    const json = JSON.stringify({ name: 'y', songs: [{ source: 'netease', id: 1 }] });
    const text = summarizeImport(importPlaylistJSON(json));
    expect(text).toContain('已解析《y》：1 首');
    expect(text).toContain('条提示');
  });

  it('失败时给出第一条错误原文', () => {
    expect(summarizeImport(importPlaylistJSON('{oops'))).toContain('导入失败：不是合法的 JSON');
  });
});
