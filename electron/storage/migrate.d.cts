/**
 * migrate.cjs 的类型声明（S2）。
 *
 * 迁移逻辑是**纯函数**（不碰 fs / 不碰 electron），所以渲染层单测可以直接
 * import 它。这里只声明测试真正用到的那几个导出。
 */
export declare const CONFIG_VERSION: number;
export declare const KNOWN_KEYS: string[];
export declare const PLAY_MODES: string[];
export declare const SOURCES: string[];

export declare function defaultConfig(): Record<string, unknown>;

export declare function migrateLegacyConfig(raw: unknown): {
  config: Record<string, unknown>;
  report: {
    migrated: boolean;
    carried: string[];
    unknown: string[];
    dropped: string[];
  };
};
