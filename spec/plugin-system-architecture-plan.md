# TopoMind 插件系统总体架构与实施方案（修订版）

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：架构设计方案 / 技术实施方案 / 演进路线图  
**修订时间**：2026-06-03  
**当前状态**：修订完成，待按阶段实施  
**维护规则**：插件系统实现过程中，必须同步回写本文档中的阶段状态、已验证范围、风险变化与未决问题，避免设计与实现脱节。

---

## 1. 文档目的

本文档用于明确 TopoMind 插件系统的可落地方案，重点回答以下问题：

- 当前项目为什么需要插件系统
- 第一阶段到底做什么，不做什么
- 插件在当前 Electron 架构下运行在哪里
- 宿主边界、贡献点、生命周期与权限如何定义
- 如何从当前硬编码页面入口逐步迁移到插件化结构
- 哪些能力可以先稳定下来，哪些必须延后

本文档不再以“接近 VS Code 的通用平台”作为近期目标，而是优先建立一套适合 TopoMind 当前代码现状的、可逐步扩展的宿主能力模型。

---

## 2. 修订结论

### 2.1 最终结论

TopoMind 适合先实现一套“宿主可扩展、边界受控、以内建插件为主”的插件系统，而不是直接实现“本地任意代码热加载 + 同进程权限约束 + 完整第三方生态”。

第一阶段推荐只支持：

- `builtin`：随主应用构建发布的内建插件

`local-trusted` 不应在第一阶段以“Renderer 内直接 import 本地目录 JS”的方式实现，因为当前执行模型下无法形成真实权限边界，也与现有生产 CSP / 打包模型不一致。

### 2.2 当前阶段明确不做

- 不开放任意第三方插件执行
- 不在 Renderer 主上下文直接加载本地目录插件代码
- 不把 `window.electronAPI` 暴露给插件作为可用 API
- 不把现有 Zustand store 直接作为插件 API
- 不把声明式 `permissions` 误当成同进程安全沙箱
- 不把“禁用插件”定义为同进程内真实代码卸载
- 不在第一阶段实现插件市场、在线安装、在线更新
- 不在第一阶段承诺复杂插件依赖图与跨插件调用

### 2.3 推荐实施路线

按以下顺序推进：

1. 先建立插件宿主骨架、静态贡献索引与注册中心
2. 先重构“可注册的次级页面入口”，跑通最小懒激活链路
3. 抽宿主适配层与 Host API，并补齐权限映射表
4. 将标题栏、菜单、按钮等入口统一桥接到命令系统
5. 将学习统计、监控迁移为内建插件样板
6. 等宿主 API 稳定后，再评估隔离式 `local-trusted`

---

## 3. 当前项目基线

### 3.1 当前技术事实

当前项目核心结构为：

- Electron 主进程
- Electron preload 白名单 IPC
- React Renderer
- Zustand 全局状态
- 文件系统作为核心持久化载体

### 3.2 已确认的关键代码现状

当前代码中，以下事实直接影响插件设计：

- `src/App.tsx` 仍按 `tab.type` 写死页面渲染分支
- `src/stores/tabs/tabTypes.ts` 采用封闭联合类型定义 tab
- `src/stores/tabs/tabActions.ts` 内建了 `openMonitorTab`、`openStatisticsTab`
- `electron/preload.js` 将 `window.electronAPI` 暴露给整个渲染上下文
- `src/core/fs-backend.ts` 通过 `window.electronAPI.invoke()` 访问底层文件能力
- 生产环境存在严格 CSP，当前并不适合直接从任意本地目录加载 JS 模块

### 3.3 当前痛点

随着功能持续增加，现有模式会带来以下问题：

- 新功能需要侵入多个核心文件
- 页面、命令、设置、widget 缺少统一注册协议
- 监控、学习统计、未来 AI 工具都在争抢壳层入口
- 业务模块可以独立存在，但无法独立装配
- 宿主缺少稳定 API，导致模块边界依赖实现细节

### 3.4 为什么插件系统仍然是合理方向

TopoMind 已经具备“宿主 + 多功能域”的产品形态，包括：

- 知识库 / 图谱
- 文档
- 学习统计
- 日志与监控
- 未来的 AI 工具、导出工具、诊断工具

因此插件化是合理的，但近期目标应是“把宿主做成可扩展平台内核”，而不是“把应用立即开放成任意第三方平台”。

---

## 4. 设计修正与硬约束

本节用于明确本次修订中最重要的落地约束。

### 4.1 执行边界修正

如果插件代码与宿主代码运行在同一个 Renderer 主上下文内，那么：

- 插件无法被真正阻止访问 `window` 上的已暴露对象
- 所谓“只注入 Host API、不注入别的能力”不是安全边界，只是编码约定
- `permissions` 只能做能力声明和宿主侧门禁，不能做强隔离

因此：

- 第一阶段的同进程模型只适用于 `builtin`
- 任何需要“可信但不完全等同于宿主代码”的插件类型，都应延后到隔离执行模型之后再做

### 4.2 加载模型修正

当前项目的生产 CSP 与资源加载方式决定了：

- 不能把“从本地目录直接 `import()` 任意 JS 文件”作为近期正式方案
- 如果未来支持本地插件，必须同时设计对应的加载通道、协议白名单与执行容器

因此：

- 第一阶段只加载随应用构建的内建插件模块
- `local-trusted` 进入后续阶段，前提是已具备独立执行上下文或等价隔离模型

### 4.3 注册协议修正

旧方案中存在“manifest 静态贡献”和“运行时代码函数贡献”混用的问题，容易导致生命周期不一致。

本次统一约束如下：

- `manifest` 只负责声明静态元数据、兼容信息、激活事件、权限声明、静态贡献描述
- 所有可执行逻辑都来自插件入口模块
- 宿主在激活前只能依赖 manifest 中的静态信息，不能假设插件代码已经可用
- 静态贡献负责“可发现性”，运行时注册负责“可执行性”
- 宿主必须为命令、视图等可懒激活贡献建立“静态占位项 + 激活后绑定处理器”的桥接模型

### 4.4 懒激活桥接修正

如果插件命令处理器、视图渲染器只在 `activate()` 阶段注册，那么：

