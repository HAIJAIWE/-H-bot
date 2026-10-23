import { useState, useMemo } from 'react';
import { Search, Plus, Package, ChevronRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { inputForm } from '../ui/inputStyles';
import { useFlowStore } from '../../stores/flowStore';
import { useI18nStore } from '../../stores/i18nStore';
import { SUBFLOW_TEMPLATES, type SubflowTemplate } from '../../lib/command/subflowTemplates';
import { getAllSpecsWithDeprecated } from '../../lib/node/nodeCatalog';
import { t } from '../../i18n';

/** 分类键。除 'all' 外都是 SubflowTemplate['category'] 的**数据值**（中文常量联合类型），
 *  参与过滤判断，不能翻译；显示走 CATEGORY_LABEL。
 *  顺带修掉一个英文模式下的老 bug：原来这里放的是 '全部'，而判断写的是
 *  `cat === t('editor.filter.all')` —— 切英文后 t() 返回 "All"，永远不等，
 *  「全部」这一项的数量与选中态都会算错。 */
const CATEGORIES = ['all', '数据读写', '消息回复', '流程控制', '游戏逻辑', '时间工具'] as const;

/** 分类键 → 当前语言标签。用函数而不是模块级常量，避免把语言冻在 import 时刻。 */
const CATEGORY_LABEL: Record<string, () => string> = {
  all: () => t('editor.filter.all'),
  数据读写: () => t('blocks.editor.wizard.dataReadWrite'),
  消息回复: () => t('blocks.editor.wizard.messageReply'),
  流程控制: () => t('blocks.templates.group.flow'),
  游戏逻辑: () => t('blocks.templates.group.game'),
  时间工具: () => t('blocks.templates.group.time'),
};

/** kind → 标签映射（从**当前语言**目录构建；语言切换时靠 locale 依赖重建） */
function buildKindLabels(): Record<string, string> {
  // 用**全量**集：老流程里可能还有已弃用节点，标签映射必须查得到（否则显示成 kind 字符串）
  return Object.fromEntries(getAllSpecsWithDeprecated().map((n) => [n.kind, n.label]));
}

export function TemplateLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const { success } = useToast();
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  // 订阅 locale：目录文案是"按当前语言现取"的，必须靠它触发重渲染才能切语言即时生效
  const locale = useI18nStore((s) => s.locale);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildKindLabels() 内部按当前语言取目录，locale 是它的隐含依赖，eslint 看不出来
  const kindLabels = useMemo(() => buildKindLabels(), [locale]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return SUBFLOW_TEMPLATES.filter((tpl) => {
      if (activeCategory !== 'all' && tpl.category !== activeCategory) return false;
      if (!kw) return true;
      return tpl.name.toLowerCase().includes(kw) || tpl.description.toLowerCase().includes(kw);
    });
  }, [search, activeCategory]);

  const handleInsert = (tpl: SubflowTemplate) => {
    useFlowStore.getState().insertTemplate(tpl, selectedNodeId ?? undefined);
    if (selectedNodeId) {
      success(t('blocks.templates.insertedLinked', { name: tpl.name }));
    } else {
      success(t('blocks.templates.insertedManual', { name: tpl.name }));
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('blocks.templates.title')} width="800px">
      {/* 顶部搜索框 */}
      <div className="mb-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('blocks.templates.searchPlaceholder')}
            className={`w-full pl-9 pr-3 ${inputForm} placeholder-zinc-500`}
          />
        </div>
      </div>

      <div className="flex gap-4" style={{ minHeight: '400px' }}>
        {/* 左侧分类列表 */}
        <div className="w-40 shrink-0 space-y-1">
          {CATEGORIES.map((cat) => {
            const count =
              cat === 'all'
                ? SUBFLOW_TEMPLATES.length
                : SUBFLOW_TEMPLATES.filter((tpl) => tpl.category === cat).length;
            return (
              <Button
                key={cat}
                variant="ghost"
                size="sm"
                onClick={() => setActiveCategory(cat)}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span>{CATEGORY_LABEL[cat]()}</span>
                  <span className="text-zinc-500">{count}</span>
                </span>
              </Button>
            );
          })}
        </div>

        {/* 右侧片段卡片列表 */}
        <div className="flex-1 min-w-0 space-y-3 overflow-y-auto" style={{ maxHeight: '460px' }}>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Package aria-hidden="true" className="w-8 h-8 mb-2 opacity-40" />
              <span className="text-sm">{t('blocks.templates.empty')}</span>
            </div>
          )}
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-zinc-800/80 border border-zinc-700 rounded-lg p-4 hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-zinc-200">{tpl.name}</h3>
                    <span className="text-xs text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded shrink-0">
                      {tpl.category}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">{tpl.description}</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleInsert(tpl)}
                  className="shrink-0 px-2.5 py-1.5"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  {t('common.insert')}
                </Button>
              </div>

              {/* 使用说明 */}
              <div className="flex items-start gap-1.5 mt-2 pt-2 border-t border-zinc-700/50">
                <span className="text-xs text-zinc-500 shrink-0">
                  {t('blocks.templates.tipLabel')}
                </span>
                <span className="text-xs text-zinc-500 leading-relaxed">{tpl.usageHint}</span>
              </div>

              {/* 节点流程预览 */}
              <div className="flex items-center gap-1 flex-wrap text-xs text-zinc-500 mt-1">
                {tpl.nodes.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight aria-hidden="true" className="w-3 h-3 text-zinc-600" />}
                    <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">
                      {n.label || kindLabels[n.kind] || n.kind}
                    </span>
                  </span>
                ))}
              </div>

              {/* 元信息 */}
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                <span>{t('blocks.wizard.autoCreateNodes', { count: tpl.nodes.length })}</span>
                <span>{t('blocks.wizard.autoCreateEdges', { count: tpl.edges.length })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
