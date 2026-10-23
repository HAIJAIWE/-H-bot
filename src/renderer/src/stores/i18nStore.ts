// src/renderer/src/stores/i18nStore.ts
import { create } from 'zustand';
import { getLocale, setLocale as setI18nLocale, subscribe } from '../i18n';

interface I18nState {
  locale: 'zh-CN' | 'en-US';
  setLocale: (locale: 'zh-CN' | 'en-US') => void;
}

export const useI18nStore = create<I18nState>((set) => {
  // 订阅外部语言变更，同步 store 状态
  subscribe((locale) => {
    set({ locale: locale as 'zh-CN' | 'en-US' });
  });

  return {
    locale: getLocale(),
    setLocale: (locale: 'zh-CN' | 'en-US') => {
      setI18nLocale(locale);
      set({ locale });
    },
  };
});

/**
 * 订阅语言变化 —— 只为触发重渲染，不需要返回值。
 *
 * ## 为什么必须单独抽一个 hook
 * `t()` 是普通函数，不是 hook：它读的是 i18n 模块里的当前语言，React 完全不知道
 * 这个依赖。组件里写了 `t('...')` 却没订阅 locale，表现就是**切语言后这个组件还是旧语言**
 * ——单测测不出来（单测里语言是固定的），只有真机切一遍才看得见。
 *
 * 实测 P4-3 批次里 27 个文件漏了订阅，所以把「订阅」变成一个显式、可 grep、
 * 可被闸门检查的动作：组件里只要出现 t()，就必须调用它。
 * 闸门见 tests/renderer/i18n/noHardcodedCopy.test.ts。
 */
export function useLocaleSubscription(): void {
  useI18nStore((s) => s.locale);
}
