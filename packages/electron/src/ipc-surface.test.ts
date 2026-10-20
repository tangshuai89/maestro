/**
 * ipc-surface.test.ts — **全量** IPC 通道面的双向契约校验。
 *
 * 为什么需要（`desktop-lyrics/ipc-contract.test.ts` 只覆盖了 7 个桌面歌词通道）：
 *
 * IPC 通道名拼错**不会报任何错** —— `ipcRenderer.invoke('xxx')` 发到一个没人
 * `ipcMain.handle('xxx')` 的频道，renderer 那边就是一个永远 pending 的 Promise
 * （或永远不触发的监听）。typecheck 管不到（两边都是 string），单元测试也管不到
 * （controller 的测试直接调方法，绕过了通道名）。
 *
 * 这类错误在真机上表现为"某功能点了没反应"，而且**没有日志**。
 *
 * 覆盖三条不变式：
 *  1. renderer→main：preload 里每个 send/invoke 的通道，main 必须注册了
 *     ipcMain.on / ipcMain.handle（**含常量形式**：`ipcMain.handle(CHANNEL, …)`）
 *  2. main→renderer：preload 里每个 on 的通道，main 必须真的 webContents.send
 *     （同样含常量形式）
 *  3. 白名单卫生：SUBSCRIBABLE_CHANNELS（通用 on() 桥接的白名单）里的每个通道，
 *     都必须是 main **真的会推**的通道 —— 白名单里躺着一个 main 从不发的通道，
 *     renderer 就能订阅它并永远等下去（静默失败，且看起来"配了"）
 *
 * Run: npx ts-node packages/electron/src/ipc-surface.test.ts
 */
export {};
const assert = require('node:assert');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
const preloadSrc = readFileSync(join(ROOT, 'src', 'preload.ts'), 'utf8');

/** main 目录下所有 .ts 源文件（controller 也在里面注册通道）。 */
const mainSources: Array<{ file: string; src: string }> = [
  { file: 'main.ts', src: mainSrc },
  ...(readdirSync(join(ROOT, 'src'), { recursive: true }) as unknown as string[])
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, src: readFileSync(join(ROOT, 'src', f), 'utf8') })),
];

/**
 * 剥掉注释再抽通道名。
 *
 * 为什么必须剥：注释里出现一个带引号的通道名（哪怕是在解释"这个通道被删了"）
 * 都会被正则当成真通道 —— 实测踩过：白名单里删掉 'console-message' 后，
 * 解释它为什么被删的注释又把它抽了回来。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function matchAll(src: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** 源码里 `const NAME = 'value'` 形式的通道常量。 */
function channelConstants(): Map<string, string> {
  const map = new Map<string, string>();
  for (const { src } of mainSources) {
    const clean = stripComments(src);
    for (const m of clean.matchAll(/const\s+([A-Z0-9_]+)\s*(?::\s*string\s*)?=\s*'([^']+)'/g)) {
      map.set(m[1], m[2]);
    }
  }
  return map;
}

const CONSTANTS = channelConstants();

/** 某个通道字面量是否在 main 侧以"注册/推送"的方式出现过（含常量间接引用）。 */
function mainUses(channel: string, literalRe: RegExp, indirectRe: RegExp): boolean {
  for (const { src } of mainSources) {
    const clean = stripComments(src);
    if (matchAll(clean, literalRe).includes(channel)) return true;
    // 常量形式：ipcMain.handle(SOME_CONST, …) / webContents.send(SOME_CONST, …)
    for (const [name, value] of CONSTANTS) {
      if (value !== channel) continue;
      if (
        new RegExp(
          indirectRe.source.replace(/\(\s*'[^']*'\s*\)/, `\\(\\s*${name}\\s*,`),
          indirectRe.flags,
        ).test(src)
      ) {
        return true;
      }
    }
  }
  return false;
}

const HANDLED = /ipcMain\.(?:on|handle)\(\s*'([^']+)'/g;
const SENT = /webContents\.send\(\s*'([^']+)'/g;

function mainHandles(channel: string): boolean {
  return mainUses(channel, HANDLED, /ipcMain\.(?:on|handle)\(\s*'[^']*'/g);
}
function mainSends(channel: string): boolean {
  return mainUses(channel, SENT, /webContents\.send\(\s*'[^']*'/g);
}

/** preload → main（send / invoke）。 */
function preloadSends(): string[] {
  return matchAll(stripComments(preloadSrc), /ipcRenderer\.(?:send|invoke)\(\s*'([^']+)'/g);
}
/** main → renderer（on）。 */
function preloadOns(): string[] {
  return matchAll(stripComments(preloadSrc), /ipcRenderer\.on\(\s*'([^']+)'/g);
}

function allowlist(): string[] {
  const m = stripComments(preloadSrc).match(/SUBSCRIBABLE_CHANNELS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'preload.ts 里找不到 SUBSCRIBABLE_CHANNELS = new Set([...])');
  return matchAll(m![1], /'([^']+)'/g);
}

function main() {
  let passed = 0;
  let failed = 0;
  const check = (label: string, fn: () => void) => {
    try {
      fn();
      console.log(`✅ ${label}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${label}\n   ${(err as Error).message}`);
      failed++;
    }
  };

  const sends = [...new Set(preloadSends())].sort();
  const ons = [...new Set(preloadOns())].sort();
  const allow = allowlist().sort();

  check('1. renderer→main：preload 的每个 send/invoke 通道 main 都注册了', () => {
    for (const ch of sends) {
      assert.ok(
        mainHandles(ch),
        `preload 发了 "${ch}"，但 main 侧没有对应的 ipcMain.on/handle —— ` +
          `通道名拼错不会报错，只会让调用永远 pending`,
      );
    }
    assert.ok(sends.length >= 10, `preload 只发了 ${sends.length} 个通道，疑似漏抽`);
  });

  check('2. main→renderer：preload 的每个 on 通道 main 真的推了', () => {
    for (const ch of ons) {
      assert.ok(
        mainSends(ch),
        `preload 监听了 "${ch}"，但 main 侧没有 webContents.send —— ` +
          `订阅永远不会触发（静默失败）`,
      );
    }
    assert.ok(ons.length >= 4, `preload 只监听 ${ons.length} 个通道，疑似漏抽`);
  });

  check('3. 白名单卫生：SUBSCRIBABLE_CHANNELS ⊆ main 会推的通道', () => {
    for (const ch of allow) {
      assert.ok(
        mainSends(ch),
        `白名单里的 "${ch}" main 从来不推 —— renderer 可以订阅它并永远等下去。` +
          `要么让 main 真的推，要么从白名单里删掉（白名单是"main→renderer"的订阅面）`,
      );
    }
  });

  check('4. 白名单里的通道都真的是"main→renderer"方向', () => {
    // 反向通道（renderer→main）不该出现在订阅白名单里。
    for (const ch of allow) {
      assert.ok(
        !sends.includes(ch),
        `"${ch}" 在 preload 里是 renderer→main 的通道，却出现在订阅白名单里 —— ` + `方向搞反了`,
      );
    }
  });

  check('5. preload 的白名单校验真的在 on() 入口生效', () => {
    assert.ok(
      /if \(!SUBSCRIBABLE_CHANNELS\.has\(channel\)\)/.test(preloadSrc),
      'preload 的通用 on() 桥接里找不到白名单校验（等于没设防）',
    );
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} ipc-surface.test：${passed} 通过 / ${failed} 失败`);
  console.log(
    `   preload→main ${sends.length} 个 · main→renderer ${ons.length} 个 · 白名单 ${allow.length} 个`,
  );
  if (failed > 0) process.exit(1);
}

main();
