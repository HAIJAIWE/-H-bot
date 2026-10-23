// src/shared/types/template.ts
import type { FlowNode, FlowEdge } from './flow'

export type TemplateCategory = '入群' | '定时' | '指令' | '消息' | '管理' | '教学' | '其他'

export interface FlowTemplate {
  id: string
  name: string
  description: string
  botCategory: 'functional' | 'game'
  category: TemplateCategory
  tags: string[]
  author: string
  thumbnail?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  createdAt: string
  version: string
}

/** 导出/导入文件格式 */
export interface TemplateExportFile {
  type: 'qqbat-template'
  version: '1.0'
  template: Omit<FlowTemplate, 'id' | 'createdAt' | 'thumbnail'>
}

export const TEMPLATE_DIR = '.qqbat/templates'
export const TEMPLATE_EXPORT_EXT = '.qqbat-template.json'
