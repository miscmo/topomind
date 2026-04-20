# TopoMind 规范文档

**项目**：TopoMind — 可漫游拓扑知识大脑
**版本**：v5.2.0
**最后更新**：2026-04-20
**状态**：已实现

---

## 1. 项目概述

TopoMind 是一个知识大脑工具，核心是**知识卡片房间**模型——每个知识域是一个可视化容器卡片，双击即可"走进"查看内部子概念，支持无限层级嵌套。用于 AI / 计算机领域知识沉淀与学习。

### 1.1 核心定位

| 维度 | 说明 |
|------|------|
| 可视化 | 拓扑地图、React Flow + ELK 分层布局 |
| 交互 | 卡片房间钻入/钻出、缩放漫游、分层显示 |
| 内容 | 节点 = 知识卡片；连线 = 概念关系；每张卡片绑定 Markdown 文档 |
| 编辑 | 双击空白创建、Tab 添加子节点、右侧面板内联编辑 Markdown |
| 持久化 | 纯文件系统存储（Node.js fs），每个 KB 和卡片对应一个磁盘目录 |
| 模式 | Electron 桌面应用（Vite + React 18 构建） |

---

## 2. 技术栈（强制）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | React 18 | 18.3.1 | 组件化 UI |
| 渲染库 | React Flow | 12.4.0 | 节点/边渲染、交互 |
| 构建工具 | Vite | 5.2.8 | 开发服务器 + 生产构建 |
| 状态管理 | Zustand | 5.0.3 | 全局状态管理 |
| 布局算法 | elkjs | 0.9.3 | ELK 分层拓扑布局计算 |
| Markdown | marked.js | 12.0.0 | Markdown → HTML 渲染 |
| 持久化 | Node.js fs | 原生 | 纯文件系统存储（Electron 端） |
| 桌面端 | Electron | 30.5.1 | 桌面应用壳 |
| Git | simple-git | 3.35.2 | 知识库版本控制 |

---

## 3. 项目结构

```
topomind_cc/
├── index.html                    # 主入口
├── package.json                   # 依赖 + 构建脚本
├── vite.config.js                 # Vite 配置（含 Electron 插件）
├── tsconfig.json                  # TypeScript 配置
├── SPEC.md                        # 本规范文档
├── README.md
├── electron/                      # Electron 桌面端
│   ├── main.js                   # 主进程（合并版：窗口、菜单、IPC、文件服务、Git 服务）
│   └── preload.js               # 预加载（contextBridge 暴露 IPC 白名单）
└── src/
    ├── main.tsx                  # React 应用入口
    ├── App.tsx                   # 根组件（ReactFlowProvider + 视图路由）
    ├── types/
    │   └── index.ts             # 全局 TypeScript 类型定义
    ├── stores/
    │   ├── appStore.ts          # 应用状态（view、selectedNodeId、edgeMode 等）
    │   ├── roomStore.ts         # 房间状态（currentKBPath、currentRoomPath、roomHistory）
    │   ├── gitStore.ts          # Git 状态（token、authType、SSHKey）
    │   └── monitorStore.ts      # 日志/性能监控窗口状态
    ├── core/                     # 核心工具层（Electron IPC 桥接）
    │   ├── fs-backend.ts        # IPC 桥接（调用 window.electronAPI）
    │   ├── storage.ts           # 统一存储适配器（业务层唯一入口）
    │   ├── git-backend.ts       # Git 后端（缓存 + 批处理）
    │   ├── logger.ts            # 日志工具（logger.catch 记录带堆栈的异常）
    │   └── log-backend.ts       # 日志 IPC 桥接（读写主进程日志服务）（业务层唯一入口）
    ├── hooks/
    │   ├── useGraph.ts          # 图谱引擎（房间加载、节点/边 CRUD、布局保存、交互事件）
    │   ├── useLayout.ts         # ELK 布局封装
    │   ├── useStorage.ts        # 存储层 hook（封装 FSB）
    │   ├── useGit.ts            # Git 操作 hook
    │   ├── useKeyboard.ts       # 快捷键处理（Esc/Tab/Delete/Backspace）
    │   └── useContextMenu.ts    # 右键菜单逻辑
    ├── nodes/
    │   ├── KnowledgeCard.tsx    # React Flow 自定义节点组件
    │   └── KnowledgeCard.module.css
    ├── components/
    │   ├── SetupPage.tsx        # 工作目录选择页
    │   ├── SetupPage.module.css
    │   ├── HomePage.tsx         # 知识库首页（KB 卡片列表）
    │   ├── HomePage.module.css
    │   ├── GraphPage.tsx        # 图谱视图（画布 + 覆盖层 UI）
    │   ├── GraphPage.module.css
    │   ├── DetailPanel/         # 右侧详情面板
    │   │   ├── DetailPanel.tsx
    │   │   ├── MarkdownEditor.tsx
    │   │   └── DetailPanel.module.css
    │   ├── NavTree/             # 左侧导航树
    │   │   ├── NavTree.tsx
    │   │   └── NavTree.module.css
    │   ├── Breadcrumb/          # 面包屑导航
    │   │   ├── Breadcrumb.tsx
    │   │   └── Breadcrumb.module.css
    │   ├── Toolbar/             # 工具栏
    │   │   ├── Toolbar.tsx
    │   │   └── Toolbar.module.css
    │   ├── SearchBar/           # 搜索框
    │   │   ├── SearchBar.tsx
    │   │   └── SearchBar.module.css
    │   ├── ContextMenu/         # 右键菜单
    │   │   ├── ContextMenu.tsx
    │   │   └── ContextMenu.module.css
    │   └── GitPanel/           # Git 状态面板（底部弹出）
    │       ├── GitPanel.tsx
    │       └── GitPanel.module.css
    │   └── MonitorPage/        # 日志性能监控窗口（独立页面）
    │       ├── MonitorPage.tsx
    │       └── MonitorPage.module.css
    └── styles/
        └── base.css             # 全局基础样式（Markdown 渲染、字体等）
```

