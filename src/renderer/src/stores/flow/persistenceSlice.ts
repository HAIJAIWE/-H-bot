// 项目级生命周期：加载图 / 落盘（saveNow）/ 生成代码 / 重置，以及 dirty/saving/saveError/loadError
// 这些"保存状态"字段。
// 为什么它们必须在一起：保存时机、加载静默窗口、空图画布保护、加载失败禁止落盘 ——
// 是同一套数据安全语义，拆散会让人看不全。自动保存的定时器与订阅在 ./persistence（模块级）。

import { useProjectStore } from '../projectStore';
import { syncNodeCounter } from '../../lib/canvas/nodeFactory';
import { t } from '../../i18n';
import { clearHistory } from './historyStack';
import { _runtimeErrorMessages } from './nodeErrorCore';
import { markGraphLoaded, getFlowRevision } from './persistence';
import type { FlowState, FlowSlice } from './types';

type PersistenceSlice = Pick<
  FlowState,
  | 'loadedProjectPath'
  | 'dirty'
  | 'lastSavedAt'
  | 'saveError'
  | 'saving'
  | 'loadError'
  | 'generating'
  | 'lastGeneratedAt'
  | 'lastGeneratedVersion'
  | 'lastGeneratedVersionError'
  | 'setLoadError'
  | 'loadGraph'
  | 'saveNow'
  | 'generateCode'
  | 'reset'
>;

