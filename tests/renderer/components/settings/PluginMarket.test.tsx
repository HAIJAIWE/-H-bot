// tests/renderer/components/settings/PluginMarket.test.tsx
//
// 插件市场面板：清单渲染 / 第三方标记 / 安装调用 / 来源添加。
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { PluginMarket } from '@renderer/components/settings/PluginMarket';
import { t } from '@renderer/i18n';
import type { MarketItem } from '@shared/plugins/market';

const OFFICIAL = 'bundled://official';
const THIRD = 'https://example.com/market.json';

function item(overrides: Partial<MarketItem>): MarketItem {
  return {
    id: 'clock',
    name: 'clock',
    title: 'Clock',
    description: 'Shows the time',
    source: OFFICIAL,
    latestVersion: '1.0.0',
    ...overrides,
  };
}

let marketList: ReturnType<typeof vi.fn>;
let marketInstall: ReturnType<typeof vi.fn>;
let marketUninstall: ReturnType<typeof vi.fn>;
let marketAddSource: ReturnType<typeof vi.fn>;
let marketRemoveSource: ReturnType<typeof vi.fn>;

function listOf(plugins: MarketItem[]) {
  return { ok: true, data: { plugins, sources: [{ source: OFFICIAL }, { source: THIRD }] } };
}

beforeEach(() => {
  marketList = vi.fn().mockResolvedValue(listOf([item({})]));
  marketInstall = vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 'clock', pluginId: 'ai.market-clock', name: 'market-clock', version: '1.0.0' },
  });
  marketUninstall = vi.fn().mockResolvedValue({ ok: true, data: { id: 'clock' } });
  marketAddSource = vi.fn().mockResolvedValue({ ok: true, data: [OFFICIAL, THIRD] });
  marketRemoveSource = vi.fn().mockResolvedValue({ ok: true, data: [OFFICIAL] });
  window.qqbat = {
    plugin: { marketList, marketInstall, marketUninstall, marketAddSource, marketRemoveSource },
  } as never;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as never as { qqbat?: unknown }).qqbat;
});

describe('插件市场面板', () => {
  it('★ 渲染清单与来源；第三方来源带提醒徽标', async () => {
    marketList.mockResolvedValue(
      listOf([item({}), item({ id: 'coin', name: 'coin', title: 'Coin', source: THIRD })]),
    );
    render(<PluginMarket open />);
    await waitFor(() => expect(screen.getByText('Clock')).toBeInTheDocument());
    expect(screen.getByText('Coin')).toBeInTheDocument();
    expect(screen.getByText(t('settings.plugins.market.thirdParty'))).toBeInTheDocument();
    expect(screen.getByText(t('settings.plugins.market.official'))).toBeInTheDocument();
    expect(marketList).toHaveBeenCalledTimes(1);
  });

  it('★ 安装按钮调用 marketInstall(id)，完成后按新清单刷新', async () => {
    marketList
      .mockResolvedValueOnce(listOf([item({})]))
      .mockResolvedValueOnce(
        listOf([item({ installed: { version: '1.0.0', modified: false, missing: false } })]),
      );
    render(<PluginMarket open />);
    const row = (await screen.findByText('Clock')).closest('li');
    expect(row).toBeTruthy();
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', {
        name: t('settings.plugins.market.install'),
      }),
    );
    await waitFor(() => expect(marketInstall).toHaveBeenCalledWith('clock'));
    await waitFor(() => expect(marketList).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(t('settings.plugins.market.installedLabel', { version: '1.0.0' })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('settings.plugins.market.uninstall') }),
    ).toBeInTheDocument();
  });

  it('本地被改过的安装显示提醒，且不提供“更新”', async () => {
    marketList.mockResolvedValue(
      listOf([item({ installed: { version: '1.0.0', modified: true, missing: false } })]),
    );
    render(<PluginMarket open />);
    await waitFor(() =>
      expect(screen.getByText(t('settings.plugins.market.modified'))).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: t('settings.plugins.market.update') }),
    ).not.toBeInTheDocument();
  });

  it('卸载是两段式：先确认，再调用 marketUninstall', async () => {
    marketList.mockResolvedValue(
      listOf([item({ installed: { version: '1.0.0', modified: false, missing: false } })]),
    );
    render(<PluginMarket open />);
    fireEvent.click(
      await screen.findByRole('button', { name: t('settings.plugins.market.uninstall') }),
    );
    expect(marketUninstall).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: t('settings.plugins.market.uninstallConfirm') }),
    );
    await waitFor(() => expect(marketUninstall).toHaveBeenCalledWith('clock'));
  });

  it('添加来源会去掉首尾空白再提交', async () => {
    render(<PluginMarket open />);
    const input = await screen.findByPlaceholderText(
      t('settings.plugins.market.addSourcePlaceholder'),
    );
    fireEvent.change(input, { target: { value: '  https://example.com/extra.json  ' } });
    fireEvent.click(screen.getByRole('button', { name: t('settings.plugins.market.addSource') }));
    await waitFor(() =>
      expect(marketAddSource).toHaveBeenCalledWith('https://example.com/extra.json'),
    );
  });
});
