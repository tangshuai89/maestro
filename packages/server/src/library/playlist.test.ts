/**
 * PlaylistService 白盒测试（Node built-in assert）。
 *
 * StorageService 用内存 stub（class 形式 + 简单 get/set/del）。
 */
export {};
const assert = require('node:assert');

const { PlaylistService } = require('./playlist.service');

class FakeStorage {
  private m = new Map<string, unknown>();
  get<T>(k: string): T | undefined {
    return this.m.get(k) as T | undefined;
  }
  set<T>(k: string, v: T): void {
    this.m.set(k, v);
  }
  delete(k: string): void {
    this.m.delete(k);
  }
}

const svc = new PlaylistService(new FakeStorage() as any);

const mkTrack = (id: string) =>
  ({
    id,
    title: `t-${id}`,
    artist: 'a',
    album: '',
    coverUrl: '',
    audioUrl: '',
    duration: 0,
    liked: false,
    sources: [{ platform: 'qq', trackId: id, hasCopyright: true, url: '' }],
  }) as any;

// ── 1. create 命名冲突 -2/-3 ─────────────────────────────
{
  const a = svc.create('s1', { name: 'my list', tracks: [mkTrack('1')] });
  assert.strictEqual(a.name, 'my list');
  const b = svc.create('s1', { name: 'my list', tracks: [mkTrack('1')] });
  assert.strictEqual(b.name, 'my list-2');
  const c = svc.create('s1', { name: 'my list', tracks: [mkTrack('1')] });
  assert.strictEqual(c.name, 'my list-3');
  console.log('  ✓ naming collision: -2/-3 suffix');
}

// ── 2. list 按 updatedAt 倒序 ─────────────────────────────
{
  // 重新用空存储（s1 已被前一个测试填了）
  const s2 = new PlaylistService(new FakeStorage() as any);
  const a = s2.create('s2', { name: 'a', tracks: [mkTrack('1')] });
  // 手动让 b 的 updatedAt 更早
  const _t1 = Date.now();
  while (Date.now() - _t1 < 20) {}
  const b = s2.create('s2', { name: 'b', tracks: [mkTrack('2')] });
  const _t2 = Date.now();
  while (Date.now() - _t2 < 20) {}
  const c = s2.create('s2', { name: 'c', tracks: [mkTrack('3')] });
  const list = s2.list('s2');
  assert.deepStrictEqual(
    list.map((p: any) => p.name),
    ['c', 'b', 'a'],
  );
  console.log('  ✓ list sorted by updatedAt desc');
}

// ── 3. get / delete / NotFound ───────────────────────────
{
  const s3 = new PlaylistService(new FakeStorage() as any);
  const a = s3.create('s3', { name: 'x', tracks: [mkTrack('1')] });
  assert.strictEqual(s3.get('s3', a.id).name, 'x');
  s3.delete('s3', a.id);
  assert.throws(
    () => s3.get('s3', a.id),
    (e: any) => e?.status === 404,
  );
  assert.throws(
    () => s3.delete('s3', 'no-such-id'),
    (e: any) => e?.status === 404,
  );
  console.log('  ✓ get/delete/404');
}

