/**
 * 视图层的共享 UI 类型（S3）。
 *
 * 只有"跨视图重复出现"的交互载荷放在这里；业务数据结构一律来自 data/normalize。
 */
import type { Song } from '../data/normalize';

/** 右键菜单载荷：点在哪首歌、在窗口的哪个位置 */
export interface ContextMenuSelection {
  song: Song;
  x: number;
  y: number;
}
