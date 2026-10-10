// relogin-grace.test.mjs — Phase 11 P11-2 熔断（登录宽限期）白盒测试。
// 熔断语义：mark_expired 落账前必经 inReloginGrace —— 探针故障把「刚登录
// 成功的会话」报死时，宽限期内拦成 warn，防「重登→立刻又探死→再重登」
// 死循环（这批 Phase 11 改动里风险最高的一条逻辑，review 点名要测）。
//
// 时钟全部注入（now 参数），零墙钟依赖。
//
// Run: node src/auth/relogin-grace.test.mjs

import { register } from 'node:module';
import * as assert from 'node:assert';

// ── inline loader: .ts extension resolution + .js→.ts rewrite ───────────
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.endsWith('.ts')) {
    const ext = extname(specifier);
    if (!ext) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    } else if (ext === '.js') {
      try { return await nextResolve(specifier.slice(0, -3) + '.ts', context); } catch {}
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

const T0 = 1_000_000_000;

async function main() {
  const {
    RELOGIN_GRACE_MS,
    markLoginOk,
    inReloginGrace,
    __resetReloginGrace,
  } = await import('./relogin-grace.ts');

  // ── 1. 宽限期内：刚登录成功 → inReloginGrace=true（mark_expired 被拦）──
  {
    __resetReloginGrace();
    markLoginOk('qq', T0);
    assert.strictEqual(inReloginGrace('qq', T0), true, '登录完成瞬间即在宽限期');
    assert.strictEqual(
      inReloginGrace('qq', T0 + RELOGIN_GRACE_MS - 1),
      true,
      '宽限期边界内仍拦截',
    );
    console.log('✅ 1. 登录成功 → 宽限期内 inReloginGrace=true');
  }

  // ── 2. 宽限期外：探针报 expired 正常落 mark_expired ────────────────────
  {
    __resetReloginGrace();
    markLoginOk('qq', T0);
    assert.strictEqual(
      inReloginGrace('qq', T0 + RELOGIN_GRACE_MS),
      false,
      '恰好满 10min 即结束（严格小于边界）',
    );
    assert.strictEqual(
      inReloginGrace('qq', T0 + RELOGIN_GRACE_MS + 1),
      false,
      '宽限过后正常放行',
    );
    console.log('✅ 2. 宽限期边界：≥RELOGIN_GRACE_MS → false');
  }

  // ── 3. 未登录过的 provider → false；且宽限期按 provider 隔离 ──────────
  {
    __resetReloginGrace();
    markLoginOk('qq', T0);
    assert.strictEqual(
      inReloginGrace('netease', T0 + 1000),
      false,
      'netease 没登录过 → qq 的宽限期不罩它',
    );
    assert.strictEqual(
      inReloginGrace('spotify', T0 + 1000),
      false,
      'spotify 同理',
    );
    assert.strictEqual(inReloginGrace('qq', T0 + 1000), true, 'qq 自己在宽限');
    console.log('✅ 3. 宽限期 per-provider 隔离');
  }

  // ── 4. 重新登录刷新时间：过期后再次 markLoginOk → 重新进入宽限 ────────
  {
    __resetReloginGrace();
    markLoginOk('qq', T0);
    const T1 = T0 + RELOGIN_GRACE_MS + 60_000; // 宽限已过
    assert.strictEqual(inReloginGrace('qq', T1), false, '前置：宽限已结束');
    markLoginOk('qq', T1); // 用户又登录成功一次
    assert.strictEqual(
      inReloginGrace('qq', T1 + 1000),
      true,
      '再次登录 → 新的 10min 宽限',
    );
    console.log('✅ 4. 重新登录刷新宽限期起点');
  }

  // ── 5. 探针误报场景演练（语义级）：登录→立刻报死→拦；宽限后报死→放 ────
  {
    __resetReloginGrace();
    markLoginOk('qq', T0);
    // 场景还原：刚登录成功，坏探针立刻报 expired（死循环入口）
    const wouldPromptRelogin = (p, now) => !inReloginGrace(p, now);
    assert.strictEqual(
      wouldPromptRelogin('qq', T0 + 500),
      false,
      '刚登录 0.5s 报死 → 不弹重登（熔断拦下）',
    );
    assert.strictEqual(
      wouldPromptRelogin('qq', T0 + 20 * 60 * 1000),
      true,
      '20min 后报死 → 正常弹重登',
    );
    console.log('✅ 5. 语义演练：刚登录报死拦截 / 宽限后报死放行');
  }

  console.log('\n🎉 relogin-grace.test.mjs: all 5 cases passed');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