- `onCommand:<id>` 与 `onViewOpen:<id>` 不能直接依赖“处理器已存在”
- 宿主必须先根据 manifest 建立静态索引与占位记录
- 当用户首次触发命令或打开视图时，应先进入“确保插件激活”的流程
- 激活完成后，宿主再把本次请求重放给刚注册完成的运行时处理器

因此第一阶段必须明确实现：

- 静态贡献索引
- 激活中的并发去重
- 首次触发请求的延迟执行 / 重放
- 激活失败后的错误提示与故障记录

### 4.5 迁移顺序修正

在当前代码结构下，不能一上来就迁移业务模块为插件，而必须先改造宿主入口结构。

正确顺序应为：

1. 建插件骨架与注册中心
2. 把“硬编码次级页面”抽象成“可注册页面入口”
3. 把命令入口从硬编码改成统一命令注册
4. 抽 Host API 与宿主适配层
5. 再迁移学习统计与监控

### 4.6 工程约束修正

由于第一阶段 `builtin` 与宿主仍同仓、同进程、同打包产物运行，因此文档约束必须落到工程约束：

- 插件目录只能通过公开的插件 API 模块取能力
- 插件目录不得直接 import 宿主内部 feature / store / core / preload 适配实现
- 必须通过 ESLint / TS path 边界 / CI 校验阻止越界依赖
- “禁止直接访问 `window.electronAPI`” 在第一阶段属于工程规约，不是安全沙箱

---

## 5. 插件系统目标

### 5.1 第一阶段目标

插件系统第一阶段应解决：

- 新功能通过注册进入系统，而不是通过 `App.tsx` 写死分支进入系统
- 为页面、命令、widget、设置建立统一贡献协议
- 建立“静态贡献索引 -> 触发激活 -> 运行时绑定 -> 请求重放”的最小闭环
- 让宿主对插件生命周期、启停、诊断、注册项回收有统一控制
- 让学习统计、监控等现有官方功能具备插件化迁移路径
- 为未来隔离式插件运行模型预留接口边界

### 5.2 第一阶段非目标

第一阶段明确不追求：

- 不完全可信插件执行
- 第三方生态与市场能力
- 复杂权限弹窗系统
- 跨插件复杂依赖图
- 同进程下的真实模块卸载
- 把 `builtin` 的临时 UI 绑定方式直接当成未来跨隔离稳定协议
- 插件对宿主内部实现的直接读写

### 5.3 设计原则

- 渐进演进，不做大爆炸重构
- 先稳宿主边界，再迁业务模块
- 先做 `builtin`，后做隔离式 `local-trusted`
- 第一阶段的“可禁用、可回收”指注册项与事件订阅可撤销，不等同于真实代码卸载
- 所有插件能力必须可诊断、可归因、可在失败后阻止继续激活
- 插件面向抽象 API 编程，不面向 store / IPC / FSB 编程

---

## 6. 插件类型与运行时模型

### 6.1 第一阶段插件类型

第一阶段只定义并实现一种正式插件类型：

- `builtin`：随应用打包发布，由宿主控制加载时机的内建插件

### 6.2 未来插件类型

未来如确有需要，可引入：

- `local-trusted`：从本地目录安装，但必须运行在隔离执行上下文内

该类型的前提条件：

- 宿主 API 已稳定
- 插件加载协议已定义
- 执行上下文与宿主主 Renderer 分离
- 宿主具备对插件崩溃、超时、异常的诊断能力

### 6.3 第一阶段运行模型

第一阶段采用：

- 同 Renderer 进程
- 仅 `builtin`
- 通过 Host API 与适配层访问宿主能力

这是一种“工程边界模型”，不是严格安全沙箱。

### 6.4 为什么此模型当前可接受

原因如下：

- 第一阶段目标是模块化与宿主可扩展，不是开放第三方生态
- `builtin` 本身就属于主应用代码的一部分
- 同进程模型实现成本低，便于快速把架构骨架立起来

### 6.5 为什么不能据此直接推出 `local-trusted`

因为一旦代码与宿主共享渲染上下文：

- 插件理论上就能触达全局对象
- 权限声明无法形成真实隔离
- 宿主无法保证插件不会绕过 Host API

因此 `local-trusted` 必须和“隔离执行”绑定设计，不能只靠 manifest 声明来实现。

---

## 7. 总体架构

### 7.1 第一阶段总体模型

```text
+--------------------------------------------------------------------------------+
|                                TopoMind Host                                   |
|                                                                                |
|  +-------------------------- Renderer App Shell -----------------------------+ |
|  |                                                                          | |
|  |  Core Views: home / kb                                                   | |
|  |  Secondary View Host / Widget Host / Command Host / Settings Host        | |
|  |                                                                          | |
|  |  +---------------------- Plugin Host Layer ----------------------------+  | |
|  |  | Plugin Manager                                                     |  | |
|  |  | Plugin Registry                                                    |  | |
|  |  | Lifecycle Manager                                                  |  | |
|  |  | Host API Facade                                                    |  | |
|  |  +--------------------------+-----------------------------------------+  | |
|  |                             |                                            | |
|  |                   Builtin Plugin Modules                                | |
|  +-----------------------------+--------------------------------------------+ |
|                                |                                              |
|                        Host Adapters / Services                               |
|           workspace / tabs / commands / ui / documents / graph / logs        |
|                                |                                              |
|                  FSB / Renderer Facade / Electron IPC                         |
|                                |                                              |
|                            Main Process                                       |
+--------------------------------------------------------------------------------+
```

### 7.2 正确调用链路

```text
Builtin Plugin
  -> PluginContext / Host API
    -> Host Adapter / Host Service
      -> Renderer State / Facade / FSB
        -> electronAPI.invoke(...)
          -> main IPC
```

### 7.3 明确禁止的路径

```text
Plugin -> window.electronAPI.invoke(...)
Plugin -> 直接 import 宿主 feature 内部实现
Plugin -> 直接读写宿主内部 store
```

注意：上述“禁止”在第一阶段对 `builtin` 属于架构约束，不是沙箱级安全保证。

---

## 8. 模块划分

建议新增如下模块结构：

