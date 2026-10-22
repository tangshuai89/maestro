/**
 * useCoverArt —— vitest（@vitest/coverage-v8）管线侧的测试。
 *
 * 为什么需要这个文件（2026-10-22 实测）：
 *
 *   1. `useCoverArt.ts` 原先**只有** `useCoverArt.test.mjs`（node 管线）。node 管线
 *      拿不到 source map → c8 的行号是错位的 → 覆盖率工具无法把这批覆盖归到
 *      正确的行上（行级判据对它只能按「不可信」处理）。
 *   2. 所有 usePlayer 的 `.test.tsx` 都 `vi.mock('./useCoverArt')` → coverage-v8
 *      看到的是 **0%**。
 *   ⇒ 两侧夹击：useCoverArt.ts 在**权威**覆盖率里是 0%，完全看不出它其实有
 *      16 条真实断言。这就是「装了 coverage-v8 之后新可见的覆盖洞」的第一例。
 *
 * 这个文件做两件事：
 *   - 把同样的场景搬到 vitest 管线（行号可信），让权威覆盖率如实反映它；
 *   - 补上 `.mjs` 没测的 `useCoverArt()` hook 本体：presentCover /
 *     presentPlaceholder / epoch 竞态 / ref 为空时的健壮性。
 *
 * ── 为什么用「样式替身」而不是真实 div ────────────────────────────────
 * happy-dom 的 CSS 解析器有两个会挡住断言的行为（实测）：
 *   - `background-image: linear-gradient(...)` → **整条被丢弃**（读回来是 ''）
 *   - `background-image: url(x)` → 被规范化成 `url("x")`（多一对引号）
 * 而产品写的恰恰是渐变（占位封面）和裸 url（真实封面）。所以这里断言的是
 * 「**代码写进去了什么字符串**」——用带 style 袋子的替身元素，和 .mjs 那份
 * 保持同一口径。真实浏览器里这两种写法都是合法 CSS（浏览器不挑）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { applyCoverImage, useCoverArt } from './useCoverArt';
import { placeholderCover } from '../lib/placeholderCover';

// ── 测试替身 ───────────────────────────────────────────────────────────

/** happy-dom 的 canvas.getContext('2d') 恒返回 null → 自己塞一个能取像素的。 */
function stubCanvasContext(withPixels: boolean) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      (withPixels
        ? {
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) })),
          }
        : null) as unknown as CanvasRenderingContext2D,
  );
}

/** happy-dom 没有 createImageBitmap → 补一个可控的替身。 */
function stubImageBitmap(onClose?: () => void) {
  const fn = vi.fn(async () => ({
    close: () => onClose?.(),
    width: 100,
    height: 100,
  }));
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = fn;
  return fn;
}

/** 替身元素：只有一个 style 袋子，够写 background-image 用。 */
interface StyleTarget {
  style: { backgroundImage: string };
}

function makeTarget(): StyleTarget {
  return { style: { backgroundImage: '' } };
}

/** 两个替身元素 + 一个 epoch ref，形状对齐 applyCoverImage 的入参。 */
function makeRefs() {
  const bgLayer = makeTarget();
  const coverBackdrop = makeTarget();
  const epochRef = { current: 0 };
  return {
    bgLayer,
    coverBackdrop,
    bgLayerRef: { current: bgLayer as unknown as HTMLDivElement },
    coverBackdropRef: { current: coverBackdrop as unknown as HTMLDivElement },
    epochRef,
  };
}

/** 读 :root 上的 CSS 自定义属性。 */
function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

const OK_BLOB = () => new Blob(['fake'], { type: 'image/png' });

/** 可手动放行的 fetch（用来制造「在途」竞态）。 */
function deferredFetch() {
  const releases: Array<() => void> = [];
  const impl = vi.fn(
    () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ ok: true, blob: async () => OK_BLOB() }));
      }),
  );
  return { impl, releases };
}

// Mock 的类型刻意放宽：不同用例要 mock 出不同形状的响应（ok/非 ok/抛错），
// 收窄成单一形状只会逼出一堆无意义的断言。
let fetchMock: Mock;

