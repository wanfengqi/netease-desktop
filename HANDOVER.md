# HANDOVER —— 网易云音乐桌面版 v2

> 用途：把上下文外化成文件。换窗口/换人接手时读这份即可继续，不必回忆。
> 最后更新：2026-10-26（S9 归档 + 生产打包验收完成；`dd15c5e` 落最终验收报告并在 exe 上补齐咪咕音源链路复测）

## 一、路径与运行

| 项 | 值 |
|---|---|
| 项目根 | `E:\Huancun\projects\pv-mad\netease-desktop`（**不是** `E:\Huancun\netease-desktop`，那是旧记忆里的失效路径） |
| 交付形态 | `release/win-unpacked/网易云音乐桌面版.exe`（免安装 v2.0.0）；NSIS 用 `npm.cmd run build` |
| 用户数据 | `%APPDATA%\netease-desktop\next-config.json` + `next-downloads.json`；v1 的 `config.json` 只读迁移不删除 |
| v1 归档 | `legacy/src-v1/`（不参与构建，`build.files` 已排除） |
| 环境 | Electron 44.5.1 / electron-builder 26.15.3 / Node v24.21.0 / **TypeScript 固定 5.9.3** |

**TypeScript 不许升到 7**：`vue-tsc` 在 TS7 下直接崩（`this extension was not loaded`），S0 就因此回退过一次。

## 二、命令

```bash
npm.cmd run dev / start      # Vite :5173 + Electron
npm.cmd run typecheck        # vue-tsc（app）+ tsc（electron 配置）
npm.cmd test                 # Vitest：32 文件 / 365 测试
npm.cmd run build:renderer   # dist/ 三入口 index|lyric|mini
npm.cmd run build:dir        # 免安装版
npm.cmd run build            # NSIS 安装包（createDesktopShortcut=false，桌面不留快捷方式）
```

坑（都踩过）：
- **重打包前必须杀进程**，否则 `dxcompiler.dll` EPERM。用 `node tools/s9-project-processes` 或
  `powershell -File tools/s9-project-processes.ps1`。
- `npx` 在本机 bash 里 `spawnSync npx ENOENT`，用 `node_modules` 里的库直接 `require`（见 `tools/s9-asar-check.cjs`）。
- 管道会吞退出码：`npm.cmd run typecheck | tail` 报的是 `tail` 的 0。
  一律 `npm.cmd run typecheck > /tmp/x.log 2>&1; echo "EXIT=$?"`。
- `timeout` / `curl` 会被 Windows 同名程序遮蔽，脚本内判时用 `Promise.race`。
- asar 内路径 `.listPackage()` 返回反斜杠、`extractFile` 需正斜杠，且 `dist/assets/index-*.js` 走 `extractFile` 会报 not found —— 取证直接读 asar 二进制（已封装在 tools/s9-asar-check.cjs）。

## 三、架构（谁负责什么）

```
app/src/core/    纯逻辑：AudioEngine(注入 AudioElementLike) / playmode / Player(队列+竞态守卫+历史栈)
                 settings(v1→v2 迁移) / themes / equalizer(10 段) / mediaSession / lyric / queue / track
app/src/data/    transport(超时·重试·退避·业务码) / normalize(Song + Norm.key=source:id)
                 netease / migu / search / playlist / lyric / user / quality / comments
                 source.ts(resolveSongUrl：localPath 与下载记录优先) / repository(字段瘦身在这里)
app/src/stores/  player favorites playlists history search config local downloads settings account
                 comments lyrics navigation toast
electron/        main.cjs + preload.cjs(白名单) + ipc/{index,s7,lyric,migu,mini,netease}.cjs
                 services/{neteaseApi(子进程),miguApi(ESM),localLibrary,downloads,localMedia}.cjs
                 windows/{lyricWin,miniMode}.cjs + shortcuts.cjs + tray.cjs + singleInstance.cjs
```

