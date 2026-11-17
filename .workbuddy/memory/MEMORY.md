# TopoMind 长期约定（细节与验证过程见 `.workbuddy/memory/2026-11-14.md` ~ `2026-11-17.md` 及更早日志）

## 门禁（每轮必跑）
- 顺序：`typecheck` → `node --check` → `verify:critical`（末行 `Critical regression checks verified`）→ `verify:plugins` → `vite build --outDir outputs/.tmp-build-N` → cp 到 `dist/` → 一次 `verify:linked:gui`（读 dist，改源码必重建）。
- 改能力必同步 `scripts/verify-critical-regressions.mts` 具体字段断言 + **反向验证**（旧实现 exit 1 → 原子恢复 + sha256 复核）；纯函数 esbuild 真跑；`verify:plugins` 的 SSR 守卫路径/文案硬编码。
- Node 22 跑 `.mts` 用 `--experimental-strip-types --experimental-specifier-resolution=node`；esbuild 是 vite 传递依赖。GUI Electron 三禁用 flag；`elementsFromPoint` 只比相对 index；CDP 超时换干净端口；EPERM→Defender 排除；个人目录删除→回收站+备份+sha256+每批 10 个；GUI 时序抖动复跑确认；`outputs/` 删除常被 `SAFE_DELETE_FAIL_CLOSED` 拦截，不绕过。

## 性能监控（勿回退）
- 四层：`shared/observability/performanceContract.ts`（唯一真源）→ `core/performance-log.ts` → `performanceStatistics.ts` → `plugins/builtin/monitor/performance/`。样本从 `action='性能:记录'` 日志反解，宿主 `PerformanceApi` 只支持单日。
- 注册表 6 分类 **21 指标**；画布动作是 `params.operation` 维度，禁每动作造指标 id；`CANVAS_OPERATIONS`/`THRESHOLDS`/`LABELS` 共 20 项（`select` 30ms / `box_select` 50ms）；阈值写回 `params.thresholdMs`。保留 `PERFORMANCE_METRICS` camelCase 映射与 `mark/take/logPerformanceMetric` 旧契约；`shouldReport` 里 `if (options.force || options.success === false) return true` 别删。
- 新埋点只用 `measurePerformance`/`startPerformanceSpan`/`startCanvasSpan`；禁自算 `performance.now()`/拼 success。`isSlowSample = success && durationMs > thresholdMs`（失败样本永不算慢）；`filterPerformanceSamples` 必须与 `DEFAULT_PERFORMANCE_FILTERS` 合并。
- `thresholdForScale` 只在埋点侧写 `params.thresholdMs`，不改 `isSlowSample` 语义；只对 `SCALE_ADJUSTED_OPERATIONS` 对数放宽（0.6 / 上限 8 倍），**清单 5 项** `delete_batch/search/tree_expand/batch_style/subtree_select`；`meta_build/meta_flush/lod_recompute` 已按标定移除别加回；改清单须同步第 40/44 组断言。
- 手势耗时唯一源 `shared/observability/gestureTiming.ts` 的 `resolveGestureSampleTiming`：`durationMs=maxFrameMs`、总时长存 `elapsedMs`、单帧 resize 返回 null 不上报；两处埋点共用。
- 标定闭环：`computeScaleCalibration`/`computeCalibrationSummary` + `scripts/analyze-performance-scale.mts`（`perf:calibrate`；`--input` 吃 JSON/JSONL/`{samples}`/宿主日志、`--out`、`--strict`、无输入合成基准）。CLI 必须 esbuild 打包加载；「导出样本」产出 `{samples:[...]}`；`ScaleCalibrationPanel` 基于未筛选 samples；`performanceMetrics.ts` 的 `asRecord` 兼容字符串 params 勿删。
- `PerformanceTab` 只做编排、`resolvedActive` 纯派生零 effect；门禁第 38–48 组（指标数 21 / 13 条链路硬编码）；`detail_save` 采样率 0.2（慢/失败强制上报），`detail_read` 未降采样；`public/api.ts` 新字段一律可选；颜色只用 `tokens.css` 变量 + `color-mix`，禁 hex / `${color}16`。
- **多选热路径**：选中态唯一写入通道 `graphStore.applySelectionChanges(nextNodes, changedNodes)`（O(K) 刷 nodesMap + `selectionOnlyNodeArrays` WeakSet 让 zundo equality O(1) 短路），禁回 `setNodes`；`domain/graph/incrementalNodes.ts` 的 `createNodeIndexCache` 共用 `graphNodeIndexCache`。
- **LOD 签名铁律**：`buildLodPlanSignature` 满缩放只剔除 selectedKey、**必须保留 selectedNodeId**（左上角诊断同源派生，去掉 GUI 阶段 Q 失败）；缩小时两者都进签名。`lod.ts` 的 `isLodFullZoom` 同源；满缩放短路只跳 hidden/折叠/边遍历，hierarchy/排序/压力曲线不能跳。
- 其余：`useSemanticLod` 单遍 `computeLodVisibility`（`resolvePolicy`，`singlePass:true`）；`performanceStarts.ts` 1000ms TTL；`useGraphRoomLoader` 的 `inflightGraphRef` 共享读盘（丢弃请求只 logAction 不算失败）；`long_task` 阈值 200ms 带归因；`saveLater/saveNow` 全量 `buildMetaFromNodesEdges`；`graphStore.getState()` O(1) 取规模字段，统一 `readCanvasScale()` 且必须容忍 mock store 缺字段。

