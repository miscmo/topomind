# TopoMind 日志与性能监控系统设计

> 本文档描述 TopoMind 应用日志与性能监控系统的完整设计方案。
> 对应功能需求来源：`C:\Users\75465\Documents\TopoMind\知识管理\我的软件\运行可视化\README.md`

> **实现状态**：Phase 1（日志后端 + 关键注入点）已完成。Phase 2（监控窗口 UI）部分已完成，详见 §7.2。

---

## 一、需求分析

### 1.1 核心目标

构建一个专业级的软件运行状态可视化系统，让用户能够：
- 实时查看软件内部运行细节日志
- 通过菜单触发独立的非模态监控窗口
- 按关键词、时间、日志等级、关键动作进行筛选
- 为未来二期性能监控图表预留扩展能力

### 1.2 设计原则

1. **最小侵入**：日志系统对业务代码层无感知，基于现有日志接口改造
2. **高性能**：日志写入异步完成，避免阻塞主线程；高频函数谨慎打日志
3. **可观测**：覆盖关键操作链路，支持链路追踪
4. **可扩展**：日志格式预留性能指标字段，方便二期接入

---

## 二、系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────┐ │
│  │ 业务代码     │──▶│ Logger            │──▶│ IPC Bridge │ │
│  │ (hooks,      │   │ (src/core/       │   │ (preload)  │ │
│  │  Stores等)   │   │  log-backend.ts)  │   │            │ │
│  └──────────────┘   └──────────────────┘   └─────┬──────┘ │
│                                                    │         │
│  ═══════════════ Phase 1 已实现 ═══════════════════│═════════│
│                                                    │ IPC     │
└────────────────────────────────────────────────────│─────────┘
                                                     │
┌────────────────────────────────────────────────────│─────────┐
│                      Main Process                   │          │
│  ═══════════════ Phase 1 已实现 ════════════════════│═════════│
│  ┌──────────────────────────────────────────────┐ │          │
│  │              LogService                       │◀┘          │
│  │  (electron/log-service.js)                    │            │
│  │  - 异步写入日志到 logs/YYYY-MM-DD.log         │            │
│  │  - 内存环形缓冲区维护最近N条日志               │            │
│  │  - 日志轮转（按日期/按大小）                  │            │
│  └──────────────────────────────────────────────┘            │
│                                                             │
│  ┌──────────────┐   ┌──────────────────────┐                │
│  │ MenuService  │──▶│ IPC Handlers (main)  │                │
│  │ (视图->日志  │   │ log:* channels       │                │
│  │  性能监控)   │   └──────────────────────┘                │
│  └──────────────┘                                           │
│                                                             │
│  ═══════════════ Phase 2 部分实现 ════════════════════════════│
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MonitorWindow (独立 BrowserWindow, 非模态)             │   │
│  │  - 渲染 MonitorPage.tsx (✅ 已实现)                    │   │
│  │  - 通过 IPC 接收日志流并实时展示 (✅ 已实现)            │   │
│  │  - 性能图表 (❌ 预留)                                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 日志流向

```
业务代码调用 logAction(action, module, params)
  └─▶ log-backend.ts (src/core/log-backend.ts)
        └─▶ logWrite() ──▶ IPC invoke('log:write', entry)
              └─▶ Main Process LogService
                   ├─▶ 写入 logs/YYYY-MM-DD.log (JSON Lines)
                   └─▶ 维护内存缓冲区 (最新 2000 条)

Phase 2 预留：MonitorPage.tsx 通过 logSubscribe() 实时消费日志流
```

### 2.3 窗口架构

| 窗口 | 类型 | 说明 | 状态 |
|------|------|------|------|
| 主窗口 | BrowserWindow | 承载 App.tsx，路由到 setup/home/graph 视图 | 已有 |
| 监控窗口 | BrowserWindow (非模态) | 承载 MonitorPage.tsx，固定大小 1200x700，通过 `#/monitor` hash 路由渲染 | ✅ 部分实现 |

---

## 三、日志格式设计

### 3.1 结构化日志条目（JSON Lines）

每行一条 JSON 对象，便于解析和检索：

```json
{
  "id": "01DX8T3K5M7N9P2Q4R6S8T0V@topomind",
  "level": "INFO",
  "timestamp": "2026-04-19T14:32:15.847+08:00",
  "module": "useGraph",
  "file": "useGraph.ts",
  "line": 278,
  "func": "drillInto",
  "action": "drillInto",
  "message": "钻入子房间",
  "params": {
    "cardPath": "工作目录/知识库A/卡片B",
    "prevPath": "工作目录/知识库A",
    "childCount": 3
  },
  "traceId": "01DX8T3K5M",
  "spanId": "01DX8T3K5M7",
  "meta": {
    "kbPath": "工作目录/知识库A",
    "roomPath": "工作目录/知识库A/卡片B",
    "selectedNode": null,
    "zoom": 1.0,
    "nodeCount": 12,
    "edgeCount": 5
  }
}
```

