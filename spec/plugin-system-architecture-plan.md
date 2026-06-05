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

### 16.1 总体执行原则

后续所有插件系统改造，必须严格按“计划 -> 实施 -> 验证 -> 回写”的闭环推进，不允许跳过中间环节直接扩散修改范围。

执行原则如下：

- 先修宿主骨架，再迁业务模块
- 先打通最小链路，再扩展贡献点
- 每次只解决一个明确阶段或一个明确子任务
- 每次执行都必须回写本文档中的阶段状态、任务状态、落地文件与验证结果
- 未完成上一阶段验收，不进入下一阶段正式实现
- 若执行中发现设计偏差，先更新本文档，再继续编码

### 16.2 后续整体修复总路线

建议将后续整体修复拆成 8 个连续阶段：

| 阶段 | 名称 | 目标 | 是否进入当前计划 |
| --- | --- | --- | --- |
| P0 | 文档收敛与基线确认 | 将设计、MVP、验收、执行规则收敛到同一文档 | 是 |
| P1 | 插件宿主骨架 | 建立 manifest、registry、lifecycle、loader、manager 的最小骨架 | 是 |
| P2 | `secondaryViews` 链路 | 打通视图静态索引、懒激活、运行时绑定、宿主渲染 | 是 |
| P3 | Host API 与工程边界 | 建立最小 Host API、权限映射、目录边界与静态校验 | 是 |
| P4 | 命令系统统一化 | 统一标题栏、菜单、快捷键与插件命令入口 | 是 |
| P5 | 官方插件迁移样板 | 迁移学习统计、监控等官方模块为标准 `builtin` 插件 | 是 |
| P6 | 稳定性与诊断增强 | 补插件错误面板、诊断视图、失败恢复与更多自动验证 | 是 |
| P7 | 隔离式 `local-trusted` 评估 | 仅在前置条件满足后评估执行容器与加载协议 | 否，延后 |

### 16.3 阶段依赖关系

各阶段存在明确前后依赖，不得跳步：

```text
P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7
```

进一步约束：

- `P2` 不完成，不进入 `P4` 与 `P5`
- `P3` 不完成，不进入任何正式业务插件迁移
- `P5` 不完成，不进入“第一阶段完成验收”
- `P6` 是第一阶段收尾阶段，用于把工程能力从“可运行”提升到“可持续维护”

### 16.4 每阶段统一执行闸门

每个阶段开始前，必须满足以下进入条件：

- 上一阶段状态为“已完成”或“有明确批准的并行例外”
- 本阶段目标、范围、不做项已经写入本文档
- 本阶段的验证方式已经写入本文档
- 预计改动文件范围已在本文档或执行记录中声明

每个阶段结束时，必须满足以下退出条件：

- 目标范围内代码已落地
- 本阶段验收项至少完成一次验证
- 本文档已更新状态、落地文件、验证结果、风险变化
- 若有未完成项，必须显式转为下一阶段输入，而不是隐性遗留

### 16.5 阶段状态定义

为保证后续更新口径一致，所有阶段统一使用以下状态：

- `待实施`：已定义目标，但尚未开始编码
- `进行中`：已有实际代码改动正在推进
- `阻塞`：因前置条件、设计问题或外部依赖暂时停滞
- `待验证`：代码已落地，等待集中验证或补充验证
- `已完成`：验收通过且文档已回写
- `延后`：明确不进入当前周期

### 16.6 推荐执行节奏

后续建议按“小步快跑、每次单一目标”的方式推进：

1. 每次只选择一个阶段中的一个子任务
2. 先更新本文档中的“本次执行目标”
3. 再进行代码修改
4. 完成后更新本文档中的“实际落地结果”
5. 最后再决定下一次执行是否继续当前阶段，或切换到下一个阶段

### 16.7 当前总计划看板

| 阶段 | 名称 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| P0 | 文档收敛与基线确认 | 已完成 | 进入 P1 |
| P1 | 插件宿主骨架 | 已完成 | 进入 P2 |
| P2 | `secondaryViews` 链路 | 已完成 | 进入 P3 |
| P3 | Host API 与工程边界 | 已完成 | 进入 P4 |
| P4 | 命令系统统一化 | 已完成 | 进入 P5 |
| P5 | 官方插件迁移样板 | 已完成 | 进入 P6 |
| P6 | 稳定性与诊断增强 | 已完成 | 进入 P8（第二周期） |
| P7 | 隔离式 `local-trusted` 评估 | 延后 | 不进入当前周期 |
| P8 | 完全插件化基线与边界收敛 | 已完成 | 进入 P9 |
| P9 | Host API 扩容与宿主适配收敛 | 已完成 | 进入 P10 |
| P10 | 学习统计完全插件化迁移 | 已完成 | 进入 P11 |
| P11 | 监控模块完全插件化迁移 | 已完成 | 进入 P12 |
| P12 | 共享层与跨插件边界固化 | 已完成 | 进入 P13 |
| P13 | 完全插件化验收与 `local-trusted` 前置复核 | 已完成 | 继续延后 P7 |

## 阶段 A. 建立插件宿主骨架

**目标**：建立可用的 `PluginManager`、`PluginRegistry`、`PluginContext`、`HostApi` 类型边界，以及静态贡献索引能力。  
**状态**：已完成

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
**状态**：已完成

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
**状态**：已完成

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
**状态**：已完成

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
**状态**：已完成

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

### 16.8 阶段与总计划映射

为避免“阶段 A/B/C”和“P1/P2/P3”口径混淆，后续统一按下表理解：

| 总计划阶段 | 对应文档阶段 | 说明 |
| --- | --- | --- |
| `P0` | 文档修订阶段 | 当前已完成 |
| `P1` | 阶段 A | 插件宿主骨架 |
| `P2` | 阶段 B | `secondaryViews` 链路 |
| `P3` | 阶段 C | Host API 与工程边界 |
| `P4` | 阶段 D | 命令系统统一 |
| `P5` | 阶段 E | 官方插件迁移样板 |
| `P6` | 阶段 E 完成后追加稳定性工作 | 诊断、验证、失败恢复补齐 |
| `P7` | 阶段 F | 隔离式 `local-trusted` 评估 |
| `P8` | 第二周期基线阶段 | 完全插件化边界与白名单收敛 |
| `P9` | 第二周期 API 阶段 | Host API 扩容与宿主适配收敛 |
| `P10` | 第二周期业务迁移阶段 1 | 学习统计完全插件化迁移 |
| `P11` | 第二周期业务迁移阶段 2 | 监控模块完全插件化迁移 |
| `P12` | 第二周期工程固化阶段 | `shared/*` 与跨插件边界固化 |
| `P13` | 第二周期验收阶段 | 完全插件化验收与 `local-trusted` 前置复核 |

