/**
 * repository 出口（S2）。
 *
 * 默认单例在 Electron 环境里读 window.api（preload 白名单），
 * 测试/非 Electron 环境请自行 new 并注入 bridge。
 */
export { NeteaseRepository } from './netease';
export type { NeteaseBridge, NeteaseRepoOptions } from './netease';
export { MiguRepository } from './migu';
export type { MiguBridge, MiguRepoOptions } from './migu';
export * from './types';

import { NeteaseRepository } from './netease';
import { MiguRepository } from './migu';

/** 应用内共享实例；cookie 通过 setCookieProvider 注入，渲染层不自己持久化 */
export const netease = new NeteaseRepository();
export const migu = new MiguRepository();
