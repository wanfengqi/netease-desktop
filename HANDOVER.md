# HANDOVER —— 网易云音乐桌面版

> 用途：把上下文外化成文件。上下文被压缩/换窗口接手后，读这份就能继续，不必回忆。
> 最后更新：2026-10-03（v2 优化轮）

## 一、目标原文（用户原话，按时间顺序）

**第一轮（v1 交付）**

1. 「做一个网易云简易版桌面端好做吗」
2. 「桌面壳版本怎么做的，大小不是问题」
3. 「加上更换皮肤功能」
4. 「对了，让软件可以接入咪咕音乐源」
5. 「增加歌单功能，搜索时候也要搜索到歌单、增加播放方式选择（单曲循环、随机播放、顺序播放）」
6. 「要能点开歌词详情页，例如歌词，播放进度等，参考主流的音乐播放器那样」
7. 「这个做完给电脑关机。不要跟之前一样设置成自动关机，是只执行一次的关机」
8. 「歌手主页做一下，显示过往专辑」
9. 「五条 UI 改动：调节音量的ui区域调小一点，增加歌曲播放列表页面，增加收藏歌曲功能，返回ui区域做大一点，修改应用图标为可爱鲸鱼」
10. 「搜索栏增加显示历史搜索词功能」
11. 「返回ui的汉字出框了，直接取消汉字」

**第二轮（v2，本轮）**

12. 「参考市场主流音乐软件，优化这个桌面端。包括：美化页面，增加功能，优化代码等多方面」

## 二、当前真实状态（磁盘核对，非记忆）

| 项 | 状态 |
|---|---|
| 项目路径 | `E:\Huancun\netease-desktop` |
| 打包产物 | `release/win-unpacked/网易云音乐桌面版.exe` |
| 桌面快捷方式 | `C:\Users\seraga\Desktop\网易云音乐桌面版.lnk`（**每次重打包都要重设**，release 目录被删重建） |
| 用户配置 | `%APPDATA%/netease-desktop/` 下 `config.json`（cookie/source/playMode/favorites/recent/searchHistory/volume/muted/lyricOffset/queue/windowBounds）与 `themes.json` |
| 源码管理 | 已 `git init` 并提交基线（`baseline: delivered v1`）——改坏了可以 diff / 回退 |

源码规模（2026-10-03 v2）：

```
src/main.js               392 行   主进程
src/preload.js             40 行   安全桥
src/renderer/app.js       275 行   入口：状态/标题栏/键盘/皮肤面板/启动
src/renderer/player.js    419 行   播放引擎
src/renderer/views.js     907 行   视图层（含歌词）
src/renderer/ui.js        169 行   通用组件（歌曲行/骨架屏/右键菜单/可拖进度条）
src/renderer/normalize.js 161 行   音源归一化
src/renderer/icons.js      68 行   内联 SVG 图标库
src/renderer/migu.js       46 行   咪咕传输适配
src/renderer/themes.js    220 行   皮肤定义与取色
src/renderer/index.html   336 行
src/renderer/style.css    821 行
src/renderer/lyric.html    83 行   桌面歌词窗
src/../tools/cdp.js         —      CDP 调试客户端（无依赖）
```

## 三、v2 这轮改了什么

**① 修掉的真 bug**

- `app.js` 的 bind() 里，音源切换 tab 的回调**误粘进了启动代码**（`if (cfg.playMode)...`），
  `cfg` 在那个作用域里根本不存在 → **每点一次「咪咕/网易云」就抛 ReferenceError**，
  切换后的清空结果/聚焦输入框全都不执行。已修好并实测（切到咪咕再切回，无异常）。
- 切换音源会**清空正在播放的队列**（音乐被中断）。已改成：切换音源只影响搜索，并自动在新音源重搜当前关键词。
- 歌词加载重复请求了两次 `/lyric`（自相矛盾的取值表达式）。已理顺。
- 无歌词时桌面歌词窗会**留着上一首的歌词**不清。已修（无歌词时显示歌名占位）。
- 进度条缓冲进度 `#npBarBuf` 从未被赋值。已接 `audio.onprogress`。
- 随机模式下「上一首」是**重新随机一首**，找不到北。已改为播放历史栈回退。

**② 代码结构（app.js 1454 行 → 8 个模块，最大 907 行）**

拆分理由：单文件已超过 `tools.read` 的静默截断阈值（实测 1369 行），全量回写会删文件尾部。
现在每个文件都在安全线内。分层约定见 README「分层约定」一节，要点：
音源差异只允许出现在 `normalize.js` / `migu.js`；跨歌曲身份判断一律用 `Norm.key(song)`。

