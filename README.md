# 网易云音乐桌面版 v2

Electron 桌面播放器，**双音源（网易云 + 咪咕）+ 本地音乐库 + 离线下载**。
本项目在 2026-10 做过一次渐进式重构：把 v1 的单文件脚本堆叠，换成
**分层架构 + Vite + Vue 3 + Pinia + TypeScript**，并按网易云桌面端的交互补全主流功能。
v1 源码已归档在 `legacy/src-v1/`（只读参考，不再维护）。

## 快速开始

```bash
npm install

npm run dev              # Vite 渲染层（:5173）+ Electron 主进程
npm start                # 同上
npm run typecheck        # vue-tsc + tsc
npm test                 # Vitest 全量（渲染层纯函数 + 主进程服务 + 打包配置）
npm run build:renderer   # 只构建渲染层到 dist/
npm run build:dir        # 免安装版 → release/win-unpacked/网易云音乐桌面版.exe
npm run build            # NSIS 安装包 → release/
```

> Windows 上统一用 `npm.cmd`（PowerShell 执行策略会拦 `npm.ps1`）。
> 重打包前必须杀掉正在运行的 electron / 打包版进程，否则 `dxcompiler.dll` 被占用会报 `EPERM`。

## 架构分层

```
app/                     渲染层（Vue 3 + Pinia，Vite 多入口：index / lyric / mini）
  src/core/              纯逻辑，不依赖 Vue、不依赖 DOM —— 可直接单测
    audio.ts             AudioEngine：注入 AudioElementLike，只管加载/播放/暂停/seek
    playmode.ts          播放模式的纯计算（list / one / shuffle / order）
    player.ts            Player：队列状态机 + URL 竞态守卫 + 历史栈 + 持久化快照
    settings.ts          配置迁移（v1 → v2 schema）与读写归一
    themes.ts            主题令牌（CSS 变量），新增主题不改样式
    equalizer.ts         10 段 BiquadFilter 的纯计算与预设
    mediaSession.ts      SMTC 适配
    lyric.ts / track.ts / queue.ts / preload.ts
  src/data/              网络与音源
    transport.ts         超时 / 重试 / 退避 / 业务码校验
    normalize.ts         跨音源统一歌曲对象，身份键 Norm.key = source:id
    netease.ts / migu.ts / search.ts / playlist.ts / lyric.ts / user.ts
    quality.ts / comments.ts / source.ts   （source.ts 负责"本地文件优先"选路）
    repository.ts        仓储层：字段瘦身在这里做，不在主进程做
  src/stores/            Pinia：player / favorites / playlists / history / search /
                         config / local / downloads / settings / account / comments /
                         lyrics / navigation / toast
  src/views/             首页 / 发现 / 搜索 / 我的音乐 / 本地音乐 / 下载管理 / 设置
  src/components/        标题栏 / 播放条 / 歌曲行 / 队列 / 评论面板 / 下载操作 …

electron/                主进程（CommonJS）
  main.cjs               窗口、生命周期、配置迁移入口
  preload.cjs            contextBridge 白名单（渲染层唯一入口）
  ipc/                   按域拆分：index / s7 / lyric / migu / mini / netease
  services/              neteaseApi（子进程）· miguApi（ESM）· localLibrary · downloads · localMedia
  windows/               lyricWin · miniMode
  shortcuts.cjs / tray.cjs / singleInstance.cjs / themeBg.cjs

legacy/src-v1/           v1 归档（main.js / preload.js / renderer/*），不参与构建
docs/                    改造计划、音源调研、各阶段验收、截图
```

IPC 域：`app:*` `win:*` `netease:*` `migu:*` `config:*` `lyric:*` `mini:*`
`dialog:chooseDir` `local:*` `downloads:*` `shortcuts:*` `tray:*`。

### 关键设计

- **播放内核可测**：`AudioEngine` 接收注入的 `AudioElementLike`，单测用假元素即可，真实
  `<audio>` 只在 `App.vue` 挂载。URL 竞态用自增 token + `isCurrent(token)` 守卫，切歌慢响应不会覆盖新歌。
- **跨音源身份只有一个键**：`Norm.key(song) = source:id`。收藏去重、队列高亮、历史定位、
  下载记录全部用它，不存在"按 id 单键比较"的第二套口径。
- **本地优先选路**：`data/source.ts` 的 `resolveSongUrl()` 先看 `song.localPath` 与下载完成记录，
  命中就走 `local-media://`（自定义协议，只服务已登记文件），否则才请求在线直链。
  离线可用是结构性的，不是 UI 层的判断。
