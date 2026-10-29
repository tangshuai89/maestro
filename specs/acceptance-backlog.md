# 验收清单未勾项 — 分类台账（2026-10-29）

> 对应 `specs/*/tasks.md` 里所有 `- [ ]` 项。清单项本身在各自的 spec 里，
> 这份文件只回答一个问题：**它为什么还没勾？**
>
> 上一轮（PR #144）治了「证据指向的文件不存在」（17 条死证据）。
> 这轮治另一半：**「没勾」本身没有理由**。

## 0. 一句话结论

全仓 **1174** 条勾选项里 **59 条**未勾。逐条判定后：

| 分类        | 条数 | 含义                                                 | 谁来解           |
| ----------- | ---- | ---------------------------------------------------- | ---------------- |
| `@blocked`  | 25   | **外部阻塞** —— 缺凭据 / 缺账号 / 缺网络 / 等你拍板  | 不是工程债       |
| `@manual`   | 12   | **必须人测** —— 真机 / 桌面 / 真实登录态，机器验不了 | 你（一次性点完） |
| `@deferred` | 13   | **明确延后** —— 标了「可选」或不在本期范围           | 不急             |
| `@todo`     | 7    | **真·欠着的工程活**                                  | 工程侧           |
| ✅ 累计补勾 | 2    | 已完成但没勾（CI 现在全绿）                          | —                |

⇒ **59 条里只有 7 条是真正的工程债。** 其余 52 条要么在等外部条件，要么只能人点，
要么当初就写了「可选」。**欠的工程活比清单看起来少得多** —— 这就是分类的价值。

> **2026-10-29 补记**：`specs/figma-diff/` 是 PR #146 引入的新专题，它的 7 条未勾项
> 在本台账初建（PR #144）时还不存在（那时 `figma-diff` 还没合进 master）⇒ 本轮补登记。

## 1. `@todo` —— 真·欠着的工程活（7 条）

按建议顺序排：

| #   | 出处                                  | 欠的是什么                                                                                                            | 建议                                                                           |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `specs/d5-new-components/tasks.md:44` | 「新建组件的 PR 必含 `component-specs.md` 更新 + strict audit PASS」—— **现在是承诺不是门禁**（PR 模板里的 checkbox） | 做成 CI 检查。⚠️ 与另一条并行工作（figma-diff 门禁）**可能撞车**，动手前先对齐 |
| 2   | `specs/d4-token-drift/tasks.md:44`    | 「token 从未被消费的根因收敛」—— 条目自己写着「**进行中，数字已过时**」                                               | 先把数字更新到当前状态，再决定是收尾还是重开                                   |
| 3   | `specs/token-adoption/tasks.md:114`   | spacing / radius / 字号 的硬编码扫描与替换（方法同 S1/S2，**噪音大，单开**）                                          | 单开一个 PR。方法论现成（`scan-hardcoded-colors.mjs`）                         |
| 4   | `specs/token-adoption/tasks.md:99`    | Tailwind 默认色阶批（`_liked-modal.scss` 36 处 + …）                                                                  | 同上，机械替换为主                                                             |
| 5   | `specs/token-adoption/tasks.md:107`   | provider 健康状态色 / AI 理由色 —— **设计稿里没有这套语义**                                                           | ⚠️ 缺的是**设计**，不是代码 → 归到「等设计」更准，本轮先留在 `@todo`           |
| 6   | `specs/figma-diff/tasks.md:147`       | code-connect **覆盖率反向检查**（映射数落后于组件数，缺口静默扩大）→ `figma-code-connect-validate.mjs` 现无此检查     | 加一条「映射数 < 组件数 ⇒ 报缺口」的门禁。**不需 Figma 权限，工程侧可独立做**  |
| 7   | `specs/figma-diff/tasks.md:150`       | 刷新 `docs/d-series-status.md`（停在 2026-10-15）                                                                     | 一次性刷新，跟本批 PR 走                                                       |

## 2. `@manual` —— 手测清单（12 条，机器验不了）

