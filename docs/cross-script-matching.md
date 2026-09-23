# 跨脚本匹配合并策略（Cross-Script Matching）

> 结论先行：**跨平台元数据的 CJK ↔ 拉丁脚本差异，在两条链路上用两套口径处理**——
> library import 走 `mergeCrossScript`（宽），统一搜索走 `buildUnifiedItems` 的
> opt-in `crossScriptMerge`（严）。搜索侧绝不能复用导入侧的宽口径：搜索结果
> 是全目录密度，宽口径会把同艺人的不同歌误并。
>
> 2026-09-23 落地，修「寂寞，好了」报障：Spotify 明明搜到了却显示缺席、
> Deezer 一行拼音元数据看着很怪。

## 1. 问题形态

平台对同一首歌返回的元数据脚本不同：

| 平台 | title | artist | duration |
|---|---|---|---|
| QQ / 网易云 | `寂寞，好了` | `蔡旻佑` | 372s（演唱会版）/ 346s |
| Spotify | `寂寞，好了` | `Evan Yo` | 346s |
| Deezer | `Ji Mo, Hao Liao`（罗马音） | `Evan Yo` | 342s |

`normalizeKey(title, artist)` 对 CJK 和拉丁元数据产出不同 key → 同一首歌
被拆成多条 item，每条只带一个平台 source。用户视角：「Spotify 没搜到」
（SP chip 在另一条独立行上）+「Deezer 显示拼音很怪」（它独占一行，没合进
CJK 主条目）。

## 2. 两套口径与边界

| 链路 | 入口 | 口径 | 为什么 |
|---|---|---|---|
| Library import | `mergeLibrary` → `mergeCrossScript` | 宽：标题「一边 CJK 一边拉丁」即可进候选，艺人/时长再佐证 | 导入的是用户自己的❤列表，候选集小（已按艺人聚合），误并代价可控 |
| 统一搜索 | `searchUnified` → `buildUnifiedItems({crossScriptMerge:true})` | 严：同 versionType 内「标题同义 + 艺人可桥 + 时长任一对 ≤30s」三项全过才并 | 搜索结果是全曲库密度——搜艺人名时同艺人几十首歌同框，宽口径必然误并 |

**边界纪律**：搜索侧是 opt-in 参数，不传 `crossScriptMerge` 的调用方
（含 library import 路径）行为完全不变。两套口径并存是有意的——不是
「搜索忘了用宽合并」，而是「宽合并在搜索里是错的」。

## 3. 搜索侧证据规则（`groupMergeEvidence`）

分组阶段仍按 `(normalizeKey, versionType)` 建组，之后 union-find 做组间
合并。三组证据全部满足才并（判定按成本升序）：

1. **versionType 相等**：live 不并 studio，边界不破坏。
2. **时长**：任一对 track `|Δ| ≤ 30s`
   （`DIFFERENT_VERSION_DURATION_TOLERANCE_SEC`，跨平台同歌不同 master
   的 intro/outro 差异常到 15-25s）；两侧时长全未知（≤0）时放行。
3. **标题同义**（三选一）：
   - `displayKey` 相等（同脚本已归一）；
   - `titleAliasMatch` 命中策展别名表（`@maestro/common`）；
   - **真跨脚本**（一侧 CJK 一侧拉丁）且 `titleTransliterationMatch`
     音译相等。
4. **艺人可桥**：`artistLooseMatch`（别名表，如 蔡旻佑↔Evan Yo）或
   `artistTransliterationMatch`（拼音/kuromoji 音译）。

并组后 entries 进原有 `clusterByDuration` 流水线——同录音跨平台源自然
落到同一 version cluster（Deezer 342s 与 QQ 342s 并成一个 version 的
两个 source），canonical 选取逻辑不变。

## 4. 标题音译实现（`titleTransliterationMatch`）

`translit.ts` 新增，口径刻意比艺人音译严：

- **多音字展开**：pinyin-pro 词级消歧给「寂寞，好了」→ `jimohaole`，但
  平台元数据常按另一读音罗马化（Deezer → `Ji Mo, Hao Liao`）。逐字
  `multiple:true` 拿全读音做笛卡尔积，上限 4 读音/字 × 24 变体防爆炸，
  进程级 memoize。
- **日文路线**：kuromoji(cn2t) 读音，覆盖 `花火 ↔ Hanabi`。
- **只认整串相等，不做 includes**：标题 containment 会把 `Song` 并给
  `Song II`、`Super` 并给 `Superstition`（同艺人 + 时长撞上就误并）。
  艺人名加后缀是常态、标题加词基本是另一首歌，两类不同口径。
- **只对真跨脚本启用**：CJK↔CJK 同音异形（`异地 ↔ 一地`）不并——
  同拼音不等于同一首歌。

## 5. 反面案例（设计护栏的由来）

| 案例 | 宽口径会怎样 | 证据规则结果 |
|---|---|---|
| `我可以`(蔡旻佑) ↔ `Death of Me`(Evan Yo)，时长 273s/265s | 裸 isCrossScript + 别名表艺人命中 → 误并 | 标题音译对不上 → 不并 ✅ |
| `寂寞，好了` 蔡旻佑 ↔ 同名 陈粤彬（翻唱） | 标题相等 + 时长近 → 若忽略艺人则误并 | 艺人别名/音译都对不上 → 不并 ✅ |
| 別の人の彼女になったよ 翻唱链（wacci/铃木爱理/Lefty Hand Cream） | 历史事故：CJK 名当桥传递性并入 | `artistTransliterationMatch` 硬门（library-import tasks #25 起） |
| `异地` ↔ `一地`（同音异形） | 拼音相等 → 若对同脚本启用音译则误并 | 音译仅跨脚本 → 不并 ✅ |
| `Song (Live)` ↔ `Song` 跨脚本 | 标题音译可过 | versionType 不等 → 不并 ✅ |

## 6. 已知局限（安全侧漏并，不修）

- **纯翻译名桥不了**：`海阔天空 ↔ Boundless Oceans`——无语义翻译算法，
  漏并比误并安全。
- **单汉字日文名**：`恋 ↔ Koi` 在 kuromoji 下读不出——如需覆盖走
  `titleAlias` 策展表补条目。
- **kuromoji 冷启动**：词典加载 ~1s，`searchUnified` 起手
  `void warmupJa()` 与平台搜索并行预热；未就绪时日文路线降级为空，
  拼音/别名表不受影响。
- **日文姓名顺序颠倒 / 不规则读音艺名**（Ayumi Hamasaki、Kenshi
  Yonezu）仍桥不了——与 library 侧同局限，真解要 JMnedict 人名库，
  成本远超收益。

## 7. 代码与测试指针

- `packages/server/src/music/translit.ts` — `titleTransliterationMatch` /
  `romanizeTitleVariants` / `artistTransliterationMatch`
- `packages/server/src/music/search.util.ts` — `BuildUnifiedItemsOptions` /
  `groupMergeEvidence` / `buildUnifiedItems` 的 union-find 段
- `packages/server/src/music/music.service.ts` — `searchUnified` 开关位
- `packages/common/src/artistAlias.ts` / `titleAlias` — 策展别名表
- 测试：`search-crossscript-groups.test.ts`（8 用例，含开关关闭回归
  护栏）、`cross-script-merge.test.ts`、`translit.test.ts`、
  `cross-platform-match.e2e.test.ts`
- 历史决策：`specs/library-import/tasks.md` #24/#25/#28、
  `specs/unified-search/tasks.md` #21