后续执行记录、进度汇报、提交说明中，建议优先使用 `P1`、`P2` 这类总计划编号，以便横向跟踪整体进度。

---

### 16.9 第二周期总路线：完全插件化收敛

第一周期 `P0-P6` 已完成“插件宿主骨架 + 官方插件入口化 + 稳定性与诊断增强”，但当前官方插件仍存在以下过渡性特征：

- `src/plugins/builtin/*` 已承担 manifest、激活与运行时注册
- `src/plugins/official/*` 仍作为 UI adapter 直接复用 `src/features/*`
- 学习统计、监控的主实现仍直接依赖 `src/core/*`、`src/stores/*`、`src/application/*` 或宿主内部 service

若目标提升为“完全插件化”，则第二周期必须继续推进，把“插件入口化”收敛为“插件实现内聚化 + 宿主 API 收口化 + 工程边界强约束”。

为避免改写第一周期历史编号，同时保留 `P7` 作为隔离式 `local-trusted` 的延后评估阶段，第二周期统一从 `P8` 开始编号。

第二周期阶段如下：

| 阶段 | 名称 | 目标 | 前置条件 |
| --- | --- | --- | --- |
| P8 | 完全插件化基线与边界收敛 | 固化允许/禁止依赖矩阵，扩展边界校验至官方插件与跨插件依赖 | `P6` 已完成 |
| P9 | Host API 扩容与宿主适配收敛 | 为学习统计、监控、工作区、观测与诊断建立稳定 Host API 与 DTO | `P8` 已完成 |
| P10 | 学习统计完全插件化迁移 | 将学习统计主实现迁入插件目录，切断对宿主内部模块的直接依赖 | `P9` 已完成 |
| P11 | 监控模块完全插件化迁移 | 将监控主实现迁入插件目录，改为通过 observability / diagnostics API 读取数据 | `P10` 已完成 |
| P12 | 共享层与跨插件边界固化 | 收口 `shared/*` 白名单层、扩展点协议与跨插件调用规则 | `P11` 已完成 |
| P13 | 完全插件化验收与 `local-trusted` 前置复核 | 对 builtin 插件完全插件化结果做集中验收，并复核是否具备重启 `P7` 的前提 | `P12` 已完成 |

第二周期依赖关系如下：

```text
P8 -> P9 -> P10 -> P11 -> P12 -> P13
```

补充约束：

- `P9` 未完成前，不允许继续迁移学习统计或监控的主实现目录
- `P10` 未完成前，不允许以监控模块作为“完全插件化已经成立”的依据
- `P12` 未完成前，不允许把 `shared/*` 当成无边界的宿主内部兜底目录
- `P13` 未完成前，不重启 `P7`

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

### 22.1 后续执行方式

后续所有修改必须严格按以下流程执行：

1. 先在本文档中明确“本次执行所属阶段”
2. 写明“本次执行目标”
3. 写明“本次执行不做什么”
4. 完成代码修改
5. 回写“实际落地文件”
6. 回写“验证结果”
7. 更新“阶段状态”和“下一步”

不允许的做法：

- 在未声明目标范围的情况下直接大面积改代码
- 同一次执行同时跨越多个大阶段
- 不更新文档状态就开始下一轮实现
- 发现设计偏差后先改代码、后补文档

### 22.2 每次执行必须回写的字段

后续每次执行结束后，至少必须回写以下字段：

- 本次执行日期
- 所属阶段编号，例如 `P1`
- 本次执行目标
- 本次实际完成
- 本次未完成
- 实际落地文件
- 验证方式
- 验证结果
- 当前阻塞项
- 下一步计划

### 22.3 推荐进度更新位置

建议在本文档末尾长期维护以下 3 类信息：

- “阶段看板”：展示整体进度
- “执行日志”：逐次记录每次实施动作
- “偏差记录”：记录设计变更、范围调整和风险变化

### 22.4 阶段看板模板

后续更新时，建议按以下模板维护：

```md
| 阶段 | 名称 | 状态 | 最近更新 | 下一步 | 备注 |
| --- | --- | --- | --- | --- | --- |
| P1 | 插件宿主骨架 | 进行中 | 2026-06-03 | 完成 manifest 校验 | 无 |
| P2 | secondaryViews 链路 | 待实施 | - | 等待 P1 完成 | - |
```

### 22.5 执行日志模板

后续每次执行后，在文档末尾追加一条执行日志，建议格式如下：

```md
#### 执行记录 YYYY-MM-DD / P1

- 本次目标：补齐 manifest 校验与内建插件清单
- 本次不做：不接入视图渲染，不迁移业务模块
- 实际完成：
  - 新增 `src/plugins/host/pluginManifest.ts`
  - 新增 manifest schema 校验
  - 建立内建插件清单入口
- 实际落地文件：
  - `src/plugins/host/pluginManifest.ts`
  - `src/plugins/runtime/builtinPluginLoader.ts`
- 验证方式：
  - `npm run typecheck`
  - 手动确认测试插件 manifest 可被发现
- 验证结果：
  - typecheck 通过
  - 测试插件可被索引
- 当前风险变化：
  - 暂无新增风险
- 当前阻塞项：
  - 无
- 下一步：
  - 进入 `pluginRegistry` 静态贡献索引实现
```

### 22.6 偏差记录模板

若后续实现发现设计与现实不一致，必须追加偏差记录，建议格式如下：

```md
#### 偏差记录 YYYY-MM-DD

- 所属阶段：P2
- 偏差描述：现有 tab store 无法直接承载 `secondary-view` 过渡态
- 影响范围：`App.tsx`、`tabStore`、`tabTypes`
- 处理决定：先补 `SecondaryViewTab` 过渡结构，再继续视图宿主接入
- 是否影响后续计划：是
- 计划调整：P2 增加一项 tab 过渡改造子任务
```

### 22.7 阶段完成时必须补的总结

每个阶段切换为“已完成”前，必须补一段阶段总结，至少包含：

- 本阶段目标是否全部达成
- 实际落地文件范围
- 已通过的验证项
- 遗留问题是否已经显式转移到下一阶段
- 风险是否下降，或出现新的长期风险

### 22.8 文档末尾建议新增常驻区块

建议在本文档最后长期维护以下常驻区块，后续每次执行都更新：

```md
## 23. 阶段看板

## 24. 执行日志

## 25. 偏差记录
```

若开始进入实际编码阶段，应先创建以上区块，再开始记录第一次执行。

---

## 23. 阶段看板