```text
src/plugins/
  host/
    pluginManager.ts
    pluginRegistry.ts
    pluginLifecycle.ts
    pluginManifest.ts
    pluginContext.ts
    pluginTypes.ts
  public/
    index.ts
    plugin.ts
    manifest.ts
    api.ts
    disposables.ts
  api/
    hostApi.ts
    workspaceApi.ts
    storageApi.ts
    tabApi.ts
    commandApi.ts
    uiApi.ts
    graphApi.ts
    documentApi.ts
    analyticsApi.ts
    loggingApi.ts
  runtime/
    builtinPluginLoader.ts
  extension-points/
    secondaryViews.ts
    commands.ts
    widgets.ts
    settings.ts
    analytics.ts
  adapters/
    workspaceHostAdapter.ts
    tabHostAdapter.ts
    commandHostAdapter.ts
    uiHostAdapter.ts
    graphHostAdapter.ts
    documentHostAdapter.ts
    analyticsHostAdapter.ts
    storageHostAdapter.ts
    loggingHostAdapter.ts
```

模块职责：

- `pluginManager`：扫描、加载、激活、停用、卸载插件
- `pluginRegistry`：保存注册结果，不承载业务流程
- `pluginLifecycle`：维护插件状态机与错误恢复
- `pluginContext`：为插件提供上下文、订阅管理与 API 入口
- `public/*`：提供给插件作者使用的稳定公开类型与导出入口
- `runtime/builtinPluginLoader`：负责加载内建插件模块
- `adapters/*`：对接现有 store / FSB / 组件壳层，形成反腐层

### 8.1 公开模块边界

为避免 `builtin` 在第一阶段直接依赖宿主内部文件，建议明确三层边界：

- `src/plugins/public/*`：插件作者可直接 import 的稳定公开入口
- `src/plugins/host/*`：仅宿主实现可用，插件代码不得直接 import
- `src/plugins/adapters/*`：仅宿主适配层可用，插件代码不得直接 import

建议规则：

- 插件实现文件只能从 `src/plugins/public/*` 取类型和 API
- 宿主实现可以同时访问 `host/*`、`api/*`、`adapters/*`
- `public/*` 不得反向 re-export 宿主内部 store、FSB、Electron IPC 细节

### 8.2 推荐公开导出

首版 `public/index.ts` 建议仅导出：

- `TopoMindPluginModule`
- `PluginContext`
- `PluginManifest`
- `Disposable`
- `CommandContribution` / `SecondaryViewContribution` / `WidgetContribution`
- `WorkspaceApi` / `ViewApi` / `CommandApi` / `UiApi`

这样可以保证插件作者面对的是稳定语义层，而不是宿主文件布局。

---

## 9. 贡献点设计

第一阶段建议只开放以下贡献点：

- `secondaryViews`：宿主次级页面入口，例如监控、学习统计、导出页
- `commands`：命令注册与执行
- `widgets`：标题栏 / 首页的小型展示组件
- `settings`：插件设置 schema
- `analytics`：分析模块与数据提供器

第一阶段不开放：

- 任意 DOM 注入
- 任意 React 根树注入
- 任意 BrowserWindow 创建
- 任意文件系统访问
- 任意网络访问
- 任意全局 store 改写

### 9.1 为什么不用 `tabs` 作为第一抽象名

当前代码中的 `tab` 承担了宿主核心导航语义：

- `home`
- `kb`
- `monitor`
- `statistics`

其中 `home` 与 `kb` 仍应保留为宿主核心概念；插件先接入的是“可注册的次级页面入口”，而不是立即重写整套 tab 基础模型。

为降低首期改造风险，建议先抽象 `secondaryViews`，再视需要向通用 `tabs` 过渡。

---

## 10. Manifest 设计

### 10.1 设计原则

`manifest` 只承载静态信息，不承载可执行函数。

它负责：

- 声明插件身份
- 声明兼容范围
- 声明激活事件
- 声明权限需求
- 声明静态贡献元数据

### 10.2 推荐结构

```json
{
  "id": "topomind.learning-statistics",
  "name": "learning-statistics",
  "displayName": "学习统计",
  "description": "提供学习统计页面、组件与分析能力",
  "version": "1.0.0",
  "hostVersion": "^5.2.0",
  "kind": "builtin",
  "entry": "./index.js",
  "activationEvents": [
    "onAppReady",
    "onCommand:learning.open",
    "onViewOpen:learning.statistics"
  ],
  "permissions": [
    "workspace.read",
    "storage.plugin.read",
    "storage.plugin.write",
    "view.register",
    "command.register",
    "widget.register",
    "analytics.register",
    "log.write"
  ],
  "contributes": {
    "secondaryViews": [
      {
        "id": "learning.statistics",
        "title": "学习统计",
        "icon": "chart",
        "placement": "workspace-secondary",
        "openCommand": "learning.open"
      }
    ],
    "commands": [
      {
        "id": "learning.open",
        "title": "打开学习统计"
      }
    ],
    "widgets": [
      {
        "id": "learning.quickPreview",
        "title": "学习速览",
        "placement": "titlebar"
      }
    ],
    "settings": [
      {
        "key": "learning.dailyGoal",
        "type": "number",
        "default": 7200,
        "title": "每日学习目标（秒）"
      }
    ]
  }
}
```

### 10.3 核心约束

- `manifest` 中不出现 `render`、`run`、`compute` 之类函数型字段
- `manifest.contributes` 中只放宿主可提前读取的静态描述
- 真实的 UI 渲染器、命令处理器、分析计算器在 `activate()` 中注册

---

## 11. 插件入口与注册协议

### 11.1 建议插件入口接口

```ts
export interface TopoMindPluginModule {
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
```

### 11.2 统一注册协议

插件入口模块的职责如下：

- 读取自己的 `PluginContext`
- 通过 `ctx.views.register()`、`ctx.commands.register()` 等 API 注册运行时能力
- 将所有注册结果放入 `subscriptions`
- 在停用时可由宿主统一回收

### 11.3 静态贡献与运行时绑定的分工

统一协议按两层处理：

- `manifest` 静态贡献先进入 registry，提供标题、图标、placement、激活事件等可发现信息
- 插件第一次被真正使用时，宿主负责确保插件已激活
- 插件激活后，再把命令处理器、视图渲染器、widget 渲染器等运行时能力绑定到对应贡献项
- 对于尚未绑定运行时处理器的贡献项，宿主必须维持“待激活占位态”，而不是假设其立即可执行

### 11.4 为什么这样设计

