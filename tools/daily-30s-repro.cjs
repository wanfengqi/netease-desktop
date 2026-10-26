/**
 * 每日推荐「只有 30s」复现脚本（无头：不启动 GUI，不动用户正在用的实例）
 *
 * 采证四件事：
 *  1) 每日推荐接口返回的时长字段（原始 dt / duration，毫秒）
 *  2) 取址接口返回的 url / br / size / fee / freeTrialInfo / privilege
 *  3) 该 url 的真实音频长度（ffprobe 实测，与接口标的时长对比）
 *  4) 带 cookie 与不带 cookie 的取址差异（区分「未登录」与「会员等级」）
 *
 * 用法：node tools/daily-30s-repro.cjs [曲目数，默认 5]
 * 安全：cookie 只读不打印；url 只打印主机与查询参数名。
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.REPRO_PORT || 3911);
const N = Number(process.argv[2] || 5);
const FFPROBE = 'C:\\Program Files\\ffmpeg\\ffmpeg\\bin\\ffprobe.exe';
const log = (...a) => console.log(...a);

function findEntry() {
  const base = path.join(ROOT, 'node_modules', 'NeteaseCloudMusicApi');
  for (const name of ['app.js', 'server.js', 'main.js']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到 API 入口');
}

function get(p, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p + '?' + qs, timeout: 20000 }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error('非 JSON: ' + buf.slice(0, 140))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

/** 只要端口能应答就算就绪（'/' 返回纯文本，不能按 JSON 解析判就绪） */
function health() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 3000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => (Date.now() - t0 > 30000
        ? reject(new Error('API 未就绪（端口 ' + PORT + ' 无应答）'))
        : setTimeout(tick, 300)));
    };
    tick();
  });
}

/** url 只留主机 + 参数名，避免把带 token 的完整地址抄进日志 */
const pv = (s, k) => (s.privilege && s.privilege[k] !== undefined ? String(s.privilege[k]) : '无');

function urlShape(u) {
  if (!u) return 'null';
  try {
    const x = new URL(u);
    return x.protocol + '//' + x.host + ' params:' + [...x.searchParams.keys()].join(',');
  } catch { return 'unparseable'; }
}

function realSeconds(u) {
  if (!u) return 'no-url';
  try {
    const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries',
      'format=duration,size,bit_rate', '-of', 'default=noprint_wrappers=1:nokey=1', u],
      { encoding: 'utf8', timeout: 60000 });
    const [dur, size, br] = out.trim().split(/\r?\n/);
    return { dur: Number(dur).toFixed(1), size, br };
  } catch (e) {
    return 'ffprobe-fail: ' + String(e.message).split('\n')[0].slice(0, 60);
  }
}

