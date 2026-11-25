# TopoMind 日志模块规范与改造方案

> 版本 v1.2 · 2026-11-23 · 状态：**本文描述 v2 历史契约；现行契约已升级到 v3**（D1–D8 取建议值；Phase 0 / 1 / 2 的框架已实现，Phase 1.4 的 100+ 处 action 迁移未开始；v3 P0 修复可靠性与契约缺陷，P1 升 `LOG_SCHEMA_VERSION = 3`，新增 `category` 一级分类、`sessionId/seq/spanId/parentId/workspaceId` 关联键、事件目录与按类分文件，详见 `observability-v3-plan.md`）  
> 后续方案：`observability-v3-plan.md`（四类日志 / 事件目录 / 崩溃闭环 / 分期任务清单）。本文 §3 的规范继续有效，冲突处以上述 v3 决策为准。 
> 适用：`src/core/logger.ts`、`src/core/log-backend.ts`、`src/core/performance-log.ts`、`electron/log-service.js`、`electron/main.js` 的 log 通道、`src/plugins/builtin/monitor/`、`src/shared/observability/`  
> 本文分两部分：**§3 规范**（改造完成后必须遵守的契约）与 **§5 改造方案**（分阶段落地路径）；现状事实与证据见附录 A。  
> 条款用【必须】【禁止】【建议】标注；可执行门禁见 §4。性能埋点的统计口径不在本次改造范围内。

---

**落地说明**：契约唯一真源 `src/shared/observability/logContract.ts` 已建立；采集层、主进程服务、主进程装配、消费端、全局异常与门禁均按本文 §3 改造完成。新增 `scripts/verify-logging.mts`（C1–C8，含运行时冒烟与行为用例）并接入 `verify-all.mjs`。下方决策表保留作为设计依据，D1–D8 均已按「建议」列执行。

**v1.1 修订（2026-11-23）**：只读复核发现「框架全绿」不等于「行为正确」——门禁 C6 多为字符串存在性断言，实际漏掉 16 项缺陷（目录不可写丢日志、`accepted` 语义、脱敏只在渲染侧、`resolveModule` 误判、等级无运行时 UI 等）。v3 P0 已修复可靠性与契约层，并新增 C8 行为用例；本文以下三处按实现更正：字段字典版本号为 `v: 2`、`logAction` 兼容签名以 `log-backend.ts` 为准、状态措辞由「已落地」改为「框架已落地」。

## 0. 评审请求：需要拍板的决策

> 决策已定：D1–D8 全部采用各行的建议值，无需再拍板。

| #  | 决策点                                | 建议                                                                                 | 选另一项的影响                                                                    |
| -- | ---------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D1 | 日志根目录                              | 启动时先落到 `app.getPath('userData')/logs` 兜底，进入工作目录后切换到 `<workDir>/logs` 并 flush 预缓冲   | 只在 `enterWorkDir` 初始化：setup 阶段日志继续丢失；固定 userData：日志与用户工作目录分离，拷走工作目录时丢排障上下文 |
| D2 | 继续自建 vs 引入 `electron-log` / `pino` | **继续自建**，只补队列/轮转/校验；现有链路已通，迁移收益低于成本                                                | 引入三方库：需重做 IPC 桥接、监控面板兼容、性能样本反解，且新增打包体积与依赖                                  |
| D3 | action 命名                          | 机器 key `<domain>.<verb>`（如 `node.create`）+ 注册表里的中文 `label` 供 UI 展示；**禁止**业务代码写裸字符串 | 保留中文自由文本：无法做聚合统计、去重、翻译与门禁，107 处仍会继续漂移                                      |
| D4 | 默认等级                               | 生产 `INFO`、开发 `DEBUG`；DEBUG 只进内存/控制台、**不落盘**；等级只在主进程存一份                             | 现状双阈值（渲染 WARN / 主进程 INFO）：`debug/info` 事实上是死代码                             |
| D5 | 幽灵字段                               | 删除 `file/line/func/spanId/parentId`；`error` 提为一级可选字段并由采集层填充；`traceId` 保留并贯通        | 全部保留：字段字典要承诺永远填不上的字段，详情面板持续空白                                              |
| D6 | 轮转与保留                              | 单文件 10 MB 分片 `YYYY-MM-DD.N.log`、保留 14 天、启动时清理；`clear()` 更名 `clearBuffer()`         | 现状：单日文件无上限、无清理、`clear()` 只清内存不删盘                                           |
| D7 | 107 处 action 迁移                    | 加兼容层（`resolveAction` 映射旧字符串 → key，未注册原样落到 `params.rawAction` 并记 WARN），**分批**迁移     | 一次性全改：改动面 28 个文件，回归风险高且无法灰度                                                |
| D8 | 本次范围                               | 只做本地日志；不做远程上报、不做 APM 链路追踪；提供当日 JSONL 导出                                            | 加远程上报：需额外处理用户授权、脱敏、离线队列，建议单独立项                                             |

