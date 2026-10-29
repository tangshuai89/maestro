// ─────────────────────────────────────────────────────────────
// AETHER — AI_CONTRACT 段草案生成（纯函数核心）
//
// 做什么：从「快照 + code-connect 映射 + 仓库现状」推导出一批
// **AI_CONTRACT 段的草案**，供 Figma 写入插件搬运到设计稿上。
//
// 为什么是「草案」而不是「权威契约」（2026-10-29 实测得出）：
//   我原以为契约内容能从 code-connect 映射机械推导，逐条比对后发现**不能**：
//   · props —— 同一个组件，映射里是 `{provider: MusicProvider}`，人工契约写的是
//     `{provider: enum[qq|netease|deezer|spotify]}`；`Array` 写成了 `DeezerEditorial[]`；
//     `string?` 一处写成 `panelClassName?: string`、另一处（Titlebar）写成了不带 `?`；
//     Titlebar 的 23 个 props 到了契约里变成 22 个、顺序还变了、类型整列省略。
//     ⇒ 契约是**人工写的设计约定**，不是映射的函数。
//   · a11y / tokens / bindings —— 映射里**根本没有**这些字段。
//   · states —— 只有 `state=` 前缀的变体才对应状态；`platform=` / `provider=` /
////     `quality=` 是「选项」维度不是「状态」维度（SourceChip 的
//     states=[default,best,no-rights] 根本不在它的变体里）。
//
// ⇒ 所以本模块的定位是**起草**，不是**判定**：
//   ① 每个字段都带 `provenance`（从哪来：mapping / variants / convention / none）
//   ② 推不出来的**不编造** —— 例如没有 code-connect 映射就没有 react 归属，
//      那就**跳过**并写进 `skipped`，不编一个假路径（假路径会给前端发一条
//      假的 must：「该建 packages/…/Prev.tsx」—— 而它可能永远不会建）
//   ③ 整段带 `draft: true` 标记，让下游知道这段还没被人确认过
//
// 纯函数、不碰 fs、不 spawn ⇒ 可离线单测（反向验证：喂坏数据必须被抓住）。
//
// 关联：specs/figma-diff/ · scripts/figma-contract-payload.mjs（CLI）
//       · scripts/figma-write-plugin/（写入插件）
// ─────────────────────────────────────────────────────────────

// ⚠️ 「契约段的提取 / 合并」**只有一份实现**（scripts/lib/figma-contract-section.js），
//    采集段 / 写入插件 / 本模块三处共用 —— 见那个文件的说明（为什么不能各写一份）。
import sectionModule from './figma-contract-section.js';

const {
  SECTION_FENCE,
  CONTRACT_SECTION_NAME,
  extractContractSection,
  hasContractSection,
  mergeContractSection,
} = sectionModule;

/** 契约段的必填字段（与 lib/figma-snapshot.mjs 的 REQUIRED_AI_CONTRACT_FIELDS 对齐）。 */
export const REQUIRED_AI_CONTRACT_FIELDS = ['react', 'props', 'a11y', 'states'];

/** 契约载体里的段名（FRAME 的隐藏 TEXT 子节点用这个名字）。 */
export const CARRIER_TEXT_NAME = CONTRACT_SECTION_NAME;

/** 契约段在载体里的包裹标记 —— 采集段的 contractOf() 用 /---([\s\S]*?)---/ 精确提取。 */
export { SECTION_FENCE };

// ── a11y 族惯例 ─────────────────────────────────────────────────
// ⚠️ **这些是按组件语义推断的默认值，不是设计稿上的既有事实。**
//    快照证明这 34 个节点**在设计稿上就没有契约段** ⇒ 设计稿没规定无障碍语义。
//    这里给的是「按名字语义该有的最小约定」，用来让契约字段齐全、可被审阅。
//    每条都带 provenance='convention'，报告里单列出来请人确认。
//
// 判据：只给**角色**这类几乎无争议的；keyboard 一律留空 —— 键位组合是真正的设计决定，
// 猜错的代价比缺省的代价大得多（错的键盘约定会写出错的 handler）。
export const A11Y_CONVENTIONS = {
  'Icon/': { role: 'img', keyboard: [] },
  'Button/': { role: 'button', keyboard: [] },
  'Input/': { role: 'textbox', keyboard: [] },
  'Controls/': { role: 'group', keyboard: [] },
  'Tag/': { role: 'status', keyboard: [] },
  'Badge/': { role: 'img', keyboard: [] },
  'Ring/': { role: 'progressbar', keyboard: [] },
  'Card/': { role: 'group', keyboard: [] },
  'Core/': { role: 'button', keyboard: [] },
  'Lyrics/': { role: 'group', keyboard: [] },
  'Hologram/': { role: 'img', keyboard: [] },
  'State/': { role: 'status', keyboard: [] },
  'Scene/': { role: 'presentation', keyboard: [] },
  'Screen/': { role: 'region', keyboard: [] },
  'Modal/': { role: 'dialog', keyboard: [] },
};

