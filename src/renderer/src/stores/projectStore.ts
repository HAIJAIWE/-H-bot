// src/renderer/src/stores/projectStore.ts
import { create } from 'zustand';
import type { ProjectMeta, RecentProject } from '@shared/types/project';

interface ProjectState {
  currentProject: ProjectMeta | null;
  recentProjects: RecentProject[];
  setCurrentProject: (p: ProjectMeta | null) => void;
  setRecentProjects: (list: RecentProject[]) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  recentProjects: [],
  /** 设置当前打开的项目（null 表示未打开任何项目） */
  setCurrentProject: (p) => set({ currentProject: p }),
  /** 设置最近打开的项目列表 */
  setRecentProjects: (list) => set({ recentProjects: list }),
  /** 重置项目状态（关闭项目时调用） */
  reset: () => set({ currentProject: null, recentProjects: [] }),
}));
