# 问题清单 / Defs Log

> 生成时间：2026-08-18
> 数据来源：`npm test`（全绿 ~455 用例）+ 静态代码分析 + 文档交叉核对 + 实测验证

严重度标记：
- **CRIT**  阻塞 / 数据丢失 / 越权
- **HIGH**  业务可见错误 / 关键路径无兜底
- **MED**   边角 / 体验 / 一致性
- **LOW**   代码味道 / 文档

---

## 1. 测试基础设施

### 1.1 [CRIT] sandbox 默认权限下 `npm test` 不绿

- **文件**：`packages/server/src/music/like.e2e.test.ts`（line 33）：
  `await app.listen(0)` 在 sandbox（`0.0.0.0` listen 禁止）下抛
  `EPERM: operation not permitted`。
- **影响**：本地 sandbox 跑 `npm test` 提前在 server 包中段失败，看不到
  electron/common 包的输出；CI 上若没给 escalated 权限会出现假阳性。
- **复现命令**：
  ```
  cd /Users/tangshuai/maestro
  npm test           # 在 sandbox 默认权限下 → 第 14 个文件（like.e2e）失败
  npm test -- --require-escalated   # 全绿
  ```
- **建议**：所有 e2e 改 supertest（`app.init() + app.getHttpServer()`），不再
  listen 真实端口——见 [specs/test-plan/tasks.md](../specs/test-plan/tasks.md) §Phase A。

### 1.2 [LOW] e2e 测试用 `console.log`

- **文件**：`packages/server/src/music/*.e2e.test.ts`、`like-sync.queue.purge.test.ts`
  等 12 处 `console.log`。
- **影响**：AGENTS.md 明文要求「日志统一走 NestJS Logger，不用 console.log」；
  CI 收集器对 `console.log` 兼容差。
- **建议**：统一改 `process.stdout.write` 或 `new Logger('Test').log(...)`。

---

## 2. 测试覆盖（按风险从高到低）

### 2.1 [HIGH] `netease.provider.ts` 零单测

- **LOC**：534 行（含 11 个 `async` 方法）；仅通过 e2e 间接覆盖。
- **未测**：search / fetchLiked / getStreamPath / like / unlike / fetchEnrichment /
  apiCall 错误路径 / VIP 推断。
- **建议**：见 [specs/test-plan/tasks.md B2](../specs/test-plan/tasks.md)。

### 2.2 [HIGH] `deezer.provider.ts` 零单测

- **LOC**：267 行；匿名 API 但仍需覆盖率。
- **未测**：search / 各 preset editorial id 映射 / preview URL 解析 / 4xx 兜底。
- **建议**：见 [specs/test-plan/tasks.md B3](../specs/test-plan/tasks.md)。

### 2.3 [HIGH] `lyricsovh.provider.ts` 零单测

- **LOC**：~80 行；外部 API；URL 拼接用 `encodeURIComponent`（防 404）。
- **建议**：见 [specs/test-plan/tasks.md B4](../specs/test-plan/tasks.md)。

### 2.4 [HIGH] `qq.provider.test.ts` 仅覆盖 g_tk 计算

- **文件**：`packages/server/src/music/qq.provider.test.ts`（230 行）。
- **已测**：computeGtk。
- **未测**：search / fetchRadioBatch（Fisher–Yates 随机）/ getStreamPath
  vkey 过期重取 / getLyrics JSONP 包装剥除 / randomGuid 格式。
- **建议**：见 [specs/test-plan/tasks.md B1](../specs/test-plan/tasks.md)。

### 2.5 [HIGH] `spotify.test.ts` 仅覆盖 OAuth/refresh

- **已测**：OAuth code exchange、token refresh。
- **未测**：search / like / unlike / fetchLiked / WPS tier 路由。
- **建议**：见 [specs/test-plan/tasks.md B5](../specs/test-plan/tasks.md)。

### 2.6 [HIGH] `music.service.ts` 仅靠 e2e 兜底

- **LOC**：3078 行（核心业务）；35 个 `async` 方法。
- **已测**：searchEquivalent / fanOutLike / importLiked / healLibraryItem 等通过 e2e。
- **未单测**：`getNextTrack` 流控 / `findPlayableEquivalent` 优先级 / `markDisliked` /
  `getLyricsAggregated` 缓存策略 / `dislikeMerged`。
