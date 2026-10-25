<script setup lang="ts">
/**
 * 内联 SVG 图标表（S3）。
 *
 * 约束第 6 条禁止 emoji；图标字体又会引入外部资源与字体闪烁。
 * 这里把手绘图元（线/圆/多边形）直接写在 TS 里，由模板渲染成 SVG：
 * 形状可读、可改、缩放不糊，颜色走 currentColor 天然跟随主题变量。
 */
import { computed } from 'vue';

export type IconName =
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'volume'
  | 'mute'
  | 'repeat'
  | 'repeatOne'
  | 'shuffle'
  | 'order'
  | 'queue'
  | 'search'
  | 'home'
  | 'discover'
  | 'library'
  | 'local'
  | 'downloads'
  | 'settings'
  | 'back'
  | 'minus'
  | 'square'
  | 'close'
  | 'music'
  | 'album'
  | 'artist'
  | 'more';

type Prim =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx?: number }
  | { t: 'polygon'; points: string };

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 });

const ICONS: Record<IconName, Prim[]> = {
  play: [{ t: 'polygon', points: '8,5 19,12 8,19' }],
  pause: [
    { t: 'rect', x: 7, y: 5, w: 3.4, h: 14, rx: 1 },
    { t: 'rect', x: 13.6, y: 5, w: 3.4, h: 14, rx: 1 },
  ],
  prev: [
    { t: 'rect', x: 5, y: 5, w: 2.2, h: 14, rx: 0.6 },
    { t: 'polygon', points: '19,5 19,19 9,12' },
  ],
  next: [
    { t: 'rect', x: 16.8, y: 5, w: 2.2, h: 14, rx: 0.6 },
    { t: 'polygon', points: '5,5 5,19 15,12' },
  ],
  volume: [
    { t: 'polygon', points: '4,9.5 8,9.5 12,5.5 12,18.5 8,14.5 4,14.5' },
    { t: 'path', d: 'M15.5 9.2a4 4 0 0 1 0 5.6' },
    { t: 'path', d: 'M18 6.7a7.5 7.5 0 0 1 0 10.6' },
  ],
  mute: [
    { t: 'polygon', points: '4,9.5 8,9.5 12,5.5 12,18.5 8,14.5 4,14.5' },
    { t: 'path', d: 'M16 9.5l5 5M21 9.5l-5 5' },
  ],
  repeat: [
    { t: 'path', d: 'M4 9.5A4.5 4.5 0 0 1 8.5 5H20' },
    { t: 'polygon', points: '17,2.4 20.6,5 17,7.6' },
    { t: 'path', d: 'M20 14.5A4.5 4.5 0 0 1 15.5 19H4' },
    { t: 'polygon', points: '7,16.4 3.4,19 7,21.6' },
  ],
  repeatOne: [
    { t: 'path', d: 'M4 9.5A4.5 4.5 0 0 1 8.5 5H20' },
    { t: 'polygon', points: '17,2.4 20.6,5 17,7.6' },
    { t: 'path', d: 'M20 14.5A4.5 4.5 0 0 1 15.5 19H4' },
    { t: 'polygon', points: '7,16.4 3.4,19 7,21.6' },
    { t: 'path', d: 'M10.8 10.4l2.1-1.2v6' },
  ],
  shuffle: [
    { t: 'path', d: 'M3 6.5h3.6l10 11h4.4' },
    { t: 'polygon', points: '18.4,3.9 21.6,6.5 18.4,9.1' },
    { t: 'path', d: 'M3 17.5h3.6l3-3.3' },
    { t: 'path', d: 'M13.2 8.6l3.4-3.8h3.4' },
  ],
  order: [
    { t: 'path', d: 'M4 7h11' },
    { t: 'path', d: 'M4 12h11' },
    { t: 'path', d: 'M4 17h7' },
    { t: 'path', d: 'M18 20v-9' },
    { t: 'polygon', points: '15.4,12.6 18,10 20.6,12.6' },
  ],
  queue: [
    { t: 'path', d: 'M4 7h10' },
    { t: 'path', d: 'M4 12h10' },
    { t: 'path', d: 'M4 17h7' },
    { t: 'polygon', points: '15.5,9 21,12 15.5,15' },
  ],
  search: [
    { t: 'circle', cx: 10.5, cy: 10.5, r: 6.5 },
    { t: 'path', d: 'M15.4 15.4L21 21' },
  ],
  home: [{ t: 'path', d: 'M3.5 10.8L12 3.5l8.5 7.3V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z' }],
  discover: [
    { t: 'path', d: 'M4 19v-6M10 19V9M16 19V4M22 19H2' },
    { t: 'path', d: 'M3 10l6-5 6 3 6-6' },
  ],
  library: [
    { t: 'path', d: 'M5 4.5v15' },
    { t: 'path', d: 'M10.5 4.5v15' },
    { t: 'path', d: 'M16 5.5l4 15' },
  ],
  local: [
    { t: 'path', d: 'M3 6h7l2 2h9v11H3z' },
    { t: 'path', d: 'M9 15.5v-5l6-1.3v5.1' },
    { t: 'circle', cx: 7.5, cy: 15.8, r: 1.8 },
    { t: 'circle', cx: 13.5, cy: 14.6, r: 1.8 },
  ],
  downloads: [
    { t: 'path', d: 'M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3' },
  ],
  settings: [
    { t: 'circle', cx: 12, cy: 12, r: 3.4 },
    { t: 'path', d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1' },
  ],
  back: [{ t: 'path', d: 'M14.8 5.2L8 12l6.8 6.8' }],
  minus: [{ t: 'path', d: 'M5 12h14' }],
  square: [{ t: 'rect', x: 5.8, y: 5.8, w: 12.4, h: 12.4, rx: 1.4 }],
  close: [{ t: 'path', d: 'M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8' }],
  music: [
    { t: 'circle', cx: 7, cy: 17.2, r: 2.8 },
    { t: 'circle', cx: 17.6, cy: 15.2, r: 2.8 },
    { t: 'path', d: 'M9.8 17.2V6.4l10.6-2.1v10.9' },
  ],
  album: [
    { t: 'circle', cx: 12, cy: 12, r: 8.6 },
    { t: 'circle', cx: 12, cy: 12, r: 2.6 },
  ],
  artist: [
    { t: 'circle', cx: 12, cy: 8.2, r: 3.9 },
    { t: 'path', d: 'M4.6 20.2c0-3.6 3.3-6.2 7.4-6.2s7.4 2.6 7.4 6.2' },
  ],
  more: [
    { t: 'circle', cx: 5.6, cy: 12, r: 1.5 },
    { t: 'circle', cx: 12, cy: 12, r: 1.5 },
    { t: 'circle', cx: 18.4, cy: 12, r: 1.5 },
  ],
};

const prims = computed(() => ICONS[props.name]);
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-for="(p, i) in prims" :key="i">
      <path v-if="p.t === 'path'" :d="p.d" />
      <circle v-else-if="p.t === 'circle'" :cx="p.cx" :cy="p.cy" :r="p.r" />
      <rect
        v-else-if="p.t === 'rect'"
        :x="p.x"
        :y="p.y"
        :width="p.w"
        :height="p.h"
        :rx="p.rx ?? 0"
      />
      <polygon v-else :points="p.points" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: 0 0 auto;
  pointer-events: none;
}
</style>
