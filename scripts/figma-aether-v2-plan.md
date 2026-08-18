# AETHER ENGINE v2 — Figma 设计师级设计稿构建方案

目标：把 `FtbRZXvzlCp4Sq9e322cQQ` 的 frame 1-2 升级为**设计师可认可**的专业播放器界面。
区别于 v1（功能堆叠）：v2 强调设计系统、视觉层次、间距节奏、排版细节。

## v2 核心升级点

### 1. 设计令牌（Figma Variables）
创建变量组：
- `AETHER/Color/*`：bg-top #0A0518 / bg-bottom #02020A / neon-cyan #00E5FF /
  electric-purple #5B2BFF / acid-purple #B57BFF / off-white #F5F0E8 /
  heart-red #FF3B5C / neon-green #3DFFA2 / warning-yellow #FFD93D / info-blue #3D9BFF
- `AETHER/Spacing/*`：2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96
- `AETHER/Radius/*`：8 / 12 / 16 / 20 / 24
- `AETHER/Type/*`：display-44 / title-28 / body-16 / caption-12 / mono-10

### 2. 布局重构（1440×900 → 更专业的信息层级）

```
┌─────────────────────────────────────────────────────┐
│ 40px 顶部条：雷达 + HUD×4 + SYNC计数        (z=1)    │
│ 56px 平台徽章行（Q/N/D/S + 当前源高亮）              │
├───────────────────────────────┬─────────────────────┤
│ 左栏 480px                    │ 右栏 弹性            │
│ ┌───────────────────────────┐ │ ┌─────────────────┐ │
│ │ 封面 420×420（霓虹描边+光晕）│ │ 歌词玻璃卡        │ │
│ │ 曲名 44px / 艺术家 18px    │ │  LYRICS 标签      │ │
│ │ 专辑 · 码率标签            │ │  3行歌词（大当前行）│ │
│ └───────────────────────────┘ │  来源 + 滚动指示   │ │
│                               │ └─────────────────┘ │
├───────────────┬───────────────┼─────────────────────┤
│ DEEP.SEEK 推荐 │ 控制台（语义化）│ 播放进度（全宽）    │
│ 3 卡横排       │ 上一首/收藏/播放 │ 02:47 ─●── 04:31  │
│               │ /下一首/切换源  │                     │
└───────────────┴───────────────┴─────────────────────┘
```

### 3. 控制菜单语义化（v1 的 FIGHT/BAG/PKMN/RUN 是宝可梦语义，设计师会否）
改为播放器语义按钮：
- ⏮ 上一首（skipprevious）
- ♥ 收藏（heart，红心色，可点亮）
- ▶ 中央播放（72px 霓虹青，发光）
- ⏭ 下一首
- 🔀 随机 / 🔁 循环（图标化，激活态青色）
- ⇄ 切换来源（platform swap）

### 4. 视觉细节（设计师关注点）
- **间距节奏**：统一用 8pt 网格（4/8/16/24/32/48），拒绝随机间距
- **文字层级**：标题/正文/说明/等宽四档，字重和字距精确（display 用 -2% 字距）
- **玻璃层次**：卡片 6% 白 + 12% 描边 + 24 圆角；浮层 8% + 16% 描边 + 16 圆角
- **状态色语义**：青=播放/激活，红=收藏，紫=AI，绿=同步，黄=QQ，蓝=Deezer
- **封面光效**：外层 24px 模糊电紫光晕 + 内层 2px 霓虹青细描边 + 角部括号装饰
- **进度条**：2px 细轨道（白 20%）+ 4px 霓虹青填充（发光）+ 8px 圆形滑块（白 100% 青描边）

## 执行策略（分步，每步一个 use_figma 调用）

1. **Step 1**：创建变量组 + 清理旧 frame 内容
2. **Step 2**：重建背景层（渐变 + 星尘 + 光晕 + 网格）
3. **Step 3**：顶部条 + 平台徽章
4. **Step 4**：左栏歌曲卡
5. **Step 5**：右栏歌词面板
6. **Step 6**：底部（推荐区 + 控制台 + 进度条）
7. **Step 7**：截图验证 + 细节修正

## 代码模板（use_figma 的 code 参数，Plugin API 风格）

```js
// 变量创建
await figma.variables.createVariableCollection('AETHER');
const col = figma.variables.variableCollections[figma.variables.variableCollections.length - 1];
const modeId = col.modes[0].modeId;
async function addVar(name, value) {
  const v = figma.variables.createVariable(name, col, 'COLOR');
  v.setValueForMode(modeId, { type: 'COLOR', r: value[0]/255, g: value[1]/255, b: value[2]/255, a: 1 });
}
await addVar('bg-top', [10, 5, 24]);
// ... 等

// 高效节点创建（官方 skill 推荐）
const { createAutoLayout } = await import('@figma/plugin-api/helpers');
// 或直接用 figma API
function frame(name, w, h, opts = {}) {
  const f = figma.createFrame();
  f.name = name; f.resize(w, h);
  f.fills = opts.fills ?? [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  f.layoutMode = opts.layoutMode ?? 'NONE';
  return f;
}
```

注意：use_figma 的 code 是独立 JS 沙箱（50k 上限），用 figma.createXxx + node.set 高效写法，
避免逐属性赋值；大批量节点用 query/set 批量。
