# 跨平台 track 匹配引擎

## 做什么

给定一首 track（来自某个平台），找到它在其他平台上的等价版本。
这是「统一搜索」「Heart fan-out」「liked 导入」「统一库聚合」的共同基础。

具体要解决的子问题：
1. **库聚合**：把 QQ + 网易云 + Deezer 各自的"我喜欢的歌"汇成一张去重后的统一库
2. **跨平台播放回退**：用户在 QQ 上选了一首歌播放，QQ 拉流失败 → 自动找网易云/Deezer 的等价版本顶上
3. **Heart fan-out 升级**：P1 阶段的 fan-out 只覆盖"用户搜出来的同次结果"，有了匹配引擎后可以在更大范围内 fan-out

## 验收标准

- [x] 给定一个 Track，提供"在其他平台找等价"的方法（`findEquivalent`）
- [x] 给定一批 Track（多平台），合并去重为统一库（`mergeLibrary`）
- [x] 去重键 = `normalizeKey(title, artist)`，duration 差 ≤3 秒视为同一首（防止现场版/混音版被合并）
- [x] 完全相同 normalizeKey 但 duration 差 >3 秒 → 不合并（视为 remix/live）
- [x] 匹配失败回退：search 不返回结果时不阻塞整体（`withTimeout` 5s + try/catch 隔离）
- [x] 匹配结果有置信度字段 `confidence: 'exact' | 'fuzzy' | 'none'`，UI 可选展示
- [x] `MatchResult` 含 `scores` 字段（`Partial<Record<MusicProvider, number>>`）：strict 命中 = 1.0，fuzzy 命中 = jaroWinkler 分数（0.88..1.0）
- [x] 多阶段 fuzzy fallback：strict normalizeKey → alt-strict（剥括号内容，0.95）→ JW (≥0.88) → normalized Levenshtein (≤0.1)
- [x] 长度差硬门（|seedLen-candLen|/max > 0.15）→ 跳过 fuzzy（防止 "(Live)" 等版本标签误并）

## 接口规格

### 内部 service（不暴露 HTTP）

```ts
// packages/server/src/match/match.service.ts
export class MatchService {
  constructor(
    private qq: QqMusicProvider,
    private netease: NeteaseMusicProvider,
    private deezer: DeezerMusicProvider,
  ) {}

  /**
   * 把多平台的 tracks 合并成统一库。每个输入 track 必须有 provider / id /
   * title / artist / duration。用 normalizeKey 去重。
   */
  mergeLibrary(tracks: Track[]): UnifiedSearchItem[];

  /**
   * 给定一个 seed track，去其他平台找等价。
   * 多变体查询（V1: title+artist；hook 留给 V2/V3）→ 每个变体 top-5 → 跨变体聚合 →
   * duration gate → strict normalizeKey 相等 → 缺失时 fuzzy fallback（JW ≥ 0.88
   * 且长度差 ≤ 15% → alt-strict 0.95 → normalized Levenshtein ≤ 0.1）。
   * 返回每个平台一条候选（找不到则该平台缺席）。
   */
  async findEquivalent(seed: Track): Promise<{
    seed: Track;
    equivalents: Partial<Record<MusicProvider, Track>>;
    /** strict normalizeKey 命中 = 1.0；fuzzy 命中 = 算法得分（0.88..1.0） */
    scores: Partial<Record<MusicProvider, number>>;
    confidence: 'exact' | 'fuzzy' | 'none';
  }>;
}
```

### 与 P0 复用

`mergeLibrary` 内部直接复用 `search.util.ts` 的 `dedupTracks + buildUnifiedItems`。
不重新发明轮子——只是把入口暴露成 service。

## 去重规则（v1+，阶段 A-F）

1. 主键：`normalizeKey(title, artist)`（复用 search.util.ts 的实现，含全角→半角、
   CJK 跨写法归一、stripFeatTags、stripFuriganaParens、stripParensContent 等）
2. duration gate：同 normalizeKey 但 duration 差 >3 秒 → 不合并（remix/live）
3. ISRC：未接入（接口没暴露），保留 hook
4. 模糊匹配（阶段 C/D/E）：strict 不命中时回退到 JW ≥ 0.88 + 长度差 ≤15%，
   或 normalized Levenshtein ≤ 0.1（针对 10+ 字符长标题的 typo 场景）

## 不做什么

- 不持久化匹配结果——每次按需算（数据规模小）
- 不依赖 ISRC——目前拿不到

## 技术约束

- 放 `packages/server/src/match/` 模块，独立于 music
- MusicService 持有 MatchService（注入），search.util 仍是无依赖纯函数
- 失败策略：单平台 search 5 秒超时不影响其他平台
- 白盒测试用同样的 ts-node + assert 模式
