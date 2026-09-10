# 04 · Motion · MOTION SPEC frame description 模板（D10）

> 把 `specs/motion-spec.json` 压缩为单行 JSON，粘到 04 · Motion 页 MOTION SPEC frame
> 的 description 字段。AI 通过 REST 或 Figma Dev Mode MCP 读这个 frame 时能直接 parse。

## 完整 description 模板（粘到 Figma）

```
---
MOTION_SPEC:
  version: "1.0"
  spec: <整段 specs/motion-spec.json 里的 spec 数组 JSON>
---
```

例如（结构化后单行）：

```
---
MOTION_SPEC:
  version: "1.0"
  spec: [{"id":"btn-play-hover","category":"interaction","component":"Core/Play","trigger":"ON_HOVER","from_state":"idle","to_state":"hover","animation":"smart-animate","duration_ms":120,"easing":"cubic-bezier(.16,1,.3,1)","driver":null,"tokens":["Color/semantic/accent"],"description":"播放键 hover 态：cyan glow + 1.02 缩放"}, ...]
---
```

## 怎么粘到 Figma（用户操作）

### 方案 A — use_figma（推荐）

让 Claude Code + use_figma 跑一段：

```js
const page = figma.root.children.find(p => p.name === '04 · Motion');
const specFrame = page.children.find(n => n.name === 'MOTION SPEC');
const desc = await import('node:fs/promises').then(fs => fs.readFile('./specs/motion-spec.json', 'utf8'));
const json = JSON.parse(desc);
specFrame.description = `---
MOTION_SPEC:
  version: "${json.version}"
  spec: ${JSON.stringify(json.spec)}
---`;
return { updatedNodeId: specFrame.id, specCount: json.spec.length };
```

### 方案 B — 手动（最稳）

1. 跑 `node -e "const s=require('./specs/motion-spec.json');console.log(\`---
MOTION_SPEC:
  version: \\"\${s.version}\\"
  spec: \${JSON.stringify(s.spec)}
---\`)"` 拿到整段文本
2. 打开 Figma → 04 · Motion → 选中 MOTION SPEC frame → 右侧 Properties 面板 → 粘贴 description

### 方案 C — 命令行（fgu 工具）

如果你有 fgu CLI：

```bash
fgu node set-description --node-id "MOTION_SPEC_id" --description "$(node -e 'console.log(require(\"./specs/motion-spec.json\").spec)')"
```

## Audit 校验（跑完后）

```bash
FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d10.mjs
```

期望：`spec_count: 20，all_valid: true`。

## Schema 字段约定

| 字段 | 必填 | 取值 |
|---|---|---|
| `id` | ✅ | 唯一字符串（如 `btn-play-hover`） |
| `category` | ✅ | `interaction` / `transition` / `ambient` / `screen-flow` |
| `component` | ✅ | Figma 已存在组件名（如 `Core/Play`） |
| `trigger` | ✅ | `ON_HOVER` / `ON_CLICK` / `ON_PRESS` / `MOUSE_DOWN` / `AFTER_TIMEOUT` / `track-time` / `audio-reactive` |
| `from_state` / `to_state` | interaction/transition/screen-flow 必填 | 变体名 |
| `duration_ms` | transition/screen-flow 必填 | 整数 |
| `easing` | transition/screen-flow 必填 | CSS easing 或预设 |
| `driver` | ambient 必填 | `bass-intensity` / `currentTime` / `pointer` / `audio-rms` / `track-id-seed` 等 |
| `animation` | ❌ | 默认 `smart-animate` / `css-keyframe` / `spring` |
| `tokens` | ❌ | 数组，引用 Color/Spacing/Radius 变量名 |
| `description` | ❌ | 人读说明 |

## 与 Figma 端的 interactions 字段关系

- **Figma interactions**（D3 手动连的 12 条）— 运行时实际跑的动效
- **本 JSON 规格**（D10）— 描述每条动效的参数（duration / easing / trigger / driver），让 AI parse

两者一致 = Figma 端的连线参数和 JSON 描述对得上。Audit-D10 校验 JSON 自身合规，**不**交叉校验 Figma 实际 interactions（那是 v4-audit.mjs 的事）。
