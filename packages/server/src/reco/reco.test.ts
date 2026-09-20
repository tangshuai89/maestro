/**
 * RecoService 白盒测试（Node built-in assert + fetch stub）。
 * 运行: npx ts-node packages/server/src/reco/reco.test.ts
 *
 * RecoService 依赖 StorageService / MusicService / SessionService /
 * fetch（外部 API）。这里只测"无外部依赖"的逻辑：buildPrompt 拼装、
 * 响应解析（围栏 retry）、推荐去重。
 */
export {}; // 顶层 const 不与其他 .test.ts 冲突
const assert = require('node:assert');

// 直接 require 拿到 RecoService 类（不构造实例，只测静态方法逻辑）
// 因为核心纯函数都私有，所以走"构造 + 跑"的集成路线：
// 用 stub StorageService / SessionService / MusicService 注入。
// 简化：测 parseRecommendations / dedupAgainstLibrary 通过构造一个
// 小 wrapper。

// 拿到 RecoService 的私有方法 → 用一个最小 stub 包装暴露。
// 实际 RecoService 构造需要 storage/session/musicService，run() 还要
// 真实 fetch。我们用最简单的方式：构造时全部 stub 掉，只为拿到方法。
const { RecoService } = require('./reco.service');

const fakeStorage = {
  get: () => undefined,
  set: () => {},
};
const fakeSessionService = {
  resolve: () => ({}),
};
const fakeMusic = {
  getLibrary: () => null,
  searchUnified: async () => ({ items: [] }),
};
const fakeConfig = { get: (k: string) => undefined };

// ⚠️ RecoService 构造顺序: (config, storage, sessionService, musicService)
const svc = new RecoService(fakeConfig, fakeStorage, fakeSessionService, fakeMusic);

// ── 1. 响应解析：整体 JSON ────────────────────────────────
{
  const items = svc['parseRecommendations'](
    '[{"title":"X","artist":"Y"},{"title":"A","artist":"B"}]',
  );
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'X');
  console.log('✅ 1. 响应解析: 整体 JSON 数组');
}

// ── 2. 响应解析：{ items: [...] } 包裹 ──────────────────
{
  const items = svc['parseRecommendations'](
    '{"items":[{"title":"X","artist":"Y"}]}',
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'X');
  console.log('✅ 2. 响应解析: 包裹对象 { items: [...] }');
}

// ── 3. 响应解析：```json 围栏 ───────────────────────────
{
  const items = svc['parseRecommendations'](
    '好的，下面是 JSON：\n```json\n[{"title":"A","artist":"B","reason":"因为 X"}]\n```',
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].reason, '因为 X');
  console.log('✅ 3. 响应解析: ```json 围栏 retry');
}

// ── 4. 响应解析：prose 包裹裸数组（无围栏）→ 抛错 ────────
// 曾经用"首个 [ 到末个 ]"切片能救这种，但那个策略对括号噪声
// （[1] 引用 / 多段数组）会静默抓垃圾，比干净失败更坏——已删除。
// DeepSeek 调用侧已设 response_format: json_object 强制结构化输出，
// 所以裸 prose-wrapped 实际几乎不会发生；真发生了就 fail loud + retry。
{
  assert.throws(
    () => svc['parseRecommendations']('我推荐：[{"title":"A","artist":"B"}]，希望你喜欢'),
    /recommend_parse_failed/,
    'prose 包裹无围栏应干净失败（不再脆弱切片）',
  );
  console.log('✅ 4. 响应解析: prose 裸数组 → 干净失败（删了脆弱切片）');
}

// ── 5. 响应解析：全坏 → 抛错 ────────────────────────────
{
  assert.throws(
    () => svc['parseRecommendations']('garbage no json at all'),
    /recommend_parse_failed/,
  );
  console.log('✅ 5. 响应解析: 全坏 → 抛 BadRequest');
}

// ── 6. 推荐去重：和库去重 + 自己内部去重 ────────────────
{
  const lib = [
    { title: '晴天', artist: '周杰伦' } as any,
    { title: '七里香', artist: '周杰伦' } as any,
  ];
  const raw = [
    { title: '晴天', artist: '周杰伦' },          // 在库里 → 去掉
    { title: '夜曲', artist: '周杰伦' },          // 不在库 → 保留
    { title: '夜曲', artist: '周杰伦' },          // 内部重复 → 去掉
    { title: '稻香', artist: '周杰伦' },          // 不在库 → 保留
  ];
  const dedup = svc['dedupAgainstLibrary'](raw, lib);
  assert.deepStrictEqual(
    dedup.map((d: any) => d.title),
    ['夜曲', '稻香'],
    '应只剩库外 + 内部不重复的',
  );
  console.log('✅ 6. 推荐去重: 库内 + 内部重复都去除');
}

