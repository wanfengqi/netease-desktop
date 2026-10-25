/**
 * 取址协调器（S2）—— 修 S1 报告的竞态。
 *
 * 旧版 player.js 的 playAt 竞态：快速切歌时
 *   playAt(A) 发出取址请求 → playAt(B) 发出取址请求 → B 先回 → A 后回
 * A 的响应回来时没有任何"已过期"判定，直接写进 audio.src，
 * 结果就是"点 B 放 A"。
 *
 * 解法：单调递增 token。每次 resolve() 先自增并记住自己的 token，
 * await 回来后用 isCurrent(token) 判断是否还是当前请求，不是就丢弃。
 * 调用方（store/player）拿到 { token, url } 后再校验一次，
 * 这样**过期响应的判断不依赖时序假设**，只依赖 token 比较。
 */
import type { Song } from './normalize';

export interface ResolveResult {
  token: number;
  url: string | null;
  /** 取址失败的原因；成功或过期时为空 */
  error?: string;
}

export interface ResolveOptions {
  /** 单次取址的超时（毫秒） */
  timeoutMs?: number;
  /** 覆盖取址实现，测试用 */
  urlFor?: (song: Song) => Promise<string | null>;
}

export class UrlResolver {
  private token = 0;

  /** 当前令牌值（调试/测试用） */
  get current(): number {
    return this.token;
  }

  /** 让所有在途请求立即过期（例如切到另一首但还不想发新请求） */
  invalidate(): number {
    this.token += 1;
    return this.token;
  }

  /** token 是否仍是当前请求 */
  isCurrent(token: number): boolean {
    return token === this.token;
  }

  /**
   * 解析某首歌的播放地址。
   * 注意：**先自增 token，再发请求** —— 这样并发的两次调用里，
   * 后一次总是拿到更大的 token，先发的那次必然在返回时判定为过期。
   */
  async resolve(song: Song, options: ResolveOptions = {}): Promise<ResolveResult> {
    this.token += 1;
    const token = this.token;

    const picked = options.urlFor;
    if (!picked) {
      return { token, url: null, error: '未提供取址实现（urlFor）' };
    }

    try {
      const pending = picked(song);
      const url = options.timeoutMs && options.timeoutMs > 0
        ? await this.raceTimeout(pending, options.timeoutMs)
        : await pending;
      if (!this.isCurrent(token)) {
        // 过期响应：即使拿到了 url 也不能用，否则就是"点 B 放 A"
        return { token, url: null, error: '过期请求（已切歌）' };
      }
      return { token, url: url ?? null };
    } catch (err) {
      return {
        token,
        url: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private raceTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('取址超时（' + ms + 'ms）')), ms);
      task.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }
}
