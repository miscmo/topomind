# TopoMind 长期约定（细节见 .workbuddy/memory/2026-11-14.md 及更早日志）

## 性能监控系统（勿回退，详见 2026-11-14.md）
- 四层：`shared/observability/performanceContract.ts`（唯一真源）→ `core/performance-log.ts`（上报）→ `performanceStatistics.ts`（纯函数）→ `plugins/builtin/monitor/performance/`（视图）。样本从 `action='性能:记录'` 日志反解，宿主 `PerformanceApi` 只支持单日，别改成独立存储除非用户要求。
- 注册表 6 分类 **21 指标**，含 `thresholdMs/description/sampleRate/minIntervalMs`；`PERFORMANCE_METRICS` 的 camelCase 映射与 `mark/take/logPerformanceMetric` 旧契约必须保留；颜色只用 `tokens.css` 变量，禁 hex。
- 画布动作是 `params.operation` 维度（`CANVAS_OPERATIONS`/`THRESHOLDS`/`LABELS` 共 20 项），**禁每动作造指标 id**；阈值写回 `params.thresholdMs`，`extractPerformanceSamples` 优先读。`shouldReport` 里 `if (options.force || options.success === false) return true` 别删（第 38 组字面断言）。
- 新埋点只用 `measurePerformance`/`startPerformanceSpan`/`startCanvasSpan`；禁自算 `performance.now()`/拼 success；`main.tsx` 首帧前启动 `app_startup`+`long_task` 自动观测。
- `isSlowSample` = `success && durationMs > thresholdMs`；**失败样本永远不算慢**（反向验证过）。`filterPerformanceSamples` 必须与 `DEFAULT_PERFORMANCE_FILTERS` 合并。
- `thresholdForScale` 只在埋点侧算好写进 `params.thresholdMs`，**绝不改 `isSlowSample` 语义**；只对 `SCALE_ADJUSTED_OPERATIONS` 对数放宽（上限 8 倍），交互类固定阈值。
- 标定闭环：`computeScaleCalibration`/`computeCalibrationSummary`（四类判定，失败样本不进 P95 与慢率分母）+ `scripts/analyze-performance-scale.mts`（npm `perf:calibrate`；`--input` JSON/JSONL/`{samples}`、`--out`、`--strict`、无输入用固定 seed 合成基准）。CLI 必须 esbuild 打包加载（源码无扩展名相对导入，Node strip-types 直跑断链）；报告是调参参考，不自动改契约。`--input` 也直接吃宿主日志 JSONL（顶层有 `action` 即日志行 → 复用 `extractPerformanceSamples`，label 标反解条数）；页面工具条「导出样本」产出 `{samples:[...]}`，`ScaleCalibrationPanel` 把四类判定与建议倍数摆到页面（基于**未筛选** samples）；`performanceMetrics.ts` 的 `asRecord` 兼容字符串 params，勿删（详见 2026-11-15.md）。
- `saveLater/saveNow` 每次同步跑全量 `buildMetaFromNodesEdges`（O(N+E)）；`graphOperations.ts` 包 `graph_meta_build`、`storage/service.ts` 的 save 回调包 `graph_meta_flush`（只计 IPC，不含 debounce）。`graphStore.getState()` 可 O(1) 取 nodes/edges/selectedCount/viewport；统一走 `readCanvasScale()`，**必须容忍 mock store 缺字段**。
- 手势逐帧只更新 ref、结束上报一条，`endGesture` 在 `await saveLater` 之前；`SCALE_BUCKETS` 左闭右开、`perUnitMs`、`computeScaleSensitivity`（相邻桶 P95 涨幅 ≥50% 标劣化）、`groupByTrace`（contextKey+2s 归并）。
- 查询/LOD：`useSemanticLod` 的 `plan` useMemo 包 `canvas_lod`（缓存命中不上报）；`NodeSearchBox`→search，`handleSearchSelectNode`/`NodeTreePanel.focusNode`→locate，`loadChildRoom`→tree_expand；`setCenter` 300ms 动画由手势样本覆盖，不伪造耗时。
- `public/api.ts` 新字段一律可选；页面 `normalizeDefinition/normalizeSample` 补 category/threshold/params；统计层用宽松 `StatisticsMetricDefinition`；SVG `style={{fill/stroke}}`+`color-mix`，禁 `${color}16`。
- `PerformanceTab` 只做编排、`resolvedActive` 纯派生零 effect；组件在 `performance/` 十+文件，慢样本面板有「生效阈值」列。门禁第 38/39/40/41/42 组（静态+esbuild 真跑；42 组还 `spawnSync` 端到端跑 CLI 吃日志 JSONL；**指标数 21 / 13 条链路硬编码**，扩指标必同步）+ `verify:plugins`。

