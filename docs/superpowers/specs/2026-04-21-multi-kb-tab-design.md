# TopoMind 多知识库 Tab 页管理设计方案

> 日期：2026-04-21
> 状态：已批准

## 概述

支持同时打开多个知识库，以 Tab 页形式管理。主页作为固定不可关闭的 Tab，知识库以 Tab 页形式打开，可同时存在多个 Tab，关闭 Tab 时检测未保存内容并提示。同一知识库复用已有 Tab，不重复打开。仅有一个 Tab（主页）时不显示 Tab 栏。

## 数据模型

### Tab 接口

```typescript
interface Tab {
  id: string                    // 唯一标识：'home' | `kb:${path}`
  type: 'home' | 'kb'
  label: string                 // Tab 显示名称，主页为"主页"，知识库为知识库名称
  kbPath?: string               // 仅 type='kb' 时存在
  isDirty: boolean              // 是否有未保存更改
}
```

### Tab Store（tabStore.ts）

使用 Zustand 管理 Tab 列表和当前激活 Tab：

- `tabs: Tab[]` — 所有打开的 Tab
- `activeTabId: string` — 当前激活的 Tab ID
- Actions: `addTab`, `removeTab`, `setActiveTab`, `setTabDirty`, `initHomeTab`

初始化时自动创建主页 Tab：`{ id: 'home', type: 'home', label: '主页', isDirty: false }`

## 组件架构

```
App
├── TabBar                          // 仅 tabs.length > 1 时渲染
│   └── TabItem × N
│       ├── Tab 标题（isDirty 时标题后加 " •"）
│       └── 关闭按钮（主页不可关闭）
└── 条件渲染
    ├── activeTab.type === 'home' → HomePage
    └── activeTab.type === 'kb'   → GraphPage（含独立 GraphContextProvider）
```

每个知识库 Tab 的 GraphPage 实例拥有独立的：
- `GraphContextProvider` → `useGraph()` 实例
- React Flow 内部状态
- 节点/边的内存状态

各 Tab 数据完全隔离，无跨 Tab 状态污染。

## 打开知识库逻辑

```
openKB(kb)
  → 检查 tabs 中是否存在 id === `kb:${kb.path}` 的 Tab
     → 存在：setActiveTab(该 Tab ID)
     → 不存在：
         → 创建新 Tab：{ id: `kb:${kb.path}`, type: 'kb', label: kb.name, kbPath: kb.path, isDirty: false }
         → addTab(newTab)
         → setActiveTab(newTab.id)
```

## 关闭 Tab 逻辑

```
closeTab(tabId)
  → 查找 Tab
     → Tab 为 'home'：不执行关闭
     → Tab.isDirty === false：直接 removeTab
     → Tab.isDirty === true：
         → 弹窗提示："知识库 "{label}" 有未保存的更改，关闭前是否保存？"
           [保存] [不保存] [取消]
           → 保存：flush → removeTab
           → 不保存：removeTab
           → 取消：不做任何操作
```

## 脏状态同步

- **设置 dirty**：GraphPage 内部使用 `useGraphContext()` 读取 `graph.isModified`
  - 节点/边增删改 → useGraph 内部设置 `isModified = true`
  - 定期轮询 dirty 状态（每秒一次），调用 `tabStore.getState().setTabDirty(activeTabId, true)`
- **清除 dirty**：Debounce 保存成功（flush 完成）后，调用 `setTabDirty(tabId, false)`

## 布局细节

- TabBar 固定在页面顶部，高度约 40px
- 内容区域（HomePage 或 GraphPage）占满剩余高度
- 仅有一个 Tab 时完全隐藏 TabBar，内容区直接贴顶
- TabBar 样式与现有 TopoMind 设计语言一致

## 交互规范

| 操作 | 行为 |
|------|------|
| 点击 Tab | 切换激活 Tab |
| 点击关闭按钮 | 触发关闭逻辑 |
| 点击"主页" | setActiveTab('home') |
| HomePage 点击知识库卡片 | 打开知识库 Tab |
| 打开已有知识库 | 切换到对应 Tab，不重复创建 |

## 实现计划

1. 新建 `src/stores/tabStore.ts`
2. 新建 `src/components/TabBar/TabBar.tsx` + `TabBar.module.css`
3. 修改 `src/App.tsx`：渲染 TabBar + 条件路由内容
4. 修改 `src/components/HomePage.tsx`：点击知识库时通过 tabStore 打开 Tab
5. 修改 `src/components/GraphPage.tsx`：注册 dirty 状态同步逻辑
6. 调整样式：确保内容区无 Tab 时贴顶

## 边界情况

- **只剩主页 Tab 时关闭**：主页不可关闭，若除主页外所有 Tab 均已关闭，TabBar 自动隐藏
- **刷新页面**：Tab 状态仅存在于内存，刷新后恢复为仅有主页（产品可接受）
- **同名知识库**：通过路径（kbPath）区分，Tab ID = `kb:${path}`，绝对唯一