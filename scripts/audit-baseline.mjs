#!/usr/bin/env node
/**
 * 以「打包客户端」为基准审计恢复树。
 *
 * 背景：本工程源码是从 2026-10-18 的打包客户端（H Bot 制造 / resources/app.asar）
 * 反推恢复的。打包产物里每个参与构建的模块都带一条 `//#region src/...` 注释，
 * 因此「产物的 region 集合」就是那次构建真正装进去的模块清单。
 *
 * 这个脚本回答三个问题：
 *   1) 产物里的每个模块，恢复树里都有吗？（缺一个就是真丢代码）
 *   2) 恢复树里哪些模块产物里没有？（= 更晚 revision 的增量，或旧 revision 的遗留）
 *   3) 那些「产物里没有」的模块，是**真的没进过构建**（连导出符号都搜不到），
 *      还是只是被内联/改名（符号在产物里出现）？
 *
 * 用法：
 *   node scripts/audit-baseline.mjs                    # 打印摘要 + 写 docs/restore/baseline-inventory.json
 *   node scripts/audit-baseline.mjs --check             # 只做 1)，有未登记的缺失就 exit 1
 *   node scripts/audit-baseline.mjs --bundle=D:/tmp/hbot-out --json=path
 *
 * 基准包默认优先用仓库内 _baseline/out-bundle（随仓库保管，不依赖 D:/tmp），
 * 找不到时回退到最初的提取位置 D:/tmp/hbot-out。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const DEFAULT_BUNDLE = (() => {
  const local = path.join(ROOT, "_baseline", "out-bundle");
  return fs.existsSync(local) ? local : "D:/tmp/hbot-out";
})();
const BUNDLE = path.resolve(args.get("bundle") ?? DEFAULT_BUNDLE);
const OUT = path.resolve(
  args.get("json") ?? path.join(ROOT, "docs/restore/baseline-inventory.json"),
);
const CHECK = args.get("check") === "true";

/**
 * region 有、树里没有的，必须在这里逐条说明为什么可以没有。
 * 只允许两类：①已裁决删除的重复实现（真源在别处）；②非模块（?raw 伪模块 / 改了扩展名）。
 */
const MISSING_OK = {
  "src/main/services/ops/metricsExport.ts":
    "扁平 src/main/services/metricsExport.ts 才是真源；嵌套这份是 10/18 移植副本，无任何 importer，已删除",
  "src/main/services/project/backupService.ts":
    "扁平 src/main/services/backupService.ts 才是真源（launchBackup 导入它）；嵌套副本无 importer，已删除",
  "src/main/services/project/dataTransferService.ts":
    "扁平 src/main/services/dataTransferService.ts 才是真源（ipc/launchTransfer 导入它）；嵌套副本无 importer，已删除",
  "src/shared/nodes/groups/dataConfig.ts":
    "内容是 renderer propertyDrawerConstants 的重复副本，且 shared 里反向 import renderer；全树 0 引用，已删除",
  "src/renderer/src/components/blocks/useEditorActions.tsx":
    "真身是 useEditorActions.ts（纯 hook、无 JSX，不需要 .tsx 扩展名）",
  "src/renderer/src/assets/node-authoring.md":
    "?raw 伪模块；真身 src/renderer/src/assets/node-authoring.md 已从同一产物提取并写回",
};

const REGION_RE = /\/\/#region\s+(src\/[^\r\n]+)/g;

function walk(dir, filter, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(e.name)) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

const jsFiles = walk(BUNDLE, (n) => n.endsWith(".js"));
let bundleBytes = 0;
const regions = new Set();
let blob = "";
for (const f of jsFiles) {
  const s = fs.readFileSync(f, "utf8");
  bundleBytes += Buffer.byteLength(s);
  blob += s;
  let m;
  REGION_RE.lastIndex = 0;
  while ((m = REGION_RE.exec(s))) regions.add(m[1].trim().split("?")[0]);
}

