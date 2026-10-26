# 快捷键速查面板 —— 任务清单

对应 spec: `specs/shortcut-cheatsheet/spec.md`

## 1. 单一事实源

- [x] 新建 `packages/renderer/src/lib/shortcuts.ts`：- `APP_SHORTCUTS`（判定条件 + 展示键位 + 描述 + 分组 + 生效模式）- `APP_SHORTCUT_BY_ID`（按 id 取）- `matchesShortcut(e, def)`（**唯一**判定实现）- `groupShortcuts()` / `formatAccelerator()`（纯展示）
- [x] `App.tsx` 的 3 处 keydown 判定改成调 `matchesShortcut`
      （`⌘⇧M` / `⌘⇧D` / `⌘⇧L` + lite 模式的 `Esc` / `Space`）

## 2. 全局热键（走 IPC，不在 renderer 抄）

- [x] `packages/electron/src/main.ts`：新增只读通道 `shortcuts:global`
      （数据来自主进程真源 `GLOBAL_SHORTCUTS`）
- [x] `packages/electron/src/preload.ts`：暴露 `getGlobalShortcuts()`
- [x] `ipc-surface` 门禁自动覆盖新通道（preload→main 14 个）

## 3. UI

- [x] 新建 `packages/renderer/src/components/modals/ShortcutModal.tsx`
      （App 内 / 全局热键 / 媒体键 三段）
- [x] `Titlebar.tsx` 加「⌨ 快捷键」按钮（`aria-label="快捷键"`）
- [x] `App.tsx` 接线：`shortcutOpen` state + 挂载面板 + 进 `overlayOpen`
      （面板开着时 lite 模式的 Esc/Space 让位给面板）

## 4. 测试

- [x] `packages/renderer/src/lib/shortcuts.test.ts`（判定 / 定义表完整性 / 分组 / 格式化）
- [x] `packages/renderer/src/components/modals/ShortcutModal.test.tsx`（4 条）
- [x] `packages/renderer/src/components/layout/Titlebar.test.tsx` 补 1 条

## 5. 门禁

- [x] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] 全量套件 `bash scripts/test.sh --ci` → EXIT=0
- [ ] 覆盖率 diff 门禁（base = `0bb5860`）→ ✅ 本次改动的代码全部被执行过
- [ ] 变异验证：`matchesShortcut` 改成永远不命中 → 门禁必须红
- [ ] PR 合并后核对内容进 master

## 6. 局限（如实记录）

- 面板**只列「已注册」**的快捷键，第一版不支持自定义（#128 同样不做配置 UI）
- 媒体键列不成键位表（由系统/硬件决定）→ 单列一段说明
- 浏览器 dev 没有全局热键 → 面板明说，不假装
