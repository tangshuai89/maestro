/**
 * 一次性运维脚本 v2：取消指定 merged item 的红心（远端 unlike + 本地清理），
 * 然后重新 import 重建红心库。
 *
 * 为什么不用 like/merged(liked=false)：fanOutLike 的 unlike 分支只按
 * `state.fanOut[mergedId]` 记录 unlike——这 9 个 item 的红心来自 **import 快照**
 * （不是运行时 fanOut），fanOut 里没有它们 → no-op。单平台 `like/:trackId`
 * 的 toggleLike 走 `providers.{platform}.liked` 集合翻转（本地同步删）+ 入
 * 同步队列调 provider.unlike（远端），才是「取消红心」的正确语义。
 *
 * 流程：
 *   1) 前置检查 GET /music/liked 确认 9 个 trackId 当前都处于 liked
 *   2) 逐个 POST /music/like/:trackId?provider=X（toggle → unlike，本地立即可见）
 *   3) 轮询 GET /music/liked 直到全部消失（本地态；远端队列 drain 中）
 *   4) 等待远端 unlike 队列 drain（sleep，重试 3 轮）
 *   5) POST /music/library/import 重建库快照
 *   6) 验证 9 个 mergedId 已从库中消失
 *
 * 用法：cd packages/server && TS_NODE_PROJECT=tsconfig.json npx ts-node ../../scripts/unlike-tracks.ts
 */
import * as crypto from 'crypto';

const BASE = 'http://localhost:3200';
const SESSION_ID = '730b80449c9f46bc4dac32db395d9782c789a6b8a7758878';
const SECRET = 'dev-only-secret-change-me'; // ConfigService.sessionSecret dev 默认值

/** cookie-parser signed cookie: s:<value>.<hmac-sha256 base64url> */
function signedCookie(value: string, secret: string): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `mb_session=s:${value}.${sig}`;
}

