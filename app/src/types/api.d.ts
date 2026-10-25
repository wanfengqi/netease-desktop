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
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
