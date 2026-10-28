<!--
  提 PR 前过一遍下面这份清单。
  这几条都是**仓库已经在守**的门禁（不是"建议"），写在这里是为了让贡献者
  在一处看完 —— 少一个去处就少一次"忘了"。

  两条 ☐ 是**条件触发**的：只在你的改动碰到对应东西时才需要勾。
-->

## 这次改了什么

<!-- 一两句话说清：改了什么、为什么。关联的 spec / issue 写在这里。 -->

## 检查清单

**必做**

- [ ] `npm run typecheck` → 0 error
- [ ] `npm run lint` → 0 error（新文件 0 warning）
- [ ] 全量套件 `bash scripts/test.sh --ci` → **EXIT=0**
- [ ] 覆盖率 diff 门禁绿（本次**新增/修改的代码行**必须被执行过）
- [ ] `CHANGELOG.md` 记了用户可见的行为变化

**条件触发**

- [ ] **新增或修改了动效**（SCSS 里的 `transition` / `animation` / `@keyframes`）？
      → `specs/motion-spec.json` 加了对应条目
      （规格见 `specs/d10-motion-spec/`；Figma 侧还要同步，校验跑
      `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d10.mjs`）
- [ ] **新建了组件**？
      → `specs/d5-new-components/component-specs.md` 更新
      + `node scripts/figma-aether-v4-audit.mjs` 通过
      （`--self-test` 离线可跑，会核对 10 个 D5 组件集与规格文档是否一致）
- [ ] **改了 `specs/**` 下的文件**？
      → 对应 `tasks.md` 的**验收清单**勾上了（**括号里写证据**：CI 的 step 结论 /
      变异验证结果 / 核对到 master 的哪一处）—— 清单本身就是门禁的一部分，
      勾错等于门禁不存在
- [ ] **改了打包产物**（`packages/*/dist` 相关、构建脚本、依赖）？
      → `node packages/electron/scripts/pack.cjs --self-test` +
      `npm run pack:verify` 通过（出货产物不许带测试代码 / 陈旧产物 / 源码）
