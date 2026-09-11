# D5_NEW — 10 组件详细规格

> 喂给 `scripts/figma-aether-v4-components-d5.js` 的 SEG1+SEG2 用。Figma 端位置：
> 02 · Components 页，x=0 起，y 递增。每个组件横向排开，间距 80px。
> 与 v4-ABC 11 组件集共用页面，**不**新建子页。

## 通用规则

- **frame bounds**：默认 240×80（按钮型）或 200×120（chip / 状态块）
- **auto-layout**：水平（HUG）+ 居中
- **fill 透明**：`fills = []`
- **stroke 1px**：`Color/semantic/glass-stroke`（`#FFFFFF1A`）
- **corner radius**：12px（按钮）/ 8px（chip）
- **tokens 绑定**：所有颜色绑 `Color/semantic/*` 别名
- **description**：必含 AI CONTRACT 5 段（参 `specs/d6-description-template/template.md`）
- **变体名格式**：`state=default, version=2`（按 D6 audit 解析需要 `key=value` 格式）

## 1. Modal/Shell

```
变体: state=default (1 个)
bounds: 320×240 (框内含 children 槽位 + close ×)
layout: VERTICAL HUG, padding 24, itemSpacing 16
children:
  - header (HORIZONTAL SPACE_BETWEEN)
    - title text "弹窗标题" (16, text-main, Semi Bold)
    - close × (20×20, text-dim)
  - body (空容器, 240×120, slot, 仅一个变体时不需要 SLOT)
description: 含 AI_CONTRACT 7 字段（react=Modal, panelClassName?, children）
```

## 2. Modal/ErrorPanel

```
变体: state=collapsed, expanded (2 个)
bounds: 480×60 (collapsed) / 480×200 (expanded)
layout: VERTICAL HUG, padding 16
common structure (两变体图层名一致):
  - summary (HORIZONTAL, height 32)
    - icon ⚠ (24×24, status-error)
    - firstLine text (自动从 message 截首行)
    - toggle ▸/▾ (16×16)
  - detail (仅 expanded 显示)
    - pre 容器, 装完整 message
description: 含 react=ErrorPanel, message (TEXT), onClose
```

## 3. Modal/RecoLoading

```
变体: state=loading, error (2 个)
bounds: 360×120
layout: VERTICAL HUG, padding 20, itemSpacing 12
common structure:
  - icon (40×40, accent cyan)
  - text (14, text-main, Semi Bold)
    - state=loading: "AI 正在为你挑选..."
    - state=error: "推荐失败"
  - subtext (11, text-dim)
    - state=loading: "基于 {librarySize} 首歌"
    - state=error: "{errorText}"
description: 含 react=RecoLoading, librarySize, errorText?, onClose
```

## 4. SourceChip

```
变体: platform=qq, netease, deezer, spotify (4 个)
bounds: 64×24
layout: HORIZONTAL HUG, padding 8/4, cornerRadius 8
common structure:
  - letter text (12, bold)
    - qq: "Q" + accent yellow
    - netease: "N" + accent red
    - deezer: "D" + accent blue
    - spotify: "S" + accent green
  - ★ (12×12, accent) — 仅 isBest=true 显示（用 instance override 控制）
description: 含 react=SourceChip, source (复杂), isBest (instance override)
```

## 5. Screen/SourceSelect

```
变体: state=empty, ready (2 个)
bounds: 1440×900 (整屏)
common structure:
  - Scene/Backdrop 实例 (背景)
  - 4 个 ProviderCard (每 provider 一个, 192×240, VERTICAL HUG)
    - icon
    - name
    - status text ("未连接" / "已登录")
    - 状态色边框
  - state=ready 时 ProviderCard 显示绿色边框
description: 含 react=SourceSelect, onSelect, provider (instance override)
```

## 6. Titlebar

