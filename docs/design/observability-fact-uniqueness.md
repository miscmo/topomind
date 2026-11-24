# 事实唯一性：日志采集模型的架构收敛方案

> 版本 v1.0（已实施）· 2026-11-24 · 状态：**用户拍板 B 档全量实施、先落 P7.1+P7.2 止血；P7.0–P7.6 已全部完成，六步全量门禁通过**。实施结果与对原方案的工程修正见 §7.1、§8 与 `observability-v3-plan.md` v3.7 §7/§9。
> 触发：用户发现「选中一个节点」会在 user 类日志里出现 4 条；追问「这类问题是不是很多、是否需要存在、能否更彻底地优化」。
> 适用范围：`src/` 业务埋点、`electron/log-service.js`、`scripts/verify-logging.mts`、事件目录与覆盖率表、monitor / Debug HUD 视图。
> 与 `observability-v3-plan.md` 的关系：本文是对 v3 采集模型的**架构修订提案**，不推翻 D2/D3/D5 等已定决策，而是把 D2 的哲学推广到内部过程事件。

---

## 1. 这不是个例：量化现状

静态扫描范围 `src/**/*.{ts,tsx}`（422 个文件），统计 `logAction` / `recordUser` / `recordInternal` / `observeOperation` 调用点：

| 指标 | 数值 | 说明 |
| ---- | ---- | ---- |
| `logAction` 业务调用点 | **106** | 另有 1 处是 `log-backend.ts` 文档注释里的示例，不计入 |
| `recordUser` | 9 | 其中 4 处是 `user.view_open` 的不同入口 |
| `recordInternal` | 3 | 2 处是 `observe.ts` 自身实现，业务侧只有 `pluginLifecycle` 1 处 |
| `observeOperation` | **1** | 仅 `commandRegistry.execute`；为「一次操作一条日志」设计的抽象几乎没被用起来 |
| 拥有 ≥2 个产生点的 action | **29** | 覆盖约 60 个调用点；单产生点 action 也是 29 个 |
| 主进程去重能力 | **无** | `_validateEntry()` 只做脱敏/校验/截断，没有幂等或窗口去重 |

### 1.1 典型重复形态

需要先区分两类「多产生点」：**不同入口/分支是合理的**（例如 4 处 `user.view_open` 对应打开不同视图），**同一次执行路径上被写多次才是缺陷**。后者至少有以下几类：

| 形态 | 例子 | 问题 |
| ---- | ---- | ---- |
| 同一操作跨层双写 | 右键删除节点：`useNodeActions.ts:122` 在**删除前**写 `node.delete`，`nodeCrudOperations.ts:271` 在**删除成功后**再写一条 | 同一次操作 2 条；第一条其实是「意图」，却用了表示「事实」的 action 和 `success` 结果 |
| 同一操作 UI / 事件 / store 三层各一条 | 点击节点：`KnowledgeCard.tsx:253` → `selectionOperations.ts:26`，`graphEventHandlers.ts:243` 显式 `logAction`，`:262` `ops.selectNode` 再回 `selectionOperations.ts:26` | 一次点击 3 条 `node.select` |
| P4 语义层叠加 | `graphEventHandlers.ts:251` 又补 `recordUser('user.node_click')` | 一次点击共 4 条 user 日志，分散在 3 个 traceId 上 |
| 一个 action 承载多个阶段 | `kb.import` 在同一文件 5 处（打开对话框 / 选中目录 / 成功 / 失败 / 兼容路径）；`ui.view` 在小地图 5 处（显示 / 隐藏 / 跳节点 / 拖动 / 复位） | action 名无法表达事实，查询时只能靠 params 猜，统计口径失真 |
| 状态写回与业务入口各一条 | `document.save` 在 `DocumentWorkspaceLayout.tsx:447` 与 `useDetailDocumentSession.ts:97`；`room.load` 3 处 | 无法回答「这次保存到底发生了一次还是两次」 |
| 命令链叠加 | `commandRegistry.execute` 写 `user.command`，命令体内部业务 `logAction`，preload 的 `ipc.invoke` 明细 / `ipc.audit` 聚合，性能埋点再写一条 | 一次命令 N 条，且分属 user / internal / performance 三类 |

### 1.2 门禁为什么没拦住

`docs/design/event-coverage.md` 的口径是「业务源码里出现该事件 id 或常量引用 = 已接入」。重复产生点越多，越容易被判成「覆盖良好」；97 条里 96 条已接入、0 缺口，恰恰**不包含「同一事实是否被写了多次」这个维度**。C10/C13 验证的是「埋点是否产生、是否成链」，也没有事实唯一性断言。