---

## 4. 数据结构规范

### 4.1 目录结构（核心设计）

**目录即结构**：每个知识库（KB）是一个顶层目录，每个卡片是其子目录，支持无限嵌套层级。

```
{工作目录}/
├── _config.json                 # 应用级配置（根目录）
├── 知识库-A/                    # 顶层 KB 目录
│   ├── _graph.json              # KB 的图结构（children + edges + zoom + pan + canvasBounds）
│   ├── images/
│   │   └── cover.png            # KB 封面图
│   ├── 子卡片-1/                # 第一层卡片
│   │   ├── _graph.json          # 卡片的图结构
│   │   ├── README.md            # Markdown 文档
│   │   └── images/              # 卡片内图片
│   │       └── *.png|jpg|webp
│   └── 子卡片-2/
│       ├── _graph.json
│       ├── README.md
│       └── 子子卡片/            # 第二层卡片（无限嵌套）
│           └── ...
└── 知识库-B/
    └── ...
```

### 4.2 `_graph.json` 结构

每个 KB 和卡片目录下有一份 `_graph.json`，存储该目录的直接子卡片信息：

```javascript
{
  "children": {
    "子卡片-1": { "name": "显示名称" },   // key = 目录名，name = 显示名称（可不同）
    "子卡片-2": { "name": "另一个名称" }
  },
  "edges": [
    { "id": "e-1", "source": "子卡片-1", "target": "子卡片-2", "relation": "演进", "weight": "main" }
  ],
  "zoom": 1.0,                          // 缩放比例（可选）
  "pan": { "x": 0, "y": 0 },            // 平移偏移（可选）
  "canvasBounds": {                      // 有限画布边界（可选）
    "width": 1500,
    "height": 1000
  }
}
```

> **注意**：`children` 的 key 是**目录名**（磁盘实际文件夹名），`name` 是**显示名称**（可不同）。节点 ID 即路径（如 `知识库-A/子卡片-1`），在父目录内唯一。

### 4.3 `_config.json` 结构（根目录）

```javascript
{
  "lastOpenedKB": "知识库-A",           // 上次打开的 KB 相对路径
  "orders": {                           // 各 KB 的排序序号
    "知识库-A": 0,
    "知识库-B": 1
  },
  "covers": {                           // 各 KB 的封面图路径
    "知识库-A": "images/cover.png"
  }
}
```

### 4.4 边 (Edge)

```javascript
{
  id: string,           // 唯一 ID（如 'e-1'）
  source: string,       // 源卡片目录名（在当前 room 内的唯一 key）
  target: string,       // 目标卡片目录名
  relation: string,     // 关系类型：'演进' | '依赖' | '相关'
  weight: string        // 'main'（主线）| 'minor'（次线）
}
```

### 4.5 节点 (Node) — React Flow 内存结构

在 React Flow 图谱中的内存结构：

```typescript
// React Flow Node
interface KBNode {
  id: string           // 节点 ID = 路径字符串（如 '知识库-A/子卡片-1'）
  type: 'knowledgeCard'
  position: { x: number; y: number }  // 画布坐标
  data: {
    label: string     // 显示名称
    path: string      // 磁盘路径（相对路径）
    parent: string     // 父节点 ID（顶层 KB 无 parent）
    hasChildren: boolean  // 是否有子节点
  }
}

// React Flow Edge
interface KBEdge {
  id: string
  source: string       // 源节点 ID
  target: string       // 目标节点 ID
  relation: string     // 关系类型
  weight: string       // 'main' | 'minor'
}
```

### 4.6 Markdown 文档

每张卡片目录下有一个 `README.md` 文件，内容为该卡片的 Markdown 文档。图片以相对路径引用（如 `images/xxx.png`）。

### 4.7 颜色方案

颜色在 `src/nodes/KnowledgeCard.module.css` 中以常量定义，按领域分组（8 大领域）。子节点继承父节点颜色。

---

## 5. 功能需求

### 5.1 界面布局（三栏固定分栏）

#### 左侧导航面板（200px 固定宽度）

- 标题栏：显示 "🧠 知识目录"
- 导航树：动态生成，显示当前房间的直接子节点
  - 每项左侧有域颜色竖条
  - 有子概念的项显示数量徽标
  - 每项右侧有 "＋" 快捷添加子节点按钮
  - 当前选中项蓝色高亮
- 进入房间后顶部显示 "← 返回上一层" 按钮
- 底部显示 "＋ 新建卡片" 虚线按钮
- 单击导航项：选中节点 + 显示详情
- 双击导航项：钻入该节点房间

#### 中间图谱画布（flex:1 填充）

- **底层**：React Flow + 点阵网格背景（可切换显示/隐藏）
- **覆盖层 UI**：
  - 顶部居中：标题栏（当前房间名或应用名称）
  - 标题下方：面包屑导航（仅在房间内显示）
  - 左上角：关系图例（演进绿/依赖橙/相关灰虚线）
  - 右上角：搜索输入框
  - 左下角：缩放百分比指示器
  - 右下角：缩放控制按钮组（＋/－/⊡）
  - 底部居中：工具栏

#### 右侧详情面板（320px 固定宽度，可拖拽调整）

- 标题栏：节点名称 + 域颜色竖条
- 操作按钮行：
  - ✏️ 编辑（切换到内联编辑模式）
  - 📷 图片（插入本地图片）
  - ⚙ 属性（打开节点属性模态框）
  - 🗑 删除（确认删除节点）
  - 阅读/编辑 模式切换按钮组
