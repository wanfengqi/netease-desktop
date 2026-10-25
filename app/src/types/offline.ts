import type { Song } from '../data/normalize';
export interface ScanProgress { current: number; total: number; parsed: number; reused: number; failed: number; cancelled: boolean; }
export interface LocalState { ok: boolean; directories: string[]; songs: Song[]; scanning: boolean; progress: ScanProgress | null; error?: string; }
export interface ScanResult extends LocalState, ScanProgress { failures: { path: string; error: string }[]; }
export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
export interface DownloadRecord { id: string; song: Song; status: DownloadStatus; progress: number; received: number; total: number; localPath: string; size: number; sha256: string; error: string; createdAt: number; updatedAt: number; }
export interface DownloadItem { song: Song; url: string; }
export interface DownloadsState { ok: boolean; directory: string; records: DownloadRecord[]; error?: string; added?: DownloadRecord[]; }
