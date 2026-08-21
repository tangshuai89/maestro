# Figma v4 落地指令 — AI 驱动设计稿改造（喂给 Claude Code）

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
规范：`docs/figma-driven-frontend.md`（先读它再动手）
构建脚本：`scripts/figma-aether-v4-{foundations,components,screens,motion}.js`
验收工具：`scripts/figma-aether-v4-audit.mjs`（需要 FIGMA_TOKEN）

## 任务

以 **AETHER THEATER（ABC 剧场稿，`99 · Archive` 页）** 为视觉基准，把文件改造为 **AI 驱动设计稿**：
4 页结构（Foundations / Components / Screens / Motion）、全量变量与样式令牌（49 变量 + 11 Text + 4 Effect Styles）、
10 个剧场组件集 + 变体 + 组件属性（星云背景/声环/全息封面/歌词流/能量核心/HUD/环形进度/神经推荐卡）、
MOTION SPEC 表。原型连线受平台限制需 UI 手动完成（见「完成后」节）。

## Step 0 — 现状快照（必须）

1. 跑只读快照段 `scripts/figma-aether-v4-snapshot.js` 的 `SEG1`
   （返回页面/顶层节点/组件集/样式/变量 JSON），向用户汇报现状——文件可能比 v3 脚本
   更新，先确认再动手。
2. 截图当前画布。
3. 确认文件里有 Inter + JetBrains Mono 字体（脚本需要）。

## 执行顺序（每段 = 一次 use_figma 调用，code 参数从对应 JS 文件复制）

| 步骤 | 当前页面 | 脚本段 | 内容 | 完成后验证 |
|---|---|---|---|---|
| 1 | 任意 | foundations `SEG0` | 归档当前页 + 新建 4 页 | 截图 4 页 |
| 2 | `01 · Foundations` | foundations `SEG1` | AETHER 变量集合（primitive/semantic/Spacing/Radius/Motion） | 返回变量数 ≥ 49（primitive 10 + semantic 17 + Spacing 10 + Radius 5 + Motion 7） |
| 3 | `01 · Foundations` | foundations `SEG2` | Text Styles ×8 + Effect Styles ×4 | 样式面板可见 |
| 4 | `01 · Foundations` | foundations `SEG3` | 01 页 README — AI CONTRACT | 截图 README |
| 5 | `02 · Components` | icons `SEG1` | SVG 线性图标 ×8（Icon/Prev…Icon/Search） | 截图图标行 |
| 14 | `02 · Components` | components `SEG1` | Scene/Backdrop + Ring/Sound(2) + Ring/Progress(3) | 截图变体网格 |
| 14 | `02 · Components` | components `SEG2` | Hologram/Cover(3) + Lyrics/Line(3) + Core/Play(4) | 截图 |
| 14 | `02 · Components` | components `SEG3` | Button/Icon(8) + Badge/Platform(8) + Tag/Stat(12) | 截图 |
| 14 | `02 · Components` | components `SEG4` | Card/Neural(2) + Controls/Transport(2) | 截图 |
| 14 | `03 · Screens` | screens `SEG1` | Screen/NowPlaying/Playing（全实例组装） | 截图对比 v3 |
| 14 | `03 · Screens` | screens `SEG2` | Paused + Buffering | 截图 |
| 14 | `03 · Screens` | screens `SEG3` | Screen/SourceSelect | 截图 |
| 14 | `02 · Components` | motion `SEG1` | 组件变体原型连线（Smart Animate） | 原型面板检查 |
| 14 | `03 · Screens` | motion `SEG2` | 屏幕状态流转 + 04 页 MOTION SPEC 表 | 截图 SPEC 表 |

每次 use_figma 调用：`code` 参数 = 对应 JS 文件里该 SEGMENT 的模板字符串内容（不含
`module.exports` 行），脚本本身已含幂等清理与返回节点 ID，直接执行即可。
每步完成后用 get_screenshot 验证；脚本返回的 createdNodeIds 要保留在对话里供后续引用。

