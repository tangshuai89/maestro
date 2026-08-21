# Figma 驱动前端改造方案 — AETHER 宇宙剧场

> 目标：让 `FtbRZXvzlCp4Sq9e322cQQ`（Maestro AETHER Music Player）成为 **AI 可直接消费的设计稿**：
> 组件化 + 变体 + 令牌绑定 + 动效规格化，使 coding agent 能通过 Figma REST API / Dev Mode MCP
> 读取设计稿，直接生成/同步 React + SCSS 代码。
>
> 本文档基于仓库现有材料编写：`scripts/figma-aether-spec.md`、`scripts/figma-aether-v2-plan.md`、
> `scripts/figma-v3-command.md`（当前文件是 v3 脚本稿）、`.superdesign/init/`（代码端组件盘点）、
> `.mcp.json`（已配置官方 `figma-remote` MCP）。

---

## 0. 现状盘点（为什么现在还不能 AI 驱动）

| 维度 | 现状 | 问题 |
|---|---|---|
| 文件结构 | 单 frame `AETHER — Canvas` 1440×900 | 没有 Pages 分层，AI 无法区分「令牌 / 组件 / 屏幕」 |
| 组件化 | 无组件，全是普通 frame | AI 拿到的是扁平节点树，无法识别可复用单元、无法生成 React 组件 |
| 变体 | 无 | 交互状态（hover/active/playing…）在画布里没有表达，代码状态映射全靠猜 |
| 令牌 | 有 AETHER 变量组（颜色为主） | 变量没绑定到节点（很多是脚本硬编码的 hex）；spacing/radius 只是名字里的数字，不是 number 变量；无 effect styles；无 typography styles |
| 动效 | 无（零原型连线） | Figma 里唯一的动效载体是原型交互，现在完全没建 |
| 命名 | 部分语义化，混有机器名 | AI 读图靠命名，命名就是给 AI 看的文档 |
| 覆盖范围 | 只有「正在播放」主视图 | 缺 SourceSelect / Search / Liked / Settings / 登录 / 空态 / 错误态等屏幕 |

**结论**：当前文件是「给设计师看的渲染图」，不是「给 AI 看的组件库」。改造核心 = 把一张图拆成
四层结构（Foundations → Components → Screens → Motion）。

---

## 1. 文件结构：拆成 4 个 Page（AI 按 Page 分阶段读取）

```
📄 Maestro AETHER Music Player
├─ 01 · Foundations     # 令牌 + 设计系统说明（AI 第一步读这里）
├─ 02 · Components      # 组件库（component set + variants）
├─ 03 · Screens         # 屏幕，全部用组件实例组装，禁止裸画
└─ 04 · Motion          # 原型 flows + MOTION SPEC 表 + storyboard
```

- **`01 · Foundations`** 顶部放一个 **README frame**：用纯文本写清文件结构、命名规范、令牌清单、
  动效编码约定、代码映射表（Figma 变量 ↔ CSS 变量）。AI 每次审计第一件事就是读它。
- **`03 · Screens`** 里的 frame 全部由 `02` 的组件实例构成（组件可以改属性，但结构来自库）——
  这样 AI 才能从屏幕反查出"哪些是组件、哪些是实例参数"。

---

## 2. 令牌层：从「一组颜色」升级为「完整设计系统」

### 2.1 变量集合与层级

Figma Variables 必须分两层 + 别名链，AI 才能理解语义：

```
AETHER/Color/primitive/*      # 原始色：neon-cyan #00E5FF / electric-purple #5B2BFF …
AETHER/Color/semantic/*       # 语义色，alias 到 primitive：
                              #   accent → primitive/neon-cyan
                              #   accent-hover → 衍生色
                              #   text/main|dim|muted
                              #   glass/fill|stroke
                              #   status/liked → heart-red …
                              #   platform/qq|netease|deezer|spotify
AETHER/Spacing/*              # NUMBER 变量：2/4/8/12/16/24/32/48/64/96（现在是名字带数字，要改成真 number 变量）
AETHER/Radius/*               # NUMBER 变量：8/12/16/20/24
AETHER/Type/*                 # Typography 变量（或直接建 Text Styles，两者都做）
AETHER/Motion/duration/*      # NUMBER 变量：fast 120 / base 240 / slow 400 / xslow 700（ms）
```

### 2.2 必补的三类 Styles（变量之外的样式资产）