const treeFiles = walk(path.join(ROOT, "src"), (n) =>
  /\.(ts|tsx)$/.test(n),
).map(rel);
const treeSet = new Set(treeFiles);

const missing = [...regions]
  .filter((r) => !treeSet.has(r))
  .map((r) => ({ region: r, resolution: MISSING_OK[r] ?? null }));

const isDerived = (f) =>
  f.endsWith(".d.ts") ||
  f.includes("/__tests__/") ||
  /\.test\.tsx?$/.test(f) ||
  /\/types\//.test(f);

const delta = treeFiles.filter((f) => !regions.has(f) && !isDerived(f));

function exportedNames(src) {
  return [
    ...src.matchAll(
      /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((m) => m[1]);
}

const shippedBySymbol = [];
const unshipped = [];
for (const f of delta) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const names = exportedNames(src);
  if (!names.length) continue; // 纯类型 / 再导出：构建后本来就不留自己的模块名
  if (names.some((n) => blob.includes(n))) shippedBySymbol.push(f);
  else unshipped.push(f);
}

// 体量核对：region 里的代码量 vs 树里文件大小。
// 产物是编译后（类型已剥）的代码，正常应比源码短；反过来「树文件远小于 region」
// 就是截断或拆分了的信号（本树里三处都已人工确认：门面/拆分/数据内联）。
const regionChars = new Map();
for (const f of jsFiles) {
  const s = fs.readFileSync(f, "utf8");
  const re = /\/\/#region\s+(src\/[^\r\n]+)\n([\s\S]*?)(?=\/\/#endregion|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const key = m[1].trim().split("?")[0];
    if ((regionChars.get(key) ?? 0) < m[2].length)
      regionChars.set(key, m[2].length);
  }
}
const sizeOutliers = [];
for (const [f, region] of regionChars) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const tree = fs.statSync(abs).size;
  if (region > 1500 && tree < region * 0.7)
    sizeOutliers.push({
      file: f,
      regionChars: region,
      treeChars: tree,
      ratio: Number((tree / region).toFixed(2)),
    });
}
sizeOutliers.sort((a, b) => a.ratio - b.ratio);
const unregistered = missing.filter((m) => !m.resolution);
const payload = {
  generatedAt: new Date().toISOString(),
  baseline: {
    kind: "packaged-client",
    bundle: BUNDLE,
    jsFiles: jsFiles.length,
    bytes: bundleBytes,
    regions: regions.size,
  },
  tree: { files: treeFiles.length },
  missing: {
    total: missing.length,
    unregistered: unregistered.length,
    items: missing,
  },
  sizeOutliers,
  delta: {
    total: delta.length,
    symbolHit: shippedBySymbol.length,
    unshipped: unshipped.length,
    unshippedFiles: unshipped,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";
console.log(
  "[baseline] 打包产物: " +
    jsFiles.length +
    " 个 js / " +
    (bundleBytes / 1024 / 1024).toFixed(1) +
    " MB / " +
    regions.size +
    " 个模块 region",
);
console.log("[baseline] 恢复树: " + treeFiles.length + " 个 src/*.ts(x)");
console.log(
  "[baseline] 产物模块在树里的覆盖率: " +
    pct(regions.size - missing.length, regions.size) +
    "（缺 " +
    missing.length +
    "，其中未登记 " +
    unregistered.length +
    "）",
);
console.log(
  "[baseline] 树里产物没有 region 的模块: " +
    delta.length +
    "（导出符号能在产物里找到 " +
    shippedBySymbol.length +
    "，完全找不到 " +
    unshipped.length +
    "）",
);
if (unregistered.length) {
  console.error("[baseline] 未登记的缺失：");
  for (const m of unregistered) console.error("  - " + m.region);
}
console.log("[baseline] 体量异常（树文件 < region 的 70%）: " + sizeOutliers.length + " 个（报告里有逐条解释）");
console.log("[baseline] 明细写入 " + OUT);

if (CHECK && unregistered.length) process.exit(1);
