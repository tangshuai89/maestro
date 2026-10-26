# 歌单导出（.txt）—— 任务清单

对应 spec: `specs/playlist-export/spec.md`

## 1. 实现

- [x] 新建 `packages/renderer/src/lib/playlistExport.ts` - `buildPlaylistText(playlist, now?)` —— **纯函数**，歌单 → 文本 - `safeFileName(name)` —— 去文件系统非法字符 / 空 → 「歌单」/ 截断 60 - `downloadPlaylistText(playlist)` —— Blob + `<a download>`（同 lyricsShare 的下载做法）
- [x] `PlaylistManagerModal.tsx`：底部加「导出」按钮（空歌单禁用）

## 2. 测试

- [x] `packages/renderer/src/lib/playlistExport.test.tsx`（9 条：格式 / 文件名 / 下载行为）
- [x] `PlaylistManagerModal.test.tsx` 补 2 条（点导出触发下载 / 空歌单禁用）

## 3. 门禁

- [x] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] 全量套件 `bash scripts/test.sh --ci` → EXIT=0
- [ ] 覆盖率 diff 门禁（base = `0bb5860`）→ ✅ 本次改动的代码全部被执行过
- [ ] 变异验证：分隔符改成 `-` → 门禁必须红
- [ ] PR 合并后核对内容进 master

## 4. 局限（如实记录）

- 只导 .txt，不导 JSON（JSON 回导闭环要服务端补 import 端点）
- 导出的清单不含流地址/凭据（刻意：导出文件不该带指向本机账号的东西）
- 不做「分享链接」——本地应用没有可分享的公网地址，做了也是假的
