import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Monster Beats 设计稿字体（Fredoka 圆润卡通，@fontsource 本地打包离线可用）。
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './styles/main.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