### 3.2 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识符，格式：`{timestamp}{random}@topomind` |
| `level` | string | 是 | 日志等级：`DEBUG` \| `INFO` \| `WARN` \| `ERROR` |
| `timestamp` | string | 是 | ISO 8601 格式，带时区 |
| `module` | string | 是 | 模块名称，标识日志来源模块 |
| `file` | string | 是 | 来源文件名（不含路径） |
| `line` | number | 是 | 来源行号 |
| `func` | string | 是 | 函数名 |
| `action` | string | 是 | 关键动作标识（用于搜索筛选） |
| `message` | string | 是 | 人类可读日志消息 |
| `params` | object | 否 | 关键参数对象 |
| `traceId` | string | 否 | 链路追踪 ID，关联同一次操作的所有日志 |
| `spanId` | string | 否 | 当前 span ID |
| `parentId` | string | 否 | 父 span ID |
| `meta` | object | 否 | 扩展元数据（预留性能指标字段） |

### 3.3 action 枚举（实际实现）

以下 action 标识符已在代码中实际使用（使用中文冒号分隔符）：

#### 应用级

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `应用:启动` | 应用启动 | electron/log-service.js |
| `应用:挂载` | App 组件挂载 | - (预留) |

#### 知识库操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `知识库:打开` | 打开知识库 | HomePage.tsx |
| `知识库:切换` | 切换工作目录 | HomePage.tsx |
| `知识库:创建` | 创建知识库 | HomePage.tsx, NavTree.tsx |
| `知识库:导入` | 导入知识库 | HomePage.tsx |

#### 房间/导航

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `房间:加载` | 开始加载房间 | useGraph.ts |
| `房间:加载完成` | 房间加载完成 | useGraph.ts |
| `房间:加载触发` | 房间加载触发（页面级） | GraphPage.tsx |
| `房间:钻入` | 钻入子房间 | useGraph.ts, DetailPanel.tsx |
| `房间:返回` | 返回上一层 | useGraph.ts, Breadcrumb.tsx |
| `房间:导航` | 面包屑跳转 | useGraph.ts, Breadcrumb.tsx |

#### 布局操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `布局:开始` | 开始计算 ELK 布局 | useLayout.ts |
| `布局:完成` | ELK 布局计算完成 | useLayout.ts |
| `布局:失败` | ELK 布局计算失败 | useLayout.ts |
| `布局:应用` | 布局结果应用到图谱 | useGraph.ts |

#### 节点操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `节点:选中` | 选中节点 | useGraph.ts |
| `节点:创建` | 创建节点 | useGraph.ts, useNodeActions.ts, GraphPage.tsx |
| `节点:删除` | 删除节点 | useGraph.ts, useNodeActions.ts, DetailPanel.tsx |
| `节点:重命名` | 重命名节点 | useGraph.ts, useNodeActions.ts, DetailPanel.tsx |
| `节点:聚焦` | 聚焦节点 | useNodeActions.ts |
| `节点:属性` | 查看节点属性 | useNodeActions.ts |

#### 连线操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `连线:创建` | 创建连线 | useGraph.ts |
| `连线:删除` | 删除连线 | useNodeActions.ts |
| `连线:进入模式` | 进入连线模式 | Toolbar.tsx |
| `连线:退出模式` | 退出连线模式 | Toolbar.tsx |

#### 视图操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `视图:移动` | 视图移动/缩放 | GraphPage.tsx |
| `视图:放大` | 放大 | Toolbar.tsx |
| `视图:缩小` | 缩小 | Toolbar.tsx |
| `视图:适应` | 适应视图 | Toolbar.tsx |
| `视图:重置` | 重置视图 | Toolbar.tsx |
| `视图:网格切换` | 切换网格 | Toolbar.tsx |
| `视图:Git面板切换` | 切换Git面板 | Toolbar.tsx |

#### 内容操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `内容:保存` | 保存 Markdown 内容 | DetailPanel.tsx |

#### 搜索操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `搜索:输入` | 搜索关键词输入 | SearchBar.tsx |
| `搜索:清除` | 清除搜索关键词 | SearchBar.tsx |

