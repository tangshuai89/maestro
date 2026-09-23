# Mini Player 模式 + 角色叠加层

> 状态：**P1 已确认，实施中**（Phase 1 mini 浮层先行；角色叠加层待 Figma 稿后单独迭代）
> 创建：2026-09-23 · 决策确认：2026-09-23
> 关联：`aether-theater-v4-spec.md`（theater view 既有 spec）
> 实施 spec：`specs/mini-player/`（spec.md + tasks.md）

## 1. 目标

- **Mini 模式**：从 theater 模式可折叠成底部小浮层（参考 Apple Music 的
  mini bar 形态），节省屏幕占用、保持播控可见。
- **角色叠加**：芙宁娜（先做 1 个角色，未来可替换）"坐"在播放器上做装饰。
- **模式切换**：顶栏按钮 + 快捷键（`Cmd + Shift + M`，避开 `Cmd + M` 最小化冲突）。
- **媒体连续性**：模式切换不重建 `<audio>` 元素，Web Audio graph 保持。

## 2. 设计决策

### 2.1 浮层位置：应用内 vs 独立 BrowserWindow

| 维度 | 应用内浮层（推荐） | 独立 BrowserWindow |
|---|---|---|
| 实现复杂度 | 低（纯 React + CSS） | 高（IPC + Electron BrowserWindow） |
| 主窗口关闭 | mini 一起关 | mini 可独立播 |
| 接近 Apple Music | 视觉一致，行为不一 | 视觉行为都一致 |

**结论**：P1 应用内浮层。P2+ 再考虑独立窗口（如果用户要）。

### 2.2 角色与状态联动

芙宁娜"坐"在播放器顶部，**绑动画状态**：

| 状态 | 动画（CSS keyframes） |
|---|---|
| 播放中 | 头轻摆 + 身体上下微跳（8-12s 周期） |
| 暂停 | 坐下不动 |
| 加载中 | 等速微晃 |
| 红心 | 短暂飞吻（一次性动画） |

**节拍反应**（基于 `usePlayer.ts` AnalyserNode frequency data → CSS translate）成本约 +1 天，**P1 不做**。

### 2.3 角色可替换性（演进路径）

| 阶段 | 实现 |
|---|---|
| **P1** | 硬编码芙宁娜 SVG，`lib/characters/furina.tsx` |
| P2 | Settings 加角色 dropdown，从 `settings/character.json` 读 |
| P3 | 皮肤包机制（主题 ↔ 角色 + 立绘） |

**P1 不引入配置**。换角色需改源码。

### 2.4 角色 SVG 风格选择（与用户确认）

候选：
- **自绘简化版**（白发 + 描眼蓝裙抱伞姿态）—— 规避原神 IP 版权，资源体积小
- **OpenGameArt CC0 资源** —— 第三方资源，需 license 标注
- **简化抽象版**（只用头发 + 圆环，忽略五官细节）—— 最简单，最无版权问题

**默认建议**：**自绘简化版**。在 `lib/characters/furina.tsx` 内联 SVG（24×24 viewBox），约 30 行。

## 3. 文件改动

### 3.1 新建

| 文件 | 内容 |
|---|---|
| `components/mini/MiniPlayer.tsx` | 浮层主组件（封面/标题/进度/控制） |
| `components/mini/CharacterOverlay.tsx` | 角色渲染（SVG + 状态动画类切换） |
| `components/mini/MiniPlayer.test.tsx` | 单测（渲染/交互） |
| `components/mini/CharacterOverlay.test.tsx` | 单测（状态 class 切换） |
| `lib/characters/furina.tsx` | 芙宁娜 SVG 内联（自绘简化版） |
| `styles/components/_mini-player.scss` | 浮层样式（glass + brand tint） |
| `styles/components/_character.scss` | 角色样式（定位 + keyframes 动画） |

### 3.2 改动

| 文件 | 改动 |
|---|---|
| `App.tsx` | 加 `playerMode: 'theater' \| 'mini'` state；按 mode 条件渲染 `<TheaterView />` 或 `<MiniPlayer />`；根 div 类名动态 |
| `components/layout/Titlebar.tsx` | 加模式切换按钮 + `onPlayerModeChange` prop |
| `hooks/usePlayer.ts` | 如 mini 需要读 mode，暴露 `playerMode` getter；否则不碰 |
| `styles/abstracts/_variables.scss` | 可能加 mini 颜色变量（**用 token**，不硬编码） |

## 4. 视觉结构（参考用户截图）

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─[cover]┐   你应该对我说谎                              🔁 │
│ │ 32x32 │ 张宇 — 男人的好（新歌 + 精选）           ▶  ▶  │
│ └───────┘   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  2:31 │
│ [furina sits here ▲]                              ⤶   │
└─────────────────────────────────────────────────────────────┘
       ↑ 角色 SVG 绝对定位在顶部，坐姿朝下
  5 个按钮：1 模式切换 / 4 播放控制 / 1 队列
