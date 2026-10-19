# tasks — specs/audio-fx（#7.1 EQ + crossfade）

> 顺序是有依赖的：E1/E2 是地基（纯函数 + 偏好），E3 改 graph，E4 接线，
> E5 UI；crossfade（C 组）必须等 E3 的链结构定型，否则两个都动 `usePlayer` 会打架。

## E 组 — EQ（先做）

- [x] **E1** `lib/audioFx.ts`：10 段频段表 + 8 个预置（纯数据）+ 类型 + `applyPreset` / `clampGain` / `normaliseGains` / `matchPreset` 等纯函数
      （17 项单测 `audioFx.test.mjs`）
- [x] **E2** `lib/storage.ts`：`STORAGE_KEYS.audioFx` + `read/writeAudioFx`，
      非法值回落默认，进备份集（5 项新用例，`storage.test.mjs` 共 82 项）
      —— 该文件因此有了**值导入**（`./audioFx`），测试需要补 inline ESM loader
- [x] **E3** `usePlayer.ensureAudioGraph` 改造：graph 建立时**一次性**插入
      10 个 BiquadFilter（gain 全 0）；改增益一律 `setTargetAtTime`；analyser 移到
      EQ 之后。链构建/参数推送抽成 `lib/eqChain.ts` 纯函数（8 项白盒 `eqChain.test.mjs`）
- [x] **E4** 接线：App → SettingsModal 传 `audioFx` + 3 个 setter（`setEqEnabled` /
      `setEqBandGain` / `applyEqPreset`，各自落 storage + 推 live filter）
- [x] **E5** SettingsModal 新增「② 音频」节：开关 + 8 预置 + 10 滑块（等宽三列网格）+ WPS 适用范围提示。⚠️ **「点一下试听该频段」未做**——试听要么发 boost 音、
      要么临时摆一条曲线，都是独立一轮；本轮只做静态调节
- [x] **E6** `audioFx.test.mjs` 17 项 + `SettingsModal.test.tsx` +12 例（共 23）
      —— 含变异验证：注入 `className` 恒 false 时测试曾放过，补断言后能抓住

## C 组 — crossfade（2026-10-19 落地）

- [x] **C1** App 常驻第二个 `<audio>`，与 primary 同级、不进条件渲染
      —— `lib/audioSlots.ts` 的 A/B 槽位；两个 `<audio>` 在 App 里都是裸元素，
      **都不绑 `src`**（src 改成 usePlayer 命令式装载，见 C3）
- [x] **C2** 每槽独立 Web Audio 链 + 淡变调度
      —— `source → f0…f9 → fadeGain → analyser → destination`，
      两个槽位共用一个 AudioContext 但各有自己的 MediaElementSource / EQ /
      fadeGain（`createMediaElementSource` 每元素只能一次、不共享）。
      调度用 `setTargetAtTime`（**不是** `linearRampToValueAtTime`：后者被中断时
      会把增益停在半路）。fadeGain 夹在 EQ 与 analyser 之间 → 淡出时声波环跟着暗。
- [x] **C3** 切歌路径接线：crossfade 关闭 = 改动前的行为逐字不变
      —— 所有切歌都收敛到 `lib/crossfadeRunner.ts` 的 `load()`；`crossfadeSec=0`
      时 `decideSwitch` 恒回 `hard`，装进活跃槽、不碰次槽。默认 0（关）。
      ⚠️ 副作用：`src` 从 React 绑定改成命令式（`el.src = url; el.load()`），
      App 里那个「track.audioUrl 变 → audio.load()」的 effect 被删（它会在淡出
      期间把活跃元素的 src 重置掉，正好掐断正在淡出的歌）。硬切路径**不**直接
      `play()`，仍走既有 `dataset.wantPlay` + `canplay` 机制。
- [x] **C4** 快速连切护栏 + WPS 生效时 secondary 不参与
      —— 判据是「**除活跃槽外还有没有元素没闭嘴**」（`stillAudible` 集合），
      不是「有没有淡变在跑」。第一版写成后者，被 R5 用例打红：连按第 2 次走硬切
      时把淡变标记清了，第 3 次又判定成空闲闲 → 重新 crossfade → 新歌装进
      正在收声的旧槽 → ~120ms 双声叠加。WPS → `hard`，次槽完全不参与。
- [x] **C5** crossfade 用例 21 条
      —— `lib/crossfade.test.mjs` 11 条（决策口径 + 调度写法）、
      `lib/crossfadeRunner.test.mjs` 10 条（开关两态 / 连按 ⏭ 三次不叠音不静音 /
      WPS 互斥 / 首播不淡入 / `<audio>` 恒为 2 且切视图不重建 / 次槽缺失兜底 /
      dispose 不留孤儿定时器）+ `SettingsModal.test.tsx` 4 条（档位 UI，默认关）。
      变异验证：把 `fadingNow` 判据改回 `timer !== null` → R5 变红。
- [x] **C6**（超出原 tasks）发现并修的洞：- `decideSwitch` 的 `!(sec > 0)` 挡不住 `Infinity`（脏 localStorage）→
      时间常数变 Infinity = 淡变永远走不完 - `CrossPlatformLikeTotal.parts` 漏改 renderer 镜像类型（见下）- `useVolume` 是死代码：`maestro:volume` 偏好**从来没被推给任何元素**
      （`audio.volume` 全仓零赋值）。本轮不动（不在 crossfade 范围），但音量
      滑块目前是不出声的 —— 需要单独一轮。

## 门禁

- [x] `npm test` / `npm run typecheck` / `npm run lint` / `scan-hardcoded-colors --gate`
- [x] 变异验证：EQ 关掉 → 真旁路（E 组已做）；crossfade 关 → 与 HEAD 行为一致（R1/R2）

## ⚠️ 本轮新增的未验证项

**没有真机听过。** 21 条测试全用假元素 + 假 gain 钉死"调了哪些 API、顺序对不对"，
但以下只有耳朵能判：

- 淡入淡出实际好不好听、有没有爆音（指数逼近 4 个时间常数是否够）
- crossfade 与 EQ 同时开时的听感
- crossfade 与暂停 / seek / 拖进度条交互（seek 只作用在活跃槽上，淡出的旧槽
  不跟——这是刻意的，但没验证过用户会不会觉得"怪"）
- 打包模式（`npm run pack`）下两个 `<audio>` 的 preload 行为