- 内容区：
  - 阅读模式：Markdown 渲染 HTML + 子概念标签云
  - 编辑模式：textarea 内联 Markdown 编辑器
  - 默认：占位提示 "📖 点击节点查看详情"
- 可拖拽调整宽度（180px~600px），拖拽时高亮蓝色指示条
- 可折叠收起，折叠后右侧边缘显示展开按钮

---

### 5.2 知识卡片房间模型（核心）

这是应用的核心交互范式，实现无限层级的钻入/钻出导航。

#### 概念

- **卡片 (Card)**：每个节点渲染为一张卡片（React Flow 自定义节点）
  - 有子节点的卡片 = **容器卡片**（浅色背景 + 彩色边框，内部包含子节点）
  - 无子节点的卡片 = **叶子卡片**（深色填充 + 白色文字）
- **房间 (Room)**：任何有子节点的卡片都可以作为一个"房间"
- **当前视野**：`null`（全局）或某个房间路径

#### 进入房间 (loadRoom)

1. 保存当前编辑内容
2. 确定可见元素：
   - 全局视野（null）：仅显示顶层 KB 节点 + 它们之间的边
   - 房间内（非 null）：父容器设为透明不可交互，仅显示其直接子节点 + 子节点之间的边
3. 次线边（`weight=minor`）仅在 zoom ≥ 0.8 时显示
4. **智能布局判断**：
   - 如果可见节点已有合理位置（非零、非重叠 >30%）→ 仅居中
   - 否则 → 执行 ELK 布局（全局方向 RIGHT，房间内方向 DOWN）
5. 更新面包屑、导航树、标题、缩放指示器
6. 自动保存状态

#### 钻入 (drillInto)

- 有子节点 → 将当前房间压入历史栈，进入新房间
- 叶子节点 → 仅选中并显示详情

#### 返回 (goBack)

- 从历史栈弹出上一层房间
- 历史栈为空时返回全局视野

#### 面包屑导航

- 格式：`🏠 全局 › 父房间名 › ... › 当前房间名`
- 每个历史层级可点击直接跳转
- "🏠 全局" 链接清空历史回到顶层

#### 父容器透明化

进入房间后，父容器节点设为 `opacity: 0`，pointer-events none，不响应鼠标事件。

---

### 5.3 节点交互

| 操作 | 目标 | 效果 |
|------|------|------|
| 单击节点 | 图谱节点 | 选中节点，右侧显示 Markdown 详情，导航树同步高亮 |
| 双击节点 | 图谱节点 | 有子节点→钻入房间；叶子→选中并显示详情 |
| 单击空白 | 图谱背景 | 取消选中，显示占位提示 |
| 双击空白 | 图谱背景 | 弹出输入框，在当前房间创建新卡片（400ms 内同一位置两次点击触发） |
| 右击节点 | 图谱节点 | 弹出节点右键菜单 |
| 右击边 | 图谱边 | 弹出边右键菜单（编辑关系 / 删除） |
| 悬停节点 | 图谱节点 | 高亮该节点及关联边/邻居，其他元素淡化 |
| 拖拽节点 | 图谱节点 | 移动位置，释放后自动保存 |
| 滚轮 | 图谱 | 缩放画布（范围 15%~350%） |
| 左键框选 | 图谱背景 | 多选节点 |

---

### 5.4 键盘快捷键

| 按键 | 前提条件 | 效果 |
|------|---------|------|
| `Escape` | 任何时候 | 关闭所有模态框；取消连线模式；清空搜索；关闭详情面板收起；输入框失焦 |
| `Tab` | 有选中节点，不在输入框/模态框中 | 弹出输入框为选中节点添加子概念 |
| `Delete` | 有选中节点，不在输入框/模态框中 | 弹出删除确认，删除选中节点 |
| `Backspace` | 有选中节点，不在输入框/模态框中 | 同 Delete — 弹出删除确认，删除选中节点 |

---

### 5.5 右键菜单

#### 节点右键菜单

| 菜单项 | 功能 |
|--------|------|
| ＋ 新建子节点 | 弹出输入框添加子概念 |
| 聚焦节点 | 聚焦该节点（fitView）并选中 |
| 重命名 | 弹出输入框修改节点名称 |
| 属性 | 选中节点，打开右侧详情面板 |
| ——— | 分割线 |
| 🗑 删除节点 | 弹出删除确认 |

#### 边右键菜单

| 菜单项 | 功能 |
|--------|------|
| 🗑 删除连线 | 直接删除该边 |

---

### 5.6 工具栏按钮

| 按钮 | 功能 |
|------|------|
| ＋ 节点 | 在当前房间新建卡片 |
| ⤯ 连线 | 进入连线模式（以选中节点为源，依次点击源→目标） |
| ⊞ 网格 | 切换网格背景显示/隐藏 |
| ↺ 重置 | 清除所有保存数据，恢复默认（带确认） |
| Git | 展开/收起 Git 状态面板 |

#### 缩放控制按钮

| 按钮 | 功能 |
|------|------|
| ＋ | 放大 |
| － | 缩小 |
| ⊡ | 适配全部可见元素到视口 |

---

### 5.7 模态框

#### 输入模态框

- 字段：输入框（支持默认值）
- 操作：取消 / 确认

#### 确认模态框

- 显示待删除/确认内容
- 操作：取消 / 确认

#### 创建知识库表单

- 字段：知识库名称
- 操作：取消 / 创建

#### 导入知识库

- 选择本地已有知识库目录
- 操作：取消 / 导入

#### 设置面板

- 字段：Git Token、认证类型选择
- 操作：保存 / 取消

---

### 5.8 Markdown 详情

每个卡片的 Markdown 文档渲染：

- 定义
- 核心思想
- 结构 / 关键点
- 应用场景
- 关联知识点
- 代码块
- 链接、图片、列表、表格