export const createPersistenceSlice: FlowSlice<PersistenceSlice> = (set, get) => ({
  /**
   * **当前画布属于哪个项目**（loadGraph 时记下；关闭/重置清空）。
   *
   * 为什么必须有它（2026-10-06 真机事故）：`saveNow()` 以前不传路径时用
   * `projectStore.currentProject.path` —— 而"当前打开的项目"和"画布里的图属于谁"
   * **可以是两个项目**（AI 面板/项目列表把 currentProject 切走了，画布还是旧图）。
   * 结果：自动保存把 **RPG 项目的 275 节点图写进了 测试 项目的 flow.json**
   * （实测发生，靠 history 快照才还原回来）。
   */
  loadedProjectPath: null,
  dirty: false,
  lastSavedAt: 0,
  saveError: '',
  saving: false,
  loadError: null,
  generating: false,
  lastGeneratedAt: null,
  lastGeneratedVersion: null,
  lastGeneratedVersionError: null,

  setLoadError: (message: any) => set({ loadError: message }),

  /** 加载完整流程图，同步节点计数器并重置运行时状态 */
  loadGraph: (graph: any, projectPath: any) => {
    // 切换项目必须清空历史栈：否则 Ctrl+Z 会恢复上一个项目的 nodes/edges，
    // 若此时生成代码，错误的 flow.json 会被保存进新项目
    clearHistory();
    // 加载项目会在内存里补全端口/清理无效边：这些不是用户改动，不触发自动保存
    // （否则"打开项目"就会把项目文件重写一遍）
    markGraphLoaded();
    // 同步节点计数器：避免刷新后新建节点 ID 与已加载节点冲突（n1 与已存在 n1 撞 ID）
    syncNodeCounter(graph.nodes);
    // 运行时错误记账随图一起重置（新项目的节点 id 可能复用）
    _runtimeErrorMessages.clear();
    set({
      nodes: graph.nodes,
      edges: graph.edges,
      systems: graph.systems ?? [],
      projectName: graph.metadata.name,
      // 记住文件里的创建时间：导出/保存时原样带回，不再被每次保存改写
      graphCreatedAt: graph.metadata.createdAt || null,
      selectedNodeId: null,
      nodeGroups: graph.nodeGroups ?? [],
      selectedNodeIds: [],
      focusNodeId: null,
      highlightedNodeIds: new Set(),
      searchMatchIds: new Set(),
      connectingFromPort: null,
      errorFixRequest: null,
      recommendApplyRequest: null,
      // 清理运行时状态：避免上一个项目的执行/错误标记/建议残留到新项目
      executingNodeIds: new Set(),
      errorNodeIds: new Set<string>(),
      doneNodeIds: new Set(),
      nodeErrors: {},
      nodeIssues: {},
      issues: [],
      issueBaseline: new Set<string>(),
      issueBaselineProject: null,
      suggestions: [],
      lastGeneratedAt: null,
      lastGeneratedVersion: null,
      lastGeneratedVersionError: null,
      // 加载成功即解除"禁止落盘"保护
      loadError: null,
      // 记下"这张图属于谁"：落盘按它写，而不是按"当前打开的项目"（见 saveNow）
      ...(projectPath ? { loadedProjectPath: projectPath } : {}),
    });
  },

  /**
   * 把当前画布写进项目的 `.qqbat/flow.json`。
   *
   * 这是编辑器**唯一**的落盘入口（自动保存 / Ctrl+S / 启动机器人前都走它）。
   * 不传路径时用当前打开的项目；没绑定项目就直接返回 false，避免把流程写到别处。
   */
  saveNow: async (explicitPath: any, options: any) => {
    /**
     * ── 写到哪个项目？（P0：2026-10-06 真机事故）────────────────────────
     *
     * 以前这里是 `explicitPath || projectStore.currentProject.path`。
     * 但"当前打开的项目"和"画布里的图属于谁"**可以是两个项目** ——
     * 切换项目/切 AI 会话改了 currentProject，而画布还挂着上一个项目的图。
     * 实测后果：**RPG 项目（275 节点）的图被写进了 测试 项目的 flow.json**
     * （那次靠 `.qqbat/history` 快照才还原）。
     *
     * 现在的口径：**谁的图就写回谁** —— explicitPath > 画布加载来源 > 当前打开的项目；
     * 后两者不一致时**明确告警**，绝不静默写错地方。
     */
    const loadedPath = get().loadedProjectPath;
    const storePath = useProjectStore.getState().currentProject?.path;
    const projectPath = explicitPath || loadedPath || storePath;
    if (!explicitPath && loadedPath && storePath && loadedPath !== storePath) {
      // ⚠️ 渲染层日志一律英文（noHardcodedCopy 闸门：这些目录不许出现中文界面文案）
      console.warn(
        '[flowStore] canvas belongs to a different project than the current one; saving to the canvas project to avoid overwriting another project file',
        { canvasProject: loadedPath, currentProject: storePath },
      );
    }
    if (!projectPath) return false;
    // 加载失败时画布是空的，写下去就是把用户的作品覆盖成空图 —— 直接拒绝落盘。
    // 调用方（自动保存 / Ctrl+S / 启动机器人 / 生成代码）一律走这里，所以守在这一层。
    if (get().loadError) {
      console.warn('[flowStore] 已阻止保存：当前项目的 flow.json 加载失败，不能用空画布覆盖原文件');
      return false;
    }
    if (!window.qqbat?.flow?.save) return false; // 非 Electron 环境（测试 / 浏览器预览）
    // 自动保存只在"有用户改动"时写盘。
    // 打开项目时主进程会补全端口定义、清理无效边，内存里的图因此变化 —— 那不是用户改动，
    // 不能因为"打开了一下"就把项目文件重写一遍（真应用实测踩到，用户项目被改写过）。
    // 显式保存（Ctrl+S / 启动机器人 / 生成代码）走 force，保证磁盘 == 内存。
    if (!options?.force && !get().dirty) return true;

    // ── 空画布保护（启动机器人时踩到）────────────────────────────────
    //
    // 点「运行」会走 `saveNow(force: true)`（确保磁盘 == 内存）。但画布**可能根本没加载过**：
    // 用户直接点了运行、没打开流程图标签页 —— 此时内存里是空图，force 写盘就等于
    // "用空流程覆盖 227 个节点"。主进程的守卫会拒绝（数据没丢），但启动会被取消，
    // 用户看到「启动已取消：流程未保存」，完全不知道该怎么办。
    //
    // 正确语义：**空画布没有可保存的内容** → 视为"无需保存"（返回 true），
    // 让启动继续用磁盘上那份权威流程。这样既不会误覆盖，也不会拦住启动。
    const snapshot = get();
    if (snapshot.nodes.length === 0 && snapshot.edges.length === 0) {
      return true;
    }

    const graph = get().exportGraph();
    const revisionAtStart = getFlowRevision();
    set({ saving: true, saveError: '' });
    try {
      const res = await window.qqbat.flow.save(projectPath, graph, options?.reason ?? 'other');
      if (!res?.ok) {
        // 保存失败**必须显示出来**（原来只有 console.error，徽章照旧显示"已同步"）。
        // 主进程的"拒绝空图覆盖非空图"守卫就是从这里把原因传回来的。
        // 兜底文案走 i18n（它会被显示在保存徽章上，属界面文案）。
        const reason = res?.error || t('blocks.editor.save.unknownReason');
        console.error('保存 flow.json 失败:', reason);
        set({ saveError: reason });
        return false;
      }
      // 保存期间又有改动 → 继续保持 dirty，让防抖再存一次（不能把新改动误标成已保存）
      set({ dirty: getFlowRevision() !== revisionAtStart, lastSavedAt: Date.now(), saveError: '' });
      return true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error('保存 flow.json 异常:', e);
      set({ saveError: reason });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  generateCode: async (
    projectPath: string,
    debugMode = false,
    version?: { name?: string; message?: string } | null,
  ) => {
    set({ generating: true });
    try {
      const graph = get().exportGraph();
      // 先保存到 flow.json，确保磁盘和内存状态一致。
      // reason='generate' 会写进提交说明 —— 历史上"只有点生成代码才落盘"，
      // 用户记忆里那些记录就是"生成代码的版本"，所以这条来源必须留下来。
      if (!(await get().saveNow(projectPath, { reason: 'generate' }))) return false;
      // 再生成代码
      const result = await window.qqbat.codegen.generate(projectPath, graph, debugMode, version);
      if (!result.ok) {
        console.error('代码生成失败:', result.error);
        return false;
      }
      // 标记代码生成成功时间（供 TopBar 热更新提示使用）
      // 同时记下这次被记成了哪个版本 —— 界面要能说出"记为版本 v1.1"，
      // 否则"没改流程 → 只有新版本、没有新提交"会被误读成"什么都没发生"。
      set({
        lastGeneratedAt: Date.now(),
        lastGeneratedVersion: result.data?.version ?? null,
        lastGeneratedVersionError: result.data?.versionError ?? null,
      });
      return true;
    } catch (e) {
      console.error('代码生成异常:', e);
      return false;
    } finally {
      set({ generating: false });
    }
  },

  reset: () => {
    clearHistory();
    _runtimeErrorMessages.clear();
    // 关闭/切换项目：图被清空同样不是用户改动
    markGraphLoaded();
    // 重置时必须清理所有运行时状态字段，否则切换/关闭项目后会残留：
    // - systems 不清空 → 旧的系统分组仍在侧边栏显示
    // - errorNodeIds/nodeErrors/suggestions 不清空 → 错误标记和建议卡片残留
    // - lastGeneratedAt 不清空 → 热更新提示误认为有未保存的生成
    set({
      nodes: [],
      edges: [],
      systems: [],
      selectedNodeId: null,
      projectName: 'untitled',
      // 关闭/切换项目：上一个项目的 createdAt 不能带到下一个项目
      graphCreatedAt: null,
      generating: false,
      executingNodeIds: new Set(),
      errorNodeIds: new Set<string>(),
      doneNodeIds: new Set(),
      nodeErrors: {},
      nodeIssues: {},
      issues: [],
      issueBaseline: new Set<string>(),
      issueBaselineProject: null,
      suggestions: [],
      nodeGroups: [],
      selectedNodeIds: [],
      focusNodeId: null,
      highlightedNodeIds: new Set(),
      searchMatchIds: new Set(),
      connectingFromPort: null,
      errorFixRequest: null,
      recommendApplyRequest: null,
      lastGeneratedAt: null,
      lastGeneratedVersion: null,
      lastGeneratedVersionError: null,
      clipboard: null,
      // 关闭/切换项目：画布已经不"属于"任何项目了，别把下一个项目的保存写到这里
      loadedProjectPath: null,
      // 注意：加载**失败**时调用方会在 reset() 之后再置 loadError（顺序不能反），
      // 否则"禁止落盘"的保护会被这次清空抹掉
      loadError: null,
    });
  },
});
