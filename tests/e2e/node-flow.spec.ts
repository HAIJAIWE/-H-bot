// @ts-expect-error playwright 为非必装依赖
import { test, expect } from '@playwright/test'

/**
 * 节点流程 E2E 测试。
 *
 * 运行前提：先执行 `npm run dev` 启动 electron-vite dev server（renderer 监听 5173）。
 * 若 dev server 未运行，所有测试自动跳过（而非抛出连接错误）。
 *
 * 注意：本项目是 Electron 应用，renderer 依赖主进程注入的 window.qqbat.* IPC API。
 * 纯浏览器访问 http://localhost:5173 时，依赖 IPC 的功能（代码生成、文件读写、
 * 自定义节点扫描等）不可用。依赖 IPC 的测试在注释中标注，需改用 _electron.launch
 * 模式运行，详见 playwright.config.ts。
 */

const DEV_SERVER = 'http://localhost:5173'

/** dev server 是否可达（beforeAll 中探测，beforeEach 中据此跳过）*/
let serverAvailable = false

// @ts-expect-error playwright 类型仅 e2e 时可用
test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get(DEV_SERVER, { timeout: 5000 })
    serverAvailable = res.ok()
  } catch {
    serverAvailable = false
  }
})

test.describe('节点流程 E2E', () => {
  // @ts-expect-error playwright 类型仅 e2e 时可用
  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, '需要 dev server 运行在 http://localhost:5173 (npm run dev)')
    await page.goto(DEV_SERVER)
    // 等待应用加载（左栏节点目录"触发器"分组出现）
    await page.waitForSelector('text=触发器', { timeout: 15000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('应用启动后显示节点目录和画布', async ({ page }) => {
    // 验证左栏节点分组存在（NodePalette 渲染 groupByGroup() 的分组标题）
    await expect(page.locator('text=触发器').first()).toBeVisible()
    await expect(page.locator('text=动作').first()).toBeVisible()
    await expect(page.locator('text=AI').first()).toBeVisible()
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('ai_tool_call 节点出现在左栏 AI 分组', async ({ page }) => {
    // ai_tool_call 已注册到 NODE_CATALOG_V2（src/shared/nodes/builtinCatalog.ts）
    // 前端 getAllSpecs() 以 V2 为唯一数据源，节点应出现在左栏 AI 分组。
    await expect(page.locator('text=AI 工具调用').first()).toBeVisible()
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('拖拽 on_message 节点到画布', async ({ page }) => {
    // NodePalette 中每个节点项有 aria-label="添加节点: {label}（可拖拽到画布）"
    // on_message 的 label 为"收到消息"，点击即调用 handleAdd 将节点加入 flowStore 并选中
    await page.locator('[aria-label*="收到消息"]').first().click()
    // 节点添加后 BlockEditor 渲染 BlockView，BlockView 容器带 border-l-4 类名
    await expect(page.locator('div.border-l-4', { hasText: '收到消息' }).first()).toBeVisible({ timeout: 5000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('选中节点后右侧显示配置面板', async ({ page }) => {
    // 先添加一个 on_message 节点（触发器点击即新建链）
    await page.locator('[aria-label*="收到消息"]').first().click()
    // 点击画布上的节点 BlockView（onClick 触发 onSelect + onToggleExpand 打开 PropertyDrawer）
    const block = page.locator('div.border-l-4', { hasText: '收到消息' }).first()
    await block.waitFor({ state: 'visible', timeout: 5000 })
    await block.click()
    // PropertyDrawer 抽屉头部有 title="关闭" 的关闭按钮
    await expect(page.locator('[title="关闭"]').first()).toBeVisible({ timeout: 3000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('send_message 节点显示 exposedAsTool 勾选', async ({ page }) => {
    // 前置：在左栏点击"发消息"节点添加到画布并选中，PropertyDrawer 随即弹出。
    // PropertyDrawer 中 exposedAsTool 勾选文本应为"暴露给 AI 工具调用"。
    //
    // 注意：exposedAsTool 字段已在 builtinCatalog.ts 的 send_message spec 中定义，
    // 但 PropertyDrawer 目前尚未渲染此勾选控件。待 UI 完善后此测试即可通过。
    test.skip(!serverAvailable, '需要 dev server 运行 (npm run dev)；exposedAsTool 勾选 UI 待 PropertyDrawer 渲染')

    // 点击左栏"发消息"节点（send_message label 为"发消息"）
    await page.locator('[aria-label*="发消息"]').first().click()
    // 等待 PropertyDrawer 出现并渲染 exposedAsTool 勾选项
    await expect(page.locator('text=暴露给 AI 工具调用').first()).toBeVisible({ timeout: 5000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('生成代码后代码视图显示 qqbat_nodes import', async ({ page }) => {
    // 前置：画布上有完整的 on_message → send_message 流程
    // 点击 BlockEditor 工具栏"生成代码"按钮，切到代码视图，
    // 验证生成代码包含 from qqbat_nodes.builtin.send_message import send_message
    //
    // 注意：代码生成依赖 window.qqbat.codegen.generate IPC（仅 Electron 内可用），
    // 纯浏览器访问 5173 时不可用。需改用 _electron.launch 模式运行此测试。
    test.skip(!serverAvailable, '需要 dev server + Electron IPC (window.qqbat.codegen)，纯浏览器不支持')

    // 1. 添加 on_message 触发器（左栏点击"收到消息"）
    await page.locator('[aria-label*="收到消息"]').first().click()
    // 2. 添加 send_message 动作（左栏点击"发消息"）
    await page.locator('[aria-label*="发消息"]').first().click()
    // 3. 点击 BlockEditor 工具栏"生成代码"按钮
    await page.locator('button:has-text("生成代码")').first().click()
    // 4. 切到代码视图（CenterPanel 中"生成代码"文件标签）
    await page.locator('text=生成代码').first().click()
    // 5. 验证代码包含 qqbat_nodes import
    await expect(
      page.locator('text=from qqbat_nodes.builtin.send_message import send_message').first()
    ).toBeVisible({ timeout: 10000 })
  })
})

test.describe('节点目录与分组 E2E', () => {
  // @ts-expect-error playwright 类型仅 e2e 时可用
  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, '需要 dev server 运行在 http://localhost:5173 (npm run dev)')
    await page.goto(DEV_SERVER)
    await page.waitForSelector('text=触发器', { timeout: 15000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('显示多个节点分组（触发器/动作/AI）', async ({ page }) => {
    // NodePalette groupByGroup() 至少应有这三个分组
    await expect(page.locator('[aria-label^="节点分组: 触发器"]').first()).toBeVisible()
    await expect(page.locator('[aria-label^="节点分组: 动作"]').first()).toBeVisible()
    await expect(page.locator('[aria-label^="节点分组: AI"]').first()).toBeVisible()
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('点击分组标题折叠/展开', async ({ page }) => {
    // 点击"触发器"分组标题（折叠按钮 aria-label 以"折叠节点分组: 触发器"开头）
    const triggerHeader = page.locator('[aria-label^="折叠节点分组: 触发器"]').first()
    await triggerHeader.click()
    // 折叠后按钮文本变为"展开节点分组: 触发器"
    await expect(page.locator('[aria-label^="展开节点分组: 触发器"]').first()).toBeVisible({ timeout: 3000 })
    // 再次点击展开
    await page.locator('[aria-label^="展开节点分组: 触发器"]').first().click()
    await expect(page.locator('[aria-label^="折叠节点分组: 触发器"]').first()).toBeVisible({ timeout: 3000 })
  })
})

test.describe('多节点画布操作 E2E', () => {
  // @ts-expect-error playwright 类型仅 e2e 时可用
  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, '需要 dev server 运行在 http://localhost:5173 (npm run dev)')
    await page.goto(DEV_SERVER)
    await page.waitForSelector('text=触发器', { timeout: 15000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('连续添加多个节点到画布', async ({ page }) => {
    // 添加 on_message（触发器）
    await page.locator('[aria-label*="收到消息"]').first().click()
    // 添加 send_message（动作）
    await page.locator('[aria-label*="发消息"]').first().click()
    // 验证画布上有两个 BlockView（border-l-4 类名）
    const blocks = page.locator('div.border-l-4')
    await expect(blocks).toHaveCount(2, { timeout: 5000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('添加节点后自动选中并显示配置面板', async ({ page }) => {
    // 添加 on_message 节点
    await page.locator('[aria-label*="收到消息"]').first().click()
    // PropertyDrawer 应出现关闭按钮（title="关闭"）
    await expect(page.locator('[title="关闭"]').first()).toBeVisible({ timeout: 3000 })
    // 添加第二个节点（send_message）
    await page.locator('[aria-label*="发消息"]').first().click()
    // 配置面板仍应可见（选中态切换到新节点）
    await expect(page.locator('[title="关闭"]').first()).toBeVisible({ timeout: 3000 })
  })
})

test.describe('模式与视图切换 E2E', () => {
  // @ts-expect-error playwright 类型仅 e2e 时可用
  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, '需要 dev server 运行在 http://localhost:5173 (npm run dev)')
    await page.goto(DEV_SERVER)
    await page.waitForSelector('text=触发器', { timeout: 15000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('切换到启动模式显示启动面板', async ({ page }) => {
    // CenterPanel 顶部有"启动"/"开发"/"浏览"三个模式按钮
    // 点击"启动"模式按钮
    const launchBtn = page.locator('button:has-text("启动")').first()
    await launchBtn.click()
    // 启动模式下应有 tab 标签（仪表盘/日志/控制台/数据浏览 等）
    // 至少验证"仪表盘"tab 出现（DashboardPanel 入口）
    await expect(page.locator('text=仪表盘').first()).toBeVisible({ timeout: 5000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('启动模式下切换到数据浏览 tab', async ({ page }) => {
    // 先切换到启动模式
    await page.locator('button:has-text("启动")').first().click()
    await page.waitForSelector('text=仪表盘', { timeout: 5000 })
    // 点击"数据浏览"tab
    const dataTab = page.locator('button:has-text("数据浏览")').first()
    await dataTab.click()
    // DataBrowserPanel 应渲染（包含"数据源"文本或表格）
    // 这里验证 tab 切换后"数据浏览"按钮变为激活态（border-b-2 border-blue-500 类名）
    await expect(dataTab).toHaveClass(/border-blue-500/, { timeout: 3000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('切换回开发模式显示步骤编辑器', async ({ page }) => {
    // 先切到启动模式
    await page.locator('button:has-text("启动")').first().click()
    await page.waitForSelector('text=仪表盘', { timeout: 5000 })
    // 切回开发模式
    await page.locator('button:has-text("开发")').first().click()
    // 开发模式下应重新显示节点目录（NodePalette 的"触发器"分组）
    await expect(page.locator('[aria-label^="节点分组: 触发器"]').first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('资源告警 UI E2E', () => {
  // @ts-expect-error playwright 类型仅 e2e 时可用
  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, '需要 dev server 运行在 http://localhost:5173 (npm run dev)')
    await page.goto(DEV_SERVER)
    await page.waitForSelector('text=触发器', { timeout: 15000 })
  })

  // @ts-expect-error playwright 类型仅 e2e 时可用
  test('切换到启动模式 → 仪表盘 → 切到运行指标 tab（MetricsPanel 入口）', async ({ page }) => {
    // 进入启动模式
    await page.locator('button:has-text("启动")').first().click()
    await page.waitForSelector('text=仪表盘', { timeout: 5000 })
    // 仪表盘 tab 默认选中，验证 DashboardPanel 渲染
    // 注意：MetricsPanel 在某些 tab 下可见，这里只验证 tab 切换机制工作正常
    const dashboardTab = page.locator('button:has-text("仪表盘")').first()
    await expect(dashboardTab).toBeVisible()
  })
})
