# HANDOVER —— 网易云音乐桌面版

> 用途：把上下文外化成文件。上下文被压缩/换窗口接手后，读这份就能继续，不必回忆。
> 最后更新：2026-10-03

## 一、目标原文（用户原话，按时间顺序）

1. 「做一个网易云简易版桌面端好做吗」
2. 「桌面壳版本怎么做的，大小不是问题」
3. 「加上更换皮肤功能」
4. 「对了，让软件可以接入咪咕音乐源」
5. 「增加歌单功能，搜索时候也要搜索到歌单、增加播放方式选择（单曲循环、随机播放、顺序播放）」
6. 「要能点开歌词详情页，例如歌词，播放进度等，参考主流的音乐播放器那样」
7. 「这个做完给电脑关机。不要跟之前一样设置成自动关机，是只执行一次的关机」
8. 「歌手主页做一下，显示过往专辑」
9. 「五条 UI 改动：调节音量的ui区域调小一点，增加歌曲播放列表页面，增加收藏歌曲功能，返回ui区域做大一点，修改应用图标为可爱鲸鱼」
   - 补正：「调小一点是指右边和应用边界留下空白，整体大小不动」
   - 补正：「歌曲播放页面的返回键调大，不是外面的返回键」
10. 「搜索栏增加显示历史搜索词功能」
11. 「返回ui的汉字出框了，直接取消汉字」

**全部已完成并实测通过。**

## 二、当前真实状态（磁盘核对，非记忆）

| 项 | 状态 |
|---|---|
| 项目路径 | `E:\Huancun\netease-desktop` |
| 打包产物 | `release/win-unpacked/网易云音乐桌面版.exe`（234.3MB，2026-10-03 11:07） |
| 桌面快捷方式 | `C:\Users\seraga\Desktop\网易云音乐桌面版.lnk` → 指向上述 exe（**已核对存在**） |
| 用户配置 | `%APPDATA%/netease-desktop/` 下 `config.json`（cookie/source/playMode）、`themes.json`（皮肤） |

源码规模：
```
src/main.js              341 行   主进程
src/preload.js            40 行   contextBridge 桥
src/renderer/app.js     1038 行   播放器+皮肤+音源分发+歌单+歌手+歌词页
src/renderer/index.html  227 行   界面骨架
src/renderer/style.css   471 行   全部走 CSS 变量
src/renderer/themes.js   220 行   6套皮肤+取色
src/renderer/migu.js      61 行   咪咕适配器
src/renderer/lyric.html   77 行   桌面歌词独立窗口
```

## 三、功能清单（均已实测）

- **双音源**：网易云（VIP 需登录）/ 咪咕（免登录可播，实测《晴天》完整 270 秒）
- **三分栏搜索**：单曲 / 歌单 / 歌手
- **歌单详情** + **专辑复用同一视图**（`_album:true` 标记）
- **歌手主页**：头像/简介/歌曲数专辑数 + 专辑网格（含发行日期）+ 热门歌曲
- **四种播放模式**：列表循环 🔁 / 单曲循环 🔂 / 随机 🔀 / 顺序 ➡️
- **歌词详情页**：封面模糊铺底、当前行居中高亮、上下渐隐、点歌词跳转、进度拖动
- **桌面歌词**独立窗口（可锁定鼠标穿透）
- **6 套皮肤** + 封面取色 + 自定义主色

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
表现为 CDP 超时、像代码 bug（我在这个坑里耗了很久）。正确做法：

```powershell
$exe = "E:\Huancun\netease-desktop\node_modules\electron\dist\electron.exe"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = ($exe + " E:\Huancun\netease-desktop --remote-debugging-port=9401")
}
```

> **端口别用 9222**：本机 9222 被 dsh-home 的 CDP Edge 长期占用（网页版 AI 用的）。
> 用 9222 时调试端口开不成，CDP 会连到 Edge 上，返回完全误导的结果（看着像应用坏了）。
> 建议 9401（开发）/ 9333（打包版），并先核对 /json 里的 target 标题是不是自己的应用。

然后用 CDP 驱动验收（`Runtime.evaluate` 断言真实 DOM + `Page.captureScreenshot` 截图）。

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

## 六·五、应用图标（四处，少一处用户就会觉得"没更新"）

1. **窗口标题栏自绘 logo** —— 最容易被认为是"应用图标"的地方（`index.html` 的 `#logo`，
   现为 `<img src="icon.png">`，曾是 ♪ 字符）
2. `BrowserWindow({ icon })` —— 任务栏/窗口图标
3. `Tray` —— `nativeImage.createFromPath(icon.png).resize(16)`
4. `package.json` → `build.win.icon: "src/renderer/icon.ico"` —— 打包进 exe

桌面快捷方式建议 `IconLocation` 直接指向 icon.ico（而非 `exe,0`）。
改完必须清图标缓存才可见。彻底刷新：
`Stop-Process explorer` → 删 `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` → `Start-Process explorer`。

图标由 `_genicon.js` 无依赖生成（手写 PNG 编码 + 4x 超采样）。

## 六·六、登录持久化（2026-10-03）

用户要求：「设置成记住登录状态，不要每次点开都要扫码」。

实现要点：
1. cookie 存 `%APPDATA%/netease-desktop/config.json` 的 `cookie` 字段（约 4KB，含 `MUSIC_U`），
   每次请求由主进程作为 query 参数透传给本地 API。
2. **打开登录页先查状态**（`renderLoginView()`）：已登录 → 显示账号卡片（头像/昵称/ID/VIP/退出登录）；
   未登录 → 才显示二维码。**不要无条件弹二维码**，否则用户会误以为掉登录。
3. **检查失败绝不清 cookie**：`refreshLoginState()` 只在明确判定"未登录"时才清；
   网络/服务异常一律保留登录态。
4. `tryRefreshToken()` 尝试 `/login/token/refresh` 续期（该 API 版本可能没有此模块，已 try/catch 兜住）。

## 六·七、改这个项目时必须注意

**不要用「read 全量 → 改 → write 全量回写」改代码。** `tools.read` 对长文件会静默截断
（实测 1433 行的 app.js 只返回 1369 行，无任何提示），全量回写会直接删掉文件尾部。
一律用 `edit` 做定点替换；万不得已读全文时先校验 `lines.length === totalLines`。
改完跑 `node --check` 验伤。

另：PowerShell `Get-Content` 显示 UTF-8 文件会变成 GBK 乱码（「启动」→「鍚姩」），
那是显示问题不是文件损坏，判断编码要用 Node 读。

## 七、已知限制 / 未做

- 咪咕**数字专辑**（长数字 resId）取不到曲目，页面会提示「需在咪咕客户端购买」
- 网易云未登录时 VIP 歌曲只播 30 秒试听
- 应用图标仍是 Electron 默认图标（`package.json` 里 `win.icon` 已留位，未提供 .ico）
- 未做：MV 播放、用户歌单收藏、播放历史

## 八、下一步（若继续）

1. 补一个应用图标（`src/renderer/icon.ico`），重打包
2. 可选：播放历史、收藏歌单、均衡器
3. 每次重新打包后，**记得重设桌面快捷方式指向**（release 目录被删重建）

## 九、协作风险

- 音源接口是第三方开源项目，随时可能失效；咪咕「标称60秒试听实返完整音频」的行为更可能变
- 仅供个人自用，不要分发