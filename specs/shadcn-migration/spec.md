# shadcn/ui 迁移（shadcn-migration）

## 做什么

把 shadcn/ui + Tailwind CSS 接入 renderer，建立"组件库底座"，让后续 component-heavy 工作（toast / 复杂 modal / 桌面歌词浮窗 / NL 歌单 chat UI）有可复用的高 a11y 组件层。

按 [ADR-001](../adr/ADR-001-shadcn-migration.md) 决策：
- **shadcn/ui ownership 模式**：CLI 复制源码到 `packages/renderer/src/components/ui/`
- **Tailwind CSS** 装到 `packages/renderer`（Electron 主进程 / Extension 不动）
- **AETHER 令牌桥接**：shadcn 用 HSL 三元组（`--accent: 195 100% 50%`），AETHER 用 hex（`--accent: #00E5FF`）—— 桥接 `tokens-bridge.scss` 一层映射
- **SCSS 渐进迁移**：45 个 `_*.scss` 按模块分批迁移

## 验收标准

### Phase 1：基础设施（必须本 PR 通过）
- [ ] `packages/renderer/package.json` 加 `tailwindcss` / `postcss` / `autoprefixer` / `class-variance-authority` / `clsx` / `tailwind-merge` / `tailwindcss-animate` / `@radix-ui/react-*`
- [ ] `tailwind.config.js` 生成（AETHER 令牌 + HSL 三元组）
- [ ] `postcss.config.js` 接 Tailwind 编译链
- [ ] `src/styles/base/tokens-bridge.scss`：把 AETHER `--accent` 等映射到 shadcn `--background`, `--foreground`, `--primary` 等 HSL 三元组
- [ ] `src/styles/base/_base.scss` 加 `@tailwind base/components/utilities` 三层
- [ ] shadcn CLI 初始化 `components.json`（base color = neutral / css variables = true）
- [ ] 复制 3 件套组件验证：`Button` / `Dialog` / `Tooltip`（用于高频场景，先验证 ownership 模式 + 编译链 + a11y）
- [ ] 桥接正确性：`tsx <Button className="bg-primary text-primary-foreground">` 渲染出 AETHER 主题色（截图断言）
- [ ] 现有 AETHER `TheaterView` + `LikedLibraryModal` 视觉不变（D11 visual:test 6/6 绿，零 baseline 漂移）
- [ ] `npm run typecheck` ✅ + `npm run lint` ✅ + `npm test` ✅
- [ ] `scripts/check-token-drift.mjs` ✅（不引入新漂移）+ `scripts/scan-hardcoded-colors.mjs --gate` ✅（不引入新硬编码）

### Phase 2：组件迁移（按模块分批，本 PR 仅批 1）
- [ ] 批 1：迁移 `_liked-modal.scss` 的 45 处硬编码颜色到 shadcn theme（如 Liked / Search / SettingsModal 各保留原风格）
- [ ] 每批一个 commit，D11 视觉回归 baseline 兜底
- [ ] 每批下调 `scripts/token-adoption-budget.json` 对应数字

### Phase 3：桥接清理（远期）
- [ ] SCSS 全面迁移后，移除 `tokens-bridge.scss` 间接层
- [ ] shadcn 主题切换（dark/light）原生支持（AETHER 本身已 dark，v2 暂不切）

## 数据模型

### AETHER 现有令牌 → shadcn tokens 映射表

| AETHER 令牌 | AETHER 值 | shadcn token | shadcn 值（HSL 三元组） |
|---|---|---|---|
| `--accent` | `#00E5FF` | `--primary` / `--ring` / `--chart-1` | `195 100% 50%` |
| `--status-error` | `#FF3B5C` | `--destructive` | `349 100% 67%` |
| `--status-success` | `#3DFFA2` | `--success`（**新增 shadcn 命名**）| `151 100% 62%` |
| `--status-warning` | `#FFD93D` | `--warning`（**新增**）| `50 100% 62%` |
| `--status-info` | `#3D9BFF` | `--info`（**新增**）| `214 100% 62%` |
| `--text-main` | `#F5F0E8` | `--foreground` | `38 50% 93%` |
| `--text-dim` | `#94A3B8` | `--muted-foreground` | `215 16% 65%` |
| `--surface-deep` | `#02020A` | `--background` | `240 65% 4%` |
| `--surface-mid` | `#0E0B1F` | `--card` / `--popover` | `252 67% 8%` |
| `--surface-raised` | `#1A1A2E` | `--secondary` | `240 23% 14%` |
| `--border-subtle` | `rgba(255,255,255,0.1)` | `--border` | `0 0% 100% / 0.1` |
| `--accent-warm`（C4 新增）| `#FF3D1A` | `--accent-warm`（**新增**）| `9 100% 55%` |
| `--accent-blue`（C4 新增）| `#3B82F6` | `--accent-blue`（**新增**）| `217 91% 60%` |
| `--accent-purple`（C4 新增）| `#A855F7` | `--accent-purple`（**新增**）| `271 91% 65%` |