- **建议**：见 [specs/test-plan/tasks.md Phase C](../specs/test-plan/tasks.md)。

### 2.7 [HIGH] `common/lyrics.ts` 零单测 + 实现 bug

- **文件**：`packages/server/src/common/lyrics.ts`（仅 ~50 行但全项目唯一 LRC 解析入口）。
- **实测 bug 1**：注释承诺「multi-tag lines `[mm:ss.xx][mm:ss.xx]text` are split
  into one line per tag」，但正则 `[(\d+):(\d+)\]([^\n]*)` 把后续 tag 当作
  text 一部分——NetEase 实际数据若有合唱 repeat 行则丢失。
- **实测 bug 2**：时间数字未校验边界，`[99:99.99]` 会被解析为 6039.99 秒
  （100+ 分钟），污染排序后定位。
- **建议**：
  - 多 tag 拆开：先 split 出每个 `[mm:ss.xxx]` tag，逐个 emit。
  - 时间校验：`minutes in [0, 999]`、`seconds in [0, 60)`，越界丢弃。
- **示例测试**：
  ```ts
  parseLrc('[02:30.500]A[02:35.500]B').length === 2
  parseLrc('[99:99.99]bad').length === 0
  ```

### 2.8 [MED] controller 路由覆盖不足

- **文件**：`packages/server/src/music/music.controller.ts`（742 行）。
- **已测**：`/music/stream/*`（3 用例）、`/music/like/merged`（13 用例）。
- **未测**：`/music/search` 清洗 / `/music/library` 脏数据 / `/music/deezer/preset`
  / `/music/dislike/merged` 路由顺序。
- **建议**：见 [specs/test-plan/tasks.md Phase D](../specs/test-plan/tasks.md)。

### 2.9 [MED] renderer `hooks/` 零单测

- **风险**：`usePlayer`（核心播放逻辑，~600 行）有 38 处 `useState/useRef/useEffect`，
  跨平台降级 / VIP 升级 / WPS 路由全靠它；零测试覆盖。
- **建议**：见 [specs/test-plan/tasks.md Phase F](../specs/test-plan/tasks.md)。

### 2.10 [MED] renderer `lib/groupLibrary.ts` 零单测

- **风险**：AGENTS.md 硬约束它和 server `mergeLibrary` 共用归一工具；
  没有任何跨包契约测试证明「两端 key 对齐」。
- **建议**：见 [specs/test-plan/tasks.md Phase E](../specs/test-plan/tasks.md)。

### 2.11 [MED] `backoffMs` jitter 不可注入

- **位置**：`packages/server/src/music/like-sync.queue.ts:312-315`。
- **现状**：`Math.floor(Math.random() * LikeSyncQueue.BACKOFF_BASE_MS)` 直接
  在 `backoffMs` 静态方法里调外部随机源。
- **影响**：单测只能断言抖动落在区间内，无法断言具体值；不能做「种子 →
  固定序列」的可重放测试。
- **建议**：抽 `rng: () => number` 注入参数；或者改用「Math.random 在测试中
  被 stub」模式（`globalThis.crypto` / `node:test` 的 mock）。

---

## 3. 代码质量（静态扫描）

### 3.1 [MED] `Number(songId)` 在 `netease.provider.ts` 拼接里可能产 NaN

- **位置**：`packages/server/src/music/netease.provider.ts:371`
  `ids: \`[${Number(songId)}]\``。
- **风险**：若 `songId` 是非数字字符串（例如「track-id-001」），`Number(...)
  === NaN`，会拼出 `ids=[NaN]`——网易云 API 必返 400 且 controller 返回 502。
- **建议**：先 `parseInt(songId, 10)` 并对 NaN 抛 `BadRequestException`。
- **示例测试**：
  ```ts
  await expect(provider.getStreamPath(s, 'not-a-number'))
    .to.be.rejectedWith(/无效/);
  ```

### 3.2 [MED] `qq.provider.ts:617` `randomGuid` 用 `Math.random`

- **位置**：`qq-crypto.ts`/`qq.provider.ts` 的 `randomGuid`：
  ```
  Math.floor(Math.random() * 16).toString(16) × 32
  ```
