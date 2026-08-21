# AETHER v4 构建任务（headless 执行提示词）

你是 Figma 设计稿构建执行者。目标：把 Figma 文件 FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）从「v3 单画布」改造为「AI 驱动设计稿」。

## 执行依据（唯一权威，先读再动手）

1. `scripts/figma-v4-command.md` — 完整执行手册（13 步顺序、页面切换、验证点、规则、观察点）
2. 构建脚本（每段 = 一次 use_figma 调用，code 参数 = 对应 JS 文件里该 SEGMENT 模板字符串的内容，不含 module.exports）：
   - `scripts/figma-aether-v4-foundations.js`（SEG0-SEG3）
   - `scripts/figma-aether-v4-components.js`（SEG1-SEG4）
   - `scripts/figma-aether-v4-screens.js`（SEG1-SEG3）
   - `scripts/figma-aether-v4-motion.js`（SEG1-SEG2）

## 执行规则（硬性）

1. **每次 use_figma 调用前必须先加载 use_figma 技能**（MCP 服务器提供），按其规则执行（字体加载、返回节点 ID、失败原子性等）。
2. 按命令手册表格顺序执行 13 步：Step 0 先跑 `scripts/figma-aether-v4-snapshot.js` 的 SEG1（只读快照，报告当前页面清单），然后 foundations → components → screens → motion。
3. 每一步完成后用 get_screenshot 验证并简短记录结果（创建了什么、返回的节点 ID）。
4. **不要修改 scripts/ 下任何文件**；不要跳过任何步骤；不要自作主张改变命名或结构。
5. **任何一步报错：立即停止**，原样报告：完整错误信息 + 出错段名 + 当前已完成到哪一步。不要尝试自行修复代码。
6. 已知预期（无需惊讶或干预）：
   - Step 0 快照会显示 Page 1 下 4 个 frame（AETHER — Canvas + 3 个 AETHER THEATER 系列）——SEG0 会把当前页整体改名归档为 `99 · Archive`，这些内容原样保留；
   - SEG1（foundations）会清理 7 个 v3 遗留变量（bg/neon-cyan/glass-bg/glass-stroke/text-main/text-dim/text-muted）并创建 49 个分组变量——这是预期行为；
   - 文件里目前没有组件集/样式——components/screens 段会全部新建。
7. 全部 13 步完成后：
   - 对 4 个页面（01 Foundations / 02 Components / 03 Screens / 04 Motion）各截一张图；
   - 用只读 use_figma 代码确认：02 页组件集数量与变体数（Button/Icon=12, Button/Play=4, Badge/Platform=8, Tag/Label=8, Cover/Art=3, Lyrics/Line=3, Progress/Seekbar=3, Card/Glass=4, Card/Reco=2, Controls/Transport=2，另有 Track/Info 组件）、03 页 4 个屏幕、04 页 MOTION SPEC 表存在；
   - 输出最终报告：每步结果摘要、确认结果、任何异常。

## 输出格式

最终报告用中文，包含：
- 13 步各自的结果（成功/失败 + 关键节点 ID）
- 最终确认清单（组件集/变体数/屏幕/SPEC 表）
- 截图说明（每页一张）
- 如有错误：完整错误信息
