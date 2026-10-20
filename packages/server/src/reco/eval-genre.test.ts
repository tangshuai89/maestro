/**
 * NL 歌单 · 风格纯度评测（pure 层）白盒测试。
 *
 * 覆盖：
 *   1. computeGenrePurity —— 检索层纯度 / 策展层纯度 / 口味污染 三类指标口径
 *   2. parseGenreTags —— LLM 判定响应的三种形状 + 长度对齐
 *   3. resolveGenreTag（经 genre-seeds）—— 复合流派写法归一
 *   4. averageGenrePurity / compareGenrePurityReports —— 汇总与对比
 */
export {};

const assert = require('node:assert');
const {
  averageGenrePurity,
  computeGenrePurity,
  compareGenrePurityReports,
  formatGenrePurityReport,
  parseGenreTags,
  GENRE_PURITY_THRESHOLDS,
} = require('./eval-genre');
const { resolveGenreTag } = require('./genre-seeds');

const SCENARIO = { id: 'jazz', text: '来点儿爵士乐', expect: ['jazz'] };

// ── 1. resolveGenreTag：复合写法归一 ────────────────────
{
  assert.strictEqual(resolveGenreTag('jazz'), 'jazz');
  assert.strictEqual(resolveGenreTag('Jazz'), 'jazz');
  assert.strictEqual(resolveGenreTag('爵士'), 'jazz');
  assert.strictEqual(resolveGenreTag('chinese folk'), 'folk', '复合写法落到 folk');
  assert.strictEqual(resolveGenreTag('electro house'), 'electronic', 'electro house → electronic');
  assert.strictEqual(resolveGenreTag('progressive house'), 'electronic');
  assert.strictEqual(resolveGenreTag('rock and roll'), 'rock');
  assert.strictEqual(resolveGenreTag('hip-hop'), 'hiphop');
  // 词边界：children's music 不该因为含 "chill" 被判成 chill
  assert.notStrictEqual(resolveGenreTag("children's music"), 'chill');
  console.log('  ✓ resolveGenreTag: 精确 / 复合 / 词边界');
}

// ── 2. parseGenreTags：三种形状 + 长度对齐 ──────────────
{
  assert.deepStrictEqual(parseGenreTags('{"tags":[["jazz"],["pop"]]}', 2), [['jazz'], ['pop']]);
  assert.deepStrictEqual(parseGenreTags('[["jazz"],["pop","rnb"]]', 2), [['jazz'], ['pop', 'rnb']]);
  assert.deepStrictEqual(parseGenreTags('{"items":["jazz","pop"]}', 2), [['jazz'], ['pop']]);
  // 数量不足 → 补空数组；多出来 → 丢弃
  assert.deepStrictEqual(parseGenreTags('{"tags":[["jazz"]]}', 3), [['jazz'], [], []]);
  assert.deepStrictEqual(parseGenreTags('{"tags":[["a"],["b"],["c"]]}', 2), [['a'], ['b']]);
  // 围栏 / 垃圾 → null（降级"未判定"，不炸）
  assert.deepStrictEqual(parseGenreTags('```json\n{"tags":[["jazz"]]}\n```', 1), [['jazz']]);
  assert.strictEqual(parseGenreTags('not json', 1), null);
  console.log('  ✓ parseGenreTags: 包裹 / 裸数组 / 补齐 / 失败降级');
}

