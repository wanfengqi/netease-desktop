import { describe, expect, it } from 'vitest';
import { key } from '../../data/normalize';
import type { Song, SongSource } from '../../data/normalize';
import {
  dedupeSongs,
  isFavorite,
  removeFavorites,
  toggleFavorite,
} from '../favorites';

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

const NE_123 = song(123, 'netease');
const MIGU_123 = song(123, 'migu');
const NE_456 = song(456, 'netease');

describe('收藏去重（项目铁律：只认 source:id）', () => {
  it('同一个 source:id 加两次只有一条', () => {
    const first = toggleFavorite([], NE_123);
    expect(first.favorited).toBe(true);
    expect(first.songs).toHaveLength(1);

    const second = toggleFavorite(first.songs, NE_123);
    // 第二次是"取消收藏"（语义正确：再点一次就是取消）
    expect(second.favorited).toBe(false);
    expect(second.songs).toHaveLength(0);
  });

  it('同一个 source:id 用两份不同对象加进去也只有一条', () => {
    const copy = song(123, 'netease', '晴天(另一份快照)');
    const list = toggleFavorite([], NE_123).songs;
    const result = toggleFavorite(list, copy);
    // 已经收藏 → 这一次是取消，key 相同所以能命中
    expect(result.favorited).toBe(false);
    expect(result.songs).toHaveLength(0);
  });

  it('网易云 id=123 与咪咕 id=123 是两首不同的歌，都必须能收藏', () => {
    const a = toggleFavorite([], NE_123);
    const b = toggleFavorite(a.songs, MIGU_123);
    expect(b.favorited).toBe(true);
    expect(b.songs).toHaveLength(2);
    expect(b.songs.map((s) => key(s))).toEqual(['migu:123', 'netease:123']);
    // 取消其中一首，另一首不受影响
    const c = toggleFavorite(b.songs, NE_123);
    expect(c.songs.map((s) => key(s))).toEqual(['migu:123']);
  });

  it('新收藏排在最前（用户最近喜欢的先看到）', () => {
    let list = toggleFavorite([], NE_123).songs;
    list = toggleFavorite(list, NE_456).songs;
    expect(list.map((s) => key(s))).toEqual(['netease:456', 'netease:123']);
  });

  it('缺 id 的歌无法收藏（不产生假身份键）', () => {
    const broken = song('', 'netease', '没有 id');
    expect(key(broken)).toBe('');
    const result = toggleFavorite([], broken);
    expect(result.favorited).toBe(false);
    expect(result.songs).toHaveLength(0);
  });
});

describe('收藏集合工具', () => {
  it('dedupeSongs 保留首次出现顺序、丢掉重复与假键', () => {
    const list = dedupeSongs([NE_123, MIGU_123, NE_123, song(''), NE_456]);
    expect(list.map((s) => key(s))).toEqual(['netease:123', 'migu:123', 'netease:456']);
  });

  it('dedupeSongs 对空数组与重复输入都幂等', () => {
    expect(dedupeSongs([])).toEqual([]);
    const once = dedupeSongs([NE_123, NE_456]);
    expect(dedupeSongs(once)).toEqual(once);
  });

  it('isFavorite 同时接受 Song 与 key 字符串', () => {
    const list = [NE_123];
    expect(isFavorite(list, NE_123)).toBe(true);
    expect(isFavorite(list, 'netease:123')).toBe(true);
    expect(isFavorite(list, MIGU_123)).toBe(false);
    expect(isFavorite(list, 'migu:123')).toBe(false);
    expect(isFavorite(list, '')).toBe(false);
  });

  it('removeFavorites 按 key 批量移除，不误伤同 id 的另一个音源', () => {
    const list = [NE_123, MIGU_123, NE_456];
    const left = removeFavorites(list, ['netease:123']);
    expect(left.map((s) => key(s))).toEqual(['migu:123', 'netease:456']);
  });

  it('removeFavorites 传入不存在的 key 时原样返回内容', () => {
    const list = [NE_123];
    expect(removeFavorites(list, ['migu:999']).map((s) => key(s))).toEqual(['netease:123']);
  });
});
