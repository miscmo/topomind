# TopoMind 可观测性 v3 方案与任务清单

> 版本 v3.8 · 2026-11-24 · 状态：**P0–P8 全部落地，六步全量门禁通过；P8 给 Debug HUD 增加透明背景开关，并把「点击穿透」修正为真正不挡下层操作**
> 前置文档：`logging-spec-and-redesign.md`（v2，已落地的日志契约与改造路径）
> 适用：`src/shared/observability/`、`src/core/logger.ts`、`src/core/log-backend.ts`、`electron/log-service.js`、`electron/main.js`、`src/plugins/builtin/monitor/`、`scripts/verify-logging.mts`
> 性质：本文是 v2 的**增量演进方案**，不推翻 v2 的单一契约 / 单一入口 / 单一阈值 / 串行落盘 / 读时兼容五条原则。
> 配套文档：`observability-fact-uniqueness.md`（v1.0，**已实施**）—— 用户发现「选中节点产生 4 条 user 日志」后提出的采集模型架构收敛提案，P7 已按 B 档全量落地；本文 §9.37–§9.42 记录了新模型的边界与对提案的工程修正。

---

## 0. 决策记录（本轮已拍板）

| # | 决策点 | 结论 | 依据与影响 |
| -- | ---- | ---- | -------- |
| D1 | 按类分文件 vs 单文件 + `category` 字段 | **按类分文件** | 各类独立保留期、独立批量写队列、诊断包按需挑选；时序回放不依赖物理顺序，改用 `seq + traceId` 合并 |
| D2 | 「鼠标点击 xxx」等原始输入事件 | ✅ **用户确认：只进内存黑匣子，不落盘；发生 error/崩溃时把最近 50 条作为 breadcrumbs 同步 dump** | 逐事件落盘会立刻淹没可读日志并撑爆分片；排障时又必须拿得到，故用「平时不写、出事才写」 |
| D3 | 是否记文档标题 / 节点名 | **默认只记 id + 类型 + 脱敏标签**，本地可开「详细模式」 | 可读性与隐私的取舍，诊断包会带出日志内容 |
| D4 | 引入 `electron-log` / OpenTelemetry？ | **继续自建**，只借 span/trace 语义 | 现有 IPC 桥接、监控面板、性能样本反解已成型，迁移成本高于收益 |
| D5 | 日志主仓位置 | ✅ **用户确认：保持现状规范，仍放在工作目录下 `<workDir>/logs`** | 见 §0.1：不改 D1（v2 决策）的兜底与切换语义 |

新增决策（本轮补充）：

| # | 决策点 | 结论 |
| -- | ---- | ---- |
| D6 | v2 遗留缺陷与新功能的关系 | **先修 P0 可靠性与契约，再建 P1–P4 能力**；不允许在会静默丢日志的地基上「记录得更完整」 |
| D7 | 门禁策略 | 从「字符串存在性检查」升级为「结构 + 行为双检」；新增能力必须带可执行行为用例，否则不算完成 |
| D8 | P1「裸字符串 0」与 P2 迁移的关系 | **P1 冻结在 106 处且「未登记直接失败」；字面 0 作为 P2 T2.4 的验收线** | 106 处中文 action 全部已在 `LEGACY_ACTION_MAP` 登记，P1 不迁移业务调用点；冻结线只允许减少。**P2 已达成 0**（见 §7 P2 实测） |
| D9 | P3 会话状态文件放哪 | **`session.json` 固定在启动兜底目录，不随工作目录切换** | 若随工作目录写，旧目录会永远停在 `running`，下次启动必然误报崩溃；工作目录信息改用字段更新与诊断包双目录汇总 |
| D10 | `crashDumps` 目录与 D5 的冲突 | **启动期设到兜底目录并 `crashReporter.start`，进入工作目录后尽力 `setPath` 切换；`dumpRef` 同时扫两个目录** | Electron 在 `start` 之后改 `crashDumps` 不保证对后续 dump 生效，双目录扫描是可靠兜底 |
| D11 | 恢复报告的 breadcrumbs 从哪来 | **优先复用上次 error 日志已 dump 的原始输入，不足时用上次会话已落盘的语义事件轨迹补齐** | D2 规定原始输入只进内存，进程被杀后无法找回；这样既不违反 D2，又能保证恢复报告有 ≥20 条上下文 |
| D12 | 日志分片 / 查询 / 导出的日期口径 | **一律按「用户本地日」**：渲染侧 `logContract.logDayKey()`，主进程 `_dateStr()` 同口径；日志链路禁止 `toISOString().slice(0, 10)` | UTC+8 的 00:00–08:00 用 UTC 日期会去读前一天的空目录，表现为「当天的日志一条都查不到、回放是空的」。P4.5 实测让 C7/C8/C9/C11/C12 整组误报 25 项；现由 C12 静态 + 独立实例行为双断言冻结 |
| D13 | 五视图的数据变换放哪 | **抽成 `src/shared/observability/logViewModel.ts` 纯函数层，UI 与门禁 C12 共用同一份实现** | 避免「UI 一套排序/分组、门禁另一套」导致回放与断言各说各话；纯函数不依赖 React / DOM / Electron，Node strip-types 可直接加载 |
| D14 | 10 万条/日查询怎么达标 | **分片行偏移索引 + 查询计划缓存 + 按偏移随机读目标行**；索引 `exact=false`（CRLF / 末行缺换行 / 外部改写）自动回退原流式路径 | 保持 `total / parseErrors / timestamp+seq` 稳定序语义完全不变；缓存 key 带每个分片 `size:mtimeMs`，外部编辑立即使旧 plan 失效；写入成功后增量追加索引，不重建全量 |
| D15 | 事件覆盖率表用什么口径 | **严格口径**：逐 id 扫描业务源码静态引用，零引用必须补真实埋点或书面登记「保留未启用」并写明理由；禁止用「单点拦截会产生」批量豁免 | 宽泛口径初版把 5 个真实缺口判成已覆盖。严格口径下补齐 `plugin.activate/deactivate`、`user.node_click`、`user.tab_close/switch` 的真实产生点，最终 97 条 = 96 已接入 + 1 保留（`store.call`）+ 0 未确认；表内明示「静态引用 ≠ 运行时必然产生」 |
| D16 | 真实埋点怎么共享 traceId | **引入惰性「交互窗口」**（`startInteraction` / `getCurrentTraceId`，按时间戳过期、不建定时器），用户事件与 `observeOperation` 开启窗口；`traceId` 改三态：显式值 / 跟随窗口 / 显式 `null`=独立事件 | `withTraceId` 是同步 try/finally，`await` 后必复位，覆盖不了「点击 → 异步 IPC → 渲染」。P4 的 106 处 `logAction` 因此各自生成 `renderer:*` trace，事件流退化成单条卡片。窗口落在契约层，106 处调用点一处不改即可成链；`null` 保证周期聚合不被硬塞进最近一次点击而伪造因果 |
| D17 | 事件流怎么呈现没有链路的日志 | **操作链与独立事件分区**：≥2 条共享 trace 才渲染成操作卡（带触发/内部/耗时/结果阶段与结果徽标）；单条或无 trace 合并为「独立事件」紧凑区块并明确标注，不伪装成一次操作 | 主进程生命周期、60s 聚合审计、无显式作用域的历史日志本就不属于任何用户操作；把它们画成「一次操作」是误导。回放仍按时间推进，但叙事单位已变成操作链 |
| D18 | Debug 模式的日志窗口用什么形态 | **应用内 `fixed` 浮层 HUD（`--z-debug-hud: 9000`，高于标题栏菜单 3001、低于全局模态 10000），不新建 `BrowserWindow`** | 主进程 `log:entry` 广播写死 `win.webContents.send(...)`，独立窗口收不到推送，必须改订阅模型；浮层零新增 IPC 即可复用 `logSubscribe`，自动跟随主题与主窗口最小化，也不会残留在别的应用之上。代价：**不是 OS 级置顶**，切到别的应用或最小化后不可见；若将来要跨应用置顶，需新建窗口 + 主进程按订阅者广播（见 §9.33） |
| D19 | Debug HUD 的数据边界 | **只订阅、不写日志；内存环形 300 条；实时流 80ms 合帧；详细模式默认关；开关与 UI 偏好持久化到 `localStorage`** | HUD 若回写日志会形成 `log:write → log:entry → HUD → log:write` 自放大；上限把渲染成本与落盘彻底解耦；详情默认关避免屏幕上直接暴露 params；持久化尊重用户主动开启的透明化诉求，但浮窗与菜单都保留常驻关闭入口 |