这样可以统一解决三个问题：

- 宿主在激活前只依赖 manifest 的静态信息
- 插件的实际执行逻辑只在激活时进入系统
- 生命周期与注册行为保持一致，不再出现“注册发生在激活前但注册内容依赖运行时代码”的矛盾

### 11.5 插件编写约束

为保证停用、回收与诊断可落地，第一阶段要求：

- 插件模块顶层不得执行长生命周期副作用
- 定时器、事件监听、异步轮询、后台任务必须纳入 `subscriptions`
- 插件不得直接读取 `window.electronAPI` 或宿主 store
- 插件 UI 必须通过宿主提供的容器挂载，不能自行创建额外根节点
- 若插件需要常驻服务，应先拆为宿主服务，再由插件只负责入口与展示层

### 11.6 首版公开接口草案

以下接口不是最终定稿，但建议作为阶段 A + B + C 的首版形态：

```ts
export interface Disposable {
  dispose(): void
}

export type ActivationReason =
  | { type: 'app-ready' }
  | { type: 'workspace-ready' }
  | { type: 'command'; commandId: string }
  | { type: 'view'; viewId: string }

export interface PluginContext {
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly activationReason: ActivationReason
  readonly subscriptions: Disposable[]

  readonly workspace: WorkspaceApi
  readonly views: ViewApi
  readonly commands: CommandApi
  readonly ui: UiApi
  readonly log: LoggingApi
}

export interface TopoMindPluginModule {
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
```

配套约束：

- `PluginContext` 只暴露经权限裁剪后的 API
- `activationReason` 用于插件按需初始化，避免无差别启动全部逻辑
- `subscriptions` 由宿主统一回收，插件不可替换该数组引用

### 11.7 运行时注册接口草案

```ts
export interface SecondaryViewRendererProps {
  viewId: string
  pluginId: string
}

export interface ViewApi {
  register(definition: {
    viewId: string
    render: (props: SecondaryViewRendererProps) => React.ReactNode
  }): Disposable

  open(viewId: string): Promise<void>
}

export interface CommandApi {
  register(definition: {
    commandId: string
    execute: (args?: unknown) => void | Promise<void>
  }): Disposable

  execute(commandId: string, args?: unknown): Promise<void>
}

export interface UiApi {
  registerWidget(definition: {
    widgetId: string
    placement: 'titlebar' | 'home'
    render: () => React.ReactNode
  }): Disposable

  notify(input: { title: string; message?: string; level?: 'info' | 'warn' | 'error' }): void
}
```

首版要求：

- `viewId`、`commandId`、`widgetId` 必须与 manifest 静态贡献一致
- 注册阶段若找不到对应静态贡献，应直接报错并阻止插件进入 `running`
- 宿主 registry 必须能根据 `Disposable` 反查到对应插件与贡献项

### 11.8 Registry 数据模型草案

建议将“静态贡献描述”和“运行时绑定结果”拆分存储：

```ts
export interface StaticContributionRecord {
  pluginId: string
  contributionType: 'view' | 'command' | 'widget' | 'setting' | 'analytics'
  contributionId: string
  activationEvents: string[]
  manifestData: Record<string, unknown>
}

export interface RuntimeBindingRecord {
  pluginId: string
  contributionType: 'view' | 'command' | 'widget' | 'analytics'
  contributionId: string
  status: 'pending' | 'bound' | 'failed'
  disposable?: Disposable
  errorMessage?: string
}
```

这样拆分的目的：

- 静态层可在不执行插件模块代码时完成索引
- 运行时层可独立回收，不污染静态层数据
- 后续迁移到隔离执行时，只需替换运行时绑定实现，不必重写静态贡献协议

---

## 12. 生命周期设计

### 12.1 生命周期状态机

建议状态至少包含：

- `disabled`
- `discovered`
- `validated`
- `indexed`
- `waiting`
- `loaded`
- `activating`
- `running`
- `deactivated`
- `failed`

### 12.2 生命周期流程

```text
discover
  -> validateManifest
  -> indexStaticContributions
  -> waitForActivation
  -> resolveActivationRequest
  -> loadModule
  -> activate
  -> bindRuntimeContributions
  -> running
  -> deactivate
  -> dispose
```

### 12.3 各阶段定义

#### `discover`

- 枚举内建插件清单
- 建立初始运行记录

#### `validateManifest`

- 校验 schema
- 校验宿主版本兼容范围
- 校验权限字段是否合法
- 校验静态贡献结构是否合法

#### `indexStaticContributions`

- 仅登记可提前读取的静态贡献信息
- 例如视图入口、命令标题、设置 schema
- 为命令、视图等贡献建立占位记录与归属关系
- 不执行插件模块代码

#### `waitForActivation`

- 根据激活事件等待真正需要插件运行的时机
- 保持贡献项处于“可发现但未绑定处理器”的占位状态

#### `resolveActivationRequest`

- 收到 `onCommand:*`、`onViewOpen:*` 等触发请求
- 查找对应插件并确保只发起一次激活过程
- 记录当前待重放请求
- 若激活失败，则把错误落到诊断与 UI 提示

#### `loadModule`

- 加载内建插件入口模块
- 创建 `PluginContext`

#### `activate`

- 执行 `plugin.activate(ctx)`
- 插件通过 Host API 注册运行时能力

#### `bindRuntimeContributions`

- 将插件注册的运行时处理器绑定到已索引的静态贡献
- 重放首次触发该插件的待执行请求
- 若绑定不完整，则将插件标记为 `failed`

#### `deactivate`

- 调用插件可选的 `deactivate()`
- 统一释放 `subscriptions`
- 回收运行时注册项
- 阻止该插件后续继续被自动激活

#### `dispose`

- 清理上下文、错误状态、临时资源
- 用于禁用、热重载或宿主退出
- 第一阶段的 `dispose` 不承诺真实卸载已被打包进宿主的模块代码

### 12.4 停用与回收语义

第一阶段需要明确以下语义边界：

- `disable`：该插件后续不再参与自动激活，已有运行时注册项被撤销
- `deactivate`：调用插件停用逻辑并释放订阅，但不承诺卸载 JS 模块
- `recover`：宿主可在明确动作下重新允许其激活，不做自动无条件重试
- `failed`：插件出现激活失败、注册不完整、运行时异常时进入失败态，并保留诊断信息

