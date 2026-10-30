# Next iteration

> 下一期（Phase 7+）的计划。每一项都有：目标、范围、验收标准、参考 spec
> （如有）。本文件随代码演进被修订；粒度按"一两个工作日一项"分块。

**最后核对日期**：2026-10-15 · **核对人**：文档清理（已交付的条目一律从本文件删除，
只留「还没做完 / 还欠手测」的）

> ⚠️ **0 节 13 项全部 `[ ]`**——这是事实，不是漏勾。所有项目都是
> **个人付费 / 外部依赖**类卡点（Apple Developer $99/年、castLabs EVS 凭据），
> 不是工程问题。每次会话开篇先看本节决定是否值得继续推。
> 修可解阻塞前，1/2/3/5 节的工程项**不应阻塞主流程**。

## 当前状态（基线）

四大平台（QQ / 网易云 / Deezer / Spotify）**端到端可用**：登录、搜索、radio、
专辑搜索/详情、跨平台 match、统一库、DeepSeek 推荐、自然语言歌单、跨平台
fan-out ❤、AETHER 剧场主界面、三种播放视图（theater / mini / lite）、桌面歌词
浮窗、加密备份。已合入 `master`。

**已知阻塞（唯一）**：Spotify Premium 全曲播放卡在 **Widevine license server 500**——
castLabs fork 的免费 `+wvcus` 构建是 **dev VMP 签名**（README 原话：
"For production use you can sign up for our EVS service"），Spotify 生产 license
服务器拒 dev 签名 → 500。**唯一修复路径 = castLabs EVS（生产 VMP 签名）+ Apple
Developer Account（macOS code-sign / notarize 必需）**，见下 0 节"Apple Dev
+EVS 落地"专案。

**2026-10-20 新增交付**：专辑跨平台 fan-out（`specs/album-fanout`）——
专辑搜索结果里点 ❤ 同步"收藏专辑"到所有有该能力且已登录的平台（v1 落地 =
网易云），角标显示真实平台数；状态持久化在 `state.json` 的 `albumFanOut`。
另有远端歌单导入（`specs/remote-playlist`，2026-10-16 合入 PR #106）——
粘贴链接 → 播放 / 追加 / 存本地（网易云列+读、QQ 只读、Deezer 公开歌单）。

> **2026-10-20 追加解锁**：网易云**专辑详情**（`/api/album/{id}`）—— 当年
> `specs/album-search` 记的 `-462 "请绑定手机后再试哦~"` 是**未登录态**的响应，
> 登录态实测 `code=200`、21 首 / 2 碟全对。网易云专辑卡片现在能展开了。
> 连带：专辑行展开改为**多平台回退**（一个平台拉不到就换下一个源），
> 英文错误串 `album detail not supported on <p>` 改成中文。
>
> **专辑 fan-out 遗留**（都在等外部条件，不是工程债）：
> ① Spotify 专辑收藏 —— 需先有 Spotify OAuth token（album-search 阻塞项 B2
> 整条 Spotify 专辑线未实现 → 拿不到 albumId）；
> ② 网易云收藏专辑端点 `/api/album/sub` 的真伪待**登录态实测**（端点已提为
> 常量 `NETEASE_ALBUM_SUB_ENDPOINT`，不符时一行可改）；
> ③ QQ / Deezer 无收藏专辑 API —— 结构性跳过，不是待办。

### 2026-10-30 当前编排 — Figma 结构回填 + App 手测

两条轨并行，只有“Figma 回填深度选到结构 + 视觉”时才会和 `--text-dim`
（Figma 0.55 / 代码 0.4）冲突。本轮默认先做**结构对齐**；视觉回填与
`--text-dim` 数值另拍板，不把未决值写进设计稿。

| 顺序 | 谁做                 | 事项                                                                        | 完成判据                                                                |
| ---- | -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | 你（Figma 桌面 App） | 跑 `AETHER Contract Writer`，写当前 **34** 条契约草案                       | 通知为应用 34 / 跳过 0 / 失败 0，且已有散文未被覆盖                     |
| 2    | Codex                | 你跑完后重跑采集段 → `figma:payload` → `figma:payload:check` + `figma:diff` | 新快照契约覆盖到 35/35 组件 + 15/15 屏幕；34 条 `descriptions` 附注消失 |
| 3    | 你（同一段桌面时间） | 按 `specs/acceptance-backlog.md` §2 手测 12 条 App 行为                     | 每条按前置 / 步骤 / 期望留结果；失败项另开修，不混进 Figma 回填         |
| 4    | 你拍板               | `--text-dim` 选 0.55（WCAG AA）或保持 0.4                                   | 二选一后才允许视觉回填 / token 收敛                                     |

Figma 侧代码准备已就绪：Code Connect **50 条映射覆盖 35/35 组件 + 15/15 屏幕**，
覆盖率缺口现在是 CI 门禁；插件逻辑已有 mock 测试，但**尚未在真实 Figma 桌面端运行**。
因此第 1 步仍是整条写通道最后一个未知，不应被代码侧门禁变绿替代。

剩下的工作集中在四类：

1. **Apple Dev + EVS 落地（本期最优先）**：见下 0 节。0 成本 EVS + $99/年 Apple Dev。
2. **生产化最后一步**：`npm run pack` 端到端冒烟（避开 license 阻塞后）。
3. **桌面系统集成（本轮新增，工程侧最优先）**：**媒体键 / 系统媒体控件 /
   macOS「正在播放」/ 全局热键 / 自动更新** —— 实测这五项在全仓的命中数
   **全是 0**（`mediaSession` / `globalShortcut` / `MPNowPlayingInfoCenter` /
   `electron-updater`），是「能跑」和「能天天用」之间的差距。
   详见 §7.3 与 `specs/desktop-integration/`。
4. **Settings 收尾**：首次启动引导流 + 退出前确认弹窗。
5. **收尾打磨**：Lite 模式与桌面歌词的手测验收。
   ~~音量功能接线~~ —— **已于 2026-10-20 接好**，见 §7.4（本文档此前写反了，
   2026-10-24 更正）。
