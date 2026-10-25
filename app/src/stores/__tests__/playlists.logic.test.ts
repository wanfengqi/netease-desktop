import { describe, expect, it } from 'vitest';
import { key } from '../../data/normalize';
import type { Song, SongSource } from '../../data/normalize';
import {
  addSongs,
  collectPlaylist,
  createPlaylist,
  deletePlaylist,
  findPlaylist,
  moveSong,
  normalizeName,
  parseStoredCollected,
  parseStoredPlaylists,
  removeSongAt,
  removeSongs,
  toRemotePlaylist,
  uncollectPlaylist,
  updatePlaylist,
  type LocalPlaylist,
} from '../playlists';

function song(id: string | number, source: SongSource = 'netease', name = '晴天'): Song {
  return {
    id,
    source,
    name,
    artistText: '周杰伦',
    artists: [{ name: '周杰伦' }],
    album: { name: '叶惠美' },
    duration: 269000,
  };
}

const S1 = song(1, 'netease', 'A');
const S2 = song(2, 'netease', 'B');
const S3 = song(3, 'netease', 'C');
const MIGU_1 = song(1, 'migu', 'A(咪咕)');

let seq = 0;
const ids = (): string => 'pl-test-' + String(++seq);

function seeded(count = 2): LocalPlaylist[] {
  let list: LocalPlaylist[] = [];
  for (let i = 0; i < count; i += 1) {
    list = createPlaylist(list, { name: '歌单' + String(i + 1) }, 1000 + i, ids).list;
  }
  return list;
}

describe('歌单 CRUD - 创建', () => {
  it('创建后字段完整：id 唯一、songs 为空、时间戳写入', () => {
    const { list, playlist } = createPlaylist([], { name: '我的最爱', description: '私人' }, 1700000000000, ids);
    expect(list).toHaveLength(1);
    expect(playlist.kind).toBe('local');
    expect(playlist.name).toBe('我的最爱');
    expect(playlist.description).toBe('私人');
    expect(playlist.songs).toEqual([]);
    expect(playlist.createdAt).toBe(1700000000000);
    expect(playlist.updatedAt).toBe(1700000000000);
    expect(playlist.id).not.toBe('');
  });

  it('名字前后空格被裁剪；全空白回落占位名', () => {
    expect(createPlaylist([], { name: '  空格  ' }, 1, ids).playlist.name).toBe('空格');
    expect(createPlaylist([], { name: '   ' }, 1, ids).playlist.name).toBe('(未命名歌单)');
    expect(normalizeName('')).toBe('(未命名歌单)');
  });

  it('多个歌单按创建顺序排列，id 互不相同', () => {
    const list = seeded(3);
    expect(list.map((p) => p.name)).toEqual(['歌单1', '歌单2', '歌单3']);
    expect(new Set(list.map((p) => p.id)).size).toBe(3);
  });
});

describe('歌单 CRUD - 编辑', () => {
  it('改名 + 改描述，updatedAt 前进而 createdAt 不动', () => {
    const list = seeded(1);
    const id = list[0].id;
    const next = updatePlaylist(list, id, { name: '新名字', description: '新描述' }, 9999);
    const p = next[0];
    expect(p.name).toBe('新名字');
    expect(p.description).toBe('新描述');
    expect(p.updatedAt).toBe(9999);
    expect(p.createdAt).toBe(list[0].createdAt);
  });

  it('只传一个字段时其它字段保持原样', () => {
    const list = createPlaylist([], { name: 'A', description: 'D', cover: 'C' }, 1, ids).list;
    const next = updatePlaylist(list, list[0].id, { name: 'B' }, 2);
    expect(next[0]).toMatchObject({ name: 'B', description: 'D', cover: 'C' });
  });

  it('改不存在的 id 不动任何数据', () => {
    const list = seeded(2);
    const next = updatePlaylist(list, 'no-such-id', { name: 'x' }, 5);
    expect(next).toEqual(list);
  });
});

describe('歌单 CRUD - 删除', () => {
  it('删单只删目标，其余与歌曲内容不受影响', () => {
    let list = seeded(2);
    const keepId = list[0].id;
    const dropId = list[1].id;
    list = addSongs(list, keepId, [S1, S2], 10).list;
    const next = deletePlaylist(list, dropId);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(keepId);
    expect(next[0].songs).toHaveLength(2);
  });

  it('删不存在的 id 是无操作', () => {
    const list = seeded(2);
    expect(deletePlaylist(list, 'nope')).toEqual(list);
  });

  it('findPlaylist 找到返回对象，找不到返回 null', () => {
    const list = seeded(1);
    expect(findPlaylist(list, list[0].id)?.name).toBe('歌单1');
    expect(findPlaylist(list, 'nope')).toBeNull();
  });
});

