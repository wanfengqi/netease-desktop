import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import type { Song } from '../../data/normalize';
import { LoginRequiredError, useHomeStore, type DailyInput } from '../home';

/**
 * 每日推荐 × 登录态时序回归。
 *
 * 实测缺陷：首页 onMounted 调 loadDaily 时 config 还没从磁盘装载完（cookie 为空），
 * 区块落到 login-required 之后再无第二次机会 —— 已登录的用户永远看到"需要登录"。
 * 这里把 config mock 成 reactive，专门验证 watch 真的会自愈。
 *
 * 契约：是否"需要登录"由数据源判定（真实 netease 在 !cookie 时抛 LoginRequiredError），
 * store 只做归类 —— 假实现必须照抄这条契约，否则测的是 fake 而不是 store。
 * 另外 pinia 换实例不会停掉旧 store 的 watcher，所以断言一律用"本用例期间的增量"。
 */
const configState = reactive({
  cookie: '',
  source: 'netease' as 'netease' | 'migu',
  recent: [] as Song[],
});

vi.mock('../config', () => ({ useConfigStore: () => configState }));

function song(id: number): Song {
  return {
    source: 'netease', id, name: '推荐' + id, artistText: '歌手', artists: [{ name: '歌手' }],
    album: { name: '专辑', picUrl: '' }, duration: 269000, vip: true,
  };
}

const dailySongs = vi.fn(async (input: DailyInput): Promise<Song[]> => {
  if (!input.cookie) throw new LoginRequiredError('网易云每日推荐需要登录后使用');
  return [song(1), song(2)];
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * store setup 里的 watcher 挂在 pinia 自己的 EffectScope（_e）上；不 stop 就会跨用例继续响应
 * configState 变化，把"补拉了几次"这类断言测成用例总数。Pinia 4 没有公开 dispose，用 _e.stop()。
 */
let pinia: ReturnType<typeof createPinia> | null = null;
const stopScope = (p: ReturnType<typeof createPinia> | null): void => {
  if (!p) return;
  (p as unknown as { _e?: { stop?: () => void } })._e?.stop?.();
};

beforeEach(() => {
  stopScope(pinia);
  pinia = createPinia();
  setActivePinia(pinia);
  configState.cookie = '';
  configState.source = 'netease';
  dailySongs.mockClear();
});

afterEach(() => {
  stopScope(pinia);
  pinia = null;
});

describe('home store：登录态与每日推荐', () => {
  it('无 cookie：归类成 login-required（不是 error，也不是空白）', async () => {
    const home = useHomeStore();
    home.configure({ dailySongs });
    await home.loadDaily(true);
    expect(home.daily.status).toBe('login-required');
    expect(home.daily.error).toContain('需要登录');
  });

  it('cookie 晚到（config 异步装载 / 扫码登录）后自动补拉，无需用户手动刷新', async () => {
    const home = useHomeStore();
    home.configure({ dailySongs });
    await home.loadDaily(true);
    expect(home.daily.status).toBe('login-required');

    const before = dailySongs.mock.calls.length;
    configState.cookie = 'MUSIC_U=late';
    await flush();

    expect(dailySongs.mock.calls.length - before).toBe(1);
    expect(home.daily.status).toBe('ready');
    expect(home.daily.items).toHaveLength(2);
    // 时长是整曲毫秒数，不是试听片段
    expect(home.daily.items[0].duration).toBe(269000);
  });

  it('退出登录后收回旧推荐，不停留在上一次的数据', async () => {
    const home = useHomeStore();
    home.configure({ dailySongs });
    configState.cookie = 'MUSIC_U=a';
    await home.loadDaily(true);
    expect(home.daily.status).toBe('ready');

    configState.cookie = '';
    await flush();
    expect(home.daily.status).toBe('login-required');
    expect(home.daily.items).toHaveLength(0);
  });
});