| 类型 | 内容 | 为什么 AI 需要 |
|---|---|---|
| Text Styles | `AETHER/Display-44`、`Title-28`、`Body-16`、`Caption-12`、`Mono-10`（含字重/字距） | 字体是变量管不了的属性，API/MCP 能列出 styles，AI 才能映射到 SCSS |
| Effect Styles | `glass-card`、`glass-overlay`、`glow-cyan`、`glow-purple` | 现在玻璃是「fill 透明度 + 描边」模拟的，没有 style；真玻璃要 background blur，必须用 Effect Style 定义 |
| Grid/布局 | 8pt 网格说明（README 里写） | 代码端 spacing 全靠它对齐 |

### 2.3 绑定纪律（最重要的一条）

- **所有节点颜色必须引用变量，禁止硬编码 hex**（现在 v3 脚本大量直接 setFills）。
- AI 审计时通过 `fillStyleId` / `boundVariables` 判断"这个值来自哪个 token"；
  绑定不完整 = AI 拿到一堆孤儿颜色，无法生成语义化 CSS。

### 2.4 代码映射（单一事实源）

| Figma | 代码端 |
|---|---|
| `AETHER/Color/semantic/accent` | `--accent`（`base/_tokens.scss`） |
| `AETHER/Spacing/8` | `--space-2` |
| `AETHER/Radius/16` | `--radius-md` |
| `AETHER/Type/Display-44` | `.display-44` 或组件样式 |

把这张表写进 README frame + 仓库文档，AI 每次同步先读它。现有代码端的
`--accent / --space-* / --radius-* / --ease-*` 命名尽量与 Figma 侧对齐，或提供映射表。

---

## 3. 组件化：从代码盘点反推组件清单

`.superdesign/init/` 已经把代码端组件盘点好了，反过来就是 Figma 该建的组件。

### 3.1 原子组件（Primitives）

| 组件 | Variant 属性 | 对应代码 |
|---|---|---|
| `Icon/Button` | tone=`glass\|neon\|outline`，size=`28\|40\|64`，state=`default\|hover\|active\|disabled\|focus`，boolean `iconOnly` | `.titlebar-btn`、控制按钮 |
| `Badge/Platform` | platform=`qq\|netease\|deezer\|spotify`，state=`idle\|active\|liked` | 平台徽章（Q/N/D/S） |
| `Tag/Hud` | tone=`cyan\|purple\|dim`，boolean `live` | `NEURAL FEED`、`HI-RES` 等 |
| `Progress/Seekbar` | state=`idle\|hover\|dragging`，value=0–100%（实例可换） | 底部进度条 |
| `Text/…` | 直接用 Text Styles | — |

### 3.2 复合组件（由原子实例组装，用 component properties 暴露参数）

| 组件 | 关键属性 | 状态变体 |
|---|---|---|
| `Cover/Art` | 图片（instance swap 槽位）、boolean `playing` | 播放中呼吸光晕 vs 静止 |
| `Track/Info` | text 属性：曲名/艺术家/专辑 | — |
| `Lyrics/Line` | text 属性 | state=`prev\|current\|next`（+ 青色指示条） |
| `Card/Reco` | text：曲名/艺术家，number：match% | state=`default\|hover` |
| `Controls/Transport` | boolean `shuffle`、`repeat(off\|all\|one)`、`playing` | playing / paused（播放键变体） |
| `Panel/Glass` | boolean `header`、text 标题 | — |

### 3.3 组件化纪律（AI 友好度决定项）

1. **每个组件：auto-layout + 令牌绑定 + description 写动效/交互说明**。description 是 AI 最爱的字段。
2. **变体不是越多越好**：每个组件 ≤2–3 个 variant property，每个属性 ≤4–6 个值。
   正交变体会爆组合数（3×3×4=36 个变体），AI 和人都维护不动。布尔/文本/换图用
   **component properties**（boolean / text / instance swap）解决，不堆变体。
3. **变体命名 = 代码状态命名**：`state=default|hover|active|disabled` 直接对应 CSS
   `:hover / .active / [disabled]`，AI 无需翻译。
4. **同一组件的变体之间图层名必须一致**（Smart Animate 匹配 + AI diff 的前提）。
5. **每个组件一个 description 模板**：

   ```
   Used in: Screens/03 · NowPlaying
   States: default | hover | active | disabled
   Motion: press → 120ms scale(0.96) ease-out; hover glow via glow-cyan effect style
   Tokens: AETHER/Color/semantic/accent, AETHER/Radius/full
   ```

---

## 4. 动效规格化（AI 不落下动效的关键）

Figma 没有关键帧时间线，动效必须用 **三层编码** 表达，AI 才能完整读取：

### 4.1 层一：变体即关键帧 + 原型连线（机器可读的动效）

- 每个动效 = 一组变体 + 原型 interaction（trigger=`whileHover` / `onTap`，
  transition=`Smart Animate`，duration + easing 填真实值）。
