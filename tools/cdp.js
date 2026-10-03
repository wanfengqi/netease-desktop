/* 极简 CDP 客户端 —— 无第三方依赖（Node 22+ 自带 WebSocket / fetch）
   用法：
     node tools/cdp.js list                        列出 targets
     node tools/cdp.js eval "<js 表达式>"           在页面里求值（支持 await）
     node tools/cdp.js shot <out.png> [--full]      截图
     node tools/cdp.js console                     读取已收集的控制台错误
*/
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || '9401';
const ROOT = path.join(__dirname, '..');

async function targets() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}

async function connect(match) {
  const list = await targets();
  const pages = list.filter(t => t.type === 'page');
  const t = match ? pages.find(p => (p.title || '').includes(match) || (p.url || '').includes(match)) : pages[0];
  if (!t) throw new Error('no page target; got: ' + pages.map(p => p.title + ' @ ' + p.url).join(' || '));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, logs, close: () => ws.close() };
}

async function evaluate(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error('eval failed: ' + (ex.exception?.description || ex.text));
  return r.result?.result?.value;
}

async function shot(send, out) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  return out;
}

// 等待某个表达式变为真
async function waitFor(send, expr, timeout = 15000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await evaluate(send, expr); } catch {}
    if (v) return true;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + expr);
    await new Promise(r => setTimeout(r, step));
  }
}

module.exports = { connect, evaluate, shot, waitFor, targets, PORT };

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const c = await connect(process.env.CDP_MATCH || undefined);
  try {
    if (cmd === 'list') {
      console.log(JSON.stringify(await targets(), null, 2));
    } else if (cmd === 'eval') {
      const v = await evaluate(c.send, args.join(' '));
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    } else if (cmd === 'eval-file') {
      // 从文件读脚本执行：避免 PowerShell 传递长/多行参数时被转义弄坏
      const src = fs.readFileSync(args[0], 'utf8');
      const v = await evaluate(c.send, src);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    } else if (cmd === 'shot') {
      await shot(c.send, args[0]);
      console.log('saved ' + args[0]);
    } else if (cmd === 'wait') {
      await waitFor(c.send, args.join(' '));
      console.log('ok');
    } else if (cmd === 'console') {
      console.log(c.logs.join('\n') || '(no errors)');
    } else {
      console.log('commands: list | eval <js> | shot <png> | wait <js> | console');
    }
  } finally { c.close(); }
}
if (require.main === module) {
  main().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
}
