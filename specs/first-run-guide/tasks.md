# 首次启动引导流 —— 任务清单

对应 spec: `specs/first-run-guide/spec.md`

## 1. 状态（纯逻辑）

- [x] `packages/renderer/src/lib/storage.ts`：`STORAGE_KEYS.onboardingDone`
      （`maestro:onboarding-done`）
- [x] `packages/renderer/src/lib/onboarding.ts`：- `isOnboardingDone()` / `markOnboardingDone()` / `clearOnboardingDone()` - `shouldShowOnboarding(hasProvider)` —— 纯函数，可测 - 读写 localStorage **全部 try/catch**（隐私模式 / 配额满 → 不能把 App 掀翻）

## 2. 组件

- [x] `packages/renderer/src/components/onboarding/FirstRunGuide.tsx` - 3 步：欢迎 → AI 推荐（可选）→ 上手 - 右上角「跳过」+ 第 2 步「以后再说」⇒ 任何一步都能跳过 - 第 2 步「现在设置」→ 回调 `onOpenRecoKey`（**复用已有的 `RecoKeyModal`**）- 进度指示（1/3）
- [x] `packages/renderer/src/styles/components/_first-run-guide.scss` + `styles/main.scss` 引入

## 3. 接线

- [x] `App.tsx`：选完音源（`player.provider` 变真）+ 没看过引导 → 打开引导
- [x] `App.tsx`：完成 / 跳过 → 写 flag + 关闭
- [x] `SettingsModal.tsx`：加「重新看引导」入口（`onReplayGuide` 回调）

## 4. 测试

- [x] `lib/onboarding.test.tsx`：flag 读写 / `shouldShowOnboarding` 的真值表
- [x] `components/onboarding/FirstRunGuide.test.tsx`：三步能走完 / 每步能跳过 /
      「现在设置」回调 / 完成后不再出现
- [x] `App.tsx` 的接线是纯接线层 ⇒ 靠**浏览器覆盖采集**走一遍（见 5）

## 5. 浏览器覆盖采集

- [x] `scripts/collect-browser-coverage.mjs`：走完 3 步（欢迎 → AI 推荐 → 上手）
      —— 引导是**全屏覆盖层**，不点掉的话**后面所有点击都点不动**
      ⇒ 采集脚本必须先把它走完（顺带把引导的覆盖拿到）
- [x] 再走一遍「开设置 → 点『重新看引导』→ 引导重新打开 → 跳过」
      —— `onReplayGuide` 那行是 App.tsx 的**新增行**，门禁会查它有没有被执行过

## 5b. 门禁一路抓出来的**配套改动**（不改就红）

- [x] `tests/visual/theater.spec.mjs`：截图前标记「引导已看过」（那个 job 比的是**剧场视图**，
      引导盖上来截图就全对不上）
- [x] `tests/e2e/fullchain.spec.mjs`：跨包 E2E 也要标记 —— 引导的遮罩把点击全拦下
      （实测挂在「收藏」那一步：`frg-overlay intercepts pointer events`）
- [x] `seedProvider(page, provider, { onboardingDone })`：浏览器覆盖采集**故意不传**
      ⇒ 它要**走一遍**引导，顺带把引导自己的覆盖采到
- [x] 点「重新看引导」时**顺手把设置关掉**（两个都是整屏覆盖层，叠着会互相挡：
      设置 z=100，引导 z=55 ⇒ 不关的话用户点了「重新看引导」却什么都没看见）

## 6. 门禁

- [x] `npm run typecheck` 全绿
- [x] `npm run lint` 全绿（0 error；16 个 warning 是仓库既有的）
- [x] 全量套件 `bash scripts/test.sh --ci` → EXIT=0
- [x] 覆盖率 diff 门禁（base = `0685467`）→ ✅ 本次改动的代码全部被执行过
- [x] 变异验证：把 `markOnboardingDone()` 改成不写 flag → 引导会**反复出现**
      ⇒ **红**（断言1 文件内容确实变了；断言2 `onboarding.test.tsx` 3 failed / 8 passed）
- [x] PR 合并后核对内容进 master（PR #139 已合；master 里有 `components/onboarding/FirstRunGuide.tsx` + `lib/onboarding.ts` ✅）
