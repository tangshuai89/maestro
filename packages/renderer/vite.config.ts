import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { isDevPortFree, pickFreePort } from './scripts/dev-port.mjs';

const DEFAULT_DEV_PORT = 5173;

export default defineConfig({
  // ⚠️ `base: './'` 是 Electron + loadFile 的硬要求，不能删（2026-09-28 修）。
  //
  // prod 侧 `mainWindow.loadFile(rendererPath)` 走的是 `file://` 协议，而
  // vite 默认 base='/' 会把产物里的入口写成 `<script src="/assets/main-*.js">`
  // —— 绝对路径在 `file://` 下解析到**文件系统根**，结果是 index.html 和
  // lyrics.html（桌面歌词浮窗）一起白屏。
  //
  // 为什么以前没炸：`npm run dev` 走 `loadURL('http://127.0.0.1:5173')`，
  // 绝对路径完全正常；只有 `npm run pack` 的产物才会命中这个问题，而打包
  // 冒烟一直卡在 castLabs EVS 凭据上从没真正跑过（见 NEXT-ITERATION §0.3）。
  base: './',
  plugins: [react()],
  css: {
    preprocessorOptions: {
      // Use Dart Sass's modern compiler API (the legacy one is deprecated
      // and prints a warning on every build).
      scss: { api: 'modern-compiler' },
    },
  },
  server: {
    host: '127.0.0.1',
    /**
     * dev 端口。默认 5173，但**会被占用自动避让**（见 scripts/dev-port.mjs）：
     * 本机常同时跑着别的 5173 前端，硬编码端口会让 vite 静默换到 5174，
     * 而 electron main 里那个写死的 5173 仍然指向别人的服务 →
     * 页面能开但所有 /music 请求打到隔壁项目，极难排查。
     *
     * 需要固定端口时用环境变量覆盖，并同步 electron 侧：
     *   RENDERER_PORT=5200 npm run dev
     * 不设则按 5173 起，冲突时向上找空闲端口并在启动日志里**明确打印实际端口**。
     */
    port: resolveDevPort(),
    proxy: {
      // The server has no route prefix, so we forward the three route
      // roots verbatim (no rewrite). This matches the prod path exactly
      // (origin + `/music/...`), so dev and packaged builds behave the
      // same. `/music` also covers the <audio>/cover-proxy media paths.
      '/music': { target: 'http://127.0.0.1:3200', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:3200', changeOrigin: true },
      '/reco': { target: 'http://127.0.0.1:3200', changeOrigin: true },
      '/storage': { target: 'http://127.0.0.1:3200', changeOrigin: true },
      // `/library/*` — NL 歌单 CRUD（specs/nl-playlist A4/A5）。2026-09-29 漏配：
      // 请求打不到 server，vite 自己接住并回 index.html，前端拿到 HTML 去
      // `res.json()` → `Unexpected token '<', "<!doctype "... is not valid JSON`。
      // 症状具有迷惑性（"歌单操作失败"），因为同 modal 里的 parse-intent
      // 走 `/reco` 是通的，只有「列出/保存歌单」这几个动作炸。
      '/library': { target: 'http://127.0.0.1:3200', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // 两个入口：index.html = 主窗口，lyrics.html = 桌面歌词浮窗（§7.2）。
    // 浮窗是独立 BrowserWindow，必须有自己的 HTML 入口，不能只靠 URL query
    // 从主入口分流 —— 那样主窗口的全部 bundle 都会被浮窗加载一遍。
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lyrics: fileURLToPath(new URL('./lyrics.html', import.meta.url)),
      },
    },
  },
});

/**
 * 解析实际使用的 dev 端口。
 *
 * 优先级：RENDERER_PORT 环境变量 > 5173。
 * 设了 RENDERER_PORT 就**严格照用**，占用就报错（用户显式指定的端口不该被
 * 悄悄改掉）；没设则在 5173..5199 里找第一个空闲的，并打印醒目提示。
 */
function resolveDevPort(): number {
  const explicit = Number(process.env.RENDERER_PORT);
  if (Number.isFinite(explicit) && explicit > 0) {
    if (!isDevPortFree(explicit)) {
      console.error(
        `[dev-port] RENDERER_PORT=${explicit} 已被占用。` +
          `请换一个：RENDERER_PORT=${pickFreePort(explicit + 1)} npm run dev`,
      );
      throw new Error(`RENDERER_PORT ${explicit} is already in use`);
    }
    return explicit;
  }
  if (isDevPortFree(DEFAULT_DEV_PORT)) return DEFAULT_DEV_PORT;
  const free = pickFreePort(DEFAULT_DEV_PORT);
  console.warn(
    `\n\n  ⚠️  [dev-port] ${DEFAULT_DEV_PORT} 已被占用（可能是本机另一个前端）。\n` +
      `      Maestro renderer 改用 ${free}。\n` +
      `      若 electron 窗口没自动跟随，请手动开 http://127.0.0.1:${free}\n` +
      `      想固定端口：RENDERER_PORT=<空闲端口> npm run dev\n`,
  );
  return free;
}