### 12.5 激活事件建议

第一阶段建议只支持：

- `onAppReady`
- `onWorkspaceReady`
- `onCommand:<commandId>`
- `onViewOpen:<viewId>`

不建议第一阶段就开放过细的事件面，防止宿主与插件形成事件耦合网。

### 12.6 首次打开视图的宿主时序

建议宿主按以下顺序处理：

```text
User opens view "learning.statistics"
  -> ViewHost checks static registry
  -> find owner plugin = topomind.learning-statistics
  -> runtime binding missing, enqueue current request
  -> PluginManager.ensureActivated(pluginId, reason=onViewOpen:learning.statistics)
  -> load module / activate plugin
  -> bind runtime view renderer
  -> replay queued openView request
  -> render plugin view
```

这一时序要求：

- 同一插件并发激活必须去重
- 同一贡献项的首次请求只重放一次
- 激活失败时，视图宿主应显示错误占位态，而不是白屏或静默失败

### 12.7 首次执行命令的宿主时序

命令与视图保持同一模型：

```text
User executes command "learning.open"
  -> CommandRegistry finds static command
  -> ensure owner plugin activated
  -> bind runtime command handler
  -> replay execute request
  -> command handler may call views.open("learning.statistics")
```

注意：

- 命令系统不应要求“先有运行时处理器，后有静态命令”
- 菜单、标题栏、快捷键统一面向命令 ID，而不是面向插件模块函数

### 12.8 失败处理最低要求

第一阶段至少要做到：

- `activate()` 抛错时记录插件 ID、激活原因、错误堆栈
- 运行时注册缺失时将插件置为 `failed`
- 失败态插件默认不自动重试，避免进入反复抖动
- 视图失败时显示带插件 ID 的错误占位面板
- 命令失败时显示宿主通知，并保留诊断记录

---

## 13. Host API 边界

### 13.1 基本原则

插件不得直接依赖：

- 宿主内部组件实现
- 宿主内部 Zustand store
- `window.electronAPI`
- `FSB`
- 原始 IPC 通道

插件只能通过 Host API 获得能力。

### 13.2 Host API 分层

建议按能力域划分：

- `workspaceApi`
- `storageApi`
- `viewApi`
- `commandApi`
- `uiApi`
- `graphApi`
- `documentApi`
- `analyticsApi`
- `loggingApi`

### 13.3 API 设计要求

所有 API 必须满足：

- 面向语义，而不是面向底层技术实现
- 可由现有 store / FSB / IPC 适配实现
- 能按插件维度做日志、诊断和错误归因
- 能在未来迁移到独立插件宿主进程时保留语义稳定

### 13.4 重要边界约束

- API 返回值尽量使用可序列化数据结构
- 避免把 React 组件实例、store 引用、类实例直接暴露给插件
- 不把“函数对象直接存进跨进程协议”当成长期稳定模型

### 13.5 UI 扩展契约

第一阶段统一采用“双层契约”：

- 稳定层：所有视图、widget、设置项都必须先以可序列化描述进入 registry
- 运行时层：仅 `builtin` 可在激活后向宿主容器绑定 React 渲染器
- React 渲染器绑定只属于第一阶段 `builtin` 的内部运行时桥接，不作为未来 `local-trusted` 的稳定 API
- 宿主实现时应将“描述信息”和“渲染器引用”存放在不同 registry 中，避免后续隔离化时接口撕裂

---

## 14. 权限模型

### 14.1 定位

第一阶段的权限模型是“声明式门禁模型”，不是沙箱级安全模型。

它的主要作用是：

- 约束宿主应给插件暴露哪些 API 面
- 帮助宿主做日志、诊断与后续升级
- 为未来隔离执行预留稳定权限语义

### 14.2 第一阶段权限建议

建议采用更贴近 Host API 的权限名称：

- `workspace.read`
- `workspace.observe`
- `storage.plugin.read`
- `storage.plugin.write`
- `view.register`
- `view.open`
- `command.register`
- `command.execute`
- `widget.register`
- `settings.register`
- `document.read`
- `document.write`
- `graph.read`
- `graph.navigate`
- `analytics.register`
- `log.write`
- `ui.notify`
- `ui.dialog`
- `ui.openExternal`

### 14.3 权限实施规则

- 插件必须显式声明权限
- 宿主按权限决定向 `PluginContext` 暴露哪些 API 方法
- 宿主必须记录每个插件声明了哪些权限
- 第一阶段不承诺对 `builtin` 做强隔离，但仍要求实现宿主侧注入约束

### 14.4 工程级约束要求

为避免权限模型退化为文档概念，第一阶段必须配套：

- 插件目录边界规则，禁止直接 import `src/core/*`、`src/stores/*`、宿主 feature 内部模块
- ESLint 或等价静态检查，禁止直接访问 `window.electronAPI`
- TS path / barrel 导出策略，只暴露 `src/plugins/api/*` 与 `src/plugins/host/*` 的公开入口
- CI 校验，确保新增插件代码不绕过 Host API

### 14.5 权限与 API 映射要求

实现前必须补一份“API 方法到权限点”的映射表，例如：

- `ui.openExternal()` -> `ui.openExternal`
- `commands.register()` -> `command.register`
- `documents.writeDocument()` -> `document.write`

没有映射表的权限设计，最终会退化成文档概念，无法落地。

### 14.6 首版权限映射表（建议起步集）

| API 方法 | 权限点 | 说明 |
| --- | --- | --- |
| `workspace.getCurrentWorkspace()` | `workspace.read` | 读取当前工作区基础信息 |
| `workspace.onDidChangeWorkspace()` | `workspace.observe` | 订阅工作区变化 |
| `views.register()` | `view.register` | 注册次级页面运行时渲染器 |
| `views.open()` | `view.open` | 打开一个已声明视图 |
| `commands.register()` | `command.register` | 注册命令处理器 |
| `commands.execute()` | `command.execute` | 执行命令 |
| `ui.registerWidget()` | `widget.register` | 注册 widget 渲染器 |
| `ui.notify()` | `ui.notify` | 发送宿主通知 |
| `ui.openExternal()` | `ui.openExternal` | 打开外部链接 |
| `documents.readDocument()` | `document.read` | 读取文档内容 |
| `documents.writeDocument()` | `document.write` | 写入文档内容 |
| `graph.getCurrentSelection()` | `graph.read` | 读取当前图谱选择态 |
| `graph.navigateToNode()` | `graph.navigate` | 导航到图谱节点 |
| `analytics.registerProvider()` | `analytics.register` | 注册分析数据提供器 |
| `log.info()` / `log.error()` | `log.write` | 记录插件维度日志 |

