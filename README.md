# 网易云音乐 · 简易桌面版

Electron 桌面播放器，**双音源（网易云 + 咪咕）**，支持 **6 套内置皮肤 + 自定义取色换肤**。
界面按主流播放器的交互重做过一版：矢量图标、封面模糊铺底的详情页、悬浮播放键、
骨架屏、右键菜单、可拖进度条、系统媒体控制中心。

## 快速开始

```bash
# 启动（或双击 启动.bat）
npm start

# 打包免安装版 → release/win-unpacked/
npm run build:dir

# 打包安装包 → release/*.exe
npm run build
```

> Windows 上 PowerShell 执行策略会阻止 `npm.ps1`。若 `npm` 报"无法加载文件"，改用 `npm.cmd`。

应用图标为手绘鲸鱼（`src/renderer/icon.png` + `icon.ico`，多尺寸 16-256），
由 `_genicon.js` 无依赖生成（手写 PNG 编码 + 逐像素绘制 + 超采样抗锯齿）。

## 功能

| 功能 | 说明 |
|---|---|
| **双音源** | 网易云（完整曲库，VIP 需登录）/ 咪咕（免登录可播，力度更大）；切换音源只影响搜索，不打断正在播放的歌 |
| **搜索** | 输入即搜（500ms 防抖）+ 回车立即搜；**单曲 / 歌单 / 歌手** 三分栏；结果条提供"播放全部 / 随机播放" |
| **歌单 / 专辑** | 封面模糊铺底的详情头；播放全部 / 随机播放；网易云与咪咕双源均支持 |
| **歌手主页** | 头像/简介/歌曲数专辑数 + 过往专辑网格（悬浮出现播放键）+ 热门歌曲 |
| **播放列表** | 队列可**拖动排序**、逐条移除、清空、随机播放；移除当前曲自动续播下一首 |
| **最近播放** | 自动记录（去重、最新在前、上限 200），可播放全部 / 清空 |
| **我的收藏** | 行内 ♡ 一键收藏，侧栏与页面计数实时同步 |
| **播放模式** | 🔁 列表循环 / 🔂 单曲循环 / 🔀 随机播放 / ➡️ 顺序播放，持久化 |
| **上一首** | 走**播放历史栈**：随机模式下也能回到"真正刚听过的那首"，而不是重新随机 |
| **右键菜单** | 任意歌曲行右键 / 点 ⋯：播放、下一首播放、加入播放列表、收藏、**查看评论**、复制歌名、从列表移除 |
| **歌曲评论** | 歌曲行右键 / ⋯ →「查看评论」：热门 / 最新双页签、头像昵称、内容、点赞数、时间、楼中楼引用；**加载更多**分页去重、刷新；空态与接口失败有明确文案。咪咕无评论接口 → 明确提示"该音源不支持评论" |
| **均衡器** | 标题栏 → 均衡器面板：**8 段 BiquadFilter（peaking）· ±12dB**、5 个预设（平坦/低音增强/人声/摇滚/流行）、自定义曲线、开关旁路，全部持久化。**仅网易云音源真滤波**；咪咕无 CORS 头，如实降级为原始直连并在面板标注"咪咕音源不支持均衡器" |
| **歌词详情页** | 点播放条左侧封面打开：封面模糊铺底、当前行居中高亮、上下渐隐、点歌词跳转、收藏、**歌词时轴微调（±0.1~10s，持久化）** |
| **歌词** | 自动拉取并解析 LRC，桌面歌词独立窗口（可锁定鼠标穿透） |
| **睡眠定时** | 15 / 30 / 60 分钟后自动停止播放 |
| **系统媒体控制** | 接入 Windows 媒体控制中心（SMTC）：显示封面/歌名/歌手，支持系统播放键与进度 |
| **进度 / 音量** | 进度条**可拖动**、显示缓冲进度、悬停出现滑块；音量可调、静音，**音量持久化**；音量区滚轮微调 |
| **会话记忆** | 记住上次的播放列表与进度位置（不自动出声）、窗口大小与位置 |
| **登录** | 网易云扫码登录，cookie 持久化，重启不用重登 |
| **皮肤** | 6 套内置 + 封面取色 + 自定义主色，全部持久化 |
| **快捷键** | 空格播放/暂停、←/→ 快退快进 5 秒、↑/↓ 音量、M 静音、L 桌面歌词、Ctrl+F 搜索、Esc 关闭浮层；全局媒体键 + Ctrl+Alt+L |
| **托盘** | 托盘菜单控制播放；点击图标显示主窗口 |

## 皮肤系统

皮肤 = **一组 CSS 变量**。所有颜色都走变量，加皮肤不用改样式。

