#!/usr/bin/env node
// scripts/export-agent-framework.mjs
//
// 把智能体框架从本仓库导出到另一个项目（见 docs/ai/agent-framework-porting.md）。
// 只复制"框架层"，不复制业务模块（bot/流程/画布）。用法：
//   node scripts/export-agent-framework.mjs <targetDir> [--force]
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 框架层清单（路径相对仓库根；以 / 结尾表示整个目录） */
const ENTRIES = [
  // L0 共享契约
  'src/shared/ai/',
  'src/shared/plugins/',
  'src/shared/types/ai.ts',
  'src/shared/types/llm-presets.ts',
  'src/shared/types/proposal.ts',
  'src/shared/types/tool.ts',
  // L1 智能体循环
  'src/main/services/agent-core/',
  // L2 AI 服务
  'src/main/services/ai/',
  // L3 插件宿主
  'src/main/services/plugins/',
  // L4 IPC 桥（只拿 AI/插件相关）
  'src/main/ipc/ai.ts',
  'src/main/ipc/aiAgentCore.ts',
  'src/main/ipc/aiAllowRules.ts',
  'src/main/ipc/aiProvider.ts',
  'src/main/ipc/plugins.ts',
  'src/main/ipc/_shared.ts',
  'src/main/schemas/ai.ts',
  'src/main/schemas/aiProvider.ts',
  'src/main/schemas/plugins.ts',
  // L6 测试（框架契约，不含本仓库体积闸门）
  'tests/main/services/agent-core/',
  'tests/main/services/plugins/',
  'tests/shared/',
];

const args = process.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith('--'));
const force = args.includes('--force');
if (!targetArg) {
  console.error('用法: node scripts/export-agent-framework.mjs <targetDir> [--force]');
  process.exit(2);
}
const target = resolve(process.cwd(), targetArg);
try {
  await stat(target);
  const existing = await readdir(target);
  if (existing.length > 0 && !force) {
    console.error('目标目录非空；确认要覆盖请加 --force');
    process.exit(2);
  }
} catch {
  await mkdir(target, { recursive: true });
}

const copied = [];
const missing = [];
for (const entry of ENTRIES) {
  const from = join(ROOT, entry);
  const to = join(target, entry);
  try {
    const s = await stat(from);
    await mkdir(dirname(to), { recursive: true });
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: s.isDirectory() });
    copied.push(entry);
  } catch {
    missing.push(entry);
  }
}

/** 粗粒度依赖扫描：给每个入口文件标注 "外部依赖未搬运" 的线索 */
const EXTERNAL_HINTS = [
  ['electron', 'Electron 主进程 API（ipcMain/dialog/BrowserWindow）'],
  ['@renderer/', '渲染层别名：新项目需配置或改相对路径'],
  ['useProjectStore', '项目 store：需要新项目提供同等状态'],
  ['window.qqbat', 'preload 桥：需要按新命名空间重写 IPC'],
  ['tailwind', 'Tailwind 类名：需要目标项目有对应主题变量'],
];
const hints = new Set();
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'out'].includes(e.name)) continue;
      await walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      const text = await readFile(p, 'utf-8');
      for (const [pat, hint] of EXTERNAL_HINTS) if (text.includes(pat)) hints.add(hint);
    }
  }
}
await walk(target);
const manifest = [
  '# 智能体框架导出清单',
  '',
  '来源：qqbat 智能体框架（docs/ai/agent-framework-porting.md）',
  '',
  '## 已复制',
  ...copied.map((c) => '- ' + c + ''),
  '',
  missing.length ? '## 源仓库里不存在（跳过）\n' + missing.map((m) => '- ' + m).join('\n') : '',
  '',
  '## 检测到的外部依赖（需要在新项目里补）',
  ...[...hints].map((h) => '- ' + h),
  '',
  '## 下一步',
  '1. 配 tsconfig/vite 别名 @shared/* @main/* @renderer/*；',
  '2. 换 IPC 命名空间并补 preload 桥；',
  '3. 换数据目录（原 .qqbat/）；',
  '4. 先跑 tests/main/services/agent-core 与 tests/shared 验证内核；',
  '5. 业务模块（bot/流程/画布）**没有**复制 —— 按新项目需要自己实现。',
  '',
].join('\n');
await writeFile(join(target, 'MANIFEST.md'), manifest, 'utf-8');
console.log('已复制 ' + copied.length + ' 项到 ' + target);
if (missing.length) console.log('跳过（不存在）: ' + missing.join(', '));
console.log('清单: ' + relative(process.cwd(), join(target, 'MANIFEST.md')));
