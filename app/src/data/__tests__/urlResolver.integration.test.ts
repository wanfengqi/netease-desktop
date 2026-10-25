/**
 * UrlResolver 与真实取址逻辑的集成测试（S2）。
 *
 * 上一条 urlResolver.test.ts 测的是令牌机制本身（用假实现）；
 * 这里换成"repository 真实取址 + 竞态"的组合，证明修好的是**实际链路**，
 * 而不只是令牌类的局部行为。
 */
import { describe, expect, it } from 'vitest';
import { UrlResolver } from '../urlResolver';
import { MiguRepository, type MiguBridge } from '../repository/migu';
import type { Song } from '../normalize';

function miguSong(id: string, copyrightId: string): Song {
  return {
    id,
    source: 'migu',
    contentId: id,
    copyrightId,
    resourceType: '2',
    name: 's' + id,
    artistText: 'a',
    artists: [{ name: 'a' }],
    album: { name: 'al' },
    duration: 0,
  };
}

/** 每个 contentId 的响应延迟不同，用来复现"先发后返回" */
function bridgeWith(delays: Record<string, number>, urls: Record<string, string>): MiguBridge {
  const noop = async () => ({ ok: false, error: 'unused' });
  return {
    searchSong: noop, searchSinger: noop, searchAlbum: noop, searchPlaylist: noop,
    getLyric: noop, getSingerSong: noop, getSingerAlbum: noop, getAlbumSong: noop,
    getPlaylistSong: noop, getSongInfo: noop, getAlbumInfo: noop, getTodayRecommend: noop,
    getRankIndex: noop, getRecommendPlaylist: noop, getNewSongList: noop,
    getSimilarSongRecommend: noop, getSearchHot: noop,
    fetchText: async () => ({ ok: true, text: '' }),
    getUrlH5V24: async (contentId: string) => {
      await new Promise((r) => setTimeout(r, delays[contentId] ?? 0));
      return { ok: true, data: { code: '000000', data: { url: urls[contentId], audioFormatType: 'PQ' } } };
    },
  } as MiguBridge;
}

describe('UrlResolver × MiguRepository 集成', () => {
  it('慢歌先发、快歌后发 —— 快歌生效，慢歌的 url 被丢弃', async () => {
    const repo = new MiguRepository({
      bridge: bridgeWith({ slow: 60, fast: 5 }, { slow: 'https://x/slow.mp3', fast: 'https://x/fast.mp3' }),
    });
    const resolver = new UrlResolver();

    const slowSong = miguSong('slow', 'c1');
    const fastSong = miguSong('fast', 'c2');

    // 用户先点慢歌（延迟 60ms），立刻又点快歌（延迟 5ms）
    const pendingSlow = resolver.resolve(slowSong, { urlFor: async (s) => (await repo.songUrl(s)).url });
    const pendingFast = resolver.resolve(fastSong, { urlFor: async (s) => (await repo.songUrl(s)).url });

    const fast = await pendingFast;
    const slow = await pendingSlow;

    expect(fast.url).toBe('https://x/fast.mp3');
    expect(resolver.isCurrent(fast.token)).toBe(true);
    // "点 B 放 A" 的根因就是这一行没被拦住
    expect(slow.url).toBeNull();
    expect(resolver.isCurrent(slow.token)).toBe(false);
  });

  it('取址失败（缺 copyrightId）时返回 error，不污染下一个请求', async () => {
    const repo = new MiguRepository({ bridge: bridgeWith({ good: 0 }, { good: 'https://x/good.mp3' }) });
    const resolver = new UrlResolver();

    const bad = await resolver.resolve({ ...miguSong('bad', ''), copyrightId: undefined }, {
      urlFor: async (s) => (await repo.songUrl(s)).url,
    });
    expect(bad.url).toBeNull();
    expect(bad.error).toContain('copyrightId');

    const good = await resolver.resolve(miguSong('good', 'c'), {
      urlFor: async (s) => (await repo.songUrl(s)).url,
    });
    expect(good.url).toBe('https://x/good.mp3');
    expect(resolver.isCurrent(good.token)).toBe(true);
  });
});
