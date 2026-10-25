import { describe, expect, it } from 'vitest';
import {
  fmtCount,
  key,
  miguAlbum,
  miguArtist,
  miguImg,
  miguPlaylistItem,
  miguSingerSong,
  miguSong,
  neteaseAlbum,
  neteaseArtist,
  neteasePlaylist,
  neteaseSong,
  sameSong,
  type Song,
} from '../normalize';

function song(id: number | string, source: Song['source']): Song {
  return {
    id,
    source,
    name: 'n',
    artistText: '',
    artists: [],
    album: { name: '' },
    duration: 0,
  };
}

describe('normalize: 跨源 key 一致性', () => {
  it('netease:123 与 migu:123 是不同的键（id 空间会撞车）', () => {
    const ne = song(123, 'netease');
    const mg = song(123, 'migu');
    expect(key(ne)).toBe('netease:123');
    expect(key(mg)).toBe('migu:123');
    expect(key(ne)).not.toBe(key(mg));
    expect(sameSong(ne, mg)).toBe(false);
  });

  it('同源同 id 的 key 相同（收藏去重靠它）', () => {
    expect(key(song(42, 'netease'))).toBe(key(song(42, 'netease')));
    expect(key(song('6009070000001', 'migu'))).toBe(key(song('6009070000001', 'migu')));
    expect(sameSong(song(42, 'netease'), song(42, 'netease'))).toBe(true);
  });

  it('字符串 id 与数字 id 归一（咪咕 id 是字符串，不能因此判成两首）', () => {
    const a = song('123', 'netease');
    const b = song(123, 'netease');
    expect(key(a)).toBe(key(b));
    expect(sameSong(a, b)).toBe(true);
  });

  it('缺 id / 空对象返回空串，不产生 netease:undefined', () => {
    expect(key(null)).toBe('');
    expect(key(undefined)).toBe('');
    expect(key(song('', 'netease'))).toBe('');
    expect(sameSong(null, null)).toBe(false);
  });
});

describe('normalize: 咪咕时长与图片', () => {
  it('咪咕 duration 是秒，归一化后是毫秒', () => {
    const s = miguSong({
      contentId: '600902000006889366',
      songName: '晴天',
      duration: 270,
      singerList: [{ name: '周杰伦' }],
    });
    expect(s).not.toBeNull();
    expect(s!.duration).toBe(270000);
  });

  it('缺失 duration 时归零，不出现 NaN', () => {
    const s = miguSong({ contentId: 'x', songName: 'y' });
    expect(s!.duration).toBe(0);
  });

  it('图片相对路径拼上咪咕 CDN 前缀', () => {
    expect(miguImg('/data/oss/resource/00/4t/x.webp'))
      .toBe('https://d.musicapp.migu.cn/data/oss/resource/00/4t/x.webp');
    expect(miguImg('')).toBe('');
    expect(miguImg(undefined)).toBe('');
    expect(miguImg('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
  });

  it('咪咕歌曲封面走 miguImg', () => {
    const s = miguSong({ contentId: '1', songName: 'a', img1: '/data/oss/x.webp', duration: 1 });
    expect(s!.album.picUrl).toBe('https://d.musicapp.migu.cn/data/oss/x.webp');
  });

  it('showTags 含 vip 时标记 vip', () => {
    expect(miguSong({ contentId: '1', showTags: ['vip', 'isq'] })!.vip).toBe(true);
    expect(miguSong({ contentId: '1', showTags: ['i24'] })!.vip).toBe(false);
  });

  it('歌手歌曲块（txt/txt2/txt3/resId）归一化', () => {
    const s = miguSingerSong({ resId: '600929000000096577', txt: '圣诞星', txt2: '周杰伦', txt3: '圣诞星' });
    expect(s.id).toBe('600929000000096577');
    expect(s.name).toBe('圣诞星');
    expect(s.artistText).toBe('周杰伦');
    expect(s.album.name).toBe('圣诞星');
    expect(s.duration).toBe(0);
    expect(s.source).toBe('migu');
  });

  it('相册/歌单/歌手/专辑的咪咕图片都过 miguImg', () => {
    expect(miguArtist({ singer: { singerId: '112', singer: '周杰伦', imgs: [{ imgSizeType: '02', img: '/a.webp' }] } })
      .avatar).toBe('https://d.musicapp.migu.cn/a.webp');
    expect(miguAlbum({ resId: '1', txt: '专辑', img: '/b.webp' }).cover).toBe('https://d.musicapp.migu.cn/b.webp');
    expect(miguPlaylistItem({ musicList: { musicListId: '1', title: '歌单', imgItem: { img: '/c.webp' } } }).cover)
      .toBe('https://d.musicapp.migu.cn/c.webp');
  });

  it('miguArtist 兼容"已解包的歌手对象"（其 singer 字段是名字字符串）', () => {
    const a = miguArtist({ singerId: '112', singer: '周杰伦', songNum: 582, albumNum: 45 });
    expect(a.id).toBe('112');
    expect(a.name).toBe('周杰伦');
  });
});

describe('normalize: 网易云三种响应形态', () => {
  it('/search 形态（artists/album/duration）', () => {
    const s = neteaseSong({ id: 1, name: 'x', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'al', picUrl: 'p' }, duration: 1000 });
    expect(s!.artistText).toBe('A / B');
    expect(s!.duration).toBe(1000);
    expect(s!.album.picUrl).toBe('p');
  });

  it('/playlist/detail 形态（ar/al/dt + fee）', () => {
    const s = neteaseSong({ id: 2, name: 'y', ar: [{ name: 'C' }], al: { name: 'al2', picUrl: 'p2' }, dt: 2000, fee: 1 });
    expect(s!.artistText).toBe('C');
    expect(s!.duration).toBe(2000);
    expect(s!.vip).toBe(true);
  });

  it('null 入参返回 null（不造空对象）', () => {
    expect(neteaseSong(null)).toBeNull();
    expect(miguSong(undefined)).toBeNull();
  });

  it('网易云歌单/歌手/专辑归一化', () => {
    expect(neteasePlaylist({ id: 1, name: 'pl', coverImgUrl: 'c', trackCount: 5, playCount: 12000, creator: { nickname: 'u' } }))
      .toEqual({ source: 'netease', id: 1, name: 'pl', cover: 'c', creator: 'u', count: 5, playCount: '1.2万' });
    expect(neteaseArtist({ id: 1, name: 'a', picUrl: 'p', musicSize: 10, albumSize: 2, briefDesc: '  x   y  ' }))
      .toEqual({ source: 'netease', id: 1, name: 'a', avatar: 'p', songNum: 10, albumNum: 2, brief: 'x y' });
    expect(neteaseAlbum({ id: 1, name: 'al', picUrl: 'p', publishTime: 1507046400000, size: 16 }).date).toBe('2017-10-03');
  });
});

describe('normalize: fmtCount', () => {
  it('大数字格式化', () => {
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(12000)).toBe('1.2万');
    expect(fmtCount(340000000)).toBe('3.4亿');
  });
  it('字符串原样返回（咪咕直接给可读文本）', () => {
    expect(fmtCount('3.4万')).toBe('3.4万');
  });
  it('空值返回空串', () => {
    expect(fmtCount(null)).toBe('');
    expect(fmtCount(undefined)).toBe('');
    expect(fmtCount('')).toBe('');
  });
});
