// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

/**
* MCP（Model Context Protocol）服务端的对外端点。
*
* ## 为什么带产品前缀
*
* 2026-10-18 隔离审计 RT-41：原来用的是 `/sse` 与 `/messages` —— 这是 MCP 生态里
* 最常见的默认路径，同机再起一个 MCP server（或别的工具也监听这两个路径）就会撞。
* 我们的端口本身已经是专属段（43190），但**端口不重叠 ≠ 路径不冲突**：
* 用户完全可能把两个 server 挂到同一个反向代理/隧道后面。
*
* ⚠️ 这是**破坏性**改动：外部 IDE 里已经填了 `http://127.0.0.1:43190/sse` 的配置会失效，
* 需要改成 `/qqbat/sse`。2026-10-18 与维护者确认过：当前没有外部 MCP 客户端在用。
*/
/** SSE 建连端点（GET） */
var MCP_SSE_PATH = "/qqbat/sse";
/** 消息回传端点（POST，SSE transport 会把完整地址发给客户端） */
var MCP_MESSAGES_PATH = "/qqbat/messages";

export { MCP_SSE_PATH, MCP_MESSAGES_PATH };