这批的共同点：**只有真机 / 真实登录态 / 真人手点才能验**。
下面按「一次能点完」的顺序排，勾完这 12 条，验收清单就只剩外部阻塞了。

| #   | 出处                                     | 前置                      | 要做什么                                                                            | 期望                                 |
| --- | ---------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `specs/album-fanout/tasks.md:183`        | 网易云已登录              | 搜一张专辑 → 点 ❤                                                                   | 网易云「我的收藏专辑」里真的出现     |
| 2   | `specs/album-fanout/tasks.md:185`        | 同上                      | 看 `POST /api/album/sub` 的返回                                                     | 200；若非 200 → 日志里的 code 是多少 |
| 3   | `specs/album-fanout/tasks.md:187`        | QQ 已登录                 | 搜一张**只在 QQ** 有的专辑 → 点 ❤                                                   | 走定向等价查找，别的平台也能收藏     |
| 4   | `specs/consistency-fixes/tasks.md:184`   | —                         | 推荐页点红心 / radio 点红心 / 取消红心                                              | 三处角标与远端一致                   |
| 5   | `specs/consistency-fixes/tasks.md:183`   | 打包产物                  | 打包版出声 + 显示封面                                                               | T1 验收                              |
| 6   | `specs/paid-album-detection/tasks.md:16` | 本地 server               | 模拟「台北车站」搜索                                                                | `bestSource` 正确避开付费源          |
| 7   | `specs/d8-compact-layout/tasks.md:33`    | `npm run dev`             | 拖窗口过 960 / 1200 / 1920 三档                                                     | 紧凑档间距与字号正确                 |
| 8   | `specs/lite-mode/tasks.md:41`            | `npm run dev`（Electron） | 窗口收成 480×300 / 回 theater                                                       | 还原正常                             |
| 9   | `specs/mini-player/tasks.md:19`          | `npm run dev`             | theater↔mini 音频不中断、窗口收缩/还原动画、红绿灯落位、拖拽、快捷键、重启恢复 mode | 全过                                 |
| 10  | `specs/mini-player/tasks.md:37`          | 同上                      | 按 `specs/mini-player/spec.md` §5 逐条验收                                          | 全过                                 |
| 11  | `specs/desktop-lyrics/tasks.md:28`       | `npm run dev`             | 置顶逐行高亮 / 拖动 + 重启恢复 / 样式调节 / 锁定穿透 + hover 恢复                   | 全过                                 |
| 12  | `specs/desktop-integration/tasks.md:58`  | 插**带媒体键的耳机**      | ⏯ / ⏭ / ⏮ 响应                                                                      | 耳机上的按键能控制播放               |

## 3. `@blocked` —— 外部阻塞（25 条，**不是工程债**）

按阻塞源分组 —— 每组的**解锁条件**都写在右边：

| 阻塞源                                                 | 条数 | 出处                                                                                                                                                  | 解锁条件                                                                                                                                         |
| ------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spotify OAuth token**                                | 6    | `album-search` 35/62/65、`remote-playlist` 40/41/48                                                                                                   | 拿到一个 Spotify 账号的 token（`specs/spotify` 里有换取流程）                                                                                    |
| **Apple Dev + castLabs EVS**                           | 7    | `spotify` 73/96/103/109/167/168、`stability` 8                                                                                                        | ① Apple Developer（$99/年，1–3 天批）② EVS 注册（**0 成本**）。⚠️ 2026-10-28 起卡在苹果售后，**外部依赖，工程侧无解**                            |
| **Premium 账号 + 无 TLS 拦截网络**                     | 3    | `spotify` 28/44/45                                                                                                                                    | 本机 iOA 拦 CDM CDN（`redirector.gvt1.com` → 567B HTML 拦截页）⇒ 需换网络；再叠加 Premium 账号                                                   |
| **FIGMA_TOKEN**（含 Enterprise `file_variables:read`） | 2    | `d4-token-drift` 36、`d7-screen-variants` 27                                                                                                          | token 是有的，但**没有 Enterprise 权限**读 `file_variables`；后者还需在 Figma UI 里手动连线                                                      |
| **有效 cookie 基线**                                   | 2    | `auth-resilience` 151/154                                                                                                                             | 有一份**没过期**的 cookie 才能测；顺带要把「`get_user_baseinfo_v2` 不是真校验」记进 spec 附录                                                    |
| **Deezer 限流阈值实测**                                | 1    | `album-search` 36                                                                                                                                     | 得真的去压 Deezer 的接口（会吃限流额度）                                                                                                         |
| **等你拍板**                                           | 3    | `d4-token-drift` 35（`--text-dim` 0.55 / 0.4）、`token-adoption` 62（同上）、`remote-playlist` 38（是否接受「所有已登录用户被强制重新授权」）         | 产品决策，不是技术选择                                                                                                                           |
| **Figma 写权限（席位）**                               | 3    | `figma-diff` I1（补 25 个组件 + 9 屏的 AI_CONTRACT 段）、I3（motion spec 补登记 39 个 keyframes，须同步 Figma）、I5（刷新 token dump 需 REST 读权限） | **已拍板走「升席位」路线**（2026-10-29）：Starter 团队的云端 MCP **写工具**被付费墙拦、桌面本地 MCP 只读。升到 **Dev/Full** 席位即解锁桌面写通道 |

