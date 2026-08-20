import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// AETHER THEATER 设计稿字体（Inter + JetBrains Mono 已在 index.html 引入；
// 离线时回退系统字体栈）。
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