渲染配置：`marked.js`，`breaks: true, gfm: true`

详情面板额外展示：如果节点有子概念，在文档下方显示**子概念标签云**（彩色圆角标签，可点击钻入）。

---

### 5.9 搜索功能

- 位于图谱面板右上角
- 实时搜索（`input` 事件触发）
- 搜索范围：节点 `label` 和目录名
- 匹配方式：大小写不敏感子串匹配
- 匹配节点添加高亮边框
- 清空输入 / 按 Esc 移除高亮

---

### 5.10 网格背景系统

- **实现**：React Flow 内置 `<Background>` 组件
- **网格样式**：点阵 dots，间距 20px，大小 1px，颜色 `#c8cdd6`
- **开关**：工具栏 "⊞" 按钮切换 `showGrid` 状态

---

### 5.11 持久化存储（纯文件系统）

#### 存储架构

所有数据存储在用户选择的**工作目录**中，采用纯文件系统存储，无 IndexedDB 依赖。

```
{工作目录}/
├── _config.json                 # 应用配置（lastOpenedKB、orders、covers）
├── 知识库-A/
│   ├── _graph.json              # children + edges + zoom + pan + canvasBounds
│   ├── images/
│   │   └── cover.png            # 封面图
│   ├── 子卡片-1/
│   │   ├── _graph.json          # 子卡片的图结构
│   │   ├── README.md            # Markdown 文档
│   │   └── images/              # 图片文件
│   └── 子卡片-2/
│       └── ...
└── 知识库-B/
    └── ...
```

#### 存储层架构

| 文件 | 职责 |
|------|------|
| `src/core/fs-backend.ts` | IPC 桥接层，通过 `window.electronAPI.invoke()` 调用 Electron 主进程 |
| `src/core/storage.ts` | 统一存储适配器，业务层唯一入口。封装 FSB 调用，添加校验、防抖、Blob URL 管理 |
| `src/core/log-backend.ts` | 日志 IPC 桥接。封装日志读写、实时订阅、`logAction` 快捷构造器 |
| `electron/main.js` | 主进程实现，包含文件服务（Node.js fs）、Git 服务（simple-git）和日志服务（LogService） |

#### 保存触发时机

| 时机 | 写入方式 |
|------|----------|
| 节点拖拽释放 | 批量更新 `_graph.json`（防抖） |
| 新增/删除节点 | 更新父目录的 `_graph.json` |
| 重命名节点 | 更新父目录 `_graph.json.children[name]` |
| 新增/删除连线 | 更新当前目录 `_graph.json.edges` |
| Markdown 编辑 | 写入 `cardPath/README.md` |
| 切换阅读/编辑模式 | 写入 `cardPath/README.md` |
| 图片粘贴/拖拽 | 写入 `cardPath/images/` + 更新 README.md |
| 页面关闭前 | 同步写入全部未保存内容 |

#### 迁移能力

| 场景 | 方式 |
|------|------|
| 拷贝到另一台电脑 | 整个工作目录拷贝 → 打开 TopoMind → 选择该目录 |
| Git 版本管理 | 对工作目录 `git init`，内置 Git 支持 |
| 网盘同步 | 工作目录放在 iCloud/OneDrive 中 |

---

### 5.12 Git 版本控制

内置 Git 支持（通过 `simple-git`），允许对知识库进行版本管理。

#### Git 功能

- 初始化仓库（init）
- 状态查看（status）
- 批量状态查询（statusBatch，并发 3 个）
- 脏检测（isDirty）
- 提交变更（commit）
- 查看日志（log）
- 查看差异（diff）
- 文件差异（diffFiles）
- 推送（push）/ 拉取（pull）/ 获取（fetch）
- 远程管理（remote get/set）
- 冲突检测与解决（conflict list/show/resolve/complete）
- 认证管理（token / SSH key）

#### 认证方式

支持两种认证方式（通过 `git:auth:setAuthType` 设置）：

- **Token 认证**：通过 `git:auth:setToken` 设置 GitHub/Gitea token
- **SSH 密钥**：通过 `git:auth:getSSHKey` 获取应用生成的 SSH 公钥

#### Git 面板 UI

Git 面板是底部弹出的可折叠面板，通过工具栏 Git 按钮展开/收起。面板结构：

- **标题栏**：左侧显示 "Git" 标签 + 状态徽章（修改数/未跟踪数/已删除数） + 工作状态指示器（● dirty / ✓ clean）；右侧显示远程 URL + 操作按钮组（Fetch / Pull / Push / Commit）
- **状态徽章**：修改数（橙）、未跟踪数（绿）、已删除数（红）
- **提交框**（点击 Commit 按钮展开）：显示变更文件列表 + 提交信息 textarea + 确认/取消按钮
- **按钮状态**：无远程仓库时 Fetch/Pull/Push 禁用；无变更时 Commit 禁用；操作进行中所有按钮禁用

#### Git 功能列表

| 按钮 | 功能 |
|------|------|
| ↓ Fetch | 获取远程引用（不合并） |
| ↓ Pull | 拉取远程变更并合并 |
| ↑ Push | 推送本地提交到远程 |
| ✓ Commit | 展开提交框，输入提交信息后确认提交 |

---

---

### 5.13 缩放联动显示规则

| 缩放级别 | 显示内容 |
|----------|----------|
| < 60% | 主线边隐藏文字标签 |
| 60% ~ 80% | 主线边显示标签（演进/依赖），次线边（相关）隐藏 |
| ≥ 80% | 次线边也显示 |

---

### 5.14 日志与性能监控系统

通过 Electron 菜单「视图 → 日志性能监控」打开独立的监控窗口。

#### 日志架构