---

## 2. 根因：采集模型仍停留在「埋点即日志」

v3 在**传输、分类、存储、崩溃、UI** 上都做了体系化建设，但**采集模型没有变**：

1. **一条日志 = 一次函数调用。** 业务代码在「自己这一层被调用」时写一条，于是「一次用户操作」被自然拆成 N 个函数调用 = N 条日志。层次越深，日志越多。
2. **分类靠 action 前缀猜。** `CATEGORY_RULES.userPrefixes` 把 `node.` / `ui.` / `document.` 全部归为 user。但 `selectionOperations.selectNode` 是**运行时状态写回**、`ui.view` 是**视图操作**，本不该和「用户意图」同级。
3. **P2 迁移只换名字、没换模型。** 106 处中文 action 被统一映射成规范 id，`LEGACY_ACTION_MAP` 把「节点:点击」「节点:选中」「节点:选中子树」压成同一个 `node.select`，造成**语义塌缩**：迁移前还能靠名字区分层次，迁移后连区分依据都没了。
4. **P4 的语义事件是「叠加」而不是「替换」。** 为了关掉覆盖率表零引用，在已有埋点旁新增 `recordUser`，没有下线旧埋点。
5. **P5 的交互窗口只串联、不合并。** 它把后续日志挂到同一 traceId，但写在不同位置的 4 条仍然是 4 条；而且窗口开启时机排在第三位，前两条反而落到了别的 trace 上。

一句话：**现有体系优化的是「如何把日志写好、存好、查好」，没有回答「什么才算一条日志」。**

---

## 3. 这些日志还有必要存在吗

### 3.1 它们最初的目的，已经被更好的机制覆盖

v2 时代散落的 `logAction` 主要解决「排错时不知道代码走到哪」。v3 之后已有：

- `traceId / spanId / parentId` 与 `observeOperation`（因果链）
- `blackbox.ts` 原始输入环形缓冲 + error 时 breadcrumbs dump（D2）
- `crashReporter` / `session.json` / 诊断包（P3）
- 性能埋点、IPC 审计、定时器聚合（P2）
- 事件流 / span 瀑布 / 错误指纹 / Debug HUD（P4 / P6）

也就是说，**「过程痕迹」这类日志想提供的信息，现在有更精确、更省、且不污染统计的载体**。它们曾经必要，现在是冗余，甚至有害（噪声、计数失真、trace 割裂）。

### 3.2 按「事实类型」重新裁定

| 事实类型 | 例子 | 是否应落盘 | 建议 |
| ---- | ---- | ---- | ---- |
| 用户意图 | 点了节点 X、打开文档 Y、执行命令 Z | **是，1 次交互 1 条** | 保留为 `user`，且必须是链根 |
| 状态变更结果 | 节点删除成功、文档保存完成、房间加载完成 | **是，1 次变更 1 条** | 归 `internal`，由状态层自动检测，不由每个入口手写 |
| 失败 / 异常 / 崩溃 | 删除失败、保存失败、未处理异常 | **是，全量** | 归 `error`，保持 P3 同步落盘与指纹 |
| 性能事实 | 节点选中响应、慢 IPC、长任务 | **是，按现有采样** | 归 `performance`，不动 |
| 周期事实 | 定时器、60s IPC 聚合、app 生命周期 | **是，聚合后 1 条** | 归 `internal` 且显式独立，不动 |
| **过程痕迹** | `selectNode` 被调用、打开对话框、store 写回、某函数进入 | **否（默认）** | 进**内存 trace buffer**，只在异常 / 慢操作 / 手动导出时 dump |

按这个划分，106 处 `logAction` 里相当大一部分属于最后一行；真正该保留的是意图、结果与失败。注意这不等于「删掉 106 处」：失败路径、`_failed` 类 action、以及尚无中间件覆盖的入口要逐项核对。

---

## 4. 目标模型：一次交互一条记录 + 内存步骤按需 dump

**把 D2 的哲学从「原始鼠标输入」推广到「内部过程步骤」**：

> 用户当初接受 D2，是因为「逐条鼠标事件全量落盘」既贵又不可读，改成「内存黑匣子 + 出错时 dump 最近 50 条」后，透明化反而更强。
> 过程日志面临的是同一个问题：平时没人看，出事时又需要。应当用同一套解法。

### 4.1 五条不变量

