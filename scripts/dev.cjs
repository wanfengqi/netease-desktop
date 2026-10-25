// `npm run dev` 的编排脚本：起 Vite dev server -> 注入 URL -> 拉起 Electron 新主进程。
// 用 .cjs 是为了在 "type": "commonjs" 的包里直接 require，不改动 package.json 的 type。
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createServer } = require('vite');

const ROOT = path.join(__dirname, '..');

async function main() {
  const server = await createServer({ configFile: path.join(ROOT, 'vite.config.mts') });
  await server.listen();

  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    throw new Error('Vite dev server 未返回可用的 local URL');
  }
  console.log('[dev] vite ready at ' + url);

  const electronBin = require('electron');
  const electronArgs = [];
  if (process.env.DEV_CDP) electronArgs.push('--remote-debugging-port=' + process.env.DEV_CDP);
  if (process.env.DEV_USER_DATA) electronArgs.push('--user-data-dir=' + path.resolve(process.env.DEV_USER_DATA));
  if (process.env.DEV_MUTE_AUDIO === '1') electronArgs.push('--mute-audio');
  electronArgs.push(path.join(ROOT, 'electron', 'main.cjs'));
  const child = spawn(electronBin, electronArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });

  const shutdown = async (code) => {
    await server.close().catch(() => {});
    process.exit(code ?? 0);
  };

  child.on('close', (code) => {
    console.log('[dev] electron exited with code ' + code);
    shutdown(code ?? 0);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      child.kill();
      shutdown(0);
    });
  }
}

main().catch((err) => {
  console.error('[dev] failed:', err);
  process.exit(1);
});