三条不可破坏的规则：
1. **跨歌曲身份只用 `Norm.key(song)=source:id`**，不允许出现按裸 id 比较的第二套口径。
2. **持久化只走 `stores/config.ts`** 的 400ms 防抖 flush，且写 IPC 前深转纯数据 ——
   Vue 响应式代理不可结构化克隆，不过边界就会 `TypeError: An object could not be cloned`（S4/S6 两次真实事故）。
3. **音源字段映射只在 `data/` 里**，主进程不做 `slimPayload`，视图层不认识网易云/咪咕的原始字段。

`local-media://` 协议只服务"已登记文件"（`services/localMedia.cjs`），别改成任意路径可读。

## 四、S9 这一轮做了什么（以及为什么）

用户决定"**只留新版：旧版源码进 git 归档，打包只出新版**"，于是：

1. `git mv src → legacy/src-v1/`；图标从 `src/renderer/` 移到 `assets/`；`app/public/icon.png` 供标题栏。
2. `package.json`：`main → electron/main.cjs`、`version → 2.0.0`、
   `build.files` 只留 `electron/dist/assets/package.json/node_modules` 并排除 tests/docs/legacy/shots/tools、
   `win.icon → assets/icon.ico`、`nsis.createDesktopShortcut = false`。
3. `asarUnpack` 改成 `node_modules/**/*`。**这是打包版第一次跑不起来的真因**：
   API 子进程是普通 Node，读不了 asar，只解 `NeteaseCloudMusicApi` 本体时它的依赖（axios 等）仍在 asar 内 →
   `Cannot find module 'axios'` → 子进程退出 → 主进程被 25s 就绪等待与重试堵死 → CDP eval 全部超时。
   症状看起来像"渲染进程卡死"，其实是主进程忙。v1 能跑正是因为整包解出 node_modules。
4. 打包版实测发现并修复**三个**真缺陷（第三个是读界面文案读出来的，见下）：
   - 标题栏/窗口标题仍写"重构版"（`app/index.html`），侧栏页脚残留 `S3 · 播放链路` 调试标记 → 分别改为正式名称与 `v2.0.0`。
   - **播放条"迷你模式"按钮只能进不能出**（`Playbar.vue` 里只绑了 `enterMini`）。
     改成 `toggleMini` + `miniActive` 状态，并与主进程 `win:is-mini` / `mini:exit` 对齐；
     `:title` 动态显示"退出迷你模式"。`api.d.ts` 补 `enterMini/exitMini/isMini/onMiniExit` 声明（原先靠 cast）。
     这个 bug 在 dev 下没被发现，因为开发时都用迷你窗自己的退出按钮。
   - **歌曲行没有收藏入口**：`LibraryView` 空态文案写着「在歌曲行上点收藏」，而 `SongRow` 模板里只有播放/封面/标题/时长，
     搜索页右键菜单也没有收藏项——文案承诺了一条不存在的路。补 `.row-fav`（hover 出现、已收藏常驻高亮，直连 `favorites` store）
     + 右键菜单「收藏 / 取消收藏」+ `heart`/`heartFilled` 图标（`Icon.vue` 新增 `fillpath` 图元，实心空心共用一条路径不跳形）。
     exe 实测：点 ♡ → `favorites` 落 1 条（`netease:509781655`）→「我喜欢的音乐 1」可见，菜单与行内状态双向同步。
5. `vitest.config.mts`：主进程服务测试（`electron/services/__tests__/*.test.mjs`）此前不在默认 `npm test` 的
   include 里——会报绿但没跑到。改到项目根 include 两个来源，并把打包配置断言写成 `packaging.test.mjs`。
   注意该测试原断言"只解 NeteaseCloudMusicApi/migu-api-enhanced"，与第 3 条的正确配置冲突，
   已改成编码真实契约：整包 node_modules **或** 逐个列出子进程依赖，两者满足其一即可。

## 五、验收口径（这个项目的规矩）