6. **门禁收口**（2026-10-27 全仓体检的结论 —— **唯一会随规模增长的债**）：
   - [x] **验收清单防腐（2026-10-29，PR #144）**：清单里的**证据路径**必须还指向
         真实存在的文件 —— 新增 `scripts/check-acceptance-evidence.mjs`（挂进
         `test:ci` → 任何 PR 都跑）。当场抓到并修掉 **17 条死证据**
         （漏 `packages/` 前缀 10 / 文件搬家 5 / 指向构建产物 2）。
         变异验证：3 个变异（存在性判定恒真 / 后缀建议失效 / 缺 reason 的豁免被放行）
         全部被自测抓到。
   - [x] **验收清单「未勾项」分类（2026-10-29，PR #145）**：52 条未勾项逐条判定 →
         `@blocked` 22 / `@manual` 12 / `@deferred` 11 / `@todo` **5**（只有 5 条是真
         ·工程债）+ 补勾 2 条已完成的。新增台账 `specs/acceptance-backlog.md`
         （含 12 条手测清单 + 22 条阻塞清单按阻塞源分组），并给门禁加一条规则
         （**未勾项没带分类标记 → 红**）→ 清单不会重新烂回去。
   - [ ] **验收清单自动回填（**没做**）**：上面那道只管「证据文件还在」，**不查**
         「证据内容是否仍然证明那条结论」；清单项本身仍要靠人勾（lint / 全量套件 /
         覆盖率 diff 门禁 / 变异验证 四项）。
         要根治得从 CI 的 run 结论**自动写回** —— 这轮没做，两个原因：①「写回仓库」
         会引入提交噪声、还要 PR 写权限的 token；② 更重要的是先想清楚**哪些项
         机器能验、哪些只能人验**（实测 1174 条里 52 条未勾，大多是外部阻塞
         —— Spotify OAuth / Apple 签名 —— 或必须手测的），不该一刀切。
   - [ ] **「动了动效 → `specs/motion-spec.json` 必须一起动」的 CI 检查**：
         PR template 里的 checkbox 是**承诺**不是门禁（2026-10-28 落地时明说了）。
         真要强制得加一道检查（判据：PR 的 SCSS 改了 transition/animation/
         @keyframes → motion-spec.json 必须也改）。

         ⚠️ **2026-10-29 实测：这道门禁现在还不能直接上**，两个前置都没到位：
                                     ① **`motion-spec.json` 已经脱节** —— D10 落地之后又发生了 **14 次**动效改动，
                                        spec 一次都没动过；其中 **2 个新增 `@keyframes`**（`player-notice-in` /
                                        `mini-player-in`）**根本没登记**。直接上门禁 = 要先补这 14 条。
                                     ② **补条目要同步 Figma** —— `audit-d10.mjs` 会核对「Figma ↔ 仓库 spec id
                                        集合一致」，只改仓库会让那条校验红 ⇒ **必须有 FIGMA_TOKEN** 才能补。
                                     ⇒ 建议顺序：① 先把 `motion-spec.json` 与代码**重新对齐**（含 Figma 侧）；
                                        ② 门禁的判据**收窄**到「PR 新增了 `@keyframes` 名字」才要求登记
                                        （改 transition 时长只 warn），否则日常改样式会被误伤。

   - [x] **`verify-pack.sh` 改成「有 ❌ 就 exit 1」（2026-10-28，PR #142 已合）**：
         失败项逐条列出 + `--no-dmg` 开关 + 新增 `.github/workflows/packaged-app.yml`
         （macOS runner，`electron-builder --dir` 造 .app → 跑 verify → 有 ❌ 就红）。
         同一轮还修掉两个真 bug：`ensure-electron-dist.cjs` 的路径算错（**从来没真
         正装过 electron 二进制**）+ `verify-pack.sh` 的 `REPO_ROOT` 在 `cd` 之后
         用相对 `$0` 算（新鲜度检查一直在静默跳过）。

已交付并从本文件移出的历史条目：歌词多源聚合与分享图、渠道优先级、macOS Tray
与应用图标、AETHER 剧场视图与 Figma 驱动管线、自然语言歌单。

---

## 0. Apple Developer + castLabs EVS 落地 — **本期最优先**

> **背景**：Spotify WPS 卡在 license server 500，根因是 castLabs fork `+wvcus`
> 构建用 **dev VMP 签名**（README 原话），被 Spotify 生产 license server 拒。
> Spotify 自己桌面端的 Electron fork 不开放——他们是 Widevine 3PL 自签的
> production VMP 第三方路径。第三方唯一合规通道 = castLabs EVS（Electronic
> Video Service），**完全免费**（公开承诺 2020-09-04 wiki），个人开发者零成本
> 可签。macOS 侧还需 Apple Developer Account（$99/年）做 code-sign / notarize，
> 否则 Gatekeeper 拦 dmg。
>
> **W1 收尾不能跳过这一步**——EVS 不签，license 永远 500，"能装"也播不响。

### 0.1 一次性环境准备（1–2 小时）

- [x] **装 EVS 客户端** —— ⚠️ **本节原写法是错的，已实测修正**：裸
      `pip3 install castlabs-evs` 会撞 PEP 668（homebrew python3.14 外部管理环境），
      且 `python3 -m castlabs_evs...` **根本不存在该入口**。实际可用的是 venv +
      两个 CLI：
      `bash
python3 -m venv ~/.castlabs-evs-venv
~/.castlabs-evs-venv/bin/pip install --upgrade castlabs-evs   # → 1.3.2 ✅ 已装
`
      装完 `bin/` 下是 `evs-account`（账户）/ `evs-vmp`（签名），**没有** `castlabs-evs` 这个命令
- [ ] **买 Apple Developer Account**：[developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)
      $99/年，1–3 天批。现状核查 2026-09-28：`security find-identity -v -p codesigning`
      = **0 valid identities**，证书尚未装
- [ ] **注册 EVS 账户**：`~/.castlabs-evs-venv/bin/evs-account signup`（e-mail 收验证码，
      Org 随便填个人；账号**永久免费**，签 streaming signature 不收费）
- [ ] **EVS 客户端**登录后自动缓存 access token 到 `~/.castlabs-evs/`；
      `EVS_NO_ASK=1` / `--no-ask` 跳过交互（CI / 自动化友好）
- [ ] 凭据到位后手动验一次签名链路：`~/.castlabs-evs-venv/bin/evs-vmp sign-pkg dist/mac-arm64/Maestro.app`
- [ ] **换网络验 CDM 能下载**（第二个隐藏前置，2026-09-28 实测发现）：本机
      `node_modules/electron` 是 `43.2.0+wvcus`（版本对），但
      `dist/Electron.app` 里 **找不到任何 Widevine CDM**（`find -iname '*widevine*'`
      零命中）——castLabs fork 不内置 CDM，Electron 在运行时从
      `redirector.gvt1.com` 下载。本机 iOA 拦该 CDN 会拿到 567B HTML 拦截页
      → EME 探测拿不到 CDM。**这条不解决，EVS 签完也还是播不响**：
      签 VMP（解决 license 500）和拿到 CDM（解决 EME）是两个独立的坎

### 0.2 集成 build → sign → notarize（半天）

- [x] **`packages/electron/afterPack-vmp.cjs`** 在 codesign **之前**签 VMP
      （macOS 在前；Windows 在后）。**逻辑已就位** —— 2026-09-28 修了里面的真 bug：
      原代码调 `python3 -m castlabs_evs.vmp sign-pkg`，**该入口不存在**
      （castlabs-evs 只有 `evs-vmp` / `evs-account` 两个 CLI），意味着不带
      `SKIP_VMP=1` 的 `npm run pack` 必然抛 `No module named castlabs_evs`。
      现改为解析可执行文件路径（`EVS_VMP_BIN` → `~/.castlabs-evs-venv/bin/evs-vmp`
      → `~/.local/bin` → brew 常见位置），找不到时抛带安装命令的可读错误。
      **剩余：EVS 凭据**
