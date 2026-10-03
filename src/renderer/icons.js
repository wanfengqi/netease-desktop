/* ============================================================
   图标库 —— 用内联 SVG 取代 emoji
   ------------------------------------------------------------
   为什么换掉 emoji：emoji 由系统字体渲染，在不同系统/字号下粗细、
   颜色、视觉重量都不一致，和界面的线性风格冲突；SVG 可以继承
   currentColor 与字号（width/height = 1em），于是"图标大小"跟着
   CSS 的 font-size 走，主题色也能直接生效。

   用法：
     el.innerHTML = Icons.svg('play')      // 或
     Icons.set(el, 'play')
   ============================================================ */
const Icons = (() => {
  // 线性图标：stroke=currentColor，圆头圆角
  const line = (d) => '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  // 实心图标：fill=currentColor（播放/暂停/心形这类需要"实"的）
  const solid = (d) => '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" ' +
    'stroke="none" aria-hidden="true">' + d + '</svg>';

  const P = {
    // ---- 导航 ----
    search:   line('<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>'),
    note:     line('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    heart:    line('<path d="M12 20.5 4.2 12.7a4.9 4.9 0 0 1 7-6.9l.8.8.8-.8a4.9 4.9 0 0 1 7 6.9z"/>'),
    heartOn:  solid('<path d="M12 20.5 4.2 12.7a4.9 4.9 0 0 1 7-6.9l.8.8.8-.8a4.9 4.9 0 0 1 7 6.9z"/>'),
    clock:    line('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>'),
    user:     line('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
    list:     line('<path d="M3 6h13M3 12h13M3 18h9"/><path d="M19 9v9"/><circle cx="17" cy="19" r="2"/>'),
    queue:    line('<path d="M3 6h12M3 12h12M3 18h8"/><path d="M17 12v7M14 15h6"/>'),
    disc:     line('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>'),

    // ---- 传输控制（实心，主流播放器都是实心三角/双条） ----
    play:     solid('<path d="M8 5.2c0-.9 1-1.4 1.7-.9l9 6.8c.6.5.6 1.4 0 1.8l-9 6.8c-.7.5-1.7 0-1.7-.9z"/>'),
    pause:    solid('<rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/>'),
    prev:     solid('<rect x="5" y="5.5" width="2.4" height="13" rx="1.1"/><path d="M19 6.6c0-.8-.9-1.3-1.5-.8l-7.4 5.4c-.5.4-.5 1.2 0 1.6l7.4 5.4c.6.5 1.5 0 1.5-.8z"/>'),
    next:     solid('<rect x="16.6" y="5.5" width="2.4" height="13" rx="1.1"/><path d="M5 6.6c0-.8.9-1.3 1.5-.8l7.4 5.4c.5.4.5 1.2 0 1.6L6.5 18.2c-.6.5-1.5 0-1.5-.8z"/>'),
    shuffle:  line('<path d="M16 3h5v5"/><path d="M21 3 3 21"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M3 3l6 6"/>'),
    repeat:   line('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    repeatOne:line('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11.5 10.5h1.2V15"/>'),
    order:    line('<path d="M3 12h14"/><path d="m13 6 6 6-6 6"/>'),
    volume:   line('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.2a9.5 9.5 0 0 1 0 13.6"/>'),
    volumeLow:line('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
    mute:     line('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16 9 5 6M21 9l-5 6"/>'),

    // ---- 界面 ----
    close:    line('<path d="M18 6 6 18M6 6l12 12"/>'),
    min:      line('<path d="M5 12h14"/>'),
    max:      line('<rect x="5" y="5" width="14" height="14" rx="1.6"/>'),
    restore:  line('<rect x="8" y="8" width="11" height="11" rx="1.6"/><path d="M5 16V6.6A1.6 1.6 0 0 1 6.6 5H16"/>'),
    chevronD: line('<path d="m6 9 6 6 6-6"/>'),
    chevronU: line('<path d="m18 15-6-6-6 6"/>'),
    chevronL: line('<path d="m15 18-6-6 6-6"/>'),
    chevronR: line('<path d="m9 18 6-6-6-6"/>'),
    more:     solid('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>'),
    plus:     line('<path d="M12 5v14M5 12h14"/>'),
    trash:    line('<path d="M3.5 6h17"/><path d="M8.5 6V4h7v2"/><path d="m6 6 1 14h10l1-14"/><path d="M10 11v5M14 11v5"/>'),
    refresh:  line('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M21 4v5h-5"/>'),
    check:    line('<path d="m5 13 4.5 4.5L19 7"/>'),
    moon:     line('<path d="M20.5 14.3A8.6 8.6 0 1 1 9.7 3.5a6.9 6.9 0 0 0 10.8 10.8z"/>'),
    drop:     line('<path d="M12 3.2 6.9 8.3a7.2 7.2 0 1 0 10.2 0z"/>'),
    text:     line('<path d="M4 6.5V4h16v2.5"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
    link:     line('<path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5"/><path d="M15 3h6v6"/><path d="M10.5 13.5 21 3"/>'),
    copy:     line('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    music:    line('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    save:     line('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    // 歌词页：歌词 / 音量小图标
    lyric:    line('<path d="M4 6h16M4 11h10M4 16h13M4 21h7"/>'),
    bolt:     line('<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>'),
  };

  return {
    svg: (name) => P[name] || P.note,
    has: (name) => !!P[name],
    set: (el, name) => { if (el) el.innerHTML = P[name] || P.note; return el; },
    names: Object.keys(P),
  };
})();
