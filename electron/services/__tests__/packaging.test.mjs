import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('production entry, renderer pages and application icons exist', () => {
  assert.equal(pkg.main, 'electron/main.cjs');
  for (const file of [pkg.main, 'electron/preload.cjs', 'dist/index.html', 'dist/lyric.html', 'dist/mini.html', 'dist/icon.png', 'assets/icon.ico', 'assets/icon.png']) {
    assert.ok(fs.statSync(path.join(root, file)).size > 0, file + ' must exist and be non-empty');
  }
});

test('packaging includes only the new application and builds renderer first', () => {
  for (const name of ['build:dir', 'build']) assert.match(pkg.scripts[name], /^npm run build:renderer && electron-builder/);
  for (const pattern of ['electron/**/*', 'dist/**/*', 'assets/**/*', 'node_modules/**/*']) assert.ok(pkg.build.files.includes(pattern));
  for (const pattern of ['!legacy/**', '!docs/**', '!shots/**', '!tools/**', '!electron/**/__tests__/**']) assert.ok(pkg.build.files.includes(pattern));
  assert.equal(pkg.build.nsis.createDesktopShortcut, false);
  assert.equal(pkg.build.productName, '网易云音乐桌面版');
});

test('child-process and ESM dependencies are unpacked and window targets are production-relative', () => {
  // API 子进程是普通 Node，看不见 app.asar 内部：它本体和它的全部运行时依赖
  // 都必须在 asar 之外，否则子进程起来就 Cannot find module 'axios'（打包实测踩过）。
  const unpack = pkg.build.asarUnpack;
  const wholeTree = unpack.includes('node_modules/**/*');
  let listed = false;
  try {
    const childManifest = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules/NeteaseCloudMusicApi/package.json'), 'utf8'),
    );
    const needed = ['NeteaseCloudMusicApi', ...Object.keys(childManifest.dependencies || {})];
    listed = needed.every((m) => unpack.includes(`node_modules/${m}/**/*`));
  } catch {
    listed = false;
  }
  assert.ok(
    wholeTree || listed,
    'asarUnpack 必须覆盖 API 子进程及其依赖：整包 node_modules/**/* 或逐个列出（实际 ' + JSON.stringify(unpack) + '）',
  );
  for (const file of ['electron/main.cjs', 'electron/windows/lyricWin.cjs', 'electron/windows/miniMode.cjs']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /dist/);
    assert.doesNotMatch(source, /loadFile\([^)]*src/);
  }
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const tray = fs.readFileSync(path.join(root, 'electron/tray.cjs'), 'utf8');
  assert.match(main, /'assets', 'icon.ico'/);
  assert.match(tray, /'assets','icon.ico'/);
});
