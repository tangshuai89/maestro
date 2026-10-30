# 把 AI_CONTRACT 段写回设计稿 —— 操作指引

> 关联：`specs/figma-diff/spec.md` §10 · `scripts/figma-write-plugin/` · `scripts/figma-contract-payload.mjs`
>
> 这份指引是**给人照着做**的，不是给 agent 读的。

> **2026-10-30 当前状态**：首轮写入已经完成，Figma 里 **50/50 节点都有 AI_CONTRACT 段**。
> 当前重新生成的 payload 是 **0 条待写**。如果你沿用上一版 payload 再跑一次，
> 会看到 **应用 0 · 跳过 34 · 失败 0** —— 这也是成功，原因是 34 条都已被幂等跳过，
> 不是 nodes 找不到或字体失败。完整 skip reason 在插件 console。

---

## 一句话

**不用等 Figma 席位升级。** 用「本地开发插件」把契约草案写进设计稿 ——
插件的写入权限是**你自己对该文件的编辑权**，不看套餐、不看席位，也不吃 MCP 配额。

---

## 前置条件

| #   | 条件                                    | 为什么                                                    |
| --- | --------------------------------------- | --------------------------------------------------------- |
| 1   | **Figma 桌面 App**（不是浏览器版）      | 「Import plugin from manifest」要读本地文件，浏览器读不到 |
| 2   | 你对 AETHER 文件有**编辑权**            | 插件以你的权限写；文件是 view-only 就写不进去             |
| 3   | 当前处于 **Design 模式**，不是 Dev Mode | Dev Mode 是只读检视视图，插件的写操作直接返回错误         |
| 4   | 仓库里的产物是**最新的**                | `npm run figma:payload:check` 会验证这一点                |

> **Dev Mode 怎么切**：Figma 顶部工具栏的模式切换，或按 `Shift+D`。
> **`Shift+D` 是双向开关**，不是单向入口 —— 按过头会切到 Dev Mode 又切不回来，得点工具栏。

---

## 三步

### 第 1 步 · 生成产物

```bash
npm run figma:payload
```

输出三样东西：

- `scripts/figma-contract-payload.json` —— 待写清单（机器可读）
- `scripts/figma-write-plugin/code.js` —— 插件产物（payload 内联在这里）
- **终端里的审阅报告** —— 逐节点列出「哪个字段是从哪来的」

**先看报告再写进设计稿。** 报告里有两节要你亲自过目：

- 「⚠️ 这 N 个组件的 a11y 是**按名字语义推断**的」—— 设计稿上本来就没规定无障碍语义，
  这里给的是按名字该有的最小角色约定，`keyboard` 一律留空（键位是真正的设计决定，猜错代价大）。
- 「⚠️ 这 N 个组件指向的文件在仓库里还不存在」—— 它们就是 `figma:diff` 会报的 **must**，
  意思是「前端该建这些组件」。

### 第 2 步 · 导入插件

1. 打开 **Figma 桌面 App**
2. 菜单 **Plugins → Development → Import plugin from manifest**
3. 选 `scripts/figma-write-plugin/manifest.json`
   （仓库根目录是 `/Users/tangshuai/maestro`，完整路径：
   `/Users/tangshuai/maestro/scripts/figma-write-plugin/manifest.json`）
4. 导入成功后，**Plugins → Development** 菜单里会出现 **AETHER Contract Writer**

> ⚠️ 选不中文件？多半是选了 `plugin.src.js`。**必须选 `manifest.json`**。
> ⚠️ 插件不能发布到社区也能用 —— 本地开发模式不需要审核。

### 第 3 步 · 跑

1. 打开 **AETHER 文件**（fileKey `FtbRZXvzlCp4Sq9e322cQQ`）
2. 确认处于 **Design 模式**
3. **Plugins → Development → AETHER Contract Writer**
4. 看右上角通知：应用数 = payload 的待写数；跳过数 = 已在画布上的契约数
5. 插件的完整报告在 Figma 的 **console**（开发者工具）里

**重复跑是安全的**：生成器只产出「还没有契约段」的节点，插件运行时再查一次载体 ⇒
不会覆盖已有契约、不会叠加。
（判「有没有契约段」的口径 = **能否提取出 `---` 包裹的段**，与采集段**同一份实现** ——
不是「文本里有没有 `AI_CONTRACT:`」这个关键词。后者会把散文里顺口一提当成「已写过」。）

