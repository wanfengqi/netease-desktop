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
    a.src = url;
    a.volume = state.volume;
    try { await a.play(); } catch (e) { if (!opts.silent) toast('播放失败：' + e.message); }

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

  // ---------------------------------------------------------------- 音频事件
  function bindAudio() {
    var a = audioEl();
    a.onplay = function () { setPlayIcon('play'); Views.syncNpPlayState(); };
    a.onpause = function () { setPlayIcon('paused'); Views.syncNpPlayState(); };

    a.onended = function () { next(true); };   // 自然播完：单曲循环/顺序播放才生效
    a.onerror = function () {
      if (!a.src) return;
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
    get audio() { return audioEl(); },
  };
})();
