// src/renderer/src/main.tsx
// ⚠️ 必须排在所有 store / App 之前：storageKeys 在模块顶层做旧键迁移，
// 而 zustand persist 是在**模块导入时**就 rehydrate 的 —— 晚一步就是"布局偏好丢一次"。
import './lib/infra/storageKeys';
// 第 72 批：树内插件清单（含两个智能体窗口）。必须在 App 渲染前注册，
// 否则右侧面板首帧拿不到窗口、先白一帧。
import './plugins';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installFlowPersistence } from './stores/flowStore';
import './styles/globals.css';
import './styles/themes.css';
import '@xyflow/react/dist/style.css';

// 自动保存流程改动 + Ctrl+S（详见 flowStore 里的说明：以前只有点「生成代码」才落盘）
installFlowPersistence();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