| 阶段 | 名称 | 状态 | 最近更新 | 下一步 | 备注 |
| --- | --- | --- | --- | --- | --- |
| P0 | 文档收敛与基线确认 | 已完成 | 2026-06-03 | 进入 P1 | 设计、MVP、验收与执行规则已收敛到本文档 |
| P1 | 插件宿主骨架 | 已完成 | 2026-06-03 | 进入 P2 | 已完成 `discover()` 启动接线、样例插件静态索引验证与宿主骨架验收 |
| P2 | `secondaryViews` 链路 | 已完成 | 2026-06-03 | 进入 P3 | 对应阶段 B |
| P3 | Host API 与工程边界 | 已完成 | 2026-06-03 | 进入 P4 或 P5 | 已补权限收口、边界静态校验与运行时 guard |
| P4 | 命令系统统一化 | 已完成 | 2026-06-03 | 进入 P5 | 已补宿主 `CommandRegistry`、标题栏桥接与菜单命令分发 | 对应阶段 D |
| P5 | 官方插件迁移样板 | 已完成 | 2026-06-03 | 进入 P6 | 已完成学习统计 `builtin` 迁移样板、标题栏 widget 插槽与 `onAppReady` 激活闭环 | 对应阶段 E |
| P6 | 稳定性与诊断增强 | 已完成 | 2026-06-03 | 进入 P8（第二周期） | 已补插件诊断快照、视图失败态重试与 widget 部分成功激活 | 第一阶段收尾 |
| P7 | 隔离式 `local-trusted` 评估 | 延后 | - | 不进入当前周期 | 对应阶段 F，等待 `P13` 完成后再复核 |
| P8 | 完全插件化基线与边界收敛 | 已完成 | 2026-06-04 | 进入 P9，开始 Host API 扩容草案 | 已补官方插件/共享层边界校验、跨插件静态约束与遗留债务基线 |
| P9 | Host API 扩容与宿主适配收敛 | 已完成 | 2026-06-04 | 进入 P10，开始学习统计完全插件化迁移 | 已补 learning / logs / performance / plugins diagnostics Host API、宿主接线、权限映射与最小 runtime 验证 | 第二周期 |
| P10 | 学习统计完全插件化迁移 | 已完成 | 2026-06-04 | 进入 P11，开始监控模块完全插件化迁移 | 已完成学习统计主实现内聚、官方适配层清空、运行时入口包装与插件级验证 | 第二周期 |
| P11 | 监控模块完全插件化迁移 | 已完成 | 2026-06-04 | 进入 P12，开始共享层与跨插件边界固化 | 已完成监控页 builtin 迁移、官方适配层清空、Host API 接线与插件级验证 | 第二周期 |
| P12 | 共享层与跨插件边界固化 | 已完成 | 2026-06-04 | 进入 P13，开始完全插件化验收与 `local-trusted` 前置复核 | 已完成 `shared` 子域白名单固化、monitor 通用格式化下沉、跨插件约束文档与工程校验收口 | 第二周期 |
| P13 | 完全插件化验收与 `local-trusted` 前置复核 | 已完成 | 2026-06-04 | builtin 完全插件化验收完成，继续延后 `P7` | 已完成静态发现、边界、运行时与 Host API 集中复核，并确认当前仍不具备重启隔离式 `local-trusted` 的前提 | 第二周期 |

## 24. 执行日志

#### 执行记录 2026-06-03 / P1

- 本次执行目标：建立 `src/plugins/` 目录骨架、核心宿主类型与首个测试 `builtin` 插件样例
- 实际落地结果：
  - 新增 `src/plugins/public/*`，定义 `PluginManifest`、`PluginContext`、`TopoMindPluginModule`、`WorkspaceApi`、`ViewApi`、`CommandApi` 等公开接口
  - 新增 `src/plugins/host/*`，落地 `PluginManager`、`PluginRegistry`、`PluginLifecycle`、`createPluginContext()`、`validatePluginManifest()`
  - 新增 `src/plugins/runtime/builtinPluginLoader.ts`，建立内建插件清单加载入口
  - 新增 `src/plugins/builtin/devtools-sample/*`，作为后续 `secondaryViews` 懒激活链路的测试插件样板
- 验证结果：
  - `npm run typecheck` 通过
  - 当前未接入 `App.tsx` 与现有导航渲染链路，未改变现有用户可见行为
- 当前结论：
  - `P1` 已完成“目录骨架 + 核心类型 + manifest 校验 + builtin loader + 测试插件样板”的首个子任务
  - `P1` 仍未完成正式验收，尚需补宿主侧 discover 接线与最小静态贡献验证
- 下一步：
  - 继续停留在 `P1`
  - 补一个宿主可调用的 discover 初始化入口
  - 完成对测试插件静态贡献的最小验证，再决定是否进入 `P2`

#### 执行记录 2026-06-03 / P1

- 本次执行目标：补宿主 discover 初始化接线，并完成测试插件静态贡献的最小验证
- 实际落地结果：
  - 新增 `src/plugins/bootstrap.ts`，提供 `bootstrapPlugins()` 与 `getPluginManager()` 单例入口
  - 在 `src/main.tsx` 接入 `bootstrapPlugins()`，应用启动时即执行 `discover()`
  - 新增 `scripts/verify-plugin-static-discovery.mts` 与 `npm run verify:plugins:static`
  - 为 `PluginRegistry` 增加静态命令查询能力，便于校验静态索引结果
- 验证结果：
  - `npm run verify:plugins:static` 通过
  - `npm run typecheck` 通过
  - 已确认当前改动不改变现有用户可见渲染逻辑
- 当前结论：
  - `P1` 阶段验收条件已满足
  - 后续可以按计划正式进入 `P2`
- 下一步：
  - 开始 `P2`
  - 接入 `secondaryViews` 的静态视图索引读取与宿主渲染占位
  - 继续打通首次打开视图时的懒激活链路

#### 执行记录 2026-06-03 / P2

- 本次执行目标：接入 `secondaryViews` 链路，跑通首个内建插件的静态视图索引、懒激活与渲染闭环
- 实际落地结果：
  - 确认现有代码已包含完整 P2 实现骨架
  - 核心组件 `PluginViewHost.tsx` 已实现，支持视图懒激活与错误边界
  - `App.tsx` 已接入 `PluginViewHost`，并保留对 `monitor.logs`/`learning.statistics` 的回退渲染
  - `tabStore` 已支持 `secondary-view` 类型的 Tab 创建与管理
  - `bootstrap.ts` 中已实现真实的 `hostServices.openView()`，通过 `tabStore.openSecondaryViewTab()` 打开插件视图
  - 测试插件 `devtools-sample` 已完整配置，包含 `secondaryViews`/`commands` 静态贡献
  - 修复了 `LearningPageType` 缺少 `'secondary-view'` 标签导致的类型错误
- 验证结果：
  - `npm run typecheck` 通过
  - 保留了现有监控和学习统计页面的完整功能（通过 `fallbackRender` 支持）
  - 新增的 devtools 测试插件不会对现有用户行为产生影响