| # | 不变量 | 可验证方式 |
| -- | ---- | ---- |
| I1 | **一次交互 = 1 条 user 落盘记录** | 行为用例：模拟一次点击，断言 `category=user && action=user.*` 恰好 1 条 |
| I2 | **一条事实只有一个 owner** | 事件目录为每个 action 声明唯一产生层；静态检查调用点是否越层 |
| I3 | **过程步骤默认不落盘** | 断言 `process` 类步骤只出现在内存 buffer / dump 里，不出现在当天的日志文件 |
| I4 | **落盘记录可反查完整步骤** | 记录带 `traceId` + `stepCount`；异常/慢操作/诊断包能把该 trace 的内存步骤展开 |
| I5 | **分类由产生点显式声明**，不再按前缀猜 | `kind` → `category` 映射；门禁冻结「按前缀归 user」的老路径 |

### 4.2 分层

```
交互边界（window 捕获阶段，唯一入口）
   ↓ 生成 traceId / 开启交互窗口
业务代码（不再手写「我被调用了」）
   ↓ 只做业务，必要时声明 owner
状态中间件（zustand diff，唯一事实源）
   ↓ 持久化字段发生变更 → 1 条 internal 结果
内存 trace buffer（步骤、span、耗时）
   ↓ 默认只驻留内存
落盘：1 条 user 意图 + N 条 internal 结果/error/performance
   └ 异常 / 慢操作 / 导出诊断包 → 把该 trace 的步骤 dump 进去
```

### 4.3 与现有能力的关系

- **不推翻** D2（原始输入仍只进内存）、D3（脱敏/长度摘要）、D5（工作目录）、D16（交互窗口近似关联）、D17（链/独立事件分区）、D18（HUD 浮层）。
- **扩展** `EVENT_CATALOG`：每个事件补 `owner` / `cardinality` / `kind`；`category` 由 `kind` 推导。
- **复用** P3 的 breadcrumbs / `appendFileSync` / 诊断包导出作为 dump 通道，不新建一套 IPC。
- **替换** 覆盖率表口径：从「静态引用 = 已接入」改为「owner 声明 + 运行时事实计数 + 唯一性检查」。

---

## 5. 五个机制与代码落点

### M1 交互边界单一入口

在渲染进程最外层（`src/main.tsx` 附近，与 `installBlackbox()` 同层）用 **window 捕获阶段**监听 `pointerdown / keydown`，统一生成 `traceId` 并 `startInteraction()`。业务层的 `recordUser` 改为**幂等复用当前交互**（已有 interaction 就不新开），而不是自己 `newTraceId()`。

- 落点：`src/core/blackbox.ts`（已有全局捕获，可同层扩展）、`src/core/observe.ts` `recordUser`、`logContract.ts` `startInteraction`
- 解决：P5 里「语义事件排在第三位 → 前两条落到别的 trace」；快速连点、2s 窗口误归也能靠交互 id 边界收窄

### M2 事实所有权登记

`eventCatalog.ts` 的每个 spec 增加：

```ts
owner: 'interaction' | 'state' | 'failure' | 'periodic' | 'metric'
cardinality: 'per-interaction' | 'per-state-change' | 'per-event'
kind: 'intent' | 'state' | 'process' | 'periodic' | 'diagnostic'
```

`gen-event-coverage.mts` 改为按 owner 核对：同一 action 的调用点必须落在声明的层；`per-interaction` 事件若出现 ≥2 个同路径产生点直接判失败。`verify-logging.mts` 新增 C15「事实唯一性」行为用例（真实拦截层产生日志后按 `session+trace+action+target` 分组断言无重复）。

### M3 状态中间件自动产生事实

项目是 zustand（`src/stores/**` 9 个 store，`graphStore` 另有 temporal）。做一个 `observabilityMiddleware`：对**持久化字段**做 diff，自动写 1 条 `internal` 类 `state.change`（带字段摘要、before/after 长度、耗时），脱敏复用 `redactParamsDeep()`。

- 落点：新建 `src/core/observabilityStoreMiddleware.ts`，在 store 创建处统一接入
- 收益：入口层 / 执行层双写自然消失，因为**只有一个地方观测状态**；106 处手写埋点里「结果类」可批量下线
- 约束：只观测持久化字段；`selected` 这类运行时视图态不进 diff（否则又回到噪声）

### M4 内存 trace buffer + 按需 dump

新建 `src/core/traceBuffer.ts`：按 `traceId` 保存步骤（step 名、耗时、父子 span、结果），上限与 LRU 如实记录 `dropped`。写入时机：

