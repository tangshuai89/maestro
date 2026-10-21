/**
 * `downloadLyricsImage` 的 canvas 渲染路径测试。
 *
 * 为什么单独一个文件：`lyricsShare.test.mjs` 是 **node 直接跑**的自实现
 * loader（见该文件头），只能测纯函数；canvas 路径需要 DOM。而 renderer 的
 * vitest 只 include `*.test.tsx` 模式（见 `vitest.config.ts`），所以这一档
 * 只能落成 `.test.tsx`。
 *
 * 为什么能测 happy-dom 下的 canvas：happy-dom 的 `getContext('2d')` 返回
 * **null**（空壳，没有 2D 实现），`createImageBitmap` 干脆不存在。所以这里
 * 把这两处 + `fetch` + `<a>.click()` 全部打桩，断言的是**渲染意图**
 * （画了哪几行、用什么字体、封面走不走代理、下载文件名对不对），
 * 而不是像素。
 *
 * 覆盖的行为（对应 `lyricsShare.ts` 72-171）：
 *  1. 封面走 /music/cover-proxy（带 CORS 头）→ 否则 canvas 被跨域污染
 *  2. 封面加载失败 → 降级成无封面版式，**仍然导出成功**
 *  3. 高亮行用粗体 + 左侧竖条
 *  4. 歌词被裁掉时画「…」
 *  5. 下载文件名 = `歌名 - 歌手 歌词.png`
 *  6. getContext 返回 null → 明确返回 false（而不是抛）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadLyricsImage } from './lyricsShare';
import type { LyricLine } from '../api';

// ── 假 2D context：记录所有绘制调用 ─────────────────────────────────
interface FillTextCall {
  text: string;
  font: string;
  fillStyle: string;
  x: number;
  y: number;
}
interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}

interface FakeCtx {
  fillStyle: string;
  font: string;
  texts: FillTextCall[];
  rects: RectCall[];
  drawImages: unknown[];
  clips: number;
  saves: number;
  restores: number;
}

function makeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    fillStyle: '',
    font: '',
    texts: [],
    rects: [],
    drawImages: [],
    clips: 0,
    saves: 0,
    restores: 0,
  };
  const api = {
    get fillStyle() {
      return ctx.fillStyle;
    },
    set fillStyle(v: string) {
      ctx.fillStyle = v;
    },
    get font() {
      return ctx.font;
    },
    set font(v: string) {
      ctx.font = v;
    },
    fillText(text: string, x: number, y: number) {
      ctx.texts.push({ text, font: ctx.font, fillStyle: ctx.fillStyle, x, y });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ctx.rects.push({ x, y, w, h, fillStyle: ctx.fillStyle });
    },
    drawImage(img: unknown) {
      ctx.drawImages.push(img);
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    roundRect() {},
    clip() {
      ctx.clips += 1;
    },
    save() {
      ctx.saves += 1;
    },
    restore() {
      ctx.restores += 1;
    },
  };
  return Object.assign(ctx, api) as FakeCtx;
}

const lines = (n: number, prefix = 'L'): LyricLine[] =>
  Array.from({ length: n }, (_, i) => ({ time: i, text: `${prefix}${i}` }));

let ctx: FakeCtx;
let clicks: HTMLAnchorElement[] = [];
let canvases: { width: number; height: number; toDataURL: () => string }[] = [];

beforeEach(() => {
  ctx = makeCtx();
  clicks = [];
  canvases = [];

  // happy-dom 的 canvas 是空壳：getContext → null、toDataURL → 空串。
  // 这里换成"可记录"的实现。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvases.push({
      width: this.width,
      height: this.height,
      toDataURL: () => 'data:image/png;base64,STUB',
    });
    return 'data:image/png;base64,STUB';
  });

  // <a>.click() 在 happy-dom 里可能触发导航；这里只记录不真下载。
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this);
  });

  // 封面代理：默认失败（各用例按需覆盖）。
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, blob: async () => new Blob() }));

  // createImageBitmap 在 happy-dom 里不存在。
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ __bitmap: true }));

  // getApiOrigin() 每次调用都重算 → 这里给一个确定的 origin。
  (window as unknown as { electronAPI?: { apiBase?: string } }).electronAPI = {
    apiBase: 'http://127.0.0.1:3200',
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: { apiBase?: string } }).electronAPI;
  vi.unstubAllGlobals();
});

describe('downloadLyricsImage — canvas 渲染路径', () => {
  it('导出成功并触发下载，文件名 = `歌名 - 歌手 歌词.png`', async () => {
    const ok = await downloadLyricsImage({
      title: '夜曲',
      artist: '周杰伦',
      coverUrl: '',
      lines: lines(3),
    });

    expect(ok).toBe(true);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('夜曲 - 周杰伦 歌词.png');
    expect(clicks[0].href).toBe('data:image/png;base64,STUB');
  });

  it('封面走 /music/cover-proxy（跨域直连会污染 canvas）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: 'https://img.example.com/cover.jpg',
      lines: lines(2),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      'http://127.0.0.1:3200/music/cover-proxy?url=' +
        encodeURIComponent('https://img.example.com/cover.jpg'),
    );
    // 封面画进了 canvas
    expect(ctx.drawImages).toHaveLength(1);
    expect(ctx.clips).toBe(1); // 圆角裁剪
    expect(ctx.saves).toBe(1);
    expect(ctx.restores).toBe(1);
  });

  it('封面加载失败 → 降级成无封面版式，仍然导出成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const ok = await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: 'https://img.example.com/cover.jpg',
      lines: lines(2),
    });

    expect(ok).toBe(true); // 降级不是失败
    expect(ctx.drawImages).toHaveLength(0); // 没画封面
    expect(clicks).toHaveLength(1); // 但照样导出了
  });

  it('封面返回 !ok → 同样降级（不炸）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const ok = await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: 'https://img.example.com/cover.jpg',
      lines: lines(2),
    });

    expect(ok).toBe(true);
    expect(ctx.drawImages).toHaveLength(0);
  });

  it('高亮行用粗体 + accent 竖条，其余行常规体', async () => {
    await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: '',
      lines: lines(5),
      highlightText: 'L2',
    });

    const lyricTexts = ctx.texts.filter((t) => /^L\d+$/.test(t.text));
    expect(lyricTexts).toHaveLength(5);

    const hl = lyricTexts.find((t) => t.text === 'L2');
    expect(hl?.font).toContain('700');
    expect(hl?.fillStyle).toBe('#a2472a');

    const normal = lyricTexts.find((t) => t.text === 'L0');
    expect(normal?.font).toContain('400');
    expect(normal?.fillStyle).toBe('#453629');

    // 高亮行左侧一道 3px 竖条
    expect(ctx.rects.some((r) => r.w === 3 && r.h === 20)).toBe(true);
  });

  it('歌词被裁掉时画「…」，完整时不画', async () => {
    await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: '',
      lines: lines(100),
      highlightText: 'L50',
    });
    expect(ctx.texts.some((t) => t.text === '…')).toBe(true);

    ctx.texts.length = 0;
    await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: '',
      lines: lines(5),
    });
    expect(ctx.texts.some((t) => t.text === '…')).toBe(false);
  });

  it('画布高度随歌词行数与截断状态变化', async () => {
    await downloadLyricsImage({ title: 'T', artist: 'A', coverUrl: '', lines: lines(5) });
    const short = canvases[0];

    await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: '',
      lines: lines(100),
      highlightText: 'L50',
    });
    const truncated = canvases[1];

    expect(short.width).toBe(720);
    expect(truncated.width).toBe(720);
    // 截断版多一行「…」→ 更高
    expect(truncated.height).toBeGreaterThan(short.height);
  });

  it('落款是 Maestro', async () => {
    await downloadLyricsImage({ title: 'T', artist: 'A', coverUrl: '', lines: lines(2) });
    expect(ctx.texts.some((t) => t.text === 'Maestro')).toBe(true);
  });

  it('getContext 返回 null → 明确返回 false（不抛）', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const ok = await downloadLyricsImage({
      title: 'T',
      artist: 'A',
      coverUrl: '',
      lines: lines(2),
    });
    expect(ok).toBe(false);
    expect(clicks).toHaveLength(0);
  });
});
