/**
 * 自动更新的**状态机**（specs/auto-update）。
 *
 * ## 为什么不直接用 `electron-updater`
 *
 * `electron-updater` 是 electron 的运行时依赖，而本包的 main 进程**零运行时
 * 依赖**（打包时 `npmRebuild: false`，见 scripts/pack.cjs 的说明）⇒ 引入它要
 * 动打包管线。而打包失误的代价是「App 起不来」。
 *
 * ⇒ 这里把**状态机**独立出来：它不 import electron，`electron-updater` 的 API
 * 由 main 侧**适配**进来（`UpdaterBridge`）。于是：
 *   - 状态机可以纯单测（node:assert，跟 global-shortcuts 同款做法）
 *   - `electron-updater` 可以**懒加载 + try/catch**：打包时依赖没带进产物
 *     ⇒ App 照常启动，只是没有自动更新（降级，而不是崩）
 */

/** 更新状态（IPC payload 的形状）。 */
export type UpdateState =
  /** 还没查过。 */
  | { kind: 'idle' }
  /** 不支持更新（dev 模式 / 未打包 / 没有 publish 配置）。 */
  | { kind: 'unsupported'; reason: string }
  /** 正在检查。 */
  | { kind: 'checking' }
  /** 已是最新。 */
  | { kind: 'not-available'; version: string }
  /** 有新版本（可能正在下载）。 */
  | { kind: 'available'; version: string; notes?: string }
  /** 下载中。 */
  | { kind: 'downloading'; percent: number }
  /** 下载完成，等重启安装。 */
  | { kind: 'ready'; version: string }
  /** 出错了。 */
  | { kind: 'error'; message: string };

/** 底层事件（`electron-updater` 的 autoUpdater.on 的那五个）。 */
export interface UpdaterEventMap {
  available: { version: string; notes?: string };
  'not-available': { version: string };
  progress: { percent: number };
  downloaded: { version: string };
  error: { message: string };
}

/**
 * 底层桥（main 侧把 `electron-updater` 适配成这个形状）。
 *
 * `check()` 的语义：**检查完成**（有没有新版本看后续事件）；**抛错** = 检查失败
 * （网络问题 / 没有 publish 配置 / 没权限）。
 */
export interface UpdaterBridge {
  check(): Promise<void>;
  on<K extends keyof UpdaterEventMap>(event: K, cb: (payload: UpdaterEventMap[K]) => void): void;
  /** 退出并安装（重启后生效）。 */
  install(): void;
}

export interface Updater {
  getState(): UpdateState;
  /** 订阅状态变化；**立刻**回调一次当前状态（订阅者不用先问一遍）。 */
  subscribe(cb: (state: UpdateState) => void): () => void;
  /** 手动/自动检查一次。 */
  check(): Promise<UpdateState>;
  /** 退出并安装。 */
  install(): void;
  /** 标成「不支持更新」（dev / 未打包 / 依赖缺失）。 */
  setUnsupported(reason: string): void;
}

function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const s = String(e);
  return s && s !== '[object Object]' ? s : '更新失败';
}

/** 创建状态机。 */
export function createUpdater(bridge: UpdaterBridge): Updater {
  let state: UpdateState = { kind: 'idle' };
  const listeners = new Set<(s: UpdateState) => void>();

  const set = (next: UpdateState): void => {
    state = next;
    // 复制一份再遍历 —— 回调里退订不会影响本次遍历
    for (const l of [...listeners]) l(next);
  };

  bridge.on('available', (info) =>
    set({ kind: 'available', version: info.version, notes: info.notes }),
  );
  bridge.on('not-available', (info) => set({ kind: 'not-available', version: info.version }));
  bridge.on('progress', (p) =>
    set({
      kind: 'downloading',
      // electron-updater 给的是 0..1 的小数；这里换算成百分比并夹到 0..100
      percent: Math.max(0, Math.min(100, Math.round(p.percent * 100))),
    }),
  );
  bridge.on('downloaded', (info) => set({ kind: 'ready', version: info.version }));
  bridge.on('error', (e) => set({ kind: 'error', message: e.message || '更新失败' }));

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      cb(state);
      return () => {
        listeners.delete(cb);
      };
    },
    async check() {
      set({ kind: 'checking' });
      try {
        await bridge.check();
        // 兜底：底层事件还没把状态推进（极少见）⇒ 别把界面卡在「检查中」
        if (state.kind === 'checking') set({ kind: 'not-available', version: '' });
        return state;
      } catch (e) {
        set({ kind: 'error', message: errMessage(e) });
        return state;
      }
    },
    install() {
      bridge.install();
    },
    setUnsupported(reason) {
      set({ kind: 'unsupported', reason });
    },
  };
}