> 页面自定位说明：每次 use_figma 调用 currentPage 都会重置回第一页，因此所有段已在
> 脚本内按页面名自定位（`figma.root.children.find(p => p.name === '目标页')`），上表的
> 「当前页面」列仅为执行参考，不需要手动切页。SEG0 已幂等化（99 · Archive 存在则跳过
> 改名，4 页存在则跳过创建），重复执行安全。

## 必须遵守的规则

1. **不要改动 `99 · Archive` 页**（v3 画布原样保留，改造完成后由用户决定是否删除）。
2. **屏幕必须用组件实例组装**（02 页的组件集），禁止在 03 页画"裸"交互元素；
   面板内容放进 Card/Glass 实例的 `Content` 槽位（实例 → findAllWithCriteria SLOT → appendChild）。
3. 变体/图层命名按 README 规范，不得改名（AI 审计按名字找）。
4. 若某段报错：报告完整错误 + 出错的段名，修正后**只重跑该段**（脚本幂等，安全）。
5. 若发现 02 页已存在同名组件集（上次跑过）：脚本会先删后建，旧实例会失效——
   必须按顺序连 screens 一起重跑，不能只跑一半。
6. **改脚本后必跑两道验证**：
   - `node scripts/figma-v4-typecheck.mjs`（@figma/plugin-typings 全量类型校验，含枚举/结构/属性名）
   - `node scripts/figma-v4-smoke.mjs`（mock 运行时冒烟：14 段按真实顺序执行 + 结构/绑定断言）
   全绿才能再喂给 use_figma。

## 沙箱实测规则（2026-08 实弹执行确认，已固化到 smoke 校验）

1. **DROP_SHADOW 必须带 `blendMode: 'NORMAL'`**；LAYER_BLUR/BACKGROUND_BLUR **不接受** blendMode。
2. **`figma.createComponent()` 自动落到 currentPage**（每次调用重置为第一页）——段内必须
   `await figma.setCurrentPageAsync(page)` 后再创建；combineAsVariants 要求所有组件与父节点同页。
3. **componentPropertyReferences 只能在节点已挂入组件树后设置**（先 appendChild，再
   addComponentProperty，再 setReferences）。
4. **`setValueForMode` 只收裸值**：COLOR 传 {r,g,b,a}、FLOAT/STRING 传原始值；仅
   VARIABLE_ALIAS 带 type 字段。`VariableScope` 枚举无 WIDTH/HEIGHT/PADDING_*/ALL_SPACING/ALL_CORNERS。
5. **`PageNode` 无 index 属性**：重排页面用 `figma.root.insertChild(target, page)`。
6. **interactions 无法通过插件 API 写入**（COMPONENT/FRAME/INSTANCE 均无该属性，平台限制）：
   原型连线只能在 Figma UI 原型模式手动完成（见「完成后」节清单）。
7. **INSTANCE_SWAP 属性必须每变体自建**（2026-08 实弹实证）：`addComponentProperty` 返回
   `name#属主ID` 格式的 key，`componentPropertyReferences` 绑定只认**属主组件自己的定义**——
   跨变体复用同一个 key 会静默失败（该变体不生效）。同名属性由 `combineAsVariants` 合并，
   合并后默认值统一取**第一个变体**的值；因此需要"变体间不同默认值"时（如 Core/Play 的
   playing→Icon/Pause），**不要绑定属性**，用实例级 override（`createInstance` 时直接选
   对应组件，mainComponent 天然指向它），其余变体各自 `addComponentProperty` + 绑定。
8. **实例内矢量不随实例 resize 缩放**（已修复）：图标组件用 auto-layout 容器（FIXED 尺寸 +
   CENTER/CENTER）+ SVG 根节点 `layoutSizingHorizontal/Vertical='FILL'`（先 appendChild 再设
   FILL），实例 resize 时容器缩放、矢量等比跟随，天然居中。旧方案（绝对定位矢量 + 脚本
   fitIcon 手动 resize 内部矢量）在属性绑定后会被重置，弃用。