#### 首页操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `HomePage:新建知识库弹窗:打开` | 打开新建知识库弹窗 | HomePage.tsx |
| `HomePage:新建知识库弹窗:关闭` | 关闭新建知识库弹窗 | HomePage.tsx |
| `HomePage:导入知识库弹窗:打开` | 打开导入知识库弹窗 | HomePage.tsx |
| `HomePage:导入知识库弹窗:关闭` | 关闭导入知识库弹窗 | HomePage.tsx |
| `HomePage:开始加载知识库列表` | 开始加载知识库列表 | HomePage.tsx |
| `HomePage:知识库列表加载成功` | 知识库列表加载成功 | HomePage.tsx |
| `HomePage:开始加载子节点数量` | 开始加载子节点数量 | HomePage.tsx |
| `HomePage:子节点数量加载完成` | 子节点数量加载完成 | HomePage.tsx |
| `HomePage:加载知识库列表异常` | 加载知识库列表异常 | HomePage.tsx |
| `HomePage:点击切换工作目录` | 点击切换工作目录按钮 | HomePage.tsx |
| `HomePage:打开文件对话框` | 打开选择工作目录对话框 | HomePage.tsx |
| `HomePage:文件对话框关闭` | 文件对话框关闭（无选择） | HomePage.tsx |
| `HomePage:文件对话框已选择路径` | 文件对话框已选择路径 | HomePage.tsx |
| `HomePage:切换工作目录失败` | 切换工作目录失败 | HomePage.tsx |
| `HomePage:点击选择导入文件夹` | 点击选择导入文件夹 | HomePage.tsx |
| `HomePage:选择导入文件夹完成` | 选择导入文件夹完成 | HomePage.tsx |
| `HomePage:选择导入文件夹取消` | 选择导入文件夹取消 | HomePage.tsx |
| `HomePage:点击知识库卡片` | 点击知识库卡片 | HomePage.tsx |
| `HomePage:悬停知识库卡片` | 悬停知识库卡片 | HomePage.tsx |
| `HomePage:点击新建知识库` | 点击新建知识库按钮 | HomePage.tsx |
| `HomePage:点击导入知识库` | 点击导入知识库按钮 | HomePage.tsx |

#### 设置页操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `SetupPage:点击打开工作目录` | 点击打开工作目录按钮 | SetupPage.tsx |
| `SetupPage:打开文件对话框` | 打开文件对话框 | SetupPage.tsx |
| `SetupPage:文件对话框关闭` | 文件对话框关闭（无选择） | SetupPage.tsx |
| `SetupPage:文件对话框已选择路径` | 文件对话框已选择路径 | SetupPage.tsx |
| `SetupPage:设置工作目录` | 设置工作目录 | SetupPage.tsx |
| `SetupPage:设置工作目录失败` | 设置工作目录失败 | SetupPage.tsx |
| `SetupPage:进入首页` | 进入首页 | SetupPage.tsx |
| `SetupPage:打开工作目录异常` | 打开工作目录异常 | SetupPage.tsx |
| `SetupPage:点击创建工作目录` | 点击创建工作目录按钮 | SetupPage.tsx |
| `SetupPage:创建工作目录` | 创建工作目录 | SetupPage.tsx |
| `SetupPage:创建工作目录失败` | 创建工作目录失败 | SetupPage.tsx |
| `SetupPage:创建工作目录异常` | 创建工作目录异常 | SetupPage.tsx |

#### Git 操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `Git:提交` | Git 提交 | GitPanel.tsx |
| `Git:推送` | Git 推送 | GitPanel.tsx |
| `Git:拉取` | Git 拉取 | GitPanel.tsx |
| `Git:获取` | Git 获取 | GitPanel.tsx |

#### 快捷键

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `快捷键:ESC` | ESC 键 | useKeyboard.ts |
| `快捷键:删除节点` | Delete/Backspace 删除节点 | useKeyboard.ts |
| `快捷键:添加子节点` | Tab 添加子节点 | useKeyboard.ts |

#### 右键菜单

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `右键菜单:显示` | 显示右键菜单 | useContextMenu.ts |
| `右键菜单:关闭` | 关闭右键菜单 | useContextMenu.ts, useKeyboard.ts |

#### 性能标记（Phase 2 预留）

| action 值 | 含义 | 状态 |
|-----------|------|------|
| `perf:loadRoom` | 加载房间耗时 | 预留 |
| `perf:layout` | 布局耗时 | 预留 |
| `perf:startup` | 启动耗时 | 预留 |