| 文件 | 职责 |
|------|------|
| `src/core/log-backend.ts` | 渲染进程 IPC 桥接，封装日志读写与实时订阅 |
| `src/stores/monitorStore.ts` | Zustand store，管理日志列表、筛选条件、统计 |
| `src/components/MonitorPage/` | 独立监控窗口 UI |
| `electron/main.js` LogService | 主进程日志服务，按日期分文件写入 + 实时广播 |

#### 日志条目结构

```typescript
interface LogEntry {
  id?: string          // 唯一标识
  timestamp: string    // ISO 时间戳
  level: string        // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module?: string      // 来源模块名
  action?: string      // 关键动作标识，如 '节点:选中'
  message?: string     // 消息文本
  params?: object      // 附加参数
  func?: string        // 函数名
  file?: string        // 文件路径
  line?: number        // 行号
  traceId?: string    // 链路追踪 ID
  spanId?: string     // 跨度 ID
  parentId?: string   // 父跨度 ID
  meta?: object       // 额外元数据
}
```

#### 日志 API（src/core/log-backend.ts）

| 函数 | 功能 |
|------|------|
| `logWrite(entry)` | 写入一条日志到文件 |
| `logGetBuffer()` | 获取内存缓冲区（最新 2000 条） |
| `logQuery(opts)` | 查询历史日志文件 |
| `logSetLevel(level)` | 设置日志等级 |
| `logClear()` | 清除内存缓冲区 |
| `logGetAvailableDates()` | 获取有日志文件的日期列表 |
| `logGetLogDir()` | 获取日志目录路径 |
| `logSubscribe(callback)` | 订阅实时日志流（WebSocket 广播） |
| `logUnsubscribe(callback)` | 取消订阅 |
| `logAction(action, module, params)` | 便捷构造器，写入关键动作日志 |

#### 日志过滤器

监控窗口支持多维度过滤：
- **关键词搜索**：大小写不敏感子串匹配（message、action、module、func、params）
- **日期选择**：下拉选择日志日期，不选则默认当天
- **等级过滤**：DEBUG / INFO / WARN / ERROR 复选按钮
- **实时流开关**：可暂停/恢复实时日志接收

#### 显示规则

- 日志按等级排序：ERROR → WARN → INFO → DEBUG
- ERROR 行红色高亮，WARN 行橙色高亮
- 选中的日志条目显示详情面板（时间、ID、模块、动作、函数位置、消息、参数、链路追踪、元数据）
- 支持一键复制 JSON

#### 性能监控 Tab

预留功能，后续版本将集成性能指标可视化。

---

## 6. 视觉风格规范

### 6.1 色彩体系

| 角色 | 色值 | 用途 |
|------|------|------|
| 主色调 | `#1a3a5c` | 标题、按钮主色、导航高亮 |
| 强调色 | `#3498db` | 选中边框、搜索焦点 |
| 页面背景 | `#f0f2f5` | 全局背景 |
| 面板背景 | `#fff` | 三个面板 |
| 画布背景 | `#eef0f4` | 图谱画布区 |
| 主文字 | `#2d3436` | 正文 |
| 次要文字 | `#555` | 标签、提示 |
| 边框 | `#e0e4ea` / `#e8ecf0` | 分割线 |
| 危险色 | `#e74c3c` | 删除按钮 |
| 成功色 | `#2ecc71` | 保存指示器 |
| 搜索匹配 | `#f1c40f` | 搜索高亮 |
| 悬停高亮 | `#f39c12` | 节点悬停边框 |
| 演进边色 | `#5cb85c` | 演进关系 |
| 依赖边色 | `#e8913a` | 依赖关系 |
| 次线边色 | `#ccc` | 相关关系 |

### 6.2 字体

- 系统字体：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- 代码字体：`"SF Mono", "Fira Code", Consolas, monospace`

### 6.3 圆角

- 模态框：12px / 14px
- 工具栏/标题栏：10px / 8px
- 按钮：7px / 6px / 8px
- 悬停操作按钮：50%（圆形）
- 叶子节点：8px
- 容器节点：12px

### 6.4 交互效果

- 毛玻璃：`backdrop-filter:blur(6px)` + 半透明白（标题、工具栏、图例、搜索、面包屑）
- 过渡动画：节点属性 0.3s、按钮 hover 0.12~0.15s
- 节点阴影：微阴影增加层次
- 模态框遮罩：`backdrop-filter:blur(2px)` + 半透明黑

### 6.5 Markdown 渲染样式

- h1：20px 深蓝 + 底部 2px 分割线
- h2：16px 蓝色
- h3：14px 青蓝色
- 代码块：深色背景 `#1a2332` + 浅色文字
- 行内代码：浅灰背景 + 红色文字 `#c0392b`
- 引用块：左侧蓝色竖条 + 浅蓝背景
- 表格：完整边框 + 灰色表头

---

## 7. React Flow 图谱配置

### 7.1 引擎参数

```tsx
<ReactFlow
  minZoom={0.15}
  maxZoom={3.5}
  defaultViewport={{ x: 0, y: 0, zoom: 1 }}
  proOptions={{ hideAttribution: true }}
  nodesDraggable
  nodesConnectable
  elementsSelectable
/>
```

### 7.2 节点样式（KnowledgeCard）

| 状态 | 关键样式 |
|------|----------|
| 容器节点（hasChildren=true） | 浅色背景 + 彩色边框，顶部标签 |
| 叶子节点（hasChildren=false） | 深色填充 + 白色文字 |
| 选中 | 蓝色 `#3498db` 边框 |
| 悬停 | 橙色边框 |
| 高亮搜索匹配 | 金黄色边框 |
| 淡化 | 透明度降低 |
| 房间活动（父容器） | 完全透明不可交互 |

### 7.3 边样式