- 当前结论：
  - `P2` 验收条件已满足
  - 首个插件视图（`devtools.sample`）可通过静态索引发现、懒激活并渲染
  - 对现有页面保持完全兼容
- 下一步：
  - 继续进入 P3
  - 完善 Host API 边界与工程化约束

#### 执行记录 2026-06-03 / P3

- 本次执行目标：完善 Host API、权限-API 映射与插件目录工程边界
- 实际落地结果：
  - 补充 `src/plugins/README.md` 开发指南，明确插件目录边界规范
  - 完整实现权限-API 映射表（与设计文档一致）
  - 更新测试插件 manifest，添加 `workspace.read` 权限
  - 更新 SampleView，完整验证 `workspace.getCurrentWorkspaceId()` 与 `views.open()` Host API 链路
  - 确保插件代码没有直接访问 `src/core/*`、`src/stores/*`、`src/features/*` 或 `window.electronAPI`
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:static` 通过
  - 测试插件完整实现通过 Host API 读取 workspace 信息与打开视图，无越界访问
- 当前结论：
  - P3 验收条件已满足
  - MVP（A+B+C 阶段）完整闭环已完成
- 下一步：
  - 可选进入 P4（命令系统统一化）或 P5（官方插件迁移样板）

#### 执行记录 2026-06-03 / P3 加固

- 本次执行目标：消除 P3 中“文档已完成但约束未真正落地”的技术债，补齐权限收口、激活事件校验与工程边界检查
- 实际落地结果：
  - 新增 `src/plugins/host/pluginPermissions.ts`，集中维护 API -> 权限映射与权限错误类型
  - 收紧 `createPluginContext()`，为 `workspace.getCurrentWorkspaceId()`、`views.open()`、`commands.execute()`、`ui.notify()`、`log.*()` 增加运行时权限校验
  - 为 `PluginManager` 增加激活事件校验与 `executeCommand()`，补齐命令懒激活闭环
  - 为 `bootstrap.ts` 的 `openView()` 增加未知视图 fail-fast，避免把非法视图直接打开成坏页签
  - 修复 `tabStore.openSecondaryViewTab()` 对已存在视图页签的激活逻辑，避免写入不存在的 `activeTabId`
  - 新增 `scripts/verify-plugin-boundaries.mts` 与 `scripts/verify-plugin-runtime-guards.mts`
  - 在 `package.json` 中补充 `verify:plugins:boundaries`、`verify:plugins:runtime` 与聚合脚本 `verify:plugins`
  - 强化 manifest 校验：补 kind/permission/placement 枚举校验、贡献项去重校验、`openCommand` 引用校验与权限-贡献一致性校验
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - 样例插件可继续通过静态发现、边界检查与运行时 guard 验证
- 当前结论：
  - P3 的“Host API 与工程边界”已从文档约定收敛为可执行约束
  - 继续进入 P4/P5 前，前置技术债已明显下降

#### 执行记录 2026-06-03 / P4

- 本次执行目标：建立统一命令入口，将标题栏、应用菜单与插件命令执行面收敛到同一调度层
- 实际落地结果：
  - 新增 `src/application/commands/commandRegistry.ts`，实现宿主 `CommandRegistry` 单例与默认宿主命令注册
  - 将宿主命令与插件静态命令接入同一执行入口，`PluginContext.commands.execute()` 不再绕过宿主命令层
  - `CustomTitleBar` 中的系统日志、学习统计、主题切换、右侧面板、窗口控制与切换工作目录入口全部改为通过命令 ID 执行
  - `App.tsx` 中的 `app:menu-action` 事件改为统一分发命令 ID，不再直接调用业务 store action
  - Electron 菜单改为发送 `monitor.open` / `learning.open` 等命令 ID，并补充“学习统计”菜单项
  - 修复 `tsconfig.node.json` 的引用工程配置，使 IDE 不再因 JS 输入与 emit 冲突持续报错
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - `tsconfig.node.json` 相关 IDE 诊断已清理
- 当前结论：
  - `monitor.open`、`learning.open` 已由统一命令调度执行
  - 标题栏与菜单入口不再直接依赖业务模块 action
  - 后续进入 P5 时，可直接复用命令层承接官方插件迁移

#### 执行记录 2026-06-03 / P5

- 本次执行目标：将学习统计迁移为首个官方 `builtin` 插件样板，并补齐 widget 宿主链路与启动激活闭环
- 实际落地结果：
  - 新增 `src/plugins/builtin/learning-statistics/*`，以标准 manifest + module 形式声明 `learning.statistics` 视图、`learning.open` 命令与 `learning.titlebar.overview` widget
  - 新增 `src/plugins/official/learningStatistics.tsx`，作为官方插件 UI adapter，复用现有学习统计页面与标题栏速览组件
  - 新增 `src/plugins/host/PluginWidgetSlot.tsx`，宿主可按 placement 读取静态 widget 贡献、触发插件激活并渲染运行时 widget
  - `src/features/layout/CustomTitleBar/CustomTitleBar.tsx` 已改为通过 `PluginWidgetSlot` 渲染标题栏学习速览，不再硬编码学习统计 widget
  - `src/main.tsx` / `src/plugins/bootstrap.ts` 已接入 `onAppReady` 激活，官方 widget 可在应用启动后按协议注册
  - `src/App.tsx` 已移除 `learning.statistics` 的宿主 fallback，仅保留 `monitor.logs` 兼容分支，学习统计页面入口改由插件视图宿主承接
  - 插件静态发现与运行时校验脚本已扩展到多内建插件与 widget 场景，并修复 `verify-plugin-runtime-guards.mts` 中与新 manifest 规则不一致的测试样例
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - 当前全局 IDE 诊断为空
- 当前结论：
  - 第一阶段“至少一个官方模块完成 `builtin` 迁移样板”的验收项已满足，学习统计已完整跑通命令、页面、widget 三条链路
  - 监控模块后续可继续作为第二个官方迁移样板，验证插件系统不是只为学习统计定制
  - 后续可以正式进入 P6，收敛失败态诊断、禁用态体验与稳定性验证补齐

#### 执行记录 2026-06-03 / P6

- 本次执行目标：补齐插件失败态诊断、禁用态验证与多 widget 激活场景下的稳定性处理
- 实际落地结果：
  - 为 `PluginManager` 增加统一诊断读取能力，可返回插件生命周期快照与运行时绑定记录，便于宿主按插件查看失败状态与最近错误
  - `PluginViewHost` 失败态已接入插件诊断信息展示，错误页现在可显示 `state`、最近错误与失败时间，并在非禁用态下提供“重试激活插件”入口
  - `PluginWidgetSlot` 已改为 `Promise.allSettled()` 激活缺失 widget，单个插件激活失败不再阻断同一 placement 下其他 widget 的正常渲染
  - `verify-plugin-runtime-guards.mts` 已补充禁用后阻止自动重激活、失败诊断快照保留等运行时校验
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - 相关新增文件 IDE 诊断已清理
- 当前结论：
  - 当前周期第一阶段的“诊断、验证、失败恢复补齐”范围已完成，插件宿主具备最小可用的失败态可观测性
  - 学习统计插件化样板之外，宿主现在也能更稳定地处理插件激活失败、插件禁用与 widget 局部失败场景
  - 若后续继续推进，可将监控模块作为第二个官方迁移样板，或单独开启 P7 的隔离评估

#### 执行记录 2026-06-03 / P6 追加

- 本次执行目标：将监控模块迁移为第二个官方 `builtin` 插件样板，移除对 `monitor.logs` 的宿主 fallback 依赖
- 实际落地结果：
  - 新增 `src/plugins/builtin/monitor/*`，以标准 manifest + module 形式声明 `monitor.logs` 视图与 `monitor.open` 命令
  - 新增 `src/plugins/official/monitor.tsx`，作为官方插件 UI adapter，复用现有 `MonitorPage`
  - `BuiltinPluginLoader` 与静态发现校验已纳入 `topomind.monitor`
  - `CommandRegistry` 已移除宿主默认 `monitor.open` 实现，命令执行改由插件命令承接，避免宿主命令遮蔽插件命令
  - `src/App.tsx` 已移除 `monitor.logs` 的宿主 fallback，监控页面入口现与学习统计一致，由 `PluginViewHost` 纯插件化承接
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - 相关新增文件 IDE 诊断已清理
- 当前结论：
  - 监控模块已成为第二个官方迁移样板，当前插件系统已不再只围绕学习统计验证
  - `monitor.open` / `learning.open` 现均由插件命令与插件视图宿主承接，宿主壳层不再保留对应页面 fallback
  - 若继续推进，可转入 P7 评估，或继续补“插件诊断面板是否复用监控模块”的后续设计

#### 执行记录 2026-06-03 / P6 收尾

- 本次执行目标：确定并落地“插件错误诊断面板复用监控模块”的方案，避免再新增独立诊断页面
- 实际落地结果：
  - 监控模块已正式采用“日志监控 / 性能监控 / 插件诊断”三标签结构，插件诊断作为监控页内建标签复用现有导航与容器
  - `MonitorPage` 已通过 `PluginManager.subscribeDiagnostics()` 订阅插件诊断快照，并将数据写入 `monitorStore`
  - `PluginDiagnosticsPanel` 已成为监控模块内的插件诊断详情面板，支持状态汇总、失败信息查看、激活重试与快照复制
  - `PluginRegistry` 已补充运行时绑定变更订阅，`subscribeDiagnostics()` 现在同时监听生命周期与运行时绑定变化，避免运行时记录变更时监控页诊断数据不刷新
  - `scripts/verify-plugin-runtime-guards.mts` 已新增诊断流刷新校验，用例覆盖“运行时绑定失败时订阅方可收到更新”
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins` 通过
  - 相关编辑文件 IDE 诊断已清理
- 当前结论：
  - “插件错误诊断面板是否作为监控模块的一部分复用”已不再是未决问题，当前结论是复用监控模块并以内置标签维护
  - 当前方案避免了新增导航入口，同时保留了插件诊断作为长期运维视图所需的实时性与可操作性

#### 执行记录 2026-06-04 / P8 规划

- 本次执行目标：把“完全插件化”第二周期的目标结构、阶段计划、工作清单与后续更新方式正式写入架构文档
- 本次不做：
  - 不直接修改 `src/plugins/*`、`src/features/*` 或宿主 Host API 实现
  - 不在本次执行中启动 `P9` 及后续编码
- 实际落地结果：
  - 在本文档中新增第二周期 `P8-P13` 的阶段定义、依赖关系与进入/退出约束
  - 明确“官方插件入口化”与“完全插件化”之间的差距，收口为宿主 API 收敛、插件实现内聚化、共享层白名单与跨插件边界四类工作
  - 新增第二周期目标目录结构、依赖矩阵、Host API 补齐方向与分阶段任务清单
  - 明确后续所有进度更新必须同步更新 `23. 阶段看板`、`24. 执行日志`、`27. 第二周期工作计划清单` 与 `25. 偏差记录`
- 验证结果：
  - 第二周期计划已与第一周期历史记录并存，不覆盖既有实施日志
  - 后续执行可直接按 `P8 -> P13` 编号推进并回写进度
- 当前结论：
  - 从本次开始，builtin 插件后续实施以“完全插件化收敛”为第二周期主线
  - `P7` 继续保持延后，待 `P13` 完成后再决定是否重启
- 下一步：
  - 进入 `P8`
  - 先补边界校验范围，禁止官方插件继续直接依赖 `src/features/*`
  - 同步定义 `shared/*` 白名单层与学习统计、监控所需 Host API 草案

#### 执行记录 2026-06-04 / P8

- 本次执行目标：把第二周期边界规则落成工程约束，并冻结当前官方插件适配层的已知越界依赖
- 实际落地结果：
  - 扩展 `scripts/verify-plugin-boundaries.mts`，将 `src/plugins/official/*`、`src/shared/*` 与跨插件 import 一并纳入校验
  - 为官方适配层现存越界依赖建立显式基线登记，防止 `learningStatistics`、`monitor` 之外新增同类宿主直连
  - 将 `cn()` 从 `src/lib/utils.ts` 下沉到 `src/shared/utils/cn.ts`，切断 `src/shared/ui/*` 对外层 `lib/*` 的反向依赖
  - 在 `src/plugins/README.md` 中补齐第二周期边界要求，明确 `shared/*` 白名单规则、跨插件限制与当前登记债务
  - 明确当前宿主直连清单：
    - `src/plugins/official/learningStatistics.tsx` 仍依赖 `src/application/commands`、`src/features/learning-tracker/components/LearningTrackerWidget`、`src/features/learning-tracker/pages/LearningStatisticsPage`
    - `src/plugins/official/monitor.tsx` 仍依赖 `src/features/monitor/MonitorPage`
- 验证结果：
  - `npm run verify:plugins:boundaries` 通过
  - 校验结果已覆盖 `builtin`、`official`、`shared` 与跨插件 import
- 当前结论：
  - `P8` 已完成“边界规则工程化 + 已知债务基线冻结”的阶段目标
  - 后续清理官方适配层对宿主内部模块的直连，转入 `P9-P11` 继续推进
- 下一步：
  - 进入 `P9`
  - 起草学习统计、监控、工作区变化与插件诊断所需的 Host API 与 DTO
  - 评估权限点与运行时校验如何覆盖新增能力

#### 执行记录 2026-06-04 / P9

- 本次执行目标：为学习统计、监控与后续完全插件化迁移补齐稳定 Host API、宿主适配与权限/验证收口
- 实际落地结果：
  - 在 `src/plugins/public/api.ts` 与 `src/plugins/public/plugin.ts` 中补齐 `learning`、`logs`、`performance`、`plugins diagnostics` 相关 Host API、DTO 与 `PluginContext` 暴露面
  - 在 `src/plugins/host/pluginContext.ts`、`src/plugins/host/pluginPermissions.ts` 与 `src/plugins/public/manifest.ts` 中补齐新增 API 的权限点、运行时校验与权限映射
  - 在 `src/plugins/bootstrap.ts` 中接入学习统计读取/订阅、工作区订阅、日志查询/订阅、性能样本提取、插件诊断快照与激活重试的宿主默认实现
  - 将性能协议与样本提取逻辑沉到 `src/shared/observability/*`，避免共享层反向依赖 `src/core/*`，并让宿主 API 与监控页面共用同一套 DTO/解析逻辑
  - 在 `scripts/verify-plugin-runtime-guards.mts` 中补充 `learning`、`performance`、`plugins diagnostics` 的最小权限 guard，确保新增能力不是只停留在类型层
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:boundaries` 通过
  - `npm run verify:plugins:runtime` 通过
- 当前结论：
  - `P9` 已完成“稳定 Host API + 宿主默认适配 + 权限/验证收口”的阶段目标
  - 学习统计与监控后续迁移可直接消费现有 Host API，无需继续新增 `core/stores` 直连能力面
  - `src/plugins/official/*` 的宿主内部直连仍为过渡债务，实际清理继续在 `P10`、`P11` 完成
- 下一步：
  - 进入 `P10`
  - 先把学习统计页面、widget 与数据读取改为依赖插件 service / Host API
  - 移除对 `FSB`、`workspaceStore`、`tabStore` 等宿主内部模块的直接依赖

#### 执行记录 2026-06-04 / P10（完成）

- 本次执行目标：完成学习统计从过渡适配层到插件目录自持实现的迁移收口，并补齐插件级验证与运行时可执行入口
- 实际落地结果：
  - 将 `src/plugins/builtin/learning-statistics/index.ts` 改为直接注册插件目录内的页面与标题栏 widget，不再经过 `src/plugins/official/learningStatistics.tsx`
  - 在 `src/plugins/builtin/learning-statistics/*` 中新增页面、widget、速览预览、统计面板、分析函数与 runtime state hook，形成插件内自持的 UI / model / service 组合
  - 学习统计页面和标题栏速览已改为通过 `ctx.learning` / `ctx.workspace` 读取实时状态、历史 summary、daily records 与工作区变化，不再直接 import `FSB`、`workspaceStore`、`tabStore`
  - 新增宿主命令 `home.open`，供学习统计插件通过命令桥返回首页，避免插件直接调用宿主 tab store
  - 将 `src/plugins/official/learningStatistics.tsx` 收缩为空过渡壳，并从官方插件边界债务基线中移除该项
  - 在 `scripts/verify-plugin-runtime-guards.mts` 中补充真实加载 `topomind.learning-statistics` builtin 插件的验证，覆盖命令、页面、标题栏 widget、统计读取依赖注入与返回首页闭环
  - 在 `src/plugins/runtime/builtinPluginLoader.ts` 中将 builtin 动态导入改为显式扩展名，并为学习统计新增纯 `.ts` 包装入口，使 Node 运行时校验可执行而实际 UI 仍由 `tsx` 组件承载
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:boundaries` 通过
  - `npm run verify:plugins:runtime` 通过
- 当前结论：
  - `P10` 已完成，学习统计现已满足“插件目录内聚实现 + Host API 驱动 + 插件级验证覆盖”的阶段目标
  - 当前官方适配层遗留债务只剩监控模块，后续继续在 `P11` 清理
- 下一步：
  - 进入 `P11`
  - 将监控页改为依赖 `logs / performance / plugins diagnostics` Host API
  - 清理 `src/plugins/official/monitor.tsx` 的历史业务适配并补监控插件级验证

#### 执行记录 2026-06-04 / P11（完成）

- 本次执行目标：完成监控模块从官方过渡适配层到 builtin 插件目录自持实现的迁移收口，并补齐真实插件级验证
- 实际落地结果：
  - 将 `src/plugins/builtin/monitor/index.ts` 改为直接注册插件目录内的 `monitor.logs` 视图与 `monitor.open` 命令，不再经过 `src/plugins/official/monitor.tsx`
  - 在 `src/plugins/builtin/monitor/*` 中迁入监控页、性能页、插件诊断面板、日志列表、筛选栏、明细面板、侧栏与 Zustand store，形成插件内自持的 UI / model 组合
  - 监控页、性能页与插件诊断页统一改为通过 `ctx.logs`、`ctx.performance`、`ctx.plugins`、`ctx.log` 读取日志缓冲、性能样本、诊断快照与重试激活能力，不再直接 import `log-backend`、`PluginManager` 或宿主内部 store adapter
  - 新增 `src/plugins/builtin/monitor/MonitorPageEntry.ts` 纯 `.ts` 包装入口，通过 `React.lazy + Suspense` 延迟加载真实 `tsx` 页面，确保 Node 运行时校验可执行
  - 将 `src/plugins/official/monitor.tsx` 收缩为空过渡壳，并从官方插件边界债务基线中移除 monitor 项
  - 在 `scripts/verify-plugin-runtime-guards.mts` 中补充真实加载 `topomind.monitor` builtin 插件的验证，覆盖命令执行、视图打开、日志查询、性能订阅、插件诊断与重试激活闭环
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:boundaries` 通过
  - `npm run verify:plugins:runtime` 通过
- 当前结论：
  - `P11` 已完成，监控模块现已满足“插件目录内聚实现 + observability / diagnostics Host API 驱动 + 插件级验证覆盖”的阶段目标
  - 第二周期业务迁移阶段已经收口完成，后续可直接进入 `P12`
- 下一步：
  - 进入 `P12`
  - 识别可安全下沉到 `shared/*` 的纯 UI / 工具 / 类型
  - 固化跨插件调用只能通过命令、扩展点与宿主 DTO

#### 执行记录 2026-06-04 / P12（完成）

- 本次执行目标：固化 `shared/*` 白名单边界、收口跨插件交互约束，并把已确认稳定的纯工具下沉到共享层
- 实际落地结果：
  - 新增 `src/shared/observability/logFormatting.tsx`，将 monitor 页面与 builtin monitor 插件共用的日志时间格式化、日期归一化与关键词高亮逻辑下沉到共享层
  - 将 `src/features/monitor/*` 与 `src/plugins/builtin/monitor/*` 中相关组件统一改为消费 `@/shared/observability/logFormatting`，避免同类逻辑在宿主与插件目录重复演化
  - 强化 `scripts/verify-plugin-boundaries.mts`：插件侧仅允许使用 `@/shared/ui/*`、`@/shared/utils/*`、`@/shared/observability/*` 三个白名单子域；`src/shared/*` 文件也必须落在这三个顶级域中
  - 更新 `src/plugins/README.md`，将 `shared/*` 白名单子域、无基线债务现状与“新增共享域需同步更新文档与校验”的约束显式化
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:boundaries` 通过
  - `npm run verify:plugins:runtime` 通过
- 当前结论：
  - `P12` 已完成，`shared/*` 现已具备可审计的子域白名单与工程校验，不再是模糊的宿主兜底层
  - 第二周期工程固化阶段已完成，下一步进入 `P13` 做集中验收与 `local-trusted` 前置复核
- 下一步：
  - 进入 `P13`
  - 汇总学习统计、监控与共享层收口的最终文件范围
  - 对 Host API、边界校验、运行时验证和 builtin 完全插件化前提做集中复核

#### 执行记录 2026-06-04 / P13（完成）

- 本次执行目标：对第二周期 builtin 完全插件化结果做集中验收，并复核是否具备重启 `P7 local-trusted` 的前置条件
- 实际落地结果：
  - 汇总完全插件化落地范围：学习统计主实现已收口到 `src/plugins/builtin/learning-statistics/*`，监控主实现已收口到 `src/plugins/builtin/monitor/*`，共享白名单层收口到 `src/shared/ui/*`、`src/shared/utils/*`、`src/shared/observability/*`
  - 复核 Host API 已覆盖工作区、学习统计、日志、性能、插件诊断、命令、视图与 widget 注册能力，builtin 插件通过 `PluginContext` 访问宿主，不再直接 import `src/core/*`、`src/features/*`、`src/stores/*`、`src/application/*`
  - 复核静态发现、边界与运行时三类工程验证已全部覆盖 `topomind.learning-statistics`、`topomind.monitor` 与 `topomind.devtools-sample`，并通过 `npm run verify:plugins` 串联验收
  - 确认 `src/plugins/official/learningStatistics.tsx` 与 `src/plugins/official/monitor.tsx` 已收缩为空壳，`App.tsx` 当前不再保留学习统计或监控业务 fallback，二级页面统一经由 `PluginViewHost`
  - 复核 `local-trusted` 前置条件结论：当前加载模型仍由 `BuiltinPluginLoader` 直接 import 内建模块，`ViewApi` / `UiApi` 仍以 React 渲染器函数在宿主进程内注册运行时绑定，因此仅满足 builtin 同进程桥接，不满足“独立执行上下文或等价隔离模型”的 `P7` 启动条件
- 验证结果：
  - `npm run typecheck` 通过
  - `npm run verify:plugins:static` 通过
  - `npm run verify:plugins:boundaries` 通过
  - `npm run verify:plugins:runtime` 通过
  - `npm run verify:plugins` 通过
- 当前结论：
  - `P13` 已完成，第二周期 `P8-P13` 的完全插件化验收项全部闭环，builtin 官方插件已满足“实现内聚 + Host API 驱动 + 工程边界强约束 + 运行时可验证”的目标
  - `P7` 继续延后；在引入隔离执行上下文、等价的序列化渲染协议或其他可验证隔离模型前，不应启动 `local-trusted` 设计与实现
- 下一步：
  - 维持 `P7` 延后状态
  - 后续如要重启 `P7`，需先补隔离执行容器方案、序列化渲染协议边界与对应安全/权限模型设计

## 25. 偏差记录

当前无偏差记录。

后续若实现中发现设计与现状不一致，必须在此区块追加记录，再决定是否继续后续编码。

## 26. 第二周期目标架构（完全插件化）

### 26.1 目标定义

第二周期完成后，builtin 官方插件应满足以下条件：

- 每个官方插件以“一个独立目录”作为实现边界，目录内包含 manifest、入口、UI、model、service 与测试
- 插件只能依赖 `src/plugins/public/*`、`src/plugins/extension-points/*`、插件目录自身代码，以及明确批准的 `src/shared/*`
- 插件不得直接依赖 `src/core/*`、`src/stores/*`、`src/features/*`、`src/application/*`、`src/plugins/host/*`
- 插件之间不得直接源码 import；如需交互，只能通过命令、扩展点或宿主定义的数据协议
- 宿主必须通过稳定 Host API 向插件提供工作区、导航、数据查询、日志监控、性能观测与插件诊断能力

### 26.2 目标目录结构

目标结构建议如下：

```text
src/
  plugins/
    host/
    public/
    extension-points/
    builtin/
      learning-statistics/
        manifest.json
        index.tsx
        ui/
        model/
        services/
      monitor/
        manifest.json
        index.tsx
        ui/
        model/
        services/
  shared/
    ui/
    utils/
    types/
  features/
    ...仅保留尚未插件化完成的旧模块
```

补充约束：

- `src/plugins/official/*` 仅作为第一周期遗留的过渡层，第二周期结束前应被删除或收缩为零业务逻辑入口
- `src/shared/*` 只能承载纯 UI、纯工具、纯类型与无宿主状态依赖的通用逻辑；当前白名单子域固定为 `ui`、`utils`、`observability`
- 一旦某个模块在第二周期中完成完全插件化，其主实现不再继续留在 `src/features/*`

### 26.3 依赖矩阵

| 代码层 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `src/plugins/builtin/<plugin>/*` | `@/plugins`、`@/plugins/public/*`、`@/plugins/extension-points/*`、`@/shared/ui/*`、`@/shared/utils/*`、`@/shared/observability/*`、本插件目录内文件、标准第三方库 | `@/core/*`、`@/stores/*`、`@/features/*`、`@/application/*`、`@/plugins/host/*`、`@/plugins/bootstrap`、其他插件目录、未登记的 `@/shared/*` 子域 |
| `src/shared/*` | 标准第三方库、`src/shared/*` 内部文件 | `src/plugins/builtin/*`、`src/features/*`、`src/stores/*`、`src/core/*`、未登记的 `shared` 顶级子域 |
| `src/plugins/host/*` | 宿主内部实现、`src/plugins/public/*` | 不向插件代码暴露直接 import 路径 |
| 插件间交互 | 命令 ID、扩展点、宿主协议 DTO | 直接源码 import、共享 store 实例、直接访问对方 service |

### 26.4 第二周期需要补齐的 Host API

为完成学习统计与监控的完全插件化，宿主至少需要补齐以下能力面：

- `workspace`：
  - `getCurrentWorkspaceId()`
  - `subscribeWorkspaceChange()`
- `views`：
  - `open(viewId)`
  - `focus(viewId)`
  - `close(viewId)`
  - `listOpenViews()`
- `commands`：
  - `register()`
  - `execute()`
- `ui`：
  - `registerWidget()`
  - `notify()`
  - `clipboard.writeText()`（如官方插件有复制场景）
- `learning`：
  - `getSummary(workspaceId, days)`
  - `getDailyRecords(workspaceId, dates)`
  - `getMeta(workspaceId)`
  - `subscribeCurrentSession(workspaceId)`
- `observability`：
  - `logs.getBuffer()`
  - `logs.query()`
  - `logs.subscribe()`
  - `logs.getAvailableDates()`
  - `performance.queryMetrics()`
  - `performance.subscribeMetrics()`
- `plugins`：
  - `getDiagnostics()`
  - `subscribeDiagnostics()`
  - `retryActivation(pluginId, reason)`

设计要求：

- 插件 API 返回稳定 DTO，不暴露 Zustand store、`FSB`、`log-backend` 或 `PluginManager` 这些宿主实现细节
- Host API 面向能力而非具体模块文件路径，后续如进入隔离执行模型时可继续复用相同抽象

### 26.5 第二周期迁移方法

第二周期统一采用以下迁移顺序：

1. 先定义 Host API 与 DTO
2. 再把业务实现改成依赖 API / service，而不是直接依赖宿主内部模块
3. 最后把业务实现搬入插件目录
4. 搬迁完成后立即补边界校验与回归验证

明确禁止的做法：

- 只搬目录，不改依赖方向
- 继续通过 `src/plugins/official/*` 长期复用 `src/features/*` 作为正式终态
- 把 `src/shared/*` 当作绕过插件边界的宿主实现兜底目录

## 27. 第二周期工作计划清单

### 27.1 `P8` 完全插件化基线与边界收敛

目标：

- 把第二周期边界规则从“建议”收敛为“可执行约束”

任务清单：

- [x] 将 `src/plugins/official/*` 纳入插件边界校验
- [x] 增加“禁止跨插件 import”的静态校验
- [x] 明确 `src/shared/*` 白名单规则与禁止依赖规则
- [x] 在本文档与 `src/plugins/README.md` 中同步更新完全插件化边界要求
- [x] 识别学习统计、监控当前仍直连宿主内部模块的清单

当前识别到的遗留直连清单：

- 当前无遗留直连项；此前学习统计与 monitor 官方适配层债务已分别在 `P10`、`P11` 清理完成
- `verify-plugin-boundaries` 当前仅用于持续防回归，不再携带官方插件过渡债务基线

阶段验收：

- [x] `verify-plugin-boundaries` 能覆盖 `builtin`、`official`、跨插件依赖
- [x] 第二周期允许/禁止依赖矩阵已经固化到文档与工程校验

### 27.2 `P9` Host API 扩容与宿主适配收敛

目标：

- 宿主提供学习统计、监控与工作区变化所需的稳定能力面

任务清单：

- [x] 定义 `learning` Host API 与 DTO
- [x] 定义 `observability` Host API 与 DTO
- [x] 定义 `plugins diagnostics` Host API 与 DTO
- [x] 为新增 API 建立权限点与运行时校验
- [x] 为新增 API 补最小 runtime / typecheck 验证

阶段验收：

- [x] 学习统计和监控不再需要新增 `core/stores` 直连能力
- [x] Host API 可独立支撑 `P10` 和 `P11`

### 27.3 `P10` 学习统计完全插件化迁移

目标：

- 让学习统计从“插件入口化”进入“插件实现内聚化”

任务清单：

- [x] 把学习统计页面改为依赖插件 service / Host API
- [x] 移除对 `FSB`、`workspaceStore`、`tabStore` 的直接依赖
- [x] 将 UI、model、service 迁入 `src/plugins/builtin/learning-statistics/*`
- [x] 清理 `src/plugins/official/learningStatistics.tsx` 中的业务逻辑适配
- [x] 补学习统计插件级验证用例

阶段验收：

- [x] 学习统计插件目录不再 import `features/core/stores/application`
- [x] 原功能闭环保持可用：命令、页面、widget、统计数据读取、返回首页

### 27.4 `P11` 监控模块完全插件化迁移

目标：

- 让监控页通过 observability / diagnostics API 工作，而不是直接依赖宿主内部实现

任务清单：

- [x] 把监控页改为依赖 `logs/performance/plugins diagnostics` Host API
- [x] 移除对 `log-backend`、`PluginManager`、宿主内部 store adapter 的直接依赖
- [x] 将监控页 UI、model、service 迁入 `src/plugins/builtin/monitor/*`
- [x] 清理 `src/plugins/official/monitor.tsx` 中的业务逻辑适配
- [x] 补监控插件级验证用例

阶段验收：

- [x] 监控插件目录不再 import `features/core/stores/application`
- [x] 日志、性能、插件诊断三标签功能保持完整

### 27.5 `P12` 共享层与跨插件边界固化

目标：

- 建立可长期维护的 `shared/*` 共享层，避免插件边界被二次侵蚀

任务清单：

- [x] 识别可安全下沉到 `shared/*` 的纯 UI / 工具 / 类型
- [x] 禁止 `shared/*` 反向依赖插件实现与宿主私有模块
- [x] 明确跨插件交互仅允许命令、扩展点、宿主 DTO
- [x] 对跨插件调用新增校验或文档约束

阶段验收：

- [x] `shared/*` 已具备清晰白名单边界
- [x] 插件之间不存在直接源码 import

### 27.6 `P13` 完全插件化验收与 `local-trusted` 前置复核

目标：

- 对第二周期结果做集中验收，并决定是否满足重启 `P7` 的条件

任务清单：

- [x] 汇总学习统计、监控的完全插件化落地文件范围
- [x] 对 Host API、边界校验、运行时验证、回归能力做集中复核
- [x] 评估 builtin 插件是否已不再依赖宿主内部实现路径
- [x] 复核是否具备重启 `P7` 的前置条件

阶段验收：

- [x] 第二周期所有验收项通过
- [x] 明确给出“继续延后 `P7`”或“可以重启 `P7`”的结论

## 28. 第二周期进度更新规则

从本次文档更新开始，后续所有与“完全插件化”相关的实施都必须遵守以下更新要求：

1. 每次执行前，先在提交说明或任务描述中声明当前所属阶段（`P8-P13`）
2. 执行完成后，必须同步更新 `23. 阶段看板`
3. 执行完成后，必须在 `24. 执行日志` 追加一条对应阶段记录
4. 若阶段任务或验收项有变化，必须同步更新 `27. 第二周期工作计划清单`
5. 若实现发现设计与现状不一致，必须同步更新 `25. 偏差记录`
6. 未在本文档回写前，不进入下一阶段编码