- 音频：一律静音跑（`--mute-audio`），判据是 `paused === false && currentTime` 递增；截图证明不了出声。
- 打包版证据才算交付证据：dev 通过不算，必须用 `release/win-unpacked` 的 exe 复跑同一批检查。
- exe 是**真构建**的证据：`FileVersion=2.0.0`（旧版 1.0.0）+ asar mtime + asar 内含三入口 html。
  exe 字节数与旧版相同不代表没重建（启动器大小由 Electron 版本决定，恰好同为 245,726,208）。
- 详见 `docs/最终验收.md`。

## 六、已知缺口（不是漏做，是决定）

| 项 | 现状 | 为什么 |
|---|---|---|
| 单曲下载入口 | 播放详情页有；歌曲行右键菜单未接 | 队列批量下载已覆盖主用途；右键菜单接下载需要每条菜单项按 source 可用性判断，收益低于风险，留后续 |
| EQ 覆盖范围 | 仅网易云在线流 | 咪咕无 CORS 头，接 `MediaElementSource` 会直接哑音（已实测），宁可不提供 |
| `hires/sky` 音质 | 不提供 | 未验证接口能力，不做假选项 |
| 曲库/缓存磁盘占用 | 显示"未提供" | 没有可靠的目录配额 API，不给假数字 |
| 真实扫码登录 | 未由人完成 | 需要用户本人扫码；二维码与状态链路已通 |
| 咪咕部分接口 | `getSimilarSongRecommend` 空、`getTodayRecommend` 需登录、`getNewSongList` 返回导航壳 | 上游现状，已按空态/失败态如实处理 |
| P2（播客/电台、分享、多设备、插件） | 未开始 | 本轮范围是 P0 + 不越界的 P1 子集 |
| 歌单导入导出的原生文件对话框 | 只做了 `dialog:chooseDir` | `file:save/open` 需另加 IPC，属 S6 后续项 |
| 人耳可听的播放确认 | **未做** | 验收期用户在看视频，全部播放证据在 `--mute-audio` 下采集；要外放确认需用户点头 |
| NSIS 安装版 | 未产出 | 本轮只验 `build:dir`（win-unpacked）；`npm.cmd run build` 配置就绪且 `createDesktopShortcut=false` |
| 网易云试听片段 | 已如实标注，不"修" | 无登录态/无权益时服务端只给 `freeTrialInfo`（实测 48 s）片段，客户端拿不到整曲；现在播放条显示「试听 Ns」角标说明这件事，不再假装是整曲 |
| 全局歌词快捷键 | `CommandOrControl+Alt+L` 注册失败 | 提示「可能被其他应用占用」；应用内快捷键不受影响，未去抢别人的全局组合 |
| 咪咕榜单详情 | 只做索引展示 | `getRankIndex` 只给 rankId，曲目接口未进主进程白名单；界面明写「曲目接口未接入，仅索引」，不给点不动的假卡片 |

## 七、提交历史

```
22c91c8  S3 播放链路
2502212  S4-S6（90 文件）
2542bba  S7 本地曲库+离线下载（34 文件）
d4fffa0  S8 设置中心+音质+EQ+主题+媒体键+账号+评论（39 文件）  ← 附注标签 legacy-v1 指这里
f642c25  S9 归档 v1、生产打包与 exe 验收（44 文件）
dd15c5e  docs 最终验收报告 + 咪咕音源链路在 exe 上复测
4f1f41d  docs 全量自审：与代码口径逐条对齐
（本次）  fix 每日推荐只有 30 秒：登录态透传 + 试听片段可见 + 首页登录态自愈
```

## 八、接手时最该先看的文件

1. `docs/改造计划.md`（阶段划分与优先级来源）
2. `docs/最终验收.md`（本轮证据）
3. `docs/旧实现已知问题.md` + `docs/旧版归档.md`（为什么不能照抄 v1）
4. `docs/S2遗留与S3交接.md` / `docs/S7-S8技术前提.md` / `docs/S7验收.md` / `docs/S8验收.md`
5. `docs/音源能力调研.md`（网易云 377 模块 / 咪咕 124 导出的实测清单——决定哪些功能"做不了"不是拍脑袋）
