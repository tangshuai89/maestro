# 自然语言歌单（NL playlist，DeepSeek）

> **状态**：✅ 已完成并合入 `master`（tasks 全部勾完）。文档保留作实现依据。
>
> ⚠️ **2026-10-20 补丁**：本 spec 落地时"Intent 只是约束"（见 §不做什么），
> 结果「来点儿爵士乐」给出的是 12 首大流行——**检索层没有风格维度**。
> 该设计已被 `specs/nl-intent-retrieval/` 取代（意图改为驱动检索层）。
> 本文保留原始决策记录，涉及检索的部分以新 spec 为准。

## 做什么

在播放器里输入一句人话（"放点适合夜跑的电子乐"），自动生成可播队列。
W3 spec-first 落地：先钉死意图 schema 与接口，再写实现。复
`specs/reco-deepseek` 的 DeepSeek 集成、跨平台 `specs/cross-platform-likes` 跨平台
匹配、`specs/shadcn-migration`（PR #92）刚合入的 shadcn 组件做 UI。

## 产品概念

### 一句话定义

**NL 歌单 = 把"筛选器"换成"一句话"的歌单创建入口。**

产品价值很实在：传统歌单入口要求用户**先知道分类法**（流派叫 post-rock 还是
后摇？语种选哪个？），NL 让用户直接说**场景和状态**（"适合夜跑"、"下雨天窝着"），
表达成本从"会分类"降到"会描述"。

但这个概念里藏着一个隐含前提，恰恰是最容易翻车的地方：

> **意图必须真的改变结果。** 用户说"爵士"，队列里就得是爵士 —— 而不是"爵士味的流行"。

### 三条实现路径（为什么 demo 大多是空壳）

| 路径                           | 做法                                              | 实际结果                                     |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| **A 关键词直搜**               | 把"来点爵士"当搜索词发给平台                      | 命中一堆歌名带"爵士"的怪歌，噪音大           |
| **B 纯生成**（主流 demo 路线） | 意图 + 口味库塞进 prompt，LLM 凭记忆列歌名        | 封面图惊艳，点开有编的歌、风格靠猜、还搜不到 |
| **C 意图驱动检索**             | 意图 → 流派代表艺人 → 平台真实目录 → LLM 只做策展 | 慢几秒，但每首可播、风格真的对               |

**demo 与"真能用"之间差的就是检索层** —— 演示里看不见这一层，因为检索层不产生画面。
（B 路线最容易做出好看的截图：LLM 直接给你 20 个"爵士味"的名字。真实用户点开第一首
发现是《起风了》就流失了。）

### 完整闭环（六步）与本项目现状

| 步骤       | 作用                                      | 现状                                             |
| ---------- | ----------------------------------------- | ------------------------------------------------ |
| 1 表达     | 一句话输入，零门槛                        | ✅                                               |
| 2 理解     | 结构化意图：流派/情绪/语言/年代/排除/数量 | ✅ `parse-intent`                                |
| 3 **检索** | **意图 → 真实可播目录**                   | ✅ `specs/nl-intent-retrieval/`（2026-10-20 补） |
| 4 策展     | LLM 只做挑选/排序/理由，不负责"发明"      | ✅ select 模式                                   |
| 5 反馈     | 点"不喜欢"立刻生效                        | ✅ 跳过/踩过信号                                 |
| 6 迭代     | 多轮："再来点更快的"、"不要周杰伦"        | ❌ 未做（留 v2）                                 |

### 与 AI 推荐（普通「✨推荐」）的关系

两者**互补**，不是替代：

- **AI 推荐 = 隐式画像** —— 系统猜你喜欢什么（你库里的陈奕迅、汪苏泷）
- **NL 歌单 = 显式意图** —— 你说这次要什么（爵士）

原则：**显式意图优先于隐式画像**。intent 模式下私人 FM 被排除在候选池之外，
因为 FM 本质就是"你的隐式画像"，它与"我这次要爵士"直接冲突。

### 怎么知道它变好了没有

风格纯度评测（`specs/nl-intent-retrieval/` §度量）：三个指标
——检索层种子覆盖、策展层流派纯度、口味污染率。CLI：`npm run reco:eval:genre`。

## 验收标准

- [ ] 输入一句自然语言 → 数秒内生成 ≥10 首可播队列，风格 / 语言 / 年代与描述吻合（C1 e2e 待验）
- [ ] "排除 X""更多像 Y"等约束能体现在结果里（见 §数据模型 Intent schema；C2 e2e 待验）
- [x] 无 DeepSeek key → 走 `specs/reco-deepseek` 既有 428 友好提示（打开 RecoKeyModal）
- [x] 429 / 5xx → fail loud + UI 提示，不静默吞
- [x] LLM 输出非 JSON / 字段缺失 → 报错并保留 raw 给 debug
- [x] 生成的队列可一键存为本地歌单（持久化到 `state.json` 的 `playlists:{sessionId}` key）
- [x] 输入入口在 lite 模式 ✨ 按钮 + theater 模式搜索框上方入口（均用 shadcn `Dialog` + `Textarea`）
- [x] 生成的队列覆盖当前播放队列时给"会清空当前队列"确认弹窗；也可选「追加到队列」