- **REST API 的 file JSON 里节点带 `interactions` 字段**（transition 参数、连线方向都在里面），
  Dev Mode MCP 也能查原型信息 —— 这是 AI 读动效的主通道。
- 硬前提：Smart Animate 要求跨变体图层名一致，所以第 3.3 条的命名纪律同时也是动效纪律。

### 4.2 层二：MOTION SPEC 表（人 + AI 都读的文本规格）

放在 `04 · Motion` 页，每行一条，格式固定、机器可解析：

```
组件            触发            动画                时长    缓动                       备注
Btn/Play       tap            scale 0.96→1         120ms   cubic-bezier(.34,1.56,.64,1)  spring 回弹
Btn/Play       playing        glow pulse ∞          2400ms  ease-in-out                循环
Lyrics/Line    track time     行切换 fade+slide-up   240ms   cubic-bezier(.16,1,.3,1)    stagger 40ms
Card/Reco      hover          lift y-2 + glow        160ms   ease-out
Panel/Glass    open           蒙层淡入 + 面板 fade-up 240ms   ease-out
Cover/Art      audio          breathing 呼吸缩放      1.4s    ease-in-out               驱动: bass-intensity
Progress/Bar   drag           滑块跟随                实时    linear                    驱动: pointer
```

### 4.3 层三：参数驱动动效（Figma 画不出来的，必须写成 spec）

音频反应类（封面呼吸、光晕脉动、EQ 条）没有输入状态，Figma 无法表达。
在 SPEC 表「驱动」列标注数据源（如 `bass-intensity` CSS 变量），
AI 会把它实现为 CSS/JS 而不是试图从设计稿里"猜"。

### 4.4 先覆盖的核心动效清单（P2 阶段）

1. 播放键 tap 回弹 + playing 态 glow pulse
2. 歌词行进（prev→current→next 滑动 + 左侧条）
3. 卡片 hover lift
4. 面板 open/close（蒙层 + 位移淡入）
5. 进度条 hover/drag 反馈
6. 封面 audio-reactive breathing（参数驱动）
7. 平台徽章激活 glow
8. 按钮 press 缩放（所有 Icon/Button 共用）

---

## 5. 覆盖范围：补齐缺失屏幕

代码端实际有 8 个渲染分支（`.superdesign/init/routes.md`），Figma 只有主视图。补齐：

| 屏幕/模态 | 优先级 | 备注 |
|---|---|---|
| NowPlaying 主视图 | ✅ 已有 | 拆组件后重建为实例组装 |
| 主视图状态变体 | P1 | playing / paused / buffering / no-lyrics / 空库 |
| SourceSelect 选源页 | P1 | 首启全屏页 |
| Search 搜索弹层 | P2 | Modal 壳复用 |
| Liked / Settings / RecoKey / 登录（含 cookie fallback） | P2 | Modal 壳复用，wireframe 级组件化即可 |
| ErrorPanel / 错误态 | P2 | 玻璃壳 + 语义色 |
| 窗口三档尺寸 | P3 | 桌面应用可缩放：1280 / 1440 / 1920 各一 frame，auto-layout 约束正确 |

> 注意：代码端现在是「双视觉世界」（Glass Cosmic 壳 + Monster Beats 主视图皮肤，见
> `.superdesign/init/theme.md`）。AETHER 是新的统一方向，但**壳组件（Titlebar、Modal、SourceSelect）**
> 也要在 Figma 里以 AETHER 视觉建一遍，否则 AI 只能驱动主视图，壳还得手写。

---

## 6. 流程打通：设计稿怎么变成代码

1. **读取**：coding agent 通过 `figma-remote` MCP（`.mcp.json` 已配）或 REST API
   `GET /v1/files/:key` 拉取节点树 + 变量 + styles + interactions。
2. **审计**：检查命名/绑定/组件/动效是否符合本文档规范，输出差异清单。
3. **同步令牌**：Figma variables → `base/_tokens.scss` 的 CSS 变量（按 2.4 映射表），
   或写脚本从变量 JSON 生成 SCSS。
4. **同步组件**：变体 → React 组件 props/状态；命名一致的变体直接映射 `:hover/.active` 等。
5. **实现动效**：按 MOTION SPEC 表逐条实现（CSS transition / animation / RAF 参数驱动）。
6. **闭环**：.superdesign 组件映射持续同步，防止设计↔代码漂移。

---