| D20 | 过程步骤是否默认不落盘（P7） | **A 默认不落盘 + 按需 dump**（D2 的一般化） | 用户拍板 B 档全量实施时选定。「selectNode 被调用」「对话框打开」「store 写回」这类过程痕迹平时没人看，出事时又需要，与原始鼠标输入同构；全量落盘是「一次点击 4 条 user 日志」的直接成因 |
| D21 | 状态变更由谁产生（P7） | **A store 中间件自动观测**，但修订为「只写内存步骤，不额外落盘 `state.change`」 | P7.3 后每个状态变更已有唯一落盘结果事实；再写一条 `state.change` 会变成「一次变更两条日志」，与事实唯一性冲突，也会让多个 store 的高频更新重新变成噪声。见 §9.39 |
| D22 | 是否接受「1 条落盘记录 = 1 次交互」改变查询/回放语义（P7） | **A 接受并改造视图** | 事件流、详情面板、Debug HUD 增加步骤摘要与 dump 展开；历史日志读时兼容，无 `stepCount` 就是 0 |
| D23 | 实施节奏（P7） | **B 先 P7.1+P7.2 止血，再按阶段推进** | A 档风险低、见效快，且无论最终是否重构都不白做；用户按此顺序批准 |
| D24 | 事实归属如何强制（P7） | **显式 `kind` 分类 + owner/cardinality 登记 + `dedupeKey` 短窗兜底**，禁止靠 action 前缀猜 | 前缀推断把 `node.` 的状态写回也算成用户意图；三重机制分别管「分类」「产生点」「漏网重复」 |
| D25 | Debug HUD 如何「一定程度透明、尽量不挡操作」（P8） | **标题栏加可勾选「透明背景」按钮**：半透明表面 + root 级真穿透联动 + 控制条悬停时临时恢复不透明；透明态单档、不做多档滑杆 | 只做背景变淡并不能让下层可点；只给日志列表设 `pointer-events:none` 时带背景的浮层父容器仍会截获点击（P6 的穿透是「半穿透」）。把视觉与命中测试一起处理，才真正兑现「少挡操作」；悬停恢复解决半透明底上日志读不清 |

### 0.1 D5 的影响（必须写清楚，避免后续实现漂移）

保持现状意味着**不把主仓搬到 `userData`**，因此：

1. 启动期仍先落 `app.getPath('userData')/logs` 作为兜底，进入工作目录后切到 `<workDir>/logs` 并 flush 预缓冲；`leaveWorkDir` 回兜底目录且不清队列。这套语义（v2 D1）**原样保留**，P0 只修「目录不可写时这条链路会丢日志」的缺陷。
2. 按类分文件落在**当前工作目录内**：`<workDir>/logs/YYYY-MM-DD/{category}.log`，超过 10 MB 轮转为 `{category}.N.log`（`category` ∈ `user / internal / performance / error`）。启动兜底目录同样按此结构，切换时一并 flush。
3. **已知限制仍然成立**：切换工作目录后监控页只能看到当前目录的日志，跨目录排障需要切换查看或导出。补偿措施：
   - 每条日志带 `workspaceId`（工作目录路径的短哈希，不落明文路径）；
   - 一键诊断包同时汇总「当前工作目录 logs + 兜底目录 logs」中同 `sessionId` 的条目；
   - 监控页提供 session 选择器，不按物理目录组织叙事。
4. 拷走工作目录会同时带走日志——这在 D5 下是**特性**而非缺陷：排障上下文与用户数据同处一地，离线交付诊断包更简单；代价是日志随用户目录删除而消失，因此诊断包必须可手动导出。

---

## 1. 目标与非目标

**核心目标**

1. **软件运行事件透明化**：用户动作与软件内部响应都能以「一条可解释的因果链」回放，而不是几万条鼠标事件噪音。
2. **性能监控分析**：慢样本能反查到触发它的用户事件与内部 span。
3. **bug 与异常挖掘、崩溃监控**：错误全量、带上下文、带指纹聚合，崩溃前有面包屑、崩溃后有恢复报告。

**非目标**

- 不做远程上报 / 云 APM（沿用 v2 D8；授权、脱敏、离线队列需单独立项）。
- 不做完整分布式追踪系统；只借 `traceId / spanId / parentId` 的语义，在单机 Electron 三进程内闭环。
- 不重做监控页视觉设计；P4 是在现有组件体系上加视图与控制条。

---

## 2. 总模型：四类日志拼成一条因果链

`category` 提升为**一级字段**，每条日志必须且只能属于一类。四类靠同一组关联键串成一次操作的完整叙事：

| 关联键 | 含义 | 生成方 |
| ---- | ---- | ---- |
| `sessionId` | 一次应用启动到退出 | 主进程（启动即生成） |
| `traceId` | 一次用户操作（跨渲染→主进程→异步回调） | 采集层，显式 `withTraceId` 作用域；禁止每条日志现生成 |
| `spanId` / `parentId` | 内部步骤与父子关系 | 拦截层（IPC / 命令 / 插件生命周期） |
| `seq` | 会话内单调递增序号 | 主进程，解决同毫秒乱序 |

| 类别 | 回答的问题 | 采集策略 | 必填字段 | 保留期 |
| ---- | -------- | -------- | -------- | ---- |
| `user` | 用户做了什么 | **语义动作全量**；原始输入只进内存（D2） | `target{type,id,label}`、`view`、`from→to`、`result`、`inputMode` | 30 天 |
| `internal` | 软件因此做了什么 | 状态迁移全量；定时任务按类型聚合；高频 hook 采样 | `source(layer)`、`channel/cmd/hook`、`span+duration`、`outcome` | 14 天 |
| `performance` | 花了多久 | 沿用现有 21 指标 / 6 category 的 `sampleRate` + `minIntervalMs` | `metric`、`durationMs`、`success`、`thresholdMs`、`traceId` | 14 天 |
| `error` | 哪里断了 | **全量且同步落盘**（P3 已落地） | `error{name,message,stack}`、`fingerprint`、`breadcrumbs`、`dumpRef`、`env` | 90 天 |

预留 `audit`（权限拒绝、外链、IPC 白名单拒绝），先不启用。

**v2 兼容**：不重写历史文件；`categoryFromLegacy(entry)` 按 `level === 'ERROR'` / `action === 性能:记录` / `module === 'plugin'` / `LOG_ACTION_META` 推断，缺失字段在查询与订阅时补齐。`v` 从 2 升到 3 时同样走读时兼容。

---

## 3. 可读性：事件目录 + 三层文本

建 `EVENT_CATALOG` 单一注册表，每条事件定义：

```
id / category / label(中文) / level / 字段 schema / 保留期 / 采样 / 说明 / 示例 / owner
```

由它**自动生成** TS 类型、UI 筛选器、中文标签与门禁规则。现有 `LOG_ACTIONS`（50+ 条）与 `PERFORMANCE_METRICS` 通过适配器归入，不推倒重来。每条日志输出三层：

- `label`：人读的动作名（「打开笔记」「关闭知识库标签页」）；
- `message`：模板化一句话摘要（「用户在图谱页打开文档 `doc:xxx`，耗时 42ms，成功」）；
- `params`：结构化、可展开、已脱敏的原始上下文。

门禁从「未登记记 WARN」升级为「未登记直接失败」；v2 遗留的 106 处中文 `logAction` 已全部登记在兼容映射中，P1 冻结数量、**P2 用可复现脚本 `npm run migrate:actions` 一次性迁到规范 id，C10 把冻结线收紧到 0**（D8）。同时修掉两处 v2 门禁漏检的动态中文 action（`CanvasMiniMap` 三元表达式、`documentTypeRegistry.createLogName` 变量），后者已强类型化为 `LogActionId`。`LEGACY_ACTION_MAP` 保留，仅供旧日志与插件 API 兼容。

---

## 4. 采集：三层 + 单点拦截

1. **语义化用户事件**（打开笔记、点击节点 xxx、关闭知识库 tab、打开文档…）全量落盘，统一带 `target / from→to / result`。这是「透明化」的主体，按事件目录逐项核对覆盖率。
2. **原始输入黑匣子（D2）**：`pointerdown / keydown / scroll / wheel` 逐事件数据只进 2000 条内存环形缓冲，**不落盘**；一旦发生 error 或崩溃，把最近 50 条作为 `breadcrumbs` 同步 dump 到 error 日志。平时零磁盘成本，排障时能回答「崩之前点了什么」。
3. **内部事件靠拦截，不靠到处埋点**：

