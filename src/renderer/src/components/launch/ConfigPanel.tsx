import { useEffect, useState, useCallback, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { CreateTableWizard } from './CreateTableWizard';
import { categoryDescription, categoryLabel } from './configCategoryLabels';
import type { ConfigCategory } from '@shared/types/launch';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { NewProjectDialog } from '../project/NewProjectDialog';
import type { ProjectMeta } from '@shared/types/project';
import { TableEditorPopup } from './TableEditorPopup';
import { SkeletonGrid } from '../ui/Skeleton';
import { inputForm } from '../ui/inputStyles';
import { AdapterConfigDialog } from './AdapterConfigDialog';
import { Dropdown } from '../ui/Dropdown';
import { BOT_TYPES, type BotType } from '@shared/domain/project/botTypeConfig';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 层名 → 中文标签 + 颜色映射（用于配置表卡片的层来源标签） */
export function ConfigPanel() {
  useLocaleSubscription();
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '');
  const project = useProjectStore((s) => s.currentProject);
  const botType = project?.botType;
  const [botTypeError, setBotTypeError] = useState('');

  /**
   * 切换机器人类型（建完项目也能改）。
   *
   * 只改 project.json 里这一个字段；成功后**就地更新 store** —— 玩家数据面板按 botType
   * 选字段分组，改完要立刻生效。类型**不影响已有节点**，但决定**节点库里显示哪些**（QQ 官方机器人只显示 QQ 相关节点，见 shared/domain/project/botTypeConfig.ts）。
   */
  const changeBotType = useCallback(
    async (next: BotType) => {
      if (!projectPath || next === botType) return;
      setBotTypeError('');
      const res = await window.qqbat.project.updateBotType(projectPath, next);
      if (!res?.ok) {
        setBotTypeError(res?.error || t('launch.config.switchFailed'));
        return;
      }
      const current = useProjectStore.getState().currentProject;
      if (current) useProjectStore.getState().setCurrentProject({ ...current, botType: next });
    },
    [projectPath, botType],
  );
  const [categories, setCategories] = useState<ConfigCategory[]>([]);
  const [loading, setLoading] = useState(false);
  // 加载错误：区分"加载失败"与"暂无数据"，避免空数组误导用户
  const [loadError, setLoadError] = useState<string | null>(null);

  // 建表向导
  const [wizardOpen, setWizardOpen] = useState(false);

  // 当前打开的表编辑器弹窗
  const [openTable, setOpenTable] = useState<ConfigCategory | null>(null);

  // 适配器配置对话框
  const [adapterConfigOpen, setAdapterConfigOpen] = useState(false);

  // 新建项目对话框
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const handleCreated = (meta: ProjectMeta) => {
    setNewProjectOpen(false);
    useProjectStore.getState().setCurrentProject(meta);
  };

  // 配置表搜索关键词（前端过滤）
  const [searchText, setSearchText] = useState('');
  // 搜索防抖：避免每次按键触发 categories 全量过滤
  const debouncedSearchText = useDebouncedValue(searchText, 300);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    setLoadError(null);
    window.qqbat.launchConfig
      .listCategories(projectPath)
      .then((res) => {
        if (res.ok && res.data) {
          setCategories(res.data);
        } else {
          // 加载失败：记录错误信息，渲染时显示错误提示而非空状态
          setLoadError(res.error || t('launch.config.loadListFailed'));
        }
      })
      .catch((err) => {
        console.error(err);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  /** 刷新分类列表（建表/改表/删表后调用） */
  const refreshCategories = useCallback(async () => {
    if (!projectPath) return;
    try {
      const res = await window.qqbat.launchConfig.listCategories(projectPath);
      if (res.ok && res.data) {
        setCategories(res.data);
        setLoadError(null);
      } else {
        setLoadError(res.error || t('launch.config.loadListFailed'));
      }
    } catch (err) {
      console.error('[ConfigPanel] refreshCategories 失败:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [projectPath]);

  /** 建表成功回调 */
  const handleTableCreated = useCallback(() => {
    refreshCategories();
  }, [refreshCategories]);

  /** 表结构变更回调 */
  const handleTableChanged = useCallback(() => {
    refreshCategories();
  }, [refreshCategories]);

  /**
   * 表编辑器弹窗要用的分类对象 —— **按名字从最新列表里取**，不存快照。
   *
   * 原来这里是 `const [openTable, setOpenTable] = useState<ConfigCategory|null>(null)`，
   * 存的是**点开那一刻的整个对象**。于是重命名/改字段后：列表刷新了（卡片变了），
   * 但弹窗标题与"设计表结构"里的名字仍是打开时的旧快照 ——
   * 用户实测反馈："改名了它需要刷新一下，但面板的字段没刷新"。
   * 改成只存名字、渲染时查最新对象，这个问题从结构上消失。
   */
  const openTableName = openTable?.name || null;
  const openTableLive = useMemo(
    () => (openTableName ? (categories.find((c) => c.name === openTableName) ?? null) : null),
    [categories, openTableName],
  );

  const filteredCategories = useMemo(() => {
    const q = debouncedSearchText.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [categories, debouncedSearchText]);

  if (!projectPath) {
    return (
      <>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title={t('launch.common.selectProject')}
            description={t('launch.common.selectProjectHint')}
            action={
              <Button variant="primary" size="sm" onClick={() => setNewProjectOpen(true)}>
                {t('launch.common.newProject')}
              </Button>
            }
          />
        </div>
        {newProjectOpen && (
          <NewProjectDialog
            open
            onClose={() => setNewProjectOpen(false)}
            onCreated={handleCreated}
          />
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div>
          <div className="text-sm font-semibold text-zinc-200">{t('launch.config.title')}</div>
          {botType && (
            <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
              {t('launch.config.botTypeCurrent')}
              <Dropdown
                value={botType}
                ariaLabel={t('launch.config.botType')}
                onChange={(v) => {
                  void changeBotType(v as BotType);
                }}
                options={BOT_TYPES.map((o) => ({
                  value: o.value,
                  label: t(`launch.botType.${o.value}`),
                }))}
              />
              <span className="text-zinc-600">{t('launch.config.botTypeHint')}</span>
              {botTypeError && <span className="text-red-400">{botTypeError}</span>}
            </div>
          )}
          {!botType && (
            <div className="text-xs text-zinc-500 mt-0.5">{t('launch.config.subtitle')}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshCategories}
            title={t('launch.config.rescanTitle')}
            leftIcon={<span className="text-base leading-none">↻</span>}
          >
            {t('launch.common.refresh')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAdapterConfigOpen(true)}
            title={t('launch.config.adapterTitle')}
            leftIcon={<span className="text-base leading-none">⚙</span>}
          >
            {t('launch.adapter.title')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setWizardOpen(true)}
            title={t('launch.config.newTableTitle')}
            leftIcon={<span className="text-base leading-none">+</span>}
          >
            {t('launch.config.newTable')}
          </Button>
        </div>
      </div>

      {/* 搜索栏（仅在有配置表时显示，前端过滤） */}
      {!loading && categories.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t('launch.config.searchPlaceholder')}
            aria-label={t('launch.config.searchAria')}
            className={`w-72 ${inputForm} placeholder-zinc-600`}
          />
          {searchText && (
            <>
              <span className="text-xs text-zinc-500">
                {t('launch.config.matchCount', {
                  matched: String(filteredCategories.length),
                  total: String(categories.length),
                })}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSearchText('')}>
                {t('launch.common.clear')}
              </Button>
            </>
          )}
        </div>
      )}

      {/* 卡片网格 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading && (
          <div className="h-full flex flex-col justify-center">
            <SkeletonGrid cards={6} />
          </div>
        )}
        {!loading && loadError && categories.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="text-red-400 text-sm mb-2">{t('launch.config.listLoadFailed')}</div>
              <div className="text-zinc-500 text-xs mb-4 break-words">{loadError}</div>
              <Button variant="primary" size="sm" onClick={refreshCategories}>
                {t('launch.common.retry')}
              </Button>
            </div>
          </div>
        )}
        {!loading && !loadError && categories.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <div className="text-zinc-500 text-sm mb-2">{t('launch.config.empty')}</div>
              <div className="text-zinc-500 text-xs leading-relaxed bg-zinc-900/50 rounded p-4 space-y-1">
                <div className="text-zinc-400 mb-1">{t('launch.config.helpTitle')}</div>
                <div>{t('launch.config.help1')}</div>
                <div>{t('launch.config.help2')}</div>
                <div>{t('launch.config.help3')}</div>
                <div className="mt-2 text-zinc-400 mb-1">{t('launch.config.firstUseTitle')}</div>
                <div>{t('launch.config.firstUse1')}</div>
                <div>{t('launch.config.firstUse2')}</div>
              </div>
            </div>
          </div>
        )}
        {!loading &&
          categories.length > 0 &&
          (filteredCategories.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              {t('launch.config.noMatch', { query: searchText })}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {filteredCategories.map((cat) => {
                return (
                  <div
                    key={cat.name}
                    role="button"
                    tabIndex={0}
                    aria-label={t('launch.config.openTableAria', { name: categoryLabel(cat) })}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/30 transition-all group"
                    onClick={() => setOpenTable(cat)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenTable(cat);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm font-medium text-zinc-200 truncate flex-1">
                        {categoryLabel(cat)}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <div className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                          {t('launch.config.tableCount', { count: String(cat.tableCount) })}
                        </div>
                      </div>
                    </div>
                    {categoryDescription(cat) && (
                      <div className="text-xs text-zinc-500 leading-relaxed line-clamp-2 mb-3">
                        {categoryDescription(cat)}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500 font-mono truncate">{cat.name}</span>
                      <span className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        {t('launch.config.openEditor')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      {/* 新建数据表向导 */}
      <CreateTableWizard
        open={wizardOpen}
        projectPath={projectPath}
        onClose={() => setWizardOpen(false)}
        onCreated={handleTableCreated}
      />

      {/* 表编辑器弹窗 */}
      {openTableLive && (
        <TableEditorPopup
          category={openTableLive}
          projectPath={projectPath}
          onClose={() => setOpenTable(null)}
          onTableChanged={handleTableChanged}
        />
      )}

      {/* 适配器配置对话框 */}
      <AdapterConfigDialog
        open={adapterConfigOpen}
        projectPath={projectPath}
        onClose={() => setAdapterConfigOpen(false)}
        onSaved={refreshCategories}
      />
    </div>
  );
}
