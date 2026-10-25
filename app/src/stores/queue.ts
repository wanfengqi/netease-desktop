/**
 * 队列 store（S3）—— 薄封装 core/queue.ts 的纯状态机。
 *
 * 刻意**不在这里**做"播放"动作：队列只管数据与历史栈，播哪首由 player store 决定。
 * 这样历史栈的语义（无条件优先、过期索引丢弃、clearQueue 清栈）只有一处定义。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  NO_INDEX,
  clearQueue as clearQueueState,
  createQueue,
  current as currentOf,
  currentKey as currentKeyOf,
  isPlayableIndex,
  popHistory as popHistoryState,
  removeAt as removeAtState,
  setQueue as setQueueState,
  visit as visitState,
  type QueueState,
  type RemoveResult,
} from '../core/queue';
import { key, type Song } from '../data/normalize';

export const useQueueStore = defineStore('queue', () => {
  const state = ref<QueueState>(createQueue());

  const items = computed<readonly Song[]>(() => state.value.items);
  const index = computed(() => state.value.index);
  const history = computed<readonly number[]>(() => state.value.history);
  const current = computed<Song | null>(() => currentOf(state.value));
  const currentKey = computed(() => currentKeyOf(state.value));
  const length = computed(() => state.value.items.length);
  /** 高亮判定直接用 key，跨源安全 */
  const playingKey = computed(() => key(currentOf(state.value)));

  function replace(next: QueueState): void {
    state.value = next;
  }

  function setQueue(songs: readonly Song[], startIndex = NO_INDEX): void {
    state.value = setQueueState(songs, isPlayableIndex({ ...state.value, items: songs }, startIndex) ? startIndex : NO_INDEX);
  }

  function visit(i: number, opts: { keepHistory?: boolean } = {}): void {
    state.value = visitState(state.value, i, opts);
  }

  function popHistory(): number {
    const result = popHistoryState(state.value);
    state.value = result.state;
    return result.index;
  }

  function removeAt(i: number): RemoveResult {
    const result = removeAtState(state.value, i);
    state.value = result.state;
    return result;
  }

  function clearQueue(): void {
    state.value = clearQueueState();
  }

  function setIndex(i: number): void {
    if (!isPlayableIndex(state.value, i)) return;
    state.value = { ...state.value, index: i };
  }

  return {
    state,
    items,
    index,
    history,
    current,
    currentKey,
    playingKey,
    length,
    replace,
    setQueue,
    visit,
    popHistory,
    removeAt,
    clearQueue,
    setIndex,
  };
});
