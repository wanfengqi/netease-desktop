import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertMiguOk,
  assertNeteaseCode,
  clampTimeout,
  isRetryableStatus,
  TransportError,
  unwrapMigu,
  unwrapNetease,
  withRetry,
  withTimeout,
} from '../transport';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('transport: 超时', () => {
  it('withTimeout 在超时后抛可重试的 TransportError', async () => {
    const never = new Promise<string>(() => { /* 永不完结 */ });
    const pending = withTimeout(never, 1000, 'demo');
    const assertion = expect(pending).rejects.toBeInstanceOf(TransportError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(pending).rejects.toMatchObject({ retryable: true, name: 'TransportError' });
  });

  it('按时完成时不触发超时', async () => {
    const task = Promise.resolve('ok');
    await expect(withTimeout(task, 1000, 'demo')).resolves.toBe('ok');
  });

  it('clampTimeout 把非法值压回兜底，并夹在 1s-60s', () => {
    expect(clampTimeout(undefined, 5000)).toBe(5000);
    expect(clampTimeout(0, 5000)).toBe(5000);
    expect(clampTimeout(-1, 5000)).toBe(5000);
    expect(clampTimeout(Number.NaN, 5000)).toBe(5000);
    expect(clampTimeout(10, 5000)).toBe(1000);
    expect(clampTimeout(999999, 5000)).toBe(60000);
    expect(clampTimeout(3000, 5000)).toBe(3000);
  });
});

describe('transport: 重试', () => {
  it('可重试错误按指数退避重试后成功', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new TransportError({ message: 'boom', retryable: true });
        return 'ok';
      },
      { retries: 2, baseDelayMs: 100, delay: async (ms) => { delays.push(ms); } },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    // 指数退避：100 -> 200
    expect(delays).toEqual([100, 200]);
  });

  it('不可重试的业务错误立即抛出，不浪费重试', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new TransportError({ message: '未登录', retryable: false });
        },
        { retries: 5, baseDelayMs: 1, delay: async () => {} },
      ),
    ).rejects.toMatchObject({ message: '未登录', retryable: false });
    expect(calls).toBe(1);
  });

  it('重试耗尽后抛出最后一次错误', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new TransportError({ message: 'always', retryable: true });
        },
        { retries: 2, baseDelayMs: 10, delay: async () => {} },
      ),
    ).rejects.toMatchObject({ message: 'always' });
    expect(calls).toBe(3); // 1 次首发 + 2 次重试
  });

  it('重试等待真的走定时器（用 fake timer 验证不影响时序）', async () => {
    const delays: number[] = [];
    let calls = 0;
    const promise = withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new TransportError({ message: 'flaky', retryable: true });
        return 'done';
      },
      { retries: 1, baseDelayMs: 500 },
    );
    // 首次失败后进入 500ms 退避
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe('done');
    expect(calls).toBe(2);
    expect(delays).toEqual([]);
  });

  it('普通网络异常（非 TransportError）默认可重试', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('ECONNRESET');
        return 'ok';
      },
      { retries: 1, baseDelayMs: 1, delay: async () => {} },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('transport: 错误归一', () => {
  it('isRetryableStatus 只认 0 / 429 / 5xx', () => {
    expect(isRetryableStatus(0)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('unwrapNetease 成功时返回 body', () => {
    expect(unwrapNetease({ ok: true, status: 200, body: { code: 200 }, ms: 1 }, 'x')).toEqual({ code: 200 });
  });

  it('unwrapNetease 5xx 标为可重试，4xx 标为不可重试', () => {
    try {
      unwrapNetease({ ok: false, status: 503, body: { error: 'down' }, ms: 1 }, 'x');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(TransportError);
      expect((e as TransportError).retryable).toBe(true);
      expect((e as TransportError).status).toBe(503);
    }
    try {
      unwrapNetease({ ok: false, status: 404, body: {}, ms: 1 }, 'x');
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as TransportError).retryable).toBe(false);
    }
  });

  it('unwrapMigu 失败时抛可重试错误', () => {
    expect(unwrapMigu({ ok: true, data: { a: 1 } }, 'm')).toEqual({ a: 1 });
    expect(() => unwrapMigu({ ok: false, error: 'SDK 崩溃' }, 'm')).toThrowError(/SDK 崩溃/);
  });

  it('assertNeteaseCode 拦住 HTTP 200 + 业务码错误', () => {
    expect(() => assertNeteaseCode({ code: 200 }, 'x')).not.toThrow();
    expect(() => assertNeteaseCode({ code: 301, msg: '未登录' }, 'x'))
      .toThrowError(/业务码 301 未登录/);
    // 没有 code 字段时不误判
    expect(() => assertNeteaseCode({ foo: 1 }, 'x')).not.toThrow();
  });

  it('assertMiguOk 只认字符串 000000', () => {
    expect(() => assertMiguOk({ code: '000000' }, 'm')).not.toThrow();
    expect(() => assertMiguOk({ code: '200205', info: '手机号和IMEI不能同时为空' }, 'm'))
      .toThrowError(/200205 手机号和IMEI不能同时为空/);
    expect(() => assertMiguOk({ data: [] }, 'm')).not.toThrow();
  });
});