- [x] 验证 `build.electronDist` 仍指本地 `node_modules/electron/dist`
      —— 实际是 `43.2.0+wvcus`（castLabs fork，版本对）✅
      ⚠️ 但**该 dist 里没有内置 Widevine CDM**（见 0.1 最后一条），需运行时下载
- [x] **打包白屏修复**（2026-09-28，跨 P0/P1/P2/P3 的地基 bug）：
      `vite.config.ts` 没设 `base`，prod 走 `mainWindow.loadFile()` =
      `file://`，而 vite 默认 base='/' 会把产物入口写成 `src="/assets/main-*.js"`
      ——绝对路径在 `file://` 下解析到**文件系统根** → index.html 和
      lyrics.html（桌面歌词浮窗）**一起白屏**。`npm run dev` 走
      `loadURL(http://127.0.0.1:5173)` 所以永远测不出来，只有 pack 产物才命中
      ——而打包冒烟一直卡在 EVS 凭据上从没真跑过。现已加 `base: './'`，
      并加回归测试 `renderer/src/test/build-base.test.mjs`（断言 config 里
      有 `base:'./'` + dist 产物引用是相对路径且文件存在）。**W1 装 dmg 后
      第一件事就是确认不白屏**。
- [ ] 验证 `build.afterPack` 钩子链：VMP sign → codesign → notarize → dmg
- [ ] 逃生阀 `SKIP_VMP=1 npm run pack` 保留（无 Apple Dev / 无 EVS 凭据时验打包管线）
- [ ] **CI 化**（可选）：把 EVS 凭据放 GitHub Actions secret，每次 release tag 自动
      出 prod-signed dmg

### 0.3 验收（半小）

- [ ] 装 EVS-signed dmg → 登录 Premium → 播完整曲目（**目标**：license 200，
      `hasTrack=true`，进 WPS 全曲路径，不再卡 30s）
- [ ] Spotify 桌面端可见 `maestro-xxxx` 设备 + transport（play/pause/seek）生效
- [ ] token 1h 重连不掉播
- [ ] 重复连续播 3 首以上无 `playback_error`

### 0.4 不在本期范围

- iOS / Android 端（用 WPS 路径就行）
- castLabs 商业 VMP 审计（3PL，`3pl@castlabs.com`）——仅在偏离 ECS 标准布局时需要，
  本项目就是标准 ECS v43 fork，不需要
- `persistent` signature（Spotify 走 `streaming` 即可，persistent 是下载场景）

### 0.5 风险 + 兜底

- **EVS 凭据失效**（每月 token 过期）：`evs-account refresh` 续期；CI 里
  `EVS_NO_ASK=1` + secret 注入
- **Apple Dev 申请被拒**（罕见，多数 1-3 天批）：用 Apple ID 个人账号也行（功能受限，
  团队签名 / TestFlight 不行，但本地 dev 用 Developer ID 自签够用）
- **dmg 被 Gatekeeper 拒**（"unidentified developer"）：notarize 走通后自动消失；
  本地测试阶段用户可右键打开绕过

### 0.6 估时

- 0.1 一次性环境：1–2 小时（Apple Dev 申请是瓶颈，可能 1–3 天，**尽早提交**）
- 0.2 集成：0.5–1 天（afterPack-vmp 钩子已就位，主要调通 EVS 凭据 + codesign 时序）
- 0.3 验收：0.5 小时
- **合计**：1–2 天（**不算 Apple Dev 审批等待**）

---

## 1. 生产打包（packaging）— **等 #0 EVS 落地后才能跑完整链**

> 顺序：**先做 #0 Apple Dev + EVS**（#0.2 集成 VMP 钩子）→ 再做 #1 task 16
> 端到端冒烟 → 最后 #1 验收（装 dmg 播整曲）。**#1 task 16 没 EVS 凭据会失败**
> （`afterPack-vmp.cjs` 跳过签名但产物仍 dev-signed，license 500 阻塞），
> 所以 #0 必须在 #1 之前。

- **Spec**: `specs/packaging/spec.md` + `tasks.md`（task 1–15 已勾，仅 task 16 端到端冒烟未跑）
- **已完成**：
  - ✅ Electron main：prod 模式 spawn NestJS sidecar + waitForSidecar + 关闭 kill（#4–#6）
  - ✅ preload 暴露 `apiBase` 到 `window.electronAPI.apiBase`（#7）
  - ✅ renderer `api.ts` 优先读 `electronAPI.apiBase`（#8）
  - ✅ electron-builder extraResources：renderer / server / build 都进 `.app/Contents/Resources/`（#9、#13、#14）
  - ✅ macOS 应用图标（`.icns`）+ Dock 图标 + macOS Tray（播放/暂停/上下首/显示/退出）
    - 关窗到托盘、Cmd+Q 真退出并 kill sidecar（#15）
  - ✅ Spotify Widevine 路径：castLabs Electron fork **升级到 `v43.2.0+wvcus`**（PR #52）
    - `components.whenReady()` 接入 + Widevine CDM v4.10.3050.0 装好（PR #52，specs/spotify v2.1）
  - ✅ WPS 调试链：`?wpsDebug=1` 开关 + `[wps-debug]` 日志覆盖 wpsEnabled/tier/SDK/connect/
    ready/fatal/widevine/transfer/play/presentTrack/transferHere（PR #53）
  - ✅ 设备 404 重试：Spotify Connect 设备注册延迟 → 退避 0.5s/1.5s/3s（PR #53）
  - ✅ WPS 优先 Spotify 源：服务端 bestSource 把 Spotify 排最后，render 端
    `parsePlayableQueue` 在 WPS 激活时强制用 Spotify 源（PR #53）
  - ✅ EME 探测：connect 前 `requestMediaKeySystemAccess('com.widevine.alpha')` 验可用
  - ✅ 打包 VMP 钩子：`packages/electron/afterPack-vmp.cjs` 在 codesign 前
    调 `evs-vmp sign-pkg`（含 `SKIP_VMP=1` 逃生阀），`build.electronDist`
    指本地 castLabs dist（PR #39）
- **仍剩**：
  - [ ] **task 16**：`npm run pack` 端到端冒烟出 macOS dmg（packaging spec 16）——
        需要 `npm install`（环境曾缺 7zip-bin 传递依赖，应已随 PR #39 lock 重生成恢复）
  - [ ] **本机一次性**：`pip install castlabs-evs`（venv）+ `evs-account signup`
        跑通 VMP 签名（无 EVS 账号也可用 `SKIP_VMP=1 npm run pack` 跳签名，仅验打包管线）
  - [ ] **Premium 手动验收**：装 dmg → 登录 Premium → 播完整曲目 + Spotify 桌面端可见
        "maestro-xxxx" 设备 + transport 生效 + token 1h 重连不掉播