## 房间加载 / 存储（勿回退）
- 唯一轻量摘要层 `electron/services/room-summary-service.js`（IO 注入）：一次父目录 readdir 替代 N 次 `existsSync`；v2 只数 nodes 分片 key；`hasDetail` 只看 `_docs` 文件名；未知 version 降级空摘要、v1 读索引 children；返回 `{position?,childCount,hasDetail}` 不变，`file-service.js` 只做参数校验后委托。真实 1469 节点主进程 IO 187.6→31.9ms（5.9×），新旧逐字段 0 差异。
- `roomLoader.ts` 只调一次 `graphMetaToRoomGraph`；`graphStore.replaceGraph` 不得重复 `buildNodesMap`。门禁第 48 组含内存 fs 真跑 + 4 次反向验证。**刻意未做**：两次 IPC 合并；`saveLater` 合并 meta 构建（debounce 到期可能已切房间）；切换房间前置串行保存；`room_load` 之后 1562ms 长任务仍是盲区。
- `loadRoom(dirPath, preserveCurrentNodeLayout?, preserveViewport?)` 只替换图状态、**不改 tab 会话 roomPath / roomHistory**；因此任何「原地刷新」都必须用会话当前 `roomPath`（`graph.refreshCurrentRoom()`），禁传源/目标房间路径，否则画布与面包屑错位、后续 `navigateToChildRoom` 路径解析错。
- 新建 `createChildNodeOptimistic` 零 await 同步 `setNodes([...store.nodes,newNode])`；删除 `deleteChildNode` 只 `await storage.deleteCard` → `temporal.pause()` 包 remove → `void saveLater`；批量样式唯一源 `applyNodeStylePatch`/`clearNodeStyles`。禁回灌 `loadRoom`/`saveNow`/全量 `setNodes(map(...))`。
- 全量扫描合理保留：换房间/导航/跨房间移动/关闭 flush/`buildMetaFromNodesEdges`/`documentPresence`/`importKB`。**Delete/Backspace 键删除不进回收站**，未改待确认。
- 格式边界唯一 `graph-meta-service.js` 的 `read/writeGraphMeta`；v2＝索引 `{version:2,zoom,pan}` + `nodes/edges-0..15.json`（FNV-1a%16、空桶不落盘、索引最后写）；未知 version 抛错，v1 不改写。
- **字段白名单 7 处**：`types/graph.ts`、`domain/graph/model.ts`、`graphMapper` 双向、`normalizeGraphMeta.ts`、`core/storage/file.ts`、`core/fs-backend.ts`、`graphBuilder`。草稿正文绝不进 localStorage；`GraphPage` 在 JSX 前调 `useGraphPageActions`；`requireRootDir()` 抛错不得静默返回空。

## 文档 / 双链
- docId＝`doc_`+32hex；关联 `{docId,cardRef,title}`≤8 只记 `child.linkedDocuments`；写库必经 `createLinkedDocumentWriter`。**ownerCardPath 铁律**：右栏/草稿/附件/缓存键一律 `documentCardPath`；面包屑唯一 `formatDocumentSource`；开 chip 先 `flushDocumentSave()`→查锁→`enterRoomInTab`。
- 统一资源树唯一实现 `electron/services/unified-document-tree-service.js`；key 只由 `parseUnifiedTreeKey`/`cardTreeKey`/`documentTreeKey` 编解码；`buildSubordinateForest` source=父→target=子，多父/环/超 100 层降级 related。
- **剪枝铁律**：`documentPresence` TTL 目录级探测，只读 tree.json 清单、不读 .tdoc 正文、不写索引；`isRelevant` 同判物理后代与 forest 下溯连线子树；`origin` 徽标必须第二行。搜索走派生索引（stat 签名增量、首次搜索才建），`if (!q) return []` 硬约束；IPC 四层同步；旧契约 8 篇上限 / `excludeDocId` / `data-tm-*` 选择器。

