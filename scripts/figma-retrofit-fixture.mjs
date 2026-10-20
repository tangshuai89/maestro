#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 合成「老旧设计稿」fixture —— 给 figma-retrofit-analyze.mjs 做离线自测
//
// 生成的是一份**扁平**的 Figma REST 文件响应（模拟 GET /v1/files/:key）：
//   · 3 个屏幕（top-level frame），绝对定位
//   · 大量重复单元（按钮 12 个、曲目卡 5 个、平台徽章 7 个、歌词行 9 行）
//   · 硬编码颜色（无任何 boundVariables）
//   · 4 种文字样式、若干圆角与阴影
//   · 少量 auto-layout 容器（padding / itemSpacing 明确）
//
// 用法: node scripts/figma-retrofit-fixture.mjs [out.json]
// ─────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let uid = 0;
const nid = () => `1:${++uid}`;

const rect = (x, y, w, h, fill, extra = {}) => ({
  id: nid(),
  name: extra.name ?? 'Rectangle',
  type: 'RECTANGLE',
  absoluteBoundingBox: { x, y, width: w, height: h },
  fills: [{ type: 'SOLID', color: fill, opacity: 1 }],
  ...extra,
});

const text = (x, y, w, h, chars, style, fill, extra = {}) => ({
  id: nid(),
  name: extra.name ?? chars.slice(0, 12),
  type: 'TEXT',
  absoluteBoundingBox: { x, y, width: w, height: h },
  characters: chars,
  style: {
    fontFamily: 'Inter',
    fontWeight: 400,
    fontSize: 14,
    lineHeightPx: 20,
    letterSpacing: 0,
    textAlignHorizontal: 'LEFT',
    ...style,
  },
  fills: [{ type: 'SOLID', color: fill, opacity: 1 }],
  ...extra,
});

const frame = (x, y, w, h, children, extra = {}) => ({
  id: nid(),
  name: extra.name ?? 'Frame',
  type: 'FRAME',
  absoluteBoundingBox: { x, y, width: w, height: h },
  fills: extra.fills ?? [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 0 }, opacity: 0 }],
  children,
  ...extra,
});

// ---- 调色板（全部硬编码，模拟老稿）----
const BG = { r: 0.039, g: 0.02, b: 0.094, a: 1 };
const SURFACE = { r: 0.063, g: 0.043, b: 0.129, a: 1 };
const ACCENT = { r: 0, g: 0.898, b: 1, a: 1 };
const TEXT = { r: 0.961, g: 0.941, b: 0.91, a: 1 };
const MUTED = { r: 0.545, g: 0.545, b: 0.639, a: 1 };
const BORDER = { r: 0.165, g: 0.118, b: 0.29, a: 1 };

const TYPE = {
  h1: { fontSize: 28, fontWeight: 700, lineHeightPx: 34 },
  h2: { fontSize: 18, fontWeight: 600, lineHeightPx: 24 },
  body: { fontSize: 14, fontWeight: 400, lineHeightPx: 20 },
  mono: { fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 400, lineHeightPx: 16 },
};

/** 重复单元：图标按钮（老稿里全是同名 group 不同 id） */
function iconButton(x, y, glyph) {
  return frame(
    x,
    y,
    32,
    32,
    [text(x + 8, y + 6, 16, 20, glyph, TYPE.mono, TEXT, { name: 'icon' })],
    {
      name: 'group',
      fills: [{ type: 'SOLID', color: SURFACE, opacity: 1 }],
      cornerRadius: 8,
      strokes: [{ type: 'SOLID', color: BORDER, opacity: 1 }],
      strokeWeight: 1,
    },
  );
}

/** 重复单元：曲目卡（曲名/艺人不同 → 内容差异，不是样式差异） */
function trackCard(x, y, title, artist) {
  return frame(
    x,
    y,
    280,
    72,
    [
      rect(x + 12, y + 12, 48, 48, SURFACE, { name: 'cover', cornerRadius: 8 }),
      text(x + 76, y + 16, 190, 20, title, TYPE.h2, TEXT, { name: 'title' }),
      text(x + 76, y + 40, 190, 18, artist, TYPE.body, MUTED, { name: 'artist' }),
    ],
    {
      name: 'card',
      fills: [{ type: 'SOLID', color: SURFACE, opacity: 1 }],
      cornerRadius: 12,
    },
  );
}