- **风险**：
  - 本机 iOA 拦 Widevine CDM 运行时下载（CDN `redirector.gvt1.com` 被 TLS 拦截——
    直连返 567B HTML 拦截页）。已在无 iOA 网络 + 已装 CDM 的机器上绕开。
  - **EVS 签名本身完全免费**（公开承诺 2020-09-04 wiki），但**它只对 ECS v6+ 官方
    fork 有效**——本项目用的就是标准 ECS v43 fork，无 3PL 审计问题
- **估时**：0.5–1 天（一次性环境准备 + 一次冒烟），**前置 = #0 落地**

---

## 2. Spotify 平台对等 — **应用层全完成，Widevine 全曲卡在 license 500**

> **现状**（v2 + v2.1 + v2.2 调试全部合入 `master`/`fix/fanout`）：应用层 100% 完成，
> Widevine CDM 装好且 EME 探测 OK，但 Spotify WPS 仍卡在 **license server 500**
> ——castLabs fork `+wvcus` 是 **dev VMP 签名**，被 Spotify 生产 license server
> 拒。**修复路径 = #0（Apple Dev + castLabs EVS 签名）**。

- **Spec**: `specs/spotify/spec.md` v1 + v2 + v2.1（任务 1–31 全勾；v2.2 调试
  增量见 `specs/spotify/tasks.md`）
- **已完成**：
  - ✅ OAuth PKCE 完整闭环（start / callback / refresh）（v1 task 1–2）
  - ✅ Web API 搜索 + 字段映射到统一 Track（v1 task 5）
  - ✅ ❤ 写回（`PUT /v1/me/tracks`）+ Free 账号也能写（v2 task 11–14）
  - ✅ tier 缓存到 session，状态接口透出（v2 task 12、17、18）
  - ✅ Web Playback SDK 完整包装（spotify-wps.ts + useSpotifyWpsPlayer），
    含 token 续期重连、SDK ready 事件、wpsFatal/emeOk 兜底（v2 task 15–16）
  - ✅ usePlayer 路由：spotify + premium + wpsReady → WPS 全曲；
    否则回退 30s 预览（v2 task 20–21）
  - ✅ SourceSelect 按 tier 切 desc（v2 task 19）
  - ✅ castLabs fork **升级到 v43.2.0+wvcus**（PR #52），Widevine CDM v4.10.3050.0
    装好 + EME 探测 OK（v2.1 task 26–31 + v2.2）
  - ✅ `?wpsDebug=1` 开关 + 全链路 `[wps-debug]` 日志（v2.2 调试）
  - ✅ 设备注册 404 退避重试 + WPS 优先 Spotify 源（PR #53）
- **仍剩**（specs/spotify tasks 25、32、33）：
  - [ ] **#0 EVS 落地后**：Premium 手动 → 播整曲 / Spotify 桌面端可见设备 /
        transport / token 重连——**当前 30s 卡死的根因就是 dev VMP 签名**
  - [ ] 打包 DMG 经 EVS VMP 签名后 Premium 仍能播整曲
- **不做**：歌词（额外 scope，deferred）、曲末自动切歌（WPS 检测不可靠，已知限制）

---

## 3. 本地持久化加固 — ✅ #3.1 已完成（2026-07-14）

- **问题**：`.storage/state.json` 现在没备份机制；用户重装 / 换电脑 = 丢全部状态
- **已实现（#3.1）**：
  - Settings modal 加 "导出/导入会话快照"：`state.json` 全量 + localStorage 关键键
    （provider / volume / quality / deezer preset / theme）打包成**口令加密**
    （AES-256-GCM + PBKDF2）的 `.maestro-backup` 文件导出
  - 导入做 manifest version 检查 + additive 合并（`StorageService.mergeFrom`，
    不覆盖已有平台的 liked 库 / 登录态 / secrets）
  - `STORAGE_BACKUP_DIR` env + 每日自动备份（`BackupController`，保留最近 7 份）
  - Electron 打包模式把 `STORAGE_DIR` / `STORAGE_BACKUP_DIR` 指到
    `~/Library/Application Support/Maestro/`（顺手修了 sidecar 无 STORAGE_DIR 的隐患）
- **验收**：
  - [x] 导出加密快照 + 合并导入（服务端 4 路由端到端跑通；mergeFrom 6 条单测；
        AES-GCM 加解密 round-trip 验过：对口令解出、错口令拒绝）
  - [x] 备份目录每日自动 snapshot，保留最近 7 份（运行时验过：立即备份写文件 + prune）
  - [ ] 【需 GUI 手动】全新 App 里点齿轮 → 导出下载 / 选文件导入 → 状态恢复
        （SettingsModal UI 无法在无浏览器环境自动验，逻辑已全部验过）
- **不做**：云端同步（无服务器）；zip（改用 JSON+AES-GCM，零依赖更短）
- **spec**：本项无独立 spec 目录，设计见 `~/.claude/plans/` 里本轮 plan + 本节

---

## 5. 设置 / 首次启动收尾 — ✅ **应用层完成**（PR #88）

- **当前**：独立 Settings modal 已上线（`components/settings/AccountsList` ·
  `ChannelPriorityList` · `LibraryManager` · `SourceHealthSection`），UI 按
  `03/Screen/Settings` 全屏还原。`App.tsx` 顶栏 ✨ 入口接通 SettingsModal。
- **已落地**：
  - DeepSeek key 重置 / 库管理 / 源连接健康（每个平台最近 24h 拉取成功率）
  - 渠道优先级可拖拽排序（QQ > NetEase > Spotify > Deezer），存本地，
    `bestSource` 读取它作为权重之一
  - SourceMenu 降级为"临时覆盖"，默认跟随优先级
  - AETHER 全屏风格还原（`feat(settings)` commit `c472b05`）+
    token-adoption 二次补强（`628ea84`，6 处直换 token + budget 给品牌识别色扩 9 处）
- **已补上（2026-10-26，PR #139）**：
  - [x] 首次启动引导流 —— 选完音源后的**一次性 3 步引导**（欢迎 → AI 推荐（可选）
        → 上手），每步可跳过、完成后不再打扰、设置里能重看（specs/first-run-guide）。
        ⚠️ **口径要说准**：**选音源那一步没换**（仍是 `SourceSelect`，spec 明确把
        「引导里的音源选择」列为**不做** —— 那步已经有了）；旧路 `RecoKeyModal` 也
        **保留**（引导第 2 步的「现在设置」就是打开它）。
        ⇒ 原来那句「仍是 SourceSelect + RecoKeyModal 旧路」里的**引导流**那半已过时
        —— 现在的链路是 SourceSelect → **3 步引导** → 剧场。
- **未做（可后置）**：
  - [ ] 没选源就退出 App 时的确认弹窗
- **估时（剩余）**：1 天

---

## 6. 交互 & 桌面体验

> 本节只剩 Lite 模式的**手测验收**。同批的红心点播核实、渠道优先级、macOS Tray +
> 应用图标、AETHER 剧场视图都已交付并从本文件删除；编号保留原样是为了不打断
> `specs/lite-mode/spec.md` 里的 §6.3 引用。