// ── 7. 推荐去重：normalize 忽略大小写 + 标点 ────────────
{
  const lib = [{ title: 'Hello!', artist: 'Adele' } as any];
  const raw = [
    { title: 'hello', artist: 'adele' },   // 应该被视为重复
    { title: 'HELLO', artist: 'Adele.' },  // 重复
  ];
  const dedup = svc['dedupAgainstLibrary'](raw, lib);
  assert.strictEqual(dedup.length, 0, '大小写 + 标点差异应归一为同首');
  console.log('✅ 7. 推荐去重: 大小写 + 标点归一化');
}

// ── 8. prompt 拼装：库 + 偏好都进 user ──────────────────
{
  const lib = [
    { title: '晴天', artist: '周杰伦', album: '叶惠美' } as any,
    { title: '七里香', artist: '周杰伦', album: '七里香' } as any,
  ];
  const messages = svc['buildPrompt'](lib, {
    count: 5,
    language: 'zh',
    mood: '通勤路上',
  });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('晴天'), 'user prompt 应包含库歌曲');
  assert.ok(messages[1].content.includes('中文'), '语言偏好应进 user prompt');
  assert.ok(messages[1].content.includes('通勤路上'), '心情应进 user prompt');
  assert.ok(messages[0].content.includes('5 首'), 'system prompt 应包含推荐数量');
  console.log('✅ 8. prompt 拼装: system + user 都带库 + 偏好');
}

// ── 9. prompt 拼装：library > LIMIT 仍只取前 N ──────────
{
  const lib = Array.from({ length: 250 }, (_, i) => ({
    title: `Track ${i}`,
    artist: 'X',
  }));
  const messages = svc['buildPrompt'](lib, { count: 10 });
  // buildPrompt 内部不截断——上层 run() 负责 slice
  // 这里只验"长库能拼 prompt 不爆"
  assert.ok(messages[1].content.length > 0);
  console.log('✅ 9. prompt 拼装: 长库 (>200) 仍能跑');
}

// ── 10. key 校验：太短 → 400 ────────────────────────────
{
  assert.throws(() => svc.setApiKey('short'), /太短/);
  console.log('✅ 10. setApiKey: 短 key 拒绝');
}

// ── 11. key 写入：长度够 → 写 storage + env ─────────────
{
  // 重新构造一个能记 set 的 storage
  const stored: Record<string, unknown> = {};
  const realStorage = {
    get: (k: string) => stored[k],
    set: (k: string, v: unknown) => { stored[k] = v; },
  };
  const svc2 = new RecoService(fakeConfig, realStorage, fakeSessionService, fakeMusic);
  const r = svc2.setApiKey('sk-1234567890abcdef');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tail, 'cdef');
  assert.strictEqual(process.env.DEEPSEEK_API_KEY, 'sk-1234567890abcdef');
  assert.strictEqual((stored['secrets:deepseek'] as any).apiKey, 'sk-1234567890abcdef');
  // 恢复
  delete process.env.DEEPSEEK_API_KEY;
  console.log('✅ 11. setApiKey: 写 storage + process.env，返回 tail');
}

// ── 12. status: 未 import 库 → librarySize=0 ────────────
{
  const status = svc.status({} as any);
  assert.strictEqual(status.librarySize, 0);
  assert.strictEqual(status.configured, false);
  console.log('✅ 12. status: 无库无 key 都 false');
}

// ── 13. 推荐去重：exclude（auto-continue 避免续播复读）────
{
  const lib = [{ title: '晴天', artist: '周杰伦' } as any];
  const exclude = [{ title: '夜曲', artist: '周杰伦' }]; // 上一批推过
  const raw = [
    { title: '晴天', artist: '周杰伦' }, // 库里 → 去
    { title: '夜曲', artist: '周杰伦' }, // exclude → 去
    { title: '稻香', artist: '周杰伦' }, // 新的 → 留
  ];
  const dedup = svc['dedupAgainstLibrary'](raw, lib, exclude);
  assert.deepStrictEqual(
    dedup.map((d: any) => d.title),
    ['稻香'],
    'exclude 里的歌应和库一样被排除',
  );
  // exclude 也要进 prompt 的"请勿再推荐"清单。
  const messages = svc['buildPrompt'](lib, { count: 5, exclude });
  assert.ok(
    messages[1].content.includes('不要再推荐') &&
      messages[1].content.includes('夜曲'),
    'exclude 应进 user prompt 的避让清单',
  );
  console.log('✅ 13. 推荐去重: exclude 排除续播复读 + 进 prompt 避让');
}

