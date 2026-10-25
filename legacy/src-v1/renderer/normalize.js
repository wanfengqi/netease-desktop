/* ============================================================
   音源归一化层
   ------------------------------------------------------------
   项目铁律：音源差异只允许出现在这一层与 migu.js（传输层）。
   UI 层只认下面这套统一结构，禁止直接读某个音源的原始字段。

   统一歌曲对象：
     { id, source, name, artistText, artists:[{name}],
       album:{name,picUrl}, duration(ms), vip, playable }
   咪咕额外保留播放所需字段：contentId / copyrightId / resourceType

   统一歌单对象：
     { source, id, name, cover, creator, count, playCount(文本) }
   统一歌手对象：
     { source, id, name, avatar, songNum, albumNum, brief }
   ============================================================ */
const Norm = (() => {

  /** 播放量等大数字 → 1.2万 / 3.4亿 */
  function fmtCount(n) {
    if (n == null || n === '') return '';
    if (typeof n === 'string') return n;          // 咪咕直接给的可读文本
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
  }

  /** 跨音源的歌曲唯一键 —— 所有去重/收藏/highlight 判断都必须用它，否则两个源同 id 会撞车 */
  const key = (s) => s ? (s.source || 'netease') + ':' + (s.id != null ? s.id : s.contentId) : '';

  /**
   * 网易云歌曲 → 统一结构。
   * 兼容三种返回形态：
   *   /search         → artists[] / album{} / duration
   *   /playlist/detail → ar[] / al{} / dt （主进程 slimPayload 已裁剪）
   *   /song/detail     → ar[] / al{} / dt / fee
   */
  function neteaseSong(t, extra = {}) {
    if (!t) return null;
    const ar = t.ar || t.artists || [];
    const al = t.al || t.album || {};
    return {
      source: 'netease',
      id: t.id,
      name: t.name || '',
      artists: ar.map(a => ({ name: a && a.name })),
      artistText: ar.map(a => a && a.name).filter(Boolean).join(' / '),
      album: { name: al.name || '', picUrl: al.picUrl || al.picUrl === '' ? al.picUrl : (al.picUrl || '') },
      duration: t.dt || t.duration || 0,
      vip: t.fee === 1,
      ...extra,
    };
  }

  /** 咪咕歌曲（搜索结果 / 歌单曲目 / 专辑曲目）→ 统一结构 */
  function miguSong(s, extra = {}) {
    if (!s) return null;
    const singers = s.singerList || [];
    const id = s.contentId || s.songId || s.id;
    return {
      source: 'migu',
      id,
      contentId: s.contentId || s.songId || s.id,
      copyrightId: s.copyrightId,
      resourceType: s.resourceType || '2',
      name: s.songName || s.name || '',
      artists: singers.map(x => ({ name: x.name })),
      artistText: singers.map(x => x.name).filter(Boolean).join(' / '),
      album: {
        name: s.album || extra.albumName || '',
        picUrl: miguImg(s.img1 || s.img2 || s.img3 || extra.fallbackCover || ''),
      },
      duration: (s.duration || 0) * 1000,       // 咪咕给秒，统一成毫秒
      vip: (s.showTags || []).includes('vip'),
      ...extra,
    };
  }

  /** 咪咕歌手热门歌曲块（结构是 x.txt/x.txt2/x.txt3/resId，没有歌手数组） */
  function miguSingerSong(x, artistName) {
    return {
      source: 'migu',
      id: x.resId,
      contentId: x.resId,
      name: x.txt || '',
      artists: [{ name: x.txt2 || artistName }],
      artistText: x.txt2 || artistName || '',
      album: { name: x.txt3 || '', picUrl: miguImg(x.img || '') },
      duration: 0,
      vip: false,
    };
  }

  /** 网易云歌单 → 统一结构 */
  function neteasePlaylist(p) {
    return {
      source: 'netease',
      id: p.id,
      name: p.name || '(未命名歌单)',
      cover: p.coverImgUrl || p.picUrl || '',
      creator: (p.creator && p.creator.nickname) || '',
      count: p.trackCount || 0,
      playCount: fmtCount(p.playCount),
    };
  }

  /** 咪咕歌单（data.items[].musicList）→ 统一结构 */
  function miguPlaylistItem(it) {
    const ml = (it && (it.musicList || it)) || {};
    return {
      source: 'migu',
      id: ml.musicListId || ml.id,
      name: ml.title || ml.name || '(未命名歌单)',
      cover: miguImg((ml.imgItem && ml.imgItem.img) || ml.originalImgUrl || ''),
      creator: ml.ownerName || '',
      count: ml.musicNum || 0,
      playCount: (ml.opNumItem && ml.opNumItem.playNumDesc) || '',
    };
  }

  /** 网易云歌手 → 统一结构 */
  function neteaseArtist(a) {
    return {
      source: 'netease',
      id: a.id,
      name: a.name || '',
      avatar: a.picUrl || a.img1v1Url || '',
      songNum: a.musicSize || 0,
      albumNum: a.albumSize || 0,
      brief: String(a.briefDesc || '').replace(/\s+/g, ' ').trim(),
    };
  }

  /** 咪咕歌手（data.items[].singer）→ 统一结构 */
  function miguArtist(it) {
    const s = (it && (it.singer || it)) || {};
    const imgs = s.imgs || [];
    const pick = imgs.find(x => x.imgSizeType === '02') || imgs[0] || {};
    return {
      source: 'migu',
      id: s.singerId || s.id,
      name: s.singer || s.name || '',
      avatar: miguImg(pick.img || ''),
      songNum: s.songNum || 0,
      albumNum: s.albumNum || 0,
      brief: String(s.summary || '').replace(/\s+/g, ' ').trim(),
    };
  }

  /** 网易云专辑（/artist/album → hotAlbums）→ 统一结构 */
  function neteaseAlbum(a) {
    return {
      source: 'netease',
      id: a.id,
      name: a.name || '(未命名专辑)',
      cover: a.picUrl || '',
      date: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : '',
      size: a.size || 0,
    };
  }

  /** 咪咕专辑（data.contents[]，view=ZJ-Album-Item）→ 统一结构 */
  function miguAlbum(x) {
    return {
      source: 'migu',
      id: x.resId,
      name: x.txt || '(未命名专辑)',
      cover: miguImg(x.img || ''),
      date: x.txt3 || '',
      size: 0,
    };
  }

  return {
    fmtCount, key,
    neteaseSong, miguSong, miguSingerSong,
    neteasePlaylist, miguPlaylistItem,
    neteaseArtist, miguArtist,
    neteaseAlbum, miguAlbum,
  };
})();
