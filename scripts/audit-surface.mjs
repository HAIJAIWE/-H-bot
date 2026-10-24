// _recovery/audit-bundle-surface.mjs — 10/18 产物真暴露的 IPC 通道 / 节点 kind vs 恢复树
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = path.join(ROOT, '_baseline/out-bundle');

if (!fs.existsSync(BUNDLE_DIR)) {
  // 基准包不入库：没有它就没法对账，明确说一声而不是静默通过
  console.log('[surface] 缺少 _baseline/out-bundle/（10/18 打包产物，不入库）——跳过');
  process.exit(0);
}
// 命名空间取运行时真实暴露的 33 个（window.qqbat.*），避免把 node:fs / http:// 这类字面量算进来
const NS = ['adapter','ai','aiProvider','audit','backup','botManager','buttonPanel','capability','codegen','crash','customNode','data','dataTransfer','debug','diagnostics','docker','expression','file','flow','git','history','launchConfig','launchDashboard','launchData','metrics','official','panel','panelSync','plugin','project','resourceMonitor','runtime','ssh','stateStore','terminal'];
// 注意：translation 里也有 'ai.chat.copy' 这种键，但它们用 '.' 分隔；通道统一是 '<ns>:<动作>'
const CHANNEL_RE = new RegExp("['\"]((?:" + NS.join('|') + "):[A-Za-z0-9_:.-]{1,60})['\"]", 'g');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
function collect(text, re) {
  const set = new Set(); re.lastIndex = 0; let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return set;
}

const bundleFiles = walk(BUNDLE_DIR);
const bundleText = bundleFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const srcFiles = walk(path.join(ROOT, 'src'));
const srcText = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const bundleChannels = collect(bundleText, CHANNEL_RE);
const srcChannels = collect(srcText, CHANNEL_RE);
const missing = [...bundleChannels].filter((c) => !srcChannels.has(c)).sort();
const extra = [...srcChannels].filter((c) => !bundleChannels.has(c)).sort();

// 节点 kind：产物里会是 handler 注册表 / kind: 'xxx' 形状
const KIND_RE = /(?:kind\s*:\s*|registerHandler\s*\(\s*|getHandler\s*\(\s*|hasNodeHandler\s*\(\s*)['"]([a-z][a-z0-9_]{2,40})['"]/g;
const bundleKinds = collect(bundleText, KIND_RE);
const srcKinds = collect(srcText, KIND_RE);
const missingKinds = [...bundleKinds].filter((k) => !srcKinds.has(k)).sort();

// 已知且刻意不补的差异（改这里必须同步 docs/restore/baseline-alignment-2026-10-24.md 七之二）
const EXPECTED_MISSING_CHANNELS = new Set(['runtime:start','runtime:stop','runtime:restart','runtime:status','runtime:statusChange','runtime:statusChanged','runtime:sendCommand','runtime:listRunning']);
const EXPECTED_MISSING_KINDS = new Set(['greet']); // 只出现在产物里的插件节点写法文档正文

const unexpectedChannels = missing.filter((c) => !EXPECTED_MISSING_CHANNELS.has(c));
const unexpectedKinds = missingKinds.filter((k) => !EXPECTED_MISSING_KINDS.has(k));

const report = {
  bundleFiles: bundleFiles.length,
  srcFiles: srcFiles.length,
  bundleChannels: bundleChannels.size,
  srcChannels: srcChannels.size,
  missingChannelCount: missing.length,
  missingChannels: missing,
  unexpectedChannels,
  extraChannelCount: extra.length,
  extraChannels: extra,
  bundleKinds: bundleKinds.size,
  srcKinds: srcKinds.size,
  missingKindCount: missingKinds.length,
  missingKinds,
  unexpectedKinds,
  ok: unexpectedChannels.length === 0 && unexpectedKinds.length === 0,
};
fs.writeFileSync(path.join(ROOT, '_recovery/bundle-surface-diff.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, missingChannels: undefined, extraChannels: undefined, missingKinds: undefined }, null, 2));
console.log('missingChannels:', JSON.stringify(missing));
console.log('missingKinds:', JSON.stringify(missingKinds));
console.log('unexpected:', JSON.stringify({ unexpectedChannels, unexpectedKinds }));
if (unexpectedChannels.length || unexpectedKinds.length) process.exitCode = 2;
console.log('extraChannels(sample):', JSON.stringify(extra.slice(0, 25)));