- 操作结束 → 只追加 `stepCount` 到那条 user 记录，步骤留内存
- `error` / 慢操作 / `exportDiagnosticBundle()` → 把该 trace 的步骤序列化进 `breadcrumbs` / `spans`，走 P3 已有的同步落盘

这是 D2 的一般化，也让「透明化」不依赖日志条数：平时看摘要，出事看全量。

### M5 `dedupeKey` 兜底去重

即使有 owner 约束，也要防漏网。`buildLogEntry()` 生成 `dedupeKey = sessionId + traceId + action + targetKey + windowBucket`；`log-service.js` 在短窗口内对相同 key 只保留一条并累计 `repeatCount`（不静默丢弃，计数要可见）。

- 落点：`logContract.ts`、`electron/log-service.js` `_validateEntry` 之后、`LogEntry` 增 `dedupeKey? / repeatCount?`
- 作用：对历史埋点、插件日志、DevTools 手写的越层调用形成最后一道闸门

---

## 6. 收益与代价（如实列，不粉饰）

| 维度 | 收益 | 代价 / 风险 |
| ---- | ---- | ---- |
| 日志量 | 高频交互下 user 类日志降一个数量级 | 过程细节不再默认持久化，习惯「翻流水」的排错方式要改 |
| 可信度 | 用户事件次数、action 统计、覆盖率口径都变得可用 | 覆盖率表与所有基于「一条条日志」的查询/回放/视图都要适配 |
| 链路完整性 | 1 条记录 = 1 次交互，trace 天然不割裂 | 交互边界在 window 捕获阶段，需处理 iframe / 快捷键 / 程序化调用 |
| 可靠性 | 与 D2 一致，磁盘压力小 | **进程被强杀时内存步骤会丢**；P3 的 crash 机制能补 session 级摘要，但补不回全部步骤。这是与「完全透明化」的真实权衡 |
| 改动面 | 业务代码最终趋近零手写埋点 | 中间件要接 9+ 个 store、diff 脱敏要小心；分期长，中间态需读时兼容 v1/v2/v3 |
| 门禁 | C15 把「事实唯一性」变成可回归的行为断言 | 现有 C10/C13/C14 断言需按新模型调整，不能简单删 |

**关键取舍必须让用户拍板**：是「默认不落盘 + 按需 dump」（日志少、日常够用、崩溃时可能缺步骤），还是「关键链路仍全量落盘」（可靠、但保留一部分重复）。没有两全，不能默认替用户选。

---

## 7. 分期路线（拍板后执行）

| 阶段 | 内容 | 可独立验收 |
| ---- | ---- | ---- |
| P7.0 | 量化与冻结（本轮已完成）：扫描报告、本文、决策表 | 文档 + 数据 |
| P7.1 | **止血**：`dedupeKey` 去重兜底 + `kind` 显式分类 + C15 唯一性门禁 + 覆盖率表加「重复产生点」列 | 不改变业务逻辑，`verify-all` 六步通过 |
| P7.2 | **交互边界统一**：window 捕获开 trace，`recordUser` 幂等复用 | 行为用例断言一次点击只落 1 个 trace |
| P7.3 | **下线过程埋点**：按 owner 表逐项删除 / 降级 `logAction`（保留失败路径） | 每个 action 有下线理由，覆盖率表重生成为「唯一产生点」 |
| P7.4 | **状态中间件**：zustand diff 自动产生 `state.change` | 9 个 store 接入，diff 脱敏用例 |
| P7.5 | **操作记录 + 内存步骤 + 按需 dump**，monitor / 事件流 / Debug HUD 适配新模型 | C15 + C12/C13 回归，10 万条查询 P95 不退化 |
| P7.6 | 全量验证、方案升版、§9 限制改写、工作日志、交付 | `ALL_VERIFY_PASSED` |

P7.1 与 P7.2 风险低、见效快，**建议无论最终是否做完整重构都先做**；P7.3–P7.5 是真正的架构收敛。

### 7.1 实施结果（2026-11-24）