- **风险**：`Math.random` 不是密码学安全；guid 每次 fetchVkey 都重新生成
  作为 QQ 鉴权参数（`guid` + `h5guid`）。QQ 后端若升级为「guid 模式检测」
  可能误杀。
- **建议**：改用 `randomBytes(16).toString('hex')`（`node:crypto`）——和
  `electron/main.ts` 的 `randomBytes(32)` 风格保持一致。
- **副作用**：guid 不再每次变，QQ 鉴权若希望每次唯一（防 replay），需要
  在 guid 前缀加 `Date.now()` 之类。

### 3.3 [MED] `fetchRadioBatch` Fisher–Yates 不可注入

- **位置**：`packages/server/src/music/qq.provider.ts:438-447`
  ```
  const seed = seeds[Math.floor(Math.random() * seeds.length)];
  ...
  for (let i = tracks.length - 1; i > 0; i--) { ... }
  ```
- **风险**：单测无法断言具体顺序。
- **建议**：把种子 + shuffle 抽成纯函数（接 `(rng: () => number)` 注入），单测
  可断言「种子 X → 列表 Y」。

### 3.4 [MED] `storage.flushSync` 接入已 OK 但路径不一致

- **已验证**：`session.ts:103` 和 `backup.controller.ts:59` 都实现
  `OnModuleDestroy` → `flushSync`。Electron `main.ts:798 before-quit` 调
  `stopSidecar()` 发 `SIGTERM`，NestJS 触发 `onModuleDestroy`。
- **遗留风险**：200ms debounce 期间若用户强制 kill 进程（macOS 强制退出 /
  pkill -9），仍可能丢最后一次 set。当前已接 SIGTERM，可接受。

### 3.5 [LOW] `package.json` `description` 描述已过期

- **位置**：`/package.json:5`
  `"A minimal music player for Mac with QQ Music integration, inspired by Douban FM"`
- **现状**：已扩展到 4 平台 + AI 推荐 + Electron + NestJS。
- **建议**：改为「跨平台音乐播放器（QQ / 网易云 / Deezer / Spotify）」。

### 3.6 [LOW] AGENTS.md 路径与实际不符

- **位置**：`AGENTS.md:20, 70` 提到 `packages/common/src/provider.ts`，实际
  `MusicProvider` 类型定义在 `packages/server/src/common/provider.ts`。
- **影响**：新人 onboarding 时找不到文件。
- **建议**：要么把类型定义搬到 `packages/common/src/`（更合理，跨包用），
  要么 AGENTS.md 改正路径。

### 3.7 [LOW] `electron/main.ts` 大量 `console.log`

- **文件**：`packages/electron/src/main.ts` 多处 `console.log/error/warn`。
- **说明**：Electron main 不属于 NestJS，Logger 习惯可宽松，但与 AGENTS.md
  「日志统一走 Logger」不一致。
- **建议**：保持现状或引入 `electron-log` 模块。

### 3.8 [LOW] 单元测试 `any` 类型滥用

- **文件**：`cross-platform-match.e2e.test.ts` 内 12 处 `as any`。
- **风险**：依赖私有字段 `equivSearchCache`、`netease`、`session.providers`
  ——一旦 service 改实现，测试编译期察觉不到。
- **建议**：用 `@ts-expect-error` 标出，或把这些字段暴露为测试专用 hook。

---

## 4. 安全 / 隐私

### 4.1 [LOW] 凭据文件未设 chmod 600

- **位置**：`packages/server/src/common/storage.ts:39` `fs.writeFileSync`
  没有 chmod。
- **现状**：QQ cookie / NetEase MUSIC_U / Spotify token 全部存在
  `<userData>/.storage/state.json`，明文，umask 默认创建。
- **设计**：AGENTS.md 明文「凭据不上传服务器」，本地存储符合预期。
- **建议**：写入后 `fs.chmodSync(this.file, 0o600)`（仅 owner 读写）。
- **影响**：单机单用户场景几乎不触发；多用户 macOS / 备份到外置盘时高风险。

### 4.2 [LOW] OAuth state 仅 10min TTL，无过期撤销

- **位置**：`packages/electron/src/auth/oauth-buffer.ts`（`OAUTH_BUFFER_TTL_MS = 600_000`）。
- **现状**：TTL 内重复 push 会被替换；超 TTL 自动 drop。
- **建议**：在 renderer 也记录「已发起但未完成」的 state，超过 10min 给用户
  提示「登录超时」。