**③ 新增功能（对齐主流播放器）**

- 最近播放（去重 / 上限 200 / 清空 / 播放全部）
- 歌曲行右键或 ⋯ 菜单：播放 / 下一首播放 / 加入播放列表 / 收藏 / 复制歌名 / 从列表移除
- 播放列表**拖动排序**（拖完按当前歌的 key 重算索引，不会错位）
- Windows **系统媒体控制中心**（SMTC：封面/歌名/歌手/进度/系统播放键）
- 睡眠定时（15 / 30 / 60 分钟）
- 歌词时轴微调（±0.5s，范围 ±10s，持久化，桌面歌词窗同步折算）
- 音量/静音持久化；播放队列与进度位置持久化（重开恢复但不出声）
- 窗口大小与位置记忆；启动背景色跟随皮肤（不再闪白）
- 输入即搜（500ms 防抖）；快捷键 ←/→ 快退快进 5 秒、↑/↓ 音量、M 静音、L 桌面歌词、Ctrl+F 搜索

**④ 界面**

- 全部 emoji 换成内联 SVG 图标（`icons.js`，尺寸跟 font-size、颜色跟 currentColor）
- 侧边栏分组（在线音乐 / 我的音乐）+ 数量胶囊
- 歌单/专辑/歌手详情页改为**封面模糊铺底的 hero 头** + 悬浮播放键
- 歌曲行：悬浮时序号变播放键；正在播放行用跳动的均衡器动效
- 骨架屏取代「加载中…」；空状态带图标与副文案；封面加载失败有音符兜底
- 进度条可拖动 + 缓冲带 + 拖动加粗反馈；滑杆按已填充比例着色

## 四、运行与构建

```bash
npm start                      # 开发运行
npm run build:dir              # 免安装版 → release/win-unpacked/
npm run build                  # nsis 安装包
```

本机注意：PowerShell 执行策略禁止 `.ps1`，要用 `npm.cmd` 并前置
`$env:PATH="C:\Program Files\nodejs;"+$env:PATH`。
打包需设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 五、调试方式（**重要，别再用后台 job 启动**）

用 `tools.pwsh` 的 `run_in_background` 启动 Electron，**job 一结束进程就被连带杀掉**，
表现为 CDP 超时、像代码 bug。正确做法：

```powershell
$exe = "E:\Huancun\netease-desktop\node_modules\electron\dist\electron.exe"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = ($exe + " E:\Huancun\netease-desktop --remote-debugging-port=9401")
}
```

`tools/cdp.js`（无第三方依赖，Node 22+ 自带 WebSocket / fetch）用法：

```bash
node tools/cdp.js list                 # 列出 targets
node tools/cdp.js shot out.png         # 截图
node tools/cdp.js eval "<短表达式>"     # 慎用：长或多行脚本经 PowerShell 传参会被转义弄坏
node tools/cdp.js eval-file script.js  # ✅ 长脚本一律走这个
node tools/cdp.js console              # 读页面里收集到的 error/warning
```

> **端口别用 9222**：本机 9222 被 dsh-home 的 CDP Edge 长期占用（网页版 AI 用的）。
> 开发用 9401、打包版用 9333，测试前先核对 /json 里的 target 标题。
>
> **`const` 模块在 `window` 上取不到**：`Player`/`Views`/`UI`/`Norm`/`Icons`
> 是全局词法变量，判断「模块是否加载」要写 `typeof Player`，不要写 `window.Player`
> （`var state` 才是 window 属性）。

## 六、关键接口备忘

| 用途 | 网易云 | 咪咕 |
|---|---|---|
| 搜歌 | `/search`（无封面，需 `/song/detail` 补） | `searchSong` |
| 搜歌单 | `/cloudsearch?type=1000` | `searchPlaylist`（`musicList.musicListId`） |
| 搜歌手 | `/cloudsearch?type=100` | `searchSinger`（`items[].singer.singerId`） |
| 歌手专辑 | `/artist/album` | `getSingerAlbum` → `data.contents` |
| 歌单曲目 | `/playlist/detail` | `getPlaylistSong` |
| 专辑曲目 | `/album` | `getAlbumSong` → **`data.songList`** |
| 播放地址 | `/song/url/v1` | `getUrlH5V24`（V1/V2 无 url 字段） |

## 六·五、应用图标（四处，少一处用户就会觉得「没更新」）

