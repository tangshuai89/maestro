import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 桌面歌词浮窗的持久化偏好（NEXT-ITERATION §7.2）。
 *
 * 存在 `userData/desktop-lyrics.json` —— 浮窗是独立 BrowserWindow，它的
 * 位置/样式只有自己知道，而 renderer 的 localStorage 是按 origin 共享的、
 * 放在 renderer 进程里拿不到。所以偏好的**唯一事实来源在 main 进程**，
 * 浮窗通过 IPC 读，改完再回写。
 */

export type PaletteName = 'light' | 'dark' | 'cyan' | 'amber';

export interface DesktopLyricsBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopLyricsPrefs {
  /** 浮窗是否开启。关闭时窗口被 destroy（不留 GPU 占用）。 */
  enabled: boolean;
  /** 锁定 = 点击穿透（不挡下层窗口操作）。 */
  locked: boolean;
  /** 字号倍率，clamp 到 [MIN, MAX]。 */
  fontScale: number;
  /** 是否给文字描边（浮在浅色桌面 / 图片上时需要）。 */
  stroke: boolean;
  /** 配色预设；实际色值在 renderer 的 token 层（scanner 豁免文件）。 */
  palette: PaletteName;
  /** 上次关闭时的窗口位置/尺寸；null = 让 OS 决定（首次开窗默认居中偏下）。 */
  bounds: DesktopLyricsBounds | null;
}

export const FONT_SCALE_MIN = 0.7;
export const FONT_SCALE_MAX = 1.8;
export const PALETTES: readonly PaletteName[] = ['light', 'dark', 'cyan', 'amber'];

export const DEFAULT_PREFS: DesktopLyricsPrefs = {
  enabled: false,
  locked: false,
  fontScale: 1,
  stroke: true,
  palette: 'light',
  bounds: null,
};

/** 浮窗最小尺寸 —— 再小就装不下两行字。 */
export const OVERLAY_MIN_SIZE = { width: 420, height: 96 };
/** 浮窗默认尺寸（860×160 放得下一行长句 + 行内进度）。 */
export const OVERLAY_DEFAULT_SIZE = { width: 860, height: 160 };

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isPalette(v: unknown): v is PaletteName {
  return typeof v === 'string' && (PALETTES as readonly string[]).includes(v);
}

/**
 * 把任意（可能是被手改坏的 / 旧版本缺的）JSON 归一成合法 prefs。
 * 逐字段兜底，不整体丢弃 —— 旧文件只多一个字段时不该把用户样式重置。
 */
export function normalisePrefs(raw: unknown): DesktopLyricsPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const o = raw as Record<string, unknown>;
  const b = o.bounds;
  const bounds =
    b && typeof b === 'object'
      ? (() => {
          const bb = b as Record<string, unknown>;
          const nums = ['x', 'y', 'width', 'height'].map((k) => Number(bb[k]));
          if (nums.some((n) => !Number.isFinite(n))) return null;
          return {
            x: Math.round(nums[0]),
            y: Math.round(nums[1]),
            // 尺寸下限兜底：0/负数会让窗口打不开
            width: Math.max(OVERLAY_MIN_SIZE.width, Math.round(nums[2])),
            height: Math.max(OVERLAY_MIN_SIZE.height, Math.round(nums[3])),
          };
        })()
      : null;
  return {
    enabled: Boolean(o.enabled),
    locked: Boolean(o.locked),
    fontScale: clampNumber(o.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, DEFAULT_PREFS.fontScale),
    stroke: typeof o.stroke === 'boolean' ? o.stroke : DEFAULT_PREFS.stroke,
    palette: isPalette(o.palette) ? o.palette : DEFAULT_PREFS.palette,
    bounds,
  };
}

export function prefsPath(userDataDir: string): string {
  return join(userDataDir, 'desktop-lyrics.json');
}

/** 读偏好。文件不存在 / 坏了 / 无权限 → 回落到默认值（浮窗起得来比样式重要）。 */
export function loadPrefs(userDataDir: string): DesktopLyricsPrefs {
  const file = prefsPath(userDataDir);
  try {
    if (!existsSync(file)) return { ...DEFAULT_PREFS };
    return normalisePrefs(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** 存偏好。先写 .tmp 再 rename —— 拖动窗口时高频写，崩在半路不该留半个 JSON。 */
export function savePrefs(userDataDir: string, prefs: DesktopLyricsPrefs): boolean {
  const file = prefsPath(userDataDir);
  const tmp = `${file}.tmp`;
  try {
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(prefs, null, 2), 'utf-8');
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