// ── 3. computeGenrePurity：三类指标 ─────────────────────
{
  const ctx = {
    seeds: ['Miles Davis', 'John Coltrane'],
    libraryArtists: new Set(['陈奕迅', '汪苏泷']),
    anchorArtists: new Set(['陈奕迅']),
  };

  // 3a. 健康场景：全是种子艺人、标签全 jazz、无库污染
  const healthy = computeGenrePurity(
    SCENARIO,
    {
      items: [
        { title: 'So What', artist: 'Miles Davis' },
        { title: 'Blue Train', artist: 'John Coltrane' },
      ],
      tags: [['jazz'], ['jazz']],
      genres: ['jazz'],
      seeds: ctx.seeds,
    },
    ctx,
  );
  assert.strictEqual(healthy.seedCoverage, 1, '种子覆盖 100%');
  assert.strictEqual(healthy.tagPurity, 1, '流派纯度 100%');
  assert.strictEqual(healthy.libraryLeak, 0, '无库污染');
  assert.strictEqual(healthy.pass, true, '通过');

  // 3b. 线上事故形态：全是库主干艺人、标签全是 pop、无种子覆盖
  const broken = computeGenrePurity(
    SCENARIO,
    {
      items: [
        { title: '明天快乐', artist: '陈奕迅' },
        { title: '我想念', artist: '汪苏泷' },
      ],
      tags: [['pop'], ['pop']],
      genres: ['jazz'],
      seeds: ctx.seeds,
    },
    ctx,
  );
  assert.strictEqual(broken.seedCoverage, 0, '种子覆盖 0%');
  assert.strictEqual(broken.tagPurity, 0, '流派纯度 0%');
  assert.strictEqual(broken.libraryLeak, 1, '库污染 100%');
  assert.strictEqual(broken.anchorLeak, 0.5, '主干污染 50%');
  assert.strictEqual(broken.pass, false, '不通过');

  // 3c. 未判定（没跑 LLM）→ tagPurity=0，改用种子覆盖 + 污染判通过
  const noJudge = computeGenrePurity(
    SCENARIO,
    {
      items: [
        { title: 'So What', artist: 'Miles Davis' },
        { title: 'Blue Train', artist: 'John Coltrane' },
      ],
      tags: null,
      seeds: ctx.seeds,
    },
    ctx,
  );
  assert.strictEqual(noJudge.judged, false);
  assert.strictEqual(noJudge.tagPurity, 0);
  assert.strictEqual(noJudge.seedCoverage, 1);
  assert.strictEqual(noJudge.pass, true, '未判定时按检索层 + 污染判定');

  // 3d. 流派标签命中"相邻流派"→ 严格纯度不算、宽松纯度算
  const adjacent = computeGenrePurity(
    { id: 'x', text: 'x', expect: ['jazz'], adjacent: ['blues'] },
    {
      items: [
        { title: 'A', artist: 'Miles Davis' },
        { title: 'B', artist: 'Miles Davis' },
      ],
      tags: [['jazz'], ['blues']],
    },
    ctx,
  );
  assert.strictEqual(adjacent.tagPurity, 0.5, '严格只认 jazz');
  assert.strictEqual(adjacent.tagPurityLoose, 1, '宽松把 blues 也算过');

  // 3e. 口味污染**不**参与 pass（风格达标就过），只出回音壁告警
  //     ——「要九十年代摇滚」而用户库里本来就有 U2，那是另一个维度的取舍，
  //     混进 pass 会让告警变噪声，掩盖真正的风格回归。
  const leaky = computeGenrePurity(
    SCENARIO,
    {
      items: [
        { title: 'So What', artist: 'Miles Davis' },
        { title: '明天快乐', artist: '陈奕迅' },
      ],
      tags: [['jazz'], ['jazz']],
    },
    ctx,
  );
  assert.strictEqual(leaky.tagPurity, 1);
  assert.strictEqual(leaky.libraryLeak, 0.5);
  assert.strictEqual(leaky.pass, true, '风格达标 → 通过（污染只告警）');
  assert.strictEqual(leaky.echoChamber, true, '回音壁告警');
  assert.ok(GENRE_PURITY_THRESHOLDS.libraryLeak < 0.5);

  // 3e-2. 风格不达标 + 零污染 → 仍然不通过（这才是要抓的回归）
  const diluted = computeGenrePurity(
    SCENARIO,
    {
      items: [
        { title: 'A', artist: 'Miles Davis' },
        { title: 'B', artist: 'John Coltrane' },
      ],
      tags: [['pop'], ['pop']],
    },
    ctx,
  );
  assert.strictEqual(diluted.libraryLeak, 0);
  assert.strictEqual(diluted.tagPurity, 0);
  assert.strictEqual(diluted.pass, false, '风格被稀释 → 不通过（这才是回归告警）');
  assert.strictEqual(diluted.echoChamber, false);

  // 3e-3. 种子名与实际艺人名不完全一致（"好妹妹" vs "好妹妹乐队"）→ 算命中
  const prefixed = computeGenrePurity(
    SCENARIO,
    {
      items: [{ title: '飞远', artist: '好妹妹乐队' }],
      tags: [['jazz']],
    },
    { ...ctx, seeds: ['好妹妹'] },
  );
  assert.strictEqual(prefixed.seedCoverage, 1, '种子名是艺人名子串时也算命中');

  // 3f. 空队列不炸
  const empty = computeGenrePurity(SCENARIO, { items: [] }, ctx);
  assert.strictEqual(empty.seedCoverage, 0);
  assert.strictEqual(empty.tagPurity, 0);
  assert.strictEqual(empty.pass, false);
  console.log('  ✓ computeGenrePurity: 健康 / 事故形态 / 未判定 / 相邻 / 污染阈值 / 空');
}

// ── 4. 汇总 + 对比 ─────────────────────────────────────
{
  const ctx = {
    seeds: ['Miles Davis'],
    libraryArtists: new Set(['陈奕迅']),
    anchorArtists: new Set(['陈奕迅']),
  };
  const good = computeGenrePurity(
    SCENARIO,
    {
      items: [{ title: 'So What', artist: 'Miles Davis' }],
      tags: [['jazz']],
    },
    ctx,
  );
  const bad = computeGenrePurity(
    SCENARIO,
    {
      items: [{ title: '明天快乐', artist: '陈奕迅' }],
      tags: [['pop']],
    },
    ctx,
  );
  const avg = averageGenrePurity([good, bad]);
  assert.strictEqual(avg.seedCoverage, 0.5);
  assert.strictEqual(avg.tagPurity, 0.5);
  assert.strictEqual(avg.passRate, 0.5);

  const report = {
    at: Date.now(),
    model: 'deepseek-chat',
    librarySize: 100,
    count: 12,
    cases: [good, bad],
    average: avg,
  };
  const text = formatGenrePurityReport(report);
  assert.match(text, /风格纯度评测/);
  assert.match(text, /流派纯度/);
  const cmp = compareGenrePurityReports(report, { ...report, average: { ...avg, tagPurity: 0.9 } });
  assert.match(cmp, /流派纯度/);
  assert.match(cmp, /✅|⚠️/);
  console.log('  ✓ average / format / compare');
}

console.log('\n✅ eval-genre: all tests passed');
