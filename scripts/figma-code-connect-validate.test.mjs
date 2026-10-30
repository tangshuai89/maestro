import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validator = join(repo, 'scripts/figma-code-connect-validate.mjs');

function runValidation({ mappings, snapshot }) {
  const dir = mkdtempSync(join(tmpdir(), 'figma-code-connect-'));
  const mapPath = join(dir, 'figma-code-connect.json');
  const snapshotPath = join(dir, 'figma-snapshot.json');

  try {
    writeFileSync(
      mapPath,
      JSON.stringify({
        $figmaFileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
        mappings,
      }),
    );
    writeFileSync(snapshotPath, JSON.stringify(snapshot));

    const result = spawnSync(
      process.execPath,
      [validator, '--map', mapPath, '--snapshot', snapshotPath, '--json'],
      { cwd: repo, encoding: 'utf8' },
    );

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('快照里有新组件却没映射时，覆盖率检查必须失败并指出缺口', () => {
  const result = runValidation({
    mappings: [
      {
        figmaComponent: 'Scene/Mapped',
        figmaNodeId: '1:1',
        reactComponent: 'TheaterView',
        reactPath: 'packages/renderer/src/components/views/TheaterView.tsx',
        _status: 'PENDING_REFACTOR',
        props: {},
      },
    ],
    snapshot: {
      components: [
        { nodeId: '1:1', name: 'Scene/Mapped' },
        { nodeId: '1:2', name: 'Scene/NewWithoutMapping' },
      ],
      screens: [],
    },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.coverage.components, {
    mapped: 1,
    total: 2,
    missing: [{ name: 'Scene/NewWithoutMapping', nodeId: '1:2' }],
  });
  assert.equal(report.pass, false);
});