---

## 1. 目标与非目标

**目标**

1. 任何一条「写日志」的调用都能落到同一个入口，且**不会因为初始化时机、等级阈值、来源进程而静默消失**。
2. 日志结构有唯一真源：字段、等级、module、action 都在契约文件里定义，各层只能引用。
3. 崩溃、未处理异常、插件错误都能被采集；用户能自助导出一份可用于排障的日志。
4. 写入不阻塞主进程、不因单条失败而说谎；日志文件有界、可清理、不含用户内容。

**非目标**

- 不改性能埋点的指标定义、采样/节流与统计口径（它已是项目里最规范的部分，仅作为契约写法的模板）。
- 不改监控页面的视觉设计；分页/虚拟列表属于性能改造，不是重做 UI。
- 不引入远程日志服务、不做跨进程分布式追踪。

---

## 2. 现状一页纸

链路：`logger / logAction / 性能埋点 → log-backend.ts → IPC log:write → electron/log-service.js → 按日 JSONL + 环形缓冲(2000) + log:entry 广播 → monitor 插件`。

四类断点：**① 漏采**（插件日志 15 处、console 残留 61 处、主进程异常与崩溃事件均不入库）；**② 错采**（双等级阈值、进工作目录前的 4 处 write 被丢）；**③ 无规范**（LogEntry 契约分散 4 处、action 107 处中文自由文本、无注册表/无文档、幽灵字段）；**④ 无治理**（无轮转/清理/脱敏、写失败被吞、query 同步读整文件且无分页、0 专项测试）。

详细证据见附录 A。

---

## 3. 日志规范（改造后必须遵守）

### 3.1 唯一真源与分层

| 层  | 文件                                            | 职责                                                                                        | 禁止                                        |
| -- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| 契约 | `src/shared/observability/logContract.ts`（新增） | `LogLevel` / `LogEntry` / `LOG_MODULES` / `LOG_ACTIONS` / `LOG_ACTION_SPECS` / `redact()` | 禁止在别处再抄一份字段或 id 列表                        |
| 采集 | `src/core/logger.ts`（收敛）                      | `debug/info/warn/error/catch` + console 镜像 + 异常接管                                         | 禁止业务代码直接调 `logWrite` / `LogService.write` |
| 桥接 | `src/core/log-backend.ts`                     | 只做 IPC 收发、订阅、`logAction` 薄封装                                                              | 禁止在此定义业务语义或第二套字段类型                        |
| 服务 | `electron/log-service.js`                     | 等级判定、字段补全、缓冲、落盘、广播、查询、轮转                                                                  | 禁止在 `main.js` 里散落 `LogService.write`      |
| 消费 | `src/plugins/builtin/monitor/`                | 展示与导出                                                                                     | 禁止重新声明 LogEntry 结构                        |

【必须】`LogEntrySnapshot`（`plugins/public/api.ts:125`）改为 `export type { LogEntry } from logContract` 的 re-export；`monitorStore.ts:17` 的 `LogEntry` 同理；主进程 JS 侧用 JSDoc `@typedef {import(...).LogEntry}` 引用，Phase 2 再评估迁 TS。  
【禁止】第五份真源。写法参照 `performanceContract.ts:11-12`：「新增指标只需在注册表加一条，禁止在别处再抄一份 id 列表」。

### 3.2 分级

| 级别      | 语义                 | 典型场景                                   | 落盘         |
| ------- | ------------------ | -------------------------------------- | ---------- |
| `DEBUG` | 开发期诊断细节，含函数级分支、中间态 | 房间加载丢弃原因、去重判断                          | 否（仅内存/控制台） |
| `INFO`  | 用户动作与关键状态迁移（成功路径）  | 节点创建、文档保存、房间加载完成                       | 是          |
| `WARN`  | 可恢复异常、降级、超阈值慢样本    | 保存重试、强校验拒绝、性能超阈值                       | 是          |
| `ERROR` | 操作失败、未捕获异常、渲染/进程崩溃 | 读盘失败、ErrorBoundary、render-process-gone | 是          |

【必须】默认等级由主进程唯一持有，生产 `INFO` / 开发 `DEBUG`（`app.isPackaged` 判定，或配置项覆盖）。渲染进程**不做等级过滤**，只做 console 镜像；镜像仅在开发构建启用。  
【必须】`ERROR` 与 `WARN` 中的异常必须填充 `error` 字段（`{ name, message, stack? }`）或 `params.error`，禁止只把错误拼进 `message`。  
【必须】`log:setLevel` 是唯一入口；设置后广播 `log:level` 给所有窗口，UI 显示当前等级。  
【禁止】把「操作被用户取消」「校验拒绝」记为 `ERROR`（应为 `INFO` 或 `WARN`）。

### 3.3 字段字典（LogEntry v2，历史）

