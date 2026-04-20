# TopoMind 日志与性能监控系统设计

> 本文档描述 TopoMind 应用日志与性能监控系统的完整设计方案。
> 对应功能需求来源：`C:\Users\75465\Documents\TopoMind\知识管理\我的软件\运行可视化\README.md`

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
│  │  Stores等)   │   │  logger.ts)       │   │            │ │
│  └──────────────┘   └──────────────────┘   └─────┬──────┘ │
│                                                    │         │
└────────────────────────────────────────────────────│─────────┘
                                                     │ IPC
┌────────────────────────────────────────────────────│─────────┐
│                      Main Process                   │          │
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
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MonitorWindow (独立 BrowserWindow, 非模态)             │   │
│  │  - 渲染 MonitorPage.tsx                             │   │
│  │  - 通过 IPC 接收日志流并实时展示                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 日志流向

```
业务代码调用 logger.info/warn/error()
  └─▶ logger (src/core/logger.ts)
        ├─▶ console.* (开发调试保留)
        ├─▶ logWrite() ──▶ IPC invoke('log:write', entry)
        │     └─▶ Main Process LogService
        │          ├─▶ 写入 logs/YYYY-MM-DD.log (JSON Lines)
        │          └─▶ 维护内存缓冲区 (最新 2000 条)

业务代码调用 logAction(action, module, params)
  └─▶ log-backend.ts (src/core/log-backend.ts)
        ├─▶ logWrite() ──▶ IPC 'log:write'
        └─▶ logSubscribe() ──▶ MonitorPage.tsx 实时消费
```

### 2.3 窗口架构

| 窗口 | 类型 | 说明 |
|------|------|------|
| 主窗口 | BrowserWindow | 承载 App.tsx，路由到 setup/home/graph 视图 |
| 监控窗口 | BrowserWindow (非模态) | 承载 MonitorPage.tsx，固定大小 1200x700 |

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

### 3.3 action 枚举

以下 action 标识符为推荐值，代码中使用常量：

| action 值 | 含义 |
|-----------|------|
| `app:start` | 应用启动 |
| `app:ready` | 应用就绪 |
| `kb:open` | 打开知识库 |
| `kb:switch` | 切换知识库 |
| `room:enter` | 进入房间 |
| `room:drillInto` | 钻入子房间 |
| `room:goBack` | 返回上一层 |
| `room:goRoot` | 返回根目录 |
| `room:jumpTo` | 面包屑跳转 |
| `node:select` | 选中节点 |
| `node:unselect` | 取消选中 |
| `node:add` | 添加节点 |
| `node:delete` | 删除节点 |
| `node:rename` | 重命名节点 |
| `node:dbltap` | 双击节点（触发钻入） |
| `edge:add` | 添加连线 |
| `edge:delete` | 删除连线 |
| `layout:save` | 布局保存 |
| `layout:auto` | 自动布局 |
| `view:zoom` | 缩放 |
| `view:fit` | 适应视图 |
| `view:resetZoom` | 重置缩放 |
| `search:apply` | 应用搜索 |
| `panel:toggle` | 面板切换 |
| `tab:open` | 打开标签页 |
| `tab:switch` | 切换标签页 |
| `tab:close` | 关闭标签页 |
| `git:commit` | Git 提交 |
| `git:sync` | Git 同步 |
| `markdown:save` | Markdown 保存 |
| `markdown:load` | Markdown 加载 |
| `storage:error` | 存储错误 |
| `perf:layout` | 布局耗时 |
| `perf:loadRoom` | 加载房间耗时 |

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

在现有 `view: 'setup' | 'home' | 'graph'` 基础上增加：
- `'monitoring'`

### 5.2 MonitorPage.tsx

主监控视图，结构如下：

