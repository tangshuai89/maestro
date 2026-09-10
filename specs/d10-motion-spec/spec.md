# D10 — MOTION SPEC JSON 化（让 AI parse 动效参数）

> 范围：D3 完成后 12 条 prototype wirings + 3 条自动轮播已在 Figma 里，但 04 · Motion
> 页的 MOTION SPEC frame 是**纯文本**——AI 拿到只能人读。把规格结构化成 JSON
> 写到 frame description + 仓库 `specs/motion-spec.json`，配 audit-d10 校验。
> 关联：`docs/figma-driven-frontend.md` §4.2 + `docs/prototype-wiring-checklist.md` + `scripts/figma-v4-command.md`。

## 0. 现状

- 04 · Motion 页 MOTION SPEC frame：v4-ABC 13 步已建，文字规格 8 条（v4-command.md §沙箱实测规则 + 设计动效）
- 12 条 prototype wirings（D3）：文字表（docs/prototype-wiring-checklist.md）
- 3 条自动轮播 A/B/C（v4 motion SEG2）
- 5 个参数驱动动效（v4-driven-frontend §4.3）：封面呼吸 / 光晕脉动 / EQ 条 / 歌词 stagger / 按钮 press

**问题**：所有这些规格在 Figma 里是文本——AI 通过 description 拿不到结构化字段（trigger / duration / easing / driver）。

## 1. JSON Schema

```json
{
  "version": "1.0",
  "spec": [
    {
      "id": "btn-play-hover",
      "category": "interaction",       // interaction | transition | ambient | screen-flow
      "component": "Core/Play",
      "trigger": "ON_HOVER",            // ON_HOVER | ON_CLICK | ON_PRESS | MOUSE_DOWN | AFTER_TIMEOUT | track-time | audio-reactive
      "from_state": "idle",
      "to_state": "hover",
      "animation": "smart-animate",     // smart-animate | dissolve | spring | css
      "duration_ms": 120,
      "easing": "cubic-bezier(.16,1,.3,1)",
      "driver": null,                   // null | "bass-intensity" | "currentTime" | "pointer"
      "tokens": ["Color/semantic/accent", "Radius/full"],
      "description": "播放键 hover 态：cyan glow + 1.02 缩放"
    }
  ]
}
```

字段：
- **必填**：`id` / `category` / `component` / `trigger`
- **transition 必填**（category=interaction/transition/screen-flow）：`from_state` / `to_state` / `duration_ms` / `easing`
- **ambient 必填**（category=ambient）：`driver` / `description`
- **可选**：`animation`（默认 `smart-animate`）/ `tokens` / `description`

## 2. 范围

| 工作 | 文件 | 类型 |
|---|---|---|
| D10 spec + tasks | `specs/d10-motion-spec/{spec,tasks}.md` | 新 |
| 完整 motion spec 数据（20 条） | `specs/motion-spec.json` | 新 |
| AI CONTRACT 模板（贴到 04 · Motion SPEC frame description） | `specs/d10-motion-spec/fixture-description.md` | 新 |
| Audit 校验脚本（REST + fixture） | `scripts/figma-aether-v4-audit-d10.mjs` | 新 |
| fixture 生成器（含 20 条规格 + 1 条缺字段负面用例） | `scripts/figma-d10-fixture.js` | 新 |
| CI 集成 | `package.json` | 改 |
| 04 · Motion SPEC frame description 写入（用户跑） | Figma UI 手动 | 用户操作 |

## 3. 不在 D10 范围

- **改 Figma 04 · Motion SPEC frame description 实际写入**——需 use_figma 跑 1 段；D10 是仓库内工作
- **3 条自动轮播 A/B/C 写入 Figma**——v4 motion SEG2 已规划但需 Figma UI 手动（参 prototype-wiring-checklist.md）

## 4. 验收（DoD）

- [ ] `node scripts/figma-d10-fixture.js /tmp/d10.json` 生成 fixture
- [ ] `node scripts/figma-aether-v4-audit-d10.mjs --fixture /tmp/d10` → 0 FAIL（20/20）
- [ ] `node scripts/figma-aether-v4-audit-d10.mjs`（真 Figma，需 FIGMA_TOKEN）→ 0 FAIL
- [ ] `npm run test:ci` 末尾自动跑 audit-d10
- [ ] `npm run typecheck` + `npm run lint` 0 error
- [ ] `specs/motion-spec.json` 可被 AI agent 直接 import（每条都有 id + category + component + trigger）

## 5. 数据来源（20 条规格）

| 来源 | 数量 | 类别 |
|---|---|---|
| `docs/prototype-wiring-checklist.md` 12 条 prototype wirings | 12 | interaction |
| `docs/prototype-wiring-checklist.md` 3 条自动轮播 | 3 | screen-flow |
| `docs/figma-driven-frontend.md` §4.3 + v4 motion SEG1 | 5 | ambient |
| **合计** | **20** | — |

## 6. Audit 检查项

对 Figma 04 · Motion 页 MOTION SPEC frame：
1. description 含 `---MOTION_SPEC:---` 段
2. 段内 JSON 可被 `JSON.parse` 解析
3. JSON 顶层有 `spec` 数组
4. 每条 spec 含必填 4 字段（id / category / component / trigger）
5. interaction 类含 transition 必填 4 字段
6. ambient 类含 driver 字段
7. id 全局唯一
8. component 引用 Figma 已存在的组件名（02 页 COMPONENT_SET 名）

退出码：0 = PASS，1 = FAIL，2 = 缺 token/网络错误。
