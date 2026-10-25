import { describe, expect, it } from 'vitest';
import { migrateLegacyConfig, defaultConfig, KNOWN_KEYS } from '../../../../electron/storage/migrate.cjs';

/**
 * 样本刻意贴紧实测的旧 config.json（%APPDATA%/netease-desktop/config.json，13 个键）：
 * cookie / source / playMode / favorites / searchHistory / windowBounds /
 * recent / queue / queueIndex / lyricOffset / volume / equalizer / muted
 */
const LEGACY_SAMPLE = {
  cookie: 'MUSIC_U=deadbeef; __csrf=abc123',
  source: 'migu',
  playMode: 'shuffle',
  favorites: [
    { id: 186016, source: 'netease', name: '晴天', artistText: '周杰伦' },
    { id: '600902000006889366', source: 'migu', name: '晴天', artistText: '周杰伦' },
  ],
  searchHistory: ['周杰伦', '晴天', ''],
  windowBounds: { x: 120, y: 80, width: 1400, height: 900 },
  recent: [{ id: 1, source: 'netease' }],
  queue: [{ id: 1, source: 'netease' }, { id: 2, source: 'netease' }],
  queueIndex: 1,
  lyricOffset: 250,
  volume: 0.65,
  equalizer: { enabled: true, bands: [-2, 0, 3, 1, 0, -1, 2, 0, 0, 0] },
  muted: true,
};

describe('config: 旧 config.json 迁移', () => {
  it('13 个旧键全部保留，一个都不丢', () => {
    const { report } = migrateLegacyConfig(LEGACY_SAMPLE);
    expect(report.migrated).toBe(true);
    expect(new Set(report.carried)).toEqual(new Set(Object.keys(LEGACY_SAMPLE)));
    expect(report.carried).toHaveLength(13);
    expect(report.unknown).toEqual([]);
    expect(report.dropped).toEqual([]);
  });

  it('迁移后的值正确（逐键比对）', () => {
    const { config } = migrateLegacyConfig(LEGACY_SAMPLE);
    expect(config.cookie).toBe(LEGACY_SAMPLE.cookie);
    expect(config.source).toBe('migu');
    expect(config.playMode).toBe('shuffle');
    expect(config.volume).toBe(0.65);
    expect(config.muted).toBe(true);
    expect(config.lyricOffset).toBe(250);
    expect(config.queueIndex).toBe(1);
    expect(config.windowBounds).toEqual({ x: 120, y: 80, width: 1400, height: 900 });
    expect(config.equalizer).toEqual({ enabled: true, preset: 'flat', bands: LEGACY_SAMPLE.equalizer.bands });
    expect((config.favorites as unknown[])).toHaveLength(2);
    expect((config.queue as unknown[])).toHaveLength(2);
    expect((config.recent as unknown[])).toHaveLength(1);
    // 空字符串历史项被剔除
    expect(config.searchHistory).toEqual(['周杰伦', '晴天']);
  });

  it('未知键不丢，原样进 extra', () => {
    const { config, report } = migrateLegacyConfig({
      ...LEGACY_SAMPLE,
      futureFeature: { a: 1 },
      someNumber: 7,
    });
    expect(report.unknown).toEqual(['futureFeature', 'someNumber']);
    expect(config.extra).toEqual({ futureFeature: { a: 1 }, someNumber: 7 });
  });

  it('非法值被规范化但记录在 dropped 里（不静默吞掉）', () => {
    const { config, report } = migrateLegacyConfig({
      source: 'kugou',
      playMode: 'bogus',
      volume: 5,
    });
    expect(config.source).toBe('netease'); // 回落默认
    expect(config.playMode).toBe('list');
    expect(config.volume).toBe(1); // 夹在 0-1
    expect(report.dropped).toEqual(['source', 'playMode']);
  });

  it('queueIndex 越界时夹回队列末尾，避免"记住下标但队列变短"崩掉', () => {
    const { config } = migrateLegacyConfig({ queue: [{ id: 1 }], queueIndex: 99 });
    expect(config.queueIndex).toBe(0);
    const { config: empty } = migrateLegacyConfig({ queue: [], queueIndex: 5 });
    expect(empty.queueIndex).toBe(-1);
  });

  it('缺 id 的歌曲被剔除', () => {
    const { config } = migrateLegacyConfig({ favorites: [{ id: 1 }, { name: 'no-id' }, null, 'x'] });
    expect(config.favorites).toEqual([{ id: 1 }]);
  });

  it('windowBounds 缺宽高时归 null（不产生半个窗口尺寸）', () => {
    expect(migrateLegacyConfig({ windowBounds: { x: 1, y: 2 } }).config.windowBounds).toBeNull();
    expect(migrateLegacyConfig({ windowBounds: { width: 100, height: 100 } }).config.windowBounds)
      .toEqual({ width: 560, height: 360 }); // 夹到最小可用尺寸
  });

  it('垃圾输入不炸：null / 数组 / 字符串都回落默认配置', () => {
    for (const bad of [null, undefined, [], 'oops', 42]) {
      const { config, report } = migrateLegacyConfig(bad);
      expect(report.migrated).toBe(false);
      expect(config).toEqual(defaultConfig());
    }
  });

  it('新格式字段与 defaultConfig 对齐（防止两边字段漂移）', () => {
    const { config } = migrateLegacyConfig(LEGACY_SAMPLE);
    expect(Object.keys(config).sort()).toEqual(Object.keys(defaultConfig()).sort());
    expect(config.version).toBe(2);
  });

  it('KNOWN_KEYS 覆盖实测的 13 个旧键', () => {
    expect(KNOWN_KEYS).toEqual(Object.keys(LEGACY_SAMPLE));
  });
});