> **shadcn 主题未定义 `--success` / `--warning` / `--info` / `--accent-warm` / `--accent-blue` / `--accent-purple`**——本 spec 在桥接层补齐（即 `tokens-bridge.scss` 输出 `--success: 151 100% 62%`，shadcn 组件直接消费）。

### tokens-bridge.scss 结构

```scss
// AETHER 既有 hex 令牌（不动命名）
:root {
  --accent: #00E5FF;
  --status-error: #FF3B5C;
  --status-success: #3DFFA2;
  --status-warning: #FFD93D;
  --status-info: #3D9BFF;
  --text-main: #F5F0E8;
  --text-dim: #94A3B8;
  --surface-deep: #02020A;
  --surface-mid: #0E0B1F;
  --surface-raised: #1A1A2E;
  --border-subtle: rgba(255, 255, 255, 0.1);
  --accent-warm: #FF3D1A;
  --accent-blue: #3B82F6;
  --accent-purple: #A855F7;
}

// shadcn HSL 三元组（从 AETHER 派生）
@layer base {
  :root {
    --background: 240 65% 4%;
    --foreground: 38 50% 93%;
    --card: 252 67% 8%;
    --card-foreground: 38 50% 93%;
    --popover: 252 67% 8%;
    --popover-foreground: 38 50% 93%;
    --primary: 195 100% 50%;
    --primary-foreground: 240 65% 4%;
    --secondary: 240 23% 14%;
    --secondary-foreground: 38 50% 93%;
    --muted: 240 23% 14%;
    --muted-foreground: 215 16% 65%;
    --accent: 195 100% 50%;
    --accent-foreground: 240 65% 4%;
    --destructive: 349 100% 67%;
    --destructive-foreground: 38 50% 93%;
    --success: 151 100% 62%;   // AETHER 派生
    --warning: 50 100% 62%;     // AETHER 派生
    --info: 214 100% 62%;      // AETHER 派生
    --accent-warm: 9 100% 55%; // AETHER 派生
    --accent-blue: 217 91% 60%;// AETHER 派生
    --accent-purple: 271 91% 65%;// AETHER 派生
    --border: 0 0% 100% / 0.1;
    --input: 0 0% 100% / 0.15;
    --ring: 195 100% 50%;
    --radius: 0.5rem;
  }
}
```

## 接入步骤（顺序敏感）

### Step 1：Tailwind + PostCSS 装包
```bash
cd packages/renderer
npm i -D tailwindcss postcss autoprefixer
npm i clsx class-variance-authority tailwind-merge tailwindcss-animate
npm i @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-slot
npx tailwindcss init -p
```

### Step 2：shadcn 初始化
```bash
npx shadcn@latest init
# base color: neutral
# css variables: true
# Server Components: no（renderer 是 client-only）
```

### Step 3：复制 3 件套验证
```bash
npx shadcn@latest add button dialog tooltip
# 验证：src/components/ui/{button,dialog,tooltip}.tsx 落地
```

### Step 4：tokens-bridge.scss 落地
- 文件：`packages/renderer/src/styles/base/tokens-bridge.scss`
- 内容：见上 §数据模型 / 结构
- main.scss 加 `@use 'base/tokens-bridge'`

### Step 5：TheaterView 烟雾测试
- 加一行 `<Button>test</Button>` 截图断言（D11 visual:test）
- 6/6 绿 + 零 baseline 漂移

### Step 6：SCSS 模块批 1（PR #91+ 单独立 PR）
- `_liked-modal.scss` 的 45 处硬编码颜色 → shadcn theme
- budget 下调（24 处 + 它引用的组件同步换）

