# D1 — 屏契约（每个 frame 的 AI CONTRACT description 草稿）

> 喂给 `figma-aether-v4-screens-d1.js` 的 SEG1-6 用。下游 audit 增量项会校验每帧有
> `AI_CONTRACT:` 字段。React 路径对照代码端 `.superdesign/init/components.md`。

## SEG1 · Screen/Search/Modal

```yaml
name: Screen/Search/Modal
size: 1440x900
react: packages/renderer/src/components/search/SearchPanel.tsx
routes: [search]
bindings:
  - Scene/Backdrop (1)         # 蒙层
  - Tag/Stat×3                 # 过滤标签：跨平台 / 4 平台 chip
  - Lyrics/Line×N              # 改用作结果行（占位用，单行字号适配）
  - Icon/Search×1              # 搜索框前 icon
description: |
  ---
  AI_CONTRACT:
    react: packages/renderer/src/components/search/SearchPanel.tsx
    routes: [search]
    props:
      onPlay: (items, index) => void
      onClose: () => void
    a11y:
      role: dialog
      keyboard: [Escape, ArrowDown, ArrowUp, Enter]
      aria-label: 跨平台搜索
    states: [empty, loading, results, error, timeout]
    motion:
      enter: 蒙层 fade-in 240ms ease-out; 搜索框 slide-down 240ms
      exit: 蒙层 fade-out 200ms
      interaction: 输入 debounce 300ms → 搜索
    tokens: [Color/semantic/text-main, Color/semantic/glass-fill, Color/semantic/glass-stroke]
    bindings: [Scene/Backdrop, Tag/Stat, Lyrics/Line, Icon/Search]
  ---
```

## SEG2 · Screen/Liked/Modal

```yaml
name: Screen/Liked/Modal
size: 1440x900
react: packages/renderer/src/components/modals/LikedLibraryModal.tsx
routes: [liked]
bindings:
  - Scene/Backdrop (1)
  - Tag/Stat×2                 # 顶部"已收藏 N 首" + 排序 tag
  - Icon/Heart×1               # 顶 header icon
description: |
  ---
  AI_CONTRACT:
    react: packages/renderer/src/components/modals/LikedLibraryModal.tsx
    routes: [liked]
    props:
      session: Session
      onClose: () => void
    a11y:
      role: dialog
      keyboard: [Escape, ArrowUp, ArrowDown, Enter]
    states: [empty, loading, list, importing, imported]
    motion:
      enter: 蒙层 fade-in + 列表 stagger 40ms
      exit: 蒙层 fade-out
    tokens: [Color/semantic/status-liked, Color/semantic/text-main, Color/semantic/text-dim]
    bindings: [Scene/Backdrop, Tag/Stat, Icon/Heart]
  ---
```

## SEG3 · Screen/Settings/Full

```yaml
name: Screen/Settings/Full
size: 1440x900
react: packages/renderer/src/components/modals/SettingsModal.tsx
routes: [settings]
bindings:
  - Scene/Backdrop (1)         # 星空背景
  - Tag/Stat×5                 # 3 个 section title + 2 个 status
  - Button/Text×3              # 立即备份 / 导出 / 导入
description: |
  ---
  AI_CONTRACT:
    react: packages/renderer/src/components/modals/SettingsModal.tsx
    routes: [settings]
    props:
      onClose: () => void
    a11y:
      role: dialog
      keyboard: [Escape, Tab]
    states: [idle, busy, ok, err]  # 每个 section 独立
    motion:
      enter: 蒙层 fade-in 240ms ease-out; 面板 fade-up 240ms
      exit: 蒙层 fade-out 200ms
    tokens: [Color/semantic/glass-fill, Color/semantic/glass-stroke, Color/semantic/text-main]
    bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
  ---
```

## SEG4 · Screen/RecoKey/Modal