(async () => {
  const cfgPath = path.join(process.env.APPDATA || '', 'netease-desktop', 'next-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const cookie = typeof cfg.cookie === 'string' ? cfg.cookie : '';
  log('cookie: ' + (cookie ? 'len=' + cookie.length : '空（未登录）') + ' · source=' + cfg.source);

  const entry = findEntry();
  log('入口 ' + path.basename(entry) + ' 端口 ' + PORT);
  const child = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errTail = '';
  if (child.stdout) child.stdout.on('data', () => {});
  if (child.stderr) child.stderr.on('data', (b) => { errTail = (errTail + b.toString()).slice(-400); });

  try {
    await health();
    log('API 就绪 port=' + PORT);

    const st = await get('/login/status', { cookie });
    const prof = st && st.data && st.data.profile;
    log('\n[登录态] code=' + (st && st.code) + ' 已登录=' + Boolean(prof) +
      (prof ? ' nick=' + String(prof.nickname || '').slice(0, 8) + ' vipType=' + prof.vipType + ' level=' + (prof.level ?? '?') : ''));
    try {
      const v = await get('/user/vip', { cookie });
      log('[会员] ' + JSON.stringify((v && v.data && (v.data.vip || v.data)) || v).slice(0, 170));
    } catch (e) { log('[会员] 查询失败 ' + e.message); }

    const rec = await get('/recommend/songs', { cookie });
    const daily = (rec && rec.data && rec.data.dailySongs) || [];
    log('\n[每日推荐] code=' + (rec && rec.code) + ' 条数=' + daily.length);
    if (!daily.length) log('!! 每日推荐为空：' + JSON.stringify(rec).slice(0, 220));
    daily.slice(0, N).forEach((s, i) => {
      log('  #' + (i + 1) + ' id=' + s.id + ' 《' + String(s.name || '').slice(0, 16) + '》' +
        ' dt=' + (s.dt ?? '无') + ' duration=' + (s.duration ?? '无') +
        ' → ' + (((s.dt ?? s.duration) || 0) / 1000).toFixed(0) + 's' +
        ' fee=' + (s.fee ?? '无') + ' pv.fee=' + pv(s, 'fee') +
        ' st=' + pv(s, 'st') + ' pl=' + pv(s, 'pl') + ' dl=' + pv(s, 'dl'));
    });

    log('\n[取址与真实长度对照] level=exhigh 带 cookie');
    for (const s of daily.slice(0, N)) {
      const u1 = await get('/song/url/v1', { id: s.id, level: 'exhigh', cookie });
      const d = (u1 && u1.data && u1.data[0]) || {};
      const claimed = (((s.dt ?? s.duration) || 0) / 1000).toFixed(0);
      const real = realSeconds(d.url);
      log('  《' + String(s.name || '').slice(0, 14) + '》 code=' + d.code + ' fee=' + (d.fee ?? '?') +
        ' br=' + d.br + ' size=' + (d.size ?? '?') +
        ' freeTrialInfo=' + JSON.stringify(d.freeTrialInfo ?? null) +
        '\n     url=' + urlShape(d.url) +
        '\n     接口标 ' + claimed + 's vs 实测 ' + (typeof real === 'object' ? real.dur + 's (' + real.size + 'B @' + real.br + ')' : real));
    }

    log('\n[无 cookie 对照]');
    for (const s of daily.slice(0, 2)) {
      const u0 = await get('/song/url/v1', { id: s.id, level: 'exhigh' });
      const d = (u0 && u0.data && u0.data[0]) || {};
      const real = realSeconds(d.url);
      log('  《' + String(s.name || '').slice(0, 14) + '》 code=' + d.code +
        ' freeTrialInfo=' + JSON.stringify(d.freeTrialInfo ?? null) +
        ' 实测=' + (typeof real === 'object' ? real.dur + 's' : real));
    }

    log('\n[整曲对照] 搜索取一首 fee=0 的歌走同一条取址链路');
    const se = await get('/cloudsearch', { keywords: '钢琴曲 纯音乐', limit: 20, cookie });
    const list = (se && se.result && se.result.songs) || [];
    const free = list.find((x) => (x.fee ?? 1) === 0) || list[0];
    if (free) {
      const uf = await get('/song/url/v1', { id: free.id, level: 'exhigh', cookie });
      const d = (uf && uf.data && uf.data[0]) || {};
      const real = realSeconds(d.url);
      log('  《' + String(free.name || '').slice(0, 16) + '》 fee=' + free.fee +
        ' duration=' + free.duration + 'ms(' + ((free.duration || 0) / 1000).toFixed(0) + 's)' +
        ' freeTrialInfo=' + JSON.stringify(d.freeTrialInfo ?? null) +
        ' 实测=' + (typeof real === 'object' ? real.dur + 's' : real));
    } else { log('  没拿到对照曲目（搜索为空）'); }
  } catch (e) {
    log('复现失败: ' + e.message + (errTail ? '\nstderr: ' + errTail.slice(0, 260) : ''));
    process.exitCode = 1;
  } finally {
    child.kill();
  }
})();
