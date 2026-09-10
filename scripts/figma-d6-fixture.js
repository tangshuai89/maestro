// Figma REST /files/:key fixture (D6 audit-d6 测试用)
// 包含：D1 6 屏（全 PASS）+ 1 v4-ABC 组件（FAIL 缺 react）+ 1 README（全 PASS）
import { writeFileSync } from 'node:fs';

const aiContract = (overrides = {}) => `---
AI_CONTRACT:
  react: packages/renderer/src/components/views/TheaterView.tsx
  props: {}
  a11y: { role: dialog, keyboard: [Escape] }
  states: [default, loading]
  motion: { enter: fade 200ms }
  tokens: [Color/semantic/text-main]
  bindings: [Scene/Backdrop]
${overrides.extra || ''}---`;

const screenFrame = (name, x) => ({
  id: `${name.toLowerCase()}-id`,
  type: 'FRAME',
  name,
  x,
  y: 0,
  width: 1440,
  height: 900,
  description: aiContract(),
});

const component = (name, desc) => ({
  id: `${name.toLowerCase()}-id`,
  type: 'COMPONENT_SET',
  name,
  description: desc,
});

const fixture = {
  document: {
    children: [
      {
        type: 'CANVAS',
        name: '03 · Screens',
        children: [
          screenFrame('Screen/Search/Modal', 1480),
          screenFrame('Screen/Liked/Modal', 2960),
          screenFrame('Screen/Settings/Full', 4440),
          screenFrame('Screen/RecoKey/Modal', 5920),
          screenFrame('Screen/AuthError/Full', 7400),
          screenFrame('Screen/EmptyState/Full', 8880),
        ],
      },
      {
        type: 'CANVAS',
        name: '02 · Components',
        children: [
          // PASS：v4-ABC 组件有完整 description
          component('Ring/Sound', aiContract()),
          // FAIL：v4-ABC 组件 description 缺 react
          component('Hologram/Cover', `---
AI_CONTRACT:
  props: {}
  a11y: { role: img }
  states: [idle, playing]
  motion: { ambient: breathing 1.4s }
  tokens: [Color/semantic/text-main]
---`),
        ],
      },
      {
        type: 'CANVAS',
        name: '01 · Foundations',
        children: [
          {
            type: 'FRAME',
            name: 'README — AI CONTRACT',
            id: 'readme-id',
            description: aiContract(),
          },
        ],
      },
      {
        type: 'CANVAS',
        name: '04 · Motion',
        children: [
          {
            type: 'FRAME',
            name: 'MOTION SPEC',
            id: 'motion-spec-id',
            description: aiContract({ extra: '  driver: bass-intensity\n' }),
          },
        ],
      },
      {
        type: 'CANVAS',
        name: '99 · Archive',
        children: [
          {
            type: 'FRAME',
            name: 'Archive README',
            id: 'archive-readme-id',
            description: aiContract(),
          },
        ],
      },
    ],
  },
};

writeFileSync(process.argv[2] || '/tmp/d6.json', JSON.stringify(fixture, null, 2));
console.log(`Fixture written to ${process.argv[2] || '/tmp/d6.json'}`);