```yaml
name: Screen/RecoKey/Modal
size: 1440x900
react: packages/renderer/src/components/modals/RecoKeyModal.tsx
routes: [reco-key]
bindings:
  - Scene/Backdrop (1)
  - Tag/Stat×1                 # 标题
  - Button/Text×2              # 保存 / 取消
description: |
  ---
  AI_CONTRACT:
    react: packages/renderer/src/components/modals/RecoKeyModal.tsx
    routes: [reco-key]
    props:
      onSave: (apiKey: string) => void
      onClose: () => void
    a11y:
      role: dialog
      keyboard: [Escape, Enter, Tab]
    states: [empty, typing, valid, saving, saved, error]
    motion:
      enter: 蒙层 fade-in
      exit: 蒙层 fade-out
    tokens: [Color/semantic/accent, Color/semantic/text-dim, Color/semantic/glass-fill]
    bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
  ---
```

## SEG5 · Screen/AuthError/Full

```yaml
name: Screen/AuthError/Full
size: 1440x900
react: packages/renderer/src/components/common/AuthErrorPanel.tsx
routes: [auth-error]
bindings:
  - Scene/Backdrop (1)
  - Tag/Stat×2                 # 错误码 + provider
  - Button/Text×4              # 重试 / 重新登录 / 粘贴 cookie / 切换音源
description: |
  ---
  AI_CONTRACT:
    react: packages/renderer/src/components/common/AuthErrorPanel.tsx
    routes: [auth-error]
    props:
      provider: MusicProvider
      error: AuthError | null
      onRetry: () => void
      onReLogin: () => void
      onSwitch: () => void
      onPasteCookie?: () => void   # 仅 qq/netease 显示
      onDismiss: () => void
    a11y:
      role: alert
      keyboard: [Escape, Enter]
    states: [cancelled, timeout, invalid, expired, protocol-missing, backend-down, unknown]
    motion:
      enter: 全屏 fade-in 200ms
      interaction: 错误码 tag 呼吸 pulse 2400ms
    tokens: [Color/semantic/status-error, Color/semantic/status-warn, Color/semantic/status-info, Color/semantic/text-main]
    bindings: [Scene/Backdrop, Tag/Stat, Button/Text]
  ---
```

## SEG6 · Screen/EmptyState/Full

```yaml
name: Screen/EmptyState/Full
size: 1440x900
react: (无专用组件 — 嵌入到 SourceSelect/Playing 切换前)
routes: [empty]
bindings:
  - Scene/Backdrop (1)
  - Tag/Stat×1                 # 标题
  - Button/Text×1              # 去登录
  - Icon/Heart×1               # 居中 illustration (示意星)
description: |
  ---
  AI_CONTRACT:
    react: (复用 TheaterView 的 conditional render)
    routes: [empty]
    props: (无)
    a11y:
      role: status
      keyboard: [Tab, Enter]
    states: [empty]
    motion:
      enter: fade-in 400ms ease-out
      ambient: 心跳 idle 4s 循环
    tokens: [Color/semantic/text-dim, Color/semantic/text-muted, Color/semantic/accent]
    bindings: [Scene/Backdrop, Tag/Stat, Button/Text, Icon/Heart]
  ---
```

## 屏间切换矩阵（自动跳转，仅供 D1 后续原型连线参考）

| from | to | trigger | transition |
|---|---|---|---|
| SourceSelect | EmptyState (未登录) | `route` | DISSOLVE 200ms |
| EmptyState | SourceSelect (点击登录) | click Button/Text | SMART_ANIMATE 240ms |
| NowPlaying/Playing | Search/Modal | click search button | DISSOLVE 200ms (蒙层) + SLIDE 240ms (面板) |
| NowPlaying | Liked/Modal | click heart-stat | DISSOLVE 200ms (蒙层) + SLIDE 240ms (面板) |
| Anywhere | Settings/Full | open settings | DISSOLVE 240ms |
| NowPlaying | RecoKey/Modal | first-time reco | DISSOLVE 200ms + SLIDE 240ms |
| Auth fail anywhere | AuthError/Full | dispatch | DISSOLVE 200ms (蒙层) + SLIDE-UP 240ms (面板) |

> 这些不在 D1 自动建（D3 范围），description 写好供后续 UI 手动连线对照。
