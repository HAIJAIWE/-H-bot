// src/renderer/src/components/layout/LaunchPanel.tsx
import { useState, useEffect, useCallback, memo } from 'react';
import type { LaunchTab } from '../../stores/uiStore';
import { DashboardPanel } from '../launch/DashboardPanel';
import { ConsolePanel } from '../launch/ConsolePanel';
import { DataBrowserPanel } from '../launch/DataBrowserPanel';
import { ConfigPanel } from '../launch/ConfigPanel';
import { AgentPanel } from '../launch/AgentPanel';
import { DataTemplateEditor } from '../launch/DataTemplateEditor';
import { ButtonPanelManager } from '../launch/ButtonPanelManager';
import { LogViewer } from '../editor/LogViewer';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Pagination } from '../ui/Pagination';
import { DEFAULT_PAGE_SIZE } from '@shared/types/pagination';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface RegisteredPanel {
  panelId: string;
  label: string;
  description: string;
  dataSource: string;
  tableName: string;
}

function AdminPanelView({ panel, projectPath }: { panel: RegisteredPanel; projectPath: string }) {
  useLocaleSubscription();
  const [data, setData] = useState<{ rows: Record<string, unknown>[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const loadData = useCallback(() => {
    if (!panel.panelId) return;
    setLoading(true);
    setError('');
    window.qqbat.panel
      .queryTable(projectPath, panel.panelId, page, pageSize)
      .then((res) => {
        if (res.ok && res.data) {
          setData(res.data as { rows: Record<string, unknown>[]; total: number });
        } else {
          setError(res.error || t('launch.common.queryFailed'));
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [panel.panelId, page, projectPath, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="p-4 h-full overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{panel.label}</h3>
          {panel.description && <p className="text-xs text-zinc-500 mt-0.5">{panel.description}</p>}
        </div>
        <div className="text-xs text-zinc-500">
          {t('launch.adminPanel.dataSource', {
            source: panel.dataSource,
            table: panel.tableName,
          })}
        </div>
      </div>
      {loading ? (
        <div className="flex items-center text-xs text-zinc-500">
          <Spinner size="sm" />
          <span className="ml-2">{t('launch.common.loading')}</span>
        </div>
      ) : error ? (
        <div className="text-center">
          <p className="text-xs text-red-400 mb-3">{error}</p>
          <Button variant="secondary" size="sm" onClick={loadData}>
            {t('launch.common.retry')}
          </Button>
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="overflow-auto border border-zinc-700 rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-800">
                {Object.keys(data.rows[0]).map((col) => (
                  <th
                    key={col}
                    className="text-left px-3 py-2 text-zinc-400 font-medium whitespace-nowrap border-b border-zinc-700"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                  {Object.values(row).map((val, j) => (
                    <td
                      key={j}
                      className="px-3 py-1.5 text-zinc-300 whitespace-nowrap max-w-48 truncate"
                    >
                      {val === null ? (
                        <span className="text-zinc-500 italic">null</span>
                      ) : (
                        String(val)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={t('launch.common.noData')}
          description={t('launch.adminPanel.noRecords')}
          action={
            <Button variant="secondary" size="sm" onClick={loadData}>
              {t('launch.common.refresh')}
            </Button>
          }
        />
      )}
      {data && data.total > pageSize && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={Math.ceil(data.total / pageSize)}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

interface LaunchPanelProps {
  launchTab: LaunchTab;
  projectPath: string;
  registeredPanels: RegisteredPanel[];
}

export const LaunchPanel = memo(function LaunchPanel({
  launchTab,
  projectPath,
  registeredPanels,
}: LaunchPanelProps) {
  return (
    <>
      {launchTab === 'dashboard' && <DashboardPanel />}
      {launchTab === 'logs' && <LogViewer />}
      {launchTab === 'console' && <ConsolePanel />}
      {launchTab === 'dataview' && <DataBrowserPanel />}
      {launchTab === 'template' && <DataTemplateEditor projectPath={projectPath} />}
      {launchTab === 'panels' && <ButtonPanelManager />}
      {launchTab === 'config' && <ConfigPanel />}
      {launchTab === 'agent' && <AgentPanel />}
      {(() => {
        const panel = registeredPanels.find((p) => p.panelId === launchTab);
        if (panel)
          return <AdminPanelView key={panel.panelId} panel={panel} projectPath={projectPath} />;
        return null;
      })()}
    </>
  );
});
