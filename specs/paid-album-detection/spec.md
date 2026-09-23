# 付费专辑 / 数字专辑 vipLocked 检测

## 做什么

修一个**已知 bug**：

用户在统一搜索里搜一首歌（典型例子「台北车站」），结果显示「bestSource =
qq」，点播放却只播了 29 秒就停——但用户既不是绿钻、也没买专辑，按理应该播
不了。

实际上这首歌属于 QQ 音乐的**数字专辑 / 付费单曲**：必须单独购买才能听完整
曲，**绿钻 VIP 也不行**。当前 `QqMusicProvider.search()` 只读 `pay.pay_play ===
1` 来标 `vipLocked`，对数字专辑/付费单曲场景漏识别 → `vipLocked=false` →
`selectBestSource` 第一档就选中 → 拿到 QQ GetVkey 返回的 30 秒试听流。

网易云同款漏洞：`NeteaseMusicProvider.search()` 用 `privilege.pl > 0` 当"已
解锁"判据，对数字专辑（`fee === 1`）和付费单曲（`fee === 4` / `fee === 8`）
来说，pl 会给出一个 128kbps 试听值（> 0），但实际只给 30 秒预览——结果被错
判成"可播全曲"。

## 验收标准

- [ ] QQ search 响应里 `pay.pay_album === 1` → `vipLocked = true`（不管用户
      是否绿钻）
- [ ] QQ search 响应里 `pay.pay_track === 1` → `vipLocked = true`
- [ ] QQ search 响应里 `pay.fee > 0` → `vipLocked = true`（兜底，覆盖未来新
      增付费字段）
- [ ] QQ search 响应里仅 `pay.pay_play === 1` + 用户是绿钻 → `vipLocked = false`
      （保留旧行为，绿钻能放 VIP 独占歌）
- [ ] QQ search 响应里仅 `pay.pay_play === 1` + 用户不是绿钻 → `vipLocked = true`
      （保留旧行为）
- [ ] 网易云 search 响应里 `privilege.fee > 0` → `vipLocked = true`
- [ ] 网易云 search 响应里 `privilege.pl <= 0` → `vipLocked = true`（保留旧
      行为）
- [ ] 网易云 search 响应里 `privilege.pl > 0` 且 `fee === 0/undefined` →
      `vipLocked = false`（保留旧行为）
- [ ] `pay` 对象整体缺失 → 视为无付费约束（保守放行），`vipLocked = false`
- [ ] `privileges` 数组缺失对应 id 的元素 → 维持现有"按 isVip 兜底"行为
      （netease.provider.ts:329-331 现有逻辑）
- [ ] `selectBestSource` ladder 不动（`search.util.ts:152-165`）——vipLocked
      字段修正后 ladder 自然选出非付费专辑的源
- [ ] 单测覆盖：QQ 数字专辑（pay_album=1）/ 付费单曲（pay_track=1）/ fee>0 三
      种 case + VIP/非 VIP 组合 + pay 缺失的回归；网易云 fee>0 + pl 组合矩阵
- [ ] 端到端：模拟统一搜索「台北车站」类输入，bestSource 应自动避开数字专辑
      的 QQ 源，落到网易云非锁源或返回 null（如果两个平台都锁）
- [ ] `npm run typecheck && npm run lint && npm test` 全绿

## 接口规格

### QQ provider 改动

`packages/server/src/music/qq.provider.ts`：

```ts
// 当前（line 519-520）：
vipLocked:
  (s.pay?.pay_play ?? s.pay?.payplay) === 1 && session.qqVip !== true,

// 改为：抽成独立方法，方便单测
private detectVipLocked(
  pay: SearchResponsePay | undefined,
  qqVip: boolean | undefined,
): boolean { ... }
```

判定顺序（短路求值，最可能命中的放前面）：

1. `pay_album === 1` → true
2. `pay_track === 1` → true
3. `typeof fee === 'number' && fee > 0` → true
4. `(pay_play ?? payplay) === 1` → `qqVip !== true`
5. 以上都不命中 → false

