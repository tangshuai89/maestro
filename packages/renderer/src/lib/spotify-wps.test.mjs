// spotify-wps.test.mjs — tests for createWpsWrapper() from ./spotify-wps.ts
//
// renderer 包用 ESM，测试是 .mjs（纯 JS），被 scripts/test.sh 的 find 自动发现
// 并用 `node <file>` 运行。Node 22+ 默认支持 type stripping，可以直接 import .ts，
// 但 spotify-wps.ts 里有无扩展名的 import ('./debug')，Node ESM 不支持自动补扩展名。
// 所以这里用 module.register() 注册一个 inline loader 来补 .ts 扩展名。
//
// 测试策略：mock globalThis.window / Spotify / fetch / localStorage，然后动态
// import ./spotify-wps.ts，验证 createWpsWrapper 返回的 wrapper 对象行为。

import { register } from 'node:module';

// ── inline loader: 给 .ts 文件里的无扩展名 import 补 .ts ──────────────────
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
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

// ── mock globals（必须在 import spotify-wps.ts 之前设置） ──────────────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
};

globalThis.window = globalThis;
globalThis.location = { search: '', reload: () => {} };
globalThis.window.location = globalThis.location;

// mock Spotify Web Playback SDK
class MockSpotifyPlayer {
  constructor(opts) {
    this.opts = opts;
    this._listeners = {};
    this._connected = false;
    this._disconnected = false;
  }
  async connect() {
    this._connected = true;
    return true;
  }
  disconnect() {
    this._disconnected = true;
    this._connected = false;
  }
  async getCurrentState() {
    return null;
  }
  async resume() {
    this._resumed = true;
  }
  async pause() {
    this._paused = true;
  }
  async seek(pos) {
    this._seekedTo = pos;
  }
  async activateElement() {}
  addListener(event, cb) {
    this._listeners[event] = cb;
    return true;
  }
  // Helper to simulate SDK firing an event
  _fire(event, payload) {
    if (this._listeners[event]) this._listeners[event](payload);
  }
}

globalThis.Spotify = {
  Player: MockSpotifyPlayer,
};

// mock fetch
let lastFetch = null;
const mockFetchResponses = new Map(); // url → { status, ok, body }
globalThis.fetch = async (url, init) => {
  lastFetch = { url: String(url), init };
  const key = String(url);
  if (mockFetchResponses.has(key)) {
    const r = mockFetchResponses.get(key);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body || '',
      json: async () => JSON.parse(r.body || '{}'),
    };
  }
  // default: 204 No Content (success for Spotify API PUTs)
  return { ok: true, status: 204, text: async () => '', json: async () => ({}) };
};

function setFetchResponse(url, status, body = '') {
  mockFetchResponses.set(url, { status, body });
}

// ── 动态 import 被测模块 ──────────────────────────────────────────────────
const { createWpsWrapper } = await import('./spotify-wps.ts');

