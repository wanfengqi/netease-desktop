import type { MiguBridge } from '../data/repository/migu';
import type { NeteaseBridge } from '../data/repository/netease';
import type { NextConfig } from '../data/config';

export interface AppVersions {
  electron: string;
  chrome: string;
  node: string;
  app: string;
}

export interface WindowApi {
  app: {
    versions: () => Promise<AppVersions>;
  };
  win: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  /** 网易云：主进程代理（子进程 + 白名单） */
  netease: NeteaseBridge;
  /** 咪咕：主进程 SDK 白名单 */
  migu: MiguBridge;
  /** 配置：新格式 next-config.json（首次启动从旧 config.json 迁移） */
  config: {
    load: () => Promise<NextConfig>;
    save: (patch: Partial<NextConfig>) => Promise<NextConfig>;
    migrateStatus: () => Promise<MigrateStatus>;
  };
}

export interface MigrateStatus {
  status: 'already-migrated' | 'pending-migration' | 'no-legacy';
  file: string;
  keys: string[];
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