| 类型 | 关键样式 |
|------|----------|
| 主线边（weight=main） | 2px bezier 曲线，箭头 |
| 演进边 | 绿色 `#5cb85c` |
| 依赖边 | 橙色 `#e8913a` |
| 次线边（weight=minor） | 1px dotted，灰色，透明度降低，无箭头 |
| 高亮边 | 3px，透明度 1 |
| 淡化边 | 透明度极低 |

### 7.4 布局算法

- 算法：ELK js（`elkjs` 库）
- 全局视野方向：RIGHT
- 房间内方向：DOWN
- 节点间距：动态 `max(30, 70 - nodeCount * 2)`
- 层间距：节点间距 + 25

---

## 8. 全局状态管理（Zustand）

### 8.1 appStore

| 状态/动作 | 类型 | 说明 |
|----------|------|------|
| `view` | `'setup' \| 'home' \| 'graph'` | 当前视图 |
| `selectedNodeId` | `string \| null` | 当前选中节点 ID |
| `edgeMode` | `boolean` | 是否处于连线模式 |
| `edgeModeSourceId` | `string \| null` | 连线模式的源节点 ID |
| `autoIdCounter` | `number` | 自动 ID 计数器 |
| `showGrid` | `boolean` | 是否显示网格背景 |
| `searchQuery` | `string` | 搜索关键词 |
| `rightPanelCollapsed` | `boolean` | 右侧面板是否折叠 |
| `rightPanelWidth` | `number` | 右侧面板宽度 |
| `autoId()` | action | 生成唯一节点 ID |
| `showGraph()` | action | 进入图谱视图 |
| `showHome()` | action | 返回首页 |
| `selectNode(nodeId)` | action | 选中节点 |
| `clearSelection()` | action | 取消选中 |
| `enterEdgeMode(sourceId)` | action | 进入连线模式 |
| `exitEdgeMode()` | action | 退出连线模式 |

### 8.2 roomStore（vanilla store 模式，支持 `getState()` 外部访问）

| 状态/动作 | 类型 | 说明 |
|----------|------|------|
| `currentKBPath` | `string` | 当前知识库路径 |
| `currentRoomPath` | `string` | 当前房间路径（null = 全局） |
| `roomHistory` | `RoomHistory[]` | 房间历史栈 |
| `enterRoom({ path, kbPath, name })` | action | 进入房间 |
| `goBack()` | action | 返回上一层 |
| `goToRoom(item)` | action | 跳转到历史栈中的指定房间 |
| `setCurrentKB(path)` | action | 设置当前 KB |

### 8.3 gitStore

| 状态/动作 | 类型 | 说明 |
|----------|------|------|
| `token` | `string` | Git 认证 Token |
| `authType` | `'token' \| 'ssh'` | 认证类型 |
| `SSHKey` | `string` | SSH 公钥 |

### 8.5 GraphContext

`GraphContext` 是图谱状态的单例共享机制，避免多个 `useGraph()` 调用导致状态碎片化。

| 属性 | 类型 | 说明 |
|------|------|------|
| `nodes` | `KnowledgeNode[]` | 当前可见节点列表 |
| `edges` | `KnowledgeEdge[]` | 当前可见边列表 |
| `loading` | `boolean` | 是否正在加载房间 |
| `selectedNode` | `KnowledgeNode \| null` | 当前选中的节点 |
| `loadRoom(dirPath)` | `Promise<void>` | 加载指定房间 |
| `navigateBack()` | `Promise<void>` | 返回上一层 |
| `navigateToRoom(index)` | `Promise<void>` | 跳转到历史栈中的指定房间 |
| `onNodesChange` | `(changes) => void` | React Flow 节点变更 |
| `onEdgesChange` | `(changes) => void` | React Flow 边变更 |
| `onConnect` | `(connection) => void` | React Flow 新建连线 |
| `onNodeClick` | `(event, node) => void` | 单击节点 |
| `onPaneClick` | `(event) => void` | 单击画布 |
| `onNodeDoubleClick` | `(event, node) => void` | 双击节点 |
| `onNodeContextMenu` | `(event, node) => void` | 右键节点 |
| `createChildNode` | `(name, parentId?) => Promise<string \| null>` | 创建子节点 |
| `deleteChildNode` | `(nodeId) => Promise<boolean>` | 删除节点 |
| `renameNode` | `(nodeId, newName) => Promise<boolean>` | 重命名节点 |
| `updateEdgeRelation` | `(edgeId, relation, weight) => void` | 更新边关系 |
| `layoutNodes` | `(direction?) => Promise<void>` | 执行布局 |
| `highlightSearch` | `(query) => void` | 高亮搜索匹配 |

**重要**：所有需要访问图谱状态的组件必须使用 `useGraphContext()` 而非直接调用 `useGraph()`。`GraphContextProvider` 在 `GraphPage` 根级别挂载，单次调用 `useGraph()` 实例后通过 Context 共享。

### 8.4 ReactFlowProvider 放置原则

⚠️ **重要**：`ReactFlowProvider` 必须位于 `App.tsx` 根级别，包裹所有视图组件。

```tsx
// App.tsx
return (
  <ReactFlowProvider>
    {view === 'setup' && <SetupPage />}
    {view === 'home' && <HomePage />}
    {view === 'graph' && <GraphPage />}
  </ReactFlowProvider>
)
```

禁止将 `ReactFlowProvider` 放在 `GraphPage` 或 `GraphCanvas` 内部，否则会创建嵌套 Provider 导致 React Flow context 失效。

---

## 9. IPC 通道白名单

渲染进程通过 `window.electronAPI.invoke(channel, ...args)` 调用以下通道：

### 文件系统（fs）

