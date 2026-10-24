/**
 * L1 离线回放评测 · 门禁测试（specs/eval-driven-nl/ Phase B）。
 *
 * 覆盖：
 *   1. **确定性**：同输入跑两次，数字完全一致（0 网络 0 token 的前提）
 *   2. **不变量全过**：真实 fixture 上跑 L0 的 7 条不变量
 *   3. **黄金集覆盖够**：覆盖不足 → 拒绝给结论（不当通过算）
 *   4. **fixture / 黄金集缺失 → fail loud**（不静默按"通过"算）
 *   5. **基线对比**：纯度下降超过容差 → 门禁红
 */
export {};

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  compareOfflineToBaseline,
  createFixtureMusic,
  evaluateOfflineScenario,
  formatOfflineReport,
  loadFixture,
  loadGolden,
  MIN_GOLDEN_COVERAGE,
  runOfflineEval,
  DEFAULT_FIXTURE_DIR,
} = require('./eval-offline');
const { createPoolProbe } = require('./eval-invariants');

async function main() {
  // ── 4. fixture / 黄金集缺失 → fail loud ────────────────
  {
    assert.throws(
      () => loadFixture(path.join(__dirname, '__no_such_dir__')),
      /fixture 不存在/,
      'fixture 缺失必须明确报错（不静默当通过）',
    );
    assert.throws(
      () => loadGolden(path.join(__dirname, '__no_such_dir__')),
      /黄金集不存在/,
      '黄金集缺失必须明确报错',
    );
    console.log('  ✓ fixture / 黄金集缺失 → fail loud');
  }

  // fixture 必须存在（这是 PR 门禁的前提；缺了就该红）
  assert.ok(
    fs.existsSync(path.join(DEFAULT_FIXTURE_DIR, 'nl-search.json')),
    'fixture 未入库：跑 node scripts/record-nl-fixtures.mjs 录一份',
  );
  assert.ok(
    fs.existsSync(path.join(DEFAULT_FIXTURE_DIR, 'genre-golden.json')),
    '黄金集未入库：跑 node scripts/record-nl-fixtures.mjs 录一份',
  );

  const fixture = loadFixture();
  const golden = loadGolden();
  assert.ok(Object.keys(fixture.scenarios).length > 0, 'fixture 里有场景');
  assert.ok(Object.keys(golden).length > 0, '黄金集非空');

  // ── 1. 确定性 ─────────────────────────────────────────
  {
    const a = await runOfflineEval();
    const b = await runOfflineEval();
    assert.deepStrictEqual(
      a.scenarios.map((s: any) => [
        s.id,
        s.poolSize,
        s.seedBlockSize,
        s.seedBlockPurity,
        s.queuePurity,
      ]),
      b.scenarios.map((s: any) => [
        s.id,
        s.poolSize,
        s.seedBlockSize,
        s.seedBlockPurity,
        s.queuePurity,
      ]),
      '同输入两次跑必须完全一致',
    );
    console.log(`  ✓ 确定性: ${a.scenarios.length} 个场景两次跑数字一致`);
  }

  // ── 2 + 3. 不变量全过 + 黄金集覆盖够 ──────────────────
  {
    const report = await runOfflineEval();
    const broken = report.scenarios.filter((s: any) => s.invariants.some((i: any) => !i.pass));
    assert.strictEqual(broken.length, 0, `这些场景的不变量没过：\n${formatOfflineReport(report)}`);
    const inconclusive = report.scenarios.filter((s: any) => s.inconclusive);
    assert.strictEqual(
      inconclusive.length,
      0,
      `黄金集覆盖不足（拒绝给结论）：${inconclusive.map((s: any) => s.id).join('、')}`,
    );
    // 覆盖率必须整体够（否则结论不可信）
    assert.ok(
      report.average.goldenCoverage >= MIN_GOLDEN_COVERAGE,
      `黄金集覆盖率 ${report.average.goldenCoverage} 低于 ${MIN_GOLDEN_COVERAGE}`,
    );
    console.log(
      `  ✓ 不变量全过（${report.scenarios.length} 场景）｜黄金集覆盖 ${(report.average.goldenCoverage * 100).toFixed(1)}%`,
    );
  }

  // ── 5. 基线对比：纯度下降 → 门禁红 ────────────────────
  {
    const report = await runOfflineEval();
    // 造一个"基线更高"的假基线 → 必然超容差 → 必须判红
    const fakeBaseline = {
      scenarios: report.scenarios.map((s: any) => ({
        id: s.id,
        seedBlockPurity: Math.min(1, s.seedBlockPurity + 0.3),
        queuePurity: Math.min(1, s.queuePurity + 0.3),
      })),
    };
    const cmp = compareOfflineToBaseline(fakeBaseline, report, 5);
    assert.strictEqual(cmp.ok, false, '低于基线超过容差 → 门禁必须红');
    assert.ok(cmp.lines.some((l: string) => l.includes('❌')));

    // 反过来：基线更低 → 必须绿
    const lowBaseline = {
      scenarios: report.scenarios.map((s: any) => ({
        id: s.id,
        seedBlockPurity: Math.max(0, s.seedBlockPurity - 0.05),
        queuePurity: Math.max(0, s.queuePurity - 0.05),
      })),
    };
    const cmp2 = compareOfflineToBaseline(lowBaseline, report, 5);
    assert.strictEqual(cmp2.ok, true, '不低于基线 → 门禁必须绿');
    console.log('  ✓ 基线对比: 下降超容差 → 红 / 不低于基线 → 绿');
  }

  // ── 6. 覆盖评测自身的分支（CI 的 coverage diff 门禁会判"新增行没被测到"）──
  {
    // 6a. fixture 里有、但当前场景定义里没有的场景 → 明确报错（fail loud）
    const sc: any = Object.values(fixture.scenarios)[0];
    await assert.rejects(
      () => evaluateOfflineScenario({ ...sc, id: '__不存在的场景__' }, fixture, golden, 12),
      /在当前评测定义里不存在/,
      'fixture 与评测定义不一致时必须 fail loud',
    );

    // 6b. 黄金集覆盖不足 → 拒绝给结论（不当通过算）
    const noTags = await evaluateOfflineScenario(
      { ...sc, id: 'jazz', search: {}, related: {}, picks: [], queue: [] },
      fixture,
      {},
      12,
    );
    assert.ok(noTags.inconclusive, '黄金集为空 → 拒绝给结论');
    assert.strictEqual(noTags.pass, false, '拒绝给结论 ≠ 通过');
    // 报告里也要打出来（"拒绝给结论"这行在报告格式里）
    const repInconclusive = formatOfflineReport({
      at: Date.now(),
      fixtureRecordedAt: 'x',
      count: 12,
      scenarios: [noTags],
      average: {
        seedBlockPurity: 0,
        poolPurity: 0,
        queuePurity: 0,
        pickRetention: 0,
        goldenCoverage: 0,
        passRate: 0,
      },
    });
    assert.match(repInconclusive, /拒绝给结论/);

    // 6c. 基线里缺这个场景 → 判红（提示要更新基线）
    const rep = await runOfflineEval({ only: ['jazz'] });
    const cmp = compareOfflineToBaseline({ scenarios: [] }, rep, 5);
    assert.strictEqual(cmp.ok, false, '基线缺场景 → 门禁必须红');
    assert.ok(cmp.lines.some((l: string) => l.includes('基线里没有这个场景')));

    // 6d. fake provider 的 FM 分支：intent 模式永不拉 FM，但那段代码要被测到
    const probe = createPoolProbe();
    const fake = createFixtureMusic({}, {}, probe);
    const radios = await fake.fetchRecoRadioCandidates();
    assert.deepStrictEqual(radios, []);
    assert.strictEqual(probe.radioFetched, true, 'fake 的 FM 分支记录到了调用');

    // 6e. CLI 入口：导出成可测的 runCli（CI 门禁判"新增文件没被 import"）
    const { runCli } = require('./eval-offline-cli');
    const code = await runCli(['--only=jazz', '--json']);
    assert.strictEqual(code, 0, 'CLI 跑单个场景应返回 0');
    const { runCli: sweepRunCli } = require('./sweep-cli');
    assert.strictEqual(await sweepRunCli(['--only=jazz', '--json']), 0, '扫描 CLI 应返回 0');
    // 6f. CLI 的各种参数分支（"--k=v" 与 "--k v" 两种写法都要走通）
    assert.strictEqual(
      await runCli([
        '--only=jazz',
        '--json',
        '--count=8',
        '--tolerance=10',
        '--baseline',
        path.join(__dirname, '../../../../specs/eval-driven-nl/baseline.json'),
        '--fixture-dir',
        path.join(__dirname, '__fixtures__'),
      ]),
      0,
      'CLI 各种参数写法都应正常跑完',
    );
    // 基线文件不存在 → **门禁拒绝判定**（返回 1）
    //
    // ⚠️ 这条断言**反转过**：旧实现是「跳过对比、仍算通过」。
    //   那等于「少一条判据 = 门禁自动变弱」，而实测这个洞能开多大：
    //   把 jazz 的黄金标签全改成 pop（纯度 100% → 0%）+ 基线缺失
    //   → 门禁照样「✅ 通过」、exit 0。纯度崩了都拦不住。
    //   spec L1 明写「基线入库」「不静默按通过算」→ 缺基线是**配置坏了**，
    //   必须显式失败。
    assert.strictEqual(
      await runCli(['--only=jazz', '--baseline', path.join(__dirname, '__no_baseline__.json')]),
      1,
      '没有基线文件时必须拒绝判定（不能静默按通过算）',
    );
    // fixture 目录不存在 → 明确报错（不静默）
    await assert.rejects(
      () => runCli(['--fixture-dir', path.join(__dirname, '__no_such_dir__')]),
      /fixture 不存在/,
      'fixture 缺失必须 fail loud',
    );
    // 扫描 CLI 的非 JSON 分支
    assert.strictEqual(await sweepRunCli(['--only=jazz']), 0, '扫描 CLI 表格分支');
    // 6g. CLI 的**失败路径**：造一个"种子块填不满"的坏 fixture
    //     → 不变量门禁红 → CLI 报"门禁未通过"并返回 1；
    //     同时黄金集为空 → 报"拒绝给结论"。
    const os = require('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-eval-'));
    const mkItem = (t: string, a: string) => ({
      title: t,
      artist: a,
      album: '',
      duration: 200,
      bestSource: 'qq',
      versionType: 'studio',
      inLibrary: false,
    });
    const badSeeds = ['A1', 'A2', 'A3', 'A4'];
    const badScenario = {
      id: 'jazz',
      text: '来点儿爵士乐',
      expect: ['jazz'],
      adjacent: [],
      intent: {},
      seeds: badSeeds,
      related: {},
      search: Object.fromEntries(badSeeds.map((a) => [a, [mkItem(`${a} Song`, a)]])),
      picks: [],
      queue: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'nl-search.json'),
      JSON.stringify({
        recordedAt: 'x',
        sessionId: 'x',
        librarySize: 0,
        anchors: [],
        anchorSearch: {},
        scenarios: { jazz: badScenario },
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'genre-golden.json'), JSON.stringify({}));
    const badCode = await runCli([
      '--fixture-dir',
      tmpDir,
      '--baseline',
      path.join(tmpDir, '__no_baseline__.json'),
    ]);
    assert.strictEqual(badCode, 1, '不变量红 → CLI 必须返回 1');

    // 6g-2. **纯度不达标**（不变量全过、黄金集覆盖也够）→ CLI 必须返回 1
    //
    // ⚠️ 这条覆盖旧实现的一个洞：CLI 原来只判「不变量 + 基线对比」，
    //   **完全没看** 场景级 pass（种子块纯度 ≥ 0.7）。这里造一个
    //   「不变量全过、但种子块的歌全是 pop」的 fixture → 纯度 0% → 必须红。
    const popScenario = {
      ...badScenario,
      search: Object.fromEntries(
        badSeeds.map((a) => [a, [1, 2, 3, 4].map((i) => mkItem(`${a} Song ${i}`, a))]),
      ),
    };
    const popDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-eval-pop-'));
    fs.writeFileSync(
      path.join(popDir, 'nl-search.json'),
      JSON.stringify({
        recordedAt: 'x',
        sessionId: 'x',
        librarySize: 0,
        anchors: [],
        anchorSearch: {},
        scenarios: { jazz: popScenario },
      }),
    );
    // 黄金集把这些歌标成 **pop**（期望是 jazz）→ 覆盖率 100%（不是覆盖不足），
    // 但纯度 0% → 场景级判定必须不通过。
    const popGolden: Record<string, string[]> = {};
    for (const a of badSeeds) {
      for (let i = 1; i <= 4; i++) popGolden[`${a} Song ${i}|${a}`] = ['pop'];
    }
    fs.writeFileSync(path.join(popDir, 'genre-golden.json'), JSON.stringify(popGolden));
    const popCode = await runCli([
      '--fixture-dir',
      popDir,
      '--baseline',
      path.join(popDir, '__no_baseline__.json'),
    ]);
    assert.strictEqual(popCode, 1, '纯度不达标（不变量却全过）→ CLI 必须返回 1');

    // 6g-3. **黄金集覆盖不足**（不变量全过）→ CLI 必须返回 1
    //
    // spec §风险与局限：「覆盖率低于阈值时**拒绝给结论**（fail loud）」。
    // 旧实现只打一条 ⚠️ 警告就继续，最后照样输出「✅ 门禁通过」。
    const coverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-eval-cover-'));
    fs.writeFileSync(
      path.join(coverDir, 'nl-search.json'),
      JSON.stringify({
        recordedAt: 'x',
        sessionId: 'x',
        librarySize: 0,
        anchors: [],
        anchorSearch: {},
        scenarios: { jazz: popScenario },
      }),
    );
    fs.writeFileSync(path.join(coverDir, 'genre-golden.json'), JSON.stringify({}));
    const coverCode = await runCli([
      '--fixture-dir',
      coverDir,
      '--baseline',
      path.join(coverDir, '__no_baseline__.json'),
    ]);
    assert.strictEqual(coverCode, 1, '黄金集覆盖不足（拒绝给结论）→ CLI 必须返回 1');

    // 6h. --save 会真的写基线文件（覆盖写盘分支）
    const savePath = path.join(tmpDir, 'saved-baseline.json');
    assert.strictEqual(
      await runCli(['--only=jazz', '--save', savePath]),
      0,
      '带 --save 应正常跑完',
    );
    assert.ok(fs.existsSync(savePath), '基线文件已写出');

    // 6h-2. **缺基线 + 带 --save** → 走"本轮在建立基线，跳过对比"的分支
    //
    // ⚠️ 这条是**覆盖率 diff 门禁逼出来的**，不是凑数：
    //   「没有基线文件 + --save」这条分支在日常/CI 里**永远走不到**
    //   （仓库里的基线一直存在 → baselineExists 恒为 true）→
    //   `eval-offline-cli.ts` 里那两行（打印"本轮在建立基线"）行覆盖恒为 0
    //   → CI 的「新增代码必须被测到」门禁直接拦下整个 PR。
    //
    //   也就是说：**这条分支第一次有测试覆盖，是门禁在逼我们写**。
    //   它本身是个真路径（第一次建基线时就是这个组合）。
    const savePath2 = path.join(tmpDir, 'saved-baseline-fresh.json');
    assert.strictEqual(
      await runCli([
        '--only=jazz',
        '--baseline',
        path.join(tmpDir, '__no_baseline_fresh__.json'),
        '--save',
        savePath2,
      ]),
      0,
      '缺基线但带 --save → 本轮在建立基线，**不该**拒绝判定（对比是待建的那一轮）',
    );
    assert.ok(fs.existsSync(savePath2), '缺基线 + --save 也要把基线写出来');

    // 6i. 未知参数 → 忽略（default 分支）；"--k --k2" 形式 → take() 返回 undefined
    assert.strictEqual(
      await runCli(['--only=jazz', '--unknown-flag', '--save', '--json']),
      0,
      '未知参数应被忽略',
    );

    console.log(
      '  ✓ 分支覆盖: 未知场景 / 黄金集不足 / 基线缺场景 / fake FM / 两个 CLI / 失败路径 / --save',
    );
  }

  // ── 7. 场景级：种子被 anchorLimit 截断 → 不变量变红（真实 fixture 上做） ──
  {
    const sc: any = Object.values(fixture.scenarios).find((s: any) => (s.seeds?.length ?? 0) >= 3);
    assert.ok(sc, 'fixture 里要有一个 ≥3 个种子的场景');
    // 模拟 2026-10-20 那个 bug：anchorLimit 把种子截断了（种子还在意图里，
    // 但没被搜）→ all-seeds-searched 必须红。
    const broken = await evaluateOfflineScenario(sc, fixture, golden, 12, { anchorLimit: 2 });
    const hit = broken.invariants.find((i: any) => i.id === 'all-seeds-searched');
    assert.strictEqual(hit.pass, false, '种子被截断 → all-seeds-searched 必须红');
    console.log('  ✓ 场景级反向验证: 种子被截断 → all-seeds-searched 红');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