1. 窗口标题栏自绘 logo（`index.html` 的 `#logo`，`<img src="icon.png">`）
2. `BrowserWindow({ icon })`
3. `Tray` —— `nativeImage.createFromPath(icon.png).resize(16)`
4. `package.json` → `build.win.icon: "src/renderer/icon.ico"`

桌面快捷方式建议 `IconLocation` 直接指向 icon.ico。改完必须清图标缓存：
`Stop-Process explorer` → 删 `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` → `Start-Process explorer`。

## 六·六、登录持久化

1. cookie 存 `config.json` 的 `cookie` 字段（含 `MUSIC_U`），每次请求由主进程作 query 参数透传。
2. 打开登录页先查状态：已登录 → 账号卡片；未登录 → 才显示二维码。**不要无条件弹二维码**。
3. **检查失败绝不清 cookie**：只有明确判定「未登录」才清；网络/服务异常一律保留。
4. `tryRefreshToken()` 尝试 `/login/token/refresh` 续期（已 try/catch 兜住）。

## 六·七、改这个项目时必须注意

1. **不要用「read 全量 → 改 → write 全量回写」改代码。** `tools.read` 对长文件会静默截断
   （实测 1433 行的 app.js 只返回 1369 行，无任何提示）。一律用 `edit` 定点替换；
   万不得已读全文时先校验 `lines.length === totalLines`。改完跑 `node --check` 验伤。
2. **模块是按 `<script>` 顺序加载的全局脚本**（不是 ESM）：共享全局作用域，
   `const` 重名会直接 SyntaxError。新增能力请挂到新的命名空间对象上
   （`Icons / Norm / UI / Player / Views`）。
3. **改界面前先想清楚该挂在哪**：音源差异 → `normalize.js`；渲染 → `views.js`；
   播放/队列 → `player.js`；跨页面复用的行/菜单 → `ui.js`。
4. PowerShell `Get-Content` 显示 UTF-8 文件会变成 GBK 乱码（「启动」→「鍚姩」），
   那是显示问题不是文件损坏，判断编码要用 Node 读。
5. 打包前先杀掉正在运行的旧打包版进程，否则 electron-builder 的 rmdir 会失败。
6. **浮层里的按钮点不动 = 标题栏拖拽带在吃事件。** 标题栏是 `-webkit-app-region:drag`，
   它覆盖的顶部 38px 会吞掉**所有**鼠标事件（页面连 mousedown 都收不到）。
   而且 Electron 只对「拖拽元素的**后代**」里的 no-drag 做减法 —— 给浮层本身加 no-drag **无效**。
   正确做法：浮层打开时整体关掉拖拽带（`Views.syncOverlayClass()` 给 body 加
   `overlay-open`，CSS 写 `body.overlay-open .titlebar{-webkit-app-region:no-drag}`）。
   这是 v1 起就存在的 bug（歌词页返回键一直点不动），v2 才定位到。
7. **验证这类问题不能用 CDP 合成事件。** `Input.dispatchMouseEvent` / `element.click()`
   都不走系统命中测试，会把被吞掉的点击测成「正常」（我第一轮就误判成修好了）。
   必须发真鼠标事件：PowerShell + user32 `SetCursorPos/mouse_event`，
   并用 `WindowFromPoint` 确认落点是目标窗口、用 `SetForegroundWindow` 先激活
   （否则点击会打到别的程序上）。坐标换算：**physical = 窗口左上角 + 页面 CSS 坐标（1:1），
   不要乘 devicePixelRatio**（本机 Electron 报 dpr=1.25，但窗口 1104px 宽 = 1090 CSS px）。

## 七、已知限制 / 未做

- 咪咕**数字专辑**（长数字 resId）取不到曲目，页面会提示「需在咪咕客户端购买」
- 网易云未登录时 VIP 歌曲只播 30 秒试听
- 未做：MV 播放、歌曲评论、均衡器、收藏歌单（歌单本身收藏）、迷你播放器、无损音质切换
- 队列持久化上限 300 首；播放历史上限 200 首

## 八、下一步（若继续）

1. 均衡器（Web Audio 的 BiquadFilter）——注意跨域音频需要 `crossOrigin`，
   CORS 不通过会变哑音，务必先验证再动手
2. 歌曲评论 / 相似歌曲（`/comment/music`、`/simi/song`）
3. 歌单收藏（`/playlist/subscribe`）
4. 每次重新打包后，**记得重设桌面快捷方式指向**

## 九、协作风险

- 音源接口是第三方开源项目，随时可能失效；咪咕「标称 60 秒试听实返完整音频」的行为更可能变
- 仅供个人自用，不要分发
