// src/renderer/src/components/blocks/iconMap.tsx
import {
  MessageSquare,
  UserPlus,
  Bell,
  Clock,
  Send,
  Undo2,
  GitBranch,
  Timer,
  Zap,
  RefreshCw,
  MousePointerClick,
  Sigma,
  Dice5,
  Type as TypeIcon,
  ListTree,
  Database,
  Save,
  Table as TableIcon,
  Search,
  User,
  Users,
  Split,
  GitMerge,
  Network,
  Terminal,
  Brain,
  Paperclip,
  FileText,
  Pencil,
  Hexagon,
  Braces,
  HelpCircle,
  Settings,
  Plug,
  Filter,
  ArrowRight,
  Info,
  Hash,
  Type,
  CheckCircle,
  Circle,
  Box,
  List as ListIcon,
  ScanSearch,
  Dna,
  Cloud,
  AlertTriangle,
  Repeat,
  Watch,
  ScrollText,
  LayoutDashboard,
  LogOut,
  LifeBuoy,
  Hourglass,
  Lock,
  Package,
  PackageOpen,
} from 'lucide-react';
// 注：AtSign / SendHorizonal 已随 on_at_me / send_to 节点删除而移除
import type { LucideIcon } from 'lucide-react';
import { hasKey, t } from '../../i18n';

/** nodeKind → lucide 图标映射（统一线条风格） */
const NODE_ICON_MAP: Record<string, LucideIcon> = {
  // 触发器
  message_received: MessageSquare,
  request_received: UserPlus,
  notice_received: Bell,
  button_clicked: MousePointerClick,
  scheduled: Clock,

  // 动作
  message_send: Send,
  message_recall: Undo2,
  message_edit: Pencil,
  api_call: Terminal,

  // 逻辑
  branch_if: GitBranch,
  delay: Timer,
  variable_set: Zap,
  loop: RefreshCw,
  try_catch: LifeBuoy,
  wait_input: Hourglass,

  // 数学/表达式
  expression_eval: Sigma,
  random: Dice5,

  // 文本
  format_text: TypeIcon,
  list_op: ListTree,

  // 持久化
  variable_persist: Database,

  // 时间
  time_op: Clock,

  // JSON 操作（统一节点）
  json_op: Braces,

  // 上下文
  get_context: User,

  // 逻辑
  branch_switch: Split,

  // 网络
  http_request: Network,

  // AI
  agent_chat: Brain,
  embedding: Dna,
  memory_add: Cloud,
  memory_search: Cloud,
  memory_clear: Cloud,
  memory_list: Cloud,

  // 群管（统一节点）
  group_op: Users,
  check_permission: Lock,

  // 构造消息段（不发送）
  message_op: Paperclip,

  // 文件操作（统一节点）
  file_operate: FileText,

  // 存储
  query: Search,
  database_write: Save,
  table_define: TableIcon,

  // 面板
  panel_register: LayoutDashboard,

  // 控制流
  loop_control: LogOut,
  error_op: AlertTriangle,
  parallel_exec: GitMerge,
  subflow_defined: Package,
  subflow_call: PackageOpen,

  // 正则提取
  regex_extract: ScanSearch,
  retry_exec: Repeat,
  timer: Watch,
  system_log: ScrollText,
};

/** 默认图标（未在映射中的节点） */
const DEFAULT_ICON = Hexagon;

/** 获取节点图标组件 */
export function getNodeIcon(nodeKind: string): LucideIcon {
  return NODE_ICON_MAP[nodeKind] ?? DEFAULT_ICON;
}

/** dataType → lucide 图标 + 颜色 + 标签 */
export interface DataTypeMeta {
  icon: LucideIcon;
  label: string;
  color: string;
}

/** dataType 的内部值 → i18n 键（display 按当前语言取，见 getDataTypeMeta） */
const DATA_TYPE_LABEL_KEY: Record<string, string> = {
  number: 'type.number',
  string: 'type.string',
  boolean: 'type.boolean',
  any: 'type.any',
  object: 'type.object',
  list: 'type.list',
};

const DATA_TYPE_META: Record<string, Omit<DataTypeMeta, 'label'>> = {
  number: { icon: Hash, color: 'text-blue-400' },
  string: { icon: Type, color: 'text-green-400' },
  boolean: { icon: CheckCircle, color: 'text-amber-400' },
  any: { icon: Circle, color: 'text-zinc-400' },
  object: { icon: Box, color: 'text-purple-400' },
  list: { icon: ListIcon, color: 'text-cyan-400' },
};

export function getDataTypeMeta(dataType: string | undefined): DataTypeMeta {
  const inner = DATA_TYPE_META[dataType ?? 'any'] ?? DATA_TYPE_META.any;
  const key = DATA_TYPE_LABEL_KEY[dataType ?? 'any'] ?? 'type.any';
  return { ...inner, label: hasKey(key) ? t(key) : t('type.any') };
}

/** Section 图标映射 */
export const SECTION_ICONS = {
  config: Settings,
  requiredInputs: Plug,
  optionalInputs: Filter,
  outputs: ArrowRight,
  info: Info,
} as const;

export { HelpCircle };