// ── fillPlatforms 用的最小 UnifiedSearchItem 构造 ──────────
function uItem(id: string, title: string, artist: string) {
  return {
    id,
    title,
    artist,
    album: '',
    coverUrl: '',
    duration: 0,
    sources: [],
    bestSource: 'qq',
  } as any;
}

// fillPlatforms 是 async；ts-node(commonjs) 不允许顶层 await，包进 IIFE。
void (async () => {
  // ── 14. fillPlatforms 匹配校验：跳过不匹配首条，取真正命中的（#1）──
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) => {
      if (q.includes('感電')) {
        return {
          items: [
            uItem('wrong', '感電 (Cover)', '某翻唱歌手'), // 歌名含但歌手对不上 → 拒
            uItem('right', '感電', '米津玄師'), // 正主 → 取这个
          ],
        };
      }
      return { items: [] };
    };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '感電', artist: '米津玄師', reason: '因为好听' }],
      5,
    );
    assert.strictEqual(filled.length, 1);
    assert.strictEqual(filled[0].id, 'right', '应取真正匹配的正主，不是首条翻唱');
    assert.ok(filled[0].album.includes('因为好听'), 'reason 应进 album');
    console.log('✅ 14. fillPlatforms: 匹配校验取正主，不塞同名翻唱');
  }

  // ── 15. fillPlatforms：全无匹配 → 丢弃不塞错歌（#1）─────────
  {
    (fakeMusic as any).searchUnified = async () => ({
      items: [uItem('x', '完全不同的歌', '别的歌手')],
    });
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '感電', artist: '米津玄師' }],
      5,
    );
    assert.strictEqual(filled.length, 0, '首条不匹配又无其它候选 → 丢弃');
    console.log('✅ 15. fillPlatforms: 无匹配则丢弃，不塞错歌');
  }

  // ── 16. fillPlatforms：跳过搜不到的、用后面的补位且保序（#2/#4）──
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) => {
      if (q.startsWith('A ')) return { items: [uItem('a', 'A', 'x')] };
      if (q.startsWith('B ')) return { items: [] }; // 搜不到
      if (q.startsWith('C ')) return { items: [uItem('c', 'C', 'y')] };
      return { items: [] };
    };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [
        { title: 'A', artist: 'x' },
        { title: 'B', artist: 'z' }, // 搜不到 → 跳过
        { title: 'C', artist: 'y' },
      ],
      2,
    );
    assert.deepStrictEqual(
      filled.map((f: any) => f.id),
      ['a', 'c'],
      '跳过搜不到的 B，用 C 补位到 2 首，且保持推荐原始顺序',
    );
    console.log('✅ 16. fillPlatforms: 跳过搜空 + 补位到 count + 保序');
  }

  // ── 17. 版本偏好：有录音室原版时优先，DJ 版排前面也不选（晴天 bug）──
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) => {
      if (q.includes('晴天')) {
        return {
          items: [
            uItem('dj', '晴天 (DJ版)', '周杰伦'), // 排在前面
            uItem('studio', '晴天', '周杰伦'), // 录音室原版
          ],
        };
      }
      return { items: [] };
    };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '晴天', artist: '周杰伦' }],
      5,
    );
    assert.strictEqual(filled.length, 1);
    assert.strictEqual(filled[0].id, 'studio', '有正常版应优先，即使 DJ 版排前面');
    console.log('✅ 17. 版本偏好: 录音室原版优先于 DJ 版');
  }

  // ── 18. 版本偏好：只有 DJ 版且用户没点名 → 丢弃，让上层补位 ────
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) =>
      q.includes('晴天')
        ? { items: [uItem('dj', '晴天 (DJ加速版)', '周杰伦')] }
        : { items: [] };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '晴天', artist: '周杰伦' }],
      5,
    );
    assert.strictEqual(filled.length, 0, '只有 DJ 版且没点名 → 丢弃，不塞 DJ 版');
    console.log('✅ 18. 版本偏好: 只有坏版本则丢弃');
  }

  // ── 19. 版本偏好：rec 自己点名要 Remix → 豁免惩罚，照给 ────────
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) =>
      q.includes('某歌')
        ? { items: [uItem('rmx', '某歌 (Remix)', 'X')] }
        : { items: [] };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '某歌 (Remix)', artist: 'X' }],
      5,
    );
    assert.strictEqual(filled.length, 1, 'rec 点名要 Remix → 不惩罚，照给');
    assert.strictEqual(filled[0].id, 'rmx');
    console.log('✅ 19. 版本偏好: rec 点名要某版本则豁免');
  }

  // ── 20. sanitizeBadVersions：模型输出里带 DJ/伴奏/慢摇的预筛丢 ──
  // 2026-08-14 防御性预筛：实测 prompt 写再多模型仍可能输出"DJ 版晴天"——
  // 不浪费一次 search 才被扔。sanitize 阶段按 VERSION_BAD 直接打掉。
  {
    const items = [
      { title: '晴天', artist: '周杰伦' },          // 正常 → 留
      { title: '晴天 (DJ版)', artist: '周杰伦' },   // DJ → 丢
      { title: '海阔天空 (伴奏)', artist: 'Beyond' }, // 伴奏 → 丢
      { title: '海阔天空', artist: 'Beyond' },     // 正常 → 留
      { title: '光年之外 (抖音版)', artist: 'G.E.M.' }, // 抖音 → 丢
      { title: '光年之外', artist: 'G.E.M.' },     // 正常 → 留
      { title: '夜曲 (Cover)', artist: '某翻唱' },  // 翻唱 → 丢
    ];
    const out = svc['sanitizeBadVersions'](items);
    assert.deepStrictEqual(
      out.map((x) => x.title),
      ['晴天', '海阔天空', '光年之外'],
      '应只剩 3 条录音室原版',
    );
    console.log('✅ 20. sanitizeBadVersions: 模型输出 DJ/伴奏/抖音/翻唱预筛');
  }

  // ── 21. durationPenalty：< 60s 或 > 600s 强丢（用户场景：长现场/短铃声）─
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) => {
      if (q.includes('长现场')) {
        return { items: [{ ...uItem('live-long', '长现场', 'X'), duration: 720 }] };
      }
      if (q.includes('短铃声')) {
        return { items: [{ ...uItem('short', '短铃声', 'Y'), duration: 30 }] };
      }
      if (q.includes('正常')) {
        return { items: [{ ...uItem('ok', '正常', 'Z'), duration: 240 }] };
      }
      return { items: [] };
    };
    // 长现场：模型没点名要长版 → 强丢
    let filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '长现场', artist: 'X' }],
      5,
    );
    assert.strictEqual(filled.length, 0, '720s 长现场没点名 → 丢');
    // 短铃声：模型没点名要短版 → 强丢
    filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '短铃声', artist: 'Y' }],
      5,
    );
    assert.strictEqual(filled.length, 0, '30s 短铃声没点名 → 丢');
    // 正常时长 → 照给
    filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '正常', artist: 'Z' }],
      5,
    );
    assert.strictEqual(filled.length, 1, '240s 正常 → 照给');
    assert.strictEqual(filled[0].id, 'ok');
    console.log('✅ 21. durationPenalty: 720s 长现场/30s 短铃声强丢，240s 正常通过');
  }

  // ── 22. durationPenalty：模型点名 long version → 720s 也照给 ─────
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) =>
      q.includes('某现场')
        ? { items: [{ ...uItem('ext', '某现场 (Long Version)', 'X'), duration: 720 }] }
        : { items: [] };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '某现场 (Long Version)', artist: 'X' }],
      5,
    );
    assert.strictEqual(filled.length, 1, '点名 long version → 时长约束豁免，照给');
    assert.strictEqual(filled[0].id, 'ext');
    console.log('✅ 22. durationPenalty: 点名 long version 豁免时长硬约束');
  }

  // ── 23. durationPenalty：同 search 结果里长现场 + 录音室，优先录音室 ─
  // 实测场景：QQ 搜「晴天」第一页返回 720s live 现场 + 240s studio 原版，
  // 之前没扣时长，720s 会被排前面（搜出来先入数组）。现在 duration 惩罚
  // 把它压到 100 = PEN_BAD，让 studio 优先。
  {
    (fakeMusic as any).searchUnified = async (_s: any, q: string) =>
      q.includes('晴天')
        ? {
            items: [
              // 故意把长 live 排前面（模拟 QQ 默认排序）
              { ...uItem('live', '晴天 (Live 全场)', '周杰伦'), duration: 720 },
              { ...uItem('studio', '晴天', '周杰伦'), duration: 240 },
            ],
          }
        : { items: [] };
    const filled = await svc['fillPlatforms'](
      {} as any,
      [{ title: '晴天', artist: '周杰伦' }],
      5,
    );
    assert.strictEqual(filled.length, 1, '长 live 排前也优先 studio');
    assert.strictEqual(filled[0].id, 'studio');
    console.log('✅ 23. durationPenalty: 长 live 排前被压后，studio 优先');
  }


