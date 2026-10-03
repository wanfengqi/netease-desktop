/* ============================================================
   播放引擎
   ------------------------------------------------------------
   职责：音频元素、播放队列与索引、播放模式、取址播放、进度/音量、
        系统媒体控制中心（Windows SMTC）、睡眠定时、播放历史记录。
   不含：任何列表/页面的 DOM 渲染 —— 那是 views.js 的事；
        这里只在"歌曲变了/状态变了"时调用 Views.refreshPlayState()。
   ============================================================ */
const Player = (() => {
  var audio = null;

  const PLAY_MODES = [
    { id: 'list',    icon: 'repeat',    label: '列表循环' },
    { id: 'one',     icon: 'repeatOne', label: '单曲循环' },
    { id: 'shuffle', icon: 'shuffle',   label: '随机播放' },
    { id: 'order',   icon: 'order',     label: '顺序播放' },
  ];

  function init() {
    audio = document.getElementById('audio');
    bindAudio();
    bindControls();
    setupMediaSession();
    state.shuffleStack = state.shuffleStack || [];
    restoreVolume();
    applyModeToUi();
    UI.draggableBar(document.getElementById('bar'), function (r) { seekRatio(r); });
    UI.draggableBar(document.getElementById('npBar'), function (r) { seekRatio(r); });
    eqInitPanel();
    // 暂停时也不要忘记把状态推给桌面歌词
    window.addEventListener('beforeunload', persistQueue);
  }

  const el = (id) => document.getElementById(id);
  const audioEl = () => audio || (audio = el('audio'));

  // ---------------------------------------------------------------- 基本控制
  function toggle() {
    var a = audioEl();
    if (!a.src) { if (state.queue.length) playAt(state.queue.length ? 0 : -1); return; }
    if (a.paused) a.play().catch(function (e) { toast('播放失败：' + e.message); });
    else a.pause();
  }

  function next(auto) {
    var i = pickNextIndex(!!auto);
    if (i < 0) { audioEl().pause(); toast('已播放到列表末尾'); return; }
    playAt(i);
  }

  /**
   * 上一首：优先回到"真正刚听过的那首"（播放历史栈）。
   * 主流播放器都是这个行为 —— 尤其在随机模式下，直接随机一首会让人找不到北。
   */
  function prev() {
    while (state.shuffleStack.length) {
      var i = state.shuffleStack.pop();
      if (i >= 0 && i < state.queue.length) { playAt(i, { keepHistory: true }); return; }
    }
    var j = pickPrevIndex();
    if (j >= 0) playAt(j, { keepHistory: true });
  }

  /** 挑下一首的索引（按播放模式）。auto=true 表示歌曲自然播完触发 */
  function pickNextIndex(auto) {
    var n = state.queue.length;
    if (!n) return -1;
    if (state.playMode === 'one' && auto) return state.index;      // 单曲循环只在自动续播时生效
    if (state.playMode === 'shuffle') {
      if (n === 1) return 0;
      var i, guard = 0;
      do { i = Math.floor(Math.random() * n); guard++; } while (i === state.index && guard < 50);
      return i;
    }
    if (state.playMode === 'order' && auto) return state.index + 1 < n ? state.index + 1 : -1;
    return (state.index + 1) % n;
  }

  function pickPrevIndex() {
    var n = state.queue.length;
    if (!n) return -1;
    if (state.playMode === 'shuffle') return Math.floor(Math.random() * n);
    return (state.index - 1 + n) % n;
  }

  function cyclePlayMode() {
    var idx = PLAY_MODES.findIndex(function (m) { return m.id === state.playMode; });
    setMode(PLAY_MODES[(idx + 1) % PLAY_MODES.length].id);
  }

  function setMode(id) {
    state.playMode = id;
    window.dsh.config.set({ playMode: id });
    applyModeToUi();
  }

  function applyModeToUi() {
    var m = PLAY_MODES.filter(function (x) { return x.id === state.playMode; })[0] || PLAY_MODES[0];
    var btn = el('btnMode');
    if (btn) { Icons.set(btn, m.icon); btn.title = m.label + '（点击切换）'; }
    var np = el('npMode');
    if (np) { Icons.set(np, m.icon); np.title = m.label + '（点击切换）'; }
  }

  // ---------------------------------------------------------------- 播放
  /**
   * 播放当前队列的第 i 首。
   * @param opts { silent:true 时不 toast 失败原因 }
   */
  async function playAt(i, opts) {
    opts = opts || {};
    if (i < 0 || i >= state.queue.length) return;
    // 记下"从哪首跳过来的"，供上一首回退（keepHistory 用于回退动作本身）
    if (!opts.keepHistory && state.index >= 0 && state.index !== i && state.queue[state.index]) {
      state.shuffleStack.push(state.index);
      if (state.shuffleStack.length > 50) state.shuffleStack.shift();
    }
    state.index = i;
    var s = state.queue[i];
    state.currentKey = Norm.key(s);
    updateNowBar(s);
    setPlayIcon('loading');
    Views.onSongChange(s);

    var url = null;
    try {
      if (s.source === 'migu') {
        var info = await MiguProvider.miguSongUrl(s);
        url = info.url;
      } else {
        var res = await api('/song/url/v1', { id: s.id, level: 'exhigh' });
        url = res && res.data && res.data[0] && res.data[0].url;
      }
    } catch (e) {
      toast('取播放地址失败：' + e.message);
    }
    if (!url) {
      toast('该歌曲无版权或需要登录/VIP');
      setPlayIcon('paused');
      return;
    }
    var a = audioEl();
    // 关键顺序：crossOrigin 必须在 src 之前设好；咪咕这里会被判为"不走 Web Audio"
    eqPrepareForSong(s);
    a.src = url;
    a.volume = state.volume;
    try { await a.play(); } catch (e) { if (!opts.silent) toast('播放失败：' + e.message); }
    eqPaint();   // 换歌后刷新面板上的音源支持提示

    recordRecent(s);
    updateMediaMetadata(s);
    persistQueue();
  }

  /** 从某个视图播放：把该视图的列表作为播放队列 */
  function playFromList(list, i) {
    setQueue(list.slice(), i);
    playAt(i);
  }

  function setQueue(list, index) {
    state.queue = list || [];
    state.shuffleStack = [];
    state.index = index == null ? -1 : index;
    Views.renderQueueView();
    persistQueue();
  }

  /** 下一首播放：插到当前歌曲后面（主流播放器都有） */
  function playNext(song) {
    if (!song) return;
    if (!state.queue.length || state.index < 0) {
      state.queue.push(song);
      if (state.index < 0) state.index = 0;
    } else {
      state.queue.splice(state.index + 1, 0, song);
    }
    Views.renderQueueView();
    persistQueue();
    toast('已加入下一首播放：' + song.name);
  }

  function addToQueue(song) {
    if (!song) return;
    state.queue.push(song);
    Views.renderQueueView();
    persistQueue();
    toast('已加入播放列表：' + song.name);
  }

  /** 从队列移除第 i 首；若移除的正是当前曲，则顺势续播下一首 */
  function removeAt(i) {
    if (i < 0 || i >= state.queue.length) return;
    var wasCurrent = i === state.index;
    state.queue.splice(i, 1);
    if (i < state.index) state.index--;
    if (wasCurrent) {
      if (!state.queue.length) { audioEl().pause(); state.index = -1; state.currentKey = ''; }
      else {
        state.index = Math.min(i, state.queue.length - 1);
        playAt(state.index, { silent: true });
      }
    }
    Views.renderQueueView();
    Views.refreshPlayState();
    persistQueue();
  }

  function clearQueue() {
    state.queue = []; state.index = -1; state.currentKey = '';
    audioEl().pause();
    Views.renderQueueView();
    Views.refreshPlayState();
    persistQueue();
  }

  /* 队列持久化：下次打开还在（不自动播放，只恢复列表与进度位置） */
  var persistTimer = null;
  function persistQueue() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      window.dsh.config.set({
        queue: state.queue.slice(0, 300),
        queueIndex: state.index,
      });
    }, 800);
  }

  function restoreQueue() {
    var cfg = state.cfg || {};
    if (!Array.isArray(cfg.queue) || !cfg.queue.length) return false;
    state.queue = cfg.queue.filter(function (s) { return s && s.name; });
    state.index = typeof cfg.queueIndex === 'number' ? cfg.queueIndex : -1;
    if (state.index >= state.queue.length) state.index = -1;
    Views.renderQueueView();
    // 恢复"上次听到哪首"的展示，但不自动出声
    if (state.index >= 0) {
      var s = state.queue[state.index];
      state.currentKey = Norm.key(s);
      updateNowBar(s);
      Views.onSongChange(s);
    }
    return true;
  }

  /** 播放历史（最近播放）：去重、最新在前、上限 200 */
  function recordRecent(song) {
    var k = Norm.key(song);
    state.recent = [song].concat(state.recent.filter(function (x) { return Norm.key(x) !== k; })).slice(0, 200);
    window.dsh.config.set({ recent: state.recent });
  }

  // ---------------------------------------------------------------- 进度/音量
  function seekRatio(r) {
    var a = audioEl();
    if (isFinite(a.duration) && a.duration > 0) a.currentTime = r * a.duration;
  }

  function setVolume(v, persist) {
    state.volume = Math.min(1, Math.max(0, v));
    var a = audioEl();
    a.volume = state.volume;
    if (state.volume > 0 && state.muted) setMuted(false, false);
    paintVolume();
    if (persist !== false) window.dsh.config.set({ volume: state.volume });
  }

  function setMuted(m, persist) {
    state.muted = m;
    audioEl().muted = m;
    paintVolume();
    if (persist !== false) window.dsh.config.set({ muted: m });
  }

  function paintVolume() {
    var vol = el('vol'), npVol = el('npVol');
    var pct = Math.round((state.muted ? 0 : state.volume) * 100);
    if (vol) { vol.value = pct; vol.style.setProperty('--v', pct + '%'); }
    if (npVol) { npVol.value = pct; npVol.style.setProperty('--v', pct + '%'); }
    var icon = state.muted || state.volume === 0 ? 'mute' : (state.volume < 0.5 ? 'volumeLow' : 'volume');
    Icons.set(el('btnMute'), icon);
    Icons.set(el('npMute'), icon);
  }

  function restoreVolume() {
    state.volume = typeof state.cfg.volume === 'number' ? state.cfg.volume : 0.7;
    state.muted = !!state.cfg.muted;
    audioEl().muted = state.muted;
    paintVolume();
  }

  function updateNowBar(s) {
    el('nowTitle').textContent = s.name || '';
    el('nowArtist').textContent = s.artistText || '';
    var cover = el('cover');
    var pic = (s.album && s.album.picUrl) || '';
    if (pic && cover.getAttribute('src') !== pic) cover.src = pic;
    document.title = (s.name ? s.name + ' - ' + (s.artistText || '') + ' · ' : '') + '网易云音乐';
  }

  /** play | paused | loading —— 统一驱动底栏与歌词页的按钮图标 */
  function setPlayIcon(mode) {
    var name = mode === 'loading' ? 'refresh' : (mode === 'play' ? 'pause' : 'play');
    [['btnPlay', name], ['npPlay', name]].forEach(function (p) {
      var b = el(p[0]);
      if (!b) return;
      Icons.set(b, p[1]);
      b.classList.toggle('is-loading', mode === 'loading');
    });
  }


  // ---------------------------------------------------------------- 均衡器（Web Audio）
  /* ============================================================
     单源（网易云）真均衡器
     ------------------------------------------------------------
     G0 硬门结论（证据 shots/g0-cors-evidence.md，任务 t13）：
       · 网易云 m801.music.126.net → Access-Control-Allow-Origin: *
         且该响应同时带 Access-Control-Allow-Credentials: true
         ⇒ 必须用 crossOrigin='anonymous'；用 'use-credentials' 会失败
       · 咪咕 freetyst.nf.migu.cn → 无任何 Access-Control-* 头，OPTIONS 403
         ⇒ 挂 createMediaElementSource 会在真正强制 CORS 的环境下
           MEDIA_ERR_SRC_NOT_SUPPORTED(error.code=4) 完全哑音
     因此：网易云走真滤波；咪咕跳过 Web Audio 直接裸播放，UI 如实标注。
     **绝不做"只改 UI 不改声音"的伪均衡。**

     图：audio → [10 x BiquadFilter(peaking)] → destination
     注意 createMediaElementSource 对同一个 audio 元素只能调用一次，
     所以链路建好后就一直复用，旁路靠 gain 全 0 + 是否连接来体现。
     ============================================================ */
  var EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000];   // 8 段（≥5）
  var EQ_MAX_DB = 12;                                            // ±12dB

  var EQ_PRESETS = [
    { id: 'flat',   name: '平坦',     gains: [0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'bass',   name: '低音增强', gains: [9, 7, 5, 2, 0, -1, -1, 0] },
    { id: 'vocal',  name: '人声',     gains: [-3, -2, 0, 3, 5, 4, 2, 0] },
    { id: 'rock',   name: '摇滚',     gains: [6, 4, 1, -2, -1, 2, 4, 5] },
    { id: 'pop',    name: '流行',     gains: [-1, 1, 3, 4, 3, 1, -1, -2] },
  ];

  var eqCtx = null, eqFilters = [], eqSrcNode = null, eqReady = false, eqBroken = false;
  var eqLastError = '';

  function eqSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  /** 读取持久化的均衡器设置（纳入既有 config 体系） */
  function eqSettings() {
    var c = (state.cfg && state.cfg.equalizer) || {};
    var gains = Array.isArray(c.gains) ? c.gains.slice(0, EQ_BANDS.length) : null;
    if (!gains || gains.length !== EQ_BANDS.length) {
      gains = EQ_PRESETS[0].gains.slice();
    }
    return {
      on: !!c.on,
      preset: c.preset || 'flat',
      gains: gains.map(function (g) { return Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, Number(g) || 0)); }),
    };
  }

  function eqSave(settings) {
    state.cfg = state.cfg || {};
    state.cfg.equalizer = settings;
    window.dsh.config.set({ equalizer: settings });
    eqPaint();
  }

  /**
   * 建立 Web Audio 链路。只在网易云歌曲上调用。
   * @returns true 表示链路可用
   */
  function eqBuild() {
    if (eqReady) return true;
    if (eqBroken) return false;
    if (!eqSupported()) { eqBroken = true; eqLastError = '当前环境不支持 Web Audio'; return false; }
    var a = audioEl();
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      eqCtx = new Ctx();
      // 关键：必须 anonymous。网易云响应 ACAO:* 与 ACAC:true 并存，
      // 用 'use-credentials' 会因规范禁止通配 + 凭据而失败。
      eqSrcNode = eqCtx.createMediaElementSource(a);
      eqFilters = EQ_BANDS.map(function (freq) {
        var f = eqCtx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.0;
        f.gain.value = 0;
        return f;
      });
      // 串成一条链，最后一节接 destination
      var node = eqSrcNode;
      eqFilters.forEach(function (f) { node.connect(f); node = f; });
      node.connect(eqCtx.destination);
      eqReady = true;
      eqLastError = '';
      return true;
    } catch (e) {
      eqBroken = true;
      eqLastError = String(e && e.message ? e.message : e);
      try { if (eqCtx) eqCtx.close(); } catch (e2) {}
      eqCtx = null; eqFilters = []; eqSrcNode = null; eqReady = false;
      console.warn('均衡器初始化失败，已回退裸播放：', eqLastError);
      return false;
    }
  }

  /** 把当前设置写进各个 filter（读回值即来自这里，可被 CDP 断言） */
  function eqApply() {
    var s = eqSettings();
    if (!eqReady) return;
    var active = s.on;
    eqFilters.forEach(function (f, i) {
      f.gain.value = active ? s.gains[i] : 0;
      f.frequency.value = EQ_BANDS[i];
    });
  }

  /**
   * 播放某首歌前调用：决定这首歌走不走 Web Audio。
   * 咪咕一律不走（G0 判定其无 CORS 头，挂了会哑音）。
   */
  function eqPrepareForSong(song) {
    var a = audioEl();
    var isNetease = !song || song.source !== 'migu';
    var want = isNetease && eqSettings().on && eqSupported() && !eqBroken;
    if (want) {
      if (!eqReady && !eqBuild()) {
        // 建链失败：如实降级，不让用户以为生效了
        eqFallback('均衡器不可用，已回退为原始播放');
        return;
      }
      // 必须在设置 src 之前设好 crossOrigin，否则请求已发出、改属性无效
      a.crossOrigin = 'anonymous';
      eqApply();
      if (eqCtx && eqCtx.state === 'suspended') eqCtx.resume().catch(function () {});
    } else {
      // 不启用/咪咕：清掉 crossOrigin，走 audio 直连（与改造前完全一致）
      try { a.removeAttribute('crossorigin'); } catch (e) {}
      a.crossOrigin = null;
    }
  }

  /** 运行时兜底：拆掉 Web Audio 链路、回退裸播放 */
  function eqFallback(msg) {
    var a = audioEl();
    eqReady = false;
    eqFilters = [];
    try { if (eqSrcNode) eqSrcNode.disconnect(); } catch (e) {}
    try { if (eqCtx) eqCtx.close(); } catch (e) {}
    eqCtx = null; eqSrcNode = null;
    try { a.removeAttribute('crossorigin'); } catch (e) {}
    a.crossOrigin = null;
    var s = eqSettings();
    s.on = false;
    eqSave(s);
    eqLastError = msg || '均衡器已回退';
    if (msg) toast(msg);
  }

  /** 关闭均衡器（旁路）：filter gain 归零 + 停止使用 Web Audio */
  function eqSetEnabled(on) {
    var s = eqSettings();
    s.on = !!on;
    if (s.on && !eqSupported()) {
      toast('当前环境不支持均衡器');
      s.on = false;
      eqSave(s);
      return;
    }
    eqSave(s);
    var cur = state.queue[state.index];
    // 立即对当前曲目生效（网易云即时建链，咪咕保持直连）
    if (cur) eqPrepareForSong(cur);
    eqApply();
    toast(s.on ? '均衡器已开启' : '均衡器已关闭（原声）');
  }

  function eqSetBand(i, db) {
    var s = eqSettings();
    if (i < 0 || i >= EQ_BANDS.length) return;
    s.gains[i] = Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, Number(db) || 0));
    s.preset = 'custom';
    s.on = true;
    eqSave(s);
    var cur = state.queue[state.index];
    if (cur) eqPrepareForSong(cur);
    eqApply();
  }

  function eqApplyPreset(id) {
    var p = EQ_PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var s = eqSettings();
    s.gains = p.gains.slice();
    s.preset = p.id;
    s.on = true;
    eqSave(s);
    var cur = state.queue[state.index];
    if (cur) eqPrepareForSong(cur);
    eqApply();
    toast('已切换到「' + p.name + '」');
  }

  /** 当前曲目是否真的走 Web Audio（供 UI 如实标注） */
  function eqActiveForCurrent() {
    var cur = state.queue[state.index];
    var isNetease = !cur || cur.source !== 'migu';
    return !!(eqSettings().on && eqReady && isNetease && !eqBroken);
  }

  // ---------------------------------------------------------------- 面板
  /**
   * 给标题栏的均衡器入口写入图标。
   *
   * 为什么内联写 SVG、而不是往 icons.js 加一条：
   *   icons.js 不在本任务 inScope，而均衡器图标只被本模块使用。
   *
   * 为什么 index.html 里这个按钮**故意不写 data-icon**：
   *   app.js 的启动顺序是 hydrateIcons() → … → Player.init()，
   *   即 hydrateIcons() 先跑。若按钮带 data-icon="eq"，而 Icons 里没有 'eq'，
   *   Icons.set 会写成 note 兜底图标；等 Player.init() 再覆盖虽然也能显示正确，
   *   但依赖"后写覆盖"很脆。去掉 data-icon 后 hydrateIcons() 直接跳过它，行为稳定。
   */
  function eqRegisterIcon() {
    try {
      var btn = el('btnEq');
      if (!btn || btn.querySelector('svg')) return;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><path d="M5 21V14M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3"/>' +
        '<path d="M2.5 12h5M9.5 6h5M16.5 14h5"/></svg>';
    } catch (e) { /* 图标失败不影响功能 */ }
  }

  /** 绑定面板控件（幂等：重复调用只绑一次） */
  function eqInitPanel() {
    var ov = el('eqOverlay');
    if (!ov || ov.dataset.bound) return;
    ov.dataset.bound = '1';
    eqRegisterIcon();
    var presetBox = el('eqPresets');
    if (presetBox) {
      presetBox.innerHTML = '';
      EQ_PRESETS.forEach(function (p) {
        var b = document.createElement('button');
        b.className = 'eq-preset';
        b.dataset.preset = p.id;
        b.textContent = p.name;
        b.onclick = function () { eqApplyPreset(p.id); };
        presetBox.appendChild(b);
      });
    }
    var sw = el('eqSwitch');
    if (sw) sw.onclick = function () { eqSetEnabled(!eqSettings().on); };
    var close = el('eqClose');
    if (close) close.onclick = eqClosePanel;
    var tb = el('btnEq');
    if (tb) tb.onclick = eqOpenPanel;
    var reset = el('eqReset');
    if (reset) reset.onclick = function () { eqApplyPreset('flat'); };
    ov.onclick = function (e) { if (e.target.id === 'eqOverlay') eqClosePanel(); };
    // Esc 关闭本面板。写在这里而不是 app.js，是把均衡器的影响面收敛在
    // player.js 内（app.js 不在本任务 inScope）；只在面板开着时响应，不抢别的浮层。
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && eqIsOpen()) eqClosePanel();
    });
    eqPaint();
  }

  function eqOpenPanel() {
    var ov = el('eqOverlay');
    if (!ov) return;
    eqPaint();
    ov.classList.remove('hidden');
    Views.syncOverlayClass();
  }
  function eqClosePanel() {
    var ov = el('eqOverlay');
    if (!ov) return;
    ov.classList.add('hidden');
    Views.syncOverlayClass();
  }
  function eqIsOpen() {
    var ov = el('eqOverlay');
    return !!ov && !ov.classList.contains('hidden');
  }

  /** 把设置渲染到面板（滑杆值、预设高亮、音源不支持提示） */
  function eqPaint() {
    var s = eqSettings();
    var box = el('eqBands');
    if (box && !box.dataset.built) {
      box.innerHTML = '';
      EQ_BANDS.forEach(function (freq, i) {
        var col = document.createElement('div');
        col.className = 'eq-band';
        var val = document.createElement('span');
        val.className = 'eq-val';
        var range = document.createElement('input');
        range.type = 'range';
        range.min = String(-EQ_MAX_DB);
        range.max = String(EQ_MAX_DB);
        range.step = '1';
        range.dataset.band = String(i);
        range.className = 'eq-slider';
        var lab = document.createElement('span');
        lab.className = 'eq-hz';
        lab.textContent = freq >= 1000 ? (freq / 1000) + 'k' : String(freq);
        range.oninput = function () { eqSetBand(i, range.value); };
        col.appendChild(val); col.appendChild(range); col.appendChild(lab);
        box.appendChild(col);
      });
      box.dataset.built = '1';
    }
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('.eq-slider'), function (r) {
        var i = Number(r.dataset.band);
        r.value = String(s.gains[i]);
        var v = r.parentNode.querySelector('.eq-val');
        if (v) v.textContent = (s.gains[i] > 0 ? '+' : '') + s.gains[i];
      });
    }
    var sw = el('eqSwitch');
    if (sw) sw.classList.toggle('on', s.on);
    var swLabel = el('eqSwitchLabel');
    if (swLabel) swLabel.textContent = s.on ? '已开启' : '已关闭';
    var g = el('eqPresets');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll('.eq-preset'), function (b) {
        b.classList.toggle('active', b.dataset.preset === s.preset);
      });
    }
    // 如实标注当前音源能否用均衡器 —— 绝不显示"已生效"却没改声音
    var note = el('eqNote');
    if (note) {
      var cur = state.queue[state.index];
      var migu = cur && cur.source === 'migu';
      if (!eqSupported()) {
        note.textContent = '当前环境不支持 Web Audio，均衡器不可用';
        note.className = 'eq-note warn';
      } else if (eqBroken) {
        note.textContent = '均衡器初始化失败，已回退为原始播放' + (eqLastError ? '（' + eqLastError + '）' : '');
        note.className = 'eq-note warn';
      } else if (migu) {
        note.textContent = '咪咕音源不支持均衡器（该音源无 CORS 头），当前为原始直连播放';
        note.className = 'eq-note warn';
      } else if (s.on) {
        note.textContent = '已对网易云音源实时生效（8 段 · ±12dB）';
        note.className = 'eq-note ok';
      } else {
        note.textContent = '均衡器已关闭，音频走原始链路';
        note.className = 'eq-note';
      }
    }
  }

  // ---------------------------------------------------------------- 音频事件
  function bindAudio() {
    var a = audioEl();
    a.onplay = function () { setPlayIcon('play'); Views.syncNpPlayState(); };
    a.onpause = function () { setPlayIcon('paused'); Views.syncNpPlayState(); };

    a.onended = function () { next(true); };   // 自然播完：单曲循环/顺序播放才生效
    a.onerror = function () {
      if (!a.src) return;
      // 运行时兜底：开启均衡器时若 media error 4（SRC_NOT_SUPPORTED），
      // 典型成因就是 CORS 被强制后跨域音频拿不到 —— 拆掉 Web Audio 回退裸播放
      var code = a.error && a.error.code;
      if (code === 4 && eqReady) {
        eqFallback('均衡器与当前音源不兼容，已自动回退为原始播放');
        // 回退后重放当前曲目，让用户不至于停在"哑音"状态
        if (state.index >= 0) {
          setTimeout(function () { playAt(state.index, { silent: true, keepHistory: true }); }, 0);
        }
        setPlayIcon('paused');
        return;
      }
      toast('音频加载失败，可能是版权或网络问题');
      setPlayIcon('paused');
    };
    a.ontimeupdate = function () {
      paintProgress();
      Views.updateNpLyric(a.currentTime);
      window.dsh.lyric.push({ time: a.currentTime, playing: !a.paused });
    };
    a.onprogress = function () {
      // 缓冲进度：主流播放器进度条上会有一条浅色缓冲带
      try {
        if (a.buffered.length && isFinite(a.duration) && a.duration > 0) {
          var end = a.buffered.end(a.buffered.length - 1);
          var p = Math.min(100, end / a.duration * 100) + '%';
          ['barBuf', 'npBarBuf'].forEach(function (id) {
            var b = el(id); if (b) b.style.width = p;
          });
        }
      } catch (e) {}
    };
    a.ondurationchange = paintProgress;
  }

  var lastPosPush = 0;
  function paintProgress() {
    var a = audioEl();
    var dur = isFinite(a.duration) ? a.duration : 0;
    var p = dur ? (a.currentTime / dur * 100) : 0;
    var bar = el('barFill'), dot = el('barDot');
    if (bar && !dragGuard('#bar')) { bar.style.width = p + '%'; }
    if (dot && !dragGuard('#bar')) { dot.style.left = p + '%'; }
    var f = el('tCur'), d = el('tDur');
    if (f) f.textContent = fmtTime(a.currentTime);
    if (d) d.textContent = fmtTime(dur);
    Views.paintNpProgress(p, a.currentTime, dur);
    // SMTC 进度：每秒推一次就够，推太勤会让系统媒体面板抖动
    if (Date.now() - lastPosPush > 1000 && dur) {
      lastPosPush = Date.now();
      try {
        navigator.mediaSession.setPositionState({
          duration: dur, position: Math.min(a.currentTime, dur), playbackRate: a.playbackRate || 1,
        });
      } catch (e) {}
    }
  }
  // 拖动中不要被 timeupdate 抢走进度条（否则手感是"跳回去"）
  var dragBars = {};
  function dragGuard(sel) {
    var bar = document.querySelector(sel);
    return !!(bar && bar.classList.contains('dragging'));
  }

  function bindControls() {
    el('btnPlay').onclick = toggle;
    el('btnNext').onclick = function () { next(false); };
    el('btnPrev').onclick = prev;
    el('btnMode').onclick = cyclePlayMode;
    el('npPrev').onclick = prev;
    el('npNext').onclick = function () { next(false); };
    el('npPlay').onclick = toggle;
    el('npMode').onclick = cyclePlayMode;

    el('vol').oninput = function (e) { setVolume(e.target.value / 100); };
    el('npVol').oninput = function (e) { setVolume(e.target.value / 100); };
    el('btnMute').onclick = function () { setMuted(!state.muted); };
    el('npMute').onclick = function () { setMuted(!state.muted); };

    // 底栏音量滚轮微调（鼠标悬停音量区即可）
    document.querySelector('.vol').addEventListener('wheel', function (e) {
      e.preventDefault();
      setVolume(state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });
  }

  // ---------------------------------------------------------------- 系统媒体控制
  /** 让 Windows 音量面板/媒体键面板显示歌曲信息与控制按钮（SMTC） */
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var ms = navigator.mediaSession;
    var acts = {
      play: function () { if (audioEl().paused) toggle(); },
      pause: function () { audioEl().pause(); },
      previoustrack: prev,
      nexttrack: function () { next(false); },
      stop: function () { audioEl().pause(); },
      seekbackward: function (d) { audioEl().currentTime = Math.max(0, audioEl().currentTime - (d.seekOffset || 5)); },
      seekforward: function (d) { audioEl().currentTime = Math.min(audioEl().duration || 1e9, audioEl().currentTime + (d.seekOffset || 5)); },
      seekto: function (d) { if (typeof d.seekTime === 'number') audioEl().currentTime = d.seekTime; },
    };
    Object.keys(acts).forEach(function (k) { try { ms.setActionHandler(k, acts[k]); } catch (e) {} });
  }

  function updateMediaMetadata(s) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      var pic = (s.album && s.album.picUrl) || '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.name || '', artist: s.artistText || '',
        album: (s.album && s.album.name) || '',
        artwork: pic ? [{ src: pic, sizes: '300x300', type: 'image/jpeg' }] : [],
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------- 睡眠定时
  function setSleepTimer(minutes) {
    clearSleepTimer(false);
    if (!minutes) { toast('已关闭睡眠定时'); paintSleep(); return; }
    var endAt = Date.now() + minutes * 60000;
    state.sleepEndAt = endAt;
    state.sleepTimer = setInterval(function () {
      var left = Math.round((endAt - Date.now()) / 60000);
      var sec = Math.round((endAt - Date.now()) / 1000);
      paintSleep();
      if (sec <= 0) {
        clearSleepTimer(true);
        audioEl().pause();
        toast('睡眠定时到，已停止播放');
      } else if (sec <= 10 && sec > 0) {
        // 最后 10 秒每秒提醒一次，避免用户以为卡了
        var t = document.getElementById('sleepBtn');
        if (t) t.title = '将在 ' + sec + ' 秒后停止播放';
      }
    }, 1000);
    toast(minutes + ' 分钟后停止播放');
    paintSleep();
  }

  function clearSleepTimer(silent) {
    if (state.sleepTimer) { clearInterval(state.sleepTimer); state.sleepTimer = null; }
    state.sleepEndAt = 0;
    paintSleep();
  }

  function paintSleep() {
    var b = el('sleepBtn');
    if (!b) return;
    var on = !!state.sleepEndAt;
    b.classList.toggle('on', on);
    if (!on) { b.title = '睡眠定时'; return; }
    var left = Math.max(0, Math.round((state.sleepEndAt - Date.now()) / 60000));
    b.title = '睡眠定时：约 ' + left + ' 分钟后停止';
  }

  return {
    init: init, toggle: toggle, next: next, prev: prev,
    playAt: playAt, playFromList: playFromList, setQueue: setQueue,
    playNext: playNext, addToQueue: addToQueue, removeAt: removeAt, clearQueue: clearQueue,
    restoreQueue: restoreQueue, persistQueue: persistQueue,
    recordRecent: recordRecent,
    setVolume: setVolume, setMuted: setMuted, paintVolume: paintVolume,
    cyclePlayMode: cyclePlayMode, setMode: setMode, applyModeToUi: applyModeToUi,
    setPlayIcon: setPlayIcon, paintProgress: paintProgress, updateNowBar: updateNowBar,
    seekRatio: seekRatio,
    setSleepTimer: setSleepTimer, clearSleepTimer: clearSleepTimer,
    PLAY_MODES: PLAY_MODES,
    // ---- 均衡器 ----
    EQ_BANDS: EQ_BANDS, EQ_MAX_DB: EQ_MAX_DB, EQ_PRESETS: EQ_PRESETS,
    eqSetEnabled: eqSetEnabled, eqSetBand: eqSetBand, eqApplyPreset: eqApplyPreset,
    eqOpenPanel: eqOpenPanel, eqClosePanel: eqClosePanel, eqIsOpen: eqIsOpen,
    eqPaint: eqPaint, eqFallback: eqFallback,
    eqIsSupported: eqSupported, eqActiveForCurrent: eqActiveForCurrent,
    eqState: function () {
      var s = eqSettings();
      return {
        on: s.on, preset: s.preset, gains: s.gains.slice(),
        built: eqReady, broken: eqBroken, lastError: eqLastError,
        crossOrigin: audioEl().crossOrigin,
        filters: eqFilters.map(function (f) { return { type: f.type, freq: f.frequency.value, gain: f.gain.value, q: f.Q.value }; }),
        activeForCurrent: eqActiveForCurrent(),
      };
    },
    get audio() { return audioEl(); },
  };
})();