### 6.3 Lite 播放模式（normal / lite 切换）— 🟡 **代码完成，验收未过（specs/lite-mode，2026-09-28）**

> **审查结论（2026-09-28 全量 review + 修复）**：17 个已勾任务**都真实实现了**
> （无"勾了没做"），「lite 只做展示层裁剪、不复制播放逻辑」这条风险守住
> （`LiteView` 零 `useState`/零 `<audio>`，`<audio>` 在 App 常驻不重建）。
> 审查发现的洞**已全部修掉**：
>
> 1. 🔴→✅ **lite 下点 ✨ 被全屏 `RecoLoading` 接管**（`z-index:150` + `inset:0`）——
>    「lite 只留三类元素」在功能主路径上失效，`LiteView` 自己的 `recoRunning`
>    分支还变成生产不可达死代码。修法：渲染条件加 `playerMode !== 'lite'`，
>    loading 交回 `LiteView` 内联 spinner；决策记进 `spec.md` §6 偏离 5
> 2. 🟡→✅ `overlayOpen` 漏 `auth.authError` / `showCookieFallback` → lite 下按一次
>    Esc 关两层，已补
> 3. 🟡→✅ Space 让位条件补 `BUTTON` / `role="button"`（空格 click 是 keyup 阶段
>    合成的，keydown 的 `preventDefault` 会吃掉）；从 Settings 切到**任何紧凑态**
>    自动关设置页（mini 下同样是 `z-index:1000` 全屏遮罩，同构问题一起修）
> 4. ⚪→✅ `LiteView.test.tsx` 的"只渲染三类元素"原是自证式断言（数组件自己打的
>    `data-lite-el`，且带 3 条空断言）。改成「可交互元素恰好 4 个」的**可证伪**
>    契约（已做变异验证：注入一个多余按钮 → 测试变红）
> 5. ⚪→✅ 无 DeepSeek key 时 ✨ 加 `is-unset` 虚线态（原只进了 `title` 属性，
>    视觉上毫无差别）；⛶ 退出键 `pointer-events` 随显隐切
>    ⏳ **待手测**：`specs/lite-mode/tasks.md` P5-5b（480×300 收窗 / 回 theater 还原
>    bounds / mini ⇄ lite 不丢存档 / ✨ 真跑 DeepSeek / 切换不中断音频）

- **目标**：新增极简播放模式。当前完整界面定为 `normal`；`lite` 模式播放器只显示：
  **歌名 + 上一首/下一首 + 一个「✨ 智能推荐」icon**（点击调 DeepSeek 推荐）。
- **范围**：
  - 全局 UI 模式状态 `normal | lite`，存本地偏好，Settings/快捷键可切
  - lite 布局：隐藏搜索面板、封面大图、歌词、源徽章等，仅留 歌名 + ◀▶ + ✨
  - ✨ icon → 调 `specs/reco-deepseek` 已有的 `POST /api/reco/run`，把推荐直接续进当前队列
  - （可选）窗口缩到小尺寸时建议/自动切 lite
- **验收**：
  - [x] Settings 或快捷键切 normal↔lite，即时生效且记住偏好
        （Settings「① 播放模式」三选一 + `⌘⇧L` + lite 内 `⛶`；键 `player-mode`）
  - [x] lite 下界面仅剩 歌名 + 左右切歌 + ✨ 三类可视元素
        （`LiteView.test.tsx` 白盒断言 `[data-lite-el]` 恰好 title/nav/reco 三个）
  - [ ] 点 ✨ → 调 DeepSeek 推荐 → 新歌续入队列可播（无 key 时走 reco 既有友好提示）
        ⚠️ 2026-09-28 降级：自动化只验到「点了会调 `/reco/run` + 无 key 降级」，
        **真跑 DeepSeek 出歌并可播**属 `specs/lite-mode/tasks.md` P5-5b，未做
        （要真 key + 出网，agent 小队做不了）
  - [x] normal↔lite 来回切，当前歌 / 队列 / 进度不丢
        （`<audio>` 常驻 + 只换条件渲染分支，无额外状态同步代码）
- **落地补充（超出原范围）**：
  - 模式从 2 态扩成 3 态：`theater`（= 本节的 `normal`）| `mini` | `lite`，
    `PlayerMode` 类型与读写搬进 `lib/storage.ts`（顺手进备份集）
  - Electron `player:mode` 的紧凑态从"只有 mini"泛化成 mini(600×104) /
    lite(480×300) 两种尺寸，mini ⇄ lite 互切不再覆盖存档的 theater bounds
  - lite 的键盘补齐：`Esc` 回 theater、`Space` 播放/暂停（浮层/输入框打开时让位）
- **未做**：原「（可选）窗口缩到小尺寸时建议/自动切 lite」——自动切模式会在
  用户拖窗口时误触发，等 lite 手测反馈再定。详见 `specs/lite-mode/spec.md` §1/§6。
- **风险**：lite 只做**展示层裁剪**，复用现有 `usePlayer` 状态，别复制一套播放逻辑。
- **估时**：1.5～2 天

---

## 7. 播放体验 & AI 深化（2026-07-13 竞品分析新增）

> 来自一轮竞品扫描（MusicFree / 洛雪 lx-music / Listen1 / YesPlayMusic / Feishin /
> Spotify AI DJ / Apple AutoMix）。结论：Maestro 在 **AI 推荐 + 跨平台 ❤ 同步 +
> AETHER 剧场主界面** 上已领先同类开源播放器；缺的是老牌桌面播放器的"基本功"
> （音效 / 桌面集成）。本章是那份扫描里还没做完的基本功——EQ 只落地一半，
> 桌面歌词待手测，媒体键只做了 Tray。AI 侧的自然语言歌单已交付
> （`specs/nl-playlist/`），从本文件删除。
> 详细分析只在 Notion 维护（个人重要，本地不留副本）→ https://app.notion.com/p/musicbox-2026-07-39c9be628711800b86f1daff4e05ad6b

### 7.1 均衡器 EQ + 交叉淡入淡出 + ReplayGain 音量均衡 — ✅ **EQ + crossfade 均已落地，ReplayGain 明确不做**

