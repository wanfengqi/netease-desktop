<script setup lang="ts">
/**
 * 区块三态占位（S5）：骨架 / 空 / 错误 / 需要登录 / 不可用。
 *
 * 为什么把"需要登录"和"不支持"做成独立形态而不是错误：
 * 网易云每日推荐无 cookie、咪咕每日推荐恒 200205 —— 这是**接口限制**，
 * 用户看到红字"请求失败"会以为是网络坏了，然后一直点重试。
 * 说清"为什么没有数据、怎么才会有"才是正确的降级。
 */
import Icon from './Icon.vue';

withDefaults(
  defineProps<{
    kind: 'skeleton' | 'empty' | 'error' | 'login' | 'unsupported';
    /** 主文案 */
    title?: string;
    /** 补充说明 */
    detail?: string;
    /** 骨架屏卡片数 */
    count?: number;
    /** 骨架屏形状：方形封面 / 竖条 */
    shape?: 'card' | 'row';
  }>(),
  { title: '', detail: '', count: 4, shape: 'card' },
);

const emit = defineEmits<{ (e: 'retry'): void }>();

const ICONS = {
  skeleton: 'music',
  empty: 'music',
  error: 'music',
  login: 'artist',
  unsupported: 'music',
} as const;
</script>

<template>
  <div v-if="kind === 'skeleton'" class="sk-grid">
    <div v-for="i in count" :key="i" class="sk-card" :class="'sk-' + shape">
      <span class="s3-skeleton sk-cover" />
      <span class="s3-skeleton sk-line" />
      <span class="s3-skeleton sk-line sk-short" />
    </div>
  </div>

  <div v-else class="state" :class="'state-' + kind">
    <Icon :name="ICONS[kind]" :size="22" />
    <p>{{ title }}</p>
    <span v-if="detail" class="state-detail">{{ detail }}</span>
    <button v-if="kind === 'error'" type="button" class="state-retry" @click="emit('retry')">
      重试
    </button>
  </div>
</template>

<style scoped>
.sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 16px 14px;
}

.sk-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.sk-cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
}

.sk-row .sk-cover {
  aspect-ratio: auto;
  height: 34px;
}

.sk-line {
  height: 10px;
  width: 84%;
}

.sk-short {
  width: 52%;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 20px;
  border-radius: var(--radius);
  background: var(--panel-bg);
  border: 1px dashed var(--app-border);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.state p {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}

.state-detail {
  font-size: 11px;
  max-width: 460px;
  line-height: 1.6;
}

.state-error {
  border-color: var(--accent);
  color: var(--accent);
}

.state-error p {
  color: var(--accent);
}

.state-login,
.state-unsupported {
  border-style: solid;
}

.state-retry {
  margin-top: 2px;
  height: 26px;
  padding: 0 14px;
  border: 1px solid var(--accent);
  border-radius: 13px;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.state-retry:hover {
  background: var(--accent-dim);
}
</style>
