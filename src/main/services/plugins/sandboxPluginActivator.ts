// src/main/services/plugins/sandboxPluginActivator.ts
//
// **在沙箱里激活 AI 插件**（2026-10-19）：插件导出 `activate(api)`。
//   api.contributeTool / contributePrompt  → 经 __qqbatHostCall 报给宿主（贡献的是**描述**）
//   api.handleTool(name, fn)               → 函数留在沙箱（函数过不了桥），宿主调用时由
//                                            sandbox 的 inbound 派发到这张表，结果经桥回传
//   api.getSetting(key) / getSettings()    → 问宿主要用户设置（2026-10-25）：桥返回的是
//                                            JSON 信封 {ok,value}，这里解包，失败按 null/{} 兜底
// 这条路径是"代理工具 + 沙箱派发"的完整闭环：缺任何一段都会表现为"activate 跑了但没反应"。
import { runInContext, type Context } from 'node:vm';

export function activateSandboxPlugin(
  ctx: Context,
  moduleSource: string,
  opts: { filename: string; timeoutMs?: number },
): void {
  const src = [
    '(function () {',
    '  "use strict";',
    '  var module = { exports: {} };',
    '  var exports = module.exports;',
    moduleSource,
    '  var activate = module.exports && module.exports.activate;',
    '  if (typeof activate !== "function") throw new Error("sandbox plugin must export activate(api)");',
    '  function callHost(action, payload) {',
    '    return __qqbatHostCall(JSON.stringify({ kind: "aiPlugin", action: action, payload: payload }));',
    '  }',
    '  var api = {',
    '    contributeTool: function (p) { return callHost("contributeTool", p); },',
    '    contributePrompt: function (p) { return callHost("contributePrompt", p); },',
    '    handleTool: function (name, fn) {',
    '      if (typeof fn !== "function") throw new Error("handleTool requires a function");',
    '      __qqbatAiHandlers[String(name)] = fn;',
    '    },',
    '    getSetting: function (key) {',
    '      var env = JSON.parse(callHost("getSetting", { key: String(key) }) || "{}");',
    '      return env && env.ok ? env.value : null;',
    '    },',
    '    getSettings: function () {',
    '      var env = JSON.parse(callHost("getSettings", {}) || "{}");',
    '      return env && env.ok && env.value ? env.value : {};',
    '    },',
    '  };',
    '  activate(api);',
    '})();',
  ].join('\n');
  runInContext(src, ctx, { filename: opts.filename, timeout: opts.timeoutMs ?? 5_000 });
}
