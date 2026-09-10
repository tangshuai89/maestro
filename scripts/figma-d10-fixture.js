// Figma REST /files/:key fixture (D10 audit-d10 测试用)
// 包含：04 · Motion · MOTION SPEC frame 含完整 MOTION_SPEC 段 + 1 条负面用例（缺 driver）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');
const spec = JSON.parse(readFileSync(resolve(repo, 'specs/motion-spec.json'), 'utf8'));

// 复制 spec 数组，注入 1 条负面用例（ambient 缺 driver）
const failingSpec = {
  ...spec.spec[16], // 复制 ambient-cover-breathing
  id: 'ambient-broken-no-driver',
  // 故意删掉 driver 字段
};
delete failingSpec.driver;
const fullSpec = [...spec.spec, failingSpec];

const fixture = {
  document: {
    children: [
      {
        type: 'CANVAS',
        name: '04 · Motion',
        children: [
          {
            id: 'motion-spec-frame-id',
            type: 'FRAME',
            name: 'MOTION SPEC',
            description: `---
${JSON.stringify({ MOTION_SPEC: spec.version, spec: fullSpec }, null, 0)}
---`,
          },
        ],
      },
    ],
  },
};

writeFileSync(process.argv[2] || '/tmp/d10.json', JSON.stringify(fixture, null, 2));
console.log(`Fixture written to ${process.argv[2] || '/tmp/d10.json'}（共 ${fullSpec.length} spec，1 条负面用例缺 driver）`);