| 通道 | 说明 |
|------|------|
| `fs:init` | 初始化工作目录 |
| `fs:listChildren` | 列出子目录 |
| `fs:mkDir` | 创建目录 |
| `fs:rmDir` | 删除目录 |
| `fs:saveKBOrder` | 保存 KB 排序 |
| `fs:getKBCover` | 获取 KB 封面 |
| `fs:saveKBCover` | 保存 KB 封面 |
| `fs:renameKB` | 重命名 KB |
| `fs:readGraphMeta` | 读取图元数据 |
| `fs:writeGraphMeta` | 写入图元数据 |
| `fs:getDir` | 获取目录信息 |
| `fs:updateCardMeta` | 更新卡片元数据 |
| `fs:readFile` | 读取文本文件 |
| `fs:writeFile` | 写入文本文件 |
| `fs:deleteFile` | 删除文件 |
| `fs:writeBlobFile` | 写入二进制文件 |
| `fs:readBlobFile` | 读取二进制文件 |
| `fs:clearAll` | 清除所有数据 |
| `fs:openInFinder` | 在文件管理器中打开 |
| `fs:countChildren` | 统计子节点数 |
| `fs:ensureCardDir` | 确保卡片目录存在 |
| `fs:getRootDir` | 获取根目录 |
| `fs:getLastOpenedKB` | 获取上次打开的 KB |
| `fs:setLastOpenedKB` | 设置上次打开的 KB |
| `fs:setWorkDir` | 验证并设置工作目录 |
| `fs:selectWorkDirCandidate` | 选择工作目录候选 |
| `fs:createWorkDir` | 创建工作目录 |
| `fs:importKB` | 导入知识库 |

### Git

| 通道 | 说明 |
|------|------|
| `git:checkAvailable` | 检查 Git 是否可用 |
| `git:init` | 初始化仓库 |
| `git:status` | 获取状态 |
| `git:statusBatch` | 批量获取状态 |
| `git:isDirty` | 检测是否有未提交变更 |
| `git:commit` | 提交 |
| `git:log` | 查看日志 |
| `git:diff` | 查看差异 |
| `git:diffFiles` | 查看文件差异 |
| `git:commitDiffFiles` | 提交差异文件 |
| `git:commitFileDiff` | 提交单个文件差异 |
| `git:push` | 推送 |
| `git:pull` | 拉取 |
| `git:fetch` | 获取 |
| `git:remote:get` | 获取远程仓库 |
| `git:remote:set` | 设置远程仓库 |
| `git:conflict:list` | 列出冲突文件 |
| `git:conflict:show` | 显示冲突内容 |
| `git:conflict:resolve` | 解决冲突 |
| `git:conflict:complete` | 完成冲突解决 |
| `git:auth:setToken` | 设置认证 Token |
| `git:auth:getSSHKey` | 获取 SSH 公钥 |
| `git:auth:setAuthType` | 设置认证类型 |
| `git:auth:getAuthType` | 获取认证类型 |

### 应用

| 通道 | 说明 |
|------|------|
| `app:openExternal` | 打开外部链接 |
| `app:menu-action` | 应用菜单动作（接收端） |

---

## 10. 注释规范

### 10.1 目标

项目代码注释以"提升可读性 + 可生成文档"为目标：

- 对外 API、公共工具函数、核心底层函数应优先使用 `JSDoc`
- 局部复杂实现、边界条件和兼容性说明使用普通行内注释 `//`
- 注释重点解释"为什么这样做"，避免重复描述代码表面行为

### 10.2 推荐规范

#### 使用场景

以下场景应使用 `JSDoc`：

- 导出函数
- 公共工具函数
- hooks 的公共方法
- stores 的 action / 核心方法
- 跨文件调用的核心逻辑
- 具有副作用、异常、边界条件的函数

以下场景使用普通注释：

- 复杂局部逻辑
- 平台兼容性处理
- 性能优化原因
- 特殊边界条件说明

#### 推荐格式

`JSDoc` 采用如下结构：

- 一句话说明用途
- `@param`
- `@returns`
- 如存在异常或失败分支，补充 `@throws`
- 如函数行为不直观，可补充 `@example`

---

