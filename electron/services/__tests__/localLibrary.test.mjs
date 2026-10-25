import { vi } from 'vitest';
vi.mock('electron', () => ({ protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }, net: { fetch: vi.fn() } }));
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mm = require('music-metadata');
const { LocalLibrary } = require('../localLibrary.cjs');
function wav(ms = 500) { const rate = 8000; const samples = rate * ms / 1000; const buffer = Buffer.alloc(44 + samples * 2); buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40); return buffer; }
let root; let library;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 's7-scan-')); library = new LocalLibrary(); library.init(path.join(root, 'userdata')); await fs.mkdir(path.join(root, 'music', 'nested'), { recursive: true }); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
describe('local library real filesystem scanning', () => {
  it('scans nested valid/name-fallback files and isolates corrupt input; then reuses unchanged cache', async () => {
    await fs.writeFile(path.join(root, 'music', 'Artist - Tagged.wav'), wav());
    await fs.writeFile(path.join(root, 'music', 'nested', 'No Metadata.wav'), wav());
    await fs.writeFile(path.join(root, 'music', 'broken.mp3'), Buffer.from('not audio'));
    await fs.mkdir(path.join(root, 'music', 'node_modules')); await fs.writeFile(path.join(root, 'music', 'node_modules', 'ignored.wav'), wav());
    await library.addDirectory(path.join(root, 'music'));
    const first = await library.scan({ cover: false });
    expect(first.total).toBe(3); expect(first.songs).toHaveLength(2); expect(first.failed).toBe(1); expect(first.failures[0].path).toMatch(/broken\.mp3$/); expect(first.songs.map((s) => s.name).sort()).toEqual(['No Metadata', 'Tagged']);
    const second = await library.scan({ cover: false }); expect(second.reused).toBe(2); expect(second.parsed).toBe(0); expect(second.failed).toBe(1);
    const nested = path.join(root, 'music', 'nested', 'No Metadata.wav'); const stat = await fs.stat(nested); await fs.utimes(nested, new Date(), new Date(stat.mtimeMs + 5000));
    const third = await library.scan({ cover: false }); expect(third.parsed).toBe(1); expect(third.reused).toBe(1);
  });
  it('cancels between metadata reads without marking success', async () => {
    for (let i = 0; i < 4; i += 1) await fs.writeFile(path.join(root, 'music', 'track' + i + '.wav'), wav());
    await library.addDirectory(path.join(root, 'music'));
    const original = mm.parseFile; let calls = 0; mm.parseFile = async (...args) => { calls += 1; if (calls === 1) setImmediate(() => library.cancel()); return original(...args); };
    try { const result = await library.scan({ cover: false }); expect(result.cancelled).toBe(true); expect(result.scanned).toBeLessThan(4); } finally { mm.parseFile = original; }
  });
  it('enforces recursion depth', async () => { await fs.mkdir(path.join(root, 'music', 'a', 'b'), { recursive: true }); await fs.writeFile(path.join(root, 'music', 'a', 'b', 'deep.wav'), wav()); await library.addDirectory(path.join(root, 'music')); const result = await library.scan({ maxDepth: 1 }); expect(result.total).toBe(0); });
});