// ── 24. 封面兜底：候选无封面 → 跨平台抽取 + 缓存 ──
{
  const music = {
    getLibrary: () => null,
    searchUnified: async () => ({
      items: [
        { title: '晴天', artist: '周杰伦', album: '', coverUrl: '', duration: 269, bestSource: 'qq', sources: [] },
      ],
    }),
    fetchCoverFallback: async () => 'https://cover.example/sunny.jpg',
  };
  const svc2 = new RecoService(fakeConfig, fakeStorage, fakeSessionService, music as any);
  const item = await (svc2 as any).searchAndMatch({}, { title: '晴天', artist: '周杰伦', reason: '' });
  assert.ok(item, '应匹配到晴天');
  assert.strictEqual(
    item.coverUrl,
    'https://cover.example/sunny.jpg',
    '候选无封面时应从平台抽取封面（fetchCoverFallback）',
  );
  console.log('✅ 24. 封面兜底：跨平台抽取');
}

// ── 25. 封面缓存：同歌不重复探测 ──
{
  let calls = 0;
  const music = {
    getLibrary: () => null,
    fetchCoverFallback: async () => { calls++; return 'https://cover.example/x.jpg'; },
  };
  const svc3 = new RecoService(fakeConfig, fakeStorage, fakeSessionService, music as any);
  await (svc3 as any).fetchCoverCached({}, { title: '晴天', artist: '周杰伦' });
  await (svc3 as any).fetchCoverCached({}, { title: '晴天', artist: '周杰伦' });
  assert.strictEqual(calls, 1, '缓存命中后不再跨平台探测');
  console.log('✅ 25. 封面缓存');
}

  // ── P0-a 口味档案（taste-profile）────────────────────────
  const {
    artistAffinity,
    buildProfileCore,
    librarySignature,
    pickExploreArtists,
    pickTasteSeeds,
  } = require('./taste-profile');
  const { buildCandidatePool, artistMatches } = require('./candidate-pool');

  // ── 26. 艺人亲和度：拆多艺人 + 跨写法归一 ────────────────
  {
    const lib = [
      uItem('1', '千里之外', '周杰伦 / 费玉清'),
      uItem('2', '晴天', '周杰伦'),
      uItem('3', '夜曲', '周杰伦'),
      uItem('4', 'Hello', 'ADELE'),
      uItem('5', 'Easy On Me', 'Adele'),
      uItem('6', '某冷门', '小众歌手'),
    ];
    const aff = artistAffinity(lib);
    const byName = new Map(aff.map((a: any) => [a.key, a.songs]));
    assert.strictEqual(aff[0].name, '周杰伦', '曲目数最多的艺人排第一');
    assert.strictEqual(aff[0].songs, 3);
    assert.strictEqual(
      byName.get('adele'),
      2,
      'ADELE / Adele 跨大小写应归一成同一位艺人',
    );
    assert.strictEqual(
      aff.length,
      4,
      '多艺人歌应拆成两位（周杰伦/费玉清），合计 4 位',
    );
    console.log('✅ 26. artistAffinity: 多艺人拆分 + 跨写法归一 + 排序');
  }

  // ── 27. 加权种子采样：贴口味但不困在回音壁 ────────────────
  {
    const hot: any[] = [];
    const cold: any[] = [];
    for (let i = 0; i < 20; i++) hot.push(uItem(`h${i}`, `热歌${i}`, '常听歌手'));
    for (let i = 0; i < 20; i++) cold.push(uItem(`c${i}`, `冷歌${i}`, `冷门${i}`));
    const lib = [...hot, ...cold];
    const aff = artistAffinity(lib);

    // exploreRatio = 0：纯亲和度加权 → 20:1 的权重差应让绝大多数种子来自常听歌手
    // （加权是概率性的、不是过滤器：长尾歌仍有极小机会被抽中，这正是设计意图）
    const exploitOnly = pickTasteSeeds(lib, aff, { count: 10, exploreRatio: 0 });
    assert.strictEqual(exploitOnly.length, 10);
    const hotCount = exploitOnly.filter(
      (s: any) => s.artist === '常听歌手',
    ).length;
    assert.ok(
      hotCount >= 8,
      `亲和度加权下种子应绝大多数来自常听艺人（实际 ${hotCount}/10，均匀随机期望 5/10）`,
    );

    // exploreRatio = 0.5：一半坑位留给长尾 → 冷门歌也能进来
    const mixed = pickTasteSeeds(lib, aff, { count: 10, exploreRatio: 0.5 });
    assert.strictEqual(mixed.length, 10);
    assert.strictEqual(
      new Set(mixed.map((s: any) => s.id)).size,
      10,
      '种子不应重复',
    );
    assert.ok(
      mixed.some((s: any) => s.artist !== '常听歌手'),
      '长尾探索位应放进非头部艺人的歌',
    );
    console.log('✅ 27. pickTasteSeeds: 亲和度加权 + 长尾探索位');
  }

  // ── 28. 口味主干稳定：anchors 不随 run 漂移 ──────────────
  {
    const lib = [
      uItem('1', 'a', '甲'),
      uItem('2', 'b', '甲'),
      uItem('3', 'c', '乙'),
      uItem('4', 'd', '丙'),
    ];
    const a = buildProfileCore(lib, { importedAt: 100 });
    const b = buildProfileCore(lib, { importedAt: 100 });
    assert.deepStrictEqual(a.anchors, b.anchors, '同一份库的 anchors 必须稳定');
    // 同分（各 1 首）按 key 码点序：丙(U+4E19) < 乙(U+4E59)
    assert.deepStrictEqual(a.anchors, ['甲', '丙', '乙']);
    assert.notStrictEqual(
      librarySignature(lib, 100),
      librarySignature(lib, 200),
      '重新导入（importedAt 变）→ 签名变 → 档案重算',
    );
    const explore = pickExploreArtists(a.artists, a.anchors, 2);
    assert.ok(
      explore.every((n: string) => !a.anchors.includes(n)),
      '探索艺人应来自主干之外',
    );
    console.log('✅ 28. 口味主干: anchors 稳定 + 签名随导入变化 + 探索艺人排除主干');
  }

  // ── 29. 候选池：剔库/坏版本/时长/非目标艺人/单艺人上限 ────
  {
    const lib = [uItem('l1', '库里的歌', '目标歌手')];
    const pool = await buildCandidatePool(
      {
        searchArtist: async () => [
          uItem('lib', '库里的歌', '目标歌手'), // 库内 → 剔
          uItem('dj', '目标歌 (DJ版)', '目标歌手'), // 坏版本 → 剔
          { ...uItem('short', '目标歌 (30s)', '目标歌手'), duration: 30 }, // 时长 → 剔
          { ...uItem('cover', '目标歌', '翻唱歌手'), duration: 200 }, // 非目标艺人 → 剔
          uItem('ok1', '目标歌 一', '目标歌手'),
          uItem('ok2', '目标歌 二', '目标歌手'),
          uItem('ok3', '目标歌 三', '目标歌手'), // 超单艺人上限 → 剔
        ],
        findRelatedArtists: async () => [],
      },
      { anchors: ['目标歌手'], library: lib, neighborAnchorLimit: 0 },
    );
    assert.deepStrictEqual(
      pool.candidates.map((c: any) => c.title),
      ['目标歌 一', '目标歌 二'],
      '只留下真实归属于该艺人、录�音室原版、且不超单艺人上限的候选',
    );
    assert.strictEqual(pool.dropped.inLibrary, 1);
    assert.strictEqual(pool.dropped.badVersion, 1);
    assert.strictEqual(pool.dropped.duration, 1);
    assert.strictEqual(pool.dropped.overCap, 1);
    assert.ok(
      !artistMatches('翻唱歌手', '目标歌手'),
      '翻唱歌手不应被认成目标艺人',
    );
    console.log('✅ 29. 候选池: 剔库/坏版本/时长/非目标艺人/超配额');
  }

  // ── 30. 候选池：相邻艺人 + 电台来源，且单源失败 fail-soft ──
  {
    const pool = await buildCandidatePool(
      {
        searchArtist: async (artist: string) => {
          if (artist === '坏艺人') throw new Error('search boom');
          return [uItem(`s-${artist}`, `${artist}的歌`, artist)];
        },
        findRelatedArtists: async (artist: string) =>
          artist === '主干甲' ? ['相邻乙', '坏艺人'] : [],
        fetchRadio: async () => [
          {
            title: '电台歌',
            artist: '电台歌手',
            album: '',
            coverUrl: '',
            duration: 210,
            provider: 'netease',
          },
        ],
      },
      {
        anchors: ['主干甲'],
        library: [],
        exploreArtists: [],
        relatedPerAnchor: 2,
      },
    );
    const origins = pool.candidates.map((c: any) => c.origin);
    assert.ok(origins.includes('artist'), '主干深挖应贡献候选');
    assert.ok(origins.includes('related-artist'), '相邻艺人应贡献候选');
    assert.ok(origins.includes('radio'), '电台应贡献候选');
    assert.ok(
      pool.candidates.some((c: any) => c.title === '电台歌'),
      '电台歌应在池里',
    );
    assert.ok(
      !pool.candidates.some((c: any) => c.title === '坏艺人的歌'),
      '单条来源抛错不应影响其它候选（fail-soft）',
    );
    console.log('✅ 30. 候选池: 相邻艺人 + 电台 + 单源失败 fail-soft');
  }

  // ── 31. parseSelection：下标白名单校验 ───────────────────
  {
    const picks = svc['parseSelection'](
      '{"picks":[{"id":1,"reason":"a"},{"id":9,"reason":"越界"},{"id":-1},{"id":"2","reason":"c"},{"id":1,"reason":"重复"}]}',
      5,
    );
    assert.deepStrictEqual(
      picks,
      [
        { id: 1, reason: 'a' },
        { id: 2, reason: 'c' },
      ],
      '越界/负数/重复 id 都应丢弃，字符串数字要认',
    );
    assert.deepStrictEqual(svc['parseSelection']('[0,3]', 4), [
      { id: 0, reason: '' },
      { id: 3, reason: '' },
    ], '裸数字数组也认');
    assert.deepStrictEqual(
      svc['parseSelection']('```json\n{"picks":[{"index":2}]}\n```', 3),
      [{ id: 2, reason: '' }],
      '围栏 + index 字段也要认',
    );
    assert.deepStrictEqual(
      svc['parseSelection']('完全不是 JSON', 3),
      [],
      '解析失败返回空 → 上层回退自由生成',
    );
    console.log('✅ 31. parseSelection: 下标白名单（越界/重复/负数/非 JSON）');
  }

  // ── 32. fillFromPool：模型排序优先，不够用池序补位 ─────────
  {
    const cands = ['甲', '乙', '丙', '丁'].map((t: string, i: number) => ({
      title: t,
      artist: `歌手${i}`,
      album: '',
      coverUrl: '',
      duration: 200,
      origin: 'artist' as const,
    }));
    const out = svc['fillFromPool']([{ id: 2, reason: 'R' }], cands, 2);
    assert.deepStrictEqual(
      out.map((o: any) => o.title),
      ['丙', '甲', '乙', '丁'],
      '模型挑的排最前，其余按候选池顺序补位到超额口径',
    );
    assert.strictEqual(out[0].reason, 'R', '模型给的理由要带上');
    console.log('✅ 32. fillFromPool: picks 优先 + 池序补位');
  }

  // ── 33. applyArtistCap：同艺人最多 2 首 ─────────────────
  {
    const raw = [
      { title: 'a', artist: '甲' },
      { title: 'b', artist: '甲' },
      { title: 'c', artist: '甲' },
      { title: 'd', artist: '乙' },
    ];
    assert.deepStrictEqual(
      svc['applyArtistCap'](raw, 2).map((r: any) => r.title),
      ['a', 'b', 'd'],
      '第三首同艺人应被丢弃',
    );
    console.log('✅ 33. applyArtistCap: 同一艺人上限');
  }

  // ── 34. buildSelectPrompt：候选清单带下标 + 要求 picks ──────
  {
    const profile = {
      size: 42,
      signature: '42:1',
      artists: [],
      anchors: ['甲', '乙'],
      seeds: [uItem('s1', '种子歌', '甲')],
    };
    const messages = svc['buildSelectPrompt'](
      profile,
      [
        {
          title: '候选一',
          artist: '丙',
          album: '专辑',
          coverUrl: '',
          duration: 200,
          origin: 'artist',
        },
      ],
      { count: 1, language: 'zh' },
    );
    assert.ok(messages[0].content.includes('picks'), 'system 应要求 picks 结构');
    assert.ok(
      messages[1].content.includes('[0] 候选一 - 丙 (专辑)'),
      'user 应列出带下标的候选清单',
    );
    assert.ok(messages[1].content.includes('库里的歌') === false);
    assert.ok(messages[1].content.includes('甲、乙'), '应点名口味主干');
    console.log('✅ 34. buildSelectPrompt: 候选清单下标 + 主干 + picks 契约');
  }

  // ── 35. run() 主路径：目录锚定候选池 → 挑选 → 填源 ────────
  {
    const libItems = [
      uItem('l1', '库里的歌', '甲'),
      uItem('l2', '库里第二首', '甲'),
    ];
    const music = {
      getLibrary: () => ({ items: libItems, sources: [], importedAt: 7 }),
      searchUnified: async (_s: any, q: string) => {
        // 按艺人搜 → 给该艺人的库外曲目；按 "歌名 歌手" 搜（填源）→ 给可播条目
        if (q === '甲') {
          return {
            items: [uItem('c1', '甲的新歌', '甲'), uItem('c2', '甲的另一首', '甲')],
          };
        }
        const title = q.split(' ')[0];
        const artist = q.split(' ').slice(1).join(' ');
        return { items: [uItem(`f-${title}`, title, artist)] };
      },
      findRelatedArtists: async () => [],
      fetchRecoRadioCandidates: async () => [],
      fetchCoverFallback: async () => '',
    };
    let sentPrompt = '';
    const realFetch = global.fetch;
    global.fetch = (async (_url: string, init: any) => {
      sentPrompt = JSON.parse(init.body).messages[1].content;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  picks: [{ id: 0, reason: '贴你的口味' }],
                }),
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const realKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'sk-test-12345678';
    try {
      const svcRun = new RecoService(
        fakeConfig,
        fakeStorage,
        fakeSessionService,
        music as any,
      );
      const res = await svcRun.run({ id: 'sess-select' } as any, { count: 2 });
      assert.strictEqual(res.mode, 'select', '候选池够大应走挑选模式');
      assert.strictEqual(res.candidateCount, 2, '候选池应含 2 首库外曲目');
      assert.strictEqual(res.items.length, 2, '填源后应产出 2 首');
      assert.strictEqual(
        res.items[0].title,
        '甲的新歌',
        '模型挑中的候选应排在最前',
      );
      assert.ok(
        sentPrompt.includes('[0] 甲的新歌 - 甲'),
        'prompt 里应带上带下标的候选清单',
      );
      assert.ok(
        sentPrompt.includes('库里共 2 首'),
        'prompt 里应交代口味档案规模',
      );
      assert.ok(
        !/^\[\d+\] 库里的歌/m.test(sentPrompt),
        '库内曲目不应出现在候选清单里（口味采样节选里出现是正常的）',
      );
      console.log('✅ 35. run(): 候选池挑选模式端到端（含 prompt 契约）');
    } finally {
      global.fetch = realFetch;
      if (realKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = realKey;
    }
  }

  // ── 36. run() 回退：候选池为空 → 自由生成（不报错）──────
  {
    const libItems = [uItem('l1', '库里的歌', '甲')];
    const music = {
      getLibrary: () => ({ items: libItems, sources: [], importedAt: 9 }),
      searchUnified: async (_s: any, q: string) => {
        if (q === '甲') return { items: [] }; // 候选池为空 → 回退
        const title = q.split(' ')[0];
        return { items: [uItem(`f-${title}`, title, q.split(' ').slice(1).join(' '))] };
      },
      findRelatedArtists: async () => [],
      fetchRecoRadioCandidates: async () => [],
      fetchCoverFallback: async () => '',
    };
    let sentPrompt = '';
    const realFetch = global.fetch;
    global.fetch = (async (_url: string, init: any) => {
      sentPrompt = JSON.parse(init.body).messages[1].content;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ title: '自由生成的歌', artist: '乙' }],
                }),
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const realKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'sk-test-12345678';
    try {
      const svcRun = new RecoService(
        fakeConfig,
        fakeStorage,
        fakeSessionService,
        music as any,
      );
      const res = await svcRun.run({ id: 'sess-fallback' } as any, { count: 2 });
      assert.strictEqual(res.mode, 'generate', '候选池不足应回退自由生成');
      assert.strictEqual(res.candidateCount, 0);
      assert.strictEqual(res.items[0].title, '自由生成的歌');
      assert.ok(
        sentPrompt.includes('我的口味库'),
        '回退路径用的是 v1.1 的自由生成 prompt',
      );
      console.log('✅ 36. run(): 候选池为空回退自由生成，推荐不报错');
    } finally {
      global.fetch = realFetch;
      if (realKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = realKey;
    }
  }

  console.log('\n🎉 全部 36 个测试通过');
})().catch((err) => {
  console.error('❌ reco.test 失败:', err);
  process.exit(1);
});
