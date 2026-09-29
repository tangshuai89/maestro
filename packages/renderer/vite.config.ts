import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    port: 5173,
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