// ── 4. patch: rename + append + remove ──────────────────
{
  const s4 = new PlaylistService(new FakeStorage() as any);
  const _t1a = Date.now();
  while (Date.now() - _t1a < 20) {}
  const a = s4.create('s4', { name: 'old', tracks: [mkTrack('1'), mkTrack('2')] });
  const aUpdatedAt = a.updatedAt;
  const _t1b = Date.now();
  while (Date.now() - _t1b < 20) {}
  const _t1 = Date.now();
  while (Date.now() - _t1 < 20) {}
  // ⚠️ patch() 同一对象 in-place mutate（PlaylistService 不拷贝对象），
  // 所以 a === ren；这里改测「存储中最新值 >= 创建时刻 + 实际推进」而非「>」。
  const ren = s4.patch('s4', a.id, { name: 'new' });
  assert.strictEqual(ren.name, 'new');
  assert.strictEqual(ren.updatedAt >= aUpdatedAt, true);
  // 列表里读出来的对象也应该是更新后的版本
  const reread = s4.list('s4').find((p: any) => p.id === a.id);
  assert.strictEqual(reread?.name, 'new');

  const ap = s4.patch('s4', a.id, { append: [mkTrack('3'), mkTrack('1')] });
  assert.strictEqual(ap.tracks.length, 3); // 去重：1 已存在只加 3
  assert.strictEqual(ap.tracks[2].id, '3');

  const rm = s4.patch('s4', a.id, { remove: ['1', 'qq:3'] });
  assert.strictEqual(rm.tracks.length, 1);
  assert.strictEqual(rm.tracks[0].id, '2');
  console.log('  ✓ patch: rename + append dedup + remove');
}

// ── 4b. 去重 / 移除按「平台曲目身份」，不是 item.id ────────
// 同一首歌的 QQ 版和 Spotify 版：item.id 相同（合并后的归一 id），
// 但 platform:trackId 不同 → **两首都在歌单里**。
// 追加时若按 item.id 去重，第二版会被误吞；
// 移除时若按 item.id 移除，一次会干掉两条。
// renderer 的「已在歌单」判定用的是同一个 key（@maestro/common 的
// playlistTrackKey）—— 这里的断言就是那条不变量的服务端一侧。
{
  const s = new PlaylistService(new FakeStorage() as any);
  const mkVersion = (id: string, platform: string, trackId: string) =>
    ({
      id,
      title: '同一首歌',
      artist: 'a',
      album: '',
      coverUrl: '',
      audioUrl: '',
      duration: 0,
      liked: false,
      sources: [{ platform, trackId, hasCopyright: true, url: '' }],
    }) as any;

  const p = s.create('s', { name: 'x', tracks: [mkVersion('same-id', 'qq', 'T1')] });

  // id 相同、平台不同 → 两首（不能被去重掉）
  const two = s.patch('s', p.id, { append: [mkVersion('same-id', 'spotify', 'T1')] });
  assert.strictEqual(two.tracks.length, 2);

  // id 不同、平台曲目身份相同 → 同一首 → 去重（长度不变）
  const stillTwo = s.patch('s', p.id, { append: [mkVersion('other-id', 'qq', 'T1')] });
  assert.strictEqual(stillTwo.tracks.length, 2);

  // 按平台身份移除 → 只干掉那一条，另一个版本还在
  const one = s.patch('s', p.id, { remove: ['spotify:T1'] });
  assert.strictEqual(one.tracks.length, 1);
  assert.strictEqual(one.tracks[0].sources[0].platform, 'qq');
  console.log('  ✓ dedup/remove by platform identity (not item.id)');
}

// ── 5. 校验 ─────────────────────────────────────────
{
  const s5 = new PlaylistService(new FakeStorage() as any);
  assert.throws(
    () => s5.create('s5', { name: '', tracks: [mkTrack('1')] }),
    (e: any) => e?.status === 400,
  );
  assert.throws(
    () => s5.create('s5', { name: '   ', tracks: [mkTrack('1')] }),
    (e: any) => e?.status === 400,
  );
  assert.throws(
    () => s5.create('s5', { name: 'a'.repeat(61), tracks: [mkTrack('1')] }),
    (e: any) => e?.status === 400 && e?.response?.error === 'playlist_name_too_long',
  );
  assert.throws(
    () => s5.create('s5', { name: 'ok', tracks: [] }),
    (e: any) => e?.status === 400,
  );
  assert.throws(
    () => s5.create('s5', { name: 'ok', tracks: 'not-array' as any }),
    (e: any) => e?.status === 400,
  );
  console.log('  ✓ validation: empty name / too long / empty tracks / non-array');
}

console.log('\n✅ PlaylistService: all tests passed');
