/**
 * api.ts 纯逻辑 + mock fetch 测试。
 * 运行: node src/api.test.mjs
 *
 * 覆盖：
 *  - getApiOrigin / API_ORIGIN
 *  - PROVIDER_LABELS / QQ_QUALITY_LABELS 常量
 *  - AuthError 构造 + 字段
 *  - pickPlayableTrack：bestSource 有/无、source 找不到
 *  - fetchWithToken：注入 X-Maestro-Token + credentials
 *  - fetchNextTrack / toggleLike / getLiked 等：mock fetch 验证 URL + body
 *  - json() 解析：res.ok → 返回 JSON；!res.ok → AuthError with code
 *  - AuthError 从 body 提取 code
 */
import { register } from 'node:module';

// ESM loader for .ts imports
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
    const parent = context.parentURL;
    if (parent && parent.endsWith('.ts')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);
  if (url.endsWith('.ts') && result.source) {
    const src = String(result.source);
    if (src.includes('import.meta.env')) {
      const patched = src.replace(/import\\.meta\\.env/g, '({DEV:false,PROD:true})');
      return { format: result.format, url, source: patched };
    }
  }
  return result;
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

// Mock globals
globalThis.window = globalThis;
globalThis.location = { search: '', reload: () => {} };
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => lsStore.get(k) ?? null,
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

// ── mock fetch ────────────────────────────────────────────────
const fetchCalls = [];
let mockResponse = null;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  if (mockResponse) return mockResponse;
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const api = await import('./api.ts');
const {
  getApiOrigin,
  API_ORIGIN,
  PROVIDER_LABELS,
  QQ_QUALITY_LABELS,
  AuthError,
  pickPlayableTrack,
  fetchWithToken,
  fetchNextTrack,
  toggleLike,
  getLiked,
  fetchDeezerEditorials,
  logout,
  fetchRecoStatus,
  runReco,
  saveRecoKey,
  importLibrary,
  getLibrary,
  fetchLyrics,
  fetchLyricsAvailability,
  fetchLyricsByName,
  getStateSnapshot,
  triggerBackup,
  getBackupInfo,
  searchTracks,
  searchUnified,
  searchOne,
  isSourcePlayable,
  isPlayableEntry,
  playableReason,
  unplayableText,
} = api;

let passed = 0;
let failed = 0;
function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}
function fail(label, msg) {
  console.log(`❌ ${label}\n   ${msg}`);
  failed++;
}
function expect(label, cond, detail = '') {
  if (cond) ok(label);
  else fail(label, detail);
}
function reset() {
  fetchCalls.length = 0;
  mockResponse = null;
}

// ── 1. getApiOrigin 返回字符串 ────────────────────────────────
{
  const origin = getApiOrigin();
  expect('1. getApiOrigin 返回字符串', typeof origin === 'string');
}

// ── 2. API_ORIGIN 是字符串快照 ────────────────────────────────
{
  expect('2. API_ORIGIN 是字符串', typeof API_ORIGIN === 'string');
}

// ── 3. PROVIDER_LABELS 有 4 个平台 ────────────────────────────
{
  expect('3. PROVIDER_LABELS 有 4 个平台', Object.keys(PROVIDER_LABELS).length === 4);
  expect('3b. PROVIDER_LABELS.qq = "QQ 音乐"', PROVIDER_LABELS.qq === 'QQ 音乐');
  expect('3c. PROVIDER_LABELS.spotify = "Spotify"', PROVIDER_LABELS.spotify === 'Spotify');
}

// ── 4. QQ_QUALITY_LABELS 有 3 档 ──────────────────────────────
{
  expect('4. QQ_QUALITY_LABELS 有 3 档', Object.keys(QQ_QUALITY_LABELS).length === 3);
  expect('4b. QQ_QUALITY_LABELS.standard 存在', typeof QQ_QUALITY_LABELS.standard === 'string');
  expect('4c. QQ_QUALITY_LABELS.high 存在', typeof QQ_QUALITY_LABELS.high === 'string');
  expect('4d. QQ_QUALITY_LABELS.lossless 存在', typeof QQ_QUALITY_LABELS.lossless === 'string');
}

// ── 5. AuthError 构造 ─────────────────────────────────────────
{
  const err = new AuthError('AUTH_TIMEOUT', '登录超时', 408, 'raw-body');
  expect('5. AuthError.name = "AuthError"', err.name === 'AuthError');
  expect('5b. AuthError.code = "AUTH_TIMEOUT"', err.code === 'AUTH_TIMEOUT');
  expect('5c. AuthError.status = 408', err.status === 408);
  expect('5d. AuthError.raw = "raw-body"', err.raw === 'raw-body');
  expect('5e. AuthError.message = "登录超时"', err.message === '登录超时');
  expect('5f. AuthError 是 Error 子类', err instanceof Error);
}

