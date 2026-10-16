# Tasks — remote-playlist

> 状态：🚧 Phase 1 进行中。勾选规则见 `CLAUDE.md` §Specs 规则。

## Phase 1 — 契约 + 网易云（本次交付）

- [x] 1. 调研：公开接口实测 + 代码路径核对，产出 spec.md 的可行性表
- [x] 2. 定架构决策：镜像（mirror）而非导入（import），写进 spec
- [x] 3. `music/types.ts` 加 `RemotePlaylistMeta` / `RemotePlaylist`
- [x] 4. `netease.provider.ts` 加 `listPlaylists(session, limit)`
- [x] 5. `netease.provider.ts` 加 `fetchPlaylistTracks(session, id, maxTracks)`
- [x] 6. `music.service.ts` 加能力探测 + `withTimeout` 包装的 `listRemotePlaylists` / `getRemotePlaylist`
- [x] 7. `music.controller.ts` 加 `GET /music/playlists` + `GET /music/playlists/:provider/:id/tracks`
- [x] 8. 白盒测试 `playlist.provider.test.ts`：保序 / 未登录 / 404 / 不支持平台 / 封面映射
- [x] 9. 回归：`npm test` + `npm run typecheck` + `npm run lint` 全绿
- [x] 10. 确认 `fetchLiked` / `mergeLibrary` / 本地 `PlaylistService` 均未受影响

## Phase 2 — QQ（✅ 只读已解锁；列目录实测封死）

- [x] 11. ~~实测 `music.playlist.PlaylistDir/dir_list` 登录态是否可用~~ → **不可用**。
      8 个候选 module.method 全 `500003/860100001`，对照实验（同时刻同 cookie 打
      已知可用路径 `code=0`）排除风控误判
- [x] 12. 端到端验证「读指定歌单」→ 用户提供真实歌单 `disstid=8584177317`
      （「抖音超火：热门歌曲随时听」），**227 首全量拉回**，分页 `0→100→200→27`、
      去重 227/227。挖出最大坑：**`disstid` 必须传数字**，传字符串回 `10004` 且错误
      信息不提示类型
- [x] 13. `qq.provider.ts` 加 `fetchPlaylistTracks`（复用 `CgiGetDiss`，`Number()`
      转换 + 发请求前校验；`song_begin` 按请求页大小推进、`hasmore`+空页双判末页；
      **不做** `listPlaylists`）
- [x] 14. **契约修正**：拆 `PlaylistListerProvider` / `PlaylistReaderProvider` 两个
      各自独立可选的 interface —— QQ 只实现一半时不能被整判为「不支持」
- [x] 15. 白盒测试（`playlist.provider.test.ts` 扩到 19 例，新增 QQ 9 例：
      非数字 id 前置拦截 / disstid 类型 / 分页口径 / 短页不误判末页 / mediaMid /
      pay 映射 / 错误码 / 未登录 / 只实现一半的降级 / maxTracks 截断）

## Phase 3 — Spotify（阻塞：产品决策）

- [ ] 15. **【阻塞，需用户决策】** 确认是否接受「所有已登录用户被强制重新授权」
      （改 `SPOTIFY_SCOPES` 加 `playlist-read-private` / `playlist-read-collaborative`）
- [ ] 16. `spotify.provider.ts` 加 `listPlaylists`（`GET /v1/me/playlists`，翻 `next`）
- [ ] 17. `spotify.provider.ts` 加 `fetchPlaylistTracks`（`GET /v1/playlists/{id}/tracks`，翻 `next`）

## Phase 4 — Deezer（✅ 只读公开歌单已解锁）

- [x] 18. ~~确认是否要做 Deezer OAuth~~ → **不做**。公开歌单匿名即可，覆盖零阻塞部分
- [x] 19. 公开歌单读取：`/playlist/{id}` + `/playlist/{id}/tracks` follow `next` 游标
      （`limit=300` 上限，实测 490 首歌单 2 页取满、去重 490/490）
- [ ] ~~20. 用户歌单读取~~ → **取消**，需 OAuth（`/user/{id}/playlists` 匿名实测
      `error.code=800`），不在本 spec 范围
- [x] 20'. ⚠️ Deezer 对不存在的歌单回 **HTTP 200** + body `error.code=800`（不是 404），
      实现里必须查 body，否则「不存在」会被误判成「成功但空歌单」
- [x] 21. 白盒测试（`playlist.provider.test.ts` 扩到 26 例，新增 Deezer 7 例）

## Phase 5 — 前端 UI（✅ 最小闭环已交付）

- [x] 21. `playlistTracksToUnifiedItems()` —— `Track[]` → `UnifiedSearchItem[]`
      **1:1 保序、不合并**。⚠️ 刻意**不用** `buildUnifiedItems`：它按歌名折叠同名
      条目（测试 28 反向证明：3 条同名被折成 1 条），会让 227 首的歌单变 225 首
- [x] 22. `GET /playlists/:provider/:id/tracks` 同时返 `{ playlist, items }`，
      `items` 直接可喂队列（`usePlayer` 队列吃 UnifiedSearchItem）
- [x] 23. renderer `api.ts`：`RemotePlaylistMeta` / `RemotePlaylist` 类型 +
      `listRemotePlaylists` / `getRemotePlaylist` / `parseRemotePlaylistInput`
- [x] 24. `parseRemotePlaylistInput` 支持 QQ（`ryqq` / `ryqq_v2`）、网易云
      （**hash 路由** `/#/playlist?id=`，以及 `/playlist/<id>`）、Deezer、
      Spotify base62（只为回准确提示）、裸 id。未知域名返回 null 不猜平台
- [x] 25. `ui/Input.tsx`（shadcn 写法，与既有 `textarea.tsx` 同源）+ 样式
      `_remote-playlist.scss`（用 `--error-*` 令牌，`tokens:hardcoded:gate` 通过）
- [x] 26. `RemotePlaylistModal.tsx`：粘贴链接 → 读歌单 → 播放全部 / 追加队列 /
      存为本地歌单 / 点单曲播放
- [x] 27. 入口：lite（MiniPlayer）+ theater（SearchPanel）各加一个 `onOpenRemote`
      按钮，App.tsx 挂 state 与 modal
- [x] 28. 测试：server 30 例（含转换器保序 + 反向证明）、renderer 6 例（链接解析）

## 明确不做

- 远端歌单写入 / 排序 / 同步回平台
- 远端歌单持久化 / 离线缓存 / 变更检测（「存为本地歌单」是一次性快照）
- 远端歌单跨平台合并
- Deezer 用户歌单（需 OAuth）、Spotify 歌单（需改 scope，会强制全部用户重授权）
- 歌单「浏览发现」UI：QQ / Deezer 的列目录接口实测不可用 / 无用户概念，
  网易云虽然能列但 MVP 先不做
