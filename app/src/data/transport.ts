/**
 * 传输层（S2）：统一错误处理 + 重试 + 超时。
 *
 * 架构评审明确要求的三件事，这里各占一个函数：
 *  1. **错误处理**：主进程永远返回 { ok, status, body }，业务错误与传输错误
 *     在这里被归一成 TransportError —— repository 只判一种异常。
 *  2. **重试**：只重试"值得重试"的（网络中断、超时、5xx、429）。
 *     业务错误（如网易云 code=301 未登录）重试一万次也一样，直接抛。
 *  3. **超时**：主进程侧有 AbortSignal.timeout，渲染层再加一道闸 ——
 *     主进程卡死（子进程挂起、IPC 无响应）时渲染层不能一起挂。
 */

/** 主进程 netease:request 的返回结构（与 electron/services/neteaseApi.cjs 对齐） */
export interface NeteaseRequestResult {
  ok: boolean;
  status: number;
  body: unknown;
  ms: number;
}

/** 主进程 migu:call 的返回结构 */
export interface MiguCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface TransportErrorInit {
  message: string;
  /** http 状态；0 表示没拿到响应（网络/超时/未就绪） */
  status?: number;
  /** 是否是"可以重试"的错误 */
  retryable?: boolean;
  cause?: unknown;
}

export class TransportError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(init: TransportErrorInit) {
    super(init.message);
    this.name = 'TransportError';
    this.status = init.status ?? 0;
    this.retryable = init.retryable ?? false;
    this.cause = init.cause;
  }
}

/** 允许的最小/最大超时，避免调用方传 0 或 0.5 造成诡异行为 */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;

export function clampTimeout(ms: number | undefined, fallback: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms)));
}

/** 给任意 promise 套一个超时闸；超时抛 retryable 的 TransportError */
export function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransportError({ message: label + ' 超时（' + ms + 'ms）', retryable: true }));
    }, ms);
    task.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** 指数退避的等待。测试里可以传 0 让它不真的等。 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries: number;
  /** 首次重试等待；之后翻倍 */
  baseDelayMs: number;
  /** 供测试注入，默认 sleep */
  delay?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 2, baseDelayMs: 300 };

/** 判断是否值得重试：网络错误 / 超时 / 5xx / 429 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * 带重试地执行一个任务。
 * 只对 TransportError.retryable 或普通网络异常重试，业务错误立即抛出。
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY, ...options };
  const wait = opts.delay ?? sleep;
  const retries = Math.max(0, opts.retries);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof TransportError ? err.retryable : true;
      if (!retryable || attempt === retries) break;
      await wait(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new TransportError({ message: String(lastError) });
}

/** 把主进程 netease:request 的返回转成"要么数据、要么 TransportError" */
export function unwrapNetease(
  result: NeteaseRequestResult | undefined | null,
  label: string,
): unknown {
  if (!result || typeof result !== 'object') {
    throw new TransportError({ message: label + ': 主进程未返回结果', retryable: true });
  }
  if (result.ok) return result.body;
  const body = result.body as { error?: string; msg?: string; message?: string } | null | undefined;
  const detail = body?.error ?? body?.msg ?? body?.message ?? '';
  throw new TransportError({
    message: label + ': HTTP ' + result.status + (detail ? ' ' + detail : ''),
    status: result.status,
    retryable: isRetryableStatus(result.status),
  });
}

/** 把主进程 migu:call 的返回转成"要么数据、要么 TransportError" */
export function unwrapMigu(result: MiguCallResult | undefined | null, label: string): unknown {
  if (!result || typeof result !== 'object') {
    throw new TransportError({ message: label + ': 主进程未返回结果', retryable: true });
  }
  if (result.ok) return result.data;
  throw new TransportError({
    message: label + ': ' + (result.error ?? '未知错误'),
    retryable: true,
  });
}

/**
 * 网易云业务码检查。NeteaseCloudMusicApi 失败时仍返回 HTTP 200 + code != 200，
 * 所以传输成功不等于业务成功 —— 这一层必须再判一次。
 */
export function assertNeteaseCode(body: unknown, label: string, allowed: number[] = [200]): void {
  const code = (body as { code?: number } | null | undefined)?.code;
  if (typeof code === 'number' && !allowed.includes(code)) {
    const msg = (body as { msg?: string; message?: string }).msg
      ?? (body as { message?: string }).message
      ?? '';
    throw new TransportError({
      message: label + ': 业务码 ' + code + (msg ? ' ' + msg : ''),
      status: 200,
      retryable: false,
    });
  }
}

/** 咪咕业务码：成功是字符串 '000000' */
export function assertMiguOk(body: unknown, label: string): void {
  const code = (body as { code?: string } | null | undefined)?.code;
  if (typeof code === 'string' && code !== '000000') {
    const info = (body as { info?: string }).info ?? '';
    throw new TransportError({
      message: label + ': 咪咕返回 ' + code + (info ? ' ' + info : ''),
      retryable: false,
    });
  }
}