// ── 6. pickPlayableTrack：bestSource 有值 ─────────────────────
{
  const item = {
    title: '晴天', artist: '周杰伦', album: '叶惠美', coverUrl: '/cover.jpg',
    duration: 270, bestSource: 'qq',
    sources: [{ platform: 'qq', trackId: 'qq-1', url: '/qq/stream', mediaMid: 'mm1' }],
  };
  const track = pickPlayableTrack(item);
  expect('6. pickPlayableTrack 返回 Track', track !== null);
  expect('6b. track.id = "qq-1"', track.id === 'qq-1');
  expect('6c. track.provider = "qq"', track.provider === 'qq');
  expect('6d. track.audioUrl = "/qq/stream"', track.audioUrl === '/qq/stream');
  expect('6e. track.title = "晴天"', track.title === '晴天');
  expect('6f. track.mediaMid = "mm1"', track.mediaMid === 'mm1');
  expect('6g. track.liked = false', track.liked === false);
}

// ── 7. pickPlayableTrack：bestSource = null → null ────────────
{
  const item = {
    title: 'Test', artist: 'A', album: 'B', coverUrl: '/c.jpg',
    duration: 200, bestSource: null,
    sources: [{ platform: 'qq', trackId: '1', url: '/u', mediaMid: 'm' }],
  };
  expect('7. pickPlayableTrack bestSource=null → null', pickPlayableTrack(item) === null);
}

// ── 8. pickPlayableTrack：source 找不到 bestSource → null ─────
{
  const item = {
    title: 'Test', artist: 'A', album: 'B', coverUrl: '/c.jpg',
    duration: 200, bestSource: 'spotify',
    sources: [{ platform: 'qq', trackId: '1', url: '/u', mediaMid: 'm' }],
  };
  expect('8. pickPlayableTrack source 不匹配 → null', pickPlayableTrack(item) === null);
}

// ── 9. fetchWithToken：注入 X-Maestro-Token ───────────────────
reset();
{
  globalThis.window.electronAPI = { internalToken: 'test-token-123' };
  await fetchWithToken('/music/next');
  const call = fetchCalls[0];
  expect('9. fetchWithToken 调用 fetch', call !== undefined);
  expect('9b. URL 正确', call.url === '/music/next');
  const headers = new Headers(call.init.headers);
  expect('9c. X-Maestro-Token 注入', headers.get('X-Maestro-Token') === 'test-token-123');
  expect('9d. credentials = include', call.init.credentials === 'include');
  delete globalThis.window.electronAPI;
}

// ── 10. fetchWithToken：无 token 不注入 header ────────────────
reset();
{
  await fetchWithToken('/test');
  const call = fetchCalls[0];
  const headers = new Headers(call.init.headers);
  expect('10. 无 token → 不设 X-Maestro-Token', !headers.has('X-Maestro-Token'));
}

// ── 11. fetchWithToken：自定义 header 保留 ────────────────────
reset();
{
  await fetchWithToken('/test', { headers: { 'X-Custom': 'yes' } });
  const call = fetchCalls[0];
  const headers = new Headers(call.init.headers);
  expect('11. 自定义 header 保留', headers.get('X-Custom') === 'yes');
}