#### 监控操作

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `监控:过滤级别添加` | 添加日志等级筛选 | MonitorPage.tsx |
| `监控:过滤级别移除` | 移除日志等级筛选 | MonitorPage.tsx |
| `监控:刷新` | 刷新日志列表 | MonitorPage.tsx |
| `监控:清空` | 清空日志缓冲区 | MonitorPage.tsx |
| `监控:关键词变化` | 关键词输入变化 | MonitorPage.tsx |
| `监控:清除关键词` | 清除关键词搜索 | MonitorPage.tsx |
| `监控:日期选择` | 日期选择变化 | MonitorPage.tsx |
| `监控:实时流开关` | 实时日志流开关 | MonitorPage.tsx |
| `监控:选择日志` | 选中日志条目 | MonitorPage.tsx |
| `监控:复制日志` | 复制日志详情 | MonitorPage.tsx |
| `监控:关闭详情` | 关闭详情面板 | MonitorPage.tsx |
| `监控页:切换Tab` | 切换日志/性能 Tab | MonitorPage.tsx |
| `页面:进入监控` | 监控页面进入 | MonitorPage.tsx |

### 3.4 日志等级策略

| 等级 | 使用场景 |
|------|----------|
| `DEBUG` | 开发调试，默认不输出到文件 |
| `INFO` | 关键业务操作（知识库切换、节点操作等） |
| `WARN` | 潜在问题（布局失败回退、存储警告等） |
| `ERROR` | 错误异常（已在现有 `logger.catch` 中使用） |

### 3.5 meta 扩展字段（Phase 2 预留）

以下字段为未来性能监控预留：

```typescript
interface PerfMeta {
  // 性能指标
  duration?: number      // 操作耗时(ms)
  memory?: number        // 内存使用(MB)
  cpuTime?: number       // CPU时间(ms)

  // 图谱指标
  nodeCount?: number     // 当前节点数
  edgeCount?: number     // 当前边数
  zoom?: number          // 当前缩放比例

  // 渲染指标
  fps?: number           // 帧率
  renderTime?: number    // 渲染耗时(ms)
}
```

---

## 四、后端日志服务设计

### 4.1 LogService 模块 (`electron/log-service.js`)

```
职责：
1. 初始化 logs/ 目录（与应用工作目录平级）
2. 按日期分文件存储日志
3. 维护内存环形缓冲区（最新 2000 条）
4. 异步写入文件，不阻塞主线程
5. 响应 renderer 发来的日志 IPC 请求
```

#### 目录结构

```
TopoMind工作目录/
├── _config.json
├── 知识库A/
│   ├── _graph.json
│   └── ...
└── logs/                      # 新增
    ├── 2026-04-19.log
    ├── 2026-04-20.log
    └── ...
```

#### 环形缓冲区

- 最大容量：2000 条
- 超出容量时丢弃最旧的日志
- 用于：实时推送到监控窗口、历史查询

#### 日志轮转策略

- 按日期轮转：每日零点新建日志文件
- 文件大小限制：单文件最大 10MB，超出时追加序号
  - `2026-04-19.log`
  - `2026-04-19.1.log`
  - `2026-04-19.2.log`

### 4.2 IPC 通道设计

| 通道 | 方向 | 用途 |
|------|------|------|
| `log:write` | Renderer → Main | 写入单条日志 |
| `log:query` | Renderer → Main | 查询历史日志 |
| `log:getBuffer` | Renderer → Main | 获取当前缓冲区日志 |
| `log:setLevel` | Renderer → Main | 设置日志等级 |
| `log:clear` | Renderer → Main | 清空当前缓冲区 |
| `log:subscribe` | Renderer → Main | 订阅实时日志流 |
| `log:unsubscribe` | Renderer → Main | 取消订阅 |
| `monitor:open` | Renderer → Main | 打开监控窗口 |
| `monitor:close` | Renderer → Main | 关闭监控窗口 |

---

## 五、前端组件设计

### 5.1 App.tsx 路由扩展

主窗口路由通过 `appStore.view` 控制：`'setup' | 'home' | 'graph'`。

监控窗口通过 **hash 路由** `#/monitor` 独立渲染，绕过 view 状态：
- 监控窗口 URL 形如 `topomind://renderer/#/monitor`
- App.tsx 检测 `window.location.hash === '#/monitor'` 条件，满足时只渲染 `<MonitorPage />`

### 5.2 MonitorPage.tsx

主监控视图，结构如下：

