import { describe, expect, it } from 'vitest';
import { UrlResolver } from '../urlResolver';
import type { Song } from '../normalize';

function song(id: number, source: Song['source'] = 'netease'): Song {
  return {
    id,
    source,
    name: 'song-' + id,
    artistText: 'a',
    artists: [{ name: 'a' }],
    album: { name: 'al' },
    duration: 1000,
  };
}

/** 手动控制 resolve 的延迟实现 */
function deferred() {
  let resolve!: (v: string | null) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('UrlResolver 竞态（S1 报告的"点 B 放 A"）', () => {
  it('先发的请求后返回时被判定为过期，url 为 null', async () => {
    const resolver = new UrlResolver();
    const slowA = deferred();
    const fastB = deferred();

    // playAt(A) 先发
    const pendingA = resolver.resolve(song(1), { urlFor: () => slowA.promise });
    // playAt(B) 后发
    const pendingB = resolver.resolve(song(2), { urlFor: () => fastB.promise });

    // B 先回
    fastB.resolve('https://cdn/b.mp3');
    const resultB = await pendingB;
    expect(resultB.url).toBe('https://cdn/b.mp3');
    expect(resolver.isCurrent(resultB.token)).toBe(true);

    // A 后回 —— 必须被丢弃
    slowA.resolve('https://cdn/a.mp3');
    const resultA = await pendingA;
    expect(resultA.url).toBeNull();
    expect(resultA.error).toContain('过期');
    expect(resolver.isCurrent(resultA.token)).toBe(false);

    // 令牌大小关系：后发的 token 更大
    expect(resultB.token).toBeGreaterThan(resultA.token);
  });

  it('三次并发切歌，只有最后一个 token 是 current', async () => {
    const resolver = new UrlResolver();
    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const p1 = resolver.resolve(song(1), { urlFor: () => d1.promise });
    const p2 = resolver.resolve(song(2), { urlFor: () => d2.promise });
    const p3 = resolver.resolve(song(3), { urlFor: () => d3.promise });

    // 乱序返回：3 -> 1 -> 2
    d3.resolve('u3');
    d1.resolve('u1');
    d2.resolve('u2');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r3.url).toBe('u3');
    expect(resolver.isCurrent(r3.token)).toBe(true);
    expect(r1.url).toBeNull();
    expect(r2.url).toBeNull();
    expect(resolver.isCurrent(r1.token)).toBe(false);
    expect(resolver.isCurrent(r2.token)).toBe(false);
  });

  it('invalidate() 让在途请求立即过期', async () => {
    const resolver = new UrlResolver();
    const d = deferred();
    const pending = resolver.resolve(song(1), { urlFor: () => d.promise });
    resolver.invalidate();
    d.resolve('u1');
    const result = await pending;
    expect(result.url).toBeNull();
    expect(resolver.isCurrent(result.token)).toBe(false);
  });

  it('取址抛错时返回 error 且 url 为 null，不影响后续请求', async () => {
    const resolver = new UrlResolver();
    const bad = await resolver.resolve(song(1), {
      urlFor: () => Promise.reject(new Error('咪咕无可用播放地址')),
    });
    expect(bad.url).toBeNull();
    expect(bad.error).toContain('无可用播放地址');

    const good = await resolver.resolve(song(2), { urlFor: () => Promise.resolve('ok') });
    expect(good.url).toBe('ok');
    expect(resolver.isCurrent(good.token)).toBe(true);
  });

  it('超时返回 error，且不会把迟到的结果写出去', async () => {
    const resolver = new UrlResolver();
    const d = deferred();
    const result = await resolver.resolve(song(1), {
      urlFor: () => d.promise,
      timeoutMs: 10,
    });
    expect(result.url).toBeNull();
    expect(result.error).toContain('超时');
    d.resolve('late');
  });

  it('没有注入 urlFor 时明确报错而不是静默返回成功', async () => {
    const resolver = new UrlResolver();
    const result = await resolver.resolve(song(1));
    expect(result.url).toBeNull();
    expect(result.error).toContain('urlFor');
  });
});
