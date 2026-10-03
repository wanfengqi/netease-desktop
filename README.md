# 网易云音乐 · 简易桌面版

Electron 桌面播放器，**双音源（网易云 + 咪咕）**，支持 **6 套内置皮肤 + 自定义取色换肤**。

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
| **双音源** | 网易云（完整曲库，VIP 需登录）/ 咪咕（免登录可播，力度更大） |
| **搜索** | 关键词搜歌；**单曲 / 歌单 / 歌手** 三分栏，显示封面、歌手、专辑、时长、VIP 标记 |
| **歌单** | 搜索歌单 → 打开详情（封面/创建者/曲数/播放量）→ 播放全部；网易云与咪咕双源均支持 |
| **歌手主页** | 搜索歌手 → 主页显示头像/简介/歌曲数专辑数，**过往专辑网格**（含发行日期）+ 热门歌曲；点专辑进曲目列表 |
| **播放模式** | 🔁 列表循环 / 🔂 单曲循环 / 🔀 随机播放 / ➡️ 顺序播放，点按钮循环切换，持久化 |
| **播放** | 播放/暂停、上下首、进度拖动、音量、静音 |
| **歌词详情页** | 点播放条左侧封面打开全屏歌词页：封面模糊铺底、当前行高亮居中、上下渐隐、**点歌词跳转**、进度拖动、页内控制 |
| **歌词** | 自动拉取并解析 LRC，桌面歌词独立窗口（可锁定鼠标穿透） |
| **登录** | 网易云扫码登录，cookie 持久化，重启不用重登 |
| **收藏** | 歌曲列表点 ♡ 收藏，侧边栏「我的收藏」集中管理（播放全部/清空），持久化到 config |
| **皮肤** | 6 套内置 + 从封面取色 + 自定义主色，全部持久化 |
| **托盘/快捷键** | 托盘菜单控制播放；媒体键、Ctrl+Alt+L 开关桌面歌词 |

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

**换肤方式**（界面右上 🎨）：
1. 点内置皮肤卡片直接切换
2. **从封面取色** — 读取当前播放歌曲封面主色，自动生成整套配色
3. **自定义主色** — 输入 `#RRGGBB`，由 HSL 推导深浅背景/文字/边框

自定义皮肤存在 `%APPDATA%/netease-desktop/themes.json`，点卡片左上角 ✕ 删除。

## 架构

```
src/
  main.js         主进程：窗口 / IPC / 托盘 / 快捷键 / API 与咪咕 SDK 托管
  preload.js      contextBridge 安全桥（渲染层只能调白名单接口）
  renderer/
    index.html    主界面骨架
    style.css     全部颜色走 CSS 变量
    themes.js     皮肤定义 + 取色/配色推导
    migu.js       咪咕适配器（把咪咕结构归一化成统一歌曲格式）
                   —— 含歌曲搜索、歌单搜索、歌单取曲
    app.js        播放器逻辑 + 皮肤系统 + 音源分发
    lyric.html    桌面歌词独立窗口
```

**音源抽象**：歌曲对象统一结构 `{ id, source, name, artists, album:{picUrl}, duration, vip }`，
搜索与取址按 `source` 分发到 `MiguProvider` 或网易云本地 API。

## 技术要点 / 踩坑记录

1. **网易云 API 端口自动选择**（3300-3400）——写死 3000 会让第二个实例直接崩。
2. **搜索接口不返回封面** —— `/search` 只给 `picId`，必须再用 `/song/detail` 批量补 `picUrl`。
3. **咪咕播放地址要用 `getUrlH5V24`** —— `getUrlV1`/`getUrlV2` 响应里根本没有 `url` 字段。
4. **咪咕响应标称"60s 试听"，实测返回完整音频**（如《晴天》270 秒 / 4.12MB）。
5. **API 子进程 stdout 必须持续消费** —— pipe 缓冲写满会阻塞子进程。
6. **Electron 二进制需手动装** —— npm 11 的 `allowScripts` 拦截 postinstall，
   执行 `node node_modules/electron/install.js` 并设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
7. **无边框窗口** —— `frame: false` 后标题栏要自己画，注意 `-webkit-app-region: drag` 与按钮的 `no-drag`。
8. **IPC 大响应要瘦身** —— `/playlist/detail` 原始响应 300-500KB，结构化克隆过 IPC 很吃力；
   主进程侧 `slimPayload()` 只保留渲染层用到的字段（歌单详情从 471KB 降到几十 KB）。
9. **用后台 job 启动 Electron 会被连带杀掉** —— 调试时要用 WMI `Win32_Process.Create` 或
   脱离式启动，否则父进程一结束应用就死，表现为「CDP 莫名超时」，极易误判成代码 bug。
10. **歌单接口** —— 网易云搜歌单用 `/cloudsearch?type=1000`（不是 `/search`），取曲用 `/playlist/detail`；
    咪咕用 `searchPlaylist` / `getPlaylistSong`，歌单 ID 字段是 `musicList.musicListId`。
11. **歌词居中滚动的实现** —— 滚动容器上下各留 `38vh` padding，滚动目标 = 
    `行.offsetTop - 容器高/2 + 行高/2`；配合 `mask-image` 线性渐隐做出远处淡出效果。
12. **歌词时轴用二分查找** —— 逐行线性扫描在大歌词下会随滚动掉帧，二分定位当前行 O(log n)。
13. **点击播放条封面开歌词页** —— 注意 `-webkit-app-region: no-drag`，否则点不动。
14. **歌手接口** —— 网易云搜歌手 `/cloudsearch?type=100`，专辑 `/artist/album`，热门 `/artists`（返回 hotSongs）；
    咪咕 `searchSinger`（ID 在 `items[].singer.singerId`）、`getSingerAlbum`、`getSingerSong`。
15. **咪咕专辑取曲的坑** —— `getSingerAlbum` 返回 `data.contents[]`（view="ZJ-Album-Item"），
    但 `getAlbumSong` 返回的是 `data.songList`（不是 contents！）；且 resId 为长数字的是**数字专辑**，
    取不到曲目，需给用户友好提示而不是空白。

## 免责声明

仅供个人学习与自用。音源接口来自第三方开源项目，音频版权归各平台与版权方所有，请勿用于分发或商业用途。