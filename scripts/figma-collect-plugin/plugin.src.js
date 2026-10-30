// ─────────────────────────────────────────────────────────────
// AETHER — 快照采集插件（源码；code.js 是它的生成物）
//
// 干什么：把**当前打开的 Figma 文件**读成一份快照 JSON，复制到剪贴板，
//        人工落盘成 `scripts/figma-snapshot.json` —— 这是 `figma:diff` 的输入。
//
// 为什么要有这个插件（2026-10-30）：
//   快照必须**从 Figma 现状采集**，否则 `figma:diff` 读的是旧数据
//   ⇒ 刚写进设计稿的契约看不见、差异清单也不更新 —— **现场看不出任何异常**
//   （这就是 `figma:payload:check` 存在的原因：它只证明「产物与旧快照同步」，
//     证明不了「Figma 里真的写了什么」）。
//
//   原先的采集路径是 Figma MCP 的 `use_figma` —— **吃套餐配额**
//   （Starter / View / Collab 20 次/月）⇒ 每回一次采集就少一次。
//   ⇒ 改走**本地开发插件**：权限 = 你自己对文件的编辑权，
//     **零配额**、零网络、零 IO（与写入插件同一条路，已经实测跑通）。
//
// ⚠️ 运行前提（与写入插件相同，都是实测踩过的坑）：
//   ① 必须用 **Figma 桌面 App**（浏览器版读不到本地 manifest.json）
//   ② 必须处于 **Design 模式**（Dev Mode 下插件只读）
//   ③ 目标文件必须是 **editable**
//
// ⚠️ **只读**：本插件只遍历、只读属性，不创建 / 修改 / 删除任何节点。
//
// 关联：scripts/figma-snapshot-seg.js（SEG1 = 唯一的采集实现）
//       · scripts/figma-collect-plugin.mjs（生成器）
//       · scripts/figma-collect-plugin.test.mjs（mock Figma API 真跑）
//       · docs/figma-contract-write-guide.md
// ─────────────────────────────────────────────────────────────

/**
 * 采集：跑共享的 SEG1 段（只读遍历）⇒ 返回快照 JSON 字符串。
 *
 * ⚠️ SEG1 的源码**只有一份**：`scripts/figma-snapshot-seg.js`。
 *    生成器把它的 SEG1 原样贴进下面这个函数体 ⇒ 采集口径不可能漂移。
 *    （SEG1 是**裸脚本体**：顶层有 `await`、结尾 `return JSON.stringify(out)`，
 *      所以必须嵌在 async 函数里 —— 不能用 eval/new Function，
 *      Figma 沙箱不允许。）
 */
async function collectSnapshot() {
  /* __COLLECTOR__ */
}

/** 本地时区 ISO 时间戳（与仓库现有快照的 capturedAt 格式一致）。 */
function localStamp() {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const abs = Math.abs(tz);
  const pad = (n) => String(n).padStart(2, '0');
  const sign = tz >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

async function main() {
  // ⚠️ 必须先载入全部页面：manifest 是 dynamic-page ⇒ Figma 启动时**不**装载全部页，
  //    不先 loadAllPagesAsync 就读 `figma.root.children` 会漏页（与写入插件同一个坑）。
  await figma.loadAllPagesAsync();

  const raw = await collectSnapshot();
  const parsed = JSON.parse(raw);
  parsed.capturedAt = localStamp();
  const json = JSON.stringify(parsed, null, 2);

  const components = parsed.components ?? [];
  const screens = parsed.screens ?? [];
  const all = [...components, ...screens];
  const withContract = all.filter((n) => n.hasContract).length;
  const withProse = all.filter((n) => n.hasDescription).length;

  const summary =
    `采集完成：组件 ${components.length} · 屏 ${screens.length}` +
    ` · 带契约段 ${withContract}/${all.length} · 有语义 ${withProse}/${all.length}` +
    ` —— JSON 已复制到剪贴板`;

  let clipboardOk = false;
  try {
    await figma.clipboard.writeText(json);
    clipboardOk = true;
  } catch (e) {
    // ⚠️ 用 **ERROR** 前缀 —— 这一行**不是**快照 JSON。
    //    若与 JSON 用同一个前缀，机器抓「第一行以 [aether-snapshot-collector] 开头」
    //    就会抓到这行 ⇒ JSON.parse 炸。⇒ 前缀必须能区分。
    console.log('[aether-snapshot-collector] ERROR 剪贴板写入失败：' + String(e));
  }

  // 完整 JSON 也进 console —— 剪贴板不可用时的兜底（人工从 console 复制）
  console.log('[aether-snapshot-collector] ' + json);

  const notice = clipboardOk
    ? summary
    : `采集完成：组件 ${components.length} · 屏 ${screens.length} · 带契约段 ${withContract}/${all.length} —— 剪贴板写入失败，请从 console 复制 JSON`;
  figma.notify(notice);
  figma.closePlugin(notice);
}

main().catch((e) => {
  const msg = `AETHER 快照采集异常：${String(e && e.message ? e.message : e)}`;
  figma.notify(msg);
  figma.closePlugin(msg);
});