```
┌──────────────────────────────────────────────────────────┐
│  MonitorPage (monitoring view)                            │
│  ┌──────────┬─────────────────────────────────────────┐  │
│  │ Sidebar  │  ┌────────────────────────────────────┐ │  │
│  │          │  │  FilterBar (搜索筛选区)             │ │  │
│  │ [日志]   │  │  - 关键词搜索                       │ │  │
│  │ [性能*]  │  │  - 日期选择器                      │ │  │
│  │          │  │  - 日志等级多选                     │ │  │
│  │ 统计信息  │  │  - 动作类型多选                     │ │  │
│  │          │  └────────────────────────────────────┘ │  │
│  │          │  ┌────────────────────────────────────┐ │  │
│  │          │  │  LogList + DetailPanel              │ │  │
│  │          │  │  - 时间 | 等级 | 模块 | 消息        │ │  │
│  │          │  │  - 按时间倒序排列                   │ │  │
│  │          │  │  - 点击行展开详情（JSON格式化）     │ │  │
│  │          │  └────────────────────────────────────┘ │  │
│  └──────────┴─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> **实现状态**：✅ MonitorPage.tsx 已完整实现（573 行），包含 Sidebar、FilterBar、LogList、DetailPanel。
> PerformanceTab 为占位预留。

### 5.3 Sidebar 组件

左侧边栏面板组件（`MonitorPage.tsx` 内），提供视图切换：
- **日志监控**：`LogList` 视图（完整实现）
- **性能监控**：`PerformanceTab` 占位视图（二期实现）

### 5.4 FilterBar 设计

| 筛选项 | 类型 | 说明 |
|--------|------|------|
| 关键词 | text input | 模糊匹配 message、action、module |
| 日期选择 | date input (YYYY-MM-DD) | 日志时间日期筛选 |
| 日志等级 | checkbox group | DEBUG / INFO / WARN / ERROR |
| 实时流开关 | toggle | 开启/关闭实时 IPC 日志订阅 |

---

## 六、关键日志注入点

> **说明**：实际实现的 action 名称使用中文冒号分隔符（如 `房间:加载`），与设计初稿的英文名称（如 `room:enter`）不同。所有已实现的注入点见下表。

### 6.1 应用生命周期

| 位置 | action | params |
|------|--------|--------|
| LogService 初始化 | `应用:启动` | `workDir`, `platform`, `version` |
| (预留) App.tsx 挂载 | `应用:挂载` | - |

### 6.2 知识库操作

| 位置 | action | params |
|------|--------|--------|
| HomePage 打开KB | `知识库:打开` | `kbPath`, `kbName`, `nodeCount` |
| HomePage 切换工作目录 | `工作目录:切换` | `newWorkDir` |
| HomePage/NavTree 创建KB | `知识库:创建` | `kbName` |
| HomePage 导入KB | `知识库:导入` | `sourcePath` |

### 6.3 图谱交互

| 位置 | action | params |
|------|--------|--------|
| useGraph.loadRoom | `房间:加载` | `roomPath`, `kbPath` |
| useGraph.onNodeDoubleClick (钻入) | `房间:钻入` | `roomPath`, `roomName`, `fromRoom` |
| DetailPanel 子概念标签 | `房间:钻入` | `roomPath`, `roomName`, `source: 'child-tag'` |
| Breadcrumb 首页按钮 | `房间:返回` | `source: 'breadcrumb-home'` |
| useGraph.navigateBack | `房间:返回` | `fromRoom` |
| Breadcrumb 历史项点击 | `房间:导航` | `historyIndex`, `roomName`, `roomPath` |
| useGraph.navigateToRoom | `房间:导航` | `targetIndex` |
| useGraph onNodeClick | `节点:选中` | `nodeId`, `label`, `path` |
| GraphPage 双击画布 | `节点:创建` | `nodeName`, `source: 'double-click-canvas'` |
| useGraph.createChildNode | `节点:创建` | `nodeName`, `parentPath`, `newPath` |
| useNodeActions handleNewChild | `节点:创建` | `nodeId`, `nodeName`, `source: 'context-menu'` |
| useNodeActions handleAddChild (Tab) | `节点:创建` | `parentId`, `nodeName`, `source: 'keyboard-tab'` |
| useGraph deleteChildNode | `节点:删除` | `nodeId`, `label`, `path` |
| useNodeActions handleDelete (右键菜单) | `节点:删除` | `nodeId`, `label`, `path`, `source: 'context-menu'` |
| DetailPanel handleDelete | `节点:删除` | `nodeId`, `label`, `path` |
| useNodeActions handleDelete (键盘) | `节点:删除` | `nodeId`, `label`, `path`, `source: 'keyboard-delete'` |
| useGraph renameNode | `节点:重命名` | `nodeId`, `oldName`, `newName`, `path` |
| useNodeActions handleRename | `节点:重命名` | `nodeId`, `oldName`, `newName`, `source: 'context-menu'` |
| DetailPanel handleRenameConfirm | `节点:重命名` | `nodeId`, `oldName`, `newName`, `path` |
| useNodeActions handleFocus | `节点:聚焦` | `nodeId` |
| useNodeActions handleProperties | `节点:属性` | `nodeId` |
| useGraph onConnect | `连线:创建` | `edgeId`, `source`, `target` |
| useNodeActions handleEdgeDelete | `连线:删除` | `edgeId`, `edgeSource`, `edgeTarget`, `trigger` |
| Toolbar 进入连线模式 | `连线:进入模式` | `sourceNodeId` |
| Toolbar 退出连线模式 | `连线:退出模式` | `selectedNodeId` |
| GraphPage viewport move | `视图:移动` | `zoom`, `x`, `y` |
| Toolbar 放大 | `视图:放大` | - |
| Toolbar 缩小 | `视图:缩小` | - |
| Toolbar 适应视图 | `视图:适应` | - |
| Toolbar 重置视图 | `视图:重置` | - |
| Toolbar 网格切换 | `视图:网格切换` | `enabled` |
| Toolbar Git 面板切换 | `视图:Git面板切换` | `visible` |

### 6.4 内容操作

| 位置 | action | params |
|------|--------|--------|
| DetailPanel 保存 | `内容:保存` | `nodePath`, `label` |

### 6.5 搜索操作

| 位置 | action | params |
|------|--------|--------|
| SearchBar 关键词输入 | `搜索:输入` | `query` |
| SearchBar 清除搜索 | `搜索:清除` | `previousQuery` |

### 6.6 首页操作

| 位置 | action | params |
|------|--------|--------|
| HomePage 打开新建知识库弹窗 | `HomePage:新建知识库弹窗:打开` | - |
| HomePage 关闭新建知识库弹窗 | `HomePage:新建知识库弹窗:关闭` | - |
| HomePage 打开导入知识库弹窗 | `HomePage:导入知识库弹窗:打开` | - |
| HomePage 关闭导入知识库弹窗 | `HomePage:导入知识库弹窗:关闭` | - |
| HomePage 开始加载知识库列表 | `HomePage:开始加载知识库列表` | - |
| HomePage 知识库列表加载成功 | `HomePage:知识库列表加载成功` | `kbCount` |
| HomePage 开始加载子节点数量 | `HomePage:开始加载子节点数量` | - |
| HomePage 子节点数量加载完成 | `HomePage:子节点数量加载完成` | `count` |
| HomePage 加载知识库列表异常 | `HomePage:加载知识库列表异常` | `error` |
| HomePage 点击切换工作目录 | `HomePage:点击切换工作目录` | - |
| HomePage 打开文件对话框 | `HomePage:打开文件对话框` | - |
| HomePage 文件对话框关闭 | `HomePage:文件对话框关闭` | - |
| HomePage 文件对话框已选择路径 | `HomePage:文件对话框已选择路径` | `selectedPath` |
| HomePage 切换工作目录失败 | `HomePage:切换工作目录失败` | `error` |
| HomePage 点击选择导入文件夹 | `HomePage:点击选择导入文件夹` | - |
| HomePage 选择导入文件夹完成 | `HomePage:选择导入文件夹完成` | `sourcePath` |
| HomePage 选择导入文件夹取消 | `HomePage:选择导入文件夹取消` | - |
| HomePage 点击知识库卡片 | `HomePage:点击知识库卡片` | `kbPath`, `kbName` |
| HomePage 悬停知识库卡片 | `HomePage:悬停知识库卡片` | `kbPath` |
| HomePage 点击新建知识库 | `HomePage:点击新建知识库` | - |
| HomePage 点击导入知识库 | `HomePage:点击导入知识库` | - |

### 6.7 设置页操作

| 位置 | action | params |
|------|--------|--------|
| SetupPage 点击打开工作目录 | `SetupPage:点击打开工作目录` | - |
| SetupPage 打开文件对话框 | `SetupPage:打开文件对话框` | - |
| SetupPage 文件对话框关闭 | `SetupPage:文件对话框关闭` | - |
| SetupPage 文件对话框已选择路径 | `SetupPage:文件对话框已选择路径` | `selectedPath` |
| SetupPage 设置工作目录 | `SetupPage:设置工作目录` | `workDir` |
| SetupPage 设置工作目录失败 | `SetupPage:设置工作目录失败` | `error` |
| SetupPage 进入首页 | `SetupPage:进入首页` | - |
| SetupPage 打开工作目录异常 | `SetupPage:打开工作目录异常` | `error` |
| SetupPage 点击创建工作目录 | `SetupPage:点击创建工作目录` | - |
| SetupPage 创建工作目录 | `SetupPage:创建工作目录` | `workDir` |
| SetupPage 创建工作目录失败 | `SetupPage:创建工作目录失败` | `error` |
| SetupPage 创建工作目录异常 | `SetupPage:创建工作目录异常` | `error` |

### 6.8 Git 操作

| 位置 | action | params |
|------|--------|--------|
| GitPanel 提交 | `Git:提交` | `kbPath`, `message` |
| GitPanel 推送 | `Git:推送` | `kbPath` |
| GitPanel 拉取 | `Git:拉取` | `kbPath` |
| GitPanel 获取 | `Git:获取` | `kbPath` |

### 6.9 快捷键与右键菜单

| 位置 | action | params |
|------|--------|--------|
| useKeyboard ESC (blur) | `快捷键:ESC` | `action: 'blur-input'` |
| useKeyboard ESC (clear) | `快捷键:ESC` | `action: 'clear-selection'` |
| useKeyboard Delete/Backspace | `快捷键:删除节点` | `nodeId` |
| useKeyboard Tab | `快捷键:添加子节点` | `parentId` |
| useContextMenu 节点菜单 | `右键菜单:显示` | `type: 'node'`, `nodeId`, `x`, `y` |
| useContextMenu 连线菜单 | `右键菜单:显示` | `type: 'edge'`, `edgeId`, `x`, `y` |
| useContextMenu hide | `右键菜单:关闭` | - |
| useKeyboard ESC 关闭菜单 | `右键菜单:关闭` | `source: 'Escape'` |

### 6.10 性能标记（Phase 2 预留）

| 位置 | action | params |
|------|--------|--------|
| useGraph.loadRoom 完成 | `perf:loadRoom` | `duration`, `nodeCount`, `edgeCount` |
| useLayout ELK 布局完成 | `布局:完成` | `duration`, `nodeCount` |
| 应用启动完成 | `perf:startup` | `totalDuration` |

> 注：`布局:完成` 已实现（useLayout.ts），其 params 包含耗时信息。`perf:layout` 为 Phase 2 预留的汇总标记，需额外采集。

### 6.11 监控页面操作（MonitorPage 已实现）

以下 action 标识符由 MonitorPage.tsx 实际使用：

| action 值 | 含义 | 来源文件 |
|-----------|------|---------|
| `监控:过滤级别添加` | 添加日志等级筛选 | MonitorPage.tsx |
| `监控:过滤级别移除` | 移除日志等级筛选 | MonitorPage.tsx |
| `监控:刷新` | 刷新日志列表 | MonitorPage.tsx |
| `监控:清空` | 清空日志缓冲区 | MonitorPage.tsx |
| `监控:关键词变化` | 关键词输入变化 | MonitorPage.tsx |
| `监控:清除关键词` | 清除关键词搜索 | MonitorPage.tsx |
| `监控:日期选择` | 日期选择变化 | MonitorPage.tsx |
| `监控:实时流开关` | 实时日志流开关 | MonitorPage.tsx |
| `监控:选择日志` | 选中日志条目 | MonitorPage.tsx |
| `监控:复制日志` | 复制日志详情 | MonitorPage.tsx |
| `监控:关闭详情` | 关闭详情面板 | MonitorPage.tsx |
| `监控页:切换Tab` | 切换日志/性能 Tab | MonitorPage.tsx |
| `页面:进入监控` | 监控页面进入 | MonitorPage.tsx |

---

## 七、文件清单

### 7.1 已实现文件

| 文件路径 | 状态 | 说明 |
|----------|------|------|
| `electron/log-service.js` | ✅ 已实现 | 后端日志服务模块（主进程） |
| `src/core/log-backend.ts` | ✅ 已实现 | 日志 IPC 桥接层（渲染进程） |
| `src/hooks/useGraph.ts` | ✅ 已实现 | 图谱操作日志 |
| `src/hooks/useContextMenu.ts` | ✅ 已实现 | 右键菜单日志 |
| `src/hooks/useKeyboard.ts` | ✅ 已实现 | 快捷键日志 |
| `src/hooks/useNodeActions.ts` | ✅ 已实现 | 节点操作日志 |
| `src/components/GraphPage.tsx` | ✅ 已实现 | 视图移动/节点创建日志 |
| `src/components/DetailPanel/DetailPanel.tsx` | ✅ 已实现 | 内容保存/节点管理日志 |
| `src/components/Breadcrumb/Breadcrumb.tsx` | ✅ 已实现 | 面包屑导航日志 |
| `src/components/Toolbar/Toolbar.tsx` | ✅ 已实现 | 视图控制日志 |
| `src/components/SearchBar/SearchBar.tsx` | ✅ 已实现 | 搜索操作日志 |
| `src/components/HomePage.tsx` | ✅ 已实现 | 知识库操作日志 |
| `src/components/SetupPage.tsx` | ✅ 已实现 | 设置页操作日志 |
| `src/components/NavTree/NavTree.tsx` | ✅ 已实现 | 知识库创建日志 |
| `src/components/GitPanel/GitPanel.tsx` | ✅ 已实现 | Git 操作日志 |
| `docs/logging-system-design.md` | ✅ 已实现 | 本设计文档 |

### 7.2 Phase 2 文件

| 文件路径 | 说明 | 状态 |
|----------|------|------|
| `src/core/logger.ts` | 前端日志模块（可替代 log-backend.ts） | ✅ 已实现 |
| `src/stores/monitorStore.ts` | 监控页面 Zustand store | ✅ 已实现 |
| `src/components/MonitorPage/MonitorPage.tsx` | 监控页面主组件（573行，含Sidebar/FilterBar/LogList/DetailPanel） | ✅ 已实现 |
| `src/components/MonitorPage/MonitorPage.module.css` | 监控页面样式 | ✅ 已实现 |
| `src/components/MonitorPage/LogList.tsx` | 日志列表组件（内嵌于 MonitorPage.tsx） | ✅ 已实现 |
| `src/components/MonitorPage/FilterBar.tsx` | 筛选栏组件（内嵌于 MonitorPage.tsx） | ✅ 已实现 |
| `src/components/MonitorPage/PerformanceTab.tsx` | 性能图表占位组件 | ❌ 预留 |

> App.tsx 已通过 hash 路由 `#/monitor` 支持监控窗口独立渲染。