## 门禁
- 顺序：`typecheck` → `node --check` → `verify:critical`（末行 `Critical regression checks verified`）→ `vite build --outDir outputs/.tmp-build-N` 后 cp 到 `dist/` → 一次 `verify:linked:gui`（读 dist，改源码必重建）。
- 改能力必同步 `verify-critical-regressions.mts` 断言具体字段 + **反向验证**（旧实现 exit 1 → 原子恢复 + sha256 复核）；纯函数须 esbuild 真跑；`verify:plugins` 的 SSR 守卫硬编码路径与文案。
- Node 22 用 `--experimental-strip-types --experimental-specifier-resolution=node` 跑 `.mts`；esbuild 是 vite 传递依赖。GUI Electron 三禁用 flag（`--disable-background-timer-throttling` 等）；`elementsFromPoint` 只比相对 index；CDP 超时换干净端口；EPERM→Defender 排除；个人目录删除→回收站+备份+sha256+每批 10 个；GUI 时序抖动复跑确认；`outputs/` 删除常被 `SAFE_DELETE_FAIL_CLOSED` 拦截，不绕过。

## 性能契约（勿回退）
- 新建 `createChildNodeOptimistic` 零 await、同步 `setNodes([...store.nodes,newNode])`（未变更保持引用）、`void saveLater`；禁回灌 `loadRoom`/`saveNow`/全量 `setNodes(map(...))`；唯一构造源 `buildCreatedKnowledgeNode`。
- 删除 `deleteChildNode` 只做 `await storage.deleteCard` → `temporal.pause()` 包 `removeNodes`+`removeEdgesByNodeIds` → `void saveLater`。批量样式唯一源 `applyNodeStylePatch`/`clearNodeStyles`（一次遍历、未变更保持引用），各只一次 `setNodes`。
- 全量扫描合理保留：换房间/导航/跨房间移动/关闭 flush/`buildMetaFromNodesEdges`/`documentPresence`/`importKB`。**`Delete/Backspace` 键删除不进回收站**，未改、待用户确认。

## 存储 / 字段
- 格式边界唯一 `graph-meta-service.js` 的 `read/writeGraphMeta`；禁主进程直读 `_graph.json.children`。v2＝索引 `{version:2,zoom,pan}`+`nodes/edges-0..15.json`（FNV-1a%16、空桶不落盘、索引最后写）；未知 version 抛错，v1 不改写。
- **字段白名单 7 处**：`types/graph.ts`、`domain/graph/model.ts`、`graphMapper` 双向、`normalizeGraphMeta.ts`、`core/storage/file.ts`、`core/fs-backend.ts`、`graphBuilder`；只加返回类型不算。配置顶层字段另须 `normalizeConfig`+`writeConfig`+hydrate。
- 草稿正文绝不进 localStorage；`GraphPage` 在 JSX 前调 `useGraphPageActions`；链内 hook 不可在 Provider 外用 `useGraphContext()`；Vite OOM 由 `optimizeDeps.entries:['index.html']` 根治。

## 文档 / 双链（要点，详见日志）
- docId＝`doc_`+32hex；关联 `{docId,cardRef,title}`≤8 只记 `child.linkedDocuments`；写库必经 `createLinkedDocumentWriter`。**ownerCardPath 铁律**：右栏/草稿/附件/缓存键一律 `documentCardPath`；面包屑唯一 `formatDocumentSource`；开 chip 先 `flushDocumentSave()`→查锁→`enterRoomInTab`。
- 统一资源树唯一实现 `electron/services/unified-document-tree-service.js`（纯 ESM、IO 注入）；key 只由 `parseUnifiedTreeKey`/`cardTreeKey`/`documentTreeKey` 编解码；`buildSubordinateForest` source=父→target=子，多父/环/超 100 层降级 related 不入。
- **剪枝铁律**：`documentPresence` TTL 目录级探测，只读 tree.json 清单、不读 .tdoc 正文、不写索引；`isRelevant` 同判物理后代与 forest 下溯连线子树；`origin` 徽标**必须第二行**；`resolveDocumentPath` 补连线祖先链。
- 搜索走派生索引 `.topomind/document-tree-index.json`（stat 签名增量、首次搜索才建），`if (!q) return []` 硬约束；IPC 四层同步 `preload.js`+`main.js`→`file-service.js`→`fs-backend.ts`→`storage/file.ts`(`requireRootDir()`)→`service.ts`→`types.ts`；前端 `unifiedTree/` 惰性缓存+inflight。旧契约：8 篇上限、`excludeDocId`、`dialog.links` 兜底、`data-tm-*` 选择器；第 27/28 组 + GUI 阶段 T/U。