## 7. 分阶段执行（不要一次全做）

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 · 结构** | 拆 4 个 Page；README frame；全量语义化重命名；变量绑定补全（消灭硬编码 hex） | AI 可审计的文件 |
| **P1 · 组件化** | 提取原子 5 + 复合 6 组件，含状态变体；主视图重建为实例组装；补 SourceSelect + 主视图状态 | 组件库 + 组件化主视图 |
| **P2 · 动效** | 8 条核心动效的变体连线 + MOTION SPEC 表 + storyboard | 动效规格化 |
| **P3 · 补屏** | 全部 modal / 空态 / 错误态 / 三档尺寸 | 覆盖全部代码分支 |
| **P4 · 打通** | MCP/REST 审计脚本化；变量导出 SCSS；双视觉世界收敛；首个 AI 同步试点 | Figma → 代码闭环 |

---

## 8. 执行方式建议

- P0–P1 可以用 `use_figma`（现有 v3 脚本同款管线）半自动执行：脚本创建组件 set、
  批量绑定变量、批量重命名 —— 但**组件变体设计（哪些状态、怎么组合）建议先人工定稿**，
  这决定 AI 后续读到的"语义模型"，不值得让脚本拍脑袋。
- 每个阶段结束用 get_screenshot + 一次 REST 审计验证「AI 视角」下文件是否合格。

## 9. 实现状态（v4 构建包已就绪）

| 文件 | 内容 |
|---|---|
| `scripts/figma-v4-command.md` | 主控指令（喂给 Claude Code 的完整执行手册） |
| `scripts/figma-aether-v4-foundations.js` | SEG0 页面拆分 + SEG1 变量 + SEG2 样式 + SEG3 README |
| `scripts/figma-aether-v4-components.js` | 10 组件集 + 变体 + 组件属性 + Card/Glass 槽位 |
| `scripts/figma-aether-v4-screens.js` | NowPlaying 三态 + SourceSelect，全实例组装 |
| `scripts/figma-aether-v4-motion.js` | 组件原型连线 + 屏幕流转 + MOTION SPEC 表 |
| `scripts/figma-aether-v4-audit.mjs` | REST 审计（`FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit.mjs`；`--fixture` 离线自测） |
| `scripts/figma-v4-typecheck.mjs` | 段代码类型校验（@figma/plugin-typings，改脚本后必跑） |
| `scripts/figma-v4-smoke.mjs` | mock 运行时冒烟（13+1 段顺序执行 + 结构/绑定断言；`FIGMA_FIXTURE_DUMP` 导出审计 fixture） |
| `scripts/figma-aether-v4-snapshot.js` | 只读现状快照（Step 0 与执行后核对） |

执行方式：把 `figma-v4-command.md` 喂给 Claude Code（use_figma 管线），按步骤跑完 13 段，
跑 `audit.mjs` 验收。v3 画布归档到 `99 · Archive` 页，不覆盖旧稿。

**执行状态（2026-08-20）**：✅ v4-ABC 剧场版已重建完成——13 步全执行（motion 连线受平台
限制仅计数），孤儿组件已清理，真实文件 REST 审计 **23/25 通过、0 FAIL、2 SKIP**（变量需带
file_variables scope 的 token 复验；原型连线为平台限制需 UI 手动，清单在命令手册「完成后」节）。
执行中确认的沙箱规则已同步进命令手册与 smoke mock。设计基准：`99 · Archive` 的 AETHER THEATER
三稿（v3 Canvas 已由用户删除，见 docs/aether-theater-v4-spec.md）。

**P0 升级（2026-08-20 下午）**：① SVG 线性图标系统——8 个 lucide 风格图标组件
（Icon/Prev…Icon/Search，stroke 绑定 text-main），Button/Icon 与 Core/Play 的 Unicode 字符
已替换为图标实例 + INSTANCE_SWAP 槽位；② Radius 变量绑定——新增 Radius/10、14（共 7 个），
按钮/徽章/推荐卡/标签圆角全部绑定，Spacing 绑定 itemSpacing；③ Token 导出——
`scripts/figma-export-tokens.mjs` 将变量 dump 生成 `_tokens.generated.scss`（颜色/间距/圆角/
动效 51 个 CSS 变量，spacing/radius 带 px）。审计新增 cornerRadius 绑定与图标检查（32/34）。

**验证补充（2026-08-20）**：49 变量已用只读 use_figma（插件 API）逐组确认（10+17+10+5+7）；
原型连线经 `reactions` 探测确认无法脚本化（NODE action 已废弃，interactions 不可读），
12 条连线为 Figma UI 手动项（清单与参数在命令手册）；Playing 屏幕已做结构性对比验证——
8 个剧场元素全部就位且与基准位置一致。
尚未覆盖（后续阶段）：Modal 类屏幕（Search/Liked/Settings/登录）、1280/1920 尺寸帧、
双视觉世界收敛、变量→SCSS 自动导出。