```
变体: state=logged-out, logged-in, logging-in (3 个)
bounds: 1440×40 (整顶栏)
layout: HORIZONTAL HUG, padding 16/8, SPACE_BETWEEN
common structure (5 列):
  - brand: "AETHER ENGINE v3.0" (12, text-main, Semi Bold) + "SYSTEM PROTOCOL" (9, text-dim, mono)
  - 左 menu: Search 按钮 (Button/Text instance)
  - 中 quality/source selectors (Button/Text instances)
  - 右 reco 状态 (Tag/Stat instances)
  - 极端 account button:
    - state=logged-out: "登录" (Button/Text accent)
    - state=logged-in: "{accountName}" (Button/Text default)
    - state=logging-in: spinner (16×16)
description: 含 react=Titlebar, 18 个 props（accountName, likedCount, qqQuality, deezerPreset, recoStatus, recoRunning, qqQuality, loggingIn, onOpenSearch, onOpenLiked, onOpenSettings, onReco, onChangeQuality, onChangeDeezerPreset, onSwitchProvider, onLogin, onAccount, onReset）
```

## 7. Layout/QualityMenu

```
变体: quality=standard, high, lossless (3 个)
bounds: 160×32
layout: HORIZONTAL HUG, padding 12/6, cornerRadius 8
common structure:
  - label text
    - standard: "标准"
    - high: "极高 320"
    - lossless: "无损"
  - ▼ chevron (10×10, text-dim)
fills: 按 quality 用不同 accent 透明色
  - standard: glass-fill
  - high: glass-fill + accent-soft 边框
  - lossless: glass-fill + accent 边框
description: 含 react=QualityMenu, quality, onSelect, disabled (instance override)
```

## 8. Layout/SourceMenu

```
变体: provider=qq, netease, deezer, spotify (4 个)
bounds: 140×32
common structure:
  - icon (lucide-style, 14×14, provider 品牌色)
    - qq: 黄 Q 图标
    - netease: 红音符
    - deezer: 蓝波浪
    - spotify: 绿圆
  - label (12, text-main)
description: 含 react=SourceMenu, provider, onSelect, disabled (instance override)
```

## 9. Layout/DeezerPresetSelect

```
变体: state=default, hover, open (3 个)
bounds: 200×32
common structure:
  - text "{value} · {editorialCount} 辑" (12)
  - chevron (10×10, 不同状态旋转)
    - state=default: ▾
    - state=hover: ▾ (color bright)
    - state=open: ▴
description: 含 react=DeezerPresetSelect, editorials, value, onChange
```

## 10. Modal/NeteaseCookie

```
变体: state=empty, qr-shown, cookie-paste, submitting (4 个)
bounds: 480×400
common structure:
  - title "网易云登录" (18, text-main, Semi Bold)
  - body 容器 (按 state 切换内容)
  - footer: "确认" / "取消" 按钮
state 切换细节:
  - state=empty: body 提示文字 "扫码或粘贴 cookie"
  - state=qr-shown: body 是 QR 码占位 (200×200 rect)
  - state=cookie-paste: body 是 textarea (textarea 占位, 280×120)
  - state=submitting: body 是 spinner + "提交中..."
description: 含 react=NeteaseCookieModal, onSuccess, onClose, errorText? (instance override)
```

## 总计

- 10 component set
- 28 变体
- 28 description（每变体共享同一 description）
- x 坐标递增（间距 80px）：Modal/Shell@0, ErrorPanel@400, RecoLoading@960, SourceChip@1400, SourceSelect@1500, Titlebar@3000, QualityMenu@4500, SourceMenu@4800, DeezerPresetSelect@5400, NeteaseCookie@5700

## 关键约束（继承 v4 沙箱规则）

1. DROP_SHADOW 必须 `blendMode: 'NORMAL'`
2. LAYER_BLUR/BACKGROUND_BLUR 不接受 blendMode
3. HUG/FILL 必须在 auto-layout 父节点已挂后设置
4. INSTANCE_SWAP 必须每变体自建（`name#属主ID` 格式）
5. PageNode 无 index 属性（用 insertChild）

## 失败原子性

use_figma 出错时整段不执行、文件无残留，改后重跑该段即可（脚本幂等：旧同名 set 先删后建）。