/**
 * states 推导：只认 `state=` 前缀的变体。
 *
 * 为什么不能用「所有变体」：`platform=qq` / `provider=qq` / `quality=high` /
 * `tone=cyan` / `size=sm` 是**其它维度**（选项 / 色调 / 尺寸），不是状态。
 * 实证：已完成的 SourceChip 变体是 platform=qq|netease|deezer|spotify，
 * 但它的 states 是 [default, best, no-rights] —— 压根不在变体里。
 * ⇒ 宁可少推，不可推错。
 */
export function deriveStates(variants) {
  const out = [];
  for (const v of Array.isArray(variants) ? variants : []) {
    const m = /(?:^|,)\s*state=([^,]+)/.exec(String(v));
    if (m) {
      const s = m[1].trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * props 推导：从 code-connect 映射的 props 签名转成契约里的 `{ name: type }`。
 *
 * 转写规则（按实证）：
 *   type 末尾是 `?` ⇒ 写成 `name?: type`（去掉尾部的 `?`）
 *   其余 ⇒ `name: type`
 *
 * ⚠️ 这只是**签名**层面的转写（名字 + 类型），**不含**设计语义 ——
 *    实测里人工契约会换类型（MusicProvider → enum[qq|…]）、会省略类型
 *    （Titlebar）、会增删字段、还会改顺序。
 *    ⇒ 产出的 props 一律标 provenance='mapping-signature'，
 *      报告里单列，请人核对后再当权威。
 */
export function deriveProps(mapping) {
  const props = mapping?.props;
  if (!props || typeof props !== 'object') return { text: '{}', present: false };
  const parts = [];
  for (const [name, spec] of Object.entries(props)) {
    const rawType = spec && typeof spec.type === 'string' ? spec.type.trim() : '';
    if (!rawType) continue;
    if (rawType.endsWith('?')) parts.push(`${name}?: ${rawType.slice(0, -1).trim()}`);
    else parts.push(`${name}: ${rawType}`);
  }
  return { text: parts.length ? `{ ${parts.join(', ')} }` : '{}', present: parts.length > 0 };
}

/** a11y 推导：按组件名的族惯例；命中不了 ⇒ 空对象（不编造）。 */
export function deriveA11y(name) {
  for (const [prefix, value] of Object.entries(A11Y_CONVENTIONS)) {
    if (String(name).startsWith(prefix)) {
      return {
        text: `{ role: ${value.role}, keyboard: [${value.keyboard.join(', ')}] }`,
        role: value.role,
      };
    }
  }
  return { text: '{}', role: null };
}

/**
 * 契约段正文（**不含** `---` 包裹 —— 包裹由 buildCarrierText 加）。
 *
 * 字段顺序固定：react → props → a11y → states → tokens → bindings → draft
 * —— 与已有 10 份人工契约的顺序一致（react 必在 props 前）。
 */
export function buildContractBody({
  react,
  props,
  a11y,
  states,
  tokens = [],
  bindings = [],
  draft = true,
}) {
  const lines = [
    'AI_CONTRACT:',
    `  react: ${react}`,
    `  props: ${props}`,
    `  a11y: ${a11y}`,
    `  states: [${states.join(', ')}]`,
    `  tokens: [${tokens.join(', ')}]`,
    `  bindings: [${bindings.join(', ')}]`,
  ];
  if (draft) lines.push('  draft: true');
  return lines.join('\n');
}

/**
 * 载体文本 = 段正文用 `---` 裹起来。
 *
 * ⚠️ **必须裹**：采集段的 contractOf() 是 `raw.match(/---([\s\S]*?)---/)`
 *    —— 不裹就提不出契约段（下次采集会认为"这节点只有散文没有契约"）。
 *    这是「写回」与「读取」之间最容易踩的格式坑。
 *
 * ⚠️ **实现走共享的 mergeContractSection**（而不是自己拼字符串）：
 *    这样「生成器产出的载体文本」与「插件写回时的载体文本」**逐字一致** ——
 *    两边格式若分叉，写进去的东西采集段就提不出来（而且现场看不出异常）。
 */
export function buildCarrierText(contractBody) {
  return mergeContractSection('', contractBody);
}

/** 载体类型：COMPONENT(SET) 有 .description；FRAME 没有（只有 PublishableMixin 有）⇒ 走隐藏 TEXT 子节点。 */
export function carrierOf(nodeType) {
  if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return 'description';
  if (nodeType === 'FRAME') return 'text-child';
  return null;
}

/**
 * 生成 payload。
 *
 * @param {object} p
 * @param {object} p.snapshot      scripts/figma-snapshot.json 的内容
 * @param {Array}  p.mappings       figma-code-connect.json 的 mappings
 * @param {Function} [p.repoFileExists]  路径是否存在（测试用注入）
 * @param {string} [p.generatedAt]
 * @returns {{fileKey:string, writes:Array, skipped:Array, stats:object}}
 */
export function buildContractPayload({ snapshot, mappings, repoFileExists = () => true }) {
  const writes = [];
  const skipped = [];

  const byName = new Map();
  for (const m of Array.isArray(mappings) ? mappings : []) {
    if (!byName.has(m.figmaComponent)) byName.set(m.figmaComponent, []);
    byName.get(m.figmaComponent).push(m);
  }

  const nodes = [
    ...(snapshot?.components ?? []).map((c) => ({ ...c, kind: 'component' })),
    ...(snapshot?.screens ?? []).map((c) => ({ ...c, kind: 'screen' })),
  ];

  for (const node of nodes) {
    const name = node.name;
    const nodeId = node.nodeId;

    // 已经有契约段的 ⇒ 不碰（幂等的第一道闸；插件里还有第二道）
    if (node.contract && String(node.contract).trim()) {
      skipped.push({ nodeId, name, kind: node.kind, reason: 'already-has-contract' });
      continue;
    }

    const carrier = carrierOf(node.type);
    if (!carrier) {
      skipped.push({ nodeId, name, kind: node.kind, reason: `unsupported-carrier:${node.type}` });
      continue;
    }

    const candidates = byName.get(name) ?? [];
    // ⚠️ 映射必须**指到这个节点自己**才算数（nodeId 严格相等）。
    //    绝不能「只有一个候选就拿来用」—— 同名不同类的情况下那会把
    //    另一个节点的 react 归属安到这个节点头上
    //    （Screen/SourceSelect 既是 COMPONENT_SET 515:133 又是同名 FRAME 314:1432；
    //      2026-10-29 独立评审查出的回退 C 就是这一类）。
    const mapping = candidates.find((m) => m.figmaNodeId && m.figmaNodeId === nodeId) ?? null;

    const react = mapping?.reactPath ? String(mapping.reactPath) : '';
    if (!react) {
      // ⚠️ **不编路径**：没有 code-connect 映射 ⇒ 这个组件在前端还没有归属。
      //    编一个路径等于给前端发一条假的 must（「该建 …/Prev.tsx」），
      //    而它可能永远不会建。⇒ 跳过并写明原因。
      skipped.push({ nodeId, name, kind: node.kind, reason: 'no-react-mapping' });
      continue;
    }

    const props = deriveProps(mapping);
    const a11y = deriveA11y(name);
    const states = deriveStates(node.variants);

    const provenance = {
      react: mapping.reactPath ? 'mapping' : 'none',
      props: props.present ? 'mapping-signature' : 'none',
      a11y: a11y.role ? 'convention' : 'none',
      states: states.length ? 'variants' : 'none',
      tokens: 'none',
      bindings: 'none',
      draft: true,
    };

    const body = buildContractBody({
      react,
      props: props.text,
      a11y: a11y.text,
      states,
      tokens: [],
      bindings: [],
      draft: true,
    });

    writes.push({
      nodeId,
      name,
      kind: node.kind,
      type: node.type,
      carrier,
      carrierText: buildCarrierText(body),
      contractBody: body,
      provenance,
      reactExists: Boolean(repoFileExists(react)),
    });
  }

  return {
    fileKey: snapshot?.fileKey ?? null,
    // ⚠️ **用快照的采集时间，不用「现在」** —— 否则每次生成都不一样，
    //    `--check`（产物是否与快照同步）就永远红，等于没有门禁。
    //    顺带语义更准：payload 的版本就是快照的版本。
    snapshotCapturedAt: snapshot?.capturedAt ?? null,
    writes,
    skipped,
    stats: {
      total: nodes.length,
      writes: writes.length,
      skipped: skipped.length,
      byReason: skipped.reduce((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}
