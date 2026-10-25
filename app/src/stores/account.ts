import { defineStore } from 'pinia';
import { computed, onBeforeUnmount, ref } from 'vue';
import { toDataURL } from 'qrcode';
import { NeteaseRepository } from '../data/repository/netease';
import type { LoginState } from '../data/repository/types';
import { useConfigStore } from './config';
import { useHomeStore } from './home';

export type QrStatus = 'idle' | 'loading' | 'waiting' | 'confirming' | 'expired' | 'error';

export interface AccountApi {
  loginState(): Promise<LoginState>;
  logout(): Promise<void>;
  qrKey(): Promise<string>;
  qrCreate(key: string): Promise<{ qrContent: string; key: string }>;
  qrCheck(key: string): Promise<{ code: number; message: string; cookie: string }>;
}

export const useAccountStore = defineStore('account', () => {
  const config = useConfigStore();
  const home = useHomeStore();
  const profile = ref<LoginState>({ loggedIn: false, nickname: '', userId: null });
  const loading = ref(false);
  const error = ref('');
  const qrStatus = ref<QrStatus>('idle');
  const qrImage = ref('');
  const qrMessage = ref('');
  const checks = ref(0);
  let api: AccountApi = new NeteaseRepository({ getCookie: () => config.cookie });
  let key = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let busy = false;

  const hasCookie = computed(() => config.cookie !== '');

  function configure(next: AccountApi): void {
    stopPolling();
    api = next;
  }

  function stopPolling(): void {
    generation += 1;
    busy = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      profile.value = hasCookie.value
        ? await api.loginState()
        : { loggedIn: false, nickname: '', userId: null };
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  function schedule(token: number): void {
    if (token !== generation) return;
    timer = setTimeout(() => void check(token), 2000);
  }

  async function check(token: number): Promise<void> {
    if (token !== generation || busy || !key) return;
    busy = true;
    try {
      const result = await api.qrCheck(key);
      if (token !== generation) return;
      checks.value += 1;
      qrMessage.value = result.message;
      if (result.code === 800) {
        stopPolling();
        qrStatus.value = 'expired';
      } else if (result.code === 802) {
        qrStatus.value = 'confirming';
        schedule(token);
      } else if (result.code === 803 && result.cookie) {
        stopPolling();
        config.update({ cookie: result.cookie });
        await config.flush();
        await refresh();
        await home.loadDaily(true);
        qrStatus.value = 'idle';
        qrImage.value = '';
      } else {
        qrStatus.value = 'waiting';
        schedule(token);
      }
    } catch (err) {
      if (token !== generation) return;
      qrMessage.value = err instanceof Error ? err.message : String(err);
      qrStatus.value = 'error';
      schedule(token);
    } finally {
      busy = false;
    }
  }

  async function createQr(): Promise<void> {
    stopPolling();
    const token = generation;
    qrStatus.value = 'loading';
    qrMessage.value = '';
    error.value = '';
    checks.value = 0;
    try {
      key = await api.qrKey();
      const created = await api.qrCreate(key);
      if (token !== generation) return;
      qrImage.value = await toDataURL(created.qrContent, { width: 220, margin: 2 });
      qrStatus.value = 'waiting';
      schedule(token);
    } catch (err) {
      if (token !== generation) return;
      qrStatus.value = 'error';
      qrMessage.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function logout(): Promise<void> {
    stopPolling();
    try {
      await api.logout();
    } catch {
      // 本地退出不能被离线状态阻断；不输出任何凭据。
    }
    config.update({ cookie: '' });
    await config.flush();
    profile.value = { loggedIn: false, nickname: '', userId: null };
    qrImage.value = '';
    qrStatus.value = 'idle';
    await home.loadDaily(true);
  }

  onBeforeUnmount(stopPolling);
  return { profile, loading, error, qrStatus, qrImage, qrMessage, checks, hasCookie, configure, refresh, createQr, logout, stopPolling };
});