// ── 12. fetchNextTrack：URL 组装 ──────────────────────────────
reset();
{
  mockResponse = new Response('{"id":"1","provider":"deezer","title":"test","artist":"a","album":"b","coverUrl":"","audioUrl":"/u","duration":200,"liked":false}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  await fetchNextTrack('deezer');
  expect('12. fetchNextTrack URL 含 provider=deezer', fetchCalls[0].url.includes('provider=deezer'));
}

// ── 13. fetchNextTrack：带 preset ─────────────────────────────
reset();
{
  mockResponse = new Response('{"id":"1","provider":"deezer","title":"test","artist":"a","album":"b","coverUrl":"","audioUrl":"/u","duration":200,"liked":false}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  await fetchNextTrack('deezer', 'rock');
  expect('13. fetchNextTrack URL 含 preset=rock', fetchCalls[0].url.includes('preset=rock'));
}

// ── 14. toggleLike：POST body ─────────────────────────────────
reset();
{
  mockResponse = new Response('{"success":true,"liked":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await toggleLike('qq', 'track-1', { title: 'T', artist: 'A', duration: 200 });
  const call = fetchCalls[0];
  expect('14. toggleLike URL 含 /music/like', call.url.includes('/music/like'));
  expect('14b. toggleLike method = POST', call.init.method === 'POST');
  const body = JSON.parse(call.init.body);
  expect('14c. toggleLike body 含 meta', body.meta !== undefined);
  expect('14d. toggleLike meta.title = "T"', body.meta.title === 'T');
}

// ── 15. getLiked：GET 请求 ────────────────────────────────────
reset();
{
  mockResponse = new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await getLiked('qq');
  expect('15. getLiked URL 含 /music/liked', fetchCalls[0].url.includes('/music/liked'));
  expect('15b. getLiked URL 含 provider=qq', fetchCalls[0].url.includes('provider=qq'));
}

// ── 16. logout：GET 请求 ──────────────────────────────────────
reset();
{
  await logout('spotify');
  expect('16. logout URL 含 /auth/logout', fetchCalls[0].url.includes('/auth/logout'));
  expect('16b. logout URL 含 provider=spotify', fetchCalls[0].url.includes('provider=spotify'));
}

// ── 17. fetchDeezerEditorials ─────────────────────────────────
reset();
{
  mockResponse = new Response('{"items":[{"id":0,"name":"All"}]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await fetchDeezerEditorials();
  expect('17. fetchDeezerEditorials 返回数组', Array.isArray(result));
  expect('17b. fetchDeezerEditorials URL 含 /music/deezer/editorials', fetchCalls[0].url.includes('/music/deezer/editorials'));
}

// ── 18. searchTracks ──────────────────────────────────────────
reset();
{
  mockResponse = new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await searchTracks('qq', '晴天');
  expect('18. searchTracks URL 含 /music/search', fetchCalls[0].url.includes('/music/search'));
  expect('18b. searchTracks URL 含 provider=qq', fetchCalls[0].url.includes('provider=qq'));
  expect('18c. searchTracks URL 含 q=晴天', fetchCalls[0].url.includes('q=') );
}

// ── 19. searchUnified ─────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"items":[],"total":0}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await searchUnified('test');
  expect('19. searchUnified URL 含 /music/search', fetchCalls[0].url.includes('/music/search'));
}

// ── 20. fetchRecoStatus ───────────────────────────────────────
reset();
{
  mockResponse = new Response('{"configured":false,"librarySize":0}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await fetchRecoStatus();
  expect('20. fetchRecoStatus 返回对象', typeof result === 'object');
  expect('20b. fetchRecoStatus URL 含 /reco/status', fetchCalls[0].url.includes('/reco/status'));
}

// ── 21. runReco：POST body ────────────────────────────────────
reset();
{
  mockResponse = new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await runReco({ count: 5 });
  const call = fetchCalls[0];
  expect('21. runReco URL 含 /reco/run', call.url.includes('/reco/run'));
  expect('21b. runReco method = POST', call.init.method === 'POST');
}

// ── 22. saveRecoKey：POST body ────────────────────────────────
reset();
{
  mockResponse = new Response('{"ok":true,"tail":"abcd"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await saveRecoKey('sk-test-key-1234567890');
  const call = fetchCalls[0];
  expect('22. saveRecoKey URL 含 /reco/key', call.url.includes('/reco/key'));
  expect('22b. saveRecoKey method = POST', call.init.method === 'POST');
  const body = JSON.parse(call.init.body);
  expect('22c. saveRecoKey body apiKey', body.apiKey === 'sk-test-key-1234567890');
}

// ── 23. importLibrary ─────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"imported":0}', { status: 201, headers: { 'Content-Type': 'application/json' } });
  await importLibrary();
  expect('23. importLibrary URL 含 /music/library/import', fetchCalls[0].url.includes('/music/library/import'));
  expect('23b. importLibrary method = POST', fetchCalls[0].init.method === 'POST');
}

// ── 24. getLibrary ────────────────────────────────────────────
reset();
{
  mockResponse = new Response('null', { status: 404, headers: { 'Content-Type': 'application/json' } });
  // getLibrary on 404 might throw — catch it
  try { await getLibrary(); } catch {}
  expect('24. getLibrary URL 含 /music/library', fetchCalls[0].url.includes('/music/library'));
}

// ── 25. fetchLyrics ───────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"lines":[],"source":null,"synced":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await fetchLyrics('qq', 'track-1');
  expect('25. fetchLyrics URL 含 /music/lyrics', fetchCalls[0].url.includes('/music/lyrics'));
  expect('25b. fetchLyrics URL 含 provider=qq', fetchCalls[0].url.includes('provider=qq'));
  expect('25c. fetchLyrics URL 含 trackId=track-1', fetchCalls[0].url.includes('trackId=track-1'));
}

// ── 26. fetchLyricsAvailability ───────────────────────────────
reset();
{
  mockResponse = new Response('{"available":false}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await fetchLyricsAvailability([{ platform: 'qq', trackId: 'track-1' }]);
  expect('26. fetchLyricsAvailability URL 含 /music/lyrics/availability', fetchCalls[0].url.includes('/music/lyrics/availability'));
  expect('26b. URL 含 qq%3Atrack-1（encodeURIComponent）', fetchCalls[0].url.includes('qq%3Atrack-1'));
}

// ── 27. fetchLyricsByName ─────────────────────────────────────
reset();
{
  mockResponse = new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await fetchLyricsByName('晴天', '周杰伦');
  expect('27. fetchLyricsByName URL 含 /music/lyrics/search', fetchCalls[0].url.includes('/music/lyrics/search'));
  expect('27b. fetchLyricsByName URL 含 title=晴天', fetchCalls[0].url.includes('title='));
}

// ── 28. getStateSnapshot ──────────────────────────────────────
reset();
{
  mockResponse = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await getStateSnapshot();
  expect('28. getStateSnapshot URL 含 /storage/state', fetchCalls[0].url.includes('/storage/state'));
}

// ── 29. triggerBackup ─────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"path":"/tmp/b.zip","count":5}', { status: 201, headers: { 'Content-Type': 'application/json' } });
  await triggerBackup();
  expect('29. triggerBackup URL 含 /storage/backup', fetchCalls[0].url.includes('/storage/backup'));
  expect('29b. triggerBackup method = POST', fetchCalls[0].init.method === 'POST');
}

// ── 30. getBackupInfo ─────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"backupDir":"/tmp","backupCount":0}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await getBackupInfo();
  expect('30. getBackupInfo URL 含 /storage/info', fetchCalls[0].url.includes('/storage/info'));
}

// ── 31. json() !res.ok → AuthError with code ─────────────────
reset();
{
  mockResponse = new Response(
    JSON.stringify({ error: 'AUTH_TIMEOUT', message: '登录超时' }),
    { status: 408, headers: { 'Content-Type': 'application/json' } },
  );
  let caught = null;
  try { await fetchNextTrack('deezer'); } catch (e) { caught = e; }
  expect('31. !res.ok → AuthError', caught instanceof AuthError);
  expect('31b. AuthError.code = AUTH_TIMEOUT', caught?.code === 'AUTH_TIMEOUT');
  expect('31c. AuthError.status = 408', caught?.status === 408);
}

// ── 32. json() !res.ok + unknown error code → AUTH_UNKNOWN ────
reset();
{
  mockResponse = new Response(
    JSON.stringify({ error: 'SOMETHING_NEW', message: '新错误' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
  let caught = null;
  try { await fetchNextTrack('deezer'); } catch (e) { caught = e; }
  expect('32. 未知 error code → AUTH_UNKNOWN', caught?.code === 'AUTH_UNKNOWN');
}

// ── 33. json() !res.ok + 非 JSON body → AUTH_UNKNOWN ──────────
reset();
{
  mockResponse = new Response('plain text error', { status: 500 });
  let caught = null;
  try { await fetchNextTrack('deezer'); } catch (e) { caught = e; }
  expect('33. 非 JSON body → AUTH_UNKNOWN', caught?.code === 'AUTH_UNKNOWN');
  expect('33b. message = raw text', caught?.message === 'plain text error');
}

// ── 34. json() !res.ok + body 有 message ──────────────────────
reset();
{
  mockResponse = new Response(
    JSON.stringify({ error: 'AUTH_CANCELLED', message: '用户取消' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
  let caught = null;
  try { await fetchNextTrack('deezer'); } catch (e) { caught = e; }
  expect('34. body message 提取', caught?.message === '用户取消');
  expect('34b. code = AUTH_CANCELLED', caught?.code === 'AUTH_CANCELLED');
}

// ── 35. json() !res.ok + body 无 message → msg = raw text（非 fallback）
reset();
{
  mockResponse = new Response(
    JSON.stringify({ error: 'AUTH_EXPIRED' }),
    { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } },
  );
  let caught = null;
  try { await fetchNextTrack('deezer'); } catch (e) { caught = e; }
  // msg = text (raw JSON body) since parsed.message is not a string
  expect('35. 无 message → msg = raw text', caught?.message.includes('AUTH_EXPIRED'));
  expect('35b. code = AUTH_EXPIRED', caught?.code === 'AUTH_EXPIRED');
  expect('35c. status = 401', caught?.status === 401);
}

// ── 36. json() res.ok → 返回 parsed JSON ──────────────────────
reset();
{
  mockResponse = new Response(
    JSON.stringify({ id: '1', provider: 'qq', title: 'T', artist: 'A', album: 'B', coverUrl: '', audioUrl: '/u', duration: 200, liked: false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  const track = await fetchNextTrack('qq');
  expect('36. res.ok → 返回 parsed JSON', track.id === '1');
  expect('36b. track.title = "T"', track.title === 'T');
}

// ── 37. searchOne ─────────────────────────────────────────────
reset();
{
  mockResponse = new Response('{"items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  await searchOne('netease', '稻香');
  expect('37. searchOne URL 含 /music/search', fetchCalls[0].url.includes('/music/search'));
  expect('37b. searchOne URL 含 provider=netease', fetchCalls[0].url.includes('provider=netease'));
}

// ── 38. searchOne：item 映射含 versions[0]（点击播放的不变量）──
// SearchPanel.handleRowClick 播的是 item.versions[0]；早期实现 versions=[]
// → 单平台模式每行点击静默无效（回归：只有一首歌没 toggle 箭头的行点不播）。
reset();
{
  mockResponse = new Response(
    JSON.stringify({
      items: [{
        id: 'n1', provider: 'netease', title: '稻香', artist: '周杰伦',
        album: '魔杰座', coverUrl: '/c.jpg', audioUrl: '/music/stream/netease/n1',
        duration: 223, liked: false, vipLocked: true,
      }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  const items = await searchOne('netease', '稻香');
  const it = items[0];
  expect('38. searchOne 返回 1 条', items.length === 1);
  expect('38b. versions 恰 1 条（指向自己）', it.versions.length === 1);
  expect('38c. versions[0].bestSource = netease', it.versions[0].bestSource === 'netease');
  expect('38d. versions[0].sources[0].trackId = n1', it.versions[0].sources[0].trackId === 'n1');
  expect('38e. versions[0] 带版本元数据', it.versions[0].title === '稻香' && it.versions[0].duration === 223);
  expect('38f. vipLocked 透传到 source', it.sources[0].vipLocked === true && it.versions[0].sources[0].vipLocked === true);
}

// ── 39. searchOne：noPreview 透传（Spotify 无 preview_url）────
reset();
{
  mockResponse = new Response(
    JSON.stringify({
      items: [{
        id: 'sp1', provider: 'spotify', title: '浓缩蓝鲸', artist: 'Jude Chiu',
        album: '浓缩蓝鲸', coverUrl: '/c.jpg', audioUrl: '/music/stream/spotify/sp1',
        duration: 277, liked: false, vipLocked: true, noPreview: true,
      }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  const items = await searchOne('spotify', '浓缩蓝鲸');
  const it = items[0];
  expect('39. searchOne noPreview 透传到 source', it.sources[0].noPreview === true);
  expect('39b. version source 也带 noPreview', it.versions[0].sources[0].noPreview === true);
}

// ── 40. isSourcePlayable：Spotify 无预览 = 放不出声（除非 WPS）─
{
  const sp = { platform: 'spotify', hasCopyright: true, noPreview: true };
  expect('40. spotify+noPreview+无 WPS → 不可播', isSourcePlayable(sp, false) === false);
  expect('40b. spotify+noPreview+WPS 已连 → 可播', isSourcePlayable(sp, true) === true);
  expect(
    '40c. spotify 有预览 → 可播',
    isSourcePlayable({ platform: 'spotify', hasCopyright: true }, false) === true,
  );
  expect(
    '40d. 无版权 → 不可播（与 noPreview 无关）',
    isSourcePlayable({ platform: 'qq', hasCopyright: false }, true) === false,
  );
  expect(
    '40e. netease 不受 noPreview 语义影响',
    isSourcePlayable({ platform: 'netease', hasCopyright: true, noPreview: true }, false) === true,
  );
}

// ── 41. isPlayableEntry：Spotify 独占且无预览 → 整条不可播 ────
// 用户报障：搜「浓缩蓝鲸」ALL 模式点裘德那首的 Spotify 行（艺人名
// "Jude Chiu"）→ 代理 502 spotify_no_preview，播放器静默卡 00:00。
{
  const spotifyOnly = {
    bestSource: 'spotify',
    sources: [{ platform: 'spotify', trackId: 'sp1', hasCopyright: true, url: '/s', noPreview: true }],
  };
  expect('41. Spotify 独占无预览 + 无 WPS → 不可播', isPlayableEntry(spotifyOnly, false) === false);
  expect('41b. 同一条 + WPS 已连 → 可播', isPlayableEntry(spotifyOnly, true) === true);
  const neteaseItem = {
    bestSource: 'netease',
    sources: [{ platform: 'netease', trackId: 'n1', hasCopyright: true, url: '/n' }],
  };
  expect('41c. 网易云源正常可播', isPlayableEntry(neteaseItem, false) === true);
  expect(
    '41d. bestSource=null → 不可播',
    isPlayableEntry({ bestSource: null, sources: [] }, false) === false,
  );
  // bestSource 是 netease，但 item 里还挂着一个没预览的 spotify 源 → 仍可播
  const mixed = {
    bestSource: 'netease',
    sources: [
      { platform: 'netease', trackId: 'n1', hasCopyright: true, url: '/n' },
      { platform: 'spotify', trackId: 'sp1', hasCopyright: true, url: '/s', noPreview: true },
    ],
  };
  expect('41e. 混合源按 bestSource 判 → 可播', isPlayableEntry(mixed, false) === true);
}

// ── 42. playableReason / unplayableText：判定与解释同源 ────────
// SearchPanel 的置灰、tooltip、行内角标三处都读这里。此前它们各判一次、用
// `bestSource !== null` 猜原因，于是"QQ 源无版权"会被说成"只有 Spotify 源"。
{
  const qqNoCopyright = {
    bestSource: 'qq',
    sources: [{ platform: 'qq', trackId: 'q1', hasCopyright: false, url: '/q' }],
  };
  expect('42. QQ 无版权 → no-copyright（不是 spotify-no-preview）',
    playableReason(qqNoCopyright, false) === 'no-copyright');
  expect('42b. 对应文案', unplayableText(qqNoCopyright, false) === '所有平台都无版权');

  const spNoPreview = {
    bestSource: 'spotify',
    sources: [{ platform: 'spotify', trackId: 's1', hasCopyright: true, url: '/s', noPreview: true }],
  };
  expect('42c. Spotify 无预览 → spotify-no-preview',
    playableReason(spNoPreview, false) === 'spotify-no-preview');
  expect('42d. 文案提 Premium 通道',
    (unplayableText(spNoPreview, false) || '').includes('Premium'));
  expect('42e. WPS 已连 → 可播（reason=null）', playableReason(spNoPreview, true) === null);
  expect('42f. 可播时文案也是 null', unplayableText(spNoPreview, true) === null);

  const noBest = { bestSource: null, sources: [] };
  expect('42g. bestSource=null 且无源 → no-source', playableReason(noBest, false) === 'no-source');
  // bestSource 为 null 但**源都无版权** → 应说"无版权"（SearchPanel 既有行为）
  const nullBestNoCopyright = {
    bestSource: null,
    sources: [{ platform: 'qq', trackId: 'q2', hasCopyright: false, url: '/q2' }],
  };
  expect('42g2. bestSource=null 但源全无版权 → no-copyright',
    playableReason(nullBestNoCopyright, false) === 'no-copyright');
  expect('42g3. 该场景 isPlayableEntry 仍为 false（行为未变）',
    isPlayableEntry(nullBestNoCopyright, false) === false);
  const bestMissing = { bestSource: 'qq', sources: [{ platform: 'netease', trackId: 'n', hasCopyright: true, url: '/n' }] };
  expect('42h. bestSource 指向不存在的源 → no-source',
    playableReason(bestMissing, false) === 'no-source');

  // isPlayableEntry 必须是 playableReason 的薄封装（两者不能漂）
  for (const [label, entry, wps] of [
    ['QQ 无版权', qqNoCopyright, false],
    ['Spotify 无预览', spNoPreview, false],
    ['Spotify 无预览 + WPS', spNoPreview, true],
    ['bestSource=null', noBest, false],
  ]) {
    expect(`42i. isPlayableEntry 与 playableReason 一致：${label}`,
      isPlayableEntry(entry, wps) === (playableReason(entry, wps) === null));
  }
}

console.log(`\n🎉 api.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
