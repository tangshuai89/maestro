# tasks — specs/audio-fx（#7.1 EQ + crossfade）

> 顺序是有依赖的：E1/E2 是地基（纯函数 + 偏好），E3 改 graph，E4 接线，
> E5 UI；crossfade（C 组）必须等 E3 的链结构定型，否则两个都动 `usePlayer` 会打架。

## E 组 — EQ（先做）

- [x] **E1** `lib/audioFx.ts`：10 段频段表 + 8 个预置（纯数据）+ 类型
      + `applyPreset` / `clampGain` / `normaliseGains` / `matchPreset` 等纯函数
      （17 项单测 `audioFx.test.mjs`）
- [x] **E2** `lib/storage.ts`：`STORAGE_KEYS.audioFx` + `read/writeAudioFx`，
      非法值回落默认，进备份集（5 项新用例，`storage.test.mjs` 共 82 项）
      —— 该文件因此有了**值导入**（`./audioFx`），测试需要补 inline ESM loader
- [x] **E3** `usePlayer.ensureAudioGraph` 改造：graph 建立时**一次性**插入
      10 个 BiquadFilter（gain 全 0）；改增益一律 `setTargetAtTime`；analyser 移到
      EQ 之后。链构建/参数推送抽成 `lib/eqChain.ts` 纯函数（8 项白盒 `eqChain.test.mjs`）
- [x] **E4** 接线：App → SettingsModal 传 `audioFx` + 3 个 setter（`setEqEnabled` /
      `setEqBandGain` / `applyEqPreset`，各自落 storage + 推 live filter）
- [x] **E5** SettingsModal 新增「② 音频」节：开关 + 8 预置 + 10 滑块（等宽三列网格）
      + WPS 适用范围提示。⚠️ **「点一下试听该频段」未做**——试听要么发 boost 音、
      要么临时摆一条曲线，都是独立一轮；本轮只做静态调节
- [x] **E6** `audioFx.test.mjs` 17 项 + `SettingsModal.test.tsx` +12 例（共 23）
      —— 含变异验证：注入 `className` 恒 false 时测试曾放过，补断言后能抓住

## C 组 — crossfade（E 组定型后做）

- [ ] **C1** App 常驻第二个 `<audio>`（secondary），与 primary 同级、不进条件渲染
- [ ] **C2** secondary 的 Web Audio 链（独立 `createMediaElementSource`）+ 淡入淡出
      调度（`setTargetAtTime`，不是 `linearRampToValueAtTime`——后者在暂停/中断时
      会留下停在半路的 ramp）
- [ ] **C3** 切歌路径接线：crossfade 关闭 = 现在的行为逐字不变（**默认值必须是关**）
- [ ] **C4** 快速连切护栏 + WPS 生效时 secondary 不参与
- [ ] **C5** crossfade 用例：开关两态行为差异、连按 ⏭ 三次不叠音不静音、
      切模式不重建 `<audio>`（DOM 里恒为 2）

## 门禁

- [ ] `npm test` / `npm run typecheck` / `npm run lint` / `scan-hardcoded-colors --gate`
- [ ] 变异验证：EQ 关掉 → 真旁路（不能只是 0 dB）；crossfade 关 → 与 HEAD 行为一致