| 拦截点 | 覆盖 | 记录内容 |
| ---- | ---- | ---- |
| `preload.invoke` | 82 个 IPC 通道 / 83 个 `ipcMain.handle` | channel、耗时、结果、透传 traceId（P2 已落地） |
| `fs-backend._call` | 存储层调用 | **不单独包装**——它最终也走 `preload.invoke`，两处都包会重复记一次 IPC |
| `commandRegistry.execute` | 命令 | commandId、来源、耗时、结果 |
| 插件 `activateOnce / deactivate / lifecycle.setState` | 插件状态机 | pluginId、reason、状态迁移 |
| app 生命周期 / `before-quit → close-guard → drain` | 启动退出 | session 开始/结束、是否干净退出 |
| 定时器 / debounce / 轮询 | 定时任务 | `schedule → run → done` 成对 span，按分钟聚合，不逐 tick 写盘 |

现状盘点结论（P2 前）：**83 个 IPC handler 零调用审计、所有定时器与关闭链路成功路径零日志、插件生命周期状态机全静默、无 `crashReporter` 且无「上次会话异常退出」检测**。P2 已补齐前三项，P3 已补齐崩溃闭环（`crashReporter` + `session.json` 恢复检测 + error 同步落盘 + 诊断包）。

---

## 5. 崩溃监控（P3 已落地）

| # | 设计 | 落地实现 |
| -- | ---- | ---- |
| 1 | `crashReporter.start({ uploadToServer: false })` + 本地 `crashDumps` 目录 | `electron/main.js` 模块顶层在 `app.whenReady()` 之前 `setPath` + `start`；进入工作目录后尽力切换路径（D10） |
| 2 | `error` 类独立文件句柄 + `appendFileSync` | `electron/log-service.js` 的 `_writeErrorSync()`：`write()` 返回 `durable:true` 仅当同步写成功；失败降级到预缓冲重试，不与异步批量队列混写同一分片 |
| 3 | `session.json` running / clean / crashed + 恢复报告 | 文件**固定在启动兜底目录**（D9）；`requestSafeQuit` 在 `drain()` 之后写 `clean`，`uncaughtException` 写 `crashed`；下次启动检测 `running` 生成 `app.crash_recovered`（同步落盘，带上一次会话尾部事件） |
| 4 | `fingerprint` 聚合 | `_fingerprint()` = FNV-1a(name + 归一化 message + 栈顶业务帧)，`fp-xxxxxxxx`；诊断包按指纹输出 `count / lastSeen / sample` |
| 5 | 一键诊断包 | `exportDiagnosticBundle()` 产出 `topomind-diagnostic-bundle/1` JSON：四类日志（每类上限 200 条）、指纹聚合、dumpRef / env / session / writeStats、当前与兜底双目录的 error；导出前对 `params/meta/target/error/label` 二次脱敏并由 UI 弹窗提示 |

**error 专属字段**（契约 `LogEntry`）：`fingerprint / breadcrumbs / dumpRef / env`，全部由主进程生成，渲染侧传同名字段会被 `_validateEntry` 丢弃，无法伪造。

**黑匣子链路（D2）**：渲染侧 `src/core/blackbox.ts` 采集 `pointerdown / keydown / scroll / wheel` 到 2000 条内存环形缓冲，每 500ms 或满 20 条经 `log:breadcrumbs` **send** 通道镜像到主进程内存；只有写 error 日志或生成恢复报告时才把最近 50 条同步 dump。不落盘、不写 console、不走 invoke（避免 preload IPC 审计自放大）。

---

## 6. 存储与 UI

**存储**：`<workDir>/logs/YYYY-MM-DD/{category}.log` + `{category}.N.log` 分片（10 MB）；各类独立保留期与独立批量写队列（顺带解决 v2「每条日志一次 appendFile」）。逻辑回放靠 `timestamp + seq + traceId` 合并，不依赖物理顺序（P1 已落地）。

**UI**：monitor 从现有 3 tab 扩成 **5 个语义视图 + 原始日志底栏**（6 个 tab），P4 已落地：

| 视图 | 内容 | 实现 |
| ---- | ---- | ---- |
| 事件流 `timeline` | **P5 修正后**：≥2 条共享 trace 才是「一次操作」卡（触发 → 内部 → 耗时 → 结果，带结果徽标与阶段标签），单条/无 trace 合并为「独立事件」区块并明确标注；按 session 分组、可逐步回放 | `TimelineView.tsx` + `groupBySession / groupByTrace / replaySteps`；`TraceGroup.isChain / independent / outcome` |
| 内部链路 `spans` | `parentId → spanId` 建树的 span 瀑布，深度缩进 + 耗时条，与事件流联动 | `SpanView.tsx` + `buildSpanTree / flattenSpanTree` |
| 性能 `performance` | 现有图表；慢样本可按 `traceId` 反查「触发它的用户事件」并跳回事件流 | `PerformanceTab.tsx` + `focusTrace()`，`LogQueryInput.traceId` 全链路透传 |
| 异常与崩溃 `errors` | 按 `fingerprint` 聚合、恢复报告、breadcrumbs、dumpRef / env、同指纹样本、诊断包导出 | `ErrorView.tsx` + `groupErrorsByFingerprint / findRecoveryReports / flattenBreadcrumbs` |
| 插件诊断 `plugins` | 保留现有面板 | `PluginDiagnosticsPanel.tsx` |
| 原始日志 `log` | 保留原 FilterBar / LogList / DetailPanel 底栏，作为一切视图的取证入口 | 不删旧能力，避免「视图好看但查不到原始行」 |

所有视图共享顶部 `ControlBar`：等级阈值、session 选择、详细模式、显示采样率、实时流、回放控制、trace 清除。`FilterBar` 只保留本视图内的关键词 / 日期 / 类别 / 等级 / 导出，不再重复控制主进程状态。显示采样只影响 UI 呈现，不改变落盘与 `total`。

**实时 Debug HUD（P6 新增，独立于 monitor）**：应用菜单「帮助 → Debug 模式」或 `Ctrl+Shift+D` 开关，开启后在软件最顶层出现可拖动、可缩放的小浮窗，一条条实时滚动展示日志（时间 / 级别 / 类别 / 描述 / 耗时 / trace 短码）。定位是**实时示波器**，不是历史回放：需要因果链、崩溃分析、全量检索时点浮窗的「打开完整系统日志」跳到 monitor。实现位于 `src/features/debug/{DebugHudHost,DebugHud,debugStore,debugLogBuffer}.ts(x)`。

| 维度 | 设计 |
| ---- | ---- |
| 数据 | 开启时 `logGetBuffer()` 补最近历史 + `logSubscribe()` 接实时流，80ms 合帧批量渲染；关闭时 `logUnsubscribe()` |
| 边界 | 内存环形 300 条，**不落盘、不写日志、不进主进程缓冲**；「清空」只清显示，磁盘日志不动 |
| 交互 | 拖动 / 右下角缩放 / 折叠成胶囊 / 暂停定格 / 自动滚动 / 类别与级别 chips / 关键词 / 点击穿透 / 复制可见日志 / 跳监控页 |
| 隐私 | 详细模式（展开 params / error）默认关；标题栏提示浮窗可能显示路径与文档标题，截图需注意 |
| 透明背景（P8） | 标题栏「透明」按钮：半透明表面（`--debug-hud-translucent-*`，三套主题各一份）+ 自动联动 root 级真穿透；鼠标移到标题栏 / 过滤条时临时恢复不透明便于阅读，移开后继续半透明；透明态日志行加文字描边保证对比度 |

---

## 7. 分期路线与任务清单

### P0 — 地基修复与契约加固（本轮实施）

| # | 任务 | 主要文件 | 状态 |
| -- | ---- | ---- | ---- |
| T0.1 | 整理本方案与任务清单 | `docs/design/observability-v3-plan.md` | ✅ 已完成 |
| T0.2 | 目录不可写不再丢日志；写失败有限重试；`accepted` 语义与 `drain()`；订阅者清理；退出前等待落盘 | `electron/log-service.js`、`electron/main.js` | ✅ 已完成 |
| T0.3 | 预缓冲 flush 失败重调度、订阅注册延迟重试、等级主动拉取 | `src/core/log-backend.ts`（等级同步在桥接层完成，未改 `logger.ts`） | ✅ 已完成 |
| T0.4 | level 大小写归一化、`resolveModule` 精确匹配、主进程入口统一脱敏（params/meta 二次脱敏 + 大小上限） | `logContract.ts`、新增 `electron/log-redact.js`、`main-log.js` | ✅ 已完成 |
| T0.5 | 运行时等级切换 UI 与多窗口同步；修搜索词原样入日志 | `plugins/public/api.ts`、`pluginPermissions.ts`、`pluginContext.ts`、`bootstrap.ts`、`FilterBar.tsx` | ✅ 已完成 |
| T0.6 | 门禁补行为用例（C8）并跑全量验证 | `scripts/verify-logging.mts` | ✅ 已完成 |
| T0.7 | 修订 v2 文档状态说明（字段字典 `v`、logAction 签名、「已落地」措辞） | `docs/design/logging-spec-and-redesign.md` | ✅ 已完成 |

