import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ButtonSmoke } from './components/__sandbox/ButtonSmoke';
// AETHER THEATER 设计稿字体（Inter + JetBrains Mono 已在 index.html 引入；
// 离线时回退系统字体栈）。
import './styles/main.scss';

// shadcn 视觉基线入口：`?smoke=1` 时 main.tsx 直接挂 ButtonSmoke 替代 App。
// 不进 production 路由（?smoke 是 query，App.tsx 不读它），不影响产品 UI。
// 详见 specs/shadcn-migration/spec.md commit 6。
const isSmoke = window.location.search.includes('smoke=1');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isSmoke ? <ButtonSmoke /> : <App />}
  </React.StrictMode>,
);
