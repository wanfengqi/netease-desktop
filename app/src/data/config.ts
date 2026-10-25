/**
 * 配置的渲染层类型（S2）。
 *
 * 与 electron/storage/migrate.cjs 的 defaultConfig() 保持字段一致；
 * 这里不从 .cjs 推导类型（跨目录 import cjs 会把 node 类型拖进渲染层），
 * 而是手写一份，由 config.test.ts 断言两边字段一一对应。
 */
import type { Song, SongSource } from './normalize';
import type { PlayMode } from '../core/playmode';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface EqualizerConfig {
  enabled: boolean;
  bands: number[];
}

export interface NextConfig {
  version: number;
  source: SongSource;
  playMode: PlayMode;
  volume: number;
  muted: boolean;
  lyricOffset: number;
  equalizer: EqualizerConfig;
  favorites: Song[];
  recent: Song[];
  queue: Song[];
  queueIndex: number;
  searchHistory: string[];
  cookie: string;
  windowBounds: WindowBounds | null;
  /** 旧 config.json 里不认识但保留下来的键 */
  extra: Record<string, unknown>;
  /** 迁移自哪个文件；没迁移过为空串 */
  migratedFrom: string;
  updatedAt: number;
}

/** 迁移时被规范化掉的键（值非法）与保留的未知键 */
export interface MigrateReport {
  migrated: boolean;
  carried: string[];
  unknown: string[];
  dropped: string[];
}
