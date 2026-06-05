# 插件系统开发指南

## 目录边界规范（重要）

为了确保插件与宿主实现的隔离，请遵守以下规则：

### 禁止插件代码直接导入的路径

**插件代码（位于 `src/plugins/builtin/*` 与 `src/plugins/official/*`）禁止直接导入以下路径：**

- ❌ `src/core/*`
- ❌ `src/stores/*`
- ❌ `src/features/*`（宿主功能内部模块）
- ❌ `src/application/*`
- ❌ `window.electronAPI`（直接访问 IPC）
- ❌ `src/plugins/host/*`、`src/plugins/bootstrap`、`src/plugins/secondaryViews`
- ❌ 其他 builtin 插件目录（禁止跨插件源码 import）

### 允许插件代码导入的路径

- ✅ `@/plugins` 或 `../`（仅公开导出）
- ✅ `@/plugins/public/*`（公开类型与 API）
- ✅ `@/plugins/extension-points/*`（公开扩展点类型）
- ✅ `@/shared/*`（仅允许纯 UI、纯工具、纯类型）
- ✅ React、React DOM 等标准第三方库
- ✅ 其他仅依赖公开类型的纯工具库

### `shared/*` 白名单规则

`src/shared/*` 是插件与宿主共用的白名单层，但必须保持“纯共享”：

- ✅ 允许：`src/shared/ui/*`、`src/shared/utils/*`、`src/shared/observability/*` 下的纯 UI primitives、纯工具函数、纯类型定义、与宿主实现无关的轻量状态封装
- ❌ 禁止：在 `src/shared/*` 下新增未登记顶级子域；需要先补文档与边界校验白名单
- ❌ 禁止：导入 `src/core/*`、`src/stores/*`、`src/features/*`、`src/application/*`
- ❌ 禁止：导入任何 `src/plugins/*` 实现目录，避免把 `shared/*` 变成反向耦合通道
- ❌ 禁止：直接访问 `window.electronAPI`

### 正确做法：通过 Host API 访问宿主能力

插件应仅通过 `PluginContext` 提供的 Host API 来与宿主交互：

```typescript
// ✅ 正确做法
const plugin: TopoMindPluginModule = {
  async activate(ctx) {
    // 通过 Host API 访问能力
    const workspaceId = ctx.workspace.getCurrentWorkspaceId()
    await ctx.views.open('devtools.sample')
    ctx.log.info('Hello from plugin')
  }
}
```

## API 权限映射表

| API 方法 | 权限点 | 说明 |
|---------|---------|------|
| `workspace.getCurrentWorkspaceId()` | `workspace.read` | 读取当前工作区 ID |
| `workspace.subscribeCurrentWorkspaceId()` | `workspace.observe` | 订阅当前工作区变化 |
| `learning.getState()` / `learning.getSummary()` / `learning.getDailyRecord()` | `learning.read` | 读取学习统计快照与历史数据 |
| `learning.subscribeState()` | `learning.observe` | 订阅学习状态变化 |
| `logs.getBuffer()` / `logs.getAvailableDates()` / `logs.query()` | `logs.read` | 读取日志缓冲区与查询结果 |
| `logs.subscribe()` | `logs.subscribe` | 订阅实时日志流 |
| `performance.getMetricDefinitions()` / `performance.querySamples()` | `performance.read` | 读取性能指标定义与样本 |
| `performance.subscribeSamples()` | `performance.subscribe` | 订阅实时性能样本 |
| `plugins.listDiagnostics()` / `plugins.getDiagnostics()` / `plugins.subscribeDiagnostics()` | `plugins.diagnostics.read` | 读取插件诊断快照 |
| `plugins.retryActivation()` | `plugins.diagnostics.retry` | 重试插件激活 |
| `views.register()` | `view.register` | 注册次级页面运行时渲染器 |
| `views.open()` | `view.open` | 打开已声明视图 |
| `commands.register()` | `command.register` | 注册命令处理器 |
| `commands.execute()` | `command.execute` | 执行命令 |
| `ui.notify()` | `ui.notify` | 发送宿主通知 |
| `log.info()` / `log.warn()` / `log.error()` | `log.write` | 记录插件维度日志 |

### 权限检查规则

- 插件未声明权限时，相关 API 会在运行时抛出权限错误
- `learning/*`、`logs/*`、`performance/*`、`plugins diagnostics/*` 也受同样的权限检查约束
- `views.register()` 和 `commands.register()` 会在调用时检查权限
- `views.open()`、`commands.execute()`、`ui.notify()` 和 `log.*()` 也会执行权限检查

## 工程校验

- `npm run verify:plugins:boundaries`：检查 `builtin/*`、`official/*`、`shared/*` 的越界 import、跨插件依赖和 `window.electronAPI`
- `npm run verify:plugins:runtime`：检查权限拒绝、命令懒激活和激活事件校验
- `npm run verify:plugins`：串联全部插件校验

### 当前边界状态

- `verify:plugins:boundaries` 当前不再携带官方插件迁移债务基线
- `shared/*` 已收口为 `ui / utils / observability` 三个白名单子域
- 如需新增共享域或跨插件协议，必须同步更新文档与工程校验

## 公开导出规范

插件应只通过 `src/plugins/index.ts` 的统一导出访问宿主能力，不要直接导入 `src/plugins/host/*` 的内部实现。
