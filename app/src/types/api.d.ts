import type { MiguBridge } from '../data/repository/migu';
import type { NeteaseBridge } from '../data/repository/netease';
import type { NextConfig } from '../data/config';
import type { DownloadItem, DownloadsState, DownloadRecord, LocalState, ScanProgress, ScanResult } from './offline';
import type { DownloadItem, DownloadsState, DownloadRecord, LocalState, ScanProgress, ScanResult } from './offline';

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
  dialog: { chooseDirectory: (title?: string) => Promise<string | null> };
  local: {
    state: () => Promise<LocalState>;
    addDirectory: (directory: string) => Promise<LocalState>;
    removeDirectory: (directory: string) => Promise<LocalState>;
    scan: (options?: { cover?: boolean; maxDepth?: number }) => Promise<ScanResult>;
    cancel: () => Promise<boolean>;
    mediaUrl: (localPath: string) => Promise<string | null>;
    onProgress: (handler: (progress: ScanProgress) => void) => () => void;
  };
  downloads: {
    list: () => Promise<DownloadsState>;
    setDirectory: (directory: string) => Promise<DownloadsState>;
    start: (items: DownloadItem[]) => Promise<DownloadsState>;
    cancel: (id: string) => Promise<boolean>;
    retry: (id: string, url: string) => Promise<DownloadsState>;
    remove: (id: string, deleteFile: boolean) => Promise<DownloadsState>;
    onProgress: (handler: (payload: { ok: boolean; record: DownloadRecord }) => void) => () => void;
  };
  dialog: { chooseDirectory: (title?: string) => Promise<string | null> };
  local: {
    state: () => Promise<LocalState>;
    addDirectory: (directory: string) => Promise<LocalState>;
    removeDirectory: (directory: string) => Promise<LocalState>;
    scan: (options?: { cover?: boolean; maxDepth?: number }) => Promise<ScanResult>;
    cancel: () => Promise<boolean>;
    mediaUrl: (localPath: string) => Promise<string | null>;
    onProgress: (handler: (progress: ScanProgress) => void) => () => void;
  };
  downloads: {
    list: () => Promise<DownloadsState>;
    setDirectory: (directory: string) => Promise<DownloadsState>;
    start: (items: DownloadItem[]) => Promise<DownloadsState>;
    cancel: (id: string) => Promise<DownloadsState>;
    retry: (id: string, url: string) => Promise<DownloadsState>;
    remove: (id: string, deleteFile: boolean) => Promise<DownloadsState>;
    onProgress: (handler: (payload: { ok: boolean; record: DownloadRecord }) => void) => () => void;
  };
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
