import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { NextConfig } from '../../data/config';
import type { LoginState } from '../../data/repository/types';
import { useAccountStore, type AccountApi } from '../account';
import { useConfigStore } from '../config';

const BASE: NextConfig = { version:1,source:'netease',playMode:'list',volume:0.8,muted:true,lyricOffset:0,equalizer:{enabled:false,bands:[]},favorites:[],recent:[],queue:[],queueIndex:-1,searchHistory:[],cookie:'',windowBounds:null,extra:{},migratedFrom:'',updatedAt:0 };

function api(codes: number[]): AccountApi & { checks: number; login: ReturnType<typeof vi.fn> } {
  const state = { checks: 0, login: vi.fn(async (): Promise<LoginState> => ({ loggedIn:true,nickname:'测试昵称',userId:42 })) };
  return {
    ...state,
    loginState: state.login,
    logout: async () => undefined,
    qrKey: async () => 'key',
    qrCreate: async (key) => ({ key,qrContent:'https://music.163.com/login?codekey='+key }),
    qrCheck: async () => { const code=codes[Math.min(state.checks++,codes.length-1)];return {code,message:'状态 '+code,cookie:code===803?'new-cookie':''}; },
  };
}
function bridge(cookie=''): { saved: Partial<NextConfig>[] } {
  const saved:Partial<NextConfig>[]=[];let current={...BASE,cookie};
  (globalThis as unknown as {window:unknown}).window={api:{config:{load:async()=>current,save:async(patch:Partial<NextConfig>)=>{saved.push(patch);current={...current,...patch};return current;}}}};
  return {saved};
}
beforeEach(()=>{setActivePinia(createPinia());vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();delete (globalThis as unknown as {window?:unknown}).window;vi.restoreAllMocks();});

describe('account QR login state machine',()=>{
 it('handles 801 waiting and 802 confirming, then stops polling on unmount',async()=>{
  bridge();const account=useAccountStore();account.configure(api([801,802]));
  await account.createQr();expect(account.qrStatus).toBe('waiting');expect(account.qrImage.startsWith('data:image/png;base64,')).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);expect(account.checks).toBe(1);
  await vi.advanceTimersByTimeAsync(2000);expect(account.checks).toBe(2);expect(account.qrStatus).toBe('confirming');
  account.stopPolling();await vi.advanceTimersByTimeAsync(6000);expect(account.checks).toBe(2);
 });
 it('expires on 800 and can refresh a real QR image',async()=>{
  bridge();const account=useAccountStore();account.configure(api([800]));await account.createQr();
  await vi.advanceTimersByTimeAsync(2000);expect(account.qrStatus).toBe('expired');
  await account.createQr();expect(account.qrStatus).toBe('waiting');expect(account.checks).toBe(0);
  account.stopPolling();
 });
 it('persists only the 803 cookie through config, refreshes profile and daily recommendations',async()=>{
  const saved=bridge();const account=useAccountStore();const home=(await import('../home')).useHomeStore();
  const daily=vi.spyOn(home,'loadDaily').mockResolvedValue();account.configure(api([803]));await account.createQr();
  await vi.advanceTimersByTimeAsync(2000);
  expect(saved.saved.some((patch)=>patch.cookie==='new-cookie')).toBe(true);
  expect(useConfigStore().cookie).toBe('new-cookie');expect(account.profile.nickname).toBe('测试昵称');expect(account.profile.userId).toBe(42);expect(daily).toHaveBeenCalledWith(true);expect(account.qrImage).toBe('');
 });
 it('does not clear cookie on a network error and logout clears it explicitly',async()=>{
  const saved=bridge('existing-cookie');await useConfigStore().load();const account=useAccountStore();account.configure({...api([]),loginState:async()=>{throw new Error('offline');}});
  await account.refresh();expect(account.error).toBe('offline');expect(useConfigStore().cookie).toBe('existing-cookie');
  await account.logout();expect(useConfigStore().cookie).toBe('');expect(account.profile.loggedIn).toBe(false);expect(saved.saved.some((patch)=>patch.cookie==='')).toBe(true);
 });
});
