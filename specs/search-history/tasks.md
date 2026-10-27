# 搜索历史 —— 任务清单

对应 spec: `specs/search-history/spec.md`

## 1. 存储层

- [x] 新建 `packages/renderer/src/lib/searchHistory.ts`（**纯函数**）：- `normaliseHistoryEntry`（去空白 / 丢空串 / 丢超长）- `pushSearchHistory`（去重 + 移到最前 + 截断到 `MAX_SEARCH_HISTORY`）- `parseSearchHistory`（解析 localStorage，**丢脏数据**）
- [x] `packages/renderer/src/lib/storage.ts`：- `STORAGE_KEYS.searchHistory = 'maestro:search-history'`
      ⇒ 自动进 `collectLocalStorage()`（加密备份）- `readSearchHistory()` / `writeSearchHistory()` / `clearSearchHistory()`

## 2. UI

- [x] `SearchPanel.tsx`：- `history` state（挂载时读一次）+ `historyRef`（写时用最新值）- debounce 触发时 `pushSearchHistory` 并落盘 - 空输入时渲染「最近搜索」列表（胶囊标签 + 「清空」）- 点条目 → `setQ(h)`（走正常 debounce 搜索）
- [x] `styles/components/_search-panel.scss`：`.sp-history*` 样式

## 3. 测试

- [x] `packages/renderer/src/lib/searchHistory.test.tsx`（10 条）
- [x] `SearchPanel.test.tsx` 补 4 条（显示 / 点击回填 / 清空 / 去重）

## 4. 门禁

- [x] `npm run typecheck` 全绿
- [x] `npm run lint` 全绿（PR #135 的 CI `Lint` 步 success）
- [x] 全量套件 `bash scripts/test.sh --ci` → **EXIT=0**（PR #135 的 CI `Run tests` 步 success）
- [x] 覆盖率 diff 门禁（base = `0bb5860`）→ ✅ 本次改动的代码全部被执行过（PR #135 的 CI `Coverage diff gate` 步 success）
- [x] 变异验证：去掉去重 → 门禁必须红（PR #135 描述记录：去掉 `pushSearchHistory` 的去重 → **两条用例精确红**）
- [x] PR 合并后核对内容进 master（master 的 `searchHistory.ts` 里去重在 `history.filter((h) => h !== entry)` ✅）

## 5. 坑（留档）

- ⚠️ **renderer 里的测试文件必须 `.test.tsx`**：`scripts/test.sh` 的 node 管道
  收 `*.test.ts`（ts-node 跑），而 renderer 的 vitest `include` 只有
  `src/**/*.test.tsx` ⇒ `.test.ts` 会被 ts-node 捡走（vitest 的 `describe`
  在 node 下不存在 → 直接炸）。**先写成 `.test.ts` 再改名会踩这条。**

## 6. 局限（如实记录）

- 只记**歌曲 tab** 的搜索（专辑 tab 在 `AlbumResults` 里自己搜，不混进历史）
- 历史是单机的（换设备 / 清 localStorage 就没了）—— 有意的
- 不做搜索建议/联想（要调接口做前缀匹配，是另一件事）