> ⚠️ 自 v3 起 `v = 3`，字段字典新增 `category / label / sessionId / seq / spanId / parentId / workspaceId / target / result / source / outcome / durationMs`。
> 本表保留作为 v2 落盘格式与 v1→v2 读时兼容的依据；v3 现行字段以 `observability-v3-plan.md` §2 与 `logContract.ts` 为准。

| 字段          | 类型                          | 必填 | 生成方 | 说明                                          |
| ----------- | --------------------------- | -- | --- | ------------------------------------------- |
| `v`         | `2`                         | 是  | 服务层 | schema 版本（`LOG_SCHEMA_VERSION = 2`），旧日志无此字段按 v1 兼容读取 |
| `id`        | `string`                    | 是  | 服务层 | ISO 时间戳 + 随机后缀，全局唯一                         |
| `timestamp` | `string`                    | 是  | 服务层 | ISO 8601 UTC                                |
| `level`     | `LogLevel`                  | 是  | 采集层 | 四值枚举                                        |
| `module`    | `LogModuleId`               | 是  | 采集层 | 见 §3.4，默认 `app`                             |
| `action`    | `LogActionId`               | 否  | 采集层 | 注册表中的 id；无动作的事件可省略                          |
| `message`   | `string`                    | 是  | 采集层 | 一句话人类可读摘要，≤ 500 字                           |
| `params`    | `Record<string, unknown>`   | 否  | 采集层 | 结构化上下文，camelCase 键，经 `redact()`             |
| `error`     | `{ name, message, stack? }` | 否  | 采集层 | ERROR/WARN 异常专用，替代 v1 的 `params.error` 散装字段 |
| `traceId`   | `string`                    | 否  | 采集层 | 一次用户操作的链路 id，跨 IPC 透传                       |
| `meta`      | `Record<string, unknown>`   | 否  | 服务层 | 服务层附加信息（如 `parseErrors`、写入重试次数）             |

示例：

```json
{
  "v": 2,
  "id": "20261123T061234123ABCDE@topomind",
  "timestamp": "2026-11-23T06:12:34.123Z",
  "level": "ERROR",
  "module": "store",
  "action": "document.save",
  "message": "保存文档失败",
  "params": { "nodePath": "AI/机器学习", "retry": 1 },
  "error": { "name": "Error", "message": "EBUSY: resource busy", "stack": "..." },
  "traceId": "canvas:mlx2k9:17"
}
```

【禁止】`file` / `line` / `func` / `spanId` / `parentId`（v1 从未被采集，见附录 A）。保留它们只需要在未来引入 sourcemap / 分布式追踪时按 `v` 升版本新增。  
【必须】`params` 深度 ≤ 3、序列化后 ≤ 8 KB；超限由采集层截断并置 `params.truncated = true`。禁止直接 `JSON.stringify(任意对象)`（现状 `logger.ts:34-44`，循环引用会抛错）。

### 3.4 module 与 action 命名

【必须】module 按**功能域**命名，不按实现文件/函数名（现状 `Store.writeTopoDocument` 会随重构漂移）。`LOG_MODULES` 建议：

| id            | 覆盖                        | 现状对应                                                          |
| ------------- | ------------------------- | ------------------------------------------------------------- |
| `app`         | 启动、生命周期、全局异常              | `App` / `Main`                                                |
| `workspace`   | 工作目录选择/创建/切换/校验           | `SetupPage` / `Main`                                          |
| `kb`          | 知识库列表、创建、导入、设置、回收站        | `HomePage` / `KBSettings` / `useTrashDialogModel`             |
| `graph`       | 节点、连线、容器、房间导航、画布交互        | `graphOperations` / `useGraph` / `GraphPage` / `GraphCanvas`  |
| `document`    | 文档读写、保存、导出、多类型文档          | `DetailPanel` / `DocumentWorkspaceLayout` / `SaveCoordinator` |
| `attachment`  | 附件上传/删除/打开                | `AttachmentsTab`                                              |
| `store`       | 存储层与文件系统适配                | `Store.*` / `FSB`                                             |
| `plugin`      | 插件运行时与 LoggingApi         | `[plugin:*]`                                                  |
| `performance` | 性能样本                      | `Performance`                                                 |
| `ui`          | 纯 UI 交互（Tab、面包屑、右键菜单、视图控件） | `TabBar` / `Breadcrumb` / `ViewportReturnButton`              |

【必须】action 采用 `<domain>.<verb>` 全小写英文 key，注册表提供中文 `label`；业务代码只用 `LOG_ACTIONS.xxx`。结构仿 `performanceContract.ts:30-72`：

```ts
export const LOG_ACTIONS = {
  nodeCreate: 'node.create',
  nodeDelete: 'node.delete',
  documentSave: 'document.save',
  roomLoad: 'room.load',
  workspaceSelect: 'workspace.select',
  performanceRecord: '性能:记录',
} as const

export type LogActionId = typeof LOG_ACTIONS[keyof typeof LOG_ACTIONS]

export interface LogActionSpec {
  id: LogActionId
  label: string
  module: LogModuleId
  level: LogLevel
  description: string
}
```