**P0 验收**：故障注入下「日志目录不可写 → 恢复可写 → 启动期日志仍完整落盘」；写失败条目在重试后落盘率 100%；`accepted` 与真实落盘状态可通过 `drain()` 核对；监控页切换等级后所有窗口同步且 DEBUG 可见；脱敏行为用例覆盖 `newKeyword` / 绝对路径 / `meta` 超限；`npm run verify:logging` + `typecheck` + `verify:critical` 全绿。

**P0 实测结果（2026-11-23）**：`node scripts/verify-all.mjs` 六步 `ALL_VERIFY_PASSED`（design / typecheck / critical / plugins / logging / lint-baseline）；`verify:logging` **3244 checks**，其中 C8 覆盖等级归一化、`resolveModule` 误判、渲染侧与主进程脱敏逐字一致、目录不可写故障注入恢复、`accepted/durable` 语义、`meta` 8KB 上限；裸 console `src=37 / electron=16`（比基线少 2）。过程中修掉两个新引入的回归：`text-[12px]` 触发设计系统按次基线；flush 重试定时器在 Node 回归脚本里形成永动定时器（加 `window` 早退 + 20 次上限）。

### P1 — 分类契约与事件目录（本轮实施，已完成）

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T1.1 | `category` 一级字段 + `sessionId / seq / spanId / parentId` + `workspaceId`（短哈希）+ `label/target/result/source/outcome/durationMs` | `logContract.ts` v3（`LOG_SCHEMA_VERSION = 3`）、新增 `session.ts`、`trace.ts` 改门面 | ✅ 已完成 |
| T1.2 | `EVENT_CATALOG` 注册表 + 类型/标签/筛选器/门禁自动生成 | `eventCatalog.ts`（78 个事件）、`scripts/gen-event-types.mts`、`eventTypes.generated.ts`、`electron/log-categories.generated.js`、`npm run gen:events` | ✅ 已完成 |
| T1.3 | `LOG_ACTIONS` / `PERFORMANCE_METRICS` 适配器 + `categoryFromLegacy()` 读时兼容 | 主进程 `_normalizeReadEntry` 与 `monitorStore.normalizeLogEntry` 两路补齐 | ✅ 已完成 |
| T1.4 | 按类分文件 + 分级保留期 + 独立批量写队列 | `log-service.js`：`<workDir>/logs/YYYY-MM-DD/{category}[.N].log`、每类串行批量 append、分级清理、跨类按 `timestamp+seq` 合并 | ✅ 已完成 |
| T1.5 | 门禁：事件目录登记率 100%、未登记直接失败、行为用例 | `verify-logging.mts` 新增 C9；C7/C8 对齐 v3；类别筛选与详情关联键进 UI | ✅ 已完成 |

**P1 验收实测（2026-11-23）**：
- `node scripts/verify-all.mjs` 六步 **`ALL_VERIFY_PASSED`**；`verify:logging` **3504 checks**（C9 覆盖事件目录自检、生成产物逐字一致、读时归类、v3 字段与 D3 脱敏、trace/span 作用域、四类独立落盘、50 条批量写、跨类时间序合并、categories 过滤、v1 平铺文件读时兼容、分级保留期）。
- 事件目录登记率 **100%**（57 个 action + 21 个性能指标 = 78 条，无未登记项）；老日志读时归类用例 5/5 正确。
- 中文 action 冻结在 **106** 处（D8），P2 迁移后收紧到 0。
- **未达标项**：「10 万条/日下查询 P95 < 300 ms」不在 P1 完成——跨类合并目前全量收集匹配条目后排序，单类筛选走流式快速路径；索引/倒序早停留 P4（见 §9.9）。

### P2 — 单点拦截与 action 迁移（本轮实施，已完成）

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T2.1 | 契约扩展 17 个语义化事件 id（`ipc.* / plugin.* / app.* / timer.* / user.*`）+ 分类前缀；新增观察层 | `logContract.ts`（`withSpanContext` 支持异步 span 恢复）、`src/core/observe.ts`（`recordInternal / recordUser / observeOperation / createTimerAudit / auditInterval`）、事件目录 95 条 | ✅ 已完成 |
| T2.2 | `preload.invoke` 单点审计覆盖 82 个业务通道 | `electron/preload.js`：排除 `log:*` 防自放大、正常调用按 60s 窗口聚合为 `ipc.audit`、失败/慢调用即时 `ipc.invoke` 明细、`setTraceContext` 跨进程透传 traceId；`fs-backend._call` 不再重复包装 | ✅ 已完成 |
| T2.3 | 命令 / 插件 / app / 关闭链路 / 定时器埋点 | `commandRegistry.execute`（16 个命令，host+plugin 两条路径收敛）、`pluginLifecycle.setState`、`main.js` 六处生命周期 + `quit.approved` 在 drain 之前写、TabBar 1s / learningTracker 1s+60s / saveCoordinator 300ms 三处按分钟聚合 | ✅ 已完成 |
| T2.4 | 106 处中文 `logAction` 迁到规范 id，冻结线清零 | `scripts/migrate-legacy-actions.mts`（`npm run migrate:actions`，幂等、未映射即报错）；29 个文件 106 处替换；动态两处单独收口；`logAction` 单点补齐 v3 `target / result` | ✅ 已完成 |
| T2.5 | 语义化用户事件补齐 + 门禁行为用例 | `tabActions`（视图/首页/监控/统计）、`DetailPanel`（打开文档）、`RoomOverview`（进入房间）、节点点击与 tab 关闭/切换补真实 target；`verify-logging.mts` 新增 **C10** | ✅ 已完成 |

**P2 验收实测（2026-11-23）**：
- `verify:logging` **3583 checks** 全绿。C10 覆盖：中文裸字符串冻结线 = 0、preload 排除 `log:*` 防自放大、失败调用即时明细、跨时间窗聚合、traceId 透传、一次操作 1 trace + 根/子 span 层级、用户事件 `target/result/trace` 三件套、定时任务窗口内零落盘、失败类 action 自动归 `error` 且 `result=failure`。
- **关键用户动作覆盖**：命令执行、视图/首页/监控/统计切换、打开文档、双击进入房间、点击节点、tab 关闭/切换、知识库打开、房间导航、文档创建/保存/重命名/删除等均有语义化事件；命令层与 store 层双入口覆盖，避免只点 UI 才记。
- **用户事件三件套齐全率 100%**（`logAction` 单点补默认 `target/result`，`buildLogEntry` 补 trace；关键动作传真实 target）。
- **IPC 审计覆盖率 100%**：82 个业务 invoke 通道全部经过 `preload.invoke`；`fs-backend._call` 不再二次包装，同一次 IPC 只记一次。
- **未达标/取舍**：「按事件目录逐项核对覆盖率 100%」是人工核对表，本轮未产出逐项勾选清单；「10 万条/日查询 P95 < 300 ms」仍留 P4（§9.9）。

### P3 — 崩溃闭环（本轮实施，已完成）

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T3.1 | 契约 error 专属字段 + 事件目录 + 渲染侧黑匣子 | `LogEntry` 新增 `fingerprint/breadcrumbs/dumpRef/env`；新增 `app.crash_recovered / app.diagnostic_export`（目录 97 条）；`src/core/blackbox.ts` + `main.tsx` 安装 | ✅ 已完成 |
| T3.2 | error 同步落盘 + 崩溃上下文 + 黑匣子镜像 | `log-service.js` 的 `_writeErrorSync / _dispatchEntry / _enrichErrorEntry / pushBreadcrumbs`；`log:breadcrumbs` send 通道；`durable` 语义 | ✅ 已完成 |
| T3.3 | `crashReporter` + `session.json` + 恢复报告 | `main.js` 顶层 `setPath/start`（无远程上报）、`child-process-gone`、`markSessionClean/Crashed`；`app.crash_recovered` 同步落盘 | ✅ 已完成 |
| T3.4 | 一键诊断包与导出链路 | `log:exportBundle` 四处同步（preload / main / log-backend / 插件 API）；`FilterBar` 新增「诊断包」按钮 + 二次确认；`monitorStore` 保留 4 个字段 | ✅ 已完成 |
| T3.5 | 门禁行为用例、全量验证与文档回填 | `verify-logging.mts` 新增 **C11**（结构 + 7 组行为用例） | ✅ 已完成 |

