// src/main/ipc/crash.ts
// 已迁移到 crashReporter.ts
// @deprecated 此文件是遗留的兼容层，仅保留以避免破坏现有测试导入。
// 生产代码（register.ts）已直接导入 registerCrashReporterIpc。
// 当测试文件迁移到直接使用 registerCrashReporterIpc 后，可安全删除此文件。
export { registerCrashReporterIpc as registerCrashIpc } from './crashReporter'
