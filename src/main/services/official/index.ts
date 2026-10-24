// src/main/services/official/index.ts
//
// 官方适配器的**唯一门面** —— 2026-10 统一后只此一套实现。
//
// 历史：这里曾有两套（恢复期从 region 重放出的单文件 `services/official.ts`，
// 与本来就按职责拆开的 `services/official/*`）。产物里其实是拆开的那套；
// 两套并存导致各起一条 WS、状态与发送看到不同会话表 —— 单文件已删除，
// IPC 与节点校验都从这里取，解析能力按产物与测试取并集。
//
// 分层：client（会话/token/REST/事件）、config（项目 .qqbat/project.json 优先，
// 兼容旧 appData）、messages（消息体/流式/媒体/撤回）、media（分片上传）、
// ws（identify/resume/心跳/重连/关闭码）、validation 与 scene（纯函数）。

export {
  getOfficialStatus,
  onOfficialStatusChange,
  onOfficialMessage,
  testOfficialConnection,
} from "./client";
export { saveOfficialConfig, loadOfficialConfig } from "./config";
export {
  sendOfficialMessage,
  uploadOfficialFile,
  sendOfficialMedia,
  recallOfficialMessage,
} from "./messages";
export { startOfficial, stopOfficial } from "./ws";
export { validateStrategyGroups, validateWhitelistUsers, validateCallbackData } from "./validation";