```
┌──────────────────────────────────────────────────────────┐
│  MonitorPage (monitoring view)                            │
│  ┌──────────┬─────────────────────────────────────────┐  │
│  │ Sidebar  │  ┌────────────────────────────────────┐ │  │
│  │          │  │  FilterBar (搜索筛选区)             │ │  │
│  │ [日志]   │  │  - 关键词搜索                       │ │  │
│  │ [性能*]  │  │  - 日期范围                         │ │  │
│  │          │  │  - 日志等级多选                     │ │  │
│  │ 统计信息  │  │  - 动作类型多选                     │ │  │
│  │          │  └────────────────────────────────────┘ │  │
│  │          │  ┌────────────────────────────────────┐ │  │
│  │          │  │  LogList + DetailPanel              │ │  │
│  │          │  │  - 时间 | 等级 | 模块 | 消息 | 操作│ │  │
│  │          │  │  - 按等级排序（ERROR > WARN > ...) │ │  │
│  │          │  │  - 点击行展开详情                   │ │  │
│  │          │  │  - 双击行定位到源码位置（开发模式）│ │  │
│  │          │  └────────────────────────────────────┘ │  │
│  └──────────┴─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 5.3 Sidebar 组件

左侧边栏面板组件（`MonitorPage.tsx` 内），提供视图切换：
- **日志监控**：`LogList` 视图（完整实现）
- **性能监控**：`PerformanceTab` 占位视图（二期实现）

### 5.4 FilterBar 设计

| 筛选项 | 类型 | 说明 |
|--------|------|------|
| 关键词 | text input | 模糊匹配 message、action、module |
| 开始时间 | datetime-local | 日志时间 >= 此值 |
| 结束时间 | datetime-local | 日志时间 <= 此值 |
| 日志等级 | checkbox group | DEBUG / INFO / WARN / ERROR |
| 动作类型 | checkbox group | 从 action 枚举中选择 |
| 模块 | dropdown + multi-select | 从已有模块列表中选择 |

---

## 六、关键日志注入点

### 6.1 应用生命周期

| 位置 | action | params |
|------|--------|--------|
| main.js 应用启动 | `app:start` | `version`, `platform` |
| main.js 应用就绪 | `app:ready` | - |
| main.js 窗口创建 | `window:create` | `width`, `height` |
| App.tsx 挂载 | `app:mount` | - |

### 6.2 知识库操作

| 位置 | action | params |
|------|--------|--------|
| HomePage 打开KB | `kb:open` | `kbPath`, `kbName` |
| roomStore.enterRoom | `kb:switch` | `kbPath`, `kbName` |
| 切换知识库 | `kb:switch` | `prevKb`, `newKb` |

### 6.3 图谱交互

| 位置 | action | params |
|------|--------|--------|
| useGraph.loadRoom | `room:enter` | `roomPath`, `nodeCount` |
| useGraph.drillInto | `room:drillInto` | `cardPath`, `prevPath`, `childCount` |
| useGraph.goBack | `room:goBack` | `fromPath`, `toPath` |
| useGraph.goRoot | `room:goRoot` | `targetPath` |
| useGraph.navigateToHistoryIndex | `room:jumpTo` | `targetPath` |
| useGraph handlers | `node:select` | `nodeId`, `nodeLabel` |
| useGraph handlers (unselect) | `node:unselect` | `prevNodeId` |
| useGraph onNodeDoubleClick | `node:dbltap` | `nodeId` |
| useGraph addNode | `node:add` | `cardPath`, `name`, `position` |
| useGraph addChildNode | `node:add` | `parentPath`, `cardPath`, `name` |
| useGraph deleteNode | `node:delete` | `cardPath` |
| useGraph renameNode | `node:rename` | `cardPath`, `oldName`, `newName` |
| useGraph onConnect | `edge:add` | `sourceId`, `targetId`, `relation` |
| useGraph onEdgesDelete | `edge:delete` | `edgeId` |
| useGraph saveLayout | `layout:save` | `dirPath`, `nodeCount`, `edgeCount` |
| useGraph ELK layout | `layout:auto` | `roomPath`, `nodeCount` |
| useGraph zoom handlers | `view:zoom` | `prevZoom`, `newZoom` |
| useGraph fitView | `view:fit` | - |
| useGraph applySearch | `search:apply` | `query`, `matchCount` |

### 6.4 存储操作

| 位置 | action | params |
|------|--------|--------|
| storage.createKB | `kb:create` | `kbName` |
| storage.deleteKB | `kb:delete` | `kbPath` |
| storage.readMarkdown | `markdown:load` | `cardPath`, `length` |
| storage.writeMarkdown | `markdown:save` | `cardPath`, `length` |
| storage.saveImage | `image:save` | `cardPath`, `filename`, `size` |

### 6.5 标签页操作

> 注：React 重构后已移除标签页（Tab）特性，roomStore 采用面包屑历史栈替代。

### 6.6 Git 操作

| 位置 | action | params |
|------|--------|--------|
| GitPanel.handleCommit | `git:commit` | `kbPath`, `fileCount`, `message` |
| GitPanel.handlePush | `git:push` | `kbPath` |
| GitPanel.handlePull | `git:pull` | `kbPath` |
| GitPanel.handleFetch | `git:fetch` | `kbPath` |

### 6.7 性能标记

| 位置 | action | params |
|------|--------|--------|
| useGraph.loadRoom 完成 | `perf:loadRoom` | `duration`, `nodeCount`, `edgeCount` |
| ELK 布局完成 | `perf:layout` | `duration`, `nodeCount` |
| 应用启动完成 | `perf:startup` | `totalDuration` |

---

## 七、文件清单

### 7.1 新增文件

| 文件路径 | 说明 |
|----------|------|
| `electron/log-service.js` | 后端日志服务模块 |
| `src/core/logger.ts` | 前端日志模块（Zustand 兼容） |
| `src/core/log-backend.ts` | 日志 IPC 桥接层 |
| `src/stores/monitorStore.ts` | 监控页面 Zustand store |
| `src/components/MonitorPage/MonitorPage.tsx` | 监控页面主组件 |
| `src/components/MonitorPage/MonitorPage.module.css` | 监控页面样式 |
| `docs/logging-system-design.md` | 本设计文档 |

### 7.2 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `electron/main.js` | 添加日志 IPC handlers、菜单项、LogService 初始化 |
| `electron/preload.js` | 添加 log:* 通道到白名单 |
| `dist-electron/preload.js` | 重新构建 |
| `src/App.tsx` | 添加 `monitoring` 视图路由 |
| `src/hooks/useGraph.ts` | 添加关键 action 日志调用 |
| `src/stores/roomStore.ts` | 添加 KB 切换日志 |
| `src/stores/appStore.ts` | 添加视图切换日志 |
| `src/core/storage.ts` | 已有 logger.catch，可补充结构化 action 日志 |
| `src/core/git-backend.ts` | 添加 Git 操作日志 |
| `src/components/GitPanel/GitPanel.tsx` | 添加 Git 操作日志调用 |

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

### 9.1 功能测试

- [ ] 菜单项 "视图->日志性能监控" 能正确打开监控窗口
- [ ] 日志正确写入 `logs/YYYY-MM-DD.log` 文件
- [ ] 关键词搜索正确过滤日志
- [ ] 时间范围筛选正确
- [ ] 日志等级筛选正确
- [ ] 动作类型筛选正确
- [ ] 日志条目点击展开显示完整详情
- [ ] 监控窗口关闭后日志仍正常写入

### 9.2 性能测试

- [ ] 日志写入不阻塞主线程（异步）
- [ ] 10000 条日志在 FilterBar 筛选时 UI 不卡顿
- [ ] 内存环形缓冲区不超过设定容量

### 9.3 边界测试

- [ ] 应用异常退出后，已写入的日志文件完整
- [ ] 日志文件超过 10MB 时正确轮转
- [ ] 多知识库切换时日志 traceId 正确关联