```

**尺寸建议**：
- 浮层宽度 ~ 560px（响应式收缩）
- 高度 ~ 70px（不含角色）
- 角色 SVG 浮出顶部 ~ 40px（看起来"坐"在播放器上）
- 底部固定 24px 边距

## 5. 状态机 & 动画

| 状态 class | 应用位置 | 效果 |
|---|---|---|
| `.mini-mode` | App 根 div | TheaterView 卸载，MiniPlayer mount |
| `.character--playing` | CharacterOverlay | 头轻摆（@keyframes bob） |
| `.character--paused` | CharacterOverlay | 静止帧（无动画） |
| `.character--loading` | CharacterOverlay | 微晃（@keyframes sway） |
| `.character--just-liked` | CharacterOverlay | 飞吻动画（一次性） |

所有动画用 **CSS keyframes**，不引第三方动画库。

## 6. 测试

| 测试 | 文件 |
|---|---|
| MiniPlayer 渲染（无 track / 有 track） | MiniPlayer.test.tsx |
| 播放/暂停/上一首/下一首 callback | MiniPlayer.test.tsx |
| 模式切换按钮 callback | MiniPlayer.test.tsx |
| CharacterOverlay 状态 class 切换 | CharacterOverlay.test.tsx |
| App 集成（mode 切换 audio 不重建） | App.test.tsx（如有） |

`bash scripts/test.sh --ci` 必须绿。

## 7. 风险 / 边界

- **Web Audio context 切换 mode 时丢音频？** —— `<audio>` 永远 mounted（已在 App.tsx），不重建 → 不丢。MiniPlayer 复用 `usePlayer` audioContextRef。
- **角色 SVG 体积**：控制在 < 30KB；P3 皮肤包机制再扩展资源管理。
- **`background-image` 背景层**：theater 时 `bgLayerRef` 设的封面背景，mini 时应淡出（避免浮层背后背景太重）。需在 `.mini-mode` 下给 `.bg-layer` 加 `opacity: 0.2` + transition。
- **快捷键 `Cmd + M` 冲突**：macOS 最小化窗口也是 `Cmd + M`。改用 `Cmd + Shift + M`。
- **角色位置响应窗口尺寸**：窗口太窄时角色可能遮封面/标题——需要媒体查询 `<sm @media (max-width: 1100px)` 隐藏角色。

## 8. 明确不在 P1 scope

- ❌ 独立 BrowserWindow 模式
- ❌ 角色切换 UI（settings dropdown）
- ❌ 节拍反应动画（AnalyserNode frequency → CSS transform）
- ❌ 多角色 / 皮肤包机制
- ❌ mini 模式下歌词显示（lyrics 留在 theater）
- ❌ mini 模式下 reco 卡显示

## 9. 实施顺序（建议 3 phase）

1. **Phase 1 — MiniPlayer 浮层骨架（无角色）**
   - `<MiniPlayer />` 组件 + 模式切换 + CSS 浮层 + App 集成
   - 顶栏按钮 + 快捷键
   - 完整测试套件
   - 约 0.5-1 天

2. **Phase 2 — 角色叠加层**
   - `<CharacterOverlay />` + 芙宁娜 SVG + 状态联动动画
   - 响应式（窄屏隐藏）
   - 完整测试
   - 约 0.5 天

3. **Phase 3 — 集成与打磨**
   - `bash scripts/test.sh --ci` 全量跑过
   - 视觉回归（可选，跑 `visual:test`）
   - lint + typecheck
   - 约 0.5 天

每 phase 一个 commit，PR 走完整 review。

## 10. 用户决策（2026-09-23 已确认）

1. **mini 用 app 内还是独立窗口**？→ ✅ **应用内浮层**（P1）。独立 BrowserWindow 留作 P2+ 备选。
2. **角色 SVG 风格**？→ ✅ **OpenGameArt CC0 资源**（需 license 标注；实施时把来源 + license 写进 `lib/characters/` 头部注释）。
3. **快捷键** `Cmd + Shift + M`？→ ✅ 确认。
4. **mini 浮层宽度** 默认 560px → ✅ 接受（`min(560px, 100% - 48px)` 响应式收缩）。
5. **优先级** → ✅ **只做 Phase 1**（mini 浮层骨架）；角色叠加层等 Figma 稿确认后单独迭代。
6. **芙宁娜的具体姿态**（坐姿抱伞？站立？侧坐？）—— 随角色迭代一起在 Figma 阶段确认。

---

## 11. Figma 设计交付物（用户接下来做的事）

设计稿应包含：
- mini 浮层三态：默认 / hover（按钮高亮）/ playing（进度条 active 颜色）
- 角色状态：playing / paused / loading 三态对照
- 角色姿态草图（侧面 / 正面）
- 浮层在不同窗口宽度下的响应式布局（>=1280 / 1100-1280 / <1100）
- 浮层在 theater view 之上 / 之下的 z-index 关系
- mini 模式下 bg-layer 透明度参考

参考节点：
- 现有 `aether-theater-v4-spec.md`（theater 视觉风格基线）
- 已有 `.source-chip` 配色（品牌色强背景 + logo）作为 chip 类比对齐参考

> 用户额度紧，这份 spec 已经够 Figma 设计阶段用了。等用户确认设计 + P1 scope
> 后，我再开 feature 分支动手。