```js
// src/renderer/themes.js
var BUILTIN_THEMES = {
  myTheme: {
    name: "我的皮肤",
    builtin: true,
    vars: {
      "--bg": "#...",         // 页面底色
      "--bg-2": "#...",       // 卡片/面板底
      "--bg-3": "#...",       // 悬停/次级底
      "--text": "#...",       // 主文字
      "--text-2": "#...",     // 次要文字
      "--text-3": "#...",     // 弱化文字
      "--accent": "#...",     // 主题色（按钮/高亮）
      "--accent-2": "#...",   // 主题色悬停
      "--accent-fg": "#...",  // 主题色上的文字
      "--border": "#...",
      "--shadow": "...",
      "--titlebar": "#...",   // 标题栏
      "--titlebar-fg": "#...",
      "--radius": "10px",
      "--lyric-active": "#...", // 桌面歌词当前行
    }
  }
};
```

内置：经典红 / 暗夜黑 / 樱花粉 / 极光青 / 素纸米 / 玻璃蓝。

**换肤方式**（界面右上 🎨）：内置卡片直选 / 从封面取色 / 自定义主色（HSL 推导整套配色）。
自定义皮肤存在 `%APPDATA%/netease-desktop/themes.json`，点卡片左上角 ✕ 删除。

## 架构

```
src/
  main.js         主进程：窗口 / IPC / 托盘 / 媒体键 / API 与咪咕 SDK 托管 / 窗口尺寸记忆
  preload.js      contextBridge 安全桥（渲染层只能调白名单接口）
  renderer/
    index.html    主界面骨架（静态图标用 data-icon 占位，启动时换成 SVG）
    style.css     全部颜色走 CSS 变量
    themes.js     皮肤定义 + 取色/配色推导 + applyTheme
    icons.js      图标库（内联 SVG，尺寸跟随 font-size，颜色跟随 currentColor）
    normalize.js  音源归一化：网易云/咪咕 → 统一歌曲·歌单·歌手对象（Norm.key 统一身份键）
    migu.js       咪咕传输适配（搜索/取址/歌词）
    ui.js         通用组件：歌曲行、骨架屏、空状态、右键菜单、可拖拽进度条
    comments.js   歌曲评论浮层：热门/最新分页、去重、空态与失败态
    player.js     播放引擎：队列/索引/播放模式/取址/媒体控制/睡眠定时/播放历史/均衡器（Web Audio）
    views.js      视图层：导航、搜索、歌单·专辑·歌手、收藏、最近播放、歌词详情页
    app.js        入口：全局状态、标题栏与键盘、皮肤面板、启动流程
    lyric.html    桌面歌词独立窗口
```

**分层约定（改代码前必读）**

1. **音源差异只能出现在 `normalize.js` 与 `migu.js`**。UI 层只认统一歌曲对象
   `{ id, source, name, artistText, artists[], album{name,picUrl}, duration, vip }`。
2. **任何跨歌曲的身份判断（收藏去重、播放高亮、队列拖拽后重定位）都必须用 `Norm.key(song)`**
   （= `source:id`），否则两个源的同 id 歌曲会撞车。
3. 所有颜色用 CSS 变量，禁止在 `style.css` 里硬编码色值（主题色/功能色除外）。
4. 图标一律 `Icons.svg(name)` / `Icons.set(el, name)`，不要再用 emoji。

## 技术要点 / 踩坑记录

1. **网易云 API 端口自动选择**（3300-3400）——写死 3000 会让第二个实例直接崩。
2. **搜索接口不返回封面** —— `/search` 只给 picId，必须再用 `/song/detail` 批量补 `picUrl`。
3. **咪咕播放地址要用 `getUrlH5V24`** —— `getUrlV1`/`getUrlV2` 响应里根本没有 `url` 字段。
4. **咪咕响应标称"60s 试听"，实测返回完整音频**（如《晴天》270 秒）。
5. **API 子进程 stdout 必须持续消费** —— pipe 缓冲写满会阻塞子进程。
6. **Electron 二进制需手动装** —— npm 11 的 `allowScripts` 拦截 postinstall，
   执行 `node node_modules/electron/install.js` 并设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
7. **无边框窗口** —— `frame: false` 后标题栏要自己画，注意 `-webkit-app-region: drag` 与按钮的 `no-drag`。
8. **IPC 大响应要瘦身** —— `/playlist/detail` 原始响应 300-500KB，主进程侧 `slimPayload()` 只保留用到的字段。
9. **用后台 job 启动 Electron 会被连带杀掉** —— 调试时要用 WMI `Win32_Process.Create` 或脱离式启动。
10. **歌单接口** —— 网易云搜歌单用 `/cloudsearch?type=1000`，取曲用 `/playlist/detail`；
    咪咕用 `searchPlaylist` / `getPlaylistSong`，歌单 ID 字段是 `musicList.musicListId`。
