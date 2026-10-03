/* ============================================================
   歌曲评论浮层
   ------------------------------------------------------------
   数据源：网易云 /comment/music（经主进程 slimPayload 瘦身）。
   咪咕没有评论接口 —— 必须给出明确提示，不能空白页/静默失败。

   实测接口行为（2026-10，歌曲 id=186016 晴天）：
     · hotComments / comments 同一次响应里都有；offset 翻页无重复、单调递增
     · body.total 是全站评论总数（1970250），不是这首歌的条数，禁止当条数展示
     · body.cnum 实测为 0，同样不可用
     · 参数非法时 HTTP 仍是 200，靠 body.code(400) + body.message 判断失败
   因此：条数一律用"已加载 N 条"表述，是否还有更多看 body.more。

   本模块只做评论浮层，不碰列表行与播放引擎。
   ============================================================ */
const Comments = (() => {
  const el = (id) => document.getElementById(id);

  const PAGE = 20;        // 每次拉取条数
  const HOT_MAX = 60;     // 热门评论最多加载多少条

  // 当前浮层状态
  let open = false;
  let song = null;        // 打开时锁定的歌曲（换歌时用它对比）
  let tab = 'hot';        // hot | new
  let hots = [];          // 热门评论（去重后）
  let latest = [];        // 最新评论（去重后）
  let offset = 0;         // 最新评论下一页 offset
  let moreNew = false;    // 最新评论是否还有更多
  let loading = false;
  let seq = 0;            // 请求序号：丢弃过期响应（切歌/切页签后回来的旧请求）
  let errMsg = '';        // 当前错误文案；非空时渲染错误态

  // ---------------------------------------------------------------- 工具
  function dedupe(list) {
    const seen = new Set();
    const out = [];
    list.forEach(function (c) {
      if (c == null || c.commentId == null) return;
      if (seen.has(c.commentId)) return;
      seen.add(c.commentId);
      out.push(c);
    });
    return out;
  }

  /** 大数字：12345 → 1.2万（评论点赞数用） */
  function fmtCount(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(v);
  }

  /** 评论时间：优先用接口给的 timeStr，缺失时用毫秒时间戳兜底 */
  function fmtTime(c) {
    if (c.timeStr) return String(c.timeStr);
    if (!c.time) return '';
    try {
      const d = new Date(c.time);
      const p = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } catch (e) { return ''; }
  }

  function currentList() { return tab === 'hot' ? hots : latest; }

  // ---------------------------------------------------------------- 渲染
  function renderComment(c) {
    const row = document.createElement('div');
    row.className = 'cm-item';
    row.dataset.cid = String(c.commentId);

    const avatar = document.createElement('img');
    avatar.className = 'cm-avatar';
    avatar.loading = 'lazy';
    avatar.alt = '';
    const u = c.user || {};
    if (u.avatarUrl) {
      avatar.src = u.avatarUrl;
      avatar.onerror = function () { UI.onImgError(avatar); };
    } else UI.onImgError(avatar);

    const main = document.createElement('div');
    main.className = 'cm-main';

    const nick = document.createElement('div');
    nick.className = 'cm-nick';
    nick.textContent = u.nickname || '匿名用户';

    const text = document.createElement('div');
    text.className = 'cm-text';
    text.textContent = c.content || '';   // textContent：评论里的 < > 不会变成标签

    main.appendChild(nick);
    main.appendChild(text);

    // 楼中楼引用
    (c.beReplied || []).forEach(function (b) {
      if (!b || !b.content) return;
      const quote = document.createElement('div');
      quote.className = 'cm-quote';
      const who = document.createElement('span');
      who.className = 'cm-quote-nick';
      who.textContent = (b.nickname || '某人') + '：';
      const what = document.createElement('span');
      what.textContent = b.content;
      quote.appendChild(who);
      quote.appendChild(what);
      main.appendChild(quote);
    });

    const meta = document.createElement('div');
    meta.className = 'cm-meta';
    const time = document.createElement('span');
    time.className = 'cm-time';
    time.textContent = fmtTime(c);
    const like = document.createElement('span');
    like.className = 'cm-like';
    like.title = '点赞数';
    like.innerHTML = Icons.svg('like') + '<b></b>';
    like.querySelector('b').textContent = fmtCount(c.likedCount);
    meta.appendChild(time);
    meta.appendChild(like);

    main.appendChild(meta);
    row.appendChild(avatar);
    row.appendChild(main);
    return row;
  }

  function paintMeta() {
    const list = currentList();
    const cnt = el('cmCount');
    if (!cnt) return;
    if (errMsg) { cnt.textContent = ''; return; }
    // 只报"已加载条数"，不报接口的 total（见文件头注释）
    cnt.textContent = list.length ? '已加载 ' + list.length + ' 条' : '';
  }

  function paintFoot() {
    const foot = el('cmFoot'), more = el('cmMore'), end = el('cmEnd');
    if (!foot) return;
    const has = currentList().length > 0;
    const canMore = tab === 'new' ? moreNew : (hots.length < HOT_MAX && hots.length > 0);
    if (!has) { foot.classList.add('hidden'); return; }
    foot.classList.remove('hidden');
    more.classList.toggle('hidden', !canMore);
    more.disabled = loading;
    more.textContent = loading ? '加载中…' : '加载更多';
    end.textContent = canMore ? '' : (tab === 'hot' ? '已显示全部热门评论' : '没有更多评论了');
  }

  function render() {
    const body = el('cmBody');
    if (!body) return;
    el('cmTabHot').classList.toggle('active', tab === 'hot');
    el('cmTabNew').classList.toggle('active', tab === 'new');
    paintMeta();

    if (errMsg) {
      UI.empty(body, 'note', '评论加载失败', errMsg);
      el('cmFoot').classList.add('hidden');
      return;
    }
    const list = currentList();
    if (!list.length) {
      if (loading) { UI.skeleton(body, 5); el('cmFoot').classList.add('hidden'); return; }
      UI.empty(body, 'comment', tab === 'hot' ? '还没有热门评论' : '还没有评论',
        tab === 'hot' ? '点“最新评论”看看大家在说什么' : '来当第一个评论的人吧');
      el('cmFoot').classList.add('hidden');
      return;
    }
    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach(function (c) { frag.appendChild(renderComment(c)); });
    body.appendChild(frag);
    paintFoot();
  }

  // ---------------------------------------------------------------- 数据
  /**
   * 拉一页评论。
   * @param addMore true=追加（最新评论翻页），false=替换
   */
  async function fetchPage(addMore) {
    if (!song) return;
    const mySeq = ++seq;
    loading = true;
    errMsg = '';
    render();

    let r;
    try {
      r = await window.dsh.comment(song.id, { limit: PAGE, offset: addMore ? offset : 0 });
    } catch (e) {
      if (mySeq !== seq) return;
      loading = false;
      errMsg = '网络异常：' + (e && e.message ? e.message : e);
      render();
      return;
    }
    if (mySeq !== seq) return;                 // 过期响应直接丢弃

    const body = (r && r.body) || {};
    // 失败判定：主进程 fetch 失败给 body.error；接口参数非法给 code!=200 + message
    if (!r || !r.ok || body.error) {
      loading = false;
      errMsg = body.error || ('HTTP ' + ((r && r.status) || 0));
      render();
      return;
    }
    if (body.code != null && body.code !== 200) {
      loading = false;
      errMsg = body.message || body.msg || ('接口返回 code=' + body.code);
      render();
      return;
    }

    const gotHot = dedupe(body.hotComments || []);
    const gotNew = dedupe(body.comments || []);

    if (addMore) {
      const before = latest.length;
      latest = dedupe(latest.concat(gotNew));
      offset = addMore ? offset + PAGE : PAGE;
      // 本页去重后一条没增加 → 认为到底了，避免"加载更多"点了没反应还一直在
      moreNew = !!body.more && latest.length > before;
    } else {
      hots = gotHot;
      latest = gotNew;
      offset = PAGE;
      moreNew = !!body.more;
    }
    loading = false;
    render();
  }

  /** 首次打开/刷新：一次请求同时拿到热门与最新 */
  async function load() {
    hots = []; latest = []; offset = 0; moreNew = false;
    errMsg = '';
    await fetchPage(false);
  }

  // ---------------------------------------------------------------- 开关
  function setHeader() {
    el('cmSongTitle').textContent = (song && song.name) || '—';
    const ar = (song && song.artistText) || '';
    const al = song && song.album && song.album.name ? ' · ' + song.album.name : '';
    el('cmSongArtist').textContent = (ar + al) || '—';
  }

  function openFor(s) {
    if (!s) { toast('先选一首歌再查看评论'); return; }
    // 音源差异判定只在 normalize.js 里做结构归一，这里只读归一化后的 source 字段
    song = s;
    open = true;
    tab = 'hot';
    seq++;                       // 让进行中的旧请求失效
    setHeader();
    el('cmOverlay').classList.remove('hidden');
    Views.syncOverlayClass();

    if (s.source === 'migu') {
      // 咪咕没有评论接口 —— 明确提示"不支持"，不是空白页
      loading = false;
      hots = []; latest = []; moreNew = false; offset = 0;
      errMsg = '';
      paintMeta();
      el('cmTabHot').classList.toggle('active', true);
      el('cmTabNew').classList.toggle('active', false);
      UI.empty(el('cmBody'), 'note', '该音源不支持评论',
        '咪咕（' + (s.name || '') + '）没有开放评论接口，请切到网易云音源查看评论');
      el('cmCount').textContent = '';
      el('cmFoot').classList.add('hidden');
      return;
    }
    load();
  }

  function close() {
    open = false;
    seq++;                       // 关掉后回来的响应不再渲染
    loading = false;
    el('cmOverlay').classList.add('hidden');
    Views.syncOverlayClass();
  }

  /** 刷新：重新拉第一页 */
  function refresh() {
    if (!song) return;
    if (song.source === 'migu') { toast('该音源不支持评论'); return; }
    load();
  }

  function switchTab(t) {
    if (tab === t) return;
    tab = t;
    // 切到"最新"且一页都没成功拉到过时，补拉一次
    if (t === 'new' && !latest.length && !errMsg && !loading && song && song.source !== 'migu') {
      fetchPage(false);
      return;
    }
    render();
  }

  function more() {
    if (loading || !song || song.source === 'migu') return;
    if (tab === 'new') { if (moreNew) fetchPage(true); return; }
    // 热门：接口每次固定返回 15 条热门（无法翻页），到上限就提示
    if (hots.length >= HOT_MAX) { paintFoot(); return; }
    if (hots.length) { toast('热门评论已全部显示'); paintFoot(); }
  }

  // 注意：浮层拖拽带的开关统一走 Views.syncOverlayClass（那里同时考虑
  // npOverlay / themeOverlay / cmOverlay / eqOverlay 四个浮层）。
  // 本模块不再维护一份局部的 syncOverlayClass，避免两处逻辑不一致
  // （历史上曾因为局部版漏了 eqOverlay 导致均衡器面板打开时拖拽带未关闭）。

  /**
   * 换歌时同步浮层：跟着换到新歌的评论，而不是残留上一首。
   * 由 Views.onSongChange 调用。
   */
  function onSongChange(s) {
    if (!open) return;
    const same = s && song && Norm.key(s) === Norm.key(song);
    if (same) return;
    openFor(s);                  // 换歌 → 重新加载（migu 会走"不支持"分支）
  }

  // ---------------------------------------------------------------- 绑定
  function init() {
    if (!el('cmOverlay')) return;
    el('cmClose').onclick = close;
    el('cmRefresh').onclick = refresh;
    el('cmMore').onclick = more;
    el('cmTabHot').onclick = function () { switchTab('hot'); };
    el('cmTabNew').onclick = function () { switchTab('new'); };
    el('cmOverlay').onclick = function (e) { if (e.target.id === 'cmOverlay') close(); };
  }

  return {
    init: init, openFor: openFor, close: close, refresh: refresh,
    switchTab: switchTab, more: more, onSongChange: onSongChange,
    isOpen: function () { return open; },
    _state: function () {
      return { open: open, tab: tab, hots: hots.length, latest: latest.length,
        moreNew: moreNew, loading: loading, errMsg: errMsg,
        song: song ? Norm.key(song) : null,
        ids: currentList().map(function (c) { return c.commentId; }) };
    },
  };
})();
