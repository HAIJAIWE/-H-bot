// src/renderer/src/stores/themeStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILT_IN_THEMES, type ThemeConfig } from '@shared/types/theme';
import { STORAGE_KEYS } from '../lib/infra/storageKeys';

const STORAGE_KEY = STORAGE_KEYS.theme;

const THEME_CLASS_MAP: Record<string, string> = {
  'qqbat-dark': 'theme-dark',
  'qqbat-light': 'theme-light',
};

interface ThemeState {
  currentThemeId: string;
  availableThemes: ThemeConfig[];
  setTheme: (id: string) => void;
  /** 当前是否暗色主题 (computed) */
  isDark: boolean;
}

function getThemeById(id: string): ThemeConfig | undefined {
  return BUILT_IN_THEMES.find((t) => t.id === id);
}

function applyTheme(id: string): void {
  const theme = getThemeById(id);
  if (!theme) return;

  const root = document.documentElement;

  // 设置 data-theme 属性
  root.setAttribute('data-theme', id);

  // 设置 .theme-* class（用于防闪烁内联 script）
  root.classList.remove('theme-dark', 'theme-light');
  const cls = THEME_CLASS_MAP[id];
  if (cls) {
    root.classList.add(cls);
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      currentThemeId: 'qqbat-dark',
      availableThemes: BUILT_IN_THEMES,
      isDark: true,
      setTheme: (id) => {
        const theme = getThemeById(id);
        if (!theme) return;
        applyTheme(id);
        set({ currentThemeId: id, isDark: theme.isDark });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ currentThemeId: state.currentThemeId }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            applyTheme(state.currentThemeId);
            // 同步 isDark
            const theme = getThemeById(state.currentThemeId);
            if (theme) {
              state.isDark = theme.isDark;
            }
          }
        };
      },
    },
  ),
);

// 初始化时应用已持久化的主题（防闪烁）
const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    const id = parsed?.state?.currentThemeId;
    if (id && getThemeById(id)) {
      applyTheme(id);
    }
  } catch {
    // ignore parse error
  }
} else {
  // 默认使用暗色主题
  applyTheme('qqbat-dark');
}