### 4.3 [LOW] `proxyAudio` 不限制 `url` 域

- **位置**：`packages/server/src/music/music.controller.ts:435` 等价路径。
- **风险**：若 provider 返回了非预期域名（例如被污染的 redirect URL），
  server 会代理给客户端，扩大 SSRF 面。
- **现状**：`url` 来自 provider API 返回（QQ/网易云/Deezer/Spotify），受
  信任——实际风险低。
- **建议**：白名单 upstream 域（`y.qq.com` / `music.126.net` /
 `deezer.com` / `spotify.com` 等）。

---

## 5. 性能 / 可维护性

### 5.1 [LOW] `music.service.ts` 单文件 3078 行

- **建议**：按职责拆成 `merge.service.ts` / `library.service.ts` /
  `lyrics.service.ts` / `radio.service.ts` / `like-sync.service.ts`。
- **收益**：单测粒度变细；code review 聚焦。

### 5.2 [LOW] `usePlayer.ts` 单文件 ~600 行

- **建议**：拆 `usePlaybackTransport`（WPS vs `<audio>` 路由）、
  `useFallback`（跨平台降级循环）、`useTrialUpgrade`（VIP 升级）。

### 5.3 [LOW] 缓存按容量（LRU by size）淘汰，无时间维度

- **位置**：`music.service.ts` 的 `lyricsCache`、`equivSearchCache`、
  `libraryCache` 都是 `Map`，按容量淘汰，无时间维度。
- **现状**：每个 cache 自身又有 `Date.now()` 软 TTL（`LYRICS_CACHE_TTL_MS` 等），
  实际是有 TTL 的——OK。

### 5.4 [LOW] `search.test.ts` 每次重建 kuromoji 词典

- **位置**：`packages/server/src/music/search.test.ts`。
- **现状**：首次冷启动 ~2s；`cross-platform-match.e2e.test.ts` 显式预热
  `warmupJa()` 防止 flaky。
- **建议**：在 `music.module.ts` 启动时统一预热（app 启动 < 2s 换字典，
  生产环境友好）。

---

## 6. 文档 / UX

### 6.1 [LOW] `README.md` 没提 npm test

- **位置**：`/README.md`、`/README.zh-CN.md`。
- **建议**：在「开发」一节加：
  ```
  npm run typecheck && npm run lint && npm test
  ```

### 6.2 [LOW] 没有 CHANGELOG

- **建议**：引入 `CHANGELOG.md`（keep-a-changelog 风格），方便 e2e 回归。

---

## 7. 修复优先级建议

按投入产出比排序：

| 序 | 项 | 严重度 | 估计工时 | 备注 |
|---|---|---|---|---|
| 1 | 1.1 e2e 改 supertest | CRIT | 1h | 解 sandbox CI 阻塞 |
| 2 | 2.7 lyrics 解析 bug + 单测 | HIGH | 2h | 实测确认有 bug |
| 3 | 2.1~2.5 provider L2 单测 | HIGH | 1d | 覆盖度 +20% |
| 4 | 2.6 music.service 边界补强 | HIGH | 1d | 核心业务 |
| 5 | 3.1 `Number(songId)` NaN 防护 | MED | 30min | 防御性 cast |
| 6 | 3.2 randomGuid 改 crypto | MED | 15min | 一致性 |
| 7 | 2.10 跨包契约测试 | MED | 2h | 堵前后端 key 漂移 |
| 8 | 4.1 chmod 600 凭据文件 | LOW | 30min | 隐私 hardening |
| 9 | 5.1/5.2 拆分大文件 | LOW | 1d | 可维护性 |
| 10 | 6.1/6.2 README/CHANGELOG | LOW | 1h | onboarding |

---

## 8. 测试结果基线（2026-08-18）

| 包 | 文件数 | 用例数（估） | 状态 |
|---|---|---|---|
| common | 2 | 214 | OK |
| server | 20 | ~220 | OK（sandbox 下 like.e2e 抛 EPERM） |
| electron | 2 | 21 | OK |
| **合计** | **24** | **~455** | **OK（需 escalated 权限）** |

详细分析见 [specs/test-plan/spec.md](../specs/test-plan/spec.md)。
