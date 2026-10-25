/* 打包 asar 取证：头部元数据 + 内容字符串（extractFile 在 Windows 下有路径怪癖，直接读二进制） */
const fs = require('fs');
const f = 'release/win-unpacked/resources/app.asar';
const buf = fs.readFileSync(f);
const headerSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));
const has = (...segs) => {
  let n = header;
  for (const s of segs) { n = n && n.files && n.files[s]; }
  return !!n;
};
console.log('electron/main.cjs:', has('electron', 'main.cjs'), '| preload:', has('electron', 'preload.cjs'));
console.log('dist/index.html:', has('dist', 'index.html'), '| lyric:', has('dist', 'lyric.html'), '| mini:', has('dist', 'mini.html'));
console.log('assets/icon.ico:', has('assets', 'icon.ico'));
console.log('legacy dir present:', !!header.files.legacy, '| old src dir present:', !!header.files.src);
const txt = buf.toString('utf8');
console.log('bundle_has_exit_toggle:', txt.includes('退出迷你模式'));
console.log('html_title_new:', txt.includes('网易云音乐桌面版</title>'));
console.log('no_refactor_title:', !txt.includes('重构版</title>'));
console.log('unpacked_modules:', fs.readdirSync('release/win-unpacked/resources/app.asar.unpacked/node_modules').length);
console.log('axios_unpacked:', fs.existsSync('release/win-unpacked/resources/app.asar.unpacked/node_modules/axios/package.json'));