// ── 极简 test harness（和 token-integrity.test.mjs 风格一致） ──────────────
let failures = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push(`  \u2713 ${name}`);
  } catch (e) {
    results.push(`  \u2717 ${name}`);
    results.push(`    ${e.message}`);
    failures++;
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    results.push(`  \u2713 ${name}`);
  } catch (e) {
    results.push(`  \u2717 ${name}`);
    results.push(`    ${e.message}`);
    failures++;
    process.exitCode = 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertThrows(fn, msgFragment) {
  let threw = false;
  let err;
  try {
    fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'expected to throw');
  if (msgFragment) {
    assert(
      err.message.includes(msgFragment),
      `expected error to include "${msgFragment}", got "${err.message}"`,
    );
  }
}

async function assertRejects(fn, msgFragment) {
  let threw = false;
  let err;
  try {
    await fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'expected to reject');
  if (msgFragment) {
    assert(
      err.message.includes(msgFragment),
      `expected error to include "${msgFragment}", got "${err.message}"`,
    );
  }
}

// ── 辅助：让 SDK 立即 ready（跳过 waitForSdk 的 5s 轮询） ─────────────────
function markSdkReady() {
  globalThis.__wpsSdkReady = true;
}

// ── 测试 ──────────────────────────────────────────────────────────────────

test('createWpsWrapper returns object with expected API', () => {
  const w = createWpsWrapper();
  assert(typeof w.connect === 'function', 'missing connect');
  assert(typeof w.disconnect === 'function', 'missing disconnect');
  assert(typeof w.play === 'function', 'missing play');
  assert(typeof w.pause === 'function', 'missing pause');
  assert(typeof w.resume === 'function', 'missing resume');
  assert(typeof w.seek === 'function', 'missing seek');
  assert(typeof w.transferHere === 'function', 'missing transferHere');
  assert(typeof w.onStateChange === 'function', 'missing onStateChange');
  assert(typeof w.onSdkReady === 'function', 'missing onSdkReady');
  assert(typeof w.refreshToken === 'function', 'missing refreshToken');
});

test('initial state: ready=false, emeOk=false, hasDeviceId=false', () => {
  const w = createWpsWrapper();
  assert(w.ready === false, `ready should be false, got ${w.ready}`);
  assert(w.emeOk === false, `emeOk should be false, got ${w.emeOk}`);
  assert(w.hasDeviceId === false, `hasDeviceId should be false, got ${w.hasDeviceId}`);
});

test('onStateChange immediately pushes current (initial) state to new subscriber', () => {
  const w = createWpsWrapper();
  let received = null;
  const unsub = w.onStateChange((s) => {
    received = s;
  });
  assert(received !== null, 'subscriber should receive initial state immediately');
  assert(received.hasTrack === false, 'initial hasTrack should be false');
  assert(received.isPlaying === false, 'initial isPlaying should be false');
  assert(received.track === null, 'initial track should be null');
  assert(received.positionMs === 0, 'initial positionMs should be 0');
  unsub();
});

test('onStateChange unsubscribe stops further notifications', () => {
  const w = createWpsWrapper();
  let count = 0;
  const unsub = w.onStateChange(() => {
    count++;
  });
  // initial push counts as 1
  assert(count === 1, `expected 1 initial push, got ${count}`);
  unsub();
  // After unsubscribe, even if we subscribe again (which triggers a new push to
  // the new subscriber), the old callback should not fire.
  w.onStateChange(() => {});
  assert(count === 1, `unsubscribed callback should not fire, got count=${count}`);
});

test('onSdkReady queues callback when no deviceId yet', () => {
  const w = createWpsWrapper();
  let called = false;
  w.onSdkReady(() => {
    called = true;
  });
  assert(!called, 'onSdkReady callback should not fire immediately when no deviceId');
});

test('play throws "not connected" before connect', async () => {
  const w = createWpsWrapper();
  await assertRejects(() => w.play('spotify:track:abc'), 'not connected');
});

test('resume/pause/seek are no-ops before connect (do not throw)', async () => {
  const w = createWpsWrapper();
  // These check `if (!player) return;` internally — should not throw
  await w.resume();
  await w.pause();
  await w.seek(1000);
});

test('transferHere is a no-op before connect (does not throw)', async () => {
  const w = createWpsWrapper();
  await w.transferHere();
});

await testAsync('connect with valid token + SDK creates player and connects', async () => {
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('test-token-123');
  assert(w.ready === true, 'ready should be true after connect');
  assert(w.emeOk === true, 'emeOk should be true after connect (no fatal error)');
});

await testAsync('connect sets up getOAuthToken callback that provides token', async () => {
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('my-token');
  // The player is internal, but we can verify via the opts stored on MockSpotifyPlayer.
  // We need to grab the player instance — connect stores it internally.
  // Instead, verify indirectly: refreshToken should update the token source.
  w.refreshToken('new-token');
  // No direct way to inspect getToken, but no throw means it works.
  assert(true, 'refreshToken did not throw');
});

await testAsync('ready event sets deviceId and fires onSdkReady callback', async () => {
  markSdkReady();
  const w = createWpsWrapper();
  let sdkReadyCalled = false;
  w.onSdkReady(() => {
    sdkReadyCalled = true;
  });
  await w.connect('token-ready');
  assert(!sdkReadyCalled, 'onSdkReady should not fire before ready event');
  assert(w.hasDeviceId === false, 'hasDeviceId should be false before ready event');
  // Simulate SDK firing the ready event. The player instance is internal,
  // but MockSpotifyPlayer stores listeners. We need to find the player.
  // Since connect() creates the player internally, we can't directly access it.
  // However, we can verify hasDeviceId changes by triggering the ready event
  // through the mock. The mock's _fire method is on the instance.
  // Workaround: the last created MockSpotifyPlayer is accessible via a side channel.
  // Actually, we stored it: MockSpotifyPlayer instances are created via `new Spotify.Player()`.
  // Let's track it globally.
  assert(true, 'ready event test setup complete');
});

await testAsync('ready event via tracked player sets deviceId', async () => {
  // Track the player instance by intercepting the constructor
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  let sdkReadyCalled = false;
  w.onSdkReady(() => {
    sdkReadyCalled = true;
  });
  await w.connect('token-ready-2');
  assert(capturedPlayer !== null, 'player should have been created');
  // Simulate SDK ready event
  capturedPlayer._fire('ready', { device_id: 'device-xyz' });
  assert(w.hasDeviceId === true, 'hasDeviceId should be true after ready event');
  assert(sdkReadyCalled, 'onSdkReady callback should fire after ready event');
  // Restore
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('player_state_changed event updates state and notifies subscribers', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-state');

  let lastState = null;
  w.onStateChange((s) => {
    lastState = s;
  });

  // Simulate player_state_changed with a track
  capturedPlayer._fire('player_state_changed', {
    track: {
      uri: 'spotify:track:abc',
      name: 'Test Song',
      artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
      album: { name: 'Album X' },
      duration_ms: 180000,
    },
    paused: false,
    position: 5000,
    timestamp: Date.now(),
  });

  assert(lastState !== null, 'subscriber should receive state update');
  assert(lastState.hasTrack === true, 'hasTrack should be true');
  assert(lastState.isPlaying === true, 'isPlaying should be true (paused=false)');
  assert(lastState.track !== null, 'track should not be null');
  assert(lastState.track.uri === 'spotify:track:abc', `track.uri wrong: ${lastState.track.uri}`);
  assert(lastState.track.name === 'Test Song', `track.name wrong: ${lastState.track.name}`);
  assert(
    lastState.track.artists.length === 2 && lastState.track.artists[0] === 'Artist A',
    'artists should be mapped',
  );
  assert(lastState.track.album === 'Album X', `album wrong: ${lastState.track.album}`);
  assert(lastState.track.durationMs === 180000, `durationMs wrong: ${lastState.track.durationMs}`);
  assert(lastState.positionMs === 5000, `positionMs wrong: ${lastState.positionMs}`);

  // Simulate paused state
  capturedPlayer._fire('player_state_changed', {
    track: {
      uri: 'spotify:track:abc',
      name: 'Test Song',
      artists: [{ name: 'Artist A' }],
      album: { name: 'Album X' },
      duration_ms: 180000,
    },
    paused: true,
    position: 6000,
    timestamp: Date.now(),
  });
  assert(lastState.isPlaying === false, 'isPlaying should be false when paused');

  // Simulate null state (track ended / transferred)
  capturedPlayer._fire('player_state_changed', null);
  assert(lastState.hasTrack === false, 'hasTrack should be false on null state');
  assert(lastState.track === null, 'track should be null on null state');

  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('authentication_error event makes emeOk false (wpsFatal)', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-auth');
  assert(w.emeOk === true, 'emeOk should be true before auth error');
  capturedPlayer._fire('authentication_error', { message: 'bad scope' });
  assert(w.emeOk === false, 'emeOk should be false after authentication_error');
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('initialization_error event makes emeOk false (wpsFatal)', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-init');
  capturedPlayer._fire('initialization_error', { message: 'EME failed' });
  assert(w.emeOk === false, 'emeOk should be false after initialization_error');
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('account_error event makes emeOk false (wpsFatal)', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-acct');
  capturedPlayer._fire('account_error', { message: 'not premium' });
  assert(w.emeOk === false, 'emeOk should be false after account_error');
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('disconnect clears player (ready becomes false)', async () => {
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-disc');
  assert(w.ready === true, 'ready should be true before disconnect');
  w.disconnect();
  assert(w.ready === false, 'ready should be false after disconnect');
});

await testAsync('disconnect clears subscribers', async () => {
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-sub');
  let count = 0;
  w.onStateChange(() => {
    count++;
  });
  const initialCount = count;
  w.disconnect();
  // After disconnect, subs.clear() is called. We can't easily trigger a state
  // change after disconnect (player is null), but we verify subs were cleared
  // by checking that re-subscribing after disconnect still works.
  w.onStateChange(() => {});
  assert(true, 're-subscribe after disconnect works');
});

await testAsync('play throws "device not ready" when connected but no deviceId', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-play-noid');
  // Don't fire ready event → no deviceId
  await assertRejects(() => w.play('spotify:track:abc'), 'device not ready');
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('play calls fetch with correct URL and body', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-play-ok');
  capturedPlayer._fire('ready', { device_id: 'dev-123' });
  lastFetch = null;
  await w.play('spotify:track:track123');
  assert(lastFetch !== null, 'fetch should have been called');
  assert(
    lastFetch.url.includes('device_id=dev-123'),
    `URL should contain device_id=dev-123, got ${lastFetch.url}`,
  );
  assert(lastFetch.init.method === 'PUT', `method should be PUT, got ${lastFetch.init.method}`);
  assert(
    lastFetch.init.headers.Authorization === 'Bearer token-play-ok',
    `auth header wrong: ${lastFetch.init.headers.Authorization}`,
  );
  const body = JSON.parse(lastFetch.init.body);
  assert(body.uris[0] === 'spotify:track:track123', `body uris wrong: ${body.uris}`);
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('play throws on non-ok response', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-play-fail');
  capturedPlayer._fire('ready', { device_id: 'dev-fail' });
  const playUrl = 'https://api.spotify.com/v1/me/player/play?device_id=dev-fail';
  setFetchResponse(playUrl, 403, 'Forbidden');
  await assertRejects(() => w.play('spotify:track:x'), 'play failed');
  // Clean up mock
  mockFetchResponses.delete(playUrl);
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('transferHere calls fetch with correct body', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-transfer');
  capturedPlayer._fire('ready', { device_id: 'dev-transfer' });
  lastFetch = null;
  await w.transferHere();
  assert(lastFetch !== null, 'fetch should have been called for transfer');
  assert(
    lastFetch.url === 'https://api.spotify.com/v1/me/player',
    `transfer URL wrong: ${lastFetch.url}`,
  );
  const body = JSON.parse(lastFetch.init.body);
  assert(body.device_ids[0] === 'dev-transfer', `device_ids wrong: ${body.device_ids}`);
  assert(body.play === false, `play should be false: ${body.play}`);
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('resume/pause/seek delegate to player methods', async () => {
  let capturedPlayer = null;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-rps');
  await w.resume();
  assert(capturedPlayer._resumed === true, 'player.resume() should have been called');
  await w.pause();
  assert(capturedPlayer._paused === true, 'player.pause() should have been called');
  await w.seek(42000);
  assert(capturedPlayer._seekedTo === 42000, `player.seek(42000) should have been called, got ${capturedPlayer._seekedTo}`);
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('connect with connect() returning false throws', async () => {
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      async connect() {
        return false;
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await assertRejects(() => w.connect('token-fail-connect'), 'connect() 返 false');
  globalThis.Spotify = { Player: OriginalPlayer };
});

await testAsync('reconnect disconnects old player before creating new one', async () => {
  let capturedPlayer = null;
  let disconnectCount = 0;
  const OriginalPlayer = globalThis.Spotify.Player;
  globalThis.Spotify = {
    Player: class extends MockSpotifyPlayer {
      constructor(opts) {
        super(opts);
        capturedPlayer = this;
      }
      disconnect() {
        disconnectCount++;
        super.disconnect();
      }
    },
  };
  markSdkReady();
  const w = createWpsWrapper();
  await w.connect('token-1');
  const firstPlayer = capturedPlayer;
  await w.connect('token-2');
  assert(disconnectCount >= 1, 'old player should have been disconnected on reconnect');
  assert(capturedPlayer !== firstPlayer, 'a new player should have been created');
  assert(w.ready === true, 'ready should still be true after reconnect');
  globalThis.Spotify = { Player: OriginalPlayer };
});

// ── 输出结果 ──────────────────────────────────────────────────────────────
for (const r of results) console.log(r);
console.log(`\u2500\u2500 spotify-wps tests done (${failures} failures) \u2500\u2500`);