## 不做什么

- ❌ 不全量迁移 SCSS 到 Tailwind——45 个 `_*.scss` 按模块分批（每周一批），不在本 PR
- ❌ 不接入 Tailwind 主题切换（dark/light 切换）——AETHER 已 dark，v2 暂不切
- ❌ 不重命名 AETHER 既有 hex 令牌（`--accent` / `--surface-deep` 等保留 hex + 不动命名）——shadcn 用 HSL 三元组通过桥接层复用
- ❌ 不动 SCSS 模板（`_modal.scss` / `_settings-modal.scss` 等的 layout / spacing / typography）——shadcn 只接管颜色/组件原语，不接管布局
- ❌ 不在 Electron 主进程 / Extension / Server 装 Tailwind——只在 `packages/renderer`
- ❌ 不接入 shadcn 全部 50+ 组件——只接 3 件套验证（Button / Dialog / Tooltip），后续按需
- ❌ 不写 shadcn 主题切换 demo（dark/light）——本期 AETHER 单 dark 主题

## 技术约束

- shadcn 组件**完全 ownership**——任何定制（加 emoji button、改 Button size）都直接改 `src/components/ui/*.tsx`，不通过 monkey-patch
- Tailwind className 与 SCSS className 共存期，**新组件用 Tailwind**，旧 SCSS 按模块迁移——移除文件 `scripts/token-adoption-budget.json` 对应数字
- **HSL 三元组 vs hex**：AETHER 既有 hex 保留，shadcn 需要 HSL 通过 `hsl(var(--primary))` 包装——桥接层只翻译，不引入 RGB→HSL 自动算（手工命令难调里说过）
- **D4 token 系统必须保持一致**：新增 shadcn tokens 后 `check-token-drift.mjs` 仍需绿——bridge 在生成层（`_tokens.generated.scss`）派生
- **D11 视觉回归**：本 PR 不能引入 baseline 漂移——新 `<Button>` 测试组件放在 isolated modal 里（**不进** TheaterView / LikedLibraryModal 等已 baseline 化页面）
- **bundle size** 预算：+30KB gzip 以内（Tailwind PurgeCSS + Radix 已 shakable）

## 接口规格

### 新文件 `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        // ... 全部 shadcn tokens
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        accentWarm: 'hsl(var(--accent-warm))',
        accentBlue: 'hsl(var(--accent-blue))',
        accentPurple: 'hsl(var(--accent-purple))',
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: { /* tailwindcss-animate defaults */ },
      animation: { /* tailwindcss-animate defaults */ },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

### `postcss.config.js`

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### `components.json`（shadcn CLI 输出）

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/styles/base/tokens-bridge.scss",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

### `src/lib/utils.ts`（shadcn CLI 输出，cn helper）

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## 状态存储

- `_tokens.generated.scss` 新增 6 个 token（`--accent-warm` / `--accent-blue` / `--accent-purple` / `--status-warning` / `--status-info` / `--success`）—— 走 `scripts/figma-tokens-dump.json` + `figma-export-tokens.mjs` 自动同步
- shadcn HSL 三元组**不入 Figma**——只在 `_tokens.generated.scss` 派生，Figma 仍只管 RGB
- `tokens-bridge.scss` **不入 git diff 频繁区域**——一次性提交，后续不动（除非 AETHER 令牌改了）

## 文件改动清单

### 新增文件
| 文件 | 内容 | 来源 |
|---|---|---|
| `packages/renderer/tailwind.config.js` | Tailwind 配置 | 新 |
| `packages/renderer/postcss.config.js` | PostCSS 配置 | 新 |
| `packages/renderer/components.json` | shadcn CLI 配置 | `npx shadcn init` |
| `packages/renderer/src/styles/base/tokens-bridge.scss` | AETHER → shadcn HSL 桥接 | 新 |
| `packages/renderer/src/components/ui/Button.tsx` | shadcn Button（ownership 复制）| `npx shadcn add button` |
| `packages/renderer/src/components/ui/Dialog.tsx` | shadcn Dialog（Radix Primitives）| `npx shadcn add dialog` |
| `packages/renderer/src/components/ui/Tooltip.tsx` | shadcn Tooltip（Radix Primitives）| `npx shadcn add tooltip` |
| `packages/renderer/src/lib/utils.ts` | shadcn `cn()` helper | `npx shadcn init` |
| `packages/renderer/src/components/__sandbox/ButtonSmoke.tsx` | 烟雾测试组件（不进任何 baseline 页面）| 新 |