【必须】`性能:记录`（`performanceContract.ts:15`）作为**保留 action** 登记在册、值不变、`module` 恒为 `performance`：样本反解在 `performanceMetrics.ts:117` 用该常量做过滤，`scripts/verify-critical-regressions.mts:8590/9119` 与 `scripts/analyze-performance-scale.mts:11` 都依赖它，改名会直接破坏回归门禁。  
【必须】UI 展示用 `label`（中文），筛选/聚合/导出用 `id`。**签名更正（v1.1）**：桥接层 `logAction(action, module, params)` 保持旧签名以兼容 100+ 处调用点，`logger.action(action, params, module)` 是规范新签名，两者并存；v3 P1 的事件目录会统一收敛。  
【必须】兼容期提供 `resolveAction(raw)`：命中旧字符串映射表 → 返回 id；未命中 → 返回 `unknown`，原文本写入 `params.rawAction` 并记一条 `WARN`。`log-backend.ts:139` 的 TODO 在此关闭。

### 3.5 采集规范

【必须】统一入口（收敛 `logger.ts` 与 `log-backend.ts` 的重复职责）：

```ts
log.debug(module, message, params?)
log.info(module, message, params?)
log.warn(module, message, params?)
log.error(module, message, error?, params?)
log.action(actionId, params?, module?)
log.catch(module, context, err, params?)   // 内部转 error，保留兼容
```

所有来源最终都调用同一个 `writeEntry`：业务代码、插件 `LoggingApi`、`ErrorBoundary`、性能埋点、主进程内部事件、`logAction`。【禁止】业务代码直接 `logWrite`，主进程【禁止】在 `main.js` 里散落 `LogService.write`（改为 `mainLog` 适配模块）。

【必须】全局异常接管清单：

| 位置   | 事件                                                       | 级别    | 备注                                          |
| ---- | -------------------------------------------------------- | ----- | ------------------------------------------- |
| 主进程  | `uncaughtException` / `unhandledRejection`               | ERROR | 记录后按现有退出策略处理，避免无限重启                         |
| 主进程  | `render-process-gone` / `unresponsive` / `did-fail-load` | ERROR | 现状 `main.js:866-871` 只 console              |
| 主进程  | `console-message`                                        | DEBUG | 仅开发期；需按 level 去重节流                          |
| 渲染进程 | `window error`（捕获阶段）                                     | ERROR | 现状 `main.tsx:79` 只用于压制 ResizeObserver，需拆分职责 |
| 渲染进程 | `unhandledrejection`                                     | ERROR | 新增                                          |
| 渲染进程 | React `ErrorBoundary`                                    | ERROR | 保留 `ErrorBoundary.tsx:38`，改走统一入口并填 `error`  |

【必须】插件 `LoggingApi`（`pluginContext.ts:333-346`）由 `bootstrap.ts` 的 `hostServices.log` 接回 `writeEntry`；权限 `log.write` 校验保持不变。  
【必须】`eslint` 增加 `no-console`，白名单仅：`src/core/logger.ts`（console 镜像）、`electron/preload.js`（通道告警）、`electron/log-service.js`（写失败兜底告警）。`src/main.tsx:50-81` 对 `console.error/warn` 的覆写需移除或收窄到 ResizeObserver 抑制。  
【必须】脱敏 `redact()`：路径只保留工作目录相对路径或 basename；文档标题/正文/附件内容不入库；用户输入的关键词只记长度；`kbInfo`、`nodePath`、`selectedPath`、`sourcePath` 等键统一走白名单转换。现状 `main.js:493-519` 把绝对路径原样落盘。  
【必须】高频事件（画布平移/缩放/拖拽）禁止逐事件打点；沿用 `performanceContract` 的 `sampleRate` / `minIntervalMs` 思路。  
【建议】`traceId` 由 `src/shared/observability/trace.ts` 统一生成，复用 `PERFORMANCE_SESSION_ID` 与 `newPerformanceTraceId()` 的形式，一次用户操作贯穿渲染→主进程→异步回调。

### 3.6 写入与生命周期规范