建议实施规则：

- 若插件未声明对应权限，相关 API 方法在 `PluginContext` 中不应出现
- 若插件激活时尝试注册超出静态声明范围的能力，宿主应直接拒绝
- 权限拒绝需写入诊断记录，便于后续排查 manifest 与代码不一致

### 14.7 工程校验清单

建议在工程层补齐以下校验：

- ESLint：禁止插件代码直接访问 `window.electronAPI`
- ESLint：禁止插件代码 import `src/core/*`、`src/stores/*`、宿主 feature 私有路径
- CI：新增插件时必须存在 `manifest`、入口模块与最小 smoke case
- Typecheck：公开 `public/*` 导出的类型变化需要触发受影响插件检查

这些校验属于第一阶段落地的重要组成部分，而不是“后续优化项”。

---

## 15. 与当前代码的映射关系

### 15.1 当前最关键的宿主收口点

当前推进插件系统时，必须优先收口以下能力：

- 次级页面入口
- 命令入口
- 标题栏 widget 入口
- 设置 schema 注册
- 工作区上下文读取
- 受控文件与文档访问

### 15.2 当前真实调用主线

当前渲染层到主进程的关键访问路径为：

```text
Renderer -> FSB -> electronAPI.invoke -> IPC -> Main Process
```

插件系统应建立在该主线之上，而不是绕过该主线。

正确目标是：

```text
Plugin -> Host API -> Host Adapter -> FSB / Renderer Facade -> IPC
```

### 15.3 需要特别注意的现状

- `App.tsx` 当前仍是硬编码页面壳层
- `tabStore` 仍把 `monitor` 与 `statistics` 当内建固定 tab
- `CustomTitleBar.tsx` 当前仍直接打开监控页、渲染学习统计 widget
- `LearningTrackerProvider` 当前更像宿主级服务，而不是纯插件自有底层
- 这些直接 import 与根级 provider 意味着：在完成迁移前，“停用插件”只能保证撤销注册项，不能保证相关代码完全退出宿主运行图

这意味着学习统计的迁移方式必须是：

- 宿主服务保留
- UI 入口插件化
- 数据采集与底层状态管理后移处理

---

## 16. 分阶段实施计划

## 阶段 A. 建立插件宿主骨架

**目标**：建立可用的 `PluginManager`、`PluginRegistry`、`PluginContext`、`HostApi` 类型边界，以及静态贡献索引能力。  
**状态**：待实施

产出：

- `src/plugins/` 基础目录
- 核心类型与最小实现
- `builtin` 插件加载入口
- manifest 校验与静态贡献索引

验收：

- 项目可通过 `npm run typecheck`
- 宿主可以发现并索引一个测试插件的静态贡献
- 不改变现有用户可见行为

---

## 阶段 B. 重构“次级页面入口”

**目标**：在不动 `home / kb` 核心语义的前提下，把监控、学习统计这类页面抽象成可注册入口，并跑通首个懒激活闭环。  
**状态**：待实施

产出：

- `SecondaryViewRegistry`
- `PluginViewHost`
- 宿主核心视图与次级视图分层
- `onViewOpen:<viewId>` 激活桥接

验收：

- `App.tsx` 不再只能靠硬编码分支渲染全部次级页面
- 宿主可从 registry 渲染至少一个测试页面
- 首次打开测试页面时可触发插件激活并完成请求重放

---

## 阶段 C. 抽 Host API 与适配层

**目标**：让插件面向抽象 API，而不是直接依赖 store / FSB / IPC。  
**状态**：待实施

产出：

- `WorkspaceApi` 首版
- `ViewApi` 首版
- `CommandApi` 首版
- `UiApi` 首版
- 宿主 adapters 首版
- 权限点到 API 方法映射表
- 插件目录工程边界校验首版

验收：

- 插件可通过 Host API 完成一次页面打开与 workspace 读取
- 不新增插件直接访问底层 IPC 的路径
- 违反边界规则的插件代码能在静态检查阶段被识别

---

## 阶段 D. 统一命令入口

**目标**：将标题栏、菜单、按钮等动作入口统一切到命令系统。  
**状态**：待实施

产出：

- `CommandRegistry`
- 宿主默认命令集合
- 菜单 / 标题栏对命令 ID 的桥接

验收：

- `monitor.open`、`learning.open` 等命令由统一调度执行
- 标题栏不再直接依赖业务模块 action

---

## 阶段 E. 迁移内建插件样板

**目标**：把现有官方功能迁移为标准 `builtin` 插件。  
**状态**：待实施

优先顺序：

1. 学习统计
2. 监控

迁移原则：

- 先迁 UI 入口与命令入口
- 再迁 widget
- 再迁 analytics
- 宿主级 provider / 底层服务先保留，不强行一次性插件化
- 停用插件的验收口径以“注册项回收 + 不再自动激活”为准，不以真实模块卸载为准

验收：

- 至少一个官方功能完成内建插件化迁移
- 插件停用后其注册项可以回收

---

## 阶段 F. 评估隔离式 `local-trusted`

**目标**：仅在宿主 API 稳定后，评估是否需要本地可信插件。  
**状态**：延后，不进入当前实施范围

前置条件：

- 已有稳定 Host API
- 已有插件错误诊断能力
- 已明确插件执行容器
- 已解决本地代码加载与 CSP / 打包兼容问题

本阶段未满足前，不得把“本地目录 JS 直接 import”作为正式设计落地。

---

## 17. 当前实施范围（MVP）任务单

这里的“MVP”指阶段 A + B + C 的最小闭环，不等同于第一阶段全部目标。

### 17.1 要做

- 建 `src/plugins/` 目录骨架
- 建核心类型与最小空实现
- 建 `PluginRegistry`
- 建 `builtin` 插件加载入口
- 建 manifest 校验与静态贡献索引
- 为 `secondaryViews` 建立占位项与激活桥接
- 在宿主壳层接入 `secondaryViews` 渲染能力
- 建最小 `WorkspaceApi` / `ViewApi`
- 建插件目录边界静态校验
- 增加一个最小测试插件验证链路