### 网易云 provider 改动

`packages/server/src/music/netease.provider.ts`：

```ts
// 当前（line 319）：
entry.vipLocked = !(typeof p.pl === 'number' && p.pl > 0);

// 改为：先按 fee 判定，再按 pl
entry.vipLocked = detectVipLocked(p);
```

判定逻辑：

```ts
function detectVipLocked(p: { pl?: number; fee?: number; st?: number } | undefined): boolean {
  if (!p) return false;
  if (typeof p.fee === 'number' && p.fee > 0) return true;  // 数字专辑/付费单曲
  return !(typeof p.pl === 'number' && p.pl > 0);            // 保留旧逻辑
}
```

### 类型扩展

`packages/server/src/music/qq.provider.ts` 的 `SearchResponse` interface 里
`pay` 字段补充新成员：

```ts
pay?: {
  pay_play?: number;
  payplay?: number;
  pay_album?: number;  // 数字专辑
  pay_track?: number;  // 付费单曲
  pay_download?: number;
  fee?: number;        // 价格代码
};
```

## 不做什么(Out of Scope)

- **不**改 `selectBestSource` ladder 逻辑——vipLocked 字段修正后 ladder 自动
  跳过付费专辑源，行为已经对了
- **不**改 `pickCanonicalVersion`——主版本口径跟付费无关
- **不**给 QQ GetVkey 加 errtype 重新解析（30s 流也能正常返回 purl，那条路
  救不回来，要在搜索阶段就识别）
- **不**做"用户专辑购买状态"追踪（QQ/网易云都不开放此接口给第三方），数字
  专辑场景一律保守锁
- **不**改搜索结果展示 UI（renderer 不感知 vipLocked 字段细节）

## 风险与权衡

| 风险 | 说明 | 缓解 |
|---|---|---|
| 过度保守：把免费歌也锁了 | QQ 的 `fee` 字段历史上有边缘 case（部分翻唱版 fee=0 但实际有限制） | 单测里覆盖 fee=0 回归；锁的代价是"在播放时换源或显示灰"，远比"播 30 秒就停"轻 |
| `pay.fee > 0` 误伤免费试听 | QQ 有个 edge case：用户已购买专辑的歌曲 fee 仍显示原值（不是 0），但 session 不带购买状态 | 本地无法判定是否已买，保守锁符合"先正确，再优化"原则；如果用户投诉再考虑加 user-album 字段 |
| selectBestSource 第三档兜底把所有付费专辑当"全锁"返回 bestSource=null | 如果 QQ/网易云两个平台的同一首歌都是数字专辑 | 正确行为——应该提示用户去购买，而不是让用户以为"这是免费歌" |
| 网易云 pl 缺失且未知 isVip 的兜底逻辑 | 现有 netease.provider.ts:329-331 的 `if (entry && entry.vipLocked === undefined && !isVip) { entry.vipLocked = true; }` | 不动这段，让"未知 = 保守锁"的旧行为继续生效 |
| 测试用 mock 数据不准 | 单测的 pay 对象是手写 mock，跟真实 QQ API 可能字段位置不同 | 字段名都来自 `pay` 对象的同一层级，QQ API 历史上相对稳定；如果 mock 改了真实字段名按 mock 写测试 |

## 执行顺序

1. 改 QQ provider：抽 `detectVipLocked` 方法 + 扩展 `pay` interface
2. 改网易云 provider：抽 `detectVipLocked` 函数 + 复用
3. 写单测：
   - `qq.provider.test.ts`：新增 case 覆盖 11a-11e（数字专辑 / 付费单曲 / fee /
     pay_album + VIP / pay 缺失）
   - `netease.provider.test.ts`：新增 case 覆盖 15a-15d（数字专辑 / 付费单曲 /
     pl 缺失 / fee 缺失）
4. 跑 `npm run typecheck && npm run lint && npm test`，全绿
5. 端到端：手动复现「台北车站」搜索，确认 bestSource 正确避开 30s 流