【必须】初始化时机：app 启动即 `init(userData/logs)`；`enterWorkDir` 切换目录并 flush 预缓冲队列；`leaveWorkDir` 保留队列不丢。切换期间的新日志继续进队列，不因 `_logDir === null` 被丢（现状 `log-service.js:146`）。  
【必须】串行写入队列（`createWriteStream` 或 promise chain），禁止无保护的并发 `fs.appendFile`；`JSON.stringify` 失败降级为安全字符串；写失败重试 1 次后降级到内存并**一次性**告警，禁止递归写日志。  
【必须】`write()` 返回真实结果（成功/被等级过滤/失败），禁止先 `return true` 再异步失败（`log-service.js:188/218`）；`logWrite` 不得吞掉异常（`log-backend.ts:45-49`）。  
【必须】单文件 10 MB 上限，超限写 `YYYY-MM-DD.1.log`、`.2.log`…；`getAvailableDates()` 适配分片命名；启动时按 14 天保留期清理旧文件（清理是磁盘删除，【必须】有日志说明与失败兜底，不因单个文件占用而中断启动）。  
【必须】`clear()` 更名为 `clearBuffer()`，语义明确为「只清内存」；如需删盘，另提供显式 `pruneLogs()` 且需 UI 二次确认。同步更新 `main.js:707`、`preload.js:34`、`log-backend.ts:69`。  
【必须】主进程入口校验：`dateStr` 必须匹配 `/^\d{4}-\d{2}-\d{2}(\.\d+)?$/`，`path.resolve` 后确认仍在 `_logDir` 内（现状 `:132-135, :300` 可被 `../` 穿越）；`entry` 校验 level 白名单、message 长度、params 大小，未知字段丢弃。

### 3.7 查询与消费规范

【必须】`logQuery` 签名统一为一套（`date` 或 `dateStr` 二选一，建议 `date`），删除 `bootstrap.ts:229-236` 的手工字段映射；增加 `limit` / `offset`，返回 `{ entries, total }`。  
【必须】查询改为流式逐行读取（`createReadStream` + `readline`），禁止 `readFileSync` 整文件阻塞主进程；坏行计数并通过 `meta.parseErrors` 暴露，不再静默忽略。  
【必须】`LogList` 使用分页或虚拟列表；缓冲容量统一为一个常量（建议 2000，`log-service.js:24` 与 `monitorStore.ts:141-144` 的 5000 二选一）。  
【建议】日志 tab 增加「导出当日 JSONL」（与性能 tab 的导出交互一致），导出前提示日志可能包含路径信息。

### 3.8 兼容与迁移

【必须】旧 `logs/YYYY-MM-DD.log`（v1，无 `v` 字段）可继续读取并展示；`normalizeLogEntry` 负责补 `v: 1`、把 `params.error` 提升为 `error`、丢弃幽灵字段。  
【必须】`性能:记录` 的样本格式、字段与反解逻辑不变，`extractPerformanceSamples` 保持兼容（回归脚本 `verify-critical-regressions.mts:8588/9101` 依赖）。  
【必须】IPC 通道增删需同步三处：`main.js:702-709` 的 handler、`preload.js:34-49` 的三张白名单、`log-backend.ts` 的封装；新增 `log:level` 属于 receive 通道。  
【建议】v1 → v2 不重写历史文件，采用「读时兼容、写时新格式」，避免用户已有日志被破坏。


## 4. 门禁与验收

**可执行门禁**：`npm run verify:logging`（`scripts/verify-logging.mts`），已接入 `scripts/verify-all.mjs` 作为第 6 步。纯文本静态检查，不加载应用代码——主进程是 ESM/CJS 混合边界、回归脚本在 Node 里跑，动态 import 会引入运行时差异。

| 组  | 检查内容                                                                                                  | 条款 |
| --- | --------------------------------------------------------------------------------------------------------- | ---- |
| C1  | `LogEntry` / `LogQueryInput` / `LogWriteResult` / `LogLevel` / `LOG_ACTIONS` / `LOG_MODULES` 只允许在 `logContract.ts` 声明；采集层、桥接层、消费层、bootstrap 必须引用契约 | §3.1 |
| C2  | action id 符合 `<domain>.<verb>`、无重复；`性能:记录` 作为保留 action 登记在册且字面量不变；全库 `logAction('...')` 字面量必须命中注册表或兼容映射 | §3.4 |
| C3  | `LOG_MODULES` 恰好 10 域、key 与 id 一致；`LEGACY_MODULE_MAP` 的值全部落在功能域内；`resolveModule` 存在 | §3.3 |
| C4  | 主进程 `MAX_*` 常量与 `LOG_LIMITS`、`LEVEL_ORDER` 与 `LOG_LEVEL_ORDER` 逐项一致（防止两套数值漂移）      | §3.2 / §3.6 |
| C5  | `main.js` 的 `ipcMain.handle('log:*')`、`preload.js` 三张白名单、`log-backend.ts` 的 invoke/on/send 通道三者同步；旧 `log:clear` 必须消失 | §3.9 |
| C6  | 渲染侧无本地等级过滤、插件 log 接回 `writeEntry`、主/渲染全局异常接管、启动兜底 init、流式查询/串行写队列/分片清理、性能 action 不变、LogList 分页与导出；裸 `console` 数量冻结只减不增 | §3.5 / §3.6 / §3.7 |
| C7  | 以 mock 替换 electron 依赖后真实加载主进程服务，验证 init / write 返回值 / 等级过滤 / 日期穿越拒绝 / 落盘 / query 分页 / v2 版本号 / exportJsonl / availableDates / clearBuffer | §4 场景 1/5 |

