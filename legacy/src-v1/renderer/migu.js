/* ============================================================
   咪咕音乐源适配器
   —— 把 migu-api-enhanced 的返回结构，归一化成与网易云相同的歌曲格式
   ============================================================ */
const MIGU_IMG_BASE = 'https://d.musicapp.migu.cn';

/** 咪咕图片路径 → 完整 URL */
function miguImg(src) {
  if (!src) return '';
  if (/^https?:\/\//.test(src)) return src;
  return MIGU_IMG_BASE + src;
}

/** 咪咕搜索结果 → 统一歌曲结构（映射规则统一放在 normalize.js，这里只做转发） */
function normalizeMiguSong(song) {
  return Norm.miguSong(song);
}

/** 搜索咪咕 */
async function miguSearch(keywords, limit = 40) {
  const r = await window.dsh.migu.search(keywords, 1);
  if (!r || r.code !== '000000') throw new Error(r?.info || '咪咕搜索失败');
  const items = r.data?.items || [];
  return items.slice(0, limit).map(it => normalizeMiguSong(it.song || it));
}

/** 取咪咕播放地址（getUrlH5V24 是唯一稳定返回 url 的接口） */
async function miguSongUrl(song) {
  const r = await window.dsh.migu.url(song.contentId, song.copyrightId, 'PQ', song.resourceType);
  const url = r?.data?.url;
  if (!url) throw new Error('咪咕无可用播放地址（可能需会员）');
  return {
    url,
    // 服务端虽标"60s 试听"，实测返回完整音频；这里如实标注以便 UI 提示
    audition: r.data.auditionsLength || 0,
    auditionStart: r.data.auditionsStartTime || 0,
    lrcUrl: r.data.lrcUrl || '',
  };
}

/** 取咪咕歌词（lrcUrl 是纯文本地址） */
async function miguLyric(contentId) {
  const r = await window.dsh.migu.lyric(contentId, 'lrc');
  if (r?.lrc) return r.lrc;
  if (r?.lrcUrl) {
    try {
      const txt = await window.dsh.migu.fetchText(r.lrcUrl);
      return txt || '';
    } catch { return ''; }
  }
  return '';
}

window.MiguProvider = { miguSearch, miguSongUrl, miguLyric, normalizeMiguSong, miguImg };
