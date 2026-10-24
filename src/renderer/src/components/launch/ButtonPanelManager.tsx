// src/renderer/src/components/launch/ButtonPanelManager.tsx
import { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { ButtonPanel } from '@shared/types/buttonPanel';
import type { InlineKeyboard } from '@shared/types/keyboard';
import { createEmptyKeyboard } from '@shared/types/keyboard';
import { KeyboardEditor } from '../blocks/KeyboardEditor';
import { Modal, ModalFooter } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { LayoutTemplate, Plus, Trash2, Copy, Pencil, AlertTriangle, Download } from 'lucide-react';
import { t } from '../../i18n';
import { useI18nStore, useLocaleSubscription } from '../../stores/i18nStore';

interface PanelForm {
  name: string;
  description: string;
  markdown: string;
  keyboard: InlineKeyboard;
}

const EMPTY_FORM: PanelForm = {
  name: '',
  description: '',
  markdown: '',
  keyboard: createEmptyKeyboard(),
};

export function ButtonPanelManager() {
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const locale = useI18nStore((s) => s.locale);
  const toast = useToast();
  const [panels, setPanels] = useState<ButtonPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [form, setForm] = useState<PanelForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ButtonPanel | null>(null);
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const [builtinList, setBuiltinList] = useState<
    Array<{ templateId: string; name: string; description: string; buttonCount: number }>
  >([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const res = await window.qqbat.buttonPanel.list(projectPath);
      if (res.ok && res.data) {
        setPanels(res.data);
      } else {
        setError(res.error || t('launch.common.loadFailed'));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selected = panels.find((p) => p.id === selectedId) ?? null;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditorMode('create');
    setEditorOpen(true);
  };

  const openEdit = (panel: ButtonPanel) => {
    // 防御 keyboard 缺失场景：JSON.parse(JSON.stringify(undefined)) 会抛 SyntaxError
    let keyboardCopy: typeof panel.keyboard;
    try {
      keyboardCopy = panel.keyboard ? JSON.parse(JSON.stringify(panel.keyboard)) : { rows: [] };
    } catch {
      keyboardCopy = { rows: [] };
    }
    setForm({
      name: panel.name,
      description: panel.description,
      markdown: '',
      keyboard: keyboardCopy,
    });
    setEditorMode('edit');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!projectPath) return;
    if (!form.name.trim()) {
      toast.warning(t('launch.panel.nameRequired'));
      return;
    }
    if (editorMode === 'create') {
      const res = await window.qqbat.buttonPanel.create(projectPath, {
        name: form.name,
        description: form.description,
        keyboard: form.keyboard,
      });
      if (res.ok && res.data) {
        await reload();
        setSelectedId(res.data.id);
        setEditorOpen(false);
        toast.success(t('launch.panel.created'));
      } else {
        toast.error(res.error || t('launch.common.createFailed'));
      }
    } else {
      if (!selected) return;
      const res = await window.qqbat.buttonPanel.update(projectPath, {
        panelId: selected.id,
        patch: {
          name: form.name,
          description: form.description,
          keyboard: form.keyboard,
        },
      });
      if (res.ok && res.data) {
        await reload();
        setEditorOpen(false);
        toast.success(t('launch.panel.saved'));
      } else {
        toast.error(res.error || t('launch.common.saveFailed'));
      }
    }
  };

  const handleDuplicate = async (panel: ButtonPanel) => {
    if (!projectPath) return;
    const res = await window.qqbat.buttonPanel.duplicate(projectPath, panel.id);
    if (res.ok && res.data) {
      await reload();
      toast.success(t('launch.panel.copied', { name: panel.name }));
    } else {
      toast.error(res.error || t('launch.common.copyFailed'));
    }
  };

  const handleDelete = async () => {
    if (!projectPath || !deleteTarget) return;
    const res = await window.qqbat.buttonPanel.delete(projectPath, deleteTarget.id);
    if (res.ok) {
      if (selectedId === deleteTarget.id) setSelectedId('');
      setDeleteTarget(null);
      await reload();
      toast.success(t('launch.panel.deleted'));
    } else {
      toast.error(res.error || t('launch.common.deleteFailed'));
    }
  };

  /** 统计按钮数量 */
  const countButtons = (kb: InlineKeyboard | undefined): number => {
    if (!kb?.rows) return 0;
    return kb.rows.reduce((acc, r) => acc + (r?.buttons?.length ?? 0), 0);
  };

  return (
    <div className="@container flex h-full flex-col @2xl:flex-row">
      {/* 左侧：面板列表。容器窄时改成上下堆叠 —— 否则右侧详情会被挤成一条竖排文字。 */}
      <div className="w-full @2xl:w-72 border-b @2xl:border-b-0 @2xl:border-r border-zinc-800 flex flex-col shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <LayoutTemplate className="w-4 h-4 text-zinc-400" />
            <span className="text-sm text-zinc-200 font-medium">{t('launch.panel.library')}</span>
            <span className="text-xs text-zinc-500">({panels.length})</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              onClick={openCreate}
              title={t('launch.panel.newPanel')}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              {t('launch.common.create')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              onClick={async () => {
                const res = await window.qqbat.buttonPanel.listBuiltin();
                if (res.ok && res.data) {
                  setBuiltinList(res.data);
                  setSelectedTemplates(new Set(res.data.map((t) => t.templateId)));
                  setBuiltinOpen(true);
                } else {
                  toast.error(res.error || t('launch.panel.loadBuiltinFailed'));
                }
              }}
              title={t('launch.panel.importBuiltinTitle')}
              leftIcon={<Download className="w-3.5 h-3.5" />}
            >
              {t('launch.panel.importBuiltin')}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto @2xl:max-h-none max-h-64">
          {loading ? (
            <div className="flex items-center justify-center h-24 gap-2">
              <Spinner size="sm" />
              <span className="text-xs text-zinc-500">{t('launch.common.loading')}</span>
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-xs text-red-400 mb-3">{error}</p>
              <Button variant="secondary" size="sm" onClick={reload}>
                {t('launch.common.retry')}
              </Button>
            </div>
          ) : panels.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('launch.common.noPanels')}
                description={t('launch.panel.emptyHint')}
                action={
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    {t('launch.panel.newPanel')}
                  </Button>
                }
              />
            </div>
          ) : (
            panels.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                size="md"
                onClick={() => setSelectedId(p.id)}
                className={`w-full justify-start text-left px-3 py-2.5 border-b border-zinc-800/50 transition ${
                  selectedId === p.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedId === p.id ? 'bg-blue-500' : 'bg-zinc-600'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-200 truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-zinc-500 truncate">{p.description}</div>
                    )}
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {t('launch.panel.buttonCount', { count: String(countButtons(p.keyboard)) })} ·{' '}
                      {new Date(p.updatedAt).toLocaleDateString(locale)}
                    </div>
                  </div>
                </div>
              </Button>
            ))
          )}
        </div>
      </div>

      {/* 右侧：面板详情 */}
      <div className="flex-1 overflow-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title={t('launch.panel.selectPanel')}
              description={t('launch.panel.selectHint')}
            />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* 头部：名称 + 操作 */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-zinc-100">{selected.name}</h2>
                {selected.description && (
                  <p className="text-xs text-zinc-500 mt-1">{selected.description}</p>
                )}
                <div className="text-xs text-zinc-500 mt-1">
                  ID: <code className="font-mono">{selected.id}</code>
                  {' · '}
                  {t('launch.panel.createdAt', {
                    time: new Date(selected.createdAt).toLocaleString(locale),
                  })}
                  {' · '}
                  {t('launch.panel.updatedAt', {
                    time: new Date(selected.updatedAt).toLocaleString(locale),
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  className="border border-zinc-700"
                  onClick={() => openEdit(selected)}
                  title={t('launch.panel.editPanel')}
                  leftIcon={<Pencil className="w-3.5 h-3.5" />}
                >
                  {t('launch.common.edit')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="border border-zinc-700"
                  onClick={() => handleDuplicate(selected)}
                  title={t('launch.panel.copyPanel')}
                  leftIcon={<Copy className="w-3.5 h-3.5" />}
                >
                  {t('launch.common.copy')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget(selected)}
                  title={t('launch.common.deletePanel')}
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  {t('launch.common.delete')}
                </Button>
              </div>
            </div>

            {/* 按钮预览（只读） */}
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-400 mb-2">{t('launch.panel.previewHint')}</div>
              <KeyboardPreview keyboard={selected.keyboard} />
            </div>
          </div>
        )}
      </div>

      {/* 编辑/创建 Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={
          editorMode === 'create'
            ? t('launch.panel.newPanelTitle')
            : t('launch.panel.editPanelWithName', { name: selected?.name ?? '' })
        }
        width="720px"
        footer={
          <ModalFooter
            onCancel={() => setEditorOpen(false)}
            onConfirm={handleSave}
            confirmText={
              editorMode === 'create'
                ? t('launch.common.confirmCreate')
                : t('launch.common.confirmSave')
            }
          />
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {t('launch.panel.nameLabel')}
            </label>
            <input
              type="text"
              value={form.name}
              aria-label={t('launch.panel.name')}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('launch.panel.namePlaceholder')}
              className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {t('launch.panel.descLabel')}
            </label>
            <input
              type="text"
              value={form.description}
              aria-label={t('launch.panel.descLabel')}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('launch.panel.descPlaceholder')}
              className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {t('launch.panel.markdownLabel')}
            </label>
            <textarea
              value={form.markdown}
              aria-label={t('launch.panel.markdownAria')}
              onChange={(e) => setForm({ ...form, markdown: e.target.value })}
              rows={3}
              placeholder={t('launch.panel.markdownPlaceholder')}
              className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {t('launch.panel.buttonConfig')}
            </label>
            <div className="border border-zinc-800 rounded p-2 bg-zinc-950">
              <KeyboardEditor
                value={form.keyboard}
                onChange={(kb) => setForm({ ...form, keyboard: kb })}
                markdown={form.markdown}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('launch.common.deletePanel')}
        width="420px"
        footer={
          <ModalFooter
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleDelete}
            confirmText={t('launch.common.confirmDelete')}
            confirmVariant="danger"
          />
        }
      >
        <div className="flex items-start gap-2 py-2">
          <AlertTriangle aria-hidden="true" className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-zinc-300">
            {t('launch.panel.confirmDelete', { name: deleteTarget?.name ?? '' })}？
            <div className="text-xs text-zinc-500 mt-1">{t('launch.panel.deleteHint')}</div>
          </div>
        </div>
      </Modal>

      {/* 导入预置模板 Modal */}
      <Modal
        open={builtinOpen}
        onClose={() => setBuiltinOpen(false)}
        title={t('launch.panel.importTitle')}
        width="560px"
        footer={
          <ModalFooter
            onCancel={() => setBuiltinOpen(false)}
            onConfirm={async () => {
              if (!projectPath) return;
              const ids = Array.from(selectedTemplates);
              if (ids.length === 0) {
                toast.warning(t('launch.panel.selectAtLeastOne'));
                return;
              }
              const res = await window.qqbat.buttonPanel.importBuiltin(projectPath, ids);
              if (res.ok) {
                await reload();
                setBuiltinOpen(false);
                const count = res.data?.length ?? 0;
                const skipped = ids.length - count;
                if (skipped > 0) {
                  toast.success(
                    t('launch.panel.importedWithSkipped', {
                      count: String(count),
                      skipped: String(skipped),
                    }),
                  );
                } else {
                  toast.success(t('launch.panel.imported', { count: String(count) }));
                }
              } else {
                toast.error(res.error || t('launch.common.importFailed'));
              }
            }}
            confirmText={t('launch.panel.importSelected', {
              count: String(selectedTemplates.size),
            })}
          />
        }
      >
        <div className="space-y-2">
          <div className="text-xs text-zinc-500 mb-2">{t('launch.panel.importHint')}</div>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (selectedTemplates.size === builtinList.length) {
                  setSelectedTemplates(new Set());
                } else {
                  setSelectedTemplates(new Set(builtinList.map((item) => item.templateId)));
                }
              }}
            >
              {selectedTemplates.size === builtinList.length
                ? t('launch.common.deselectAll')
                : t('launch.common.selectAll')}
            </Button>
          </div>
          {builtinList.map((item) => {
            const checked = selectedTemplates.has(item.templateId);
            return (
              <label
                key={item.templateId}
                className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer transition ${
                  checked
                    ? 'border-blue-600/50 bg-blue-900/10'
                    : 'border-zinc-700 hover:border-zinc-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={t('launch.panel.importAria', { name: item.name })}
                  onChange={(e) => {
                    setSelectedTemplates((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.templateId);
                      else next.delete(item.templateId);
                      return next;
                    });
                  }}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">{item.name}</div>
                  <div className="text-xs text-zinc-500">{item.description}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {t('launch.panel.buttonCount', { count: String(item.buttonCount) })}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

/** 只读按钮预览（不显示编辑器，仅展示按钮布局） */
function KeyboardPreview({ keyboard }: { keyboard: InlineKeyboard }) {
  useLocaleSubscription();
  if (!keyboard?.rows || keyboard.rows.length === 0) {
    return <div className="text-xs text-zinc-500">{t('launch.panel.noButtons')}</div>;
  }
  return (
    <div className="space-y-1.5">
      {keyboard.rows.map((row, ri) => (
        <div key={ri} className="flex gap-1.5 flex-wrap">
          {row?.buttons?.map((btn) => (
            <div
              key={btn.id}
              className={`px-3 py-1.5 rounded text-xs border ${
                btn.render_data?.style === 1
                  ? 'border-blue-500/60 text-blue-300 bg-blue-900/20'
                  : 'border-zinc-600 text-zinc-300 bg-zinc-800/40'
              }`}
            >
              {btn.render_data?.label || t('launch.panel.unnamed')}
              {btn.action?.data && (
                <span className="ml-1.5 text-zinc-500">/{btn.action.data.replace(/^\/+/, '')}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
