// src/main/services/portFinder.ts
//
// 向后兼容入口：实现（含"必须监听 127.0.0.1 且用 error 事件判定占用"的坑）
// 在 `runner/portFinder`。这里只把恢复时被重命名的 `findFreePort$1` 改回本名。
export { findFreePort$1 as findFreePort, isPortFree } from './runner/portFinder';