### 7.3 需修改文件（已修改）

| 文件路径 | 修改内容 |
|----------|----------|
| `electron/main.js` | 添加日志 IPC handlers、菜单项、LogService 初始化 |
| `electron/preload.js` | 添加 log:* 通道到白名单 |
| `src/App.tsx` | 通过 hash `#/monitor` 路由支持监控窗口独立渲染 |

---

## 八、扩展性设计

### 8.1 Phase 2 性能监控

基于已有的 `meta` 扩展字段和 `perf:*` action，设计 Phase 2：

1. **性能指标采集**：在关键函数使用 `performance.now()` 采集耗时
2. **环形图表组件**：接入 Chart.js 或 ECharts
3. **实时指标面板**：CPU、内存、渲染帧率（通过 `process.getCPUUsage()` 等 Electron API）
4. **历史趋势**：读取 `logs/*.log` 中的 `perf:*` 日志，绘制时间序列图

### 8.2 日志导出

- 支持导出为 JSON Lines、CSV 格式
- 支持按日期范围导出

### 8.3 日志聚合

未来可接入日志聚合服务（如 Loki、Elasticsearch），只需改造 `LogService.write()` 方法。

---

## 九、测试计划

> **Phase 1** = 已实现功能（日志写入 + 关键动作埋点）
> **Phase 2** = 预留功能（监控窗口 + 筛选 + 可视化）