- **持久化只有一条路径**：`stores/config.ts` 单一 400ms 防抖 flush，写 IPC 前把 Vue 响应式对象
  **深转纯数据**（响应式代理不可结构化克隆，直接过 IPC 会 `TypeError: An object could not be cloned`）；
  失败弹提示并保留 pending 供下次合并。
- **字段瘦身在仓储层**：主进程不再做 `slimPayload`，避免"哪个进程在删字段"说不清。
- **安全**：`contextIsolation: true` + `nodeIntegration: false` + preload 白名单 +
  受限 `local-media` 协议；CSP 显式声明 `media-src`（缺它会被 Chromium 判不安全而拒播）。

## 功能

| 分组 | 说明 |
|---|---|
| 播放 | 播放/暂停、上下首、进度拖动、缓冲显示、音量与静音、四种播放模式、队列（拖拽排序/移除/清空）、历史栈回退 |
| 搜索 | 单曲 / 歌单 / 歌手三分栏，输入防抖 + 回车立即搜，热门搜索，搜索历史 |
| 歌词 | 详情页（封面模糊铺底 + 当前行居中 + 点击跳转 + 时轴微调）；**桌面歌词独立窗**（可锁定鼠标穿透） |
| 音源 | 网易云（曲库全，部分需登录/VIP）、咪咕（免登录可播）、本地文件；VIP/版权失效时给**具体原因**而不是静默失败 |
| 收藏 / 历史 | 行内一键收藏、侧栏计数实时同步；最近播放自动去重、最新在前 |
| 歌单 | 我的歌单、场景歌单、推荐歌单、排行榜；新建 / 重命名 / 删除；导入导出 JSON |
| 本地音乐 | 添加目录 → 递归扫描（可取消）→ 读标签与封面；播放走本地协议，断网可播 |
| 离线下载 | 选择目录、批量下载当前队列、`.part` 写完改名；完成后可离线播放，删除即解除登记 |
| 音质 | 网易云 `standard/higher/exhigh/lossless`、咪咕 `PQ/HQ/SQ`（咪咕可能诚实降级，UI 显示实际档位） |
| EQ | 10 段 BiquadFilter + 预设；**仅网易云在线流真滤波**（咪咕无 CORS 头，接 MediaElementSource 会哑音，故如实不做） |
| 界面 | 6 套主题、迷你模式、睡眠定时、系统媒体键（SMTC）、托盘菜单、系统通知、窗口尺寸记忆 |
| 账号 | 网易云二维码登录（cookie 持久化）；未登录时相关功能显示锁定态而不是假数据 |
| 评论 | 歌曲评论面板：热门 / 最新双页签、点赞数、楼中楼、加载更多分页去重 |

## 数据与合规

- 配置与数据落在 `userData`（Windows：`%APPDATA%\netease-desktop\`）：
  `next-config.json`（v2 schema，由 v1 `config.json` 自动迁移，旧文件不删）、
  `next-downloads.json`（下载记录，只存本地路径与身份键，**不持久化直链与 cookie**）。
- 离线只做"本机磁盘 + 本应用内播放"，不提供导出、分享或转存；
  不做逆向接口调用、不绕过 DRM、不二次分发内容、不冒称官方客户端。

## 已知边界

- 单曲级"下载"入口只在播放详情页提供，列表行右键菜单尚未接（排行榜/歌单页可"下载当前队列"）。
- EQ 不覆盖咪咕与非网易云在线流；`hires / sky` 档位未开放。
- 本地曲库与缓存占用显示"未提供"——没有可靠的目录配额接口，宁可不显示也不给假数字。
- 咪咕 `getTodayRecommend` 需登录、`getSimilarSongRecommend` 返回空、`getNewSongList` 返回导航壳：
  上游接口现状，已按失败/空态如实处理。

## 开发验证

```bash
# 无头驱动打包版（隔离用户目录 + 静音 + CDP）
./release/win-unpacked/网易云音乐桌面版.exe \
  --remote-debugging-port=9413 \
  --user-data-dir="$(pwd)/.s9-exe-userdata" --mute-audio

CDP_PORT=9413 node tools/cdp.js list
CDP_MATCH=桌面版 CDP_PORT=9413 node tools/cdp.js eval-file /tmp/probe.js
CDP_MATCH=桌面版 CDP_PORT=9413 node tools/cdp.js shot docs/screenshots/xxx.png
```

音频验证一律静音，判定标准是 `paused === false && currentTime > 0`（截图证明不了出声）。
