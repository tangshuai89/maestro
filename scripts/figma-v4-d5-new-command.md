# Figma v4-D5_NEW 落地指令 — 02 · Components 增 10 个 component set

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
规范：`specs/d5-new-components/spec.md`（范围 + 10 组件规格 + 验收）
构建脚本：`scripts/figma-aether-v4-components-d5.js`（2 段 SEG1 + SEG2）
注入器：`scripts/figma-code-connect-inject.mjs`（TBD-FIGMA → 真实 nodeId）
验收工具：
- `scripts/figma-v4-smoke-d5-new.mjs`（mock 端到端）
- `scripts/figma-code-connect-validate.mjs --strict`（110/110 验收）
- `scripts/figma-aether-v4-audit.mjs`（跑 v4 原 23/25 基线，确认 D5_NEW 不破坏）

## 任务

在 Figma `02 · Components` 页**底部第二行**（y=4400+ 起）建 10 个新 component set，
把 `figma-code-connect.json` 里 10 个 `_status: D5_NEW` / `figmaNodeId: TBD-FIGMA`
占位映射全部替换为真实 nodeId。

10 个 set / 28 变体：
| # | figmaComponent | 变体 | 变体数 | React |
|---|---|---|---|---|
| 1 | `Modal/Shell` | `state=default` | 1 | `Modal` |
| 2 | `Modal/ErrorPanel` | `state=collapsed/expanded` | 2 | `ErrorPanel` |
| 3 | `Modal/RecoLoading` | `state=loading/error` | 2 | `RecoLoading` |
| 4 | `SourceChip` | `platform=qq/netease/deezer/spotify` | 4 | `SourceChip` |
| 5 | `Layout/QualityMenu` | `quality=standard/high/lossless` | 3 | `QualityMenu` |
| 6 | `Layout/SourceMenu` | `provider=qq/netease/deezer/spotify` | 4 | `SourceMenu` |
| 7 | `Layout/DeezerPresetSelect` | `state=default/hover/open` | 3 | `DeezerPresetSelect` |
| 8 | `Screen/SourceSelect` | `state=empty/ready` | 2 | `SourceSelect` |
| 9 | `Titlebar` | `state=logged-out/logged-in/logging-in` | 3 | `Titlebar` |
| 10 | `Modal/NeteaseCookie` | `state=empty/qr-shown/cookie-paste/submitting` | 4 | `NeteaseCookieModal` |

> 失败原子性：use_figma 出错时整段不执行、文件无残留；脚本里 `clearOld(setName)` 幂等，
> 改后重跑该段即可（旧同名 set 先删后建）。

## 前置条件

- v4-ABC 13 步已执行（`02 · Components` 已有 11 个 component set + 8 SVG icon）
- D1 6 屏已加（`03 · Screens` 完整）
- D2 Archive README 已加（`99 · Archive` 顶部红色虚线警示框）
- D5 Code Connect 已 merge（`figma-code-connect.json` 10 个 TBD-FIGMA 占位已就位）
- D6 description 模板已用（每个 set description 含 AI_CONTRACT 7 段）
- D10 motion spec 已用（变体只覆盖 1 个属性，跨变体图层名一致 → Smart Animate 兼容）

## Step 1 — 类型校验

```bash
node scripts/figma-v4-typecheck.mjs
```

必须 0 error（含 D5_NEW SEG1 + SEG2）。

## Step 2 — Mock 冒烟

```bash
node scripts/figma-v4-smoke-d5-new.mjs
```

无需 FIGMA_TOKEN，mock 跑 SEG1 + SEG2；必须全 PASS（10/10 set，28/28 variant，
所有 description 含 AI_CONTRACT）。

## Step 3 — 喂 use_figma（2 次调用）

| 步骤 | SEG | 目标 page | 内容 | 完成后验证 |
|---|---|---|---|---|
| D5_NEW-1 | SEG1 | 02 · Components | Modal/Shell + ErrorPanel + RecoLoading + SourceChip + QualityMenu（5 set / 12 变体） | 02 页底部 y=4400 起新 5 个 set |
| D5_NEW-2 | SEG2 | 02 · Components | SourceMenu + DeezerPresetSelect + SourceSelect + Titlebar + NeteaseCookie（5 set / 16 变体） | 02 页 y=4400 + y=5760 续 5 个 set |