> 2026-09-29：spec `specs/audio-fx/`。范围从「EQ + crossfade + ReplayGain」
> **收敛成 EQ + crossfade**。
>
> - ✅ **EQ 已落地**：10 段 peaking（31Hz–16kHz，Q=1）+ 8 预置 + 总开关，存本地，
>   Settings「② 音频」节。链构建/参数推送抽成纯函数 `lib/eqChain.ts`（可脱离 React
>   测连接顺序与"用 setTargetAtTime 而非 .value="这类写错不报错的细节）。
> - ✅ **crossfade 已落地**（2026-10-19，commit `3f2aea8`，spec `specs/audio-fx` C 组）：
>   App 常驻第二个 `<audio>`（`lib/audioSlots.ts` A/B 槽位），每槽独立 Web Audio 链
>   （source → EQ → fadeGain → analyser），调度用 `setTargetAtTime`（不用
>   `linearRampToValueAtTime`——后者被中断会把增益停在半路）。切歌路径统一收敛到
>   `lib/crossfadeRunner.ts`；`crossfadeSec=0` 时行为与改动前逐字相同。21 条测试。
>   ⚠️ **副作用**：`<audio>` 的 `src` 从 React 绑定改成**命令式装载**，于是"改
>   audioUrl 必须同时真的装载元素"成了隐式契约 —— 紧接着就踩了一次回归
>   （切音质 / 试听降标准后卡在 00:00，commit `6a41481` 补了
>   `reloadActiveWithUrl`）。改这条链时务必先看该 commit。
> - ❌ **ReplayGain 明确不做**（spec §5 给了三条理由）：`loudness`/`replayGain`/
>   `gain_db` 在 server types / renderer api / common 里**零命中**（没元数据）；
>   AnalyserNode 拿到的是"已经播过的那几秒"而不是整轨响度（算法不成立）；
>   动态增益与"记住我的音量"直接冲突。要做得先给 4 个 provider 接 loudness 字段。
> - ⚠️ **适用范围**：Spotify WPS 路径由 SDK 自己解码输出，**EQ 与 crossfade 都不生效**
>   （WPS 现在因 license 500 根本播不了，所以这条边界无法实景验证）。UI 上已写明。

- **目标**：补齐洛雪 / foobar2000 / MusicBee 都有的音效与音量能力。
- **现状 / 复用点**：`usePlayer` 已在首次播放时惰性建了 **Web Audio graph**——EQ、淡入淡出、
  响度归一都挂这条链上，不用另起一套播放器。
- **范围**：
  - 10 段均衡器（BiquadFilter 级联）+ 预设（流行/摇滚/古典/人声…）+ 自定义，存本地偏好
  - 切歌交叉淡入淡出（crossfade，双 GainNode / 两个 audio 元素对接），时长可配；暂停/停止淡出防爆音
  - ReplayGain / 响度归一：优先用平台返回的响度元数据、否则 AnalyserNode 估算，统一到目标 LUFS
- **验收**：
  - [x] EQ 开关 + 8 预置 + 10 滑块即时生效、记住偏好（跨页面重开仍在，进备份集）
  - [x] 开关关闭 = 各频段 ramp 到 0 dB（**不是真 disconnect 旁路**：那会在出声时
        咔哒；10 段 peaking @ 0dB 幅频平坦、相位偏移 <1°，听感无差别），曲线保留
  - [x] 交叉淡入可开关，切歌无卡顿、无爆音（C 组）
        —— 代码侧 21 条测试钉死调度写法（`lib/crossfade.test.mjs` 11 条 +
        `lib/crossfadeRunner.test.mjs` 10 条）；**真机听感未验**（见 spec
        `specs/audio-fx/tasks.md`「本轮新增的未验证项」：爆音 / 与 EQ 同开 /
        seek 交互 / 打包模式 preload 四条）
  - [ ] ~~跨平台连播时主观音量一致（响度归一生效）~~ —— **本轮不做**，见 spec §5
- **风险**：HTML `<audio>` 真 gapless 较难，优先做 crossfade（更可控）；ReplayGain
  精确值要解码分析 —— 但没有 loudness 元数据时"元数据优先 / Analyser 近似"两条路
  都不成立，所以是**不做**而不是"先用近似"。
- **估时**：2–3 天

### 7.2 桌面歌词浮窗 — **已落地，待手测**（2026-09-28）

- **目标**：中文用户高频刚需（网易云/QQ/洛雪都有），你目前只有内嵌 synced 歌词。
- **现状 / 复用点**：已有 synced 歌词数据（QQ 优先 + lyrics.ovh 回退）与播放进度。桌面浮窗 =
  新开一个**透明、无边框、置顶**的 Electron BrowserWindow，经 IPC 接当前歌词行 + 时间轴。
- **范围**：
  - 独立透明置顶窗：可拖动/锁定位置、字号/颜色/描边可调、锁定时点击穿透
  - 双行（当前 + 下一行）滚动跟随播放进度；无歌词时隐藏或提示
  - 托盘/快捷键开关（与 7.3 热键联动）
- **验收**：
  - [ ] 开启后桌面出现置顶歌词，随播放逐行高亮
  - [ ] 可拖动定位、调样式；锁定后点击穿透不挡下层操作
  - [ ] 切歌 / 无歌词 / 暂停状态均正确
- **风险**：多显示器 / 全屏应用之上的置顶差异；mac 需处理 `visibleOnAllWorkspaces` + `setIgnoreMouseEvents`。
- **依赖**：与 7.3 热键同做入口最顺（浮窗开关已挂 Tray）。
- **估时**：2 天
- **审查结论（2026-09-28 全量 review）**：14 个已勾任务都真实实现，IPC 7 个通道
  逐个核对全对齐，复用 `useLyrics` 的 lyrics（**不重复请求**），颜色门禁 0 硬编码。
  - 🔴→✅ **锁定后没有任何解锁出口**（齿轮被 `{!prefs.locked && ...}` + scss
    `display:none` 双藏，设置面板打不开，而 `locked` 持久化到
    `userData/desktop-lyrics.json` → 退出重开照样锁死，只能 Cmd+Q）。修法：Tray 加
    「桌面歌词 · 锁定位置」勾选项（常驻入口，renderer 侧刻意不放——锁定时收不到
    鼠标事件），并用 `ipc-contract.test.ts` 守住这条不变量
  - 🟡→✅ **抢主窗口焦点**：`live.show()` → `showInactive()`；`OverlayWindowLike`
    接口里把 `show()` 直接删掉，让将来想用它在**类型上**就被挡住
  - 🟡→✅ **纯 resize 不落盘**（Electron 的 `moved` 只在拖动时发，resize 不发 →
    拉大的尺寸退出即丢）：`on()` 类型加 `'resized'`，与 `moved` 共用同一个 debounce
    落盘（`onWindowMoved` 改名 `onWindowGeometryChanged`，名字不再说谎）
  - 🟡→✅ **多显示器还原 bounds 不校验**：注入点 `clampToVisibleDisplay`，判据是
    矩形与某块屏 `workArea` **相交**（贴边只露一半也算看得见）；位置失效**只丢
    x/y，宽高保留**（用户拉过的宽度不该白拉）；`screen` 未 ready 时 try/catch 退回
    原行为，查不到就不丢浮窗
  - 🟡→✅ **overlay IPC 无 sender 校验**：`isOverlaySender()` 比 `webContents`
    引用，浮窗专属的两个通道首行 `if (!fromOverlay(event.sender)) return`
  - ⚪→✅ `getStatus()` 补 `.catch`（原来是 unhandled rejection）；浮窗加**歌名行**
    （`state.title/artist` 一直在契约里推但没人读，现按歌词一半字号 + 45% 透明渲染）
  - ⚪→✅ 浮窗**不再引 Google Fonts**（每次开窗一次外网请求 + 离线静默失败 +
    字体闪烁；中文歌词用系统苹方本来就比 Noto Sans SC 对味）。主窗口 `index.html`
    的外链是存量，本轮不动
  - ⚪ 遗留（低优先）：`OverlayWindowLike.setBounds` 是死接口（全仓无人调用）；
    `resizable: true` 在 Win/Linux 上因为 frameless 无 `-webkit-app-resize` 拖不动
    ——spec §1 已排除 Win/Linux，**D15 手测清单里要写明「resize 恢复只在 mac 验」**