> 当前已收口：payload 是 **0 条待写 / 50 条已有契约**。重新导入最新 `code.js` 后，
> 正常重复运行应显示 **应用 0 · 跳过 0 · 失败 0（共 0 条待写）**。
> 若仍在旧 payload 下看到 **应用 0 · 跳过 34**，说明 34 条都已写入，同样正常。

**已有人工写的描述不会被抹掉**：插件是**合并**而不是覆盖 —— 契约段加在前面，
你写的散文原样保留在后面。（21 个组件本来就有散文描述，这是最容易出事的地方。）

---

## 跑完之后

```bash
# 1. 重跑采集（用采集插件，零配额）—— 见下面「采集：把 Figma 现状读成快照」
#    → 产出新的 scripts/figma-snapshot.json
# 2. 重新生成草案（快照变了，草案要跟上）
npm run figma:payload

# 3. 看差异清单 —— 契约附注应消失，components / screens 覆盖率应到 35/35、15/15
npm run figma:diff
```

> ⚠️ **第 1 步必须做**：不重跑采集，`figma:diff` 读的还是旧快照，
> 看不到新写的契约 —— **现场看不出任何异常**（这就是 `--check` 那条腿存在的原因）。

---

## 采集：把 Figma 现状读成快照

> 快照是 `figma:diff` 的**唯一输入**。它不新鲜，后面所有结论都是错的 —— 而且看不出异常。

### 用采集插件（零配额，推荐）

```bash
# 1. 先起接收器（另开一个终端；它会把插件发来的 JSON 校验后直接落盘）
npm run figma:collect:serve
#    ⇒ 监听 http://localhost:4771/snapshot，落盘 scripts/figma-snapshot.json

# 2. 导入插件（只需一次）
#    Figma 桌面 App → Plugins → Development → Import plugin from manifest
#    选 scripts/figma-collect-plugin/manifest.json（**不是** plugin.src.js）
# 3. 打开 AETHER 文件 → Design 模式 → Plugins → Development → AETHER Snapshot Collector
#    通知会直接报数字：组件 N · 屏 M · 带契约段 X/N
#    （X = N 说明契约全写进去了；X = 0 说明一条都没写进去）
#    末尾会写「—— 已落盘 scripts/figma-snapshot.json」⇒ **不用再手动复制**
```

> ⚠️ 插件是**只读**的：不创建 / 不修改 / 不删除任何节点，跑多少次都安全。

### 为什么是「插件 → 本机接收器」，不是剪贴板

2026-10-30 实测：桌面 App 里 `figma.clipboard.writeText` **直接失败**
（通知：「剪贴板写入失败，请从 console 复制 JSON」）⇒ 落盘链路断在最后一步。

- 不是 manifest 权限问题：官方 `PluginPermissionType` 枚举里**没有任何 clipboard 项**
  （只有 `currentuser` / `activeusers` / `fileusers` / `payments` / `teamlibrary`）。
- 官方明确支持的另一条路是**本地开发服务器**：
  `networkAccess.devAllowedDomains` 可以写 `http://localhost:<port>`
  （官方原文：「During development, the plugin can access a local/development web server」）。

⇒ 插件把 JSON POST 给 `scripts/figma-snapshot-receiver.mjs`，它**校验后直接落盘** ——
零配额、零人工。三条路依次降级：**接收器 → 剪贴板 → console**，通知里会写明走通了哪条。

接收器的边界：

- **只接受回环请求**（双栈监听以兼容 `localhost` 的两种解析结果，
  再用回环白名单把局域网请求挡掉 ⇒ 不开局域网口子）；
- **先校验后写**（counts 与数组长度自洽 / capturedAt 是带时区 ISO / 节点有 name·nodeId·type）
  ⇒ 脏数据**不会**覆盖仓库里那份好快照；
- 「临时文件 + rename」原子落盘 ⇒ 写到一半崩了也不留半个坏 JSON；
- 输出走 **prettier** ⇒ pre-commit 钩子不会再改写它（不产生无关 diff）。

> 端口的**单一事实源**是 `scripts/figma-snapshot-receiver.mjs` 的 `DEFAULT_PORT`；
> 插件产物与 `manifest.json` 里的域名/端口由 `npm run figma:collect:check` 断言一致
> ⇒ 端口漂移会**报错**，不会产出一个连不上的插件。

