# qq-data-snapshots

> QQ 红心 / 艺人映射的一次性导出快照。
>
> **真值（SoT）**：`packages/common/src/artistAlias.ts` 的 `STAGE_NAME_ALIASES` +
> `packages/common/src/titleAlias.ts`。
>
> 本目录的 md 文件是早期手工导出的"待补英文名"清单，**已 1.5 月没更新**。
> 重新生成：`scripts/export-qq-artists.js`（从本地 `state.json` 拉一次红心列表）。

## 维护规则

- 新导出脚本只覆盖**本目录**——不放回 `scripts/` 根。
- 清理：半年扫一次。
