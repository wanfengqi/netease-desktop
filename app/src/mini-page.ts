/**
 * 迷你窗的挂载入口（S4）。
 *
 * 与主窗口是**两个渲染进程**：这里没有 Pinia，也不该有 —— 播放状态的唯一真源在主窗口。
 * 数据从 preload 的 api.mini.onData 来，指令从 api.mini.cmd 出去，全走主进程转发。
 * 只用一个 shallowRef 装状态，避免为了一个迷你窗再引一套响应式体系。
 */
import { createApp, h, ref } from 'vue';
import MiniView from './views/MiniView.vue';
// 必须有：--app-bg / --accent 等变量都在这里，漏了 import 迷你窗会是一块没有主题色的黑框
import './styles/base.css';

interface MiniState {
  title: string;
  artist: string;
  cover: string;
  playing: boolean;
  progress: number;
}

interface MiniBridge {
  onData(handler: (payload: Partial<MiniState>) => void): () => void;
  cmd(command: string): void;
  requestState(): void;
}

const api = (globalThis as unknown as { window?: { api?: { mini?: MiniBridge } } }).window?.api;

const state = ref<MiniState>({
  title: '未在播放',
  artist: '主窗口里点一首歌',
  cover: '',
  playing: false,
  progress: 0,
});

function apply(payload: Partial<MiniState> | null | undefined): void {
  if (!payload) return;
  const next = { ...state.value };
  if (typeof payload.title === 'string') next.title = payload.title;
  if (typeof payload.artist === 'string') next.artist = payload.artist;
  if (typeof payload.cover === 'string') next.cover = payload.cover;
  if (typeof payload.playing === 'boolean') next.playing = payload.playing;
  if (typeof payload.progress === 'number') next.progress = payload.progress;
  state.value = next;
}

function send(command: string): void {
  api?.mini?.cmd(command);
}

const app = createApp({
  render: () =>
    h(MiniView, {
      title: state.value.title,
      artist: state.value.artist,
      cover: state.value.cover,
      playing: state.value.playing,
      progress: state.value.progress,
      onToggle: () => send('toggle'),
      onPrev: () => send('prev'),
      onNext: () => send('next'),
      onExit: () => {
        const win = (globalThis as unknown as { window?: { api?: { win?: { exitMini(): Promise<boolean> } } } })
          .window?.api?.win;
        void win?.exitMini();
      },
    }),
});

if (api?.mini) {
  api.mini.onData(apply);
  api.mini.requestState();
}

app.mount('#mini-root');
