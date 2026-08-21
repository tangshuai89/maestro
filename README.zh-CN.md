# Maestro

[English](./README.md) · **简体中文** · [日本語](./README.ja.md)

> 你的跨平台「音乐大脑」。登录网易云音乐、QQ 音乐、Spotify、Deezer，把你在
> **每个平台的红心歌曲**都汇总到一起，用大模型（**DeepSeek**，使用**你自己**
> 的 API Key）推荐下一首值得心动的歌——当你想点红心时，就在**所有有版权的
> 平台上同时加红心**；从此再也不会因为「本地区无版权 / 无法播放」而卡住。

以 **Electron + React + NestJS** 构建，桌面客户端优先。

> 🟢 **状态：Phase 0–6 完成，Phase 7（AETHER 剧场 + 生产打包）收尾中。**
> 四个平台适配器、统一搜索、跨平台匹配引擎、可导入的统一库、DeepSeek 推荐、
> 红心 fan-out、**AETHER 剧场视图**（酸性赛博宇宙风 — 1440×900 全息轨道封面 +
> 歌词流 + 能量核心播放键 + 星云背景，Figma 驱动经官方 `figma-remote` MCP）、
> Spotify OAuth PKCE + 红心回写、Premium 全曲播放（Web Playback SDK + Widevine，
> 跑在 castLabs Electron fork 上）均已在 dev 下端到端可用。**Premium 全曲
> 当前卡在 `POST /v1/widevine-license/v1/audio/license 500`** —— castLabs fork
> 是 dev VMP 签名，Spotify 的生产 license 服务器拒收。修复方法 = **Apple Developer
> Account（$99/年）+ castLabs EVS（免费）VMP 签名**，见 [next-iteration plan](./NEXT-ITERATION.md)
> 第 0 节「Apple Dev + EVS」。剩余工作（生产打包、Settings / Lite 模式 UX、
> 一些桌面体验细部）也在那份计划里。

---

## 产品理念

每个流媒体平台都只握有你口味的一部分、也只握有全球曲库的一部分——而且都不
完整。你在 QQ 音乐上很爱的一首歌，网易云上没有；Spotify 推的一首歌，在你所
在地区又没版权。Maestro 把这四个平台当作**一个属于你自己的曲库**：

```
   ┌── 连接 ────────────────────────────────────────────────┐
   │  网易云 · QQ 音乐 · Spotify · Deezer                    │
   └───────────────┬────────────────────────────────────────┘
                   │  从每个平台拉取「红心 / 喜欢」的歌
                   ▼
   ┌── 汇总 ────────────────────────────────────────────────┐
   │  合并、去重，形成一个统一的「你喜欢的音乐」曲库         │
   └───────────────┬────────────────────────────────────────┘
                   │  送入 DeepSeek（你的 API Key）
                   ▼
   ┌── 推荐 ────────────────────────────────────────────────┐
   │  大模型推荐你接下来可能会爱的歌                         │
   └───────────────┬────────────────────────────────────────┘
                   │  你按下 ❤
                   ▼
   ┌── 全平台加红心 ────────────────────────────────────────┐
   │  在每一个有版权的平台上都加上 ❤                        │
   └───────────────┬────────────────────────────────────────┘
                   │  播放
                   ▼
   ┌── 永不撞墙 ────────────────────────────────────────────┐
   │  多平台同时搜索，从真正有版权的那个平台播放            │
   │  → 不再出现「无法播放」的断点                          │
   └────────────────────────────────────────────────────────┘
```

### 设计原则

- **桌面客户端优先。** 所有登录凭据与你的 DeepSeek API Key 都保存在**本地**，
  不会上传到任何 Maestro 服务器（也根本没有这样的服务器）。
- **汇总的数据归你所有。** 各平台的红心歌曲合并成唯一一份、只有你持有的曲库。
- **自带 AI Key。** 推荐通过 DeepSeek 完成，用你自己提供的 Key——成本与数据
  都由你掌控。
- **处处考虑版权。** ❤ 只会分发到有版权的平台；播放与搜索会自动回退到真正
  能提供该曲目的平台。

---

## 状态与进度

图例：✅ 已完成 · 🚧 部分 / 进行中 · 📋 计划中 · ⚠️ 受限

### 各平台能力

| 能力                       | 网易云 | QQ 音乐 | Spotify | Deezer |
| -------------------------- | :----: | :-----: | :-----: | :----: |
| 登录                       | ✅ 扫码 | ✅ cookie（内嵌窗口） | ✅ OAuth PKCE | ✅ 匿名（免登录） |
| 播放完整曲目               | ✅ | ✅（标准 / 320 / 无损） | ✅ Premium · 🚧 Free = 30 秒预览 | 🚧 仅 30 秒预览 |
| 电台 / 推荐流              | ✅ 私人 FM | 🚧 关键词伪电台 | 🚧 短预览 | ✅ 编辑精选榜 |
| 搜索                       | ✅ | ✅ | 🚧 有限 | ✅ |
| 本地红心 / 不喜欢          | ✅ | ✅ | ✅ | ✅ |
| 红心回写到平台             | ✅ | ✅ | ✅ | ✅ |
| 导入你已有的红心歌曲       | ✅ | ✅ | ✅ | ✅ |