## 11. 变更日志

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v5.0.0 | 2026-04-17 | **架构大重构**：Vite + Vue 3 + Pinia 构建系统替代纯 HTML/CDN；纯文件系统存储（移除 IndexedDB），使用 `_graph.json` 和 `_config.json`；目录即结构（KB=目录，Card=子目录）；项目结构重组为 `composables/` + `core/` + `components/` + `stores/`；Electron 主进程合并为单文件；内置 Git 版本控制；移除 vendor/、docs/ 等旧目录 |
| v5.1.0 | 2026-04-19 | **Vue 3 → React 18 + React Flow + Zustand 迁移**：渲染进程从 Vue 3 迁移到 React 18 + TypeScript + React Flow；状态管理从 Pinia 迁移到 Zustand（`appStore` 使用 `create`，`roomStore` 使用 vanilla `createStore` 支持外部 `getState()`）；样式从全局 CSS 迁移到 CSS Modules；`ReactFlowProvider` 移动到 App.tsx 根级别；移除 `vendor/` 和 `src/css/` 遗留文件；修复多处 stale closure 和 async/await bug |
| v5.2.0 | 2026-04-20 | **BUG 修复与文档更新**：修复 `GraphPage.tsx` 中 `selectNode` stale closure bug（解构赋值导致每次渲染创建新对象 → 改为直接订阅）；修复 `useGraph.ts` 中 `updateSelectedNode` stale closure bug（`selectedNodeId` 被 Promise 回调捕获 → 改用 `useAppStore.getState()`）；修复 `GraphPage.tsx` 删除确认中 `label` 可能为 undefined 的 bug；更新右键菜单文档描述以匹配实际实现（节点菜单：新建子节点/聚焦节点/重命名/属性/删除节点；边菜单：删除连线）；`package.json` 版本号同步更新为 v5.2.0 |
| v5.1.1 | 2026-04-20 | **BUG 修复与架构优化**：修复双击画布创建节点（实现 `onPaneClick` 双击检测）、Tab 添加子节点（stale closure 修复）、面包屑显示完整历史链、Git 面板 `statusClass` TS 错误；添加 Git 面板组件（底部弹出式，状态徽章 + Fetch/Pull/Push/Commit）；新增 `GraphContext` 单例共享；补充 SPEC.md Git 面板 UI 规范和项目结构 |
| v5.2.1 | 2026-04-20 | **连线删除 BUG 修复与死代码清理**：修复 `onEdgesChange` 在删除边时未调用 `scheduleDebouncedSave` 导致 `_graph.json` 未更新的 bug；修复 `handleEdgeDelete` 使用 `graph.deleteEdge()` 而非 React Flow `deleteElements()` 导致边在画布上视觉残留的 bug；移除 `GraphContext` 中已废弃的 `deleteEdge` 方法；移除 `useGraph.ts` 中的 `deleteEdge` 死代码函数 |
| v5.3.0 | 2026-04-20 | **性能优化与同步机制增强**：修复 `DetailPanel.tsx` 中 `marked.parse()` 在每次渲染时重复调用的性能问题（改用 `useMemo` 缓存解析结果）；新增 `appStore.triggerKBRefresh()` 方法和 `kbRefreshTrigger` 状态字段，实现 NavTree KB 列表与应用层操作的跨组件同步；`HomePage` 和 `NavTree` 在创建 KB 后触发全局刷新；`SPEC.md` 核心文件引用全面从 `.js` 更新为 `.ts` |

---

## 附录 A：与旧版（v5.0.0 Vue 版）的核心差异

| 维度 | v5.0.0（Vue 3） | v5.1.0（React 18） |
|------|------|--------|
| 渲染框架 | Vue 3 + Composition API | React 18 + Hooks |
| 图谱引擎 | Cytoscape.js + cytoscape-elk | React Flow + elkjs |
| 状态管理 | Pinia | Zustand（`create` + vanilla `createStore`） |
| 节点组件 | Vue 组件作为 Cytoscape HTML 标签 | React Flow 自定义节点 `KnowledgeCard.tsx` |
| 样式 | Vue SFC `<style>` 或全局 CSS | CSS Modules（`.module.css`） |
| 入口文件 | `src/main.js` | `src/main.tsx` |
| 根组件 | `App.vue` | `App.tsx` |
| composables | `useGraph.js`、`useStorage.js` 等 | `useGraph.ts`、`useStorage.ts` 等 |
| Grid 背景 | 自定义 Canvas 绘制 | React Flow 内置 `<Background>` 组件 |
| ReactFlowProvider | 不适用 | 必须位于 `App.tsx` 根级别 |
| 数据结构 | 完全兼容 `_graph.json` / `_config.json` | 完全兼容（无变化） |
| IPC / Electron | 完全复用（无变化） | 完全复用（无变化） |
| 目录结构 | `src/composables/` | `src/hooks/` |

---

## 附录 B：关键实现注意事项

### B.1 ReactFlowProvider 嵌套问题

React Flow 使用 React Context，在组件树中只能有一个 Provider 实例。错误地将 Provider 放在 `GraphPage` 内部会导致内侧 Provider 覆盖外侧，引发 Hooks 只能在单一位置调用等诡异 bug。

**正确做法**：
```tsx
// App.tsx — Provider 在根级别
import { ReactFlowProvider } from '@xyflow/react'
return (
  <ReactFlowProvider>
    {view === 'setup' && <SetupPage />}
    {view === 'home' && <HomePage />}
    {view === 'graph' && <GraphPage />}
  </ReactFlowProvider>
)
```

**错误做法**：
```tsx
// GraphPage.tsx — ❌ 不要这样做
return (
  <ReactFlowProvider>
    <GraphCanvas />
  </ReactFlowProvider>
)
```

### B.2 Zustand Store 模式选择

- **`appStore`**：使用 `create` 创建，支持组件内直接 `useStore()` 订阅。
- **`roomStore`**：使用 vanilla `createStore` 创建，支持外部 `getState()` 调用。

```typescript
// roomStore.ts
export const roomStore = createStore<RoomState>()((set, get) => ({
  currentKBPath: '',
  currentRoomPath: '',
  roomHistory: [],
  enterRoom({ path, kbPath, name }) { ... },
  goBack() { ... },
  goToRoom(item) {
    get().enterRoom({ path: item.room.path, kbPath: item.room.kbPath, name: item.room.name })
  },
  setCurrentKB(path) { ... }
}))
```

### B.3 Stale Closure 修复模式

在 React 组件中，`useEffect` 或 `Promise` 回调捕获的 state 变量是创建时的快照。修复方式是先在回调外保存引用，再在回调后更新。

```typescript
// ❌ 错误 — kbs 在 Promise.all 创建时已被捕获
const initial = kbList.map(...)
setKbs(initial)
await Promise.all(kbs.map(...)) // kbs 是旧值

// ✅ 正确 — 使用 initial 数组本身
const initial = kbList.map(...)
setKbs(initial)
const counts = await Promise.all(initial.map(...))
setKbs(initial.map((kb, i) => ({ ...kb, nodeCount: counts[i] })))
```

### B.4 IPC Promise 处理

IPC 调用的返回值是 Promise，必须使用 `.then()` 或 `await` 处理，不能直接赋值。

```typescript
// ❌ 错误
const result = storage.readMarkdown(path)
setMarkdown(result) // result 是 Promise，不是值

// ✅ 正确
storage.readMarkdown(path).then(setMarkdown)
```