## 执行注意（官方 use_figma 规则，已固化到 smoke 校验）

1. **HUG/FILL 必须后置**：`layoutSizingHorizontal/Vertical = 'FILL'` 只能在节点已挂到
   auto-layout 父节点之后设置，先设即抛错（smoke 的 mock 已强制校验，改代码别踩）。
2. **操作数上限是建议不是硬限**：官方建议每次调用 ≤10 个逻辑操作，但沙箱真实上限是
   50KB（v2 已验证）；本包单段最多 ~60 个节点（v3 同规模跑通过）。若某段报操作数/
   超时类错误，把该段按注释里的分区（如「---- Button/Icon ----」）拆成两次调用重跑。
3. **失败原子性**：use_figma 出错时整段不执行、文件无残留，改后重跑该段即可（脚本幂等）。

## 执行时观察点（mock 验证不了、需在 Figma 里确认的）

1. **Card/Glass 槽位合并**：每个变体各自 `createSlot()`，合并成变体集后应只有 **1 个 Content 槽位属性**。
   若属性面板出现多个 Content（极端情况），手动删掉多余的（保留一个即可，槽位内容共用）。
2. **变体属性顺序**：变体属性顺序由变体名顺序决定（如 `size` 在前 → picker 里 size 组在前），
   与代码 props 顺序一致即可，无需调整。
3. **字体**：`loadFontAsync` 对 Inter / JetBrains Mono 必须成功；若 JetBrains Mono 缺失会报错，
   报错时改用 Menlo 并把脚本里 `'JetBrains Mono'` 全局替换为 `'Menlo'` 后重跑。
4. **原型验证**：motion 段跑完后进入原型模式，点按测试 Button/Play（idle→pressed）、
   Lyrics/Line（prev→current→next）、屏幕间流转（Playing→Paused→Buffering、SourceSelect→Playing）。
   Smart Animate 若出现跳动而非过渡，说明跨变体图层名不一致——报告给我。
5. **歌词卡排版**：screens 段完成后检查歌词卡内内容是否在槽位内正常排布（padding 40/36，
   head 区 `SPACE_BETWEEN`）。内容溢出或错位报告给我。
6. **Controls/Transport 布尔属性**：`shuffleOn`/`repeatOn` 的圆点默认隐藏；在 Figma UI 中
   选中 transport 实例 → 属性面板 → 把两个布尔属性 link 到内部 shuffle/repeat 按钮实例的
   `state=active` 变体（详见「完成后」节）。

## 完成后（验收）

1. 截图 4 页全貌 + 原型播放模式验证：Core/Play hover/pressed、Lyrics/Line prev→current→next、
   Screen Playing→Paused→Buffering 流转。
2. 用审计脚本出报告（需要用户提供 FIGMA_TOKEN）：
   ```
   FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit.mjs
   ```
   全部 PASS 才算完成；FAIL 项按报告修。变量验证可用只读 use_figma
   （figma.variables.getLocalVariables()）替代 REST（后者需 file_variables scope）。
3. 手动收尾（脚本做不了的）：
   - **原型连线 12 条（剧场版）**：进入 02 页原型模式手动拖拽（参数见 04 页 MOTION SPEC 表）：
     Core/Play idle→hover(ON_HOVER 120ms) / idle→pressed(ON_CLICK 100ms)；
     Button/Icon sm/md default→hover(120ms)；Card/Neural default→hover(160ms)；
     Ring/Progress idle→hover(120ms) / idle→dragging(MOUSE_DOWN 100ms)；
     Lyrics/Line prev→current→next(ON_CLICK 240ms)；03 页 Playing→Paused→Buffering、
     SourceSelect→Playing(ON_CLICK 200/240ms)。
     已确认：插件 API 无法写 interactions/reactions(NODE action 已废弃)，仅 UI 可做。
   - 用户确认 ABC 剧场稿视觉无损后，可删除 `99 · Archive` 页（建议保留作基准）。