/**
 * 一个「不支持更新」的 updater（dev / 未打包 / 依赖缺失）。
 *
 * 存在的意义：让调用方**不用到处判空** —— 状态机、IPC、UI 拿到的都是一个
 * 正常的 updater，只是它的状态恒为 unsupported。
 */
export function createUnsupportedUpdater(reason: string): Updater {
  const u = createUpdater({
    check: async () => undefined,
    on: () => undefined,
    install: () => undefined,
  });
  u.setUnsupported(reason);
  return u;
}

// ── electron-updater 适配层 ────────────────────────────────────────
//
// ⚠️ **懒加载**：`electron-updater` 是 electron 包的**运行时依赖**，而打包时
// `npmRebuild: false`（见 scripts/pack.cjs）⇒ 依赖**不一定**被带进产物。
//   - 加载失败（没装 / 没打进产物）⇒ 返回 null ⇒ App **照常启动**，只是没有
//     自动更新（降级，而不是崩）。
//   - 用**变量** require ⇒ TypeScript **不在编译期**解析这个模块 ⇒ 没装依赖
//     也能编译通过。

/** 我们用到的那几个 `electron-updater` 接口（不打整个包的类型）。 */
export interface ElectronAutoUpdater {
  checkForUpdates(): Promise<unknown>;
  /** 关掉「退出时自动安装」⇒ 安装必须用户点「重启并安装」。 */
  autoInstallOnAppQuit?: boolean;
  on(event: string, cb: (arg: unknown) => void): void;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/**
 * 懒加载 electron-updater。加载不到（没装 / 没打进产物）⇒ `null`。
 *
 * @param loader 注入点（单测用；生产走 node 的 require）
 */
export function loadElectronUpdater(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loader: (id: string) => unknown = (id) => require(id),
): ElectronAutoUpdater | null {
  try {
    const mod = loader('electron-updater') as
      { autoUpdater?: ElectronAutoUpdater } | ElectronAutoUpdater | undefined | null;
    if (!mod) return null;
    const auto =
      (mod as { autoUpdater?: ElectronAutoUpdater }).autoUpdater ?? (mod as ElectronAutoUpdater);
    if (!auto || typeof auto.checkForUpdates !== 'function') return null;
    return auto;
  } catch {
    return null;
  }
}

/** electron-updater 的事件名 → 我们的状态机事件名。 */
const EVENT_MAP: Record<string, keyof UpdaterEventMap> = {
  'update-available': 'available',
  'update-not-available': 'not-available',
  'download-progress': 'progress',
  'update-downloaded': 'downloaded',
  error: 'error',
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 把 electron-updater 的回调载荷规整成我们的形状（它给的是松散结构）。 */
function normalizePayload(event: keyof UpdaterEventMap, raw: unknown): unknown {
  const info = (raw ?? {}) as {
    version?: unknown;
    releaseNotes?: unknown;
    percent?: unknown;
    message?: unknown;
  };
  switch (event) {
    case 'available':
      return { version: asString(info.version), notes: asString(info.releaseNotes) };
    case 'not-available':
    case 'downloaded':
      return { version: asString(info.version) };
    case 'progress':
      return { percent: typeof info.percent === 'number' ? info.percent : 0 };
    case 'error':
      return {
        message:
          typeof info.message === 'string' && info.message
            ? info.message
            : raw instanceof Error
              ? raw.message
              : String(raw ?? '更新失败'),
      };
  }
}

/** 把 electron-updater 适配成 `UpdaterBridge`。 */
export function createElectronUpdaterBridge(auto: ElectronAutoUpdater): UpdaterBridge {
  return {
    async check() {
      await auto.checkForUpdates();
    },
    on(event, cb) {
      for (const [electronEvent, ourEvent] of Object.entries(EVENT_MAP)) {
        if (ourEvent !== event) continue;
        auto.on(electronEvent, (raw: unknown) => {
          (cb as (p: unknown) => void)(normalizePayload(event, raw));
        });
      }
    },
    install() {
      // isSilent = 不弹安装界面；isForceRunAfter = 装完自动重开
      auto.quitAndInstall(true, true);
    },
  };
}