## 编辑器 / 画布 / UI
- 勿在 `appendTransaction` 同步改文档（停输入~1s/blur/destroy 批量 flush）；公式唯一入口 `mathRender.ts`；`titleDecorations.ts` 唯一装饰源。锚点归边 `EdgeAnchor{u,v}`；`relationLabel` 贯通 7 处白名单；关系仅 related/subordinate，树强校验唯一 `graphHierarchy.ts`（违规降级 related 不删边）；**从属边不要双线轨道/层级徽标**。
- 关系浮层贴连线终点（`CompactRelationPopup` `z-[60]`、视口钳位、无遮罩）；工具栏下拉 `toolbarMenuOpen`→`zIndex:20`，别改 Panel。
- `zoomScale.ts` 唯一比例尺（100%＝raw 0.65、5%~100%、`COMPACT_START_PERCENT=20`）；禁 CSS transition:transform；视觉变量写画布最外层 CSS 变量，`KnowledgeCard` 两层壳；禁 `scale(1/zoom)`/`lodZoom` 台阶。
- `lod.ts` 退场序列分位铺 100%→20%（滞回/树根恒留/pin/选中强制，渐隐 240ms）；`hidden` 只渲染不落盘；禁离散档位；P1.9 碰撞抽稀不改坐标；**P2 多级布局插值不做**。
- 画布只读 `computeCanvasReadOnly(zoom,hidden)`＝`!isAtMaxZoom || hidden>0`，唯一写闸门 `guardCanvasEdit`；`DENSITY_STEP_SCALING_ENABLED=false` 禁改回 true；`MAX_WHEEL_DELTA=80`；`CanvasZoomSlider` 与只读 banner 同挂 top-center Panel。
- 水平镜像唯一源 `mirrorSelection.ts`（两次幂等）；`selectSubtree.ts` 只写 `nodes[].selected`；左侧节点树 `domain/graph/nodeTree.ts` 顶层「当前房间」虚拟根、`origin='room-child'` 首子、游离节点恒末尾不可排序；`treeOrder` 唯一源 `treeOrder.ts`；默认折叠+`topomind_node_tree_expanded_v2`；`NodeTreePanel` 只给 `:root` 写 `--tm-node-tree-offset=280px`；触发按钮可上下拖动并避开状态抽屉。
- 设计/CSS：单色制，浅色 `--color-primary`==`--color-accent`(`#0969da`) 勿"修复"；颜色只在 `tokens.css`；**`--color-background-primary` 未定义 ⇒ 背景一律 `--color-surface`**；插件门禁禁 builtin/`shared/` 引用 `@/stores/*`。
- 右栏浮层：`#app-layout` 不得 flex 两栏；`#graph-panel` 必须 `absolute inset-0 isolate overflow-clip`；右栏两种形态都 `absolute`+`z-30`，折叠只 `hidden`；层级 画布 0 < 右栏 30 < 右键 50 < 轻量浮层 60 < 弹窗 10000 < 确认框 99999。全局弹窗根常驻 `LinkDocumentDialog` 外壳未打开 `return null`，数据 hook 必须在条件挂载的 `LinkDocumentDialogBody` 内。右侧列表视觉语言唯一源 `shared/ui/panelList.tsx`（门禁第 37 组）；画布状态抽屉在 `LodControl.tsx` top-left、折叠时 DOM 常驻；学习统计算法唯一源 `learningAnalytics.ts`，热力图 `HEAT_CELL_SIZE=13`。
- 右栏自动显隐（门禁第 49 组）：统一走 `rightPanelStore.applyRightPanelAutoVisibility(hasDocument)`；有文档只认 `data.hasDetail === true`，`linkedDocuments` 不算；真实画布点击才自动折叠（带事件），程序化 `graph.onPaneClick()` 不触发。卡片链环按钮是显式展开入口：先展开+切详情，再发 `requestLinkedView`。pin 短路放 store 内，`collapseRightPanel` 也拦；空状态必须保留 pin 入口。