### 为什么不用 MCP 的 `use_figma`

`use_figma` **吃套餐配额**（Starter / View / Collab **20 次/月**）⇒ 每采一次就少一次。
采集插件的权限 = **你自己对该文件的编辑权** ⇒ **零配额**、零外部网络（只连本机）。
（与写入插件同一条路，已实测跑通。）

### 采集段只有一份实现

插件里跑的采集逻辑 = `scripts/figma-snapshot-seg.js` 的 **SEG1**，由
`npm run figma:collect` 内联进插件产物（`scripts/figma-collect-plugin/code.js`）。
`npm run figma:collect:check` 保证产物与 SEG1 同步 ——
**SEG1 改了但插件没重生成 ⇒ 插件采到的口径与仓库里的不一致 ⇒ 快照不可信**。

契约段的提取走**共享实现**（`scripts/lib/figma-contract-section.js`），
与**写入插件同源** ⇒ 写进去的段，采集端必定提得出来（写→读闭环）。
`npm run figma:collect:test` 用 mock 的 Figma API 真跑一遍插件验证这件事。

---

## 出问题怎么办

| 症状                                 | 原因                                             | 修法                                                    |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| 通知说「应用 0 · 跳过 N」            | 节点都已有契约段（幂等命中）                     | 正常。若预期该写，检查报告的 skipped 原因               |
| 通知说「失败 N」                     | 看 console 的 error                              | 多半是字体加载失败（文档里没有可加载的字体）            |
| 什么都没发生、也没通知               | 插件没跑到，或在 Dev Mode                        | 确认 Design 模式；确认 Plugins → Development 菜单里有它 |
| 找不到节点（node-not-found）         | 快照的 nodeId 与当前文件对不上（设计稿被重建过） | 重跑采集拿新 nodeId，再重新生成草案                     |
| `npm run figma:payload:check` 报过期 | 快照更新了但草案没重新生成                       | 跑 `npm run figma:payload`                              |
| 导入插件时报 manifest 解析失败       | 选错文件了                                       | 必须选 `manifest.json`，不是 `plugin.src.js`            |

> **插件跑完怎么确认写对了**（别只看通知）：
> 通知只告诉你「应用了几条」，不告诉你**内容对不对**。
> ⚠️ `npm run figma:payload:check` **不能**证明这一点 —— 它只比对
> 「仓库里的产物」与「仓库里的快照」是否同步，**跟 Figma 里实际写了什么无关**。
> 快照没更新时它照样绿（典型的假绿）。
> ⇒ 真正的自查只有一条：**重跑采集**，看新快照里那些节点的 `contract` 字段有没有内容，
> 再跑 `npm run figma:diff` 看契约附注是否消失。
> 想逐条看内容 ⇒ 用 Figma 的 Dev Mode 或直接看节点的 description。

---

## 边界（重要）

- **插件只写「还没有契约段」的节点** ⇒ 它**不会**修正已有人工契约里写错的内容。
  要改已有契约，得先在 Figma 里手动删掉旧的契约段，再跑一次插件。
- **但已有的人工描述会被保留** ⇒ 契约段加在**前面**，你写的散文原样留在后面。
  （插件是「合并」不是「覆盖」—— 这条是 2026-10-29 修掉的 P0，
  原来的写法会把 21 个组件的设计文档直接抹掉。）
- **草案不是权威** ⇒ 整段带 `draft: true`，且 `provenance` 标注了每个字段的来源。
  落地后应该**人工审阅**再当设计契约用。
- **2026-10-30 起没有“无 react 归属”节点**：50 条 Code Connect 映射覆盖
  **35/35 组件 + 15/15 屏幕**；首轮写入后快照确认为 **50/50 已有契约**，
  当前 payload 为 **0 条待写 / 50 条已有契约跳过**。
  覆盖率由 `figma-code-connect-validate.mjs` 守，新增设计节点但没补映射会直接红。
- **插件本体已在真实 Figma 桌面端跑过**（2026-10-30）：34 个目标节点全部存在，
  34/34 都能提取出 `AI_CONTRACT:` 段，且实际内容与 payload 逐条哈希一致。
  再次运行的 `应用 0 · 跳过 34` 是幂等成功。