**P3 验收实测（2026-11-23）**：
- `verify:logging` **3649 checks** 全绿。C11 覆盖：error 未 `drain` 即落盘且 `durable:true`（非 error 仍 false）、25 条面包屑 ≥20 且不单独落盘、`fp-xxxxxxxx` 稳定且不同消息不误并、`dumpRef` 引用本地 minidump、`env` 带版本、诊断包四类日志 + 指纹聚合 + 二次脱敏 + 双目录、`session.json` running → 恢复报告 → clean 不误报、渲染侧黑匣子只走 send 且控件文案脱敏。
- **崩溃事件 100% 带 ≥20 条 breadcrumbs 与 dumpRef**：error 日志与 `app.crash_recovered` 均由主进程统一补全；恢复报告在演练用例中带 50 条（上限）与 `tailCount ≥ 20`。
- **未达标项**：`error` 类同步写失败时的降级路径只做静态与统计断言，未做真实磁盘满/只读注入（见 §9.21）；「异常与崩溃」视图（指纹分组 UI / 回放）留 P4。

### P4 — 五视图与回放（本轮实施，已完成）

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T4.1 | 统一控制条 + 五视图骨架 + 原始日志底栏 | `ControlBar.tsx`、`Sidebar.tsx` 重写为 6 tab、`MonitorPage.tsx` 编排；`monitorStore` 扩 6 个视图状态与 `focusTrace()` | ✅ 已完成 |
| T4.2 | 视图数据层（纯函数）+ 事件流 / 内部链路 | `logViewModel.ts`（排序/过滤/采样/trace/session 分组/span 树/回放步）、`TimelineView.tsx`、`SpanView.tsx` | ✅ 已完成 |
| T4.3 | 异常与崩溃视图 + 性能慢样本反查用户事件 | `ErrorView.tsx`、`bundleExport.ts`、`PerformanceTab.tsx`；`LogQueryInput.traceId` 经 log-backend / bootstrap 透传到主进程；`queryAllLogs` 分页上限 50 → 200 页 | ✅ 已完成 |
| T4.4 | 查询行偏移索引与分页缓存（10 万条 P95） | `log-service.js`：`_buildFileIndex / _appendIndexRecords / _matchesIndex / _buildQueryPlan / _readIndexedEntries / _queryStream` + `getQueryStats()`；缓存 key 带分片 `size:mtimeMs` | ✅ 已完成 |
| T4.5 | 事件目录逐项覆盖率核对表 + C12 门禁 | `scripts/gen-event-coverage.mts`（`npm run gen:coverage`）、`docs/design/event-coverage.md`；`verify-logging.mts` 新增 **C12**；补齐 5 个真实零引用事件 | ✅ 已完成 |
| T4.6 | 全量验证、日期口径修复、文档回填与交付 | D12 本地日期口径统一（`logDayKey`）；C12 增静态 + 独立实例行为双断言；本文升 v3.4 | ✅ 已完成 |

**P4 验收实测（2026-11-24）**：
- `verify:logging` **3761 checks** 全绿；六步 `node scripts/verify-all.mjs` **`ALL_VERIFY_PASSED`**。C12 覆盖：视图模型纯函数（时间序 / 采样 / 过滤 / span 树 / 错误指纹 / 回放步）、五视图与控制条结构、覆盖率表与磁盘产物逐字一致、索引的 `total / 时间序 / keyword / traceId / sessionId / 增量追加 / 坏行 / CRLF 回退 / 缓存命中`、10 万条查询 P95、D12 日期口径。
- **查询性能达标**：4 类 × 25 000 条 = 10 万条 fixture，`categories:['user']` 首页 `total = 25 000`、`parseErrors = 0`、时间序正确、分页不再重复全量解析（`hits ≥ 5`、`fallbacks = 0`）；独立探针冷启动建索引约 225 ms、稳定态 6.9–11.1 ms，正式门禁按 P95 < 300 ms 断言。
- **事件覆盖率严格口径**：`docs/design/event-coverage.md` 共 **97 条事件 = 96 已接入 + 1 保留未启用（`store.call`）+ 0 未确认**。严格口径不允许用「单点拦截会产生」豁免，倒逼补出 `plugin.activate / plugin.deactivate`（`pluginLifecycle.setState` 按状态选语义 id）、`user.node_click`、`user.tab_close / user.tab_switch` 的真实产生点。
- **过程中修掉的关键缺陷（D12）**：门禁与诊断包文件名曾按 UTC 取「今天」，UTC+8 凌晨会读到前一天的空目录，一次性让 C7/C8/C9/C11/C12 误报 **25 violations / 3726 checks**。最小复现确认服务与渲染侧本来都用本地日期，问题只在取日期键的写法；现统一到 `logDayKey()`，C12 同时校验「日志链路无 UTC 切片」「主进程 `_dateStr` 用 `getFullYear()`」「独立实例创建的日期目录 == 本地日」。
- **未达标项**：`docs/design/event-coverage.md` 是**静态引用核对表**，不能证明运行时 100% 产生；真正的运行时覆盖率仍需真机走查或运行时埋点自检（见 §9.24）。
- **P4 的自查遗漏（由 P5 修正）**：C12 用手工构造的、自带共享 `traceId` 的 fixture 验证 `groupByTrace`，所以「分组逻辑正确」全绿，却没发现真实埋点里每条 `logAction` 都各自生成 `renderer:*` trace，事件流实际退化成一条条独立日志。这正是 D7 想避免、却又以新形式复现的「门禁造的数据太理想」问题。

### P5 — 事件流真正成链（用户反馈后修正，已完成）

起因：用户指出「事件流看起来还是一条条独立的日志消息」。核对后确认不止是观感问题，而是数据层缺陷。

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T5.1 | 契约层交互窗口 + traceId 三态 | `logContract.ts`：`INTERACTION_TTL_MS=2000`、`startInteraction / endInteraction`、改写 `getCurrentTraceId()`、`buildLogEntry` 三态 | ✅ 已完成 |
| T5.2 | 拦截层共享 trace、周期事件显式独立 | `observe.ts`（`recordUser` / `beginOperation` 开窗口、`recordInternal` 三态、timer 聚合 `traceId:null`）、`logger.ts`（`writeEntry` 三态透传）、`preload.js`（`ipc.audit` 聚合不带 trace） | ✅ 已完成 |
| T5.3 | 视图区分操作链与独立事件 | `TimelineView.tsx`：`IndependentList`、`stageOf` 阶段标签、结果徽标、链内竖线层级；`logViewModel.ts`：`isChain / independent / outcome` | ✅ 已完成 |
| T5.4 | 真实链路行为门禁 | `verify-logging.mts` 新增 **C13**：直接驱动真实拦截层捕获日志，断言成链、分组、周期独立、窗口过期、契约三态、视图结构；C10 补 preload 聚合独立断言 | ✅ 已完成 |
| T5.5 | 全量验证与文档回填 | 六步门禁、本文升 v3.5、D16/D17、§9 新限制、工作日志 | ✅ 已完成 |

**P5 实测（2026-11-24）**：`verify:logging` **3780 checks**（P4 3761 → P5 +19）；`node scripts/verify-all.mjs` **`ALL_VERIFY_PASSED`**。C13 关键断言：`recordUser('user.node_click') → logAction('document.open') → recordInternal('ipc.invoke')` 三条真实日志共享同一 traceId、`groupByTrace` 得到 **1 组 3 条**（而非 3 个单条组）、用户事件为链根且 traceId 镜像到 preload、timer 聚合与 `ipc.audit` 不带 traceId、窗口过期不误归。

**P5 的边界**：交互窗口是「最近一次用户交互」的近似关联，不是严格因果证明；它只传播 traceId，不伪造 span 父子关系（span 树仍只由 `observeOperation` 生成）。见 §9.29–§9.32。

### P6 — 实时 Debug HUD（菜单入口，已完成）

起因：用户提出「窗口菜单下拉列表中增加 debug 模式，开启后在软件最顶层出现一个小的日志窗口，里面展示一条条的日志」，并说明想法未全面、授权补全方案。补全结果固化为 D18 / D19：形态选应用内浮层而非独立窗口，数据侧严格只读不回写。

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T6.1 | 状态与缓冲纯函数层 | `debugStore.ts`（开关 / 位置 / 尺寸 / 过滤 / 暂停 / 穿透，localStorage）、`debugLogBuffer.ts`（裁剪 / 乱序归位 / 过滤 / 摘要 / 截断，UI 与 C14 共用） | ✅ 已完成 |
| T6.2 | HUD 浮层组件 | `DebugHud.tsx`：实时日志行、色标、耗时、trace 短码、展开详情、拖动与缩放、折叠、暂停、过滤、点击穿透、复制、跳监控页 | ✅ 已完成 |
| T6.3 | 菜单 / 命令 / 层级 / 挂载 | `CustomTitleBar.tsx`（可勾选项 + 快捷键）、`commandRegistry.ts`（`debug.toggle`）、`tokens.css`（`--z-debug-hud`）、`App.tsx` + `DebugHudHost.tsx`（未开启零加载成本） | ✅ 已完成 |
| T6.4 | C14 门禁与全量验证 | `verify-logging.mts` 新增 **C14**：结构守卫 + 缓冲纯函数行为用例；六步全量门禁 | ✅ 已完成 |
| T6.5 | 文档回填与交付 | 本文升 v3.6、D18/D19、§6/§7/§8/§9 回填、工作日志、`present_files` | ✅ 已完成 |

