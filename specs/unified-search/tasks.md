- [x] 1. 定义类型 `music/types.ts` — `SearchResult`、`SearchItem`、`SourceInfo` 接口
- [x] 2. 在 `MusicProvider` 接口加 `search(q, page, pageSize)` 方法签名（QQ/网易云已有，Deezer 新增）
- [x] 3. 实现 `qq.provider.ts` 的 `search()`，用现有 QQ cookie 鉴权（已有）
- [x] 4. 实现 `netease.provider.ts` 的 `search()`，用现有 session 鉴权（已有）
- [x] 5. 实现 `deezer.provider.ts` 的 `search()`（Deezer 免登录，公开 API `GET /search?q=xxx`）
- [x] 6. 去重逻辑 `music.service.ts` — 歌名+歌手标准化（全角→半角、去空格/标点、小写）
- [x] 7. 播放优先级 `music.service.ts` — `qq > netease > deezer`，且 `hasCopyright = true`
- [x] 8. 合并分页逻辑 `music.service.ts` — 三平台结果合并后统一分页
- [x] 9. `music.controller.ts` — `GET /music/search?q=xxx`（不加 provider 参数 → 统一搜索），参数校验 + 错误处理
- [x] 10. 各 provider 加 5 秒超时 + 单平台失败不影响其他平台（`searchOneProvider` 捕获单平台异常，error 字段记录）
- [x] 11. 写单元测试: 去重、标点/全角归一化、不同歌曲保留、空输入 — 6 tests pass
- [x] 12. 跑全量测试 TypeScript 类型检查确认通过（`npx tsc --noEmit` OK）
- [x] 13. 端到端验证: nest 启动后 curl `/api/music/search?q=周杰伦` → 跨平台合并返回，bestSource=qq 优先；空 q / >100 字符 q 返回 400；test #7 验证跨平台聚合 + mediaMid 透传（无需 GUI 也能验证）
- [x] 14. 阶段 G: tilde 变体归一 — `normalizeKey` step 5 noise-strip 加入 `~` (U+007E) / `〜` (U+301C) / `～` (U+FF5E) 三种 tilde。修「Departures~歌名~ (Departures~中译~)」(QQ/网易云用 ASCII tilde) vs 「Departures 〜歌名〜」(Spotify 用 wave dash) 不同字符导致 6 tier 全挂的回归。同改动同步到 renderer `groupLibrary.ts` 的展示级 noise-strip 保持一致。test #3g-bis + cross-platform-match.e2e #16 覆盖。
- [x] 15. 封面跨源抽取：buildUnifiedItems 同簇（同歌多平台）取首个有封面的 coverUrl，
      主平台无封面时不再产出空封面条目（search.test #9/#10）
- [x] 16. 多版本 UI：行尾「N 个版本 ▾」展开按钮（行尾唯一的箭头）+ 播放三角移到封面
      hover 遮罩（Bug #7：行尾 ▶ 被当成展开箭头误点 → 直接播放）；版本行显示该版本
      真实歌名/歌手/专辑/时长（`VersionEntry.title/artist/album/coverUrl`，服务端从
      cluster 代表 track 填充），点击版本行时队列/播放器元数据同步换成该版本
- [x] 17. Phase 3 版本口径收敛（`buildUnifiedItems`）：主版本改为「跨平台源数最多 →
      时长最长」——旧口径取最短，导致"盲选"折叠行显示 1:20 的片段；并把偏离主版本
      时长 >50% 的孤立 cluster 拆成独立 item（片段/剪辑不再混进 versions）。
      `versions[0]` = 主版本的不变量写进注释与 spec；新增 11b/11c/11d 三个白盒用例
- [x] 18. 分页前按查询相关性重排（`sortByRelevance`，search.util.ts）：旧行为直接
      按 `buildUnifiedItems` 输出序（= 各平台段首次出现序，qq 段整体在前）分页，
      平台独占曲目会被挤出第一页——实测网易云独有「浓缩蓝鲸 · 裘德」落在 25 条
      QQ 弱相关结果之后（pageSize=20 时不可见）。打分：标题全等 +120 / 前缀 +70 /
      包含 +50，歌手全等 +60 / 包含 +30，多 token 每命中 +20；稳定排序，0 分保持
      插入序不回归。仅 searchUnified 分页前调用，库合并没有 query 不用。
      新增 R1-R4 白盒用例（search.util.test.ts）。顺带修复该测试文件存量未闭合
      模板串（ef874cb 引入，整文件 28b 起从未真正执行）及 P2/P6 过期断言
      （priority 不能跨档把非全曲源抬过全曲源，与 P4/设计注释一致化）。