/** 重复单元：平台徽章（不同平台 → 变体轴候选） */
function platformBadge(x, y, label, color) {
  return frame(
    x,
    y,
    44,
    20,
    [text(x + 6, y + 2, 32, 16, label, TYPE.mono, color, { name: 'label' })],
    {
      name: 'badge',
      fills: [{ type: 'SOLID', color: BG, opacity: 1 }],
      cornerRadius: 4,
      strokes: [{ type: 'SOLID', color, opacity: 1 }],
      strokeWeight: 1,
    },
  );
}

/** 重复单元：歌词行（当前行高亮 → 颜色变体轴） */
function lyricLine(x, y, content, active) {
  return frame(
    x,
    y,
    420,
    28,
    [text(x + 16, y + 4, 388, 20, content, TYPE.body, active ? ACCENT : MUTED, { name: 'lyric' })],
    { name: 'lyric-line', fills: [] },
  );
}

const GLYPHS = ['⏮', '▶', '⏭', '🔍'];

function buildScreen(name, x, y, opts = {}) {
  const kids = [];
  // 标题栏：4 个重复图标按钮
  GLYPHS.forEach((g, i) => kids.push(iconButton(x + 900 + i * 40, y + 12, g)));
  kids.push(text(x + 24, y + 16, 200, 24, 'Maestro', TYPE.h1, TEXT, { name: 'brand' }));

  // 曲目卡 ×N
  const tracks = [
    ['夜空中最亮的星', '逃跑计划'],
    ['海阔天空', 'Beyond'],
    ['光年之外', 'G.E.M.'],
  ];
  tracks.slice(0, opts.tracks ?? 3).forEach(([t, a], i) => {
    kids.push(trackCard(x + 24, y + 80 + i * 88, t, a));
  });

  // 平台徽章 ×N（不同平台色 → 变体）
  const badges = [
    ['QQ', { r: 0.2, g: 0.8, b: 0.4, a: 1 }],
    ['网易', ACCENT],
    ['DZ', { r: 1, g: 0.55, b: 0.1, a: 1 }],
    ['SP', { r: 0.2, g: 0.9, b: 0.4, a: 1 }],
  ];
  badges.forEach(([label, c], i) => {
    kids.push(platformBadge(x + 24 + i * 52, y + 380, label, c));
  });

  // 歌词行 ×N（第 2 行高亮）
  const lines = ['这是一段很长的歌词', '这是第二行当前播放', '这是第三行歌词'];
  lines.forEach((l, i) => kids.push(lyricLine(x + 24, y + 430 + i * 32, l, i === 1)));

  // 一个 auto-layout 容器（明确 padding / itemSpacing）
  kids.push(
    frame(
      x + 24,
      y + 560,
      320,
      64,
      [
        text(x + 40, y + 576, 280, 20, 'AI 推荐已就绪 · 曲库 128 首', TYPE.body, MUTED, {
          name: 'reco',
        }),
      ],
      {
        name: 'reco-panel',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        fills: [{ type: 'SOLID', color: SURFACE, opacity: 1 }],
        cornerRadius: 16,
      },
    ),
  );

  return frame(x, y, 1024, 768, kids, {
    name,
    fills: [{ type: 'SOLID', color: BG, opacity: 1 }],
  });
}

const screens = [
  buildScreen('Player / Desktop', 0, 0),
  buildScreen('Player / Compact', 1100, 0, { tracks: 2 }),
  buildScreen('Library / Desktop', 2200, 0, { tracks: 3 }),
];

const file = {
  name: 'Legacy Player Design (flat)',
  lastModified: '2026-08-01T00:00:00Z',
  version: '120000000',
  schemaVersion: 0,
  document: {
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [
      {
        id: nid(),
        name: 'Cover',
        type: 'CANVAS',
        children: screens,
      },
    ],
  },
  components: {},
  componentSets: {},
  styles: {},
};

function countNodes(node) {
  let n = 1;
  for (const c of node.children ?? []) n += countNodes(c);
  return n;
}

const out = resolve(process.argv[2] ?? '/tmp/figma-legacy-fixture.json');
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
console.log(`fixture 已写入 ${out}`);
console.log(
  `  屏幕 ${screens.length} 个 · 节点 ${countNodes(file.document)} 个 · 重复单元：无组件、无变量、无样式`,
);