## 跨房间批量移动（勿回退，详见 2026-11-17.md）
- 落点唯一源 `electron/services/room-placement-service.js` 的 `planRoomPlacement`：整批只施加同一个 (dx,dy)，原位不重叠零位移，重叠时按环就近试探空白区；**禁退回「全房间包围盒右侧」**。`childRect` 统一处理缺省坐标/尺寸。`_fs_moveTopoNodesToRoom` 第 5 参 `options.positionsByNode` 只服务撤销恢复，返回 `positions` 必带；内部连线保留、跨界连线丢弃的边界集合运算别改。
- 目标房间搜索唯一 IPC `fs:listRoomNodeTargets`（全库按逻辑 meta children 枚举 + 渲染层本地过滤），`NodeMoveToRoomDialog` 面包屑/上一层/子房间列表与搜索共存；防环必须同时覆盖源房间、被移动节点及其后代。别绕过 `graphMetaService` 直接读 `_graph.json`。
- **多选右键铁律**：`useGraphPageActions` 打开菜单时冻结 `selectedIds` 快照，node/pane/selection 三类右键共用；`useNodeMoveToRoom` 只认显式 nodeIds（`buildMoveState`/`openMoveToRoom(nodeId,snapshot)`/`openMoveIdsToRoom(snapshot)`），禁在点击菜单项时回读 store 的 `selectedNodeIds`。别改成订阅选中态。
- xyflow 12 多选渲染 `.react-flow__nodesselection-rect`（`pointer-events:all`）吞右键：Pane 的 `wrapHandler` 只认 `target===pane`，节点回调只认 node，**必须接 `onSelectionContextMenu`** + 容器级兜底（三回调都 `stopPropagation`，只在被吞时冒泡）。选区层单选也会覆盖节点 → `openSelectionMenu` 按数量分流，1 个回落完整节点菜单，多个走批量菜单。`graphEventHandlers.onNodeContextMenu` 禁无条件 `selectNode`，唯一决策源 `hooks/useGraph/contextMenuSelection.ts` 的 `shouldResetSelectionOnContextMenu`。
- **移动撤销/前进**：`toastStore.pushToast` 必须把 `action` 写进条目（曾漏解构导致所有 toast 撤销按钮从未渲染）。运行时双栈 `nodeMoveHistoryStore`（不落盘、不进 zundo，因 `loadRoom` 会清 zundo 且改磁盘目录）；条目只更新 moved/positions，房间方向恒为原始 source→target。撤销带 `positionsByNode` 写回原坐标；前进不带 positions，靠「撤销已还原目标房间」让后端重算落点（坐标与第一次一致）。toast 撤销与常驻按钮共用 `undoMove()`。
- **撤销/前进不得切房间**：三处刷新一律 `graph.refreshCurrentRoom()`（读会话当前 roomPath + 保留节点布局与视口），**禁 `graph.loadRoom(entry.sourceRoomPath)` 等硬编码路径**，否则画布显示 A、面包屑仍是 B，`navigateToChildRoom` 基于 B 解析路径导致再也进不去 B。
- 常驻按钮在 `LodControl` 标题栏下方工具条（必须排在 `data-tm-canvas-status-body` 之前），`data-tm-move-undo/redo` + 计数属性 DOM 常驻，只读期置灰；回调走 `canvasProps → GraphCanvas → LodControl`。
- 专项验证 `scripts/verify-multi-select-move.mjs`：纯函数 esbuild 真跑（保留 `['A','B','C']` vs 旧实现退化 `['B']`）、移动/撤销/前进/再撤销坐标闭环、stub zustand 真跑历史栈、三类右键与按钮接线硬编码断言、多轮反向验证（移除接线 exit 1 → 原子恢复 + sha256 复核）。

## 已知未修 / 待办
- **hierarchy 已修（第 47 组）**：`graphHierarchy.ts` 的 `attach` 只重算 `edge.target` 子树（旧实现从 parent 全量重遍历，宽树 O(N²)）；5000 节点星形 `buildHierarchy` 1401.7→3.5ms、full/mid LOD 2092.9→17.2 / 2763.1→49.3ms。门禁含独立 BFS oracle + `Map.set` 线性计数断言 + 两次反向验证，**别改回从 source 起遍历**。
- 多选 P1 剩余核查后不做：rAF 合并、订阅合并、关 `elevateNodesOnSelect`；右栏 `useDeferredValue` 防抖早已实现。真实 5k+ 拖框基线待宿主日志。
- 监控边界：单日查询、页面 5000 条窗口、趋势前半/后半、无越线告警；阈值 0.6 系数待 5k+ 真实样本再判。
