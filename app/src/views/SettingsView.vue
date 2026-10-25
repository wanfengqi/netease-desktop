<script setup lang="ts">
/**
 * 设置（S3）：本阶段只读 —— 展示音源、音量、播放模式与后端连接状态。
 *
 * 写操作（音质/皮肤/均衡器）留给 S4；这里存在的意义是把
 * "window.api 到底通没通"直接摆在界面上，省掉每次排障都开 DevTools。
 */
import { onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { playModeInfo } from '../core/playmode';
import { useConfigStore } from '../stores/config';
import { usePlayerStore } from '../stores/player';

const config = useConfigStore();
const player = usePlayerStore();

const neteaseState = ref('未查询');
const miguState = ref('未查询');

onMounted(async () => {
  const api = (globalThis as unknown as { window?: { api?: Window['api'] & { miguStatus?: () => Promise<unknown> } } }).window?.api;
  if (!api) {
    neteaseState.value = 'window.api 不可用（非 Electron 环境）';
    miguState.value = 'window.api 不可用（非 Electron 环境）';
    return;
  }
  try {
    const status = await api.netease.status?.();
    neteaseState.value = status
      ? (status.ready ? '就绪 · 端口 ' + status.port : '未就绪 · 端口 ' + status.port)
      : '无 status 接口';
  } catch (err) {
    neteaseState.value = err instanceof Error ? err.message : String(err);
  }
  try {
    const status = (await api.miguStatus?.()) as { ready?: boolean; version?: string } | undefined;
    miguState.value = status
      ? (status.ready ? '就绪 · ' + String(status.version ?? '') : '未就绪')
      : '无 status 接口';
  } catch (err) {
    miguState.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <div class="settings-view">
    <section class="st-card">
      <h3>播放</h3>
      <div class="st-row">
        <span class="st-key">播放模式</span>
        <span class="st-val">{{ playModeInfo(player.mode).label }}</span>
      </div>
      <div class="st-row">
        <span class="st-key">音量</span>
        <span class="st-val">{{ Math.round(player.volume * 100) }}%<template v-if="player.muted">（已静音）</template></span>
      </div>
      <div class="st-row">
        <span class="st-key">队列</span>
        <span class="st-val">{{ player.queueSongs.length }} 首 · 历史栈 {{ player.history.length }} 层</span>
      </div>
    </section>

    <section class="st-card">
      <h3>音源</h3>
      <div class="st-row">
        <span class="st-key">当前音源</span>
        <span class="st-val">{{ config.source === 'migu' ? '咪咕' : '网易云' }}</span>
      </div>
      <div class="st-row">
        <span class="st-key">网易云后端</span>
        <span class="st-val st-mono">{{ neteaseState }}</span>
      </div>
      <div class="st-row">
        <span class="st-key">咪咕后端</span>
        <span class="st-val st-mono">{{ miguState }}</span>
      </div>
    </section>

    <section class="st-card">
      <h3>关于</h3>
      <div class="st-row">
        <span class="st-key">版本</span>
        <span class="st-val st-mono">S3 播放链路 · 旧版保持独立可运行</span>
      </div>
      <div class="st-row">
        <span class="st-key">配置</span>
        <span class="st-val st-mono">{{ config.loaded ? '已加载（写盘统一防抖 400ms）' : '加载中' }}</span>
      </div>
      <div v-if="config.error" class="st-row">
        <span class="st-key">配置错误</span>
        <span class="st-val st-error">{{ config.error }}</span>
      </div>
    </section>

    <p class="st-note">
      <Icon name="settings" :size="12" />
      音质 / 皮肤 / 均衡器在 S4 接入；本阶段只打通播放。
    </p>
  </div>
</template>

<style scoped>
.settings-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.st-card {
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--panel-bg);
  border: 1px solid var(--app-border);
}

.st-card h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-strong);
  font-weight: 600;
}

.st-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 0;
  font-size: 12px;
}

.st-key {
  color: var(--text-muted);
  flex: 0 0 auto;
}

.st-val {
  color: var(--text);
  text-align: right;
  word-break: break-all;
}

.st-mono {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
}

.st-error {
  color: var(--accent);
}

.st-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