- **落地记录（2026-09-28）**：spec `specs/desktop-lyrics/`。独立透明置顶
  `BrowserWindow`（`screen-saver` 档置顶 + `visibleOnAllWorkspaces`），第二个 HTML
  入口 `lyrics.html`（产物只有 4kB JS / 8kB CSS，不拖主 bundle）。
  - **播放状态单向流**：主窗口 `useDesktopLyrics` 算「当前行/下一行/行内进度」
    → main `DesktopLyricsController` 缓存转发 → 浮窗纯展示。浮窗**不碰 `<audio>`、
    不请求后端**，与 TheaterView 共用 `lib/lyrics.ts` 的 `activeLineWindow`，
    两边不会错行。
  - **偏好以 main 为唯一事实来源**：`userData/desktop-lyrics.json`
    （开关/锁定/字号/配色/描边/位置尺寸），浮窗改完经 IPC 回写，重启恢复。
  - **锁定 = 点击穿透**：`setIgnoreMouseEvents(true, {forward:true})` + 鼠标移入
    临时放行（洛雪同款交互）；字号 3 档 / 4 组配色 / 描边开关在浮窗 ⚙ 面板里调。
  - **入口三处**：Titlebar `词` 按钮、`⌘⇧D`（`⌘⇧L` 已被 lite 占用）、Tray 勾选项；
    三者同源互相同步。Tray 已含「桌面歌词」勾选项。
  - 自动化：main 侧 3 个测试文件（prefs / window-options / controller）+ 浮窗组件
    10 例 + `lib/lyrics` 17 例，全绿；typecheck / lint / 颜色门禁 / 双端 build 通过。
  - **未做**：全局热键（`globalShortcut`）留给 #7.3；逐字卡拉OK 未做。

### 7.3 媒体键 + 全局热键 + 系统「正在播放」— ✅ **2026-10-24 已交付**（`specs/desktop-integration`）

- **交付内容**：
  - `navigator.mediaSession`（renderer，`hooks/useMediaSession.ts`）：metadata（歌名/歌手/专辑/封面）+
    `playbackState` + `setPositionState` + **8 个 action handler**
    （play / pause / previoustrack / nexttrack / seekbackward / seekforward / seekto / stop）
  - `globalShortcut`（main，`global-shortcuts.ts`）：**6 条**全局热键
    （`⌃⌥` + Space / ← / → / ↑ / ↓ / D）
- **一个 API 顶三件事**：Chromium 在 macOS 上把 media session 接到了
  `MPNowPlayingInfoCenter` → **系统媒体控件（控制中心/锁屏）、耳机与键盘媒体键、
  macOS「正在播放」**一起点亮，不需要原生模块。
- **⚠️ 关键约束（写进代码了，不只是约定）**：**媒体键不能注册成 `globalShortcut`**
  —— Electron 在 macOS 上那样做会占住 remote command center 通道并**关掉
  Chromium 自己的媒体键处理** → 媒体键会变成"有时双触发、有时失灵"。
  ⇒ 媒体键**只走 mediaSession**；`global-shortcuts.ts` 里有守卫挡住，
  `global-shortcuts.test.ts` + `main.behavior.test.ts` 两条断言守着。
- **全局热键为什么用 `⌃⌥` 而不是 `⌘⇧`**：App 内部已经有 `⌘⇧M`/`⌘⇧D`/`⌘⇧L`
  三个快捷键（mini / 桌面歌词 / lite）→ 全局热键若也用 `⌘⇧`，App 聚焦时
  **两个 handler 同时触发**（切两次 = 白切）。
- **零新增 IPC 通道**：全局热键**复用**托盘那条 `tray:command` 通道
  （类型 `TrayCommand` → `PlaybackCommand`，通道名不动）。
- **验收**：
  - [x] 自动化：mediaSession 的 8 个 handler **真的调到播放命令**（20 个用例）
  - [x] 自动化：全局热键注册清单 + **零媒体键** + 退出注销（6 + 2 个用例）
  - [x] 变异验证：删掉任一 handler 的调用 → 用例**必须红**；拆掉媒体键守卫 → 用例**必须红**
  - [ ] 手测（**唯一一条无法自动化**）：插带媒体键的耳机 → ⏯/⏭/⏮ 响应 +
        控制中心显示歌名封面 + `⌃⌥Space` 在 App 不在前台时能暂停
- **未做（不在本轮）**：**自动更新**（`electron-updater`）—— 要 GitHub Releases
  feed + **签名构建**才有意义（没签名的 dmg 更新完照样被 Gatekeeper 拦）
  → 等 §0 的 Apple Dev + EVS 落地后单独立 spec。

### 7.4 音量功能接线 — ✅ **已接好（2026-10-20）· 2026-10-24 更正本文档**

- **本文档此前写的**：「🔴 整条是死代码」—— **那是 2026-10-20 当天发现的状态，
  之后当天就修完了，但本文档没跟着改**。⚠️ 照着旧版本排期会**做重复劳动**。
  （这轮盘点时才发现 —— 教训：**文档声称的状态要以代码为准**。）
- **现在的实际接线**（`master 8ded104` 实测）：
  - `packages/renderer/src/App.tsx:103` → `const volume = useVolume(player.slots, player.track);`
  - `packages/renderer/src/components/modals/SettingsModal.tsx:64` → 音量滑块 + 静音开关
  - `packages/renderer/src/hooks/useVolume.ts:31-33` → **推给 `slots.all()`（A/B 两个槽位）**，
    不是只推活跃那个 —— 否则 crossfade 淡出时音量会突变
  - `muted` 与 `volume` 分开存：取消静音恢复原音量；从 0 往上拖自动取消静音
  - 持久化：`writeStoredVolume(volume, muted)`（`maestro:volume` 键）
- **原「问题」里的两项已不成立**：
  - ~~`useVolume` 从未被 import~~ → 已被 `App.tsx` import
  - ~~UI 上根本没有音量控件~~ → `SettingsModal` 里有
- **验收状态**：
  - [x] 拖音量滑块 → 正在播的歌立刻变小声/大声（两个槽位都算）— `useVolume.test.tsx` 覆盖
  - [x] 静音/取消静音 → 立即生效且取消后恢复原音量 — 同上
  - [x] 偏好跨重启保留 — 同上

### 7.5 播放失败分级：已收敛为一套（2026-10-21 完成）

