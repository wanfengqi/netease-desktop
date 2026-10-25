/**
 * 音源路由（S3）—— 渲染层唯一的"按 source 分派"入口。
 *
 * 为什么要有这一层：S2 的 repository 已经把两个音源的差异吸收干净了，但**方法名与返回形状
 * 仍然不同**（网易云有 playlistDetail/albumDetail/artistDetail，咪咕只有 *_Songs / *_Albums）。
 * 页面不该知道这些差异，所以收敛到这里；页面只写 loadPlaylistTracks(playlist)。
 *
 * 铁律：音源差异只允许出现在这一层 + repository 的 picker 里。
 */
import type { Album, Artist, Playlist, Song, SongSource } from './normalize';
import type { Paged, PlayUrl } from './repository/types';
import { migu, netease } from './repository/index';
import { useConfigStore } from '../stores/config';
import { mergeSettings } from '../core/settings';

export interface SongUrlResult {
  url: string | null;
  /** url 为空时给人看的原因（"无版权 / 需要 VIP"这类） */
  reason?: string;
  level: string;
  /** 试听片段（毫秒），0 表示完整 */
  auditionMs: number;
}

/** 搜索结果的"分栏"，对应旧版三分栏 */
export interface SearchBuckets {
  songs: Song[];
  playlists: Playlist[];
  artists: Artist[];
}

function reasonOf(play: PlayUrl): string | undefined {
  if (play.url) return undefined;
  if (play.reason) return play.reason;
  return '无可用播放地址（可能无版权或需要 VIP）';
}

/**
 * 取某首歌的播放地址。**这是播放协调层唯一的取址入口**。
 * 注意：网易云的 url=null 是正常业务返回（无版权），不是异常，不抛错。
 */
export async function resolveSongUrl(song: Song): Promise<SongUrlResult> {
  const offline = await window.api.downloads.list();
  if (song.localPath) {
    const url = await window.api.local.mediaUrl(song.localPath);
    return { url, reason: url ? undefined : '本地文件未登记或已移除', level: 'local', auditionMs: 0 };
  }
  if (song.source === 'local') {
    return { url: null, reason: '本地文件路径缺失', level: 'local', auditionMs: 0 };
  }
  {
    const downloaded = offline.records.find((record) => record.status === 'completed' && record.id === song.source + ':' + String(song.id));
    if (downloaded) {
      const url = await window.api.local.mediaUrl(downloaded.localPath);
      if (url) return { url, level: 'offline', auditionMs: 0 };
    }
  }
  const quality = mergeSettings(useConfigStore().config?.extra?.settings).quality;
  if (song.source === 'migu') {
    const play = await migu.songUrl(song, quality.migu);
    return { url: play.url, reason: reasonOf(play), level: play.level, auditionMs: play.auditionMs };
  }
  const play = await netease.songUrl(song.id, quality.netease);
  return { url: play.url, reason: reasonOf(play), level: play.level, auditionMs: play.auditionMs };
}

/** 三分栏搜索：三个请求并发，任一失败不影响其它两栏 */
export async function searchAll(
  source: SongSource,
  keywords: string,
  limit = 30,
): Promise<SearchBuckets> {
  const [songs, playlists, artists] = await Promise.all([
    searchSongs(source, keywords, limit).catch(() => ({ items: [] as Song[], hasMore: false })),
    searchPlaylists(source, keywords).catch(() => ({ items: [] as Playlist[], hasMore: false })),
    searchArtists(source, keywords).catch(() => ({ items: [] as Artist[], hasMore: false })),
  ]);
  return { songs: songs.items, playlists: playlists.items, artists: artists.items };
}

export async function searchSongs(
  source: SongSource,
  keywords: string,
  limit = 30,
): Promise<Paged<Song>> {
  if (source === 'migu') return migu.searchSongs(keywords, { limit });
  return netease.searchSongs(keywords, { limit });
}

export async function searchPlaylists(
  source: SongSource,
  keywords: string,
): Promise<Paged<Playlist>> {
  if (source === 'migu') return migu.searchPlaylists(keywords);
  const paged = await netease.search(keywords, { type: 1000 });
  return { items: paged.items as Playlist[], hasMore: paged.hasMore, total: paged.total };
}

export async function searchArtists(
  source: SongSource,
  keywords: string,
): Promise<Paged<Artist>> {
  if (source === 'migu') return migu.searchArtists(keywords);
  const paged = await netease.search(keywords, { type: 100 });
  return { items: paged.items as Artist[], hasMore: paged.hasMore, total: paged.total };
}

/** 歌单曲目。咪咕没有"歌单详情"接口，只有 getPlaylistSong；头部信息用搜索项自带的。 */
export async function loadPlaylistTracks(playlist: Playlist): Promise<Song[]> {
  if (playlist.id === undefined || playlist.id === null || playlist.id === '') return [];
  if (playlist.source === 'migu') {
    const paged = await migu.playlistSongs(String(playlist.id), { limit: 200 });
    return paged.items;
  }
  const detail = await netease.playlistDetail(playlist.id);
  return detail.tracks;
}

/** 专辑曲目 */
export async function loadAlbumTracks(album: Album): Promise<Song[]> {
  if (album.id === undefined || album.id === null || album.id === '') return [];
  if (album.source === 'migu') {
    const paged = await migu.albumSongs(String(album.id), { limit: 200 });
    return paged.items;
  }
  const detail = await netease.albumDetail(album.id);
  return detail.songs;
}

export interface ArtistLoad {
  artist: Artist;
  songs: Song[];
  albums: Album[];
}

/** 歌手主页：简介 + 热门歌曲 + 专辑 */
export async function loadArtist(artist: Artist): Promise<ArtistLoad> {
  if (artist.id === undefined || artist.id === null || artist.id === '') {
    return { artist, songs: [], albums: [] };
  }
  if (artist.source === 'migu') {
    const [songs, albums] = await Promise.all([
      migu.singerSongs(String(artist.id)).catch(() => [] as Song[]),
      migu.singerAlbums(String(artist.id)).catch(() => ({ items: [] as Album[], hasMore: false })),
    ]);
    return { artist, songs, albums: albums.items };
  }
  const [detail, albums] = await Promise.all([
    netease.artistDetail(artist.id),
    netease.artistAlbums(artist.id).catch(() => ({ items: [] as Album[], hasMore: false })),
  ]);
  return { artist: detail.artist, songs: detail.hotSongs, albums: albums.items };
}

/** 搜索热词（首页/搜索页空态用） */
export async function hotWords(source: SongSource): Promise<string[]> {
  const words = source === 'migu' ? await migu.searchHot() : await netease.searchHot();
  return words.map((w) => w.word).filter(Boolean);
}
