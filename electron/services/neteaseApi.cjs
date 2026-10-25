/**
 * NeteaseCloudMusicApi 子进程管理 + 反向代理（S2）。
 *
 * 与旧版 src/main.js 的差异（都是刻意的）：
 *  1. 端口段用 3500-3600，旧版用 3300-3400 —— 两版同时跑也不会互相抢端口。
 *  2. 不再做 slimPayload 瘦身：瘦身下放到渲染层 repository（每个方法自带 picker），
 *     主进程只负责"转发 + 超时 + 错误归一"，不再按 path 分支。
 *  3. 状态可查询（ready/port/pid），proxy 在未就绪时先做一次有界等待。
 */
'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT_RANGE_START = Number(process.env.NETEASE_API_PORT_START || 3500);
const PORT_RANGE_END = Number(process.env.NETEASE_API_PORT_END || 3600);
const BOOT_TIMEOUT_MS = 25000;
const REQUEST_TIMEOUT_MS = 20000;

let child = null;
let port = 0;
let ready = false;
let bootPromise = null;
let logBudget = 200;

function log(...args) {
  if (logBudget > 0) console.log('[netease]', ...args);
  else if (logBudget === 0) { logBudget = -1; console.log('[netease] (日志已达上限，静默)'); }
}

/** 打包后 asar 内的文件 spawn 不起来，优先用 asarUnpack 出来的副本 */
function findEntry(appPath) {
  const roots = [];
  if (typeof appPath === 'string' && appPath) {
    roots.push(appPath.replace('app.asar', 'app.asar.unpacked'), appPath);
  }
  roots.push(path.join(__dirname, '..', '..'));
  for (const root of roots) {
    for (const name of ['app.js', 'server.js']) {
      const candidate = path.join(root, 'node_modules', 'NeteaseCloudMusicApi', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function isPortFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(p, '127.0.0.1');
  });
}

async function pickFreePort(start = PORT_RANGE_START, end = PORT_RANGE_END) {
  for (let p = start; p <= end; p += 1) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('端口段 ' + start + '-' + end + ' 全部被占用');
}

function spawnChild(entry, chosenPort) {
  const proc = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(chosenPort), ELECTRON_RUN_AS_NODE: '1' },
    cwd: path.dirname(entry),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // 节流：API 日志量大时 pipe 缓冲写满会阻塞子进程，必须持续消费并限量
  const onChunk = (tag) => (buf) => {
    if (logBudget <= 0) return;
    logBudget -= 1;
    const text = buf.toString().trim().slice(0, 400);
    if (text) log(tag, text);
  };
  proc.stdout.on('data', onChunk('[api]'));
  proc.stderr.on('data', onChunk('[api:err]'));
  proc.on('exit', (code) => {
    log('API 子进程退出 code=' + code);
    ready = false;
    child = null;
  });
  return proc;
}

async function waitForHealth(chosenPort, timeoutMs = BOOT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      log('API 子进程已退出，放弃等待');
      return false;
    }
    try {
      const res = await fetch('http://127.0.0.1:' + chosenPort + '/', {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status >= 200 && res.status < 500) return true;
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * 启动子进程并等到健康。幂等：重复调用返回同一个 promise。
 * @param {string} [appPath] app.getAppPath() 的结果，打包场景用于找 asar.unpacked
 */
function ensureReady(appPath) {
  if (ready) return Promise.resolve(true);
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const entry = findEntry(appPath);
      if (!entry) {
        log('未找到 NeteaseCloudMusicApi 入口，跳过自动启动');
        return false;
      }
      port = await pickFreePort();
      log('选用端口 ' + port);
      child = spawnChild(entry, port);
      log('已拉起 NeteaseCloudMusicApi 子进程 pid=' + child.pid + ' port=' + port);
      const ok = await waitForHealth(port);
      ready = ok;
      log(ok ? 'API 就绪，端口 ' + port : '等待 API 就绪超时（' + BOOT_TIMEOUT_MS + 'ms）');
      return ok;
    } catch (err) {
      log('启动失败: ' + err.message);
      ready = false;
      return false;
    } finally {
      bootPromise = null;
    }
  })();
  return bootPromise;
}

function status() {
  return {
    ready,
    port,
    pid: child ? child.pid : 0,
    portRange: [PORT_RANGE_START, PORT_RANGE_END],
  };
}

function normalizeParams(params) {
  const out = [];
  if (!params || typeof params !== 'object') return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') out.push([k, String(v)]);
  }
  return out;
}

/**
 * 代理一次 GET 请求。**不做任何按 path 的瘦身分支** —— 瘦身在渲染层 repository。
 * @param {{ path?: string, params?: Record<string, unknown>, cookie?: string, timeoutMs?: number }} req
 * @returns {Promise<{ ok: boolean, status: number, body: unknown, ms: number }>}
 */
async function request(req) {
  const startedAt = Date.now();
  const apiPath = req && typeof req.path === 'string' ? req.path : '';
  if (!apiPath.startsWith('/')) {
    return { ok: false, status: 0, body: { error: '非法 path: ' + apiPath }, ms: 0 };
  }
  const alive = await ensureReady();
  if (!alive) {
    return { ok: false, status: 0, body: { error: 'NeteaseCloudMusicApi 未就绪' }, ms: Date.now() - startedAt };
  }
  const url = new URL('http://127.0.0.1:' + port + apiPath);
  for (const [k, v] of normalizeParams(req.params)) url.searchParams.set(k, v);
  if (typeof req.cookie === 'string' && req.cookie) url.searchParams.set('cookie', req.cookie);

  const timeoutMs = Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : REQUEST_TIMEOUT_MS;
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 dsh-netease-desktop' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
    const ms = Date.now() - startedAt;
    log('<- ' + apiPath + ' ' + res.status + ' ' + (text.length / 1024).toFixed(0) + 'KB ' + ms + 'ms');
    return { ok: res.ok, status: res.status, body, ms };
  } catch (err) {
    const ms = Date.now() - startedAt;
    log('x ' + apiPath + ' 失败 ' + ms + 'ms: ' + err.message);
    return { ok: false, status: 0, body: { error: String(err.message) }, ms };
  }
}

function stop() {
  if (!child) return;
  try { child.kill(); } catch { /* 已退出 */ }
  child = null;
  ready = false;
  port = 0;
}

module.exports = { ensureReady, request, status, stop, pickFreePort, findEntry };
