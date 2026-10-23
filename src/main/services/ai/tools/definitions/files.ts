// src/main/services/ai/tools/definitions/files.ts
//
// **这一族工具的声明**（2026-10-15 从 registry.ts 拆出来）。
//
// 为什么拆：registry.ts 一度约 1,300 行、超过 fileSize 闸门的 1,200 ——
// 闸门注释里作者自己留了作业：「拆的路径很清楚：把各域声明按域拆出去（已有
// registeredXxxDefinitions 的先例），dispatch 表本身保持一处」。这里就是照那条做的。
//
// 声明与实现分开放：声明是**给模型看的契约**（改文案要过 tool-description-contract 闸门），
// 实现是主进程的行为 —— 两者改动频率不同，混在一个文件里容易互相踩着。
import type { AiToolDefinition } from '@shared/types/ai';

/**
 * read_code / read_file：**同一份实现**，两个名字只是命名习惯（代码 vs 数据文件）。
 *
 * 路径一律经过 joinSafe —— 越界要**说清是越界**，不能静默读盘；不存在就说"不存在"，
 * 不要编一个空内容回去（模型会把空文件当成"项目里就是这么写的"）。
 */
export const READ_FILE_DEFS: AiToolDefinition[] = [
  {
    name: 'read_code',
    description:
      '读取项目内的文件内容（与 read_file 是**同一实现**：路径同样相对项目根目录、同样拒绝越界）。' +
      '区别只在命名习惯：代码文件用它，其余配置/数据文件用 read_file。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于项目根目录，如 plugins/weather/index.js）',
        },
      },
      required: ['path'],
    },
    category: 'query',
  },
  {
    name: 'read_file',
    description:
      '读取项目内的文件，path 相对项目根目录。' +
      '**不允许 .. 或项目外的绝对路径**（会被拒绝并说明是路径越界）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
      },
      required: ['path'],
    },
    category: 'query',
  },
];
export const FILE_DEFS: AiToolDefinition[] = [
  {
    name: 'write_code',
    description:
      '写入项目中的代码文件。自定义节点是一个**插件包**：plugins/<目录名>/{manifest.json, index.js}，' +
      '目录名自定（只有 ai- 前缀是 AI 生成的保留前缀）—— 别自己拼 custom-。' +
      '⚠️ **改流程不用重启**（`.qqbat/flow.json` 按 mtime 热重载），' +
      '但**改自定义节点的代码要重启机器人才生效**（用 run_bot）—— 节点 handler 是启动时装载的，' +
      '写完就告诉用户"重启后生效"，不要说"已经生效了"。',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径（相对项目根目录，如 plugins/weather/index.js）',
        },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['filePath', 'content'],
    },
    category: 'mutation',
  },
  {
    name: 'write_file',
    description:
      '写入项目内的文件（path 相对项目根目录，不允许路径穿越）。' +
      '**会整份覆盖** —— 只改其中一小段请先 read_file 拿到全文再改。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
    category: 'mutation',
  },
];