## 数据模型

### Intent schema（DeepSeek 强约束 JSON 输出）

```ts
interface NLIntent {
  mood: string; // 自由文本 ≤ 50 字
  genres: string[]; // 0–6 个
  tempo: 'slow' | 'medium' | 'fast' | 'any';
  language: 'zh' | 'en' | 'ja' | 'ko' | 'any';
  era?: { from?: number; to?: number }; // 发行年份范围
  similar_artists: string[]; // 0–4 个（"更多像 X"）
  similar_tracks: string[]; // 0–4 个（"类似这首歌"）
  exclude_artists: string[]; // 0–8 个（"排除 X"）
  exclude_genres: string[]; // 0–4 个
  target_count: number; // 8–20，默认 12
  /** 解释给用户看：「我理解你的需求是 ...」 */
  rationale: string; // ≤ 80 字
}
```

### Playlist（持久化）

```ts
interface Playlist {
  id: string; // crypto.randomUUID()
  name: string; // ≤ 60 字（用户可改名）
  tracks: UnifiedSearchItem[]; // 与 LibraryItem 同结构
  source: 'nl' | 'manual';
  prompt?: string; // NL 创建时保留 intent / 原始 prompt（debug + 一键再生）
  createdAt: number; // epoch ms
  updatedAt: number;
}
```

存储：`StorageService` 里 `playlists:{sessionId}` key（落在 `.storage/state.json`，
与 `library:{id}` 同层按 session 隔离；沿用 StorageService 的 debounce 写盘）。

## 接口规格

### 后端（NestJS）

```
POST /reco/parse-intent
Request:  { text: string; }
Response: { intent: NLIntent; raw?: string }
Errors:
  400  text 为空 / 超过 500 字
  428  没设 DeepSeek key（沿用 reco 的 PRECONDITION_REQUIRED 路径）
  429  上游 rate-limit
  502  上游 5xx / JSON 解析失败（响应仍带 raw 给 debug）
```

```
POST /reco/run  （扩展既有端点，向后兼容）
Request:
  { count?: number;
    language?: 'zh'|'en'|'ja'|'auto';
    mood?: string;
    /** NL 路径：传 intent 后跳过 parse-intent、直接进搜索回填 */
    intent?: NLIntent;
    /** 排除项（NL 路径或手动） */
    exclude_titles?: string[];
    exclude_artists?: string[];
  }
Response: { items: UnifiedSearchItem[]; model: string; runAt: number; }
Errors: 同既有 + intent 字段 schema 校验失败 400
```

```
POST /library/playlists
Request:  { name: string; tracks: UnifiedSearchItem[]; prompt?: string; source?: 'nl'|'manual' }
Response: Playlist
Errors:  400 name 非法 / tracks 为空

GET    /library/playlists           → Playlist[]（按 updatedAt 倒序）
GET    /library/playlists/:id       → Playlist
DELETE /library/playlists/:id       → { ok: true }
PATCH  /library/playlists/:id       → Playlist（改 name / append / remove）
```

## UI 行为

入口：

- **lite 模式**：✨ 按钮复用 —— 点开 shadcn `Dialog` 弹 NL 输入
- **theater 模式**：search 框上方一个 `✨` 按钮入口（不破坏 theater 视觉）

弹窗（shadcn 组件）：

- `Textarea` 自由文本输入（autoFocus，placeholder 给出 3–5 个示例）
- `Button` "生成" 触发 → 显示 loading（disable + spinner）
- 解析结果：`Card` 列表显示 `UnifiedSearchItem`，点击单首立即播（沿用 SearchPanel 行为）
- "覆盖当前队列 / 追加到当前队列" 切换；覆盖且当前队列非空 → 先弹确认 Dialog
- "保存为歌单" 按钮（弹 secondary `Dialog` 填名字 → `POST /library/playlists`）

错误提示：modal 内联错误条（不静默）；428 额外打开既有 `RecoKeyModal`。

## 状态缓存

不额外缓存 intent 解析结果（一次性，2s 内出）；reco 结果走 `reco-deepseek` 既有 dedup seen 集。
Playlist 列表落 `state.json` 的 `playlists:{sessionId}` key（沿用 StorageService 的内存缓存 + 200ms debounce 写盘）。

## 不做什么

- ❌ 语音输入（spec §范围外，留 v2）
- ❌ 多轮对话（一次性 NL → 队列；不记忆上下文）
- ❌ 实时流式输出（DeepSeek 普通模式一次性返回）
- ❌ 歌单编辑 UI 完整版（仅 PATCH name + 增删曲目；复杂排序 / 拖拽留 v2）
  > ✅ **已被 `specs/playlist-edit/` 接手并交付**（2026-10-25）：改名 / 加歌 /
  > 移除单曲 / 播放全部 + 歌单管理弹窗。**仍然不做**的是：曲目排序 / 拖拽、
  > 歌单封面、歌单分享 / 导出、批量操作。
