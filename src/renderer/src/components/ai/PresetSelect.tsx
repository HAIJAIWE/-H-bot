// src/renderer/src/components/ai/PresetSelect.tsx
//
// **会话预设选择器**（2026-10-19，从 ChatPanel 抽出）。
//
// 职责只有两件：读项目里的 `.qqbat/agent-presets.json`（取 id / 名字 / 角色）→ 渲染成下拉。
// 选中的预设 id 随 `ai:agentCoreRun` 的 `preset` 字段进主进程；工具白名单 / 插件集 /
// 权限模式 / 角色都由主进程解析 —— 渲染层不做权限判断，它只负责"用户选了哪个"。
//
// 2026-10-20（预设化）：预设与角色合并成一套 id。下拉里只列**自定义**预设 ——
// 预置预设（builder/coder/duo/creator）就是上面那排角色按钮，列两遍等于让用户
// 在两个地方选同一件事。自定义预设可以声明 role：选它时角色按钮会跟着高亮。
//
// 为什么抽出来：ChatPanel 只该负责对话流与输入区；预设列表的读取 + 下拉是一个
// 自包含的小块，混在面板里既难读，也让面板继续变长（fileSize 闸门盯着它）。
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import type { AgentRole } from '@shared/ai/roleDomains';

/** 预设文件名（与主进程 services/ai/presets.ts 的 PRESETS_FILE 是同一份磁盘契约） */
const PRESETS_FILE = '.qqbat/agent-presets.json';

export interface PresetMeta {
  permissionMode?: 'ask' | 'full';
  /** 这个预设以哪个角色为底（未声明 = 角色跟着页面走） */
  role?: AgentRole;
}

/** 下拉里一项（value 是 id：会话存的就是它，名字只用来显示） */
export interface PresetOption {
  id: string;
  name: string;
}

/**
 * 把 `.qqbat/agent-presets.json` 的解析结果归一成"选项 + 元信息"。
 *
 * 抽成纯函数是因为这段规则**有三条容易写错**，而它们与界面无关：
 *   · id 缺省 = 名字（早期文件只有 name，与主进程 normalizeId 同一条规则）；
 *   · 同一 id 只留第一条（主进程也按 id 去重，界面不该列出两个一样的）；
 *   · 未知的 role / permissionMode 丢掉那一项，**不连坐整条预设**。
 */
export function parsePresetOptions(data: unknown): {
  options: PresetOption[];
  meta: Record<string, PresetMeta>;
} {
  const meta: Record<string, PresetMeta> = {};
  const options: PresetOption[] = [];
  if (!Array.isArray(data)) return { options, meta };
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const m = item as { id?: unknown; name?: unknown; permissionMode?: unknown; role?: unknown };
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (!name) continue;
    const id = typeof m.id === 'string' && m.id.trim() ? m.id.trim() : name;
    if (meta[id]) continue;
    options.push({ id, name });
    meta[id] = {
      ...(m.permissionMode === 'full' || m.permissionMode === 'ask'
        ? { permissionMode: m.permissionMode }
        : {}),
      ...(m.role === 'builder' || m.role === 'coder' || m.role === 'duo' || m.role === 'creator'
        ? { role: m.role }
        : {}),
    };
  }
  return { options, meta };
}

export function PresetSelect({
  projectPath,
  value,
  onChange,
  onResolve,
  reloadKey,
  disabled,
}: {
  /** 当前项目路径；没有项目 / 读不到文件时下拉整块不出现 */
  projectPath: string | undefined;
  /** 选中的预设名；null = 不限制工具（不带 preset） */
  value: string | null;
  /** 选中变化：空串（"不限制"）归一成 null，与 store 的语义一致 */
  onChange: (name: string | null) => void;
  /** 当前选中预设的元信息（权限模式等）：界面据此显示"预设授予完全权限"，不做权限判断 */
  onResolve?: (meta: PresetMeta | null) => void;
  /** 变更计数：编辑保存后 +1，触发重新读盘（文件是唯一真源，不缓存目录） */
  reloadKey?: number;
  disabled?: boolean;
}): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  /** 预设列表（读不到 = 空 → 不渲染下拉） */
  const [options, setOptions] = useState<PresetOption[]>([]);
  /** 名字 → 元信息（权限模式）；读不到就空表 */
  const [metaByName, setMetaByName] = useState<Record<string, PresetMeta>>({});
  useEffect(() => {
    if (!projectPath) {
      setOptions([]);
      return;
    }
    void (async () => {
      try {
        const res = await window.qqbat.file.read(projectPath, PRESETS_FILE);
        if (!res.ok || typeof res.data !== 'string') {
          setOptions([]);
          return;
        }
        const parsed = parsePresetOptions(JSON.parse(res.data));
        setOptions(parsed.options);
        setMetaByName(parsed.meta);
      } catch {
        setOptions([]);
      }
    })();
  }, [projectPath, reloadKey]);
  // 把"选中项的元信息"报给调用方（界面显示用；主进程仍会自己解析，不依赖这里）
  useEffect(() => {
    onResolve?.(value ? (metaByName[value] ?? null) : null);
  }, [value, metaByName, onResolve]);
  // 没有任何预设时整块不出现（与抽离前一致）：空下拉只会让用户以为功能坏了
  if (options.length === 0) return null;
  return (
    <select
      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
      value={value ?? ''}
      disabled={disabled}
      aria-label={t('ai.agentCore.presetTitle')}
      title={t('ai.agentCore.presetTitle')}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t('ai.agentCore.presetNone')}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
