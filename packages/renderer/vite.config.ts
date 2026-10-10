import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  DEFAULT_DEV_PORT,
  isDevPortFree,
  pickFreePort,
  resolveAndPublishDevPort,
  clearPublishedDevPort,
} from './scripts/dev-port.mjs';

export default defineConfig({
  // ⚠️ `base: './'` 是 Electron + loadFile 的硬要求，不能删（2026-09-28 修）。
  //
  // prod 侧 `mainWindow.loadFile(rendererPath)` 走的是 `file://` 协议，而
  // vite 默认 base='/' 会把产物里的入口写成 `<script src="/assets/main-*.js">`
  // —— 绝对路径在 `file://` 下解析到**文件系统根**，结果是 index.html 和
  // lyrics.html（桌面歌词浮窗）一起白屏。
  //
  // 为什么以前没炸：`npm run dev` 走 `loadURL('http://127.0.0.1:5273')`，
  // 绝对路径完全正常；只有 `npm run pack` 的产物才会命中这个问题，而打包
  // 冒烟一直卡在 castLabs EVS 凭据上从没真正跑过（见 NEXT-ITERATION §0.3）。
  base: './',
  plugins: [
    react(),
    {
      /**
       * 端口发布：把**实际**监听的端口写进 .dev-port，供 electron 读取。
       *
       * 为什么不靠 electron 自己去探测：两个进程探测的时间点不同 ——
       * vite 启动时 5273 还空着，等 electron 起来再探 5273 已被 vite 占，
       * 于是两边算出不同端口，electron 连了个没人监听的端口直接黑屏
       * （2026-10-08 实测 ERR_CONNECTION_REFUSED）。vite 才是真正 listen 的
       * 那个，所以它是唯一权威方。
       */
      name: 'maestro-publish-dev-port',
      configureServer(server) {
        // ⚠️ 必须在 **listening 事件**里读端口，不能在 configureServer 里直接读：
        // configureServer 跑在 vite 真正 listen 之前，此时 `address()` 拿到的
        // 还是**配置的**端口（5273），而 vite 实际可能已经顺延到 5274 ——
        // 那样 electron 就会去连一个没人监听的 5273（第一版黑屏的根因）。
        const publish = () => {
          const addr = server.httpServer?.address();
          const actual =
            addr && typeof addr === 'object' && typeof addr.port === 'number'
              ? addr.port
              : undefined;
          const published = resolveAndPublishDevPort(DEFAULT_DEV_PORT, actual);
          if (published !== DEFAULT_DEV_PORT) {
            console.warn(
              `\n  ⚠️  [dev-port] ${DEFAULT_DEV_PORT} 已被占用（可能是本机另一个前端）。` +
                `\n      Maestro renderer 实际使用 ${published}（已发布给 electron）。` +
                `\n      想固定端口：RENDERER_PORT=<空闲端口> npm run dev\n`,
            );
          } else {
            console.log(`[dev-port] renderer 使用 ${published}`);
          }
        };
        const srv = server.httpServer;
        if (srv) {
          if (srv.listening) publish();
          else srv.once('listening', publish);
          srv.once('close', clearPublishedDevPort);
        }
        process.once('exit', clearPublishedDevPort);
        process.once('SIGINT', clearPublishedDevPort);
        process.once('SIGTERM', clearPublishedDevPort);
      },
    },
  ],
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
     * dev 端口。默认 5273，但**会被占用自动避让**（见 scripts/dev-port.mjs）：
     * 本机常同时跑着别的 5273 前端，硬编码端口会让 vite 静默换到 5274，
     * 而 electron main 里那个写死的 5273 仍然指向别人的服务 →
     * 页面能开但所有 /music 请求打到隔壁项目，极难排查。
     *
     * 需要固定端口时用环境变量覆盖，并同步 electron 侧：
     *   RENDERER_PORT=5200 npm run dev
     * 不设则按 5273 起，冲突时向上找空闲端口并在启动日志里**明确打印实际端口**。
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
 * vite 的 `server.port` 首选值。
 *
 * 显式 `RENDERER_PORT` → 严格照用（占用就报错，用户指定的端口不该被悄悄改）。
 * 否则给 5273；真被占了 vite 会自己顺延，**实际端口**由 `configureServer`
 * 钩子读到并发布给 electron（见 plugins 里的说明）。
 */
function resolveDevPort(): number {
  const explicit = Number(process.env.RENDERER_PORT);
  if (Number.isFinite(explicit) && explicit > 0) {
    if (!isDevPortFree(explicit)) {
      throw new Error(
        `RENDERER_PORT=${explicit} 已被占用。请换一个：RENDERER_PORT=${pickFreePort(explicit + 1)} npm run dev`,
      );
    }
    return explicit;
  }
  return DEFAULT_DEV_PORT;
}
