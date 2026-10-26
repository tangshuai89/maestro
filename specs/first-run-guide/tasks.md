# 首次启动引导流 —— 任务清单

对应 spec: `specs/first-run-guide/spec.md`

## 1. 状态（纯逻辑）

- [ ] `packages/renderer/src/lib/storage.ts`：`STORAGE_KEYS.onboardingDone`
      （`maestro:onboarding-done`）
- [ ] `packages/renderer/src/lib/onboarding.ts`：- `isOnboardingDone()` / `markOnboardingDone()` / `clearOnboardingDone()` - `shouldShowOnboarding(hasProvider)` —— 纯函数，可测 - 读写 localStorage **全部 try/catch**（隐私模式 / 配额满 → 不能把 App 掀翻）

## 2. 组件

- [ ] `packages/renderer/src/components/onboarding/FirstRunGuide.tsx` - 3 步：欢迎 → AI 推荐（可选）→ 上手 - 右上角「跳过」+ 第 2 步「以后再说」⇒ 任何一步都能跳过 - 第 2 步「现在设置」→ 回调 `onOpenRecoKey`（**复用已有的 `RecoKeyModal`**）- 进度指示（1/3）
- [ ] `packages/renderer/src/styles/components/_first-run-guide.scss` + `styles/main.scss` 引入

## 3. 接线

- [ ] `App.tsx`：选完音源（`player.provider` 变真）+ 没看过引导 → 打开引导
- [ ] `App.tsx`：完成 / 跳过 → 写 flag + 关闭
- [ ] `SettingsModal.tsx`：加「重新看引导」入口（`onReplayGuide` 回调）

## 4. 测试

- [ ] `lib/onboarding.test.tsx`：flag 读写 / `shouldShowOnboarding` 的真值表
- [ ] `components/onboarding/FirstRunGuide.test.tsx`：三步能走完 / 每步能跳过 /
      「现在设置」回调 / 完成后不再出现
- [ ] `App.tsx` 的接线是纯接线层 ⇒ 靠**浏览器覆盖采集**走一遍（见 5）

## 5. 浏览器覆盖采集

- [ ] `scripts/collect-browser-coverage.mjs`：走完 3 步（欢迎 → AI 推荐 → 上手）
      —— 引导是**全屏覆盖层**，不点掉的话**后面所有点击都点不动**
      ⇒ 采集脚本必须先把它走完（顺带把引导的覆盖拿到）

## 6. 门禁

- [ ] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] 全量套件 `bash scripts/test.sh --ci` → EXIT=0
- [ ] 覆盖率 diff 门禁 → ✅ 本次改动的代码全部被执行过
- [ ] 变异验证：把 `markOnboardingDone()` 改成不写 flag → 引导会**反复出现**
      ⇒ 必须被测出来
- [ ] PR 合并后核对内容进 master
