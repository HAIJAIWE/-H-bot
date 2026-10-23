// src/renderer/src/plugins/index.tsx
//
// **树内插件清单**（2026-10-18）：应用启动时注册的内置插件。
// 每个插件一个文件，只 import 一次；加插件 = 加一个 import + 一次 registerPlugin。
//
// ⚠️ 运行时加载第三方插件不在这一版：那需要沙箱 + 权限声明 + 信任链，
// 先有形状（manifest + 贡献），再谈加载。插件以完整渲染层权限运行 —— 这条必须写清楚。
import { definePlugin, registerPlugin } from '../lib/plugins/api';
import { t } from '../i18n';

registerPlugin(
  definePlugin({
    manifest: {
      id: 'builtin.enter-hint',
      // name/description 用英文：渲染层 i18n 闸门不允许硬编码中文文案（插件清单也是文案）
      name: 'Enter hint',
      version: '0.1.0',
      description: 'Plugin-provided composer hint line',
      permissions: ['slot'],
    },
    activate(api) {
      api.contributeSlot({
        id: 'hint',
        slot: 'composer.hint',
        order: 10,
        render: () => <p className="text-xs text-zinc-500 mt-1 px-1">{t('ai.chat.enterHint')}</p>,
      });
    },
  }),
);
