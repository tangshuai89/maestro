/**
 * MusicController 私域 host 白名单单测（ISSUES.md §4.3）。
 *
 * 覆盖：
 *  - QQ ws.stream.qqmusic.qq.com（exact）
 *  - NetEase p1.music.126.net 等（suffix .music.126.net）
 *  - Spotify p.scdn.co（exact）+ any prefix .scdn.co
 *  - Deezer preview.dzcdn.net（exact）+ cdns-preview-*.dzcdn.net（suffix）
 *  - 拒绝：localhost / 127.0.0.1 / 内网 / 任意陌生域 / 非 http(s)
 *  - 拒绝：suffix 误匹配（短域不能等于 suffix）
 *
 * 运行: npx ts-node packages/server/src/music/music.controller.allowlist.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { MusicController } = require('./music.controller');
const isAllowed = (MusicController as any).isStreamHostAllowed.bind(
  MusicController,
);

async function main() {
  // ── 1. QQ 主 CDN exact ────────────────────────────────────────
  assert.strictEqual(
    isAllowed('https://ws.stream.qqmusic.qq.com/C400abc.m4a?guid=xxx'),
    true,
    'QQ ws.stream.qqmusic.qq.com 应 allow',
  );
  console.log('✅ 1. QQ ws.stream.qqmusic.qq.com → allow');

  // ── 2. NetEase suffix .music.126.net ──────────────────────────
  assert.strictEqual(
    isAllowed('https://m7.music.126.net/2024/abc/mp3'),
    true,
    'NetEase m7.music.126.net 应 allow（suffix）',
  );
  assert.strictEqual(
    isAllowed('https://p1.music.126.net/cover.jpg'),
    true,
    'NetEase p1.music.126.net 应 allow（suffix）',
  );
  console.log('✅ 2. NetEase *.music.126.net → allow（exact + suffix）');

  // ── 3. Spotify exact + suffix ─────────────────────────────────
  assert.strictEqual(
    isAllowed('https://p.scdn.co/mp3-preview/abc'),
    true,
    'Spotify p.scdn.co 应 allow（exact）',
  );
  // 未来新增 aaa.scdn.co 等子域也允许
  assert.strictEqual(
    isAllowed('https://new-thing.scdn.co/x.mp3'),
    true,
    'Spotify *.scdn.co 应 allow（suffix）',
  );
  console.log('✅ 3. Spotify p.scdn.co + *.scdn.co → allow');

  // ── 4. Deezer exact + suffix ──────────────────────────────────
  assert.strictEqual(
    isAllowed('https://preview.dzcdn.net/123.mp3'),
    true,
    'Deezer preview.dzcdn.net 应 allow（exact）',
  );
  assert.strictEqual(
    isAllowed('https://cdns-preview-a.dzcdn.net/stream/abc.mp3'),
    true,
    'Deezer cdns-preview-*.dzcdn.net 应 allow（suffix）',
  );
  console.log('✅ 4. Deezer preview + cdns-preview-*.dzcdn.net → allow');

  // ── 5. 拒绝陌生域 ─────────────────────────────────────────────
  assert.strictEqual(
    isAllowed('https://evil.com/malicious'),
    false,
    'evil.com 应 deny',
  );
  assert.strictEqual(
    isAllowed('https://internal-api.local/x'),
    false,
    'internal-api.local 应 deny',
  );
  console.log('✅ 5. 陌生域 → deny');

  // ── 6. 拒绝 localhost / 127.0.0.1 / 内网 IP（SSRF 防护） ─────
  assert.strictEqual(isAllowed('http://localhost:8080/admin'), false);
  assert.strictEqual(isAllowed('http://127.0.0.1/admin'), false);
  assert.strictEqual(isAllowed('http://10.0.0.1/internal'), false);
  assert.strictEqual(isAllowed('http://192.168.1.1/router'), false);
  console.log('✅ 6. localhost / 127.0.0.1 / 10.x / 192.168 → deny（SSRF）');

  // ── 7. 拒绝非 http(s) 协议 ────────────────────────────────────
  assert.strictEqual(isAllowed('file:///etc/passwd'), false);
  assert.strictEqual(isAllowed('ftp://example.com/x'), false);
  console.log('✅ 7. file:// / ftp:// → deny');

  // ── 8. 拒绝非法 URL ───────────────────────────────────────────
  assert.strictEqual(isAllowed('not-a-url'), false);
  assert.strictEqual(isAllowed(''), false);
  console.log('✅ 8. 非法 URL → deny');

  // ── 9. suffix 误匹配保护（短域恰好等于 suffix 的反例） ──────
  // 例如 ".scdn.co" 后缀——"foo.scdn.co" 长度 > 8，OK。
  // "scdn.co" 本身（没点）长度 == 8，suffix 期望长度更长，suf 长度 = 8
  // host 长度 = 8 → 不 > suf 长度 → false（防御性）。
  assert.strictEqual(
    isAllowed('https://scdn.co/x'),
    false,
    '"scdn.co" 本身长度等于 suffix，应 deny（防误匹配）',
  );
  console.log('✅ 9. suffix 误匹配保护（host 长度 ≤ suf 长度 → deny）');

  // ── 10. case insensitive（host toLowerCase） ──────────────────
  assert.strictEqual(
    isAllowed('https://WS.STREAM.QQMUSIC.QQ.COM/x'),
    true,
    '大写 host 应 allow（toLowerCase）',
  );
  console.log('✅ 10. 大写 host → allow（case-insensitive）');

  console.log('\n🎉 全部 10 个 allowlist 测试通过');
}

main().catch((err) => {
  console.error('❌ allowlist 测试失败:', err);
  process.exit(1);
});
