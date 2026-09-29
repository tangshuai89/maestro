# audio-fx — #7.1 均衡器 EQ + 交叉淡入淡出 crossfade（ReplayGain 本轮不做）

> NEXT-ITERATION §7.1 的落地 spec。范围从「EQ + crossfade + ReplayGain」
> **收敛成 EQ + crossfade**，理由见 §5 —— ReplayGain 在没有平台响度元数据的前提下
> 只能做出一个"听起来忽大忽小"的假实现，比不做更糟。

## 1. 现状（2026-09-29 实测）

Web Audio graph 在 `usePlayer.ensureAudioGraph()`（`packages/renderer/src/hooks/usePlayer.ts:244`）
里惰性建，链是：

    <audio> → MediaElementAudioSource → AnalyserNode(fftSize 256) → ctx.destination

- `createMediaElementSource` **每个元素只能调一次**且永久改路由，所以链的形状
  建好就不能随便重排（重排要 disconnect 再 connect）。
- graph 挂在 `<audio>` 的 `play` 事件上（`usePlayer.ts:977`）。
- 音量走 `<audio>.volume`（`useVolume.ts`），**不经过 Web Audio**。

### 1.1 边界：Spotify WPS 路径不经过这条链

WPS（Premium 全曲播放）由 SDK 自己解码输出（`lib/spotify-wps.ts`），renderer 的
`<audio>` 元素不参与出声。于是：

| 能力 | QQ / 网易云 / Deezer（`<audio>` 路径） | Spotify WPS |
|---|---|---|
| EQ | 生效 | **不生效** |
| crossfade | 生效 | **不生效**（WPS 自己切歌） |
| 声波环可视化 | 生效 | 不生效 |

**但 WPS 现在根本播不了**（license 500，卡在 castLabs EVS，见 NEXT-ITERATION §0），
所以这条边界既无法实景验证、也不构成日常影响。因此：

- 本轮**不动 WPS 任何代码**；
- UI 上 EQ 节要**诚实提示**"Spotify WPS 路径下不生效"，不能假装全平台可用；
- WPS 恢复可播后，EQ 能力需要单独立项（要在 WPS SDK 侧接，不能靠 `<audio>`）。

## 2. 范围

### 2.1 EQ（做）

- **10 段 BiquadFilter 级联**：31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k Hz，
  统一用 `peaking`，`Q = 1.0`，增益范围 ±12dB。
- **预置**：平直 / 流行 / 摇滚 / 古典 / 人声 / 低音增强 / 高音增强 / 夜间
  （每个预置就是 10 个数字，存 `lib/audioFx.ts` 常量表，纯数据可白盒测）。
- **开关 + 滑块**：每个频段一个滑块（-12…+12 dB，步进 0.5）。
- **持久化**：localStorage（进 `lib/storage.ts` 备份集，与 volume/theme 同级）。
- **即时生效**：改增益用 `filter.gain.setTargetAtTime(...)`（**不要** `.value =`，
  那样会咔哒）。

### 2.2 crossfade（做）

- **双 `<audio>` 常驻**：primary（现有那个）+ secondary（新增）。两个都在 App 的
  条件渲染**之外**常驻（延续 `#6.3` 立的"切模式不重建 `<audio>`"不变量）。
- **切歌时**：secondary 载入新曲 → 淡入 N 秒，同时 primary 淡出 → primary 归零暂停。
  两个元素各接一条 Web Audio 链（`createMediaElementSource` 每元素一次，各自建）。
- **时长**：默认 0（关闭），可选 1–8s，落盘偏好。**默认关**是有意的：首次听感变化大，
  且淡入淡出在"用户快速连切歌"时容易糊成一团。
- **快速连点 ⏭ 的护栏**：crossfade 进行中再来切歌，不排队、不叠加，直接把当前
  正在淡入的那首当作淡出对象（最坏是硬切，不能是静音或双声叠加）。

### 2.3 ReplayGain / 响度归一（本轮不做）

见 §5。

## 3. 不做什么

- 不碰 `useSpotifyWpsPlayer` / `lib/spotify-wps.ts` 任何一行。
- 不做真正的 gapless（HTML `<audio>` 做不到；crossfade 是可控的近似）。
- 不做 per-track 自动响度（理由 §5）。
- 不改 `useVolume` 语义（EQ 增益与音量是两个乘性维度，不能互相覆盖）。

## 4. 验收

