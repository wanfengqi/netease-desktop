import { describe, expect, it } from 'vitest';
import { NeteaseRepository, type NeteaseBridge } from '../repository/netease';

/**
 * 登录态接线回归。
 *
 * 起因：共享单例从未拿到 cookie（index.ts 注释承诺的 setCookieProvider 当时并不存在），
 * 于是 /song/url/v1 全部按**未登录**发出，网易云回 freeTrialInfo 试听片段
 * —— 用户侧表现就是"每日推荐里歌曲只有 30 秒"。
 * 这里的 bridge 必须记录第三个入参，否则"cookie 已透传"这类断言是假绿。
 */
const URL_BODY = { '/song/url/v1': { code: 200, data: [{ url: 'https://m/x.mp3', br: 320000, code: 200 }] } };
const REC_BODY = { '/recommend/songs': { code: 200, data: { dailySongs: [] } } };

function cookieBridge(routes: Record<string, unknown>, seen: string[]): NeteaseBridge {
  return {
    request: async (path, _params, cookie) => {
      seen.push(cookie ?? '');
      return { ok: true, status: 200, body: routes[path] ?? { code: 200 }, ms: 1 };
    },
  };
}

describe('netease 登录态：cookie 必须真的传到 bridge', () => {
  it('未接线的单例恒发空 cookie（这就是试听片段的成因）', async () => {
    const seen: string[] = [];
    const repo = new NeteaseRepository({ bridge: cookieBridge(URL_BODY, seen) });
    await repo.songUrl(1);
    expect(seen[0]).toBe('');
  });

  it('setCookieProvider 之后每次请求都带 cookie，且实时读取而非快照', async () => {
    const seen: string[] = [];
    let live = '';
    const repo = new NeteaseRepository({ bridge: cookieBridge({ ...URL_BODY, ...REC_BODY }, seen) });
    repo.setCookieProvider(() => live);
    live = 'MUSIC_U=abc';
    await repo.songUrl(1);
    expect(seen[0]).toBe('MUSIC_U=abc');
    live = 'MUSIC_U=changed';
    await repo.recommendSongs();
    expect(seen[1]).toBe('MUSIC_U=changed');
  });

  it('构造参数 getCookie 也真的透传（补旧测试没验的那一环）', async () => {
    const seen: string[] = [];
    const repo = new NeteaseRepository({ bridge: cookieBridge(URL_BODY, seen), getCookie: () => 'MUSIC_U=ctor' });
    await repo.songUrl(1);
    expect(seen[0]).toBe('MUSIC_U=ctor');
  });

  it('auditionMs 用 freeTrialInfo 的真实秒区间，不再一律写死 30000', async () => {
    const mk = (freeTrialInfo: unknown) => new NeteaseRepository({
      bridge: {
        request: async () => ({
          ok: true,
          status: 200,
          ms: 1,
          body: { code: 200, data: [{ url: 'https://m/x.mp3', br: 320000, code: 200, fee: 1, freeTrialInfo }] },
        }),
      },
    });
    // 实测样本：end=48 → ffprobe 48.2s
    await expect(mk({ fragmentType: 1018, start: 0, end: 48 }).songUrl(1)).resolves.toMatchObject({ auditionMs: 48000 });
    await expect(mk(null).songUrl(1)).resolves.toMatchObject({ auditionMs: 0 });
    await expect(mk({ fragmentType: 1018 }).songUrl(1)).resolves.toMatchObject({ auditionMs: 30000 });
  });
});