describe('歌单 CRUD - 加歌', () => {
  it('加歌按 source:id 去重，added/duplicates 计数正确', () => {
    let list = seeded(1);
    const id = list[0].id;
    const first = addSongs(list, id, [S1, S2], 10);
    expect(first.added).toBe(2);
    expect(first.duplicates).toBe(0);
    list = first.list;

    const second = addSongs(list, id, [S1, S3], 11);
    expect(second.added).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(second.list[0].songs.map((s) => key(s))).toEqual(['netease:1', 'netease:2', 'netease:3']);
  });

  it('netease:1 与 migu:1 都能进同一个歌单（不是同一首）', () => {
    const list = seeded(1);
    const result = addSongs(list, list[0].id, [S1, MIGU_1], 10);
    expect(result.added).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.list[0].songs.map((s) => key(s))).toEqual(['netease:1', 'migu:1']);
  });

  it('缺 id 的歌被计为 invalid，不进歌单', () => {
    const list = seeded(1);
    const result = addSongs(list, list[0].id, [S1, song('', 'netease', '坏数据')], 10);
    expect(result.added).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.list[0].songs).toHaveLength(1);
  });

  it('加歌保持添加顺序（追加到末尾，前端插入不影响已有排序）', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S3], 1).list;
    list = addSongs(list, id, [S1, S2], 2).list;
    expect(list[0].songs.map((s) => key(s))).toEqual(['netease:3', 'netease:1', 'netease:2']);
  });

  it('一次都不重复时 updatedAt 前进；全部重复时对象原样返回', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1], 10).list;
    expect(list[0].updatedAt).toBe(10);
    const same = addSongs(list, id, [S1], 20);
    expect(same.list[0]).toBe(list[0]);
    expect(same.added).toBe(0);
  });

  it('往不存在的歌单加歌是无操作', () => {
    const list = seeded(1);
    const result = addSongs(list, 'nope', [S1], 10);
    expect(result.added).toBe(0);
    expect(result.list[0].songs).toHaveLength(0);
  });
});

describe('歌单 CRUD - 移歌', () => {
  it('按 key 移歌，只移指定的那一首', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1, S2, S3], 10).list;
    const next = removeSongs(list, id, ['netease:2'], 20);
    expect(next[0].songs.map((s) => key(s))).toEqual(['netease:1', 'netease:3']);
    expect(next[0].updatedAt).toBe(20);
  });

  it('按 key 移歌不会误伤另一个音源的同 id 歌', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1, MIGU_1], 10).list;
    const next = removeSongs(list, id, ['netease:1'], 20);
    expect(next[0].songs.map((s) => key(s))).toEqual(['migu:1']);
  });

  it('按下标删歌（列表右侧的删除按钮用这个）', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1, S2, S3], 10).list;
    const next = removeSongAt(list, id, 1, 20);
    expect(next[0].songs.map((s) => key(s))).toEqual(['netease:1', 'netease:3']);
  });

  it('下标越界 / 负数时无操作（不误删最后一首）', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1, S2], 10).list;
    expect(removeSongAt(list, id, 5, 20)[0].songs).toHaveLength(2);
    expect(removeSongAt(list, id, -1, 20)[0].songs).toHaveLength(2);
  });

  it('移不存在的 key 时不改 updatedAt', () => {
    let list = seeded(1);
    const id = list[0].id;
    list = addSongs(list, id, [S1], 10).list;
    const next = removeSongs(list, id, ['netease:999'], 20);
    expect(next[0].updatedAt).toBe(10);
  });
});

describe('歌单 CRUD - 拖拽排序', () => {
  function withThree(): LocalPlaylist[] {
    let list = seeded(1);
    return addSongs(list, list[0].id, [S1, S2, S3], 10).list;
  }

  it('向后拖：把第 1 首拖到第 3 位', () => {
    const list = withThree();
    const next = moveSong(list, list[0].id, 0, 2, 20);
    expect(next[0].songs.map((s) => key(s))).toEqual(['netease:2', 'netease:3', 'netease:1']);
    expect(next[0].updatedAt).toBe(20);
  });

  it('向前拖：把第 3 首拖到第 1 位', () => {
    const list = withThree();
    const next = moveSong(list, list[0].id, 2, 0, 20);
    expect(next[0].songs.map((s) => key(s))).toEqual(['netease:3', 'netease:1', 'netease:2']);
  });

  it('拖到原位 / 越界时不改数据（不产生空位或丢歌）', () => {
    const list = withThree();
    expect(moveSong(list, list[0].id, 1, 1, 20)[0].songs).toHaveLength(3);
    expect(moveSong(list, list[0].id, 0, 0, 20)[0].updatedAt).toBe(10);
    expect(moveSong(list, list[0].id, -1, 2, 20)[0].songs).toHaveLength(3);
    expect(moveSong(list, list[0].id, 0, 9, 20)[0].songs).toHaveLength(3);
  });

  it('排序不改变集合内容，只是顺序（歌一首都没丢）', () => {
    const list = withThree();
    const next = moveSong(list, list[0].id, 0, 2, 20);
    expect(new Set(next[0].songs.map((s) => key(s)))).toEqual(
      new Set(list[0].songs.map((s) => key(s))),
    );
    expect(next[0].songs).toHaveLength(list[0].songs.length);
  });
});