- **决策**：选 (b) —— **删掉服务端那套分类器**，分类只在 renderer 侧做。
- **落地**（PR #113 + 本轮）：
  - 服务端 `packages/server/src/music/entitlement.ts` 的 `classifyPlaybackFailure()` /
    `playbackFailureMessage()`（原 ADR-110「凭据有效 ≠ 权益有效」的可执行表述，
    **生产链路里零调用点**的纯死代码）**已删**
  - 服务端改为只提供**权威事实**：`GET /auth/status?validate=1&extended=1` 带
    `credential` / `entitlement` 两个**三态**（valid / expired / unknown）——
    「没探就别猜」，`unknown` 是合法答案
  - renderer `usePlayer.ts` 的 `PlayFailReason` 成为**唯一**分类器：
    `paid-track | vip-locked | entitlement-expired | stream-failed | no-match | generic`
  - `entitlement-expired` 档已接线：`st.entitlement === 'expired'` → 文案
    「需要会员，但你的会员已失效 —— 重新登录没用」
  - `credential` 三态也接上了：`PlayFailure.credential` 带进 `PlayerNotice`，
    `stream-failed` 档在**凭据确认还活着**时**不再提「重新登录」** ——
    凭据没坏，重登出来还是那个好凭据（ADR-110 的核心洞察在**文案层**的落地）
- **形状统一**：Deezer 那条 early return 之前**不带三态**（`extended=1` 缺字段，
  客户端读成 unknown —— 恰好对，但契约靠巧合成立），已补齐为两个 `unknown`
- **为什么 (a) 没选**：`failureKind` 要服务端**再实现一遍**分类器，等于把
  「两套分类」从代码搬进协议 —— 分类规则会漂移到服务端那一份，renderer 那份
  变成摆设。改成「服务端给事实、客户端做分类」之后，**分类规则只有一处**，
  而服务端仍然保有它独有的知识（会员状态在 session 里，只有它知道）
- **ADR-110 已回写**：失败分类的归属（见 knowledge `ADR-110` §4）

---

## 8. 长期（≥ 一季度）

| 方向             | 描述                                                         | 触发条件                  |
| ---------------- | ------------------------------------------------------------ | ------------------------- |
| iOS / Android 端 | React Native 重用 renderer 业务层；audio / OAuth 桥到 native | 桌面版稳定运行 1 个月以上 |
| 协同 / 共享库    | 多人 share 一个 unified 库；本地为主 + P2P 同步              | 用户反馈有需求            |
| 插件 / 自定义源  | MusicProvider interface 暴露给用户写自定义 adapter           | 有用户写 issues 想要      |
| 多模态推荐       | DeepSeek 不止用 liked 库，还用播放历史、跳过的歌             | DeepSeek 给出更准的推荐   |

---

## 排期建议（下期，按"什么时候能用上"的优先级）

| 周               | 内容                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W0.5（前置）** | **#0 Apple Dev + castLabs EVS**：买 Apple Dev（$99，1–3 天批）+ 注册 EVS 账户（**0 成本**，免费 streaming 签名）+ 第一次 VMP 签出 + `?wpsDebug=1` 重跑验证 `hasTrack=true`。**不阻塞其它项**——Apple Dev 申请在后台跑的同时可以继续 W2 起的工作。           |
| **W1**           | **7.3 桌面系统集成**：`navigator.mediaSession`（一次覆盖系统媒体控件 / 耳机媒体键 / macOS「正在播放」三件事）+ `globalShortcut`（**只注册非媒体键**，媒体键走 mediaSession 一条路，两边都注册会互相打架）+ 自动更新机制。详见 `specs/desktop-integration/` |
| **W2**           | **歌单编辑**（后端 `PATCH /library/playlists/:id` 已支持改名 / 加歌 / 删歌，`api.ts` 封装也在，**UI 侧 0 调用** —— 纯 renderer 工作，1 天）+ 6.3 lite 手测验收 + 7.2 桌面歌词手测验收                                                                      |
| **W3**           | ~~7.1 crossfade~~ → **2026-10-19 已交付**（W3 空出）· 候选：5 首次启动引导流 / 播放历史 / 队列面板 / 歌词搜索 UI（按真实反馈定优先级）                                                                                                                     |
| **W4**           | 发版（等 W0.5 的签名 + 公证落地）→ 第一个可分发的 dmg + 把自动更新接上 + bug bash                                                                                                                                                                          |

> **2026-10-24 盘点后的排序依据**：
> ① **关键路径不是工程，是 Apple 那 1–3 天审批** → W0.5 应当**今天就下单**，工程不闲等；
> ② **价值/工时比最高的不是新功能，是「把后端已有的能力接出来」**（歌单编辑：0 新后端代码）；
> ③ **系统集成层整层是空的**（五项全 0 命中）→ 这是「能跑」到「能天天用」的门槛。
> ④ Figma 侧 32 条设计维护活已归档（`specs/d5-code-connect` / `d6-description-template` /
> `figma-legacy-retrofit`）—— 它们不产生 app 功能，且受 Figma Starter 写限额阻塞。

> 不在本期范围：**castLabs 商业 3PL VMP 审计**（`3pl@castlabs.com`）——本项目用标准
> ECS v43 fork，**不需要 3PL**。

## 工作流

- 每个新功能开工前：读 `specs/<name>/spec.md` 的 **验收标准** 段，作为 done 的判定
- 实现期间：实现完一项勾 `specs/<name>/tasks.md` 一条
- 收尾：跑 `npm run typecheck` + `npm test`（server 测）+ 浏览器/Electron 端到端走一遍
- 提 PR：commit message 沿用 `feat(<scope>): …` / `fix(<scope>): …` / `refactor(<scope>): …` 三段前缀

## 知识库挂钩

**本轮（已发）的踩坑**还没沉淀到 `~/knowledge/maestro/`——下期开工前**优先**做：

- `~/knowledge/maestro/packaging.md`：sidecar 启动 + waitForSidecar + 关窗到托盘 + Cmd+Q kill
  - electron-builder extraResources / electronDist / afterPack（EVS VMP 签名 + codesign 时序）
- `~/knowledge/maestro/spotify.md`：OAuth PKCE + tier 缓存 + WPS 包装（spotify-wps.ts
  模式：window.__wpsSdkReady 旗位 + wpsFatal/emeOk/hasDeviceId 三态）
  - **Widevine + VMP 铁四角**（**新加 license 500 教训**）：
    - vanilla Electron 无 CDM、无 VMP
    - castLabs fork 是唯一同版 drop-in（**v43.2.0+wvcus**，v31.7.7 旧版太老 + 协议变更下载 CDM 失败）
    - **license 500 = dev VMP 签名被 Spotify 生产 server 拒**——必须走 **EVS（免费）**
      签 production VMP，否则"能装不能响"
    - 本机 iOA 拦 CDM CDN（`redirector.gvt1.com`）→ 567B HTML 拦截页；换无 TLS 拦截网络
    - WPS 路径完整调试链 `?wpsDebug=1`（PR #53 落地）——把"widevine/tier/SDK ready/
      connect/ready/fatal/transfer/play/presentTrack" 全打到 console

这样下期迭代（或交接）的人有现成入口。
