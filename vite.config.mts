import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  base: './',
  plugins: [vue()],
  test: {
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', '../electron/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      // S4：桌面歌词窗与迷你窗都是独立页面（app/lyric.html、app/mini.html）。
      // 单入口构建不会带上它们，产物里没有这两个 html 时窗口会 404 白屏。
      input: {
        index: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        lyric: fileURLToPath(new URL('./app/lyric.html', import.meta.url)),
        mini: fileURLToPath(new URL('./app/mini.html', import.meta.url)),
        s7Preview: fileURLToPath(new URL('./app/s7-preview.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app/src', import.meta.url)),
    },
  },
});