参数：
- `currentPage` 不需要手切（脚本内 `setCurrentPageAsync` 自定位 `02 · Components`）
- `code` 参数 = `scripts/figma-aether-v4-components-d5.js` 里 `SEG1` / `SEG2`
  模板字符串内容（去掉外层 `` ` `` 包装）
- 每段预计 30s ~ 1min 内完成；如超时 60s 大概率撞沙箱 50KB 限制，分段重跑

每次返回格式：
```json
{
  "createdNodeIds": ["I1:...", "I2:...", ...],
  "sets": ["Modal/Shell", "Modal/ErrorPanel", ...]
}
```

**把 10 个新 component set 的 `figmaNodeId` 复制出来**（2 段合并成一张表）：

```
Modal/Shell              = Ixxxx
Modal/ErrorPanel         = Ixxxx
Modal/RecoLoading        = Ixxxx
SourceChip               = Ixxxx
Layout/QualityMenu       = Ixxxx
Layout/SourceMenu        = Ixxxx
Layout/DeezerPresetSelect= Ixxxx
Screen/SourceSelect      = Ixxxx
Titlebar                 = Ixxxx
Modal/NeteaseCookie      = Ixxxx
```

## Step 4 — 自动注入（替换 TBD-FIGMA）

把 10 个真实 nodeId 喂给注入器：

```bash
node scripts/figma-code-connect-inject.mjs \
  --ids=Ixxx,Ixxx,Ixxx,Ixxx,Ixxx,Ixxx,Ixxx,Ixxx,Ixxx,Ixxx \
  --names=Modal/Shell,Modal/ErrorPanel,Modal/RecoLoading,SourceChip,Layout/QualityMenu,Layout/SourceMenu,Layout/DeezerPresetSelect,Screen/SourceSelect,Titlebar,Modal/NeteaseCookie
```

注入器会：
1. 按顺序配对 `--ids` 与 `--names`
2. 在 `figma-code-connect.json` 的 `mappings[]` 里找到 `figmaNodeId === 'TBD-FIGMA'`
   且 `figmaComponent === <name>` 的项
3. 把 `figmaNodeId` 替换为对应的 `Ixxx`
4. 把 `_status` 从 `D5_NEW` 改为 `D1_DONE`（与 D1 屏统一）
5. 移除 `_note` 字段（已无意义）
6. 改 `$history` 加 D5_NEW 条目
7. 写回文件 + 打印替换前/后 diff

## Step 5 — 验收

### 5.1 — code-connect strict 100%

```bash
node scripts/figma-code-connect-validate.mjs --strict
```

必须 **110/110 PASS**（之前是 100/110，10 个 TBD-FIGMA 占位 FAIL，现全替换为真 nodeId）。

### 5.2 — v4 audit 不破

```bash
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit.mjs
```

基线 23/25 + D2 README 不破；D5_NEW 是增量不修改原 11 个 set，EXPECTED_SETS
**暂时不变**（在 PR C1 步骤再追加 10 个 D5_NEW set 到 EXPECTED_SETS 防误删）。

### 5.3 — v4 typecheck

```bash
node scripts/figma-v4-typecheck.mjs
```

## Step 6 — 视觉确认

- 截图 `02 · Components` 页底部，确认 10 个新 component set 整齐排列
- 每个 set description 展开后含 `---...---` 段 + AI_CONTRACT 7 字段
- 10 个 set 的变体名格式都是 `key=value`（D6 audit 解析依赖）
- Smart Animate 兼容：同 set 跨变体图层名一致

## 完成后

- 截图入 PR 描述
- `CHANGELOG.md` 加 D5_NEW 条目
- `docs/figma-driven-frontend.md §3` 把 10 个新映射从「待 Figma」挪到「完成」
- `docs/figma-driven-frontend.md §9` 项目状态加 W37 进度
- 在 PR 描述里写明 AI 友好度从 91 → 95

## 风险与回滚

- **沙箱 50KB 限制**：SEG1 偏大（~17KB），SEG2 更大（~19KB）；如超时/超 50KB 报错，
  把 SEG2 拆成 SEG2a（SourceMenu + DeezerPresetSelect + SourceSelect）+ SEG2b（Titlebar + NeteaseCookie），
  重新 `` ` `` 包装导出
- **font 缺失**：脚本内已 `loadFontAsync` Inter Regular/Semi Bold + JetBrains Mono Regular；
  如报"Missing font"通常是 figma 端没装对应字族，重新加载即可
- **变体默认串位**：combineAsVariants 合并同名属性时默认值统一为第一个变体；
  D5_NEW 设计原则「每组件 ≤1 个变体属性 + 复杂数据用 component property」规避了此问题
- **失败重跑**：`clearOld(setName)` 已幂等，重跑同段会先删旧 set 再建新 set；
  如果只跑了 SEG1、SEG2 失败，分开重跑 SEG2 即可