### 9.1 Phase 1 功能测试（已实现）

- [x] 日志正确写入 `logs/YYYY-MM-DD.log` 文件（通过 IPC 验证）
- [x] 应用启动时 LogService 正确初始化并写入 `应用:启动` 日志
- [x] 知识库操作（打开/切换/创建/导入）正确记录
- [x] 图谱交互（节点选中/创建/删除/重命名）正确记录
- [x] 房间导航（钻入/返回/面包屑跳转）正确记录
- [x] 连线操作（创建/删除/连线模式切换）正确记录
- [x] 视图操作（缩放/适应/网格/Git面板）正确记录
- [x] Markdown 保存正确记录
- [x] Git 操作（提交/推送/拉取/获取）正确记录
- [x] 快捷键操作正确记录
- [x] 右键菜单显示/关闭正确记录

### 9.2 Phase 2 功能测试（部分已实现）

- [x] 菜单项 "视图->日志性能监控" 能正确打开监控窗口
- [x] 关键词搜索正确过滤日志
- [x] 时间范围筛选正确
- [x] 日志等级筛选正确
- [x] 动作类型筛选正确
- [x] 日志条目点击展开显示完整详情
- [ ] 监控窗口关闭后日志仍正常写入（需手动验证）
- [ ] 性能图表（PerformanceTab）待实现

### 9.3 性能测试

- [x] 日志写入不阻塞主线程（异步写入通过 fs.appendFile 异步回调实现）
- [ ] 10000 条日志在 FilterBar 筛选时 UI 不卡顿（✅ MonitorPage 已实现，待手动验证）
- [x] 内存环形缓冲区不超过设定容量（2000 条上限已实现）

### 9.4 边界测试

- [ ] 应用异常退出后，已写入的日志文件完整
- [ ] 日志文件超过 10MB 时正确轮转
- [ ] 多知识库切换时日志 traceId 正确关联
