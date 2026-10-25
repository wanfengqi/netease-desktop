<script setup lang="ts">
/**
 * 歌词滚动区（S4）。
 *
 * 三条硬约束：
 *  1. **只读歌词**：不取歌词、不算当前行 —— 下标由父组件用 core/lyrics.ts 的二分算好传进来。
 *     这样偏移改了只重算一次，滚动区不需要知道偏移的存在。
 *  2. **上下渐隐**用 mask-image，不用盖两块渐变色矩形 —— 后者会和背景图打架。
 *  3. **空态必须有内容**：无歌词时显示明确文案（含音源名），不是空白区域。
 *
 * 点击某行 → 跳到该行（emit seek），目标时间由父组件按偏移折算。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    /** 歌词行（原始时间轴，只用于显示） */
    lines: readonly { time: number; text: string }[];
    /** 当前高亮行下标；-1 表示还没到第一句 */
    activeIndex: number;
    /** 无时间轴但有纯文本时显示的内容 */
    plainText?: string;
    loading?: boolean;
    /** 歌词来源（"网易云" / "咪咕"），只用于空态文案 */
    sourceLabel?: string;
    /** 加载失败的原因 */
    error?: string;
  }>(),
  { plainText: '', loading: false, sourceLabel: '网易云', error: '' },
);

const emit = defineEmits<{
  (e: 'seek', index: number): void;
}>();

const scrollerRef = ref<HTMLDivElement | null>(null);
const hasLines = computed(() => props.lines.length > 0);
const hasPlain = computed(() => !hasLines.value && props.plainText.trim() !== '');

/** 滚动到当前行居中；activeIndex 为 -1 时滚回顶部 */
async function centerOn(index: number): Promise<void> {
  await nextTick();
  const scroller = scrollerRef.value;
  if (!scroller) return;
  if (index < 0) {
    scroller.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const node = scroller.querySelector<HTMLElement>('[data-line="' + index + '"]');
  if (!node) return;
  const target = node.offsetTop - scroller.clientHeight / 2 + node.offsetHeight / 2;
  scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

watch(() => props.activeIndex, (index) => void centerOn(index));
watch(
  () => props.lines,
  () => void centerOn(props.activeIndex),
);
// 相位切换（封面 ↔ 歌词）会重新挂载本组件：挂载时也要立刻居中，
// 否则新挂载的那一份从第一行开始，高亮行在可视区外，看起来像"没高亮"。
onMounted(() => void centerOn(props.activeIndex));
</script>

<template>
  <div class="lyrics-panel" :class="{ 'is-empty': !hasLines && !hasPlain && !loading }">
    <!-- 加载态 -->
    <div v-if="loading" class="ly-state">
      <span class="ly-dot" />
      <span>正在取歌词…</span>
    </div>

    <!-- 纯文本歌词（无时间轴） -->
    <div v-else-if="hasPlain" class="ly-plain">
      <div class="ly-plain-hint">该歌词未带时间轴，仅能显示全文</div>
      <p v-for="(row, i) in plainText.split('\n')" :key="i">{{ row }}</p>
    </div>

    <!-- 有时间轴的歌词 -->
    <div v-else-if="hasLines" ref="scrollerRef" class="ly-scroller">
      <div class="ly-list">
        <div class="ly-pad" />
        <button
          v-for="(line, i) in lines"
          :key="i"
          type="button"
          class="ly-line"
          :class="{ 'is-active': i === activeIndex, 'is-near': Math.abs(i - activeIndex) === 1 }"
          :data-line="i"
          @click="emit('seek', i)"
        >
          {{ line.text }}
        </button>
        <div class="ly-pad" />
      </div>
    </div>

    <!-- 空态：明确说明为什么没有歌词 -->
    <div v-else class="ly-state ly-empty">
      <div class="ly-empty-icon">
        <Icon name="music" :size="26" />
      </div>
      <div class="ly-empty-title">暂无歌词</div>
      <div class="ly-empty-sub">
        <template v-if="error">{{ sourceLabel }} 歌词获取失败：{{ error }}</template>
        <template v-else>{{ sourceLabel }} 没有返回这首歌的歌词（纯音乐或接口缺数据）</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyrics-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ly-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* 上下渐隐：滚动区边缘淡出，不做两块色块遮挡 */
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 14%,
    #000 84%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 14%,
    #000 84%,
    transparent 100%
  );
  scrollbar-width: none;
}

.ly-scroller::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.ly-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 0 4px;
}

/* 上下留白 = 半个可视高度，第一句和最后一句也能滚到正中 */
.ly-pad {
  flex: 0 0 38%;
  height: 38%;
}

.ly-line {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.18s ease, opacity 0.18s ease, transform 0.18s ease, font-size 0.18s ease;
  opacity: 0.62;
}

.ly-line:hover {
  color: var(--text);
  opacity: 0.9;
  background: var(--item-hover);
}

.ly-line.is-near {
  opacity: 0.85;
  color: var(--text);
}

.ly-line.is-active {
  color: var(--accent);
  opacity: 1;
  font-size: 19px;
  font-weight: 700;
  transform: scale(1.02);
  transform-origin: left center;
  background: var(--accent-dim);
}

.ly-state {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px;
  text-align: center;
}

.ly-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: ly-pulse 1.1s ease-in-out infinite;
}

@keyframes ly-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.ly-empty-icon {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-hover);
  color: var(--text-muted);
  margin-bottom: 2px;
}

.ly-empty-title {
  font-size: 14px;
  color: var(--text-strong);
  font-weight: 600;
}

.ly-empty-sub {
  max-width: 320px;
  line-height: 1.6;
}

.ly-plain {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 6px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.9;
  mask-image: linear-gradient(to bottom, transparent 0, #000 8%, #000 92%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 8%, #000 92%, transparent 100%);
}

.ly-plain p {
  margin: 0 0 6px;
}

.ly-plain-hint {
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