| 阶段 | 实际落地 | 与提案的偏差 |
| ---- | ---- | ---- |
| P7.1 | `LogFactKind` + `FACT_KIND_GROUPS` 显式分类、`dedupeKey` 短窗去重 + `repeatCount`、事件目录 `kind/cardinality/factOwner`、覆盖率表新增三列、C15 行为用例 | 无 |
| P7.2 | 新建 `src/core/interactionBoundary.ts`（window 捕获、连点合并、TTL），`recordUser` / `beginOperation` 幂等复用，`main.tsx` 早于 `root.render` 安装 | 无 |
| P7.3 | 新建 `src/core/traceBuffer.ts`；`node.select / ui.tab / node.delete / kb.import / ui.view / document.save / room.load` 同路径重复点降级为 `recordStep`；`ui.tab` 书面保留 | 覆盖率表由「96 已接入 + 1 保留」变为 **95 + 2 + 0 未确认**；`ui.tab` 改由语义事件独家承接 |
| P7.4 | 新建 `src/core/observabilityStoreMiddleware.ts`，接入 5 个持久化 store | **修正 M3**：diff 只写内存步骤，不新增落盘 `state.change`（理由见 §8 D21 与 v3-plan §9.39）；另外 3 个纯 UI store 不接 |
| P7.5 | `log-backend.ts` 注入 `stepCount`，error / 显式 dump 时写 `steps`；`monitorStore` / 事件流 / 详情面板 / Debug HUD 适配摘要与展开 | 无 |
| P7.6 | `verify:logging` **3877 checks**、六步 `ALL_VERIFY_PASSED`、方案升 v3.7 | 无 |

**量化前后对比**：一次节点点击由「4 条 user 日志 + 1 条 performance、拆成 3 个 traceId」收敛为「1 条 `user.node_click` 落盘 + 3 条内存步骤（含选中态写回），共用 1 个 traceId」；`ui.tab` 由双写收敛为 1 条语义事件；`node.select` 由 3 个同路径落盘点收敛为 1 个 owner。C15 用行为用例而不是 fixture 断言这个不变量。

---

## 8. 决策点（已拍板）

| # | 决策 | 选项 | **拍板结果** |
| -- | ---- | ---- | ---- |
| D20 | 过程步骤是否默认不落盘 | **A 不落盘 + 按需 dump（D2 一般化，推荐）** / B 关键链路全量落盘 / C 只去重不改落盘策略 | **A**：`traceBuffer.ts` 只存内存，error / 诊断包导出时 dump 最近 50 步 |
| D21 | 状态变更由谁产生 | **A store 中间件自动（推荐）** / B 保留手写但强制 owner 唯一 / C 混合，先接核心 store | **A，但实施时修订落盘策略**：diff 自动观测，只写内存步骤，不新增落盘 `state.change`。理由：P7.3 后每个状态变更已有唯一落盘结果事实，再写一条即「一次变更两条日志」，与事实唯一性冲突；且多 store 高频 diff 会重新变成噪声。见 v3-plan §9.39 |
| D22 | 是否接受「1 条落盘记录 = 1 次交互」改变现有查询 / 回放 / 监控页语义 | A 接受并改造视图 / B 保留「一条条流水」兼容层，新模型只用于新增视图 | **A**：`monitorStore` 保留 `kind/stepCount/steps/repeatCount`，事件流显示「N 内存步骤」并支持 dump 展开，详情面板与 Debug HUD 同步；历史日志读时兼容 |
| D23 | 节奏 | A 一次性做到 P7.5 / **B 先 P7.1+P7.2 止血，再按阶段推进（推荐）** / C 只记录结论不改代码 | **B**：用户指令「按你推荐方案实施」，按 P7.1 → P7.6 顺序推进 |

---

## 9. 三档选择（已选定 **B 架构收敛**）

| 档 | 内容 | 适用 |
| -- | ---- | ---- |
| **A 止血** | P7.1 + P7.2：去重兜底、显式分类、唯一性门禁、交互边界统一 | 想立刻消掉「一次点击 4 条」，又不想动业务链路 |
| **B 架构收敛（推荐）** | A + P7.3–P7.5：事实唯一性 + 状态中间件 + 操作记录 + 内存步骤按需 dump | 认定「埋点即日志」模型该换，愿意接受分期与视图改造 |
| **C 只记录** | 把本文结论写进 `observability-v3-plan.md` §9 已知限制，不改代码 | 当前更关注功能开发，日志体系先冻结 |

---

## 10. 一句话结论

重复不是「埋点写多了」，而是**采集模型把「函数调用」当成了「事实」**。逐个去重只能治标；把事实的所有权收归交互边界与状态层、把过程步骤交给内存并按需 dump，才同时解决噪声、计数失真与 trace 割裂。这也正是用户最初「软件行为透明化」目标的本意：**能解释为什么会出现这个结果，而不是记录每个函数被调过一次。**
