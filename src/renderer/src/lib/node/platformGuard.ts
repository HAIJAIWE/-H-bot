// src/renderer/src/lib/node/platformGuard.ts
//
// 添加节点前的平台守卫（第 65 批）。
//
// 节点库已经按平台过滤（第 64 批），但「已过滤」不等于「加不进来」：命令面板、
// 拖放、AI 生成、旧项目导入都可能绕过节点库。这个守卫在真正 `createNode` 之前
// 给出**一句人话**，调用方负责 toast。
//
// 口径与 `@shared/nodes/platformCheck` 同一套（节点标注 → 平台族 → 和项目比），
// 区别只在文案：这里的文案是界面 i18n，那里的是校验面板/日志。
import {
  nodePlatformTags,
  platformLabel,
  projectPlatformFamily,
  specVisibleOnPlatform,
} from '@shared/domain/platform/registry'
import type { NodeSpec } from '@shared/types/flow'
import { useProjectStore } from '../../stores/projectStore'
import { useI18nStore } from '../../stores/i18nStore'
import { t } from '../../i18n'

/** 守卫需要的节点字段（目录里找不到 spec 时调用方直接跳过） */
type GuardSpec = Pick<NodeSpec, 'kind' | 'label' | 'platform' | 'tags'>

/**
 * 节点在当前项目里加不进来的原因；能加返回 `null`。
 *
 * 规则：项目没绑平台时只允许通用节点（与节点库可见性一致）；通用节点永远可加。
 */
export function nodePlatformBlockReason(spec: GuardSpec | null | undefined): string | null {
  if (!spec) return null
  const project = useProjectStore.getState().currentProject
  const family = projectPlatformFamily(project)
  if (specVisibleOnPlatform(spec, family ?? null)) return null
  const locale = useI18nStore.getState().locale
  const platforms = nodePlatformTags(spec)
    .map(f => platformLabel(f, locale))
    .join(' / ')
  return t('palette.platformMismatch', { node: spec.label, platform: platforms })
}
