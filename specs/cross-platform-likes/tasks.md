- [x] 1. types.ts: SourceInfo 加 likeCount 字段（count/display/source）
- [x] 2. types.ts: UnifiedSearchItem 加 crossPlatformLikeTotal 派生字段
- [x] 3. qq.provider.ts: getTrackFavCount(session, songmid) 走 SongFavRead
- [x] 4. netease.provider.ts: getTrackLikeCount(session, songId) 走 /api/song/detail
- [x] 5. music.service.ts: searchUnified 后异步 fire-and-forget 填充 likeCount（带缓存 + withTimeout(5s)）
      —— 2026-10-19 补：缓存此前**完全没做**（每次搜索都重打 QQ/网易云公开接口）。
      现挂 `likeCountCache`（key = sessionId|platform|trackId，命中/干净缺席 1h、
      失败 30s、FIFO 上限 512），provider 侧 withTimeout(5s) 本来就在。
- [x] 6. music.service.ts: importLiked / patchLibraryWithSources 同样填充
      —— 2026-10-19：`patchLibraryWithSources` 补上了（只填被 patch 的那一条）。
      `importLiked` **刻意不填**：一次 import 可能几百首，全量拉会把公开接口打爆，
      而库弹窗走 `getLibrary` → 已调 fillLikeCountsForItems（缓存兜底），效果等价。
- [x] 7. TheaterView.tsx: HUD 改读 crossPlatformLikeTotal，D.1 样式（上标 + 加号）
      —— 2026-10-19 修：此前渲染成 `5700w+ + 2,500¹²`（上标全粘末尾），
      与验收标准 `5700w+¹ + 2,500²` 不符。改为按 parts 逐项渲染 + 补 `.th-hud-like-sup` 样式。
- [x] 8. e2e：白盒 7 条（`search.util.test.ts` L1–L7）+ 服务端 18 条
      （`cross-platform-likes.e2e.test.ts` A1–A7 / B1–B11）+ 前端 8 条
      （`TheaterView.test.tsx`）。覆盖 spec 四条验收：双平台累加 / 仅单平台 / 缺席留
      undefined 不阻塞 / 缓存与回落链。**未覆盖**：「切歌瞬间显示 …」这条过渡态
      由 fire-and-forget 首帧 undefined 天然满足，属渲染时序，需真机目测确认。
- [x] 9. typecheck + lint + 全量测试通过
- [x] 10. 清理 _qq-fav-test.ts 临时文件（已不在仓库）

---

## 2026-10-19 复盘（本轮补的）

功能早已落地但**零测试**，spec 的两条验收也没实现。本轮补齐：

| 项               | 之前                                | 现在                                                        |
| ---------------- | ----------------------------------- | ----------------------------------------------------------- |
| likeCount 缓存   | ❌ 完全没有，每次搜索重打公开接口   | ✅ 1h / 30s 双档 + FIFO 上限 512                            |
| importLiked 填充 | ❌ 没调                             | ✅ patchLibraryWithSources 调；import 刻意不调（见 task 6） |
| HUD 上标位置     | ❌ `5700w+ + 2,500¹²`（上标粘末尾） | ✅ `5700w+¹ + 2,500²`（按 parts 逐项）                      |
| 测试             | ❌ 0 条                             | ✅ 33 条（server 25 + renderer 8）                          |

**测试的牙齿做过变异验证**（不是"跑绿就算数"）：

- 把缓存读短路 → B6/B7 变红
- 把 `session.id` 从 cacheKey 去掉 → B8 变红
- 把 HUD 渲染改回"上标粘末尾" → 2 条 renderer 用例变红

**仍未做**：真机目测（切歌过渡态 `…`、打包模式下 HUD 显示）。