- [ ] EQ 滑块拖动 → 声音立刻变化，无咔哒声（`setTargetAtTime`）
- [ ] 8 个预置一键切换 → 10 段数值正确；「平直」= 全 0
- [ ] EQ 关闭时**真旁路**（不是"设成 0 dB"—— peaking 串联即使 0 dB 也会改相位/延迟）
- [ ] 关掉页面重开 → EQ / crossfade 设置还在
- [ ] crossfade 开 + 切歌 → 两首重叠渐变，无爆音；关掉 → 与现在完全一致
- [ ] crossfade 开着连按 ⏭ 三次 → 不叠音、不静音
- [ ] `<audio>` 元素数量恒为 2，切 theater/lite/mini 也不重建
      （重建 = 丢 Web Audio graph = 有声变无声）
- [ ] EQ 节明确写出 WPS 适用范围

## 5. 为什么 ReplayGain 这轮不做

NEXT-ITERATION §7.1 写的是「优先用平台返回的响度元数据、否则 AnalyserNode 估算」。
实测（本轮勘查）：

1. **没有元数据**：`packages/server/src/music/types.ts`、`packages/renderer/src/api.ts`、
   `packages/common/src/**` 里 `loudness` / `replayGain` / `gain_db` / `peak`
   **零命中**。QQ / 网易云的 song detail 有 loudness 字段，但当前 provider 没映射过来，
   Deezer 的 `gain` 也没接。做"元数据优先"得先给 provider 各接一遍字段 + 类型 + 单测，
   那是独立一块工作量。
2. **AnalyserNode 估算不可靠**：真实 ReplayGain 要**解码整轨**做门限积分
   （EBU R128 / ITU-R BS.1770）。实时 AnalyserNode 拿到的是**已经播过的那一段**，
   算出来的是"刚才几秒的平均响度"而不是"整首歌的响度"——拿它当增益因子
   = 用一个随时间漂移的值调音量。
3. **观感上更糟**：动态增益让音量忽大忽小，且直接和用户"记住我的音量"的心智冲突
   （`useVolume` 的存在就是为了让音量属于用户，而不是属于算法）。

所以显式不做。上面三条也是一次干净的前置调研：等 provider 侧把 loudness 元数据接齐，
再单独起 ReplayGain 立项。**没有元数据时宁可让用户自己拉滑块，也不要一个假的自动归一。**

## 6. 落地位置

| 关注点 | 位置 | 理由 |
|---|---|---|
| 频段表 / 预置常量 | `renderer/src/lib/audioFx.ts` | 纯数据、白盒可测，不塞进 hook |
| EQ 链构建 / 参数推送 | `renderer/src/lib/eqChain.ts` | 纯函数，可脱离 React 运行时测试 |
| 偏好读写 | `renderer/src/lib/storage.ts` | 与 volume / theme / playerMode 同级，进备份集 |
| 音频链构造 | `renderer/src/hooks/usePlayer.ts`（改造 `ensureAudioGraph`） | graph 是它的既有职责，不另起一套 |
| EQ 滑块 UI | `renderer/src/components/modals/SettingsModal.tsx` 新增「音频」节 | 10 个滑块需要空间；主界面（剧场）已满 |

## 7. 风险

- **重排已有 graph**：`analyser` 原来直连 destination，插入 EQ 要重连一次。
  **解法（已实现）**：EQ 节点在 graph **建立时就一次性建好**（哪怕增益全 0），
  之后只改 gain 参数、绝不重连。建链与填值彻底分开 → 重建 graph 不会带着上一个人的曲线。
  实测形态：`source → f0 → … → f9 → destination`，同时 `f9 → analyser`
  （Web Audio 允许多路输出，analyser 是旁路观察点，destination 收到的仍是 EQ 后信号；
  这也顺带让「analyser 创建失败也不会静音」）。
- **EQ 的链构建 / 参数推送抽成纯函数**（`lib/eqChain.ts`）：`usePlayer` 是大 hook，
  测它要拉 React 运行时 + 假 <audio>；而这段恰恰是「写错了不报错、只听起来不对」
  的地方（串错顺序 = 整体发糊、`.value =` = 每拖一下咔一声）。抽出来后用记录调用的
  假 ctx 就能把连接顺序和参数写法钉死（8 项白盒，见 `lib/eqChain.test.mjs`）。
- **crossfade 与 WPS 互斥**：WPS 生效时 secondary 不参与，避免出现
  "WPS 在播 + secondary 在放同一首歌"。
- **`<audio>` 变 2 个**：`usePlayer` 里所有 `audioRef.current` 的用法要确认在
  WPS 关闭时才有效；secondary 不能被误当成"当前播放元素"。

## 8. 任务拆分

见 `tasks.md`。