describe('收藏的线上歌单', () => {
  const remote = {
    source: 'netease' as const,
    id: 19723756,
    name: '云音乐热歌榜',
    cover: 'http://x/c.jpg',
    creator: '网易云音乐',
    count: 200,
    playCount: '1.2亿',
  };

  it('收藏一个线上歌单并存下指针字段', () => {
    const { list, added } = collectPlaylist([], remote, 100, ids);
    expect(added).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'collected',
      source: 'netease',
      sourceId: 19723756,
      name: '云音乐热歌榜',
      creator: '网易云音乐',
      count: 200,
    });
  });

  it('同一个线上歌单收藏两次只有一条', () => {
    const first = collectPlaylist([], remote, 100, ids);
    const second = collectPlaylist(first.list, remote, 200, ids);
    expect(second.added).toBe(false);
    expect(second.list).toHaveLength(1);
  });

  it('网易云与咪咕的同 id 歌单是两个（来源不同）', () => {
    const a = collectPlaylist([], remote, 1, ids);
    const b = collectPlaylist(a.list, { ...remote, source: 'migu' }, 2, ids);
    expect(b.added).toBe(true);
    expect(b.list).toHaveLength(2);
  });

  it('缺 id 的线上歌单无法收藏', () => {
    const result = collectPlaylist([], { ...remote, id: undefined }, 1, ids);
    expect(result.added).toBe(false);
  });

  it('取消收藏按 id 移除', () => {
    const { list } = collectPlaylist([], remote, 1, ids);
    expect(uncollectPlaylist(list, list[0].id)).toEqual([]);
  });

  it('toRemotePlaylist 还原成 PlaylistView 能用的结构', () => {
    const { list } = collectPlaylist([], remote, 1, ids);
    expect(toRemotePlaylist(list[0])).toEqual({
      source: 'netease',
      id: 19723756,
      name: '云音乐热歌榜',
      cover: 'http://x/c.jpg',
      creator: '网易云音乐',
      count: 200,
      playCount: '',
    });
  });
});

describe('歌单持久化解析（config.extra 里可能被改坏）', () => {
  it('正常数据原样恢复', () => {
    const base = seeded(1);
    const list = addSongs(base, base[0].id, [S1], 10).list;
    const parsed = parseStoredPlaylists(JSON.parse(JSON.stringify(list)));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('歌单1');
    expect(parsed[0].songs.map((s) => key(s))).toEqual(['netease:1']);
  });

  it('非数组 / 缺 id / 非对象条目被丢掉，不影响其它条目', () => {
    expect(parseStoredPlaylists(null)).toEqual([]);
    expect(parseStoredPlaylists('nope')).toEqual([]);
    const parsed = parseStoredPlaylists([
      { id: 'ok', name: '好的', songs: [] },
      { name: '没有 id' },
      null,
      42,
    ]);
    expect(parsed.map((p) => p.id)).toEqual(['ok']);
  });

  it('歌单里损坏的歌被过滤，好歌保留', () => {
    const parsed = parseStoredPlaylists([
      { id: 'p1', name: 'x', songs: [S1, { source: 'netease' }, null, 'bad'] },
    ]);
    expect(parsed[0].songs.map((s) => key(s))).toEqual(['netease:1']);
  });

  it('落盘形态是 JSON 字符串，parse 能原样还原（含歌）', () => {
    const base = seeded(1);
    const list = addSongs(base, base[0].id, [S1], 10).list;
    const parsed = parseStoredPlaylists(JSON.stringify(list));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].songs.map((s) => key(s))).toEqual(['netease:1']);
  });

  it('字符串被改坏（非法 JSON）时返回空，不抛异常', () => {
    expect(parseStoredPlaylists('{坏')).toEqual([]);
    expect(parseStoredPlaylists('"x"')).toEqual([]);
    expect(parseStoredCollected('{坏')).toEqual([]);
  });

  it('collected 解析：未知音源 / 缺 sourceId 的条目被丢掉', () => {
    const parsed = parseStoredCollected([
      { id: 'c1', source: 'netease', sourceId: 9, name: 'ok' },
      { id: 'c2', source: 'qq', sourceId: 9, name: 'bad' },
      { id: 'c3', source: 'migu', name: 'no sourceId' },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(['c1']);
  });
});