11. **歌词居中滚动的实现** —— 滚动容器上下各留 `38vh` padding，滚动目标 =
    `行.offsetTop - 容器高/2 + 行高/2`；配合 `mask-image` 线性渐隐。
12. **歌词时轴用二分查找** —— 逐行线性扫描在大歌词下会随滚动掉帧。
13. **点击播放条封面开歌词页** —— 注意 `-webkit-app-region: no-drag`。
14. **歌手接口** —— 网易云搜歌手 `/cloudsearch?type=100`，专辑 `/artist/album`，热门 `/artists`（hotSongs）；
    咪咕 `searchSinger`、`getSingerAlbum`、`getSingerSong`。
15. **咪咕专辑取曲的坑** —— `getSingerAlbum` 返回 `data.contents[]`，
    但 `getAlbumSong` 返回的是 `data.songList`（不是 contents！）；resId 为长数字的是数字专辑，取不到曲目。
16. **`const` 声明的模块在 `window` 上取不到** —— `Player`/`Views`/`UI`/`Icons`/`Norm` 是全局词法变量，
    在 CDP 里要写 `Player.x` 而不是 `window.Player.x`；`var state` 才是 `window.state`。
17. **进度条拖动要用指针捕获** —— 否则鼠标移出元素就丢事件，表现为"拖一半就断"；
    拖动期间 `timeupdate` 不许回写宽度，否则手感是"跳回去"。
18. **系统媒体控制** —— 要在主进程 `app.setAppUserModelId()`，Windows 才会把应用单独显示在媒体面板；
    `setPositionState` 每秒推一次即可，推太勤会抖。
19. **评论接口 `/comment/music` 的 `total` 不是这首歌的评论数** —— 实测《晴天》返回
    `total=1970250`（全站评论总数），而 `cnum` 为 0 也不可用。所以评论条数只报"已加载 N 条"，
    是否还有更多看 `more` 字段，**不要**把 `total` 当条数展示。
20. **评论翻页用 `offset`**（`limit=20&offset=20`），实测两页 commentId 零重叠、单调递增；
    渲染层再按 `commentId` 兜底去重一次。
21. **评论接口失败时 HTTP 仍是 200** —— 要判 `body.code !== 200` + `body.message`
    （如缺 id 时 `code=400, message="illegal resourceId!"`），只看 HTTP 状态会把失败当成功。
22. **评论响应必须瘦身** —— 原始响应 70-130KB，单条评论 27 个字段
    （`richContent`/`likeAnimationMap`/`decoration`/`vipRights` 全是客户端皮肤资源）。
    主进程 `slimPayload` 只留 7 个字段，100 条约 130KB → 约 12KB。
23. **均衡器能不能用，取决于音源的 CORS 头**（硬门结论，证据 `shots/g0-cors-evidence.md`）：
    网易云 `m801.music.126.net` 回 `Access-Control-Allow-Origin: *` → 可挂
    `createMediaElementSource`；咪咕 `freetyst.nf.migu.cn` **完全没有** `Access-Control-*` 头
    且 OPTIONS 403 → 挂上去会 `MEDIA_ERR_SRC_NOT_SUPPORTED`(code=4) **彻底哑音**。
    所以咪咕走 audio 直连，UI 如实标注"不支持"，**绝不做只改 UI 不改声音的伪均衡**。
24. **网易云必须用 `crossOrigin='anonymous'`，不能用 `'use-credentials'`** ——
    它的响应同时带 `ACAO: *` 与 `Access-Control-Allow-Credentials: true`，
    按 Fetch 规范"通配 ACAO + 带凭据"是非法的，用 credentials 反而会失败。
25. **`crossOrigin` 必须在设 `src` 之前写好** —— 请求发出后再改属性不生效。
26. **`createMediaElementSource` 对同一 audio 元素只能调一次** —— 所以链路建好后一直复用，
    旁路是"filter gain 归零 + 不再走 Web Audio"，而不是反复拆建。
27. **`file://` 页面下媒体元素不强制 CORS** —— 开发版里咪咕"能出声"是假阳性
    （同一探针搬到真 `http://` origin 立刻失败）。判断可行性必须用真实 http origin。

## 免责声明

仅供个人学习与自用。音源接口来自第三方开源项目，音频版权归各平台与版权方所有，请勿用于分发或商业用途。
