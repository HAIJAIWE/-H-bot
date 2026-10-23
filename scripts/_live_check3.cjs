const { app, safeStorage } = (() => { const m = require('electron'); return m.default ?? m; })();
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
try { app.setPath('userData', join(process.env.APPDATA, 'qqbat')); } catch {}
app.whenReady().then(() => {
  try {
    const cfg = JSON.parse(readFileSync(join(process.env.APPDATA, 'qqbat', 'ai-config.json'), 'utf8'));
    const key = cfg._encrypted ? safeStorage.decryptString(Buffer.from(cfg.apiKey, 'base64')) : cfg.apiKey;
    const node = process.env.npm_node_execpath || 'node';
    const r = spawnSync(node, ['node_modules/vitest/vitest.mjs', 'run', 'tests/main/services/ai/liveModel.e2e.test.ts', '-t', '小任务'], {
      cwd: process.cwd(),
      env: { ...process.env, QWEN_API_KEY: key, QWEN_BASE_URL: cfg.baseUrl, QWEN_MODEL: cfg.model },
      encoding: 'utf8', timeout: 300000,
    });
    const all = ((r.stdout || '') + (r.stderr || '')).split('\n');
    const budget = all.filter((l) => l.includes('系统提示') || l.includes('超过预算'));
    const verdict = all.filter((l) => l.includes('Tests ') || l.includes('✓ ★') || l.includes('× ★'));
    console.log('EXIT=' + r.status);
    console.log('BUDGET_WARNINGS=' + budget.length);
    console.log(budget.slice(-3).join('\n'));
    console.log(verdict.slice(-3).join('\n'));
  } catch (e) { console.log('ERR ' + e.message); } finally { app.quit(); }
});
