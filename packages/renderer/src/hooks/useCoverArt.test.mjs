// F2 useCoverArt epoch 取消 / race 测试
//
// 验证 applyCoverImage 的 epoch 取消机制：
//   - 当 epoch 在 fetch 期间变化时，函数应 bail（不写 DOM）
//   - proxy 失败时 fallback 到原始 URL
//   - 成功时做颜色提取 + 设置 background-image
//
// 运行: node src/hooks/useCoverArt.test.mjs

// ── ESM loader: 让 Node 能 import .ts（extensionless import 补 .ts）─────
import { register } from 'node:module';
import { extname } from 'node:path';

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
    // Inject import.meta.env for Vite compatibility
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

// ── Mock DOM globals ──────────────────────────────────────────────────
// Minimal document/document.documentElement for coverColor.ts + useCoverArt.ts
const _styleMap = {};
const _rootStyle = {
  setProperty: (k, v) => { _styleMap[k] = v; },
  getPropertyValue: (k) => _styleMap[k] ?? '',
  removeProperty: (k) => { delete _styleMap[k]; },
};
const _elementProto = {
  style: {},
  _bgImage: null,
  get backgroundImage() { return this._bgImage; },
  set backgroundImage(v) {
    this.style.backgroundImage = v;
    this._bgImage = v;
  },
};
function makeDiv() {
  const div = Object.create(_elementProto);
  div.style = { backgroundImage: '' };
  return div;
}

globalThis.document = {
  documentElement: { style: _rootStyle },
  createElement: (tag) => {
    const el = makeDiv();
    if (tag === 'canvas') {
      el.width = 0;
      el.height = 0;
      el.getContext = () => ({
        drawImage: () => {},
        getImageData: () => ({ data: [10, 20, 30, 255] }),
      });
    }
    return el;
  },
};

// Mock createImageBitmap
globalThis.createImageBitmap = async (blob) => ({ close: () => {}, width: 100, height: 100 });

// Mock import.meta.env (Vite-specific, not available in plain Node)
globalThis.__import_meta_env = { DEV: false, PROD: true };

// Mock fetch
let _fetchImpl = null;
globalThis.fetch = (...args) => _fetchImpl ? _fetchImpl(...args) : Promise.resolve({
  ok: true,
  blob: async () => new Blob(['fake']),
});

// ── Import the module under test ──────────────────────────────────────
const mod = await import('./useCoverArt.ts');
const { applyCoverImage } = mod;

// ── Test helpers ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected ||
    JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function makeRefs() {
  const bgLayer = makeDiv();
  const coverBackdrop = makeDiv();
  const epochRef = { current: 0 };
  return {
    bgLayerRef: { current: bgLayer },
    coverBackdropRef: { current: coverBackdrop },
    epochRef,
  };
}

