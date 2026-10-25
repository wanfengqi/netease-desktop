/**
 * 侧栏导航（S0 建立，S3 接真视图）。
 *
 * icon 是从 components/Icon.vue 的图标表里取的名字，不再是字符。
 */
export type NavKey = 'home' | 'discover' | 'search' | 'library' | 'local' | 'downloads' | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: 'home' | 'discover' | 'search' | 'library' | 'local' | 'downloads' | 'settings';
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '首页', icon: 'home', description: '推荐歌单、新歌与最近播放' },
  { key: 'discover', label: '发现音乐', icon: 'discover', description: '网易云 / 咪咕 排行榜' },
  { key: 'search', label: '搜索', icon: 'search', description: '网易云 / 咪咕 双音源搜索' },
  { key: 'library', label: '我的音乐', icon: 'library', description: '收藏与最近播放' },
  { key: 'local', label: '本地音乐', icon: 'local', description: '扫描并播放本机音频' },
  { key: 'downloads', label: '下载管理', icon: 'downloads', description: '下载队列与离线播放' },
  { key: 'settings', label: '设置', icon: 'settings', description: '播放状态与后端连接' },
];

export function findNavItem(key: NavKey): NavItem {
  const found = NAV_ITEMS.find((item) => item.key === key);
  if (!found) {
    throw new Error('unknown nav key: ' + key);
  }
  return found;
}