### 改动文件
| 文件 | 改动 |
|---|---|
| `packages/renderer/package.json` | 加 deps / devDeps；scripts 加 `tokens:tailwind:check` |
| `packages/renderer/src/styles/base/_base.scss` | 加 `@tailwind base/components/utilities` 三层 |
| `packages/renderer/src/styles/main.scss` | 加 `@use 'base/tokens-bridge'` |
| `scripts/figma-tokens-dump.json` | 加 6 个新 token（`Color/semantic/{status-warning,status-info,accent-warm,accent-blue,accent-purple,success}`）|
| `scripts/figma-tokens-dump-seg.js` | 新增 6 token 的 Figma mock 段（CI 离线腿）|
| `packages/renderer/src/styles/base/_tokens.generated.scss` | 自动同步生成 6 个新 hex + HSL 三元组（CI 跑 `tokens:export`）|

### 不动（**强约束**）
- `docs/adr/ADR-001-shadcn-migration.md` —— ADR 已拍板，spec 不能改
- `packages/server/**` —— Tailwind/shadcn 只在 renderer
- `packages/electron/**` —— 同上
- `packages/extension/**` —— 同上
- `packages/common/**` —— shadcn 不跨包
- SCSS 文件本身（45 个 `_*.scss`）—— Phase 2 才动，本 PR 不动

## 排期（commit 切分）

| commit | 内容 | 估时 |
|---|---|---|
| 1 | `chore(renderer): install tailwind + radix + cva` | 30min |
| 2 | `feat(tokens): add 6 new tokens (status-warning/info, accent-warm/blue/purple, success)` | 30min |
| 3 | `feat(tokens): add tokens-bridge.scss mapping AETHER → shadcn HSL` | 1h |
| 4 | `chore(renderer): init shadcn + copy button/dialog/tooltip` | 1h |
| 5 | `feat(ui): add ButtonSmoke sandbox component` | 30min |
| 6 | `test(visual): add button-smoke screenshot to D11 baseline` | 30min |
| 7 | `docs(spec): shadcn-migration spec.md`（本文件）| — |
| **总** | | **~4h 工作** / 6 提交 / 1 PR |

**PR merge 后**：status `proposed` → `accepted`，ADR-001 拍板。

## 不在本 PR 范围

- ❌ SCSS 模块批 1（`specs/token-adoption` S3-7）——后续单独 PR
- ❌ shadcn 主题切换（dark/light）——v2 远期
- ❌ 把 shadcn 加进 Figma Code Connect ——`specs/d5-code-connect` 后续
- ❌ 重命名 AETHER hex 令牌为 HSL ——**绝不**（破坏现有 baseline）

## 风险与兜底

| 风险 | 兜底 |
|---|---|
| Tailwind bundle size 超预算 | PurgeCSS 配置 + `content: ['./src/**/*.{ts,tsx}']` 严格限定 → 估计 +20KB gzip |
| Radix 增加 bundle | Radix Primitives tree-shakable，Dialog/Tooltip 各自 ~5KB gzip |
| HSL 桥接失效（颜色不对）| D11 visual:test 加 button-smoke baseline 验证；失败即阻塞修 |
| shadcn 升级破坏 ownership 组件 | 锁定 shadcn 版本（不 `npx shadcn@latest` 升级）→ 半年手动同步 |
| SCSS ↔ Tailwind 混用期代码风格分裂 | ESLint 规则禁止 `<div className="...">` + SCSS `className` 混用强制选一 |

## 相关文档

- [ADR-001](../adr/ADR-001-shadcn-migration.md) —— 决策依据
- [specs/token-adoption/](../token-adoption/spec.md) —— AETHER 令牌专题
- [specs/d4-token-drift/](../d4-token-drift/spec.md) —— 双向漂移门禁
- [docs/figma-driven-frontend.md](../../docs/figma-driven-frontend.md) —— Figma 驱动前端
- [docs/visual-regression.md](../../docs/visual-regression.md) —— D11 baseline 兜回归