**P6 实测（2026-11-24）**：`verify:logging` **3836 checks**（P5 3780 → P6 +56）；`node scripts/verify-all.mjs` **`ALL_VERIFY_PASSED`**。C14 关键断言：菜单可勾选项 / 命令 / 根层挂载 / 层级数值关系；`logSubscribe` 与 `logUnsubscribe` 成对、**HUD 代码里不含任何写日志调用**、只在开启态订阅；500 条裁到 300 条且保留最新、乱序按 `timestamp+seq` 归位、级别/类别/关键词过滤、错误统计、超长 params 截断、trace 短码。

### P7 — 事实唯一性：采集模型架构收敛（已完成）

起因：用户发现「选中一个节点」在 user 类日志里出现 **4 条**，追问「这类问题代码里是否很多、这些日志是否有必要存在、能否更彻底更优雅地优化」。调研与决策见 `observability-fact-uniqueness.md`（v1.0）。用户拍板 **B 档全量实施，但先落低风险止血**。

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T7.1 | 事实唯一性止血 | `LogFactKind` / `FACT_KIND_CATEGORY` / `FACT_KIND_GROUPS` 显式分类；`LogActionSpec` 增 `kind / cardinality / factOwner`；`dedupeKey = stableHash32(kind\|action\|target\|trace)`；`log-service.js` 短窗去重并累计 `repeatCount`（error 例外）；覆盖率表增「事实类型 / 基数 / 产生点」列；**C15** 行为用例 | ✅ 已完成 |
| T7.2 | 交互边界统一 | 新建 `interactionBoundary.ts`：window 捕获阶段监听 `pointerdown / keydown`，连点窗口合并、TTL 过期；`recordUser` / `beginOperation` 幂等复用当前交互，不再各自 `newTraceId` | ✅ 已完成 |
| T7.3 | 下线过程埋点 | 新建 `traceBuffer.ts`（200 trace × 100 step，LRU + dropped 如实统计）；`node.select / ui.tab / node.delete / kb.import / ui.view / document.save / room.load` 等同路径重复埋点降级为 `recordStep`，每个 action 只保留 1 个落盘 owner；`ui.tab` 书面保留（语义事件独家承接） | ✅ 已完成 |
| T7.4 | 状态中间件 | 新建 `observabilityStoreMiddleware.ts`：zustand diff 纯函数（跳过运行时态、值只留类型/长度/短哈希、敏感字段遮蔽），接入 `workspace / tabs / rightPanel / layout / theme` 5 个持久化 store；**只写内存步骤，不额外落盘**（D21 修订） | ✅ 已完成 |
| T7.5 | 操作记录 + 按需 dump + 视图适配 | `log-backend.ts` 为有 trace 的条目注入 `stepCount`，`error` / 显式 dump 时把该 trace 最近 50 步写进 `steps`；`monitorStore` 保留新字段；事件流显示「N 内存步骤」与 dump 展开、详情面板、Debug HUD 详情同步 | ✅ 已完成 |
| T7.6 | C15 门禁与交付 | C15 扩为 6 组：契约三态 / 主进程去重 / 覆盖率表 / 交互边界 TTL / **一次交互只 1 条 user + 步骤只在内存** / 状态 diff 脱敏与防自放大；六步全量门禁；本文升 v3.7 | ✅ 已完成 |

**P7 实测（2026-11-24）**：`verify:logging` **3877 checks**（P6 3836 → P7 +41）；`node scripts/verify-all.mjs` **`ALL_VERIFY_PASSED`**。覆盖率表 `97 events (wired=95, reserved=2, unconfirmed=0)`；`node.select` 由 3 个同路径落盘点收敛为 1 个 owner + 2 个内存步骤，`ui.tab` 由双写收敛为语义事件独家承接。C15 正面回归用例断言：一次交互的落盘记录 `category=user / kind=intent / stepCount=3 / 无 steps`，只有 `error` 条目带 3 条 dump 步骤。

### P8 — Debug HUD 透明背景与真穿透（已完成）

起因：用户希望浮动日志窗口「可以一定程度透明，尽量减少对正常用户操作的干扰」，并指定实现方式为**在 mini 窗口里加按钮**。实现时把「不挡操作」拆成两件事：视觉上淡、命中测试上真的放行。

| # | 任务 | 交付 | 状态 |
| -- | ---- | ---- | ---- |
| T8.1 | 透明状态与样式决策层 | 新建 `debugSurface.ts`（表面三态 / root 级穿透 / 文字描边 / 联动 patch 的纯函数）；`debugStore.ts` 增 `translucent` 持久化；`tokens.css` 三套主题各定义 4 个 `--debug-hud-translucent-*` 变量 | ✅ 已完成 |
| T8.2 | HUD 按钮与穿透修正 | `DebugHud.tsx` 标题栏加可勾选「透明背景」按钮；开启时联动 `clickThrough`；**穿透改为 root 级 `pointer-events:none`**，标题栏 / 过滤条 / 缩放手柄显式 `auto`；控制条悬停时临时恢复不透明；透明态日志行与详情加文字描边 | ✅ 已完成 |
| T8.3 | C14 门禁与交付 | C14 新增 C14-6：按钮 / 持久化 / 三主题 token 计数 / root 级穿透 / 悬停可读性 / 联动 patch 的结构守卫与真实 import 行为用例；六步全量门禁；本文升 v3.8 | ✅ 已完成 |

**P8 实测（2026-11-24）**：`verify:logging` **3902 checks**（P7 3877 → P8 +25）；`node scripts/verify-all.mjs` **`ALL_VERIFY_PASSED`**。C14-6 关键行为断言：不透明态不含半透明变量、透明态四个 token 各覆盖 3 套主题、`debugHudRootPointerEvents(true) === 'none'`（父浮层不再截获点击）、悬停恢复 `--titlebar-menu-bg`、开启透明会打开穿透而关闭时不擅自改回。

### 阶段依赖

```
P0（地基：可靠性 + 契约加固）          ✅ 已完成
 └── P1（category + 事件目录 + 分文件）  ✅ 已完成
      ├── P2（单点拦截 + action 迁移）  ✅ 已完成 ── 依赖事件目录
      └── P3（崩溃闭环 + 诊断包）       ✅ 已完成 ── 依赖 error 分文件与 sessionId
           └── P4（五视图与回放）       ✅ 已完成 ── 依赖 P1–P3 的数据
                └── P5（事件流真正成链） ✅ 已完成 ── 修正 P4 埋点未共享 trace 的缺陷
                     └── P6（实时 Debug HUD） ✅ 已完成 ── 不切视图即可看实时日志
                          └── P7（事实唯一性） ✅ 已完成 ── 一次交互 1 条落盘事实 + 内存步骤
                               └── P8（HUD 透明背景） ✅ 已完成 ── 半透明 + root 级真穿透
```

---

## 8. 验收指标（全局，量化而非「跑通了」）

| 指标 | 目标 | P8 收口结果 |
| ---- | ---- | ---- |
| 关键用户动作覆盖率 | 100%（按事件目录逐项核对） | ✅ 严格口径逐项表 97 条：95 已接入 + 2 书面保留（`store.call` / `ui.tab`）+ 0 未确认（静态引用口径，见 §9.24） |
| 事件目录登记率 / 裸字符串 | 100% / 0 | ✅ 100% / 0（C10 冻结线） |
| 用户事件 `target / result / trace` 齐全率 | ≥ 99% | ✅ 100%（P2 logAction 单点补齐 + P7.2 交互边界） |
| `accepted` 与实际落盘一致性（故障注入） | 可通过 `drain()` 核对，无静默丢失 | ✅ C8 故障注入恢复用例通过 |
| 崩溃事件带 breadcrumbs / dump 引用 | 100% / 100% | ✅ C11 行为用例通过 |
| 当日 10 万条下查询 P95 | < 300 ms | ✅ 10 万条 fixture 稳定态 6.9–11.1 ms（独立探针），正式门禁 P95 < 300 ms |
| 一次用户操作的日志成链 | 同一 traceId 下 ≥2 条，事件流渲染成 1 张操作卡 | ✅ C13 用真实拦截层日志验证 3 条成 1 组（非手工 fixture） |
| **一次交互的落盘事实数** | **1 条 user 记录 + N 条内存步骤** | ✅ C15 正面回归：`category=user / kind=intent / stepCount=3 / 无 steps`；只有 error 带 dump 的 3 条 steps |
| 重复事实兜底 | 同 key 合并且计数可见，error 不去重 | ✅ C15 主进程行为用例：`repeatCount ≥ 2`、`getWriteStats().duplicates ≥ 1`、error 例外 |
| 实时日志 HUD | 开启后不切视图即可看到实时日志，且不额外产生日志 | ✅ C14 断言订阅闭环与「HUD 零写日志」；内存上限 300 条、80ms 合帧、点击穿透 |
| **HUD 透明背景 / 不挡操作** | **一键半透明，且下层界面真的点得到** | ✅ C14-6：三主题 token 各 3 份、root 级 `pointer-events:none` + 控制区 `auto`、悬停恢复不透明、文字描边、开启联动穿透（P6 的「半穿透」缺陷已修） |
| 门禁 | 结构检查 + 行为用例双检；新增能力无行为用例不算完成 | ✅ C8 / C9 / C10 / C11 / C12 / C13 / C14 / C15 八组行为用例，`verify:logging` 3902 checks |

