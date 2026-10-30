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
  
// ── 共享实现（由 scripts/lib/figma-contract-section.js 内联）──
// ⚠️ **不要手改这段**：它来自共享实现，手改会让采集段与写入插件口径漂移（⇒ 静默漏写）。
const SECTION_FENCE = "---";

function extractContractSection(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/---([\s\S]*?)---/);
  return m ? m[1].trim() : '';
}

function hasContractSection(raw) {
  return extractContractSection(raw).length > 0;
}

function mergeContractSection(raw, section) {
  const existing = typeof raw === 'string' ? raw.trim() : '';
  const body = typeof section === 'string' ? section.trim() : '';
  if (!body) return existing;
  const block = `${SECTION_FENCE}\n${body}\n${SECTION_FENCE}`;
  if (!existing) return block;
  // 已经有契约段了 ⇒ 原样返回（不叠加、不覆盖）
  if (hasContractSection(existing)) return existing;
  return `${block}\n\n${existing}`;
}
// ── 只读遍历（不创建 / 不修改 / 不删除任何节点）──
const pageByName = (n) => figma.root.children.find((p) => p.name === n);
// 不做 findAllWithCriteriaAsync 特性探测：use_figma 运行时读不存在的属性会直接抛错
// （不返回 undefined），探测本身就会炸。setCurrentPageAsync 之后同步 API 即可用。
const findAll = async (node, types) => node.findAllWithCriteria({ types });

// 契约载体：COMPONENT(SET) 走 .description；FRAME 走隐藏 TEXT 子节点
const carrierOf = (node) =>
  node.description ||
  (node.children || []).find(
    (c) => c.type === 'TEXT' && (c.name === 'AI_CONTRACT' || c.name === 'MOTION_SPEC')
  )?.characters ||
  '';

// 只取 ---...--- 契约段（AI 要的是结构化那几行，不是散文）
//
// ⚠️ **extractContractSection 是共享实现**（scripts/lib/figma-contract-section.js），
//    由本文件 require 时内联进来 —— 采集段跑在 Figma 沙箱里不能 import，
//    但**源码只有一份**（写入插件那边也是同一份 toString() 内联）。
//    以前这里手写了一份提取正则，插件那边又手写了另一份「文本里含 AI_CONTRACT:」的判断，
//    三端口径不一致 ⇒ 插件以为写过了而采集段提不出来 ⇒ 静默漏写。
const contractOf = (node) => extractContractSection(carrierOf(node));

// 语义载体信息：有没有描述 / 有描述但没契约段时给一段预览
//
// 为什么必须带上：比对层的 descriptions 腿要判「这个节点到底有没有语义」。
// 只回传 contract（段内容）的话，"载体为空" 和 "载体有内容但没 ---段" 两种情况
// 会被混成同一种 —— 前者是真缺，后者是"写了散文没写契约"，处置方式不同。
// 预览只在「有载体但没契约段」时才回传（那正是需要人看的少数情况），
// 常规路径只多两个布尔量，返回体几乎不涨。
const semanticOf = (node) => {
  const raw = carrierOf(node);
  const hasDescription = Boolean(raw && raw.trim());
  const hasContract = Boolean(contractOf(node));
  return {
    hasDescription,
    hasContract,
    descriptionPreview:
      hasDescription && !hasContract ? String(raw).trim().slice(0, 120) : '',
  };
};

const pages = figma.root.children.filter((p) => p.type === 'PAGE');
const out = { fileKey: figma.currentPage && figma.fileKey ? figma.fileKey : null, pages: [], components: [], screens: [], motion: null };

// ── 02 · Components ──────────────────────────────────────────
const compPage = pageByName('02 · Components');
if (compPage) {
  await figma.setCurrentPageAsync(compPage);
  const sets = await findAll(compPage, ['COMPONENT_SET']);
  const loose = await findAll(compPage, ['COMPONENT']);
  const setIds = new Set(sets.map((s) => s.id));

  for (const s of sets) {
    out.components.push({
      name: s.name,
      nodeId: s.id,
      type: 'COMPONENT_SET',
      variants: (s.children || []).map((c) => c.name),
      contract: contractOf(s),
      ...semanticOf(s),
    });
  }
  // 不在 set 里的孤立 COMPONENT（单个变体被拉出来的情况）
  for (const c of loose) {
    if (setIds.has(c.id)) continue;
    const parentIsSet = c.parent && c.parent.type === 'COMPONENT_SET';
    if (parentIsSet) continue;
    out.components.push({
      name: c.name,
      nodeId: c.id,
      type: 'COMPONENT',
      variants: [c.name],
      contract: contractOf(c),
      ...semanticOf(c),
    });
  }
}

// ── 03 · Screens ─────────────────────────────────────────────
const screenPage = pageByName('03 · Screens');
if (screenPage) {
  await figma.setCurrentPageAsync(screenPage);
  const frames = await findAll(screenPage, ['FRAME']);
  for (const f of frames) {
    if (!f.name.startsWith('Screen/')) continue;
    out.screens.push({
      name: f.name,
      nodeId: f.id,
      type: 'FRAME',
      contract: contractOf(f),
      ...semanticOf(f),
    });
  }
}

// ── 04 · Motion · MOTION SPEC ────────────────────────────────
const motionPage = pageByName('04 · Motion');
if (motionPage) {
  await figma.setCurrentPageAsync(motionPage);
  const specFrame = (motionPage.children || []).find((n) => n.name === 'MOTION SPEC');
  if (specFrame) {
    const carrier = carrierOf(specFrame);
    // ⚠️ **也走共享实现**：MOTION SPEC 的 JSON 用的就是同一套「---」包裹约定，
    //    这里若手写第二份正则 ⇒ 约定一改（fence 换了写法）motion 腿会**静默失效**
    //    （提不出 JSON ⇒ spec 空 ⇒ 门禁看不出任何异常）。
    const body = extractContractSection(carrier);
    let motion = null;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        motion = { spec: parsed.spec || [], version: parsed.MOTION_SPEC || null, rawLength: body.length };
      } catch (e) {
        motion = { spec: [], version: null, parseError: String(e && e.message ? e.message : e), rawLength: body.length };
      }
    }
    out.motion = motion || { spec: [], version: null, missing: true };
  }
}

out.pages = pages.map((p) => p.name);
out.counts = {
  components: out.components.length,
  screens: out.screens.length,
  motionEntries: out.motion ? out.motion.spec.length : 0,
};
return JSON.stringify(out);

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
