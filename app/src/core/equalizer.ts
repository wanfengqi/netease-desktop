import { EQ_FREQUENCIES, normalizeEqualizer, type EqualizerSettings } from './settings';
import type { Song } from '../data/normalize';
import type { AudioElementLike } from './audio';
export interface BiquadLike { type: string; frequency: { value: number }; Q: { value: number }; gain: { value: number }; connect(node: unknown): void; disconnect(): void }
export interface AudioContextLike { state: string; destination: unknown; createMediaElementSource(el: AudioElementLike): AudioNodeLike; createBiquadFilter(): BiquadLike; resume(): Promise<void>; close(): Promise<void> }
export interface AudioNodeLike { connect(node: unknown): void; disconnect(): void }
export interface EqualizerSnapshot { enabled: boolean; ready: boolean; active: boolean; broken: boolean; error: string; retryCount: number; gains: number[] }
export const EQ_MAX_MEDIA_RETRIES = 1;
export function shouldRetryEqualizer(code: number, active: boolean, retries: number): boolean { return code === 4 && active && retries < EQ_MAX_MEDIA_RETRIES; }
export class Equalizer {
 private context: AudioContextLike | null = null;
 private filters: BiquadLike[] = [];
 private sourceNode: AudioNodeLike | null = null;
 private broken = false;
 private error = '';
 private retryCount = 0;
 private settings: EqualizerSettings = normalizeEqualizer(null);
 private readonly audio: AudioElementLike;
 private readonly factory: () => AudioContextLike;
 constructor(audio: AudioElementLike, factory: () => AudioContextLike) { this.audio = audio; this.factory = factory; }
 configure(value: unknown): void { this.settings = normalizeEqualizer(value); this.apply(); }
 shouldUse(song: Song | null): boolean { return this.settings.enabled && !this.broken && !!song && song.source === 'netease' && !song.localPath; }
 prepare(song: Song | null): void { if (this.shouldUse(song)) { this.ensure(); this.apply(); if (this.context?.state === 'suspended') void this.context.resume().catch(() => {}); } else this.apply(); }
 private ensure(): boolean { if (this.context || this.broken) return !!this.context; try { this.context = this.factory(); let node: AudioNodeLike = this.context.createMediaElementSource(this.audio); this.sourceNode = node; for (const frequency of EQ_FREQUENCIES) { const filter = this.context.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1; filter.gain.value = 0; node.connect(filter); node = filter; this.filters.push(filter); } node.connect(this.context.destination); return true; } catch (e) { this.fail('Web Audio 初始化失败：' + (e instanceof Error ? e.message : String(e))); return false; } }
 apply(): void { this.filters.forEach((f, i) => { f.gain.value = this.settings.enabled && !this.broken ? this.settings.bands[i] : 0; }); }
 handleMediaError(code: number, song: Song | null): boolean { if (!shouldRetryEqualizer(code, this.shouldUse(song) && this.context !== null, this.retryCount)) return false; this.retryCount++; this.fail('均衡器与当前音源不兼容，已回退原始播放（最多重试 1 次）'); return true; }
 resetRetries(): void { this.retryCount = 0; }
 private fail(message: string): void { this.error = message; this.broken = true; try { this.sourceNode?.disconnect(); } catch {} if (this.context) void this.context.close().catch(() => {}); this.context = null; this.filters = []; this.sourceNode = null; }
 get snapshot(): EqualizerSnapshot { return { enabled: this.settings.enabled && !this.broken, ready: this.context !== null, active: this.settings.enabled && this.context !== null && !this.broken, broken: this.broken, error: this.error, retryCount: this.retryCount, gains: this.filters.map(f => f.gain.value) }; }
 dispose(): void { try { this.sourceNode?.disconnect(); } catch {} if (this.context) void this.context.close().catch(() => {}); this.context = null; this.filters = []; }
}
