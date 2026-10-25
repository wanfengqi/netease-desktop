export type NavKey = 'home' | 'search' | 'library' | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', icon: '♪', description: '推荐与最近播放（占位）' },
  { key: 'search', label: '搜索', icon: '⌕', description: '网易云 / 咪咕 双音源搜索（占位）' },
  { key: 'library', label: '我的音乐', icon: '♫', description: '收藏、歌单与本地列表（占位）' },
  { key: 'settings', label: '设置', icon: '⚙', description: '音质、皮肤与运行环境（占位）' },
];

export function findNavItem(key: NavKey): NavItem {
  const found = NAV_ITEMS.find((item) => item.key === key);
  if (!found) {
    throw new Error(`unknown nav key: ${key}`);
  }
  return found;
}