配套 lint：`eslint.config.js` 的 `no-console` 为 **warn**（report-only，与项目既有策略一致），仅 `logger.ts`、`log-backend.ts`、`log-service.js` 三处白名单豁免——这三处若再写日志会自我放大。`scripts/lint-baseline.json` 只统计 error，因此加 warn 规则不需要上调基线。

**单测清单**（Phase 2 补齐，接入 `verify:critical` 或独立用例）
1. `buildLogEntry`：等级归一化、module 归域、路径/正文脱敏、params 深度与字节上限、循环引用不抛错。
2. `resolveAction`：规范 id 直通、96 条旧中文映射、未登记 action 落 `unknown.unknown` 且 `params.rawAction` 保留原文。
3. `normalizeLogEntry`：v1 无 `v` 补 1、`params.error` 提升为 `error`、幽灵字段丢弃。
4. `LogService`：等级过滤返回值、预缓冲 flush、分片切换、保留期清理、日期穿越被拒、坏行计数。
5. 性能样本反解：`性能:记录` 的 `extractPerformanceSamples` 输出口径不变（回归脚本已有覆盖）。

**人工验收场景**
1. **启动兜底**：删除/不选择工作目录直接启动，`userData/logs` 下当天即出现 `app.startup`；选择工作目录后 `workspace.enter` 出现在该目录的 `logs/`，且启动期日志不丢。
2. **等级单源**：在监控页切换等级后所有窗口同步；`logger.debug/info` 可见而不再被渲染侧静默丢弃；同为 INFO 的 `logAction` 与 `logger.info` 行为一致。
3. **插件日志**：触发一次插件 `log.info` / `notify`，能在监控页与磁盘 JSONL 中查到 `module=plugin` 条目，而不是只出现在 DevTools。
4. **异常接管**：制造一次渲染异常（ErrorBoundary）、一次未处理 Promise 拒绝、一次 `render-process-gone`，均能在日志中查到带结构化 `error` 的条目。
5. **大数据量**：写入超过 10 MB 触发 `.1.log` 分片，`getAvailableDates` 仍只列出日期；打开 14 天前的日志文件验证清理；监控页列表不全量渲染、导出 JSONL 可直接用于排障。


## 5. 改造方案

### Phase 0 — 正确性（不动数据结构，风险最低，建议先独立发版）

| #   | 文件                                                    | 改动                                                                                                                         | 验收                       |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0.1 | `src/core/logger.ts`                                  | 删除本地 `_currentLevel` / `_shouldLog` 过滤；四个级别统一走 `logWrite`；`debug/info` 恢复可用；console 镜像仅 dev；`catch` 内部转 `error` 并填 `error` | §4 场景 2                  |
| 0.2 | `electron/log-service.js`                             | 启动时兜底 `init` + 预缓冲队列 + flush；`_minLevel` 成为唯一阈值；`write()` 返回真实结果；补 `log:level` 广播                                          | §4 场景 1                  |
| 0.3 | `electron/main.js`                                    | app 启动时 `init`；`app:enterWorkDir` 改为切换目录；接管 6 类全局异常；4 处早期 `LogService.write` 迁到 `mainLog`                                  | §4 场景 1/4                |
| 0.4 | `src/plugins/bootstrap.ts`                            | 实现 `hostServices.log` → `writeEntry`，插件日志落盘                                                                                | §4 场景 3                  |
| 0.5 | `src/main.tsx`、`ErrorBoundary.tsx`                    | 拆分 ResizeObserver 抑制与错误上报；新增 `unhandledrejection`；ErrorBoundary 改走统一入口                                                     | §4 场景 4                  |
| 0.6 | `eslint.config.js`、`scripts/verify-lint-baseline.mjs` | 加 `no-console`（先 warn）+ 三处白名单；更新基线                                                                                         | `npm run lint` 无新增 error |

**风险与回滚**：`init` 时机变化会影响日志目录位置；保留 `TOPOMIND_LOG_FALLBACK=0` 环境变量可一键回到「只在 enterWorkDir 初始化」的旧行为。console 规则先 warn 不阻塞构建（沿用 `eslint.config.js:7-8` 的 report-only 策略），避免 61 处存量代码一次性炸基线。

### Phase 1 — 契约化（建立唯一真源，分批迁移）

