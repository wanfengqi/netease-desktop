/**
 * 轻量 toast（S3）—— 播放层唯一允许"打扰用户"的出口。
 *
 * 播放失败必须说清成因（无版权 / 网络 / 解码 / 地址失效），不能静默吞掉：
 * 旧版把一切归成 CORS，用户只看到"播放失败"四个字。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'warn' | 'error';
}

const DURATION_MS = 3200;

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);
  let seq = 0;

  function dismiss(id: number): void {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function push(message: string, kind: ToastItem['kind'] = 'info'): number {
    seq += 1;
    const id = seq;
    // 同样的文案连续出现时只保留一条，避免点十下出十个
    items.value = [...items.value.filter((t) => t.message !== message), { id, message, kind }].slice(-3);
    setTimeout(() => dismiss(id), DURATION_MS);
    return id;
  }

  return { items, push, dismiss };
});
