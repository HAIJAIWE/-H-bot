// src/renderer/src/lib/monacoSetup.ts
// Monaco 本地化加载：配置 @monaco-editor/react 使用 npm 包内的 monaco 实例，
// 避免默认从 CDN（jsdelivr）拉取导致的网络依赖、初始化失败与 console.error。
//
// 注意：本模块的顶层配置（MonacoEnvironment + loader.config）必须在
// @monaco-editor/react 的 <Editor> 组件挂载（内部调用 loader.init()）之前生效，
// 因此配置放在模块顶层；本模块只会被代码面板的懒加载 chunk 引入。
import { loader } from '@monaco-editor/react';
import * as monacoApi from 'monaco-editor/editor/editor.api';
// 单一入口注册全部 monarch 基础语言（TypeScript / JSON / Markdown 等）
import 'monaco-editor/basic-languages/monaco.contribution';
// Monaco 文本处理 worker（Vite worker 导入语法）
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

// editor.api 是 monaco-editor 全量入口的类型子集，运行时结构兼容；
// 对外统一以全量命名空间类型，避免调用方改动类型。
export type MonacoApi = typeof import('monaco-editor');
(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

loader.config({ monaco: monacoApi as unknown as MonacoApi });

let initPromise: Promise<MonacoApi> | null = null;

/** 幂等初始化：返回初始化完成的 monaco 命名空间（供补全注册等使用） */
export function ensureMonacoInit(): Promise<MonacoApi> {
  if (!initPromise) {
    initPromise = loader.init().then(() => monacoApi as unknown as MonacoApi);
  }
  return initPromise;
}