| #   | 文件                                                                | 改动                                                                                      |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1.1 | 新增 `src/shared/observability/logContract.ts`                      | §3.3 字段字典、`LOG_MODULES`、`LOG_ACTIONS` / `LOG_ACTION_SPECS`、`redact()`、`resolveAction()` |
| 1.2 | `log-backend.ts` / `api.ts` / `monitorStore.ts` / `cloneLogEntry` | 收敛为 re-export；删 `dateStr`/`date` 双命名与手工映射；删除幽灵字段；`error` 提为一级字段                         |
| 1.3 | `src/core/logger.ts`                                              | 签名改为 §3.5 统一入口，`module`/`action` 用类型约束                                                  |
| 1.4 | 28 个业务文件（107 处 `logAction`）                                       | 分批替换为 `LOG_ACTIONS.xxx`；未覆盖项走 `resolveAction` 兼容层并记 WARN                                |
| 1.5 | `src/features/layout/ErrorBoundary.tsx`、`performance-log.ts`      | 改走统一入口；性能 action 保持 `性能:记录` 不变                                                          |
| 1.6 | 新增 `scripts/verify-logging.mts`                                   | §4 门禁表，接入 `verify-all.mjs`                                                              |

**风险与回滚**：107 处替换按模块分批（先 `graph` / `document`，再 `kb` / `ui`），每批跑 `npm run verify`；兼容层保证未迁移的旧字符串仍能落盘，可随时暂停。

### Phase 2 — 可靠性、性能与治理

| #   | 文件                                                                      | 改动                                                                                    |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2.1 | `electron/log-service.js`                                               | 串行写队列、失败重试/降级、`JSON.stringify` 安全兜底、10 MB 分片、14 天保留期清理、`clearBuffer()` 更名、IPC 参数与路径校验 |
| 2.2 | `electron/log-service.js` + `log-backend.ts` + `preload.js` + `main.js` | `logQuery` 流式读取 + `limit/offset` + 返回 total；三处通道白名单同步                                 |
| 2.3 | `src/plugins/builtin/monitor/`                                          | LogList 虚拟列表/分页；缓冲容量统一；日志 tab 导出 JSONL；详情面板按 v2 字段重排                                  |
| 2.4 | `src/shared/observability/trace.ts`                                     | traceId 统一生成与跨 IPC 透传                                                                 |
| 2.5 | `scripts/`                                                              | §4 单测与契约测试补齐，接入 `verify-all.mjs`                                                      |

**风险与回滚**：分片命名会改变 `getAvailableDates()` 与用户已有脚本的输入假设，需与 `analyze-performance-scale.mts --input` 的输入格式一起验证；`--input` 仍接受单文件路径，另加 `--dir` 支持分片目录。

### 阶段依赖

```
Phase 0（正确性）
   ├─ 独立可发版；不依赖契约
   └─ Phase 1（契约）── 依赖 0.1/0.3 的单一入口与单一等级
                          └─ Phase 2（可靠性）── 依赖 1.2 的 v2 字段与 1.6 的门禁
```

---

## 附录 A 现状证据（只读调研，2026-11-23）

| 发现                                                                    | 证据                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 默认等级 WARN，`debug/info` 恒被丢弃且 0 调用                                     | `logger.ts:13, :21-23, :55-73`（文件头 `:6` 声称双写 console + 文件，与实现不符）                                                   |
| 主进程第二套阈值 `_minLevel = 1`(INFO)，两处 setLevel 全项目 0 调用                   | `log-service.js:53, :177-178`；`main.js:706`                                                                        |
| `logAction` 固定 INFO 绕过渲染侧过滤                                           | `log-backend.ts:145-156`                                                                                           |
| `logService.init` 只在 `enterWorkDir` 触发，之前 4 处 write 被 `!_logDir` 静默丢弃 | `main.js:493/501/509/517/591`；`log-service.js:70-83, :146`                                                         |
| 插件 LoggingApi 有权限校验但只写 console                                        | `pluginContext.ts:128-142, :333-346`；`bootstrap.ts:166-270` 未提供 `log` 实现                                           |
| 全局异常/崩溃事件只 console                                                    | `main.js:836-871`；`main.tsx:45-81`；唯一上报 `ErrorBoundary.tsx:38`                                                     |
| console 残留 src 41 + electron 20，无 `no-console` 且 lint report-only     | `eslint.config.js:7-8, :47-71`                                                                                     |
| LogEntry 定义分散 4 处；`date` / `dateStr` 双命名                              | `log-backend.ts:6-30`、`api.ts:123-149`、`monitorStore.ts:17-33`、`log-service.js:159-174`；映射在 `bootstrap.ts:229-236` |
| 幽灵字段 `error` / `file` / `line` / `func` 永不填充                          | `monitorStore.ts:25`、`DetailPanel.tsx:90-109`；落盘字段 `log-service.js:159-174` 无 `error`                              |
| action 107 处 / 106 含中文 / 99 含冒号 / 0 注册表                               | `log-backend.ts:139` 留 TODO；`performanceContract.ts:15` 是唯一 action 常量                                              |
|                                                                       |                                                                                                                    |
| query 同步读整文件、无分页、坏行静默、日期可穿越                                           | `log-service.js:298-325, :132-135`                                                                                 |
| 写失败被吞；`clear()` 只清内存；无轮转/清理/脱敏                                        | `log-service.js:214-220, :330-334`；`.gitignore:4` 仅 `*.log`                                                        |
| 缓冲容量 2000 vs 5000；LogList 全量渲染                                        | `log-service.js:24`；`monitorStore.ts:141-144`；`LogList.tsx:81-91`                                                  |
| 日志模块 0 专项测试                                                           | `verify-all.mjs:10-16` 共 5 步无日志专项；`verify-critical-regressions.mts:8588/9101` 仅覆盖性能样本反解                            |