## 编辑器 / 连线 / 缩放 / 多选 / UI（要点，详见日志）
- 勿在 `appendTransaction` 同步改文档（停输入~1s/blur/destroy 批量 flush）；浮层 portal body；公式唯一入口 `mathRender.ts`；`titleDecorations.ts` 唯一装饰源。锚点归边 `EdgeAnchor{u,v}`，边框交点 `offsetBorderPoints` 外推 6px；`relationLabel` 贯通 7 处白名单；关系仅 related/subordinate（source=父→target=子），树强校验唯一 `graphHierarchy.ts`（违规降级 related 不删边）；**从属边不要双线轨道/层级徽标**。
- 关系浮层贴连线终点：捕获阶段记 `mouseup/touchend`，共用 `CompactRelationPopup`（`z-[60]`、视口钳位、无遮罩），禁回灌居中模态/`z-[99998]`；工具栏下拉按需提升 `toolbarMenuOpen`→`zIndex:20`，别改 Panel。
- `zoomScale.ts` 唯一比例尺（100%＝raw 0.65、5%~100%、`COMPACT_START_PERCENT=20`）；**禁 CSS transition:transform**；视觉变量按连续 zoom 写画布最外层 CSS 变量（零重渲染），`KnowledgeCard` 两层壳（glyph-layer 唯一 `scale(var(--tm-glyph-comp))`），禁 `scale(1/zoom)`/`lodZoom` 台阶。
- `lod.ts` 退场序列分位铺 100%→20%（滞回/树根恒留/pin/选中强制，渐隐 240ms）；`hidden` 只渲染不落盘；禁离散档位/按深度分配；`skeletonIds` 只依赖层级。P1.9 碰撞抽稀不改坐标、100% 恒等点不裁、父裁连带子树；**P2 多级布局插值不做**。
- 画布只读 `computeCanvasReadOnly(zoom,hidden)`＝`!isAtMaxZoom || hidden>0`，唯一写闸门 `useGraph.ts` 的 `guardCanvasEdit`；紧凑区可见集合冻结+跳过抽稀+`displayPercent` 回吐真实值；`DENSITY_STEP_SCALING_ENABLED=false` **禁改回 true**；`MAX_WHEEL_DELTA=80`；`CanvasZoomSlider` 与只读 banner 同挂 top-center Panel。
- 水平镜像唯一源 `mirrorSelection.ts`（中轴＝选中包围盒中点，锚点只翻选中端 `u→1-u`，`curveControl` 两端全选中 `v→-v`，两次幂等）；选中子树 `selectSubtree.ts` 只写 `nodes[].selected`。左侧节点树：`domain/graph/nodeTree.ts` 顶层「当前房间」虚拟根、`origin='room-child'` 首子、游离节点恒末尾不可排序；`treeOrder` 贯通 7 处白名单、唯一源 `treeOrder.ts`；默认折叠+`topomind_node_tree_expanded_v2`；`buildNodeTree({expandedKeys})` 懒加载，`useNodeTree` 返 fullTree/visibleTree；`NodeTreePanel` 只给 `:root` 写 `--tm-node-tree-offset=280px` + `base.css` 一条 panel `margin-left !important`。
- 设计/CSS：单色制，浅色 `--color-primary`==`--color-accent`(`#0969da`) 勿"修复"；颜色只在 `tokens.css`；用 `color-mix` 不用透明度修饰符；**`--color-background-primary` 未定义 ⇒ 背景一律 `--color-surface`**；插件门禁禁 builtin/`shared/` 引用 `@/stores/*`。
- 右栏浮层：`#app-layout` 不得 flex 两栏；`#graph-panel` 必须 `absolute inset-0 isolate overflow-clip`；右栏两种形态都 `absolute`+`z-30`，折叠只 `hidden`；层级 画布 0 < 右栏 30 < 右键 50 < 轻量浮层 60 < 弹窗 10000 < 确认框 99999；保留 `${collapsed ? 'hidden' : 'flex'}`。全局弹窗启动期：根常驻 `LinkDocumentDialog` 外壳未打开 `return null`，数据 hook 必须在条件挂载的 `LinkDocumentDialogBody`（`key=nodeId:cardPath`）内；`requireRootDir()` 抛错不得静默返回空。
- 右侧列表视觉语言唯一源 `shared/ui/panelList.tsx`（6 处共用），旧 `title`/`data-tm-*` 选择器零改动，门禁第 37 组；画布状态抽屉在 `LodControl.tsx` top-left Panel、折叠时 DOM 常驻；学习统计算法唯一源 `shared/utils/learningAnalytics.ts`，`<h1>学习统计</h1>` loading 首屏可见，热力图 `HEAT_CELL_SIZE=13`+`HeatCell`+accent `color-mix`，当日明细＝48 格半小时热力图。