async function main() {
  // ── 1. epoch 不变 → 成功路径：设置 background-image + cover-accent ──
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => ({
      ok: true,
      blob: async () => new Blob(['fake']),
    });
    await applyCoverImage('https://example.com/cover.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('1. 成功路径 bgLayer.backgroundImage', refs.bgLayerRef.current.style.backgroundImage, 'url(https://example.com/cover.jpg)');
    check('1. 成功路径 coverBackdrop.backgroundImage', refs.coverBackdropRef.current.style.backgroundImage, 'url(https://example.com/cover.jpg)');
    // cover-accent should be set from sampled color (10,20,30)
    check('1. 成功路径 cover-accent set', _styleMap['--cover-accent'], 'rgb(10, 20, 30)');
  }

  // ── 2. fetch 期间 epoch 变化 → bail（不写 DOM）──────────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    let resolveFetch;
    _fetchImpl = async () => {
      // Simulate epoch change during fetch
      refs.epochRef.current = epoch + 1;
      return { ok: true, blob: async () => new Blob(['fake']) };
    };
    await applyCoverImage('https://example.com/stale.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    // DOM should NOT be touched (backgroundImage stays '')
    check('2. epoch 变化 → bgLayer 不写', refs.bgLayerRef.current.style.backgroundImage, '');
    check('2. epoch 变化 → coverBackdrop 不写', refs.coverBackdropRef.current.style.backgroundImage, '');
  }

  // ── 3. blob 期间 epoch 变化 → bail ──────────────────────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => ({
      ok: true,
      blob: async () => {
        refs.epochRef.current = epoch + 1;
        return new Blob(['fake']);
      },
    });
    await applyCoverImage('https://example.com/stale2.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('3. blob 期间 epoch 变化 → bgLayer 不写', refs.bgLayerRef.current.style.backgroundImage, '');
  }

  // ── 4. fetch 失败 → fallback 到原始 URL + resetCoverColor ────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => ({ ok: false, status: 500 });
    await applyCoverImage('https://cdn.example.com/cover.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('4. fetch 失败 → bgLayer fallback URL', refs.bgLayerRef.current.style.backgroundImage, 'url(https://cdn.example.com/cover.jpg)');
    check('4. fetch 失败 → coverBackdrop fallback URL', refs.coverBackdropRef.current.style.backgroundImage, 'url(https://cdn.example.com/cover.jpg)');
    // resetCoverColor sets --cover-accent to #1a1a1f
    check('4. fetch 失败 → cover-accent reset', _styleMap['--cover-accent'], '#1a1a1f');
  }

  // ── 5. fetch 抛异常 → fallback 到原始 URL ───────────────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => { throw new Error('network error'); };
    await applyCoverImage('https://cdn.example.com/cover2.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('5. fetch 抛异常 → bgLayer fallback URL', refs.bgLayerRef.current.style.backgroundImage, 'url(https://cdn.example.com/cover2.jpg)');
  }

  // ── 6. fetch 失败 + epoch 变化 → 不写 DOM（epoch 优先）────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => {
      refs.epochRef.current = epoch + 1;
      return { ok: false, status: 500 };
    };
    await applyCoverImage('https://example.com/should-not-apply.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('6. fetch 失败 + epoch 变化 → bgLayer 不写', refs.bgLayerRef.current.style.backgroundImage, '');
  }

  // ── 7. proxy URL 包含 encodeURIComponent ─────────────────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    let capturedUrl = null;
    _fetchImpl = async (url) => {
      capturedUrl = url;
      return { ok: true, blob: async () => new Blob(['fake']) };
    };
    await applyCoverImage('https://y.gtimg.cn/cover?special=chars & stuff', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('7. proxy URL 含 encoded 参数', capturedUrl.includes('cover-proxy?url='), true);
    check('7. proxy URL 编码特殊字符', capturedUrl.includes('special%3Dchars'), true);
  }

  // ── 8. 成功路径后 cover-glow 也设置 ──────────────────────────────
  {
    const refs = makeRefs();
    const epoch = 1;
    refs.epochRef.current = epoch;
    _fetchImpl = async () => ({ ok: true, blob: async () => new Blob(['fake']) });
    await applyCoverImage('https://example.com/glow.jpg', refs.bgLayerRef, refs.coverBackdropRef, epoch, refs.epochRef);
    check('8. 成功路径 cover-glow set', _styleMap['--cover-glow'], 'rgba(10, 20, 30, 0.32)');
  }

  // ── 9. 连续两次调用，第二次成功（epoch 不变）→ DOM 更新 ─────────
  {
    const refs = makeRefs();
    refs.epochRef.current = 1;
    _fetchImpl = async () => ({ ok: true, blob: async () => new Blob(['fake']) });
    await applyCoverImage('https://example.com/first.jpg', refs.bgLayerRef, refs.coverBackdropRef, 1, refs.epochRef);
    refs.epochRef.current = 2;
    await applyCoverImage('https://example.com/second.jpg', refs.bgLayerRef, refs.coverBackdropRef, 2, refs.epochRef);
    check('9. 连续调用 → 第二次覆盖第一次', refs.bgLayerRef.current.style.backgroundImage, 'url(https://example.com/second.jpg)');
  }

  // ── 10. bitmap.close() 被调用（资源清理）──────────────────────────
  {
    const refs = makeRefs();
    refs.epochRef.current = 1;
    let closed = false;
    globalThis.createImageBitmap = async () => ({ close: () => { closed = true; }, width: 100, height: 100 });
    _fetchImpl = async () => ({ ok: true, blob: async () => new Blob(['fake']) });
    await applyCoverImage('https://example.com/close-test.jpg', refs.bgLayerRef, refs.coverBackdropRef, 1, refs.epochRef);
    check('10. bitmap.close() 被调用', closed, true);
  }

  console.log(`\n🎉 useCoverArt.test 通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