### 17.2 不做

- 不正式迁移学习统计
- 不正式迁移监控
- 不完成标题栏与菜单的统一命令桥接
- 不做本地插件目录扫描
- 不做隔离插件宿主进程
- 不改 preload IPC 白名单策略

### 17.3 完成定义

满足以下条件即可认为 MVP 完成：

- `src/plugins/` 目录与基础类型齐备
- `PluginRegistry` 可注册与回收一个次级页面入口
- `PluginManager` 能加载至少一个内建测试插件
- 宿主能基于静态贡献发现该测试插件页面
- 首次打开该页面时可触发激活、绑定运行时处理器并完成渲染
- 插件可通过最小 Host API 读取 workspace 信息
- 越界访问宿主内部实现的测试代码能被静态规则识别
- 现有 `home` 与 `kb` 行为不受影响
- `npm run typecheck` 通过

### 17.4 宿主核心组件职责拆分

为避免 `PluginManager` 过度膨胀，MVP 建议按以下职责拆分：

**`pluginManager`**

- 对外提供 `discover()`、`ensureActivated()`、`deactivate()`、`disable()`、`getPluginState()`
- 编排生命周期流程，但不直接保存复杂 registry 数据结构
- 负责激活并发去重、失败态拦截、激活原因透传

**`pluginRegistry`**

- 保存静态贡献索引
- 保存运行时绑定记录
- 提供按 `viewId` / `commandId` / `widgetId` 反查所属插件的能力
- 提供按插件维度回收运行时注册项的能力

**`pluginLifecycle`**

- 维护状态迁移合法性
- 记录每个插件最近一次激活原因、失败原因、失败时间
- 向诊断面板暴露可读状态数据

**`pluginContext`**

- 创建经权限裁剪后的 API 视图
- 管理 `subscriptions`
- 暴露插件身份、manifest、激活原因

**`builtinPluginLoader`**

- 根据内建插件清单加载入口模块
- 校验入口导出是否满足 `TopoMindPluginModule`
- 不负责生命周期编排

### 17.5 宿主实现顺序建议

建议按以下最小开发顺序推进：

1. 定义 `PluginManifest`、`TopoMindPluginModule`、`PluginState`
2. 建立内建插件清单与 manifest 校验
3. 实现 `pluginRegistry` 的静态贡献索引
4. 实现 `SecondaryViewRegistry` 对静态视图的读取
5. 实现 `pluginManager.ensureActivated()` 与激活去重
6. 实现 `ctx.views.register()` 并回写运行时绑定记录
7. 实现 `PluginViewHost` 的首次打开视图逻辑
8. 补 `WorkspaceApi` 最小实现
9. 补失败态占位 UI 与诊断输出
10. 最后接入测试插件验证链路

建议不要先做：

- 完整命令系统
- widget 动态区域
- analytics provider
- 热重载
- 隔离进程

### 17.6 `secondaryViews` 最小数据结构

首版建议把 `secondaryViews` 拆成“静态声明”和“运行时渲染”两部分：

```ts
export interface SecondaryViewContribution {
  id: string
  title: string
  icon?: string
  placement: 'workspace-secondary'
  openCommand?: string
}

export interface SecondaryViewRuntimeBinding {
  viewId: string
  pluginId: string
  render: (props: SecondaryViewRendererProps) => React.ReactNode
  disposable: Disposable
}
```

宿主侧至少要有两个表：

- `staticSecondaryViewsById: Map<string, SecondaryViewContributionRecord>`
- `runtimeSecondaryViewsById: Map<string, SecondaryViewRuntimeBinding>`

这样做的收益：

- 静态表支持导航入口、菜单入口、空态占位
- 运行时表支持真正渲染与停用时回收
- 二者分离后，懒激活和失败态更容易处理

### 17.7 `secondaryViews` 最小宿主数据流

建议 MVP 按以下数据流实现：

```text
App Shell
  -> reads current active secondary view id
  -> PluginViewHost(viewId)
    -> query static registry
    -> if runtime renderer missing: ensure plugin activated
    -> if binding success: render runtime renderer
    -> if binding failed: render error placeholder
```

配套宿主职责：

- `App.tsx` 不再直接 import 业务次级页面组件
- 宿主导航层只关心 `viewId`
- `PluginViewHost` 负责把 `viewId` 映射到插件运行时渲染器
- 失败态与加载态由宿主统一提供，不由插件自行兜底

### 17.8 `secondaryViews` 与现有 tab 模型的过渡方式

为降低重构风险，建议不要在 MVP 阶段直接推翻现有 `tab` 模型，而采用桥接方式：

1. 保留 `home`、`kb` 作为宿主核心 tab
2. 将 `monitor`、`statistics` 从固定业务 tab 逐步改造为“指向 `secondaryViewId` 的宿主 tab”
3. 宿主 tab store 不直接保存业务组件类型，而保存 `secondaryViewId`
4. `PluginViewHost` 根据 `secondaryViewId` 决定实际渲染内容

建议的过渡态结构：

```ts
export interface SecondaryViewTab {
  id: string
  type: 'secondary-view'
  viewId: string
  label: string
}
```

这样可以避免第一阶段就把整套 tab 体系完全插件化，同时能逐步消除 `monitor` / `statistics` 的硬编码分支。

### 17.9 `PluginViewHost` 最小渲染策略

宿主渲染器建议至少支持三种状态：

- `loading`：正在等待插件完成激活与绑定
- `ready`：已有运行时渲染器，正常渲染插件视图
- `error`：激活或绑定失败，展示宿主级错误占位

建议宿主级错误占位至少显示：

- 插件 `pluginId`
- 视图 `viewId`
- 简短错误说明
- 可选的“重试激活”或“打开诊断”入口

### 17.10 首个测试插件建议目录

建议先增加一个不依赖真实业务的测试插件，例如：

```text
src/plugins/builtin/devtools-sample/
  manifest.json
  index.tsx
  SampleView.tsx
```

该插件目标只验证链路，不承担真实业务：