beforeEach(() => {
  // 封面色是写在 :root 上的，happy-dom 不重置 document → 手工清干净，
  // 否则上一条用例的颜色会漏进下一条断言。
  document.documentElement.style.removeProperty('--cover-accent');
  document.documentElement.style.removeProperty('--cover-glow');

  fetchMock = vi.fn(async () => ({ ok: true, blob: async () => OK_BLOB() }));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  stubImageBitmap();
  stubCanvasContext(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── applyCoverImage ─────────────────────────────────────────────────────

describe('applyCoverImage', () => {
  it('1. 成功路径：两个 div 都用原始 url 当背景，并取色写 --cover-accent / --cover-glow', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;

    await applyCoverImage(
      'https://example.com/cover.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('url(https://example.com/cover.jpg)');
    expect(r.coverBackdrop.style.backgroundImage).toBe('url(https://example.com/cover.jpg)');
    expect(cssVar('--cover-accent')).toBe('rgb(10, 20, 30)');
    expect(cssVar('--cover-glow')).toBe('rgba(10, 20, 30, 0.32)');
  });

  it('2. fetch 期间 epoch 变化 → bail，一个像素都不写', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    fetchMock.mockImplementation(async () => {
      r.epochRef.current = 2; // 模拟切歌：epoch 被顶掉
      return { ok: true, blob: async () => OK_BLOB() };
    });

    await applyCoverImage(
      'https://example.com/stale.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('');
    expect(r.coverBackdrop.style.backgroundImage).toBe('');
  });

  it('3. blob 期间 epoch 变化 → bail，不写 DOM', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    fetchMock.mockImplementation(async () => ({
      ok: true,
      blob: async () => {
        r.epochRef.current = 2;
        return OK_BLOB();
      },
    }));

    await applyCoverImage(
      'https://example.com/stale2.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('');
  });

  it('4. proxy 返回非 2xx → 回落原始 url，并重置封面色', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500 }));

    await applyCoverImage(
      'https://cdn.example.com/cover.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('url(https://cdn.example.com/cover.jpg)');
    expect(r.coverBackdrop.style.backgroundImage).toBe('url(https://cdn.example.com/cover.jpg)');
    expect(cssVar('--cover-accent')).toBe('#1a1a1f');
    expect(cssVar('--cover-glow')).toBe('transparent');
  });

  it('5. fetch 抛异常 → 同样回落原始 url', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    fetchMock.mockImplementation(async () => {
      throw new Error('network error');
    });

    await applyCoverImage(
      'https://cdn.example.com/cover2.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('url(https://cdn.example.com/cover2.jpg)');
  });

  it('6. proxy 失败且 epoch 同时变化 → epoch 优先，不写 DOM', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    fetchMock.mockImplementation(async () => {
      r.epochRef.current = 2;
      return { ok: false, status: 500 };
    });

    await applyCoverImage(
      'https://example.com/should-not-apply.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('');
  });

  it('7. 取色走 cover-proxy，且 url 参数经过 encodeURIComponent', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;

    await applyCoverImage(
      'https://y.gtimg.cn/cover?special=chars & stuff',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    const called = String(fetchMock.mock.calls[0][0]);
    expect(called).toContain('/music/cover-proxy?url=');
    expect(called).toContain('special%3Dchars');
    expect(called).not.toContain(' & ');
  });

  it('8. 成功后 bitmap.close() 被调用（不泄漏 GPU 资源）', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    let closed = false;
    stubImageBitmap(() => {
      closed = true;
    });

    await applyCoverImage(
      'https://example.com/close-test.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(closed).toBe(true);
  });

  it('9. 连续两次调用 → 后者覆盖前者', async () => {
    const r = makeRefs();
    r.epochRef.current = 1;
    await applyCoverImage(
      'https://example.com/first.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );
    r.epochRef.current = 2;
    await applyCoverImage(
      'https://example.com/second.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      2,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('url(https://example.com/second.jpg)');
  });

  it('10. 拿不到 2d context → 跳过取色，但背景照常设置', async () => {
    stubCanvasContext(false);
    const r = makeRefs();
    r.epochRef.current = 1;

    await applyCoverImage(
      'https://example.com/nocontext.jpg',
      r.bgLayerRef,
      r.coverBackdropRef,
      1,
      r.epochRef,
    );

    expect(r.bgLayer.style.backgroundImage).toBe('url(https://example.com/nocontext.jpg)');
    // 没取色 → 不该留下任何颜色
    expect(cssVar('--cover-accent')).toBe('');
  });

  it('11. 两个 ref.current 都是 null → 不崩溃、不写 DOM', async () => {
    const epochRef = { current: 1 };

    await expect(
      applyCoverImage(
        'https://example.com/noref.jpg',
        { current: null },
        { current: null },
        1,
        epochRef,
      ),
    ).resolves.toBeUndefined();
  });
});

// ── useCoverArt() hook ──────────────────────────────────────────────────

describe('useCoverArt()', () => {
  /** 把 hook 的两个 ref 指到替身元素上（模拟 div 挂载后 ref.current 有值）。 */
  function attach(result: { current: ReturnType<typeof useCoverArt> }) {
    const bgLayer = makeTarget();
    const backdrop = makeTarget();
    (result.current.bgLayerRef as { current: unknown }).current = bgLayer;
    (result.current.coverBackdropRef as { current: unknown }).current = backdrop;
    return { bgLayer, backdrop };
  }

  it('12. presentCover：走 cover-proxy 取色，并把原始 url 刷到两个 div', async () => {
    const { result } = renderHook(() => useCoverArt());
    const { bgLayer, backdrop } = attach(result);

    await act(async () => {
      result.current.presentCover('https://example.com/hook.jpg');
    });

    await vi.waitFor(() => {
      expect(bgLayer.style.backgroundImage).toBe('url(https://example.com/hook.jpg)');
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/music/cover-proxy?url=');
    expect(backdrop.style.backgroundImage).toBe('url(https://example.com/hook.jpg)');
  });

  it('13. presentPlaceholder：写渐变背景 + 渐变对应的 accent 色', async () => {
    const { result } = renderHook(() => useCoverArt());
    const { bgLayer, backdrop } = attach(result);
    const expected = placeholderCover('晴天·周杰伦');

    act(() => {
      result.current.presentPlaceholder('晴天·周杰伦');
    });

    expect(bgLayer.style.backgroundImage).toBe(expected.background);
    expect(backdrop.style.backgroundImage).toBe(expected.background);
    expect(cssVar('--cover-accent')).toBe(
      `rgb(${expected.accent[0]}, ${expected.accent[1]}, ${expected.accent[2]})`,
    );
    // 占位封面不该去打 cover-proxy
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('14. presentPlaceholder 在途时 presentCover 返回 → epoch 顶掉，渐变不被在途的取色覆盖', async () => {
    const { result } = renderHook(() => useCoverArt());
    const { bgLayer } = attach(result);

    const { impl, releases } = deferredFetch();
    fetchMock.mockImplementation(impl);

    act(() => {
      result.current.presentCover('https://example.com/inflight.jpg');
    });
    // 在途 fetch 还没落地 → 此时切到占位封面
    act(() => {
      result.current.presentPlaceholder('别的歌');
    });
    const placeholderBg = bgLayer.style.backgroundImage;

    await act(async () => {
      releases[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 在途的取色必须放弃（epoch 已变）→ 渐变保持不变
    expect(bgLayer.style.backgroundImage).toBe(placeholderBg);
    expect(placeholderBg).toContain('linear-gradient');
  });

  it('15. ref.current 为 null 时 presentCover / presentPlaceholder 都不崩', async () => {
    const { result } = renderHook(() => useCoverArt());

    await act(async () => {
      result.current.presentCover('https://example.com/noref.jpg');
      result.current.presentPlaceholder('无 ref');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('16. 连续 presentCover 两次 → 第二张作废第一张（先到的不能覆盖后到的）', async () => {
    const { result } = renderHook(() => useCoverArt());
    const { bgLayer } = attach(result);

    const { impl, releases } = deferredFetch();
    fetchMock.mockImplementationOnce(impl);

    act(() => {
      result.current.presentCover('https://example.com/one.jpg');
    });
    act(() => {
      result.current.presentCover('https://example.com/two.jpg');
    });

    await vi.waitFor(() => {
      expect(bgLayer.style.backgroundImage).toBe('url(https://example.com/two.jpg)');
    });

    // 现在把第一张（在途）放行 → 它必须放弃，不能把 two.jpg 盖掉
    await act(async () => {
      releases[0]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bgLayer.style.backgroundImage).toBe('url(https://example.com/two.jpg)');
  });
});
