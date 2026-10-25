import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { NextConfig } from '../../data/config';
import type { Song } from '../../data/normalize';
import { useConfigStore } from '../config';

const BASE: NextConfig = {
  version: 1,
  source: 'netease',
  playMode: 'list',
  volume: 0.8,
  muted: true,
  lyricOffset: 0,
  equalizer: { enabled: false, bands: [] },
  favorites: [],
  recent: [],
  queue: [],
  queueIndex: -1,
  searchHistory: [],
  cookie: '',
  windowBounds: null,
  extra: {},
  migratedFrom: '',
  updatedAt: 0,
};

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.useRealTimers();
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('config IPC persistence', () => {
  it('saveQueue keeps the current key and 400ms channel, and flush deep-clones the payload', async () => {
    vi.useFakeTimers();
    const saved: unknown[] = [];
    const song = { id: 7, source: 'netease', name: '七', artistText: '', artists: [], album: { name: 'A' }, duration: 1 } satisfies Song;
    const input = [song];
    (globalThis as unknown as { window: unknown }).window = { api: { config: {
      load: async () => BASE,
      save: async (patch: unknown) => { saved.push(patch); return BASE; },
    } } };
    const store = useConfigStore();
    await store.load();
    store.saveQueue([...input], 'netease:7');
    store.setVolume(0.4, true);
    expect(saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ queue: [song], volume: 0.4, extra: { queueKey: 'netease:7' } });
    expect(() => structuredClone(saved[0])).not.toThrow();
  });

  it('a failed save remains visible and a later different-field update can still save', async () => {
    let fail = true;
    const saved: Partial<NextConfig>[] = [];
    (globalThis as unknown as { window: unknown }).window = { api: { config: {
      load: async () => BASE,
      save: async (patch: Partial<NextConfig>) => {
        if (fail) throw new Error('simulated IPC failure');
        saved.push(patch);
        return { ...BASE, ...patch };
      },
    } } };
    const store = useConfigStore();
    await store.load();
    store.setVolume(0.2, true);
    await store.flush();
    expect(store.error).toBe('simulated IPC failure');
    expect(store.saving).toBe(false);

    fail = false;
    store.update({ lyricOffset: 1.5 });
    await store.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ volume: 0.2, lyricOffset: 1.5 });
    expect(store.error).toBe('');
  });
});