- 注册一个 `secondaryView`
- 注册一个打开该视图的命令
- 渲染一个简单页面，展示 `pluginId`

### 17.11 首个测试插件 Manifest 样例

```json
{
  "id": "topomind.devtools-sample",
  "name": "devtools-sample",
  "displayName": "开发测试插件",
  "version": "0.1.0",
  "hostVersion": "^5.2.0",
  "kind": "builtin",
  "entry": "./index.tsx",
  "activationEvents": [
    "onCommand:devtoolsSample.open",
    "onViewOpen:devtools.sample"
  ],
  "permissions": [
    "workspace.read",
    "view.register",
    "view.open",
    "command.register",
    "command.execute",
    "log.write"
  ],
  "contributes": {
    "secondaryViews": [
      {
        "id": "devtools.sample",
        "title": "测试插件页面",
        "placement": "workspace-secondary",
        "openCommand": "devtoolsSample.open"
      }
    ],
    "commands": [
      {
        "id": "devtoolsSample.open",
        "title": "打开测试插件页面"
      }
    ]
  }
}
```

### 17.12 首个测试插件入口样例

```ts
import type { TopoMindPluginModule } from '../../public'

const plugin: TopoMindPluginModule = {
  activate(ctx) {
    ctx.commands.register({
      commandId: 'devtoolsSample.open',
      execute: async () => {
        await ctx.views.open('devtools.sample')
      },
    })

    ctx.views.register({
      viewId: 'devtools.sample',
      render: () => {
        return (
          <div style={{ padding: 16 }}>
            <h2>测试插件页面</h2>
            <p>pluginId: {ctx.pluginId}</p>
          </div>
        )
      },
    })

    ctx.log.info('devtools-sample activated')
  },
}

export default plugin
```

样例要求：

- 不直接依赖业务 store
- 不直接 import 宿主 feature 组件
- 只验证命令 -> 激活 -> 视图绑定 -> 渲染的链路

### 17.13 MVP 验证用例建议

建议至少验证以下场景：

1. 宿主启动后可发现测试插件的静态视图与命令
2. 首次执行 `devtoolsSample.open` 时插件被激活
3. 激活完成后页面成功渲染
4. 停用插件后视图运行时绑定被回收
5. 再次打开该视图时，若插件被禁用，则宿主给出明确失败提示
6. 插件代码若直接 import `src/core/*`，静态检查失败

这些场景应作为 MVP 的最低验证集，而不是可选项。

---

## 18. 首批迁移建议

### 18.1 学习统计

推荐定位：

- 宿主级学习跟踪服务 + 插件化 UI 层

第一步迁移：

- `learning.open` 命令
- 学习统计页面入口
- 标题栏学习速览 widget

暂不迁移：

- 数据采集底座
- session 管理
- 事实数据持久化主链路

### 18.2 监控模块

推荐定位：

- 更完整的内建插件样板

优点：

- 页面相对独立
- 命令入口清晰
- 对核心工作区主链路耦合较少

适合作为第二个迁移样板，用来验证插件系统不是只为学习统计定制。

---

## 19. 风险与控制策略

### 19.1 主要风险

- 过早把 `local-trusted` 作为同进程方案落地，导致安全边界失真
- 在 `App.tsx` 未重构前就迁业务插件，导致出现双路由与双注册中心
- 没有实现“静态占位 -> 激活 -> 重放”的桥接，导致懒激活设计无法成立
- API 设计过度贴近现有 store，导致后续难以稳定
- 把“禁用插件”误解成真实代码卸载，导致验收口径失真
- 没有工程级边界校验，导致插件绕过 Host API 直接访问宿主内部实现
- 没有权限映射表，导致权限模型停留在概念层
- 让插件直接携带宿主内部对象，导致未来无法演进到隔离执行

### 19.2 控制策略

- 第一阶段只做 `builtin`
- 先改宿主入口，再迁业务模块
- 先做静态贡献索引，再做运行时处理器绑定
- 用 adapter 收口现有 store / FSB / IPC
- 用 manifest 管静态声明，用 `activate()` 管运行时注册
- 用工程规则阻止直接访问宿主内部实现
- 每一阶段都验证注册、启停、回收、类型检查

---

## 20. 验收标准

### 20.1 MVP 验收

当当前实施范围（阶段 A + B + C）完成后，至少应满足：

- 新的次级页面不再必须在 `App.tsx` 中手写分支接入
- 插件的静态贡献可在不执行插件模块代码的前提下被宿主发现
- 首次打开测试页面时，宿主可以按 `onViewOpen:<viewId>` 触发激活并重放本次请求
- 插件运行逻辑通过最小 Host API 与宿主交互
- 插件停用后，其注册项和订阅可被宿主正确回收，且不会继续自动激活
- 不新增插件直接访问底层 IPC 的正式实现路径
- 插件目录越界依赖可被静态规则识别

### 20.2 第一阶段完成验收

当第一阶段全部范围完成后，至少应满足：

- 新的次级页面不再必须在 `App.tsx` 中手写分支接入
- 插件通过标准注册协议接入宿主
- 命令、页面、widget、设置的静态贡献与运行时绑定模型保持一致
- 插件运行逻辑通过 Host API 与宿主交互
- 插件停用后注册项可以被宿主正确回收，且不会继续自动激活
- 标题栏与菜单动作可以通过命令系统统一调度
- 学习统计或监控至少有一个模块完成 `builtin` 迁移样板
- 权限映射表、目录边界规则、越界静态检查已落地
- 不新增插件直接访问底层 IPC 的正式实现路径

---

## 21. 当前未决问题

以下问题在实施前需要继续明确：

- `secondaryViews` 是否在第二阶段后统一改名为通用 `tabs`
- 学习统计 provider 何时从宿主级服务继续下沉
- `builtin` 的内部 UI 运行时桥接何时收敛为更统一的视图渲染模型
- 如果未来实现隔离式 `local-trusted`，执行容器选型是什么
- 插件错误诊断面板是否作为监控模块的一部分复用

---

## 22. 后续维护规则

后续每次推进插件系统实现时，必须同步更新本文档，至少更新：

- 阶段状态
- 子任务状态
- 实际落地文件
- 已验证结果
- 当前风险变化
- 新出现的设计偏差

若实现过程中发现设计与现状不一致，优先先修订本文档，再进入代码实现。