## 4. `@deferred` —— 明确延后（13 条）

当初就写了「可选」或「不在本期范围」的，**不是欠账，是范围外**：

| 出处                              | 内容                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `album-search:154`                | Figma 定稿后把最简列表换成正式网格卡片（**本轮按设计刻意延后**）                                                         |
| `d1-screens:31` / `d1-screens:32` | D5 平行 PR 的 5 个 Code Connect 映射 / D3 的 12 条 prototype wirings（需 Figma UI 手动）——不在 D1 范围                   |
| `d11-visual-regression:37`        | 把真机视觉验收改用截图 baseline 机制（可选）                                                                             |
| `d2-convergence:31`               | 视觉回归保护升级到「D6 阶段 5」或独立 P3 PR（现状：visual.yml 3 视图 + e2e.yml 已覆盖主链路）                            |
| `d2-convergence:32`               | AETHER 主题令牌补漏（可选）                                                                                              |
| `d7-screen-variants:28`           | 把 NoLyrics / TrialFallback / RecoUnconfigured 并入同一组件集（可选）                                                    |
| `d8-compact-layout:34`            | 1200 档若仍觉挤 → 推荐卡减到 2 张（可选）                                                                                |
| `mini-player:38`                  | 可选 `visual:test`（现状：visual 只有 theater + shadcn-smoke，**没有 mini-player**）                                     |
| `remote-playlist:48`              | 用户歌单读取 → **已取消**（`/user/{id}/playlists` 匿名实测不通）                                                         |
| `spotify:168`                     | EVS 凭据进 GitHub Actions secret（可选，依赖 EVS 落地）                                                                  |
| `figma-diff:144`                  | code-connect 补 10 个映射（Icon/* ×8 · State/RecoUnconfigured · Scene/Backdrop）—— 属 10-24 归档决策里「持续对齐」那一类 |
| `figma-diff:151`                  | D7-D1 的 6 条手连线是否随 10-24 决策一并归档 —— 等你拍板                                                                 |

## 5. 维护规则（这一轮新加的）

1. **未勾项必须带分类标记** —— `@blocked` / `@manual` / `@deferred` / `@todo` 四个之一，
   紧跟在 `- [ ]` 后面。门禁 `scripts/check-acceptance-evidence.mjs` 会查：
   没标记的未勾项 → **红**。
   ⇒ 目的很直接：**「没勾」必须带理由**，否则清单会重新腐烂回「21 项没人勾」的状态。
2. **勾上时写清「为什么现在能勾」** —— 本轮补勾的 2 条都带了当年的阻塞是怎么消失的
   （断网问题不存在了 / CI 现在全绿）。
3. **本台账只回答「为什么没勾」** —— 「勾没勾」永远以各 spec 的 `tasks.md` 为准；
   两边不一致时以 `tasks.md` 为准，并回来修这份台账。