---

## 9. 已知限制与风险

1. **跨工作目录排障**（D5 固有）：监控页默认只看当前目录日志，靠 `workspaceId` 与诊断包双目录汇总补偿。
2. **日志随工作目录删除而消失**：诊断包必须支持手动导出，不能假设日志长期留存。
3. **详细模式隐私**：开启后 label 可能含文档标题 / 节点名，导出诊断包前必须二次脱敏并提示。
4. **黑匣子只覆盖当前会话**：进程被杀后内存缓冲消失，因此 error 类必须同步落盘；P3 已落地独立 `appendFileSync` 通道，并用上次会话已落盘日志补齐恢复报告（D11）。
5. **IPC 拦截的自放大风险**：拦截层自身不得写日志，否则 `invoke → 日志 → invoke` 无限递归；日志通道需显式排除。
6. **门禁的历史教训**：v2 的 `verify:logging` 3221 项全绿却漏掉 16 个行为缺陷——因为它主要做字符串存在性断言。P0 起所有新增行为必须配 C8 类用例。
7. **主进程 CJS 边界**：`electron/*.js` 无法 import TS 契约，数值常量与脱敏规则由门禁做一致性校验；P1 事件目录若需在主进程使用，须生成 JS 产物而非手写副本。
8. **`params.message` 一律只记长度**（P0 脱敏规则）：错误详情必须放一级 `error` 字段或 `params.error` 键（这两处保真，仅把其中的绝对路径换成 basename）。业务若把异常文本塞进 `params.message`，排障时只能看到长度；事件目录的 schema 强制在 P2 落地。
9. **查询性能（P4 已关闭）**：P1 的「全量收集 + 排序」已由分片行偏移索引 + 查询计划缓存替代，10 万条/日 P95 < 300 ms 达标；代价是索引常驻主进程内存，且 CRLF / 末行缺换行 / 外部改写会让 `exact=false` 并回退流式路径（结果不丢、性能下降），详见 §9.25。
10. **v1/v2 平铺文件与 v3 日期目录并存**：D5 下旧 `<date>.log` 与新 `<date>/<category>.log` 同处一个 logs 目录，旧文件只读兼容、按 14 天清理，绝不重写；`getAvailableDates` 与 `exportJsonl` 同时识别两种布局。
11. **分级保留期与关联键的边界**：`seq` 是会话内序号，跨会话会重复，因此跨类回放以 `timestamp` 为主序、`seq` 只解同毫秒乱序；`workspaceId` 是路径 FNV-1a 短哈希，无法反查目录，诊断包需靠 `session.json`（P3）记录映射。
12. **IPC 审计是聚合口径**：正常调用每 60 秒写一条按通道分组的 `ipc.audit`（调用数 / 均耗时 / 最大耗时 / 失败数），不是逐调用明细；只有失败或耗时 ≥ 500 ms 才即时写 `ipc.invoke`。审计日志条数与真实 IPC 调用数不相等，排障时应看聚合统计而非逐条回放。
13. **跨进程 traceId 依赖显式镜像**：渲染侧 `beginOperation` 调 `setTraceContext` 把 traceId 传给 preload；若某次 IPC 不在任何用户操作作用域内（如启动期探针），preload 会生成独立的 `ipc:*` traceId，此时它无法与渲染侧日志串联。
14. **定时器聚合是惰性的**：`createTimerAudit` 不创建后台定时器，只在 tick 跨过时间窗时 flush。进程崩溃时未跨窗口的累计 tick 会随内存丢失；P3 的黑匣子与同步 error 通道才负责补这段。
15. **主进程生命周期日志仍走异步批量写队列**：`quit.approved` 已特意排在 `drain()` 之前，但 `app.ready` 等早期 INFO 日志在极端崩溃下仍可能来不及落盘；P3 已让 **error 类**走独立同步句柄，崩溃/异常日志不再受此限制，普通生命周期日志仍按此口径。
16. **事件覆盖率核对表（P4 已产出，口径有限）**：`docs/design/event-coverage.md` 由 `npm run gen:coverage` 从 `EVENT_CATALOG` 生成，逐 id 列出静态引用点；严格口径下 97 条 = 96 已接入 + 1 保留 + 0 未确认。但**静态引用 ≠ 运行时必然产生**，详见 §9.24。
17. **`session.json` 固定在启动兜底目录**（D9）：它记录「应用会话」而非工作目录，切换工作目录时只更新 `workspaceId` 字段；若兜底目录不可写，恢复检测随之失效（日志本身仍会落盘）。
18. **`crashReporter.start` 之后切 `crashDumps` 不保证生效**（D10）：`dumpRef` 同时扫 `_crashDumpDir`、兜底目录、当前工作目录三个候选并取最新 dump；诊断包也汇总两个目录的 error。
19. **恢复报告的 breadcrumbs 是「语义事件轨迹」**（D11）：原始输入只进内存，进程被杀后无法找回；优先复用上次 error 日志已 dump 的原始输入，不足时把上次会话已落盘的日志映射成面包屑。因此「≥20 条」依赖上次会话至少产生 20 条日志，极短会话按实际条数记录 `tailCount`。
20. **诊断包有大小与范围上限**：每类最多 200 条、每文件只读末尾 128KB、只扫最近两个日期目录；它是排障快照而非全量备份，全量导出仍用 `log:export` 的 JSONL。
21. **error 同步写失败会降级**：`appendFileSync` 失败时条目带次数重入预缓冲、2 秒退避重试（最多 3 次），不会与异步批量队列混写同一分片；该路径目前只有统计与结构断言，未做真实只读磁盘注入。
22. **黑匣子镜像最多有 500ms 延迟**：渲染侧按 500ms / 满 20 条批量 send，崩溃恰发生在两次镜像之间时最后几条原始输入可能缺失，error 日志仍带此前已镜像的 50 条。
23. **minidump 不解析、不上报**：`crashReporter` 只生成本地文件，诊断包只带文件名与大小引用，不含 dump 内容；符号化分析需用户手动取出。
24. **覆盖率表是静态引用口径**：`gen-event-coverage.mts` 只扫描业务源码里是否引用了事件 id / 常量，无法证明该分支在运行时真的被走到，也无法证明埋点所在的入口当前仍可达。真机走查或运行时自检（例如按 session 统计实际出现的 action 集合）是后续可选增强，不应把这张表当作运行时覆盖率宣称。
25. **查询索引以内存换时间**：主进程为每个被查过的分片保存归一化记录与字节偏移，10 万条/日量级约几十 MB；查询计划缓存最多 64 个 key，写入或历史清理时整体失效。CRLF、末行缺换行、末尾被外部追加非本服务格式的行会让 `exact=false`，该分片自动回退到原流式路径并计入 `getQueryStats().fallbacks`——结果正确但不再享受索引加速。
26. **显示采样只影响 UI**：`ControlBar` 的显示采样率作用于 `applyDisplaySample()`，用来在高密度事件流里保持可读；它不减少落盘条数，`total` 与 `query()` 的计数仍是全量。`ERROR` / `user` / `error` 三类条目不参与采样丢弃，避免把关键因果链裁掉。
27. **日期键按本地日，跨午夜不重命名历史分片**（D12）：服务以写入时刻的本地日期建目录，若用户在运行中跨过午夜或改了系统时区，同一自然日可能落到两个目录；查询按目录名取日，不按条目 `timestamp` 重新归日。跨时区拷走日志目录后，目录名仍是导出方当时的本地日，监控页按目录名枚举 `getAvailableDates()`，不会自行换算。
28. **回放视图先全量拉到渲染进程**：`queryAllLogs` 分页上限 200 页 × 500 条 = 10 万条，超过该量级时五视图看到的是前 10 万条而非全部；主进程 `query()` 的 `total` 仍是全量匹配数，需要完整取证时应按 traceId / sessionId / 日期收窄条件，或用 JSONL 全量导出。
29. **交互窗口是「最近一次交互」的近似关联，不是严格因果**（D16）：窗口按 2 秒惰性过期，用户点击后 2 秒内的普通日志会共享该 traceId。快速连点、后台任务恰好落在窗口内、或超过 2 秒才完成的异步操作，都可能归错或断链。需要严格因果时仍应走 `observeOperation` 的显式作用域；**窗口只传播 traceId，绝不伪造 span 父子关系**。
30. **主进程日志与 60s 聚合审计保持独立**：`log-service.js` 的 `_completeEntry` 不补 traceId（启动、生命周期、恢复报告等不属于任何用户操作）；preload 的 `ipc.audit` 60 秒窗口横跨多次点击，显式不带 traceId；`observe.ts` 的 `timer.aggregate` 传 `traceId: null`。它们在事件流里归入「独立事件」区块，而不是被硬塞进某条操作链。
31. **preload 的 trace 镜像是「最近交互」语义**：`setTraceContext` 只存一个闭包变量，`observeOperation` 结束时会清空，而 `recordUser` 开启的交互窗口会一直保留到下一次用户事件覆盖。因此操作结束后发生的失败 / 慢 IPC 明细可能仍带最近一次点击的 traceId。这是有意的可读性取舍，不应把它当作该 IPC 必然由那次点击触发的证据。
32. **C12 的历史教训需要写进来**：P4 的视图模型用例用手工 fixture（自带共享 traceId）验证分组，全绿却漏掉真实埋点不成链。P5 增加 C13 直接驱动 `recordUser / logAction / recordInternal` 并捕获真实条目。**门禁必须至少有一组用例使用生产链路产生的数据**，不能只测纯函数的理想输入。
33. **Debug HUD 不是 OS 级置顶窗口**（D18）：它是主窗口内的 `fixed` 浮层，随主窗口最小化、切到别的应用即不可见，也不能拖出应用窗口外。若确需跨应用置顶，必须新建 `BrowserWindow` 并把 `log-service.js` 的 `win.webContents.send('log:entry', ...)` 改成按 `_subscribers` 里的 `sender.id` 广播，同时处理新窗口的 preload / 生命周期 / 主题同步。
34. **HUD 只显示内存里最近 300 条**：不落盘、不参与主进程 2000 条缓冲与磁盘保留期；关闭浮窗、重启应用后显示内容清空（磁盘历史仍可从 monitor 查）。「清空」按钮只清显示，不删任何日志。
35. **订阅者与广播窗口是一对一假设**：`log:subscribe` 按 `event.sender.id` 加入 `_subscribers`，但 `_broadcast` 实际只 `win.webContents.send`。HUD 与 monitor 同属主窗口、共用 `log-backend.ts` 的 `_listeners` Set，因此任何一方取消订阅都不会影响另一方；一旦引入第二个渲染窗口，这条假设失效，须先改广播再接 HUD。
36. **HUD 的隐私边界**：`localStorage` 只存 UI 偏好（开关、位置、过滤、详细模式），不缓存日志条目；详细模式默认关。日志在写入时已过二次脱敏，但展开详情仍可能看到文件路径片段 / 文档标题，截图或录屏需注意。HUD 不提供导出全量日志的能力，取证请走 monitor 的诊断包。
37. **内存步骤会被强杀进程丢掉**（D20）：`traceBuffer.ts` 只存在于渲染进程内存，进程被杀 / 崩溃后所有步骤消失；P3 的 `app.crash_recovered` 只能用上次会话已落盘的语义事件补轨迹，补不回过程步骤。唯一保证落盘的路径是「error 类条目写入时同步带上 dump」。这是把 D2 从原始输入推广到内部过程时必须接受的真实权衡。
38. **主进程产生的 error 拿不到渲染侧步骤**：`electron/main-log.js` 与 `log-service.js` 的崩溃上下文不经过 `log-backend.ts`，因此这些条目的 `steps` 为空，只能依赖 P3 的 `breadcrumbs` / `dumpRef`。跨进程 dump 需要新增 IPC，本轮未做。
39. **D21 对提案 M3 的工程修正**：`observability-fact-uniqueness.md` §5 M3 原设想让 zustand diff 自动落盘 1 条 `internal` 类 `state.change`。实施时改为**只写内存步骤**：P7.3 后每个状态变更已有唯一的落盘结果事实（`kb.import` / `node.delete` / `document.save` ...），再写 `state.change` 会变成「一次变更两条日志」，与事实唯一性不变量冲突，也会让多个 store 的高频更新重新变成噪声。`state.change` 因此没有登记为事件目录里的 action，只在 dump 的步骤名里出现。
40. **状态中间件只接 5 个 store**：接入 `workspace / tabs / rightPanel / layout / theme` 这 5 个有持久化语义的 store；`graphUiStore / edgeRelationPickerStore / nodeTreePanelStore` 是纯 UI 运行时态，按「运行时字段不观测」原则不接。`diffStateChange` 用「类型 + 长度 + 短哈希」判定变化：对象序列化超过 4096 字符会截断后哈希，极端情况下可能漏报；值一律不落明文，短枚举才保留可读值。
41. **`dedupeKey` 是短窗兜底，不是语义去重**：key 含 `traceId`，同一事实在两次不同交互里不会被合并；周期事件显式 `traceId: null` 不生成 key，不参与去重；`repeatCount` 是「被合并次数」，用于发现重复埋点，**不能当作该动作真实发生次数做统计**。真正的修复仍是 T7.3 的 owner 收敛。
42. **P7.2 只统一了 traceId 的生成入口，没改变「近似关联」性质**：window 捕获阶段的连点窗口会把 150ms 内的多次点击合并成一次交互，可能少记 user 记录；2 秒 TTL 内的后台日志仍可能跟随最近交互。需要严格因果时仍走 `observeOperation`（§9.29 继续有效）。
43. **覆盖率表新增「产生点」列后仍是静态引用核对**：P7 让 `ui.tab` 变成「书面保留」（由 `user.tab_close` / `user.tab_switch` 独家承接），但语义事件是否在每次 tab 操作都真的产生，只有 C15 的结构守卫与真机走查能证明。§9.24 的边界未被 P7 关闭。
44. **P8 的透明是应用内 CSS 半透明，不是 OS 级窗口透明**：没有使用 Electron 的 `transparent: true` / `setOpacity()`，浮窗不会透视到桌面或其他应用，也不会变成全局置顶（§9.33 仍有效）。透明度是**单档固定值**（亮色 0.52 / 暗色 0.56），不是可调滑杆；三套主题各自定义 4 个 token，改深浅只能改 `tokens.css`。
45. **真穿透与「可点击展开详情」互斥**：开启穿透后 root 与日志列表都不参与命中测试，日志行收不到点击，详细模式的展开不可用；想看 params / error 需先关掉穿透。标题栏、过滤条、缩放手柄刻意保留 `pointer-events: auto` 作为控制入口，因此**鼠标落在这些窄条上时下层控件仍点不到**——这是「保留可操作入口」与「完全不挡」之间的取舍，需要完全放行时可折叠成胶囊再移开。
46. **悬停恢复只认控制条**：透明 + 穿透时 root 不参与命中，鼠标停在日志区不会触发 `onPointerEnter`，因此日志区保持半透明（靠文字描边保证对比度）；只有移到标题栏 / 过滤条才临时恢复不透明。C14-6 验证的是**结构 + 纯函数行为**，没有真机渲染截图或真实命中测试，半透明观感与下层点击是否如预期，仍需启动软件按 `Ctrl+Shift+D` 开启后点「透明」按钮实测。

---

## 10. 与 v2 文档的关系

- `logging-spec-and-redesign.md` 的 §3 规范在 v3 中继续有效，T0.7 已修订三处：字段字典 `v: 1` → `v: 2`、`logAction` 签名以 `log-backend.ts` 实际为准、顶部改为「框架已落地、Phase 1.4 迁移未开始」。P1 起该文件升 v1.2，明确标记为 **v2 历史契约**；现行字段与分类以 `observability-v3-plan.md` §2 和 `logContract.ts`（`v = 3`）为准。
- v2 附录 B #6「崩溃前最后一条日志可能来不及落盘」已由 P0 的 `drain()` + P3 的 error 同步通道共同关闭：崩溃/异常类日志不再经过异步队列。
- 本文 §0 的决策优先于 v2 §0 决策表中同名条目之外的任何新决策；v2 的 D1–D8 未被本轮推翻。
