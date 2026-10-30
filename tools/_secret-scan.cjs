
const { execFileSync } = require('child_process');
const P = 'E:/Huancun/projects/pv-mad/netease-desktop';
const git = (a) => execFileSync('git', a, { cwd: P, encoding: 'utf8', maxBuffer: 1 << 28 });
const PATTERNS = [
  ['netease-cookie', /MUSIC_U\s*[=:]\s*[A-Za-z0-9]{16,}/],
  ['netease-nsid', /__csrf?_?token|NTES_SESS\s*[=:]\s*[A-Za-z0-9]{10,}/i],
  ['pacm-token', /pacmToken[^,\n]{0,10}[A-Za-z0-9]{24,}/],
  ['github-token', /(ghp|gho|ghs|github_pat)_[A-Za-z0-9]{20,}/],
  ['private-key', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['long-b64-assign', /(cookie|token|secret|password|apikey|api_key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{40,}["']/i],
];
const revs = ['HEAD', 'legacy-v1^{commit}'].map((r) => { try { return git(['rev-parse', r]).trim(); } catch { return null; } }).filter(Boolean);
const filesOf = (rev) => git(['ls-tree', '-r', '--name-only', rev]).split('\n').filter(Boolean);
const hits = [];
const seenFiles = new Set();
for (const rev of revs) {
  for (const f of filesOf(rev)) {
    if (/node_modules|\.png$|\.ico$|\.mp3$/.test(f)) continue;
    let blob = '';
    try { blob = git(['show', rev + ':' + f]); } catch { continue; }
    const lines = blob.split('\n');
    lines.forEach((ln, i) => {
      for (const [name, re] of PATTERNS) {
        if (re.test(ln)) hits.push({ rev: rev.slice(0, 7), file: f, line: i + 1, kind: name, sample: ln.trim().slice(0, 90) });
      }
    });
  }
  seenFiles.add(rev);
}
const allPaths = new Set();
for (const rev of revs) for (const f of filesOf(rev)) allPaths.add(f);
const suspiciousNames = [...allPaths].filter((f) => /config\.json$|\.env$|secret|credential|token|cookie/i.test(f));
console.log(JSON.stringify({ scannedRevs: revs.length, totalFiles: allPaths.size, hits: hits.slice(0, 40), hitCount: hits.length, suspiciousNames,
  historySize: (() => { try { return git(['count-objects', '-v']).split('\n').filter((l) => /size-pack|count/.test(l)).join(' | '); } catch { return ''; } })(),
  commitCount: (() => { try { return git(['rev-list', '--count', '--all']).trim(); } catch { return '?'; } })() }, null, 1));
