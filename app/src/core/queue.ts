/**
 * 播放队列（纯状态机，零 DOM、零 Vue、零状态库）。
 *
 * 逐条对齐旧版 src/renderer/player.js:121-255 —— 包括那些不显眼但真实存在的分支：
 *
 *   · playAt(i) 在改 index **之前**先判断是否要把旧 index 压栈
 *     （keepHistory=true 的"回退动作"自己不再入栈，否则上一首会变成乒乓）
 *   · 栈上限 50，溢出时 shift 掉最旧的（不是丢弃最新的）
 *   · 栈里可能留有已被删除曲目的**过期索引**：removeAt 从不清理它，
 *     靠 popHistory() 弹出时做边界校验丢弃 —— 所以"上一首"有时会静默跳过几层
 *   · setQueue 清空历史；removeAt / clearQueue 不动历史
 *
 * 全部函数都是"旧 state 进、新 state 出"，不改入参 —— 这样 S3 的 store
 * 可以直接把结果塞进 ref，测试也不必清理全局状态。
 */
import { key, type Song, type SongKey } from '../data/normalize';

/** 跳转历史栈上限（旧版硬编码 50） */
export const HISTORY_LIMIT = 50;

/** 无当前曲目 / 无可用索引 */
export const NO_INDEX = -1;

export interface QueueState {
  readonly items: readonly Song[];
  /** 当前索引，-1 = 还没播 / 已清空 */
  readonly index: number;
  /** 跳转历史栈，栈顶在末尾 */
  readonly history: readonly number[];
}

export interface RemoveResult {
  state: QueueState;
  /** 被删的是不是当前正在播的那首 */
  removedCurrent: boolean;
  /** 删完后建议播放的索引；-1 = 不需要触发播放（旧版只在删当前曲时续播） */
  playIndex: number;
}

export interface PopHistoryResult {
  state: QueueState;
  /** 弹出一个仍有效的索引；-1 = 历史栈里没有可用项，调用方应改走 pickPrevIndex */
  index: number;
}

export function createQueue(items: readonly Song[] = [], index = NO_INDEX): QueueState {
  return { items: [...items], index, history: [] };
}

/** 整表替换（对应旧 setQueue：换队列必须清历史，否则上一首会跳到别的列表） */
export function setQueue(list: readonly Song[], index = NO_INDEX): QueueState {
  return { items: [...list], index, history: [] };
}

export function clearQueue(): QueueState {
  return { items: [], index: NO_INDEX, history: [] };
}

export function current(state: QueueState): Song | null {
  return state.items[state.index] ?? null;
}

export function currentKey(state: QueueState): SongKey {
  return key(current(state));
}

export function isPlayableIndex(state: QueueState, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < state.items.length;
}

/** 追加到队尾（旧 addToQueue：不动 index） */
export function addToQueue(state: QueueState, song: Song): QueueState {
  if (!song) return state;
  return { ...state, items: [...state.items, song] };
}

/**
 * 插到当前曲后面（"下一首播放"）。
 * 旧版特判：队列为空或 index<0 时退化为 push，并把 index 拨到 0。
 */
export function playNext(state: QueueState, song: Song): QueueState {
  if (!song) return state;
  if (state.items.length === 0 || state.index < 0) {
    return {
      ...state,
      items: [...state.items, song],
      index: state.index < 0 ? 0 : state.index,
    };
  }
  const items = [...state.items];
  items.splice(state.index + 1, 0, song);
  return { ...state, items };
}

/**
 * 删除第 i 首。
 * 旧版语义：i<index 时 index--；删的是当前曲则续播 min(i, len-1)，
 * 删空了则 index=-1、currentKey 变空。
 * 注意历史栈**不清理**（见文件头）。
 */
export function removeAt(state: QueueState, i: number): RemoveResult {
  if (!isPlayableIndex(state, i)) {
    return { state, removedCurrent: false, playIndex: NO_INDEX };
  }
  const removedCurrent = i === state.index;
  const items = [...state.items];
  items.splice(i, 1);

  let index = state.index;
  if (i < state.index) index -= 1;

  if (removedCurrent) {
    if (items.length === 0) {
      return {
        state: { items, index: NO_INDEX, history: state.history },
        removedCurrent: true,
        playIndex: NO_INDEX,
      };
    }
    index = Math.min(i, items.length - 1);
    return {
      state: { items, index, history: state.history },
      removedCurrent: true,
      playIndex: index,
    };
  }
  return { state: { items, index, history: state.history }, removedCurrent: false, playIndex: NO_INDEX };
}

/**
 * 把 index 挪到 i，并（按需）把旧索引压入历史栈。
 *
 * @param keepHistory true = 这是"上一首"回退动作本身，不再入栈
 */
export function visit(state: QueueState, i: number, opts: { keepHistory?: boolean } = {}): QueueState {
  if (!isPlayableIndex(state, i)) return state;

  let history = state.history;
  const from = state.index;
  // 旧版还额外要求 state.queue[state.index] 存在，否则不压栈（脏索引不污染历史）
  if (!opts.keepHistory && from >= 0 && from !== i && state.items[from] !== undefined) {
    history = [...history, from];
    if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
  }
  return { items: state.items, index: i, history };
}

/**
 * 从历史栈里弹出一个**仍然有效**的索引。
 * 过期项（对应曲目已被删除）直接丢弃 —— 旧版 prev() 的 while 循环就是这个作用。
 */
export function popHistory(state: QueueState): PopHistoryResult {
  let history = [...state.history];
  let index = NO_INDEX;
  while (history.length > 0) {
    const top = history.pop() as number;
    if (isPlayableIndex(state, top)) {
      index = top;
      break;
    }
  }
  return { state: { ...state, history }, index };
}