---

## 附录 B 遗留问题与风险

1. **工作目录语义**：日志跟随工作目录意味着切换目录后监控面板看到的是「当前目录的日志」，跨目录排障需要切换查看。若 D1 选「固定 userData」，需在字段里补 `workspaceId` 才能区分来源。
2. **`console-message` 上报**：渲染进程 console 输出量大，接回日志前必须做级别映射与节流，否则会自我放大（日志写失败 → console → 又一条日志）。建议只在开发构建开启。
3. **历史日志**：v1 文件无 `v` 字段；若用户手工编辑过 JSONL 或存在半行写入（进程被杀），读时兼容要容忍截断行并计数。
4. **分片与既有工具**：`analyze-performance-scale.mts --input` 目前吃单文件；分片后要支持目录输入，或导出时合并。
5. **权限边界**：`log:write` 目前无参数校验，渲染进程可写任意 level/module；Phase 2 加校验后需确认不会误伤插件的合法调用。
6. **决策未定**：D1/D3/D5 会影响字段与目录结构，建议评审先定这三项，再进入 Phase 0 编码。

### 落地后的状态更新（v1.0）

- **#1 已按 D1 落地**：启动时落 `userData/logs`，进入工作目录后切到 `<workDir>/logs` 并 flush 预缓冲；跨目录排障仍只能看到当前目录日志（保留为已知限制）。
- **#2 已处理**：`console-message` 仅在开发构建接回日志，并按秒节流（>20 条/秒丢弃），避免自我放大。
- **#3 已处理**：`query()` 流式逐行读取，坏行计入 `parseErrors` 而非静默忽略；半行写入不影响后续行。
- **#4 部分处理**：日志 tab 的 `exportJsonl` 会把当天全部分片合并成一份 JSONL，排障导出不受分片影响；`analyze-performance-scale.mts --input` 仍只吃单文件，直接喂目录/分片尚未支持（建议用导出文件作为输入）。
- **#5 已处理**：`write()` 对 level / message 长度 / params 大小 / 未知字段做白名单校验，插件调用经 `writeEntry` 构造后同样通过校验；回归门禁 `verify:critical` 与 `verify:plugins` 均通过。
- **#6 已关闭**：D1/D3/D5 取建议值，改造已按此执行。
- **新增已知限制**：主进程 `uncaughtException` 处理函数在写日志后按原有策略崩溃退出，串行写队列是异步的，极端情况下最后一条崩溃日志可能来不及落盘（内存缓冲与 `log:entry` 广播已同步完成）。渲染异常、Promise 拒绝、`render-process-gone` 均不受影响。**v3 P0 更新**：正常退出前已 `await LogService.drain()`；崩溃瞬间的同步落盘仍由 v3 P3 的 error 独立文件句柄解决。

### v1.1 → v3 P0 修复清单（2026-11-23）

| 缺陷（只读复核结论） | 修复 |
| --- | --- |
| 目录不可写时 `_logDir` 已赋值，预缓冲分支永远走不到，切目录又清内存缓冲 | `_activateLogDir()` 先做可写探测再赋值；失败保持 `_logDir = null` 进 pending，目标不可写回退兜底目录，`clearBuffer()` 不再清 pending |
| `accepted: true` 先返回、异步写失败无反馈 | 明确 `accepted` = 已接纳（非落盘），新增 `durable / pendingWrites / getWriteStats() / drain()`；退出前等待排空 |
| 写失败条目不重入队、flush 不重调度、订阅注册丢失 | 失败条目带 attempts 重入队 + 退避重试；桥接层逐条确认后出队；订阅注册延迟重试，窗口销毁回收 subscriber |
| 脱敏只在渲染侧，`params/meta` 可绕过 | 新增 `electron/log-redact.js`，`log:write` 主进程入口对 params/meta 二次脱敏并限大小；渲染侧与主进程口径由 C8 校验一致 |
| `level:'warn'` 静默降级、`resolveModule` 用 includes 误判 | `normalizeLogLevel()`、`resolveModule()` 改分段/驼峰边界匹配 |
| 等级阈值唯一但无运行时入口 | 监控页新增「阈值」下拉，接通 `getLevel/setLevel/subscribeLevel`，多窗口同步 |
| 门禁只做字符串存在性检查 | 新增 C8 行为用例（等级归一化、module 误判、双端脱敏、目录不可写故障注入恢复、accepted 语义、meta 上限） |

详细方案、分期任务清单与验收指标见 `observability-v3-plan.md`。
