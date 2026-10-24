/**
 * 主进程 → renderer 的**播放命令**。
 *
 * ## 为什么单独一个文件
 *
 * `preload.ts` 有顶层副作用（`contextBridge.exposeInMainWorld`）→ **不能**被
 * main 进程 import（会把 preload 的执行提前到 main 里）。所以命令类型放这里，
 * preload / main / renderer 三边都用 `import type` 引它 —— 类型导入会被
 * 完全擦除，不产生任何运行时依赖。
 *
 * ## 命令从哪来
 *
 * 两个来源，共用**同一条 IPC 通道**（`tray:command`）：
 *   ① **托盘菜单**（macOS 菜单栏的 播放/暂停、上一首、下一首）
 *   ② **全局热键**（`global-shortcuts.ts` —— App 不在前台也能控制）
 *
 * 通道名保留 `tray:command` 不动（改名要动 preload 白名单 + `ipc-surface.test.ts`
 * 的白名单卫生检查，收益不抵风险）；**类型**改名 `TrayCommand` → `PlaybackCommand`
 * 以反映它现在的真实语义。
 */
export type PlaybackCommand = 'playpause' | 'next' | 'prev' | 'volumeup' | 'volumedown';