- [x] 19. 网易云搜索端点迁移 `search/get/web` → `cloudsearch/pc`
      （netease.provider.ts）：2026-09 实测旧端点对**登录态**请求返回
      `code:405 "操作频繁"`（账号×端点维度风控，匿名反而放行）→ 静默空列表，
      用户看到"暂无结果"。新端点是官方网页客户端现行搜索接口，匿名/登录态
      均 200；schema 换移动端命名（ar/al/dt），且单曲内联 `privilege` 权限 +
      `al.picUrl` 封面——原 v3 song/detail 补充请求整体删除（每次搜索少一发
      请求，降低风控面）。`code!==200` 现在显式抛 BadRequestException（上层
      标记平台 error，不再伪装成"没结果"）。测试 13-16 改单调用 cloudsearch
      schema，新增 15e（VIP+privilege 缺失不锁）与 16（405→抛错）。
- [x] 20. 同分 tie-break 按平台内 rank 交错（`sortByRelevance` 第三参 `rankOf`）：
      同名翻唱 query 分全等时，"各平台自家排名"是最可靠信号——QQ 25 条同名
      「浓缩蓝鲸」全 +120，无 tie-break 时 ne#1 裘德仍沉底。music.service 构建
      `platform:trackId → 平台内名次` 映射传入，同分按 rank 升序 → 各平台 top
      结果交错冒头。实测端到端：裘德《浓缩蓝鲸》升至综合搜索第 1-2 位。
      新增 R5 用例。
- [x] 21. 统一搜索跨脚本证据合并（`buildUnifiedItems` 新增 opt-in
      `crossScriptMerge`，仅 `searchUnified` 传 true；library import 仍走
      mergeCrossScript 旧口径不动）：修 2026-09-23「寂寞，好了」报障——
      Spotify 实际返回 `寂寞，好了 | Evan Yo | 346s`、Deezer 返回罗马音
      `Ji Mo, Hao Liao | Evan Yo | Loneliness | 342s`，但 normalizeKey 对
      跨脚本元数据（Evan Yo ↔ 蔡旻佑）落到不同 key，同一首歌被拆成三行，
      用户以为"Spotify 没搜到"且 Deezer 拼音行看着很怪。实现：分组后按
      union-find 做组间证据合并——同 versionType 内「标题同义 + 艺人可桥
      + 任一对时长 ≤30s」才并组。标题门刻意比 mergeCrossScript 严：搜索
      结果是全目录密度，裸 isCrossScript 会把同艺人不同歌误并（「我可以」
      ↔「Death of Me」时长撞上就翻车），跨脚本标题必须过**音译佐证**——
      新增 `translit.ts:titleTransliterationMatch`（pinyin-pro 逐字
      `multiple:true` 多音字笛卡尔展开，覆盖词级消歧给不出的读音如
      了→liao；kuromoji(cn2t) 管日文汉字如 花火↔Hanabi；变体上限
      4读音/字×24变体防爆炸；**只认整串相等不做 includes**，防
      Song↔Song II 误并）。CJK↔CJK 同音异形（异地↔一地）不并——音译
      仅对真跨脚本启用。艺人走 artistLooseMatch 别名表（蔡旻佑↔Evan Yo
      已在表）或 artistTransliterationMatch。`searchUnified` 搜索前
      `void warmupJa()` 并行预热 kuromoji，未就绪优雅降级。新增
      search-crossscript-groups.test.ts 8 用例（含开关关闭回归护栏、
      live/studio 边界、>30s 时长门、翻唱不同艺人拒绝）。实测端到端：
      「寂寞，好了」合并为 1 item，versions 覆盖 qq/netease/spotify/deezer
      四源，翻唱条目全部正确保持独立。