- ❌ 跨设备同步歌单（本地 storage，不上传）
- ❌ 把 Intent 解析拆成多 LLM 调用（一次解析到位）
- ❌ LLM 选曲（仍由 DeepSeek 在 prompt 里给 `{title, artist}[]`，
  本 spec 不替代 reco-deepseek 的"选曲"环节 —— Intent 只是约束）
  > ⚠️ **已被 `specs/nl-intent-retrieval/` 推翻**：当候选池是硬目录约束时，
  > "Intent 只是约束"等于没有约束（LLM 面前 40 首全是流行，它变不出爵士）。
  > 现在 Intent 驱动**检索层**（流派 → 代表艺人 → 平台真实目录）。

## 技术约束

- Intent 解析一次 LLM 调用即可，不串联（避免 token 翻倍 + 延迟翻倍）
- 强约束 JSON：prompt 里要求 LLM **只输出 JSON**（用 `<json>...</json>` 包裹 + 解析）；
  解析失败保留 raw，状态码 502
- Prompt 模板里**带库上下文**（前 50 首 ❤ 库作为"用户偏好锚点"），防止 token 爆炸
- `target_count` 上限 20；超过自动 clamp
- rate limit（429）走与 `specs/reco-deepseek` 一致的退避 + UI 提示
- UI 全部用 shadcn 组件（PR #92 刚合入）—— 是"用了再迭代"的良性循环
- 命名空间严守 `sh-` 前缀（见 `specs/shadcn-migration/spec.md` 修复 commit 笔记）

## 文件改动清单

### 新增

- `packages/server/src/reco/nl-intent.ts` — prompt 模板 + JSON 解析 + 重试
- `packages/server/src/reco/nl-playlist.controller.ts` — POST /parse-intent + POST /library/playlists 系列
- `packages/server/src/library/playlist.service.ts` — Playlist 增删改查（StorageService 上）
- `packages/renderer/src/components/modals/NLPlaylistModal.tsx` — shadcn Dialog
- `packages/renderer/src/components/ui/textarea.tsx` — shadcn Textarea（CLone 源码）
- `specs/nl-playlist/tasks.md`

### 改动

- `packages/server/src/reco/reco.controller.ts` — `reco.run` 加 intent / exclude_* 字段 + schema 校验 400
- `packages/server/src/reco/reco.service.ts` — intent 折进 select/generate 两条路径 + 排除艺人硬过滤
- `packages/renderer/src/components/search/SearchPanel.tsx` — 加 ✨ 入口（theater）
- `packages/renderer/src/components/mini/MiniPlayer.tsx` — lite 模式 ✨ 入口
- `packages/renderer/src/hooks/usePlayer.ts` — `appendToQueue`（追加模式）
- `packages/renderer/src/hooks/usePlaylist.ts`（新） — 拉 / 存 / 删 / 改

### 不动

- 既有 `reco.run` 在没传 `intent` 时行为完全不变（向后兼容）
- 既有 library 数据结构

## 排期（commit 切分）

| #      | 内容                                                             | 估时                     |
| ------ | ---------------------------------------------------------------- | ------------------------ |
| 1      | `parse-intent` controller + service + prompt 模板 + 单测         | 0.5d                     |
| 2      | `reco.run` 扩展（intent / exclude_* 字段）+ 回归                 | 0.5d                     |
| 3      | `Playlist` 数据模型 + storage + 4 个 CRUD endpoint + 单测        | 0.5d                     |
| 4      | shadcn `Textarea` 复制 + `NLPlaylistModal`（Dialog） + ✨ 入口   | 1d                       |
| 5      | `usePlaylist` hook + 歌单列表 UI（最简版）                       | 0.5d                     |
| 6      | prompt 调试（5–10 个真实场景调一遍） + e2e（输入 → 队列 → 播放） | 1d                       |
| **总** |                                                                  | **4d** / 6 commit / 1 PR |

## 风险

- LLM 输出的 genres / similar_artists 常是英文（"Chinese indie folk"），reco 的统一搜索
  能否命中？—— 经验上"中文优先 + 英文辅助"已经在 reco 既有 prompt 里跑通，本 spec 复用同一
  搜索链路，问题不大。fallback：若 5 次内搜索命中 < 5 首，二次 LLM 调用放宽约束。
- 用户输入超长（500+ 字）→ 422 / 400，前端 `Textarea` `maxLength={500}` 强制。
- DeepSeek 解析偶发输出非 JSON（实测 ~1%）—— 保留 raw 字段 + 502 状态码。
- Playlist 命名冲突（同名重复）—— 自动追加 `-2` `-3`，不让用户卡住。
- 首次 import 用户库时 prompt 没库上下文 → 退化为"通用"推荐，不报错（与 reco 行为一致）。

## 相关文档

- `specs/nl-intent-retrieval/` — **意图驱动检索**（2026-10-20 补丁：意图作用在检索层）
- `specs/reco-deepseek/` — LLM 集成 + 跨平台搜索回填链路
- `specs/cross-platform-likes/` — UnifiedSearchItem 跨平台匹配
- `specs/shadcn-migration/` — UI 组件来源
- `CLAUDE.md` / 仓库根 `AGENTS.md` — 工程约束（按钮 / API 风格 / 文件位置）