async function post(path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: signedCookie(SESSION_ID, SECRET),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: signedCookie(SESSION_ID, SECRET) },
  });
  return { status: res.status, text: await res.text() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 待取消红心的 item（用户确认清单）───────────────────────────────────
const TARGETS: Array<{
  mergedId: string;
  desc: string;
  platform: string;
  trackId: string;
}> = [
  { mergedId: 'merged-spotify-6kRTLXO3ybmjzdCT9TU8CI', desc: '#7 廻廻奇譚 歌っちゃ王(卡拉OK)', platform: 'spotify', trackId: '6kRTLXO3ybmjzdCT9TU8CI' },
  { mergedId: 'merged-spotify-0ZTOWj55EDAiXrC6RcmSAj', desc: '#50 奏(かなで) 歌っちゃ王(卡拉OK)', platform: 'spotify', trackId: '0ZTOWj55EDAiXrC6RcmSAj' },
  { mergedId: 'merged-spotify-5qrpm6a7leqinXsuYfLy1u', desc: '#14 ドラマツルギー 星乃一歌', platform: 'spotify', trackId: '5qrpm6a7leqinXsuYfLy1u' },
  { mergedId: 'merged-netease-1909023198', desc: '#22 신호등(LIVE) 李茂珍/华莎', platform: 'netease', trackId: '1909023198' },
  { mergedId: 'merged-netease-1974341758', desc: '#10 Attention 翻唱', platform: 'netease', trackId: '1974341758' },
  { mergedId: 'merged-netease-2086765376', desc: '#13 3D 翻唱', platform: 'netease', trackId: '2086765376' },
  { mergedId: 'merged-netease-1328692786', desc: '#15 天真有邪 翻唱', platform: 'netease', trackId: '1328692786' },
  { mergedId: 'merged-netease-27770542', desc: '#33 说好的幸福呢 翻唱', platform: 'netease', trackId: '27770542' },
  { mergedId: 'merged-netease-3349885273', desc: '#5 恒星不忘 钢琴版', platform: 'netease', trackId: '3349885273' },
];

async function likedIds(platform: string): Promise<string[]> {
  const r = await get(`/music/liked?provider=${platform}`);
  try {
    const j = JSON.parse(r.text);
    return (j.tracks ?? []).map((t: { id: string }) => t.id);
  } catch {
    return [];
  }
}

async function main() {
  console.log(`🎯 待取消红心 ${TARGETS.length} 个 item\n`);

  // 0) 前置：确认 session 有效 + 目标当前都 liked
  const pre = await get('/music/library');
  if (pre.status !== 200) {
    console.log(`❌ session 无效（GET /music/library → ${pre.status}），中止`);
    process.exit(1);
  }
  for (const p of ['spotify', 'netease']) {
    const ids = await likedIds(p);
    const missing = TARGETS.filter((t) => t.platform === p && !ids.includes(t.trackId));
    if (missing.length) {
      console.log(`⚠️ ${p} liked 中缺 ${missing.length} 个（可能已被取消或从未红心）: ${missing.map((m) => m.desc).join('; ')}`);
    } else {
      console.log(`[pre] ${p} liked 共 ${ids.length} 首，目标全部在列 ✓`);
    }
  }

  // 1) 逐个 toggle → unlike
  console.log('\n🔧 逐个取消红心（toggleLike → unlike）…');
  for (const t of TARGETS) {
    const r = await post(`/music/like/${encodeURIComponent(t.trackId)}?provider=${t.platform}`);
    let liked: unknown;
    try {
      liked = JSON.parse(r.text).liked;
    } catch {
      /* ignore */
    }
    console.log(`${r.status === 201 ? '✅' : '❌'} ${t.desc} → HTTP ${r.status} liked=${String(liked)}`);
  }

  // 2) 轮询本地 liked 集合，直到 9 个全部消失
  console.log('\n⏳ 等待本地 liked 集合更新…');
  for (let round = 0; round < 20; round++) {
    const spot = await likedIds('spotify');
    const net = await likedIds('netease');
    const all = [...spot, ...net];
    const remaining = TARGETS.filter((t) => all.includes(t.trackId));
    if (remaining.length === 0) {
      console.log(`✅ 本地 liked 已全部清除（spotify ${spot.length} / netease ${net.length}）`);
      break;
    }
    if (round === 19) {
      console.log(`❌ 本地 liked 仍有 ${remaining.length} 个未清除: ${remaining.map((r) => r.desc).join('; ')}`);
      process.exit(1);
    }
    await sleep(500);
  }

  // 3) 等待远端 unlike 队列 drain（重试 3 轮，每轮 15s）
  console.log('\n🌐 等待远端 unlike 同步（队列 drain）…');
  for (let round = 1; round <= 3; round++) {
    await sleep(15000);
    // 远端是否生效的探针：重新 import 后看是否还回来
    console.log(`  轮 ${round}/3：sleep 15s 完成，尝试 import 验证…`);
    const imp = await post('/music/library/import');
    let items: Array<{ id: string }> = [];
    try {
      items = JSON.parse(imp.text).items ?? [];
    } catch {
      console.log(`  import 响应异常: ${imp.text.slice(0, 200)}`);
      continue;
    }
    const remaining = TARGETS.filter((t) => items.some((it) => it.id === t.mergedId));
    console.log(`  import → ${items.length} items，仍有 ${remaining.length} 个目标在库`);
    if (remaining.length === 0) break;
    if (round === 3) {
      console.log(`\n⚠️ 3 轮后仍有 ${remaining.length} 个在库（远端 unlike 可能失败）: ${remaining.map((r) => r.desc).join('; ')}`);
    }
  }

  // 4) 最终验证
  console.log('\n🔍 最终验证…');
  const lib = await get('/music/library');
  const items = JSON.parse(lib.text).items ?? [];
  console.log(`  库 items: ${items.length}`);
  for (const t of TARGETS) {
    const still = items.some((it: { id: string }) => it.id === t.mergedId);
    console.log(`  ${still ? '❌ 仍在库' : '✅ 已消失'}  ${t.desc}`);
  }
}

void main().catch((e) => {
  console.error('执行失败:', e);
  process.exit(1);
});
