/**
 * 侧栏导航（S0 建立，S3 接真视图）。
 *
 * icon 是从 components/Icon.vue 的图标表里取的名字，不再是字符。
 */
export type NavKey = 'home' | 'search' | 'library' | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: 'home' | 'search' | 'library' | 'settings';
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '发现', icon: 'home', description: '最近的队列与推荐歌单' },
  { key: 'search', label: '搜索', icon: 'search', description: '网易云 / 咪咕 双音源搜索' },
  { key: 'library', label: '我的音乐', icon: 'library', description: '收藏与最近播放' },
  { key: 'settings', label: '设置', icon: 'settings', description: '播放状态与后端连接' },
];

export function findNavItem(key: NavKey): NavItem {
  const found = NAV_ITEMS.find((item) => item.key === key);
  if (!found) {
    throw new Error('unknown nav key: ' + key);
  }
  return found;
}