### 贯穿性产品功能

| 功能                                          | 状态 |
| --------------------------------------------- | :--: |
| 多音源播放器骨架（Electron / React / Nest）    | ✅ |
| 各平台登录与会话持久化                         | ✅ |
| 服务端音频代理（真实 URL 永不进入前端）        | ✅ |
| **AETHER 剧场视图**（1440×900 全息轨道封面 + 歌词流 + 能量核心 + 星云背景，Figma 驱动） | ✅ (PR #56) |
| 明 / 暗 / 系统主题                            | ✅ |
| **跨源统一搜索与播放回退**                     | ✅ |
| **跨平台曲目匹配**（ISRC + 标题/艺人/时长模糊；艺人别名经 `@maestro/common` 桥接） | ✅ |
| **统一红心曲库**（导入 + 去重；徽章数通过共享 normalizer 端到端对齐） | ✅ |
| **DeepSeek 自带 Key AI 推荐**                 | ✅ |
| **红心分发到所有有版权的平台**                 | ✅ |
| **Spotify 适配器**（OAuth PKCE + 读取 + 红心回写 + WPS Premium 全曲） | ⚠️ dev 完成 · **license 500** 在生产 |
| 前端架构：CSS/tsx 解耦 + SCSS 7-1 + 拆巨石 | ✅ (PR #13) |
| **castLabs Electron fork**（Widevine CDM + dev VMP — **生产 VMP 走 EVS**） | ✅ (PR #39) / v31→v43 升级 (PR #52) |
| **Figma 驱动设计管线**（`.superdesign/` 简报 → `scripts/figma-aether-v4-*.mjs` 构建 → `figma-remote` MCP 审计 → PR #56） | ✅ (PR #56) |
| **生产打包**（NestJS sidecar + prod API 基址 + **Apple Dev + castLabs EVS VMP 签名**） | 🚧 进行中 |

**大致完成度：~85%。** 本产品定义性的核心功能（统一搜索、匹配引擎、统一库、
DeepSeek 推荐、红心分发）均端到端可用。剩余主要是生产打包 + 一小撮平台对等
项目 —— 见 [NEXT-ITERATION.md](./NEXT-ITERATION.md)。

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  渲染层 Renderer (React + Vite, :5173)                        │
│   - Vite-dev 把 /api/*, /music/*, /auth/*, /reco/* 代理到 :3200│
│   - <audio> src = /music/stream/{provider}/{id}              │
│   - 封面取色、主题、音源切换                                  │
│                                                               │
│   src/                                                        │
│     App.tsx        轻组合层                                   │
│     hooks/         8 个聚焦的 hook（player 持有音频核心）     │
│     components/    19 个组件，分 6 组                         │
│     lib/           format · storage · coverColor              │
│     styles/        SCSS 7-1（abstracts / base / components）  │
│                    —— 单一 main.scss，tsx 中零样式导入        │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP（cookie 会话）
┌───────────────────────────────▼──────────────────────────────┐
│  NestJS 服务端 (:3200)                                         │
│   common/   ConfigService · StorageService · SessionService  │
│   auth/     QQ cookie · 网易云扫码 · Spotify OAuth-PKCE       │
│   music/    各平台策略 + 音频代理 + 封面代理                  │
│   library/  导入 + 统一库（读 / 写）                          │
│   match/    跨平台曲目解析（ISRC + 模糊）                     │
│   reco/     DeepSeek 自带 Key 推荐                            │
│   like/     ❤ 分发到所有有版权的平台                          │
│                                                               │
│   所有 provider 实现统一的 MusicProvider 接口                  │
│   （common/provider.ts），各自落在 music/<name>.provider.ts   │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTPS（携带各平台凭据）
       ┌──────────────┬─────────┴──────────┬──────────────┐
       ▼              ▼                     ▼              ▼
  music.163.com   y.qq.com            Spotify Web API  api.deezer.com
  （weapi AES/RSA） （搜索 + GetVkey）   （OAuth PKCE）  （公开 API）
```

**Electron 主进程**还额外承载一个内嵌登录窗口（用真实的 Chromium 会话捕获
QQ 音乐登录 cookie）、一个内嵌网易云登录窗口（网易云风控拒服务端扫码轮询）、
以及打包产物的 sidecar 管理（WIP）。会话与红心 / 不喜欢状态持久化到
`packages/server/.storage/state.json`（git 忽略）。

---

## 目录结构

```
packages/
  electron/   Electron 主进程
              src/main.ts, src/preload.ts, src/recorder.ts
              + castLabs fork（v43.2.0+wvcus）承载 Widevine CDM + VMP 签名
  renderer/   React 前端
              src/
                App.tsx                  组合层（挂 <TheaterView/>）
                main.tsx                 入口
                api.ts                   数据层
                hooks/                   8 个 hooks（usePlayer 持有音频核心，
                                          useSpotifyWpsPlayer 处理 Premium 全曲）
                components/
                  common/     Modal · ErrorPanel
                  layout/     Titlebar · SourceMenu · QualityMenu · DeezerPresetSelect
                  player/     CoverCard · NowPlayingCard · LyricsCard · LyricsPanel
                              ProgressBar · VolumeControl · VolumeIcon · TransportBar
                  search/     SearchPanel · SourceChip
                  modals/     NeteaseCookieModal · RecoKeyModal
                              LikedLibraryModal · SettingsModal
                  source-select/SourceSelect
                  views/      TheaterView       ← AETHER 剧场主界面（PR #56）
                lib/         format · storage · coverColor · lyrics cache
                              · likedCache · spotify-wps · debug (wpsLog/Error)
                styles/      main.scss + SCSS 7-1 partials
                              components/_theater.scss（剧场视图样式，约 900 行）
                              components/_app-shell.scss（含 .theater-mode 切换）
  server/     NestJS 后端
              src/
                common/   config · storage · session · provider 注册
                          · timeout（withTimeout，5s 单平台）· lyrics
                          · normalizer（fuzzyKey / stripFeatTags / cjkUnify，
                            与 renderer groupLibraryItems 共用）
                auth/     auth 控制器 + QQ / 网易云 / Spotify 策略
                music/    music 控制器 + 4 个 providers + 音频/封面代理
                          + netease-crypto（weapi AES/RSA）+ 策展别名表
                          + library-import + lyrics aggregate + WPS source picker
                library/  红心导入 + 统一库（读 / 写）
                match/    跨平台曲目解析（ISRC + 模糊）
                reco/     DeepSeek 推荐引擎
                like/     红心 fan-out
  common/     @maestro/common —— 跨包类型 / normalizer / artistAlias / 接口
specs/        各 Phase 级别的 spec 文件（每个 P0–P6 + packaging + 横切关注点）
              各自带 tasks.md

# 工具与设计管线
.mcp.json          figma-remote MCP（AI 可读 / 写 Figma 设计稿）
.codex/            Codex CLI 配置 (config.toml)
.opencode/         OpenCode 命令模板 + node_modules
.superdesign/      设计简报 + 设计稿（A/B 草稿 HTML + PNG）— AETHER 视觉来源
docs/              阶段性长文档：aether-theater-v4-spec.md · figma-driven-frontend.md
                   · audit-2026-07-30.md · ISSUES.md · interview-questions-2026.md
scripts/           test.sh · lint.sh · figma-aether-v4-{foundations,components,
                   screens,motion,icons,cleanup,audit,snapshot,smoke,typecheck}.mjs
                   · final-merge · export-qq-artists · audit-liked 等

.env.example       开发环境变量（均可选，含合理默认值）
```

---

## 安装

```bash
# 需要 Node 18+（推荐 Node 22）。使用 npm workspaces。
npm install

cp .env.example .env    # 可选 —— 每个变量都有合理的开发默认值
```

## 开发

```bash
npm run dev
# 并行运行：
#   nest start --watch   → 服务端 :3200
#   vite                 → 渲染层 :5173
#   electron             → 3 秒后打开窗口
```

Vite 开发服务器会把 `/api/*`（剥掉 `/api` 前缀）、`/music/*`、`/auth/*`、
`/reco/*` 代理到 `:3200` 的 NestJS，因此开发时整个应用同源，共享同一个
会话 cookie。

## 环境变量

开发时所有变量都可选，服务端会回退到合理默认值。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3200` | NestJS 端口 |
| `RENDERER_BASE` | `http://localhost:5173` | 登录后重定向基址 |
| `RENDERER_ORIGINS` | `http://localhost:5173,http://localhost:3000` | CORS 白名单 |
| `SESSION_SECRET` | 开发占位符 | Cookie 签名密钥 —— **生产必须设置** |
| `SESSION_TTL_MS` | 30 天 | 会话有效期 |
| `STORAGE_DIR` | `.storage` | `state.json` 存放位置 |
| `NETEASE_MUSIC_U` | – | 仅开发：注入网易云 `MUSIC_U` cookie |
| `NETEASE_QR_POLL_MS` | `1500` | 扫码轮询间隔 |
| `DEEPSEEK_API_KEY` | – | **运行时由你提供**（自带 Key）—— 服务端从 session 里读 |

---

## 各音源登录方式

- **网易云音乐** —— 点「登录」，用网易云手机 App 扫码确认。服务端直连网易云
  `/api/login/qrcode/*` 端点，成功时从 `Set-Cookie` 捕获 `MUSIC_U`；另有
  「手动粘贴 `MUSIC_U`」兜底入口。cookie 约 30 天有效，接口开始返回 `301`
  时重新扫码即可。
- **QQ 音乐** —— 点「登录」（仅桌面 App）。Maestro 打开内嵌 QQ 音乐登录窗口，
  捕获真实登录 cookie（`qm_keyst` / `qqmusic_key` / `uin`）—— **不走** QQ 互联
  OAuth，无需 AppID/Secret。随后可搜索 + 播放完整曲目（标准 / 320 kbps /
  无损），无损需 QQ 音乐会员。
- **Deezer** —— 免登录。匿名公开编辑精选榜，播放 30 秒预览。
- **Spotify** —— 点「登录」，OAuth PKCE 流。v1 已实现：红心读取 + ❤ 写回
  （`PUT /v1/me/tracks`）；全曲播放需要 Spotify Premium（受 license 500 阻塞，
  见上）。

---

## 生产构建

```bash
npm run build   # tsc server + vite renderer + tsc electron
```

产物：

- `packages/server/dist/` —— 编译后的 NestJS（可独立跑：`node packages/server/dist/main.js` 起 :3200）
- `packages/renderer/dist/` —— Vite 静态包
- `packages/electron/dist/` —— 编译后的 Electron main + preload

### 打 macOS `.dmg`

```bash
# App 图标 + 托盘 glyph（build/icon.icns, build/trayTemplate*.png）。
# 已经 commit 进去了，只在改了 scripts/gen-icons.cjs 时才需要重跑。
cd packages/electron && npm run gen-icons

# 先全量构建，再打包。开发阶段关掉 code sign
# （electron-builder 不然会卡在找 Developer ID 证书上）。
npm run build
cd packages/electron && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack
# → packages/electron/release/*.dmg
```

打包后的运行方式：

- **Sidecar**：Electron main 把 `resources/server/main.js` 作为 NestJS sidecar
  起子进程，轮询 `:3200/music/deezer/editorials` 直到就绪再开窗。退出时
  （Cmd+Q / 托盘「退出」）kill sidecar。
- **API 基址**：preload 暴露 `window.electronAPI.apiBase`；renderer 的
  `api.ts` 优先用它，dev 下回退到 `localhost:3200`。
- **extraResources**：`renderer/`、`server/`（编译后的 dist）、`build/`
  （图标）都拷进 `.app/Contents/Resources/`。
- **托盘**：菜单栏托盘图标，提供 播放/暂停、上一首/下一首、显示主窗、退出。
  关闭主窗时隐藏到托盘（播放继续）；只有 Cmd+Q 或托盘「退出」才真正退出 App。

> **已知限制** —— sidecar 需要服务端的运行时 `node_modules`。npm workspaces
> 会把它们提升到仓库根目录，所以一个完全自包含的 `.dmg` 仍然要把 server 依赖
> 一起打包（或者用 esbuild 打包 + 保留 NestJS decorator metadata）。见
> `specs/packaging/spec.md` → 「已知限制」。开发（`npm run dev`）仍是
> 完整支持的运行方式。

---

## 下一期计划

详见 [NEXT-ITERATION.md](./NEXT-ITERATION.md)，里面写了下一期要做的事、为什么
做、以及每项的验收标准。概览：

1. **生产打包** —— NestJS sidecar + 正确的 prod API 基址，让 `electron-builder`
   能出一个真正可用的 App。
2. **Spotify 对等** —— Premium 全曲播放 + ❤ 写回。
3. **本地持久化加固** —— 备份 / 恢复统一库与会话 cookie，重装不丢。
4. **歌词质量** —— 把已有的歌词拉取更显眼地呈现出来，加「点击复制 / 分享」
   的小入口。
5. **Settings & 首次启动打磨** —— 首次启动的 Key 配置流、库备份位置、源连接健康。

---

## 隐私与安全

这是一个**本地优先的个人工具**。平台 cookie（`MUSIC_U`、QQ 登录 cookie、
Spotify refresh token）、会话、你的 DeepSeek API Key、以及统一库，都以**明文**
保存在你自己机器上的 `packages/server/.storage/` 目录里，且**已被 git 忽略**。
没有任何数据会上传到 Maestro 运营的服务（因为并不存在这样的服务）。
请把 `.storage/` 当作密码文件一样对待。

## 许可证

MIT
