# TopoMind 长期约定（逐轮细节见 .workbuddy/memory/YYYY-MM-DD.md）

## 验证
- **只测核心**（用户 11-11）：`typecheck`、两验证脚本 `node --check`、`verify:critical`（末行 `Critical regression checks verified`，`save failed` 是 close-guard 预期）、`vite build --outDir /tmp/<新> → cp 到 dist/`、一次 `verify:linked:gui`（读 dist，改源码必重建）。
- 改能力必同步 `verify-critical-regressions.mts` 断言具体字段 + **反向验证**（旧实现 exit 1 → 原子恢复）；纯函数须 esbuild 真跑，勿只查字面量。EPERM 打包→Defender 排除；个人目录删除→回收站+备份+sha256+每批 10 个。

## 存储 / 字段
- 唯一格式边界 `graph-meta-service.js` 的 `read/writeGraphMeta`；禁主进程直读 `_graph.json.children`。v2＝索引 `{version:2,zoom,pan}` + `nodes/edges-0..15.json`（FNV-1a%16、空桶不落盘、索引最后写）；未知 version 抛错，v1 不改写。
- **字段白名单 7 处**：`types/graph.ts`、`domain/graph/model.ts`、`graphMapper` 双向、`normalizeGraphMeta.ts`、`core/storage/file.ts`、`core/fs-backend.ts`、`graphBuilder`；只加返回类型不算。配置顶层字段另须 `normalizeConfig` + `writeConfig` 透传 + hydrate。
- 草稿正文绝不进 localStorage；`GraphPage` 在 JSX 前调 `useGraphPageActions`；链内 hook 不可在 Provider 外用 `useGraphContext()`；Vite OOM 由 `optimizeDeps.entries:['index.html']` 根治。

## 文档 / 双链
- docId＝`doc_`+32hex；关联 `{docId,cardRef,title}`≤8 只记 `child.linkedDocuments`；物理 `card-<id>/_docs/<docId>.tdoc.json`+`tree.json`，写库必经 `createLinkedDocumentWriter`。
- **ownerCardPath 铁律**：右栏/草稿/附件/缓存键一律 `documentCardPath`；面包屑唯一 `formatDocumentSource`；docLink inline 只存 `{docId,title}`；`[[` 用 InputRule+queueMicrotask；开 chip 先 `flushDocumentSave()`→查锁→`enterRoomInTab`。
- `fs:listDocumentRelations` 返 `{incoming,outgoing,parsed,indexed}`；索引 `doc-relations.json` 按 stat 签名增量、丢失自愈。`file-service.js` 依赖 electron.shell；idRemap 必须消费；`mathPaste` ALLOWED_ATTR 含 `data-doc-*`。GUI 候选异步须 waitFor 具体 item、右键须 `dispatchEvent(contextmenu)`。
- 节点内文档路径唯一源 `formatDocumentInNodePath`（沿 `tree.json` 的 parentId 上溯，防缺父/环/64 层）；`documentPathLabel` 在两个选择器里「↳ 路径」单独成行且参与检索；勿顶替 `formatDocumentSource`。

## 编辑器 / 节点
- 勿在 `appendTransaction` 同步改文档：只记脏块 id，停输入~1s/blur/destroy 批量 flush；浮层 portal 到 body；公式唯一入口 `mathRender.ts`；图片对齐 `ImageAlignToolbar` 自监听；顶部工具栏折叠 36↔0、收起只留贴边按钮(right:24/z-50)。
- `titleDecorations.ts` 是装饰唯一事实来源（KnowledgeCard/autoSize 同消费，`signature=JSON.stringify(renderInputs)`）；`cardSizeLimits` MAX_TITLE_LINES=4 / MAX_TITLE_WIDTH_CHARS=20。

## 连线 / 树
- 锚点归边 `EdgeAnchor{u,v}`，边框交点经 `offsetBorderPoints` 外推 6px；nextData 遍历字段并集浅比较+透传，子集一律 `Partial<X>`；`EdgeLabelRenderer` z10、手柄 11；滑杆只 preview、pointerup 一次落盘；Electron 勿 `window.confirm`。
- 关系仅 `related`/`subordinate`，source=父→target=子；规则源 `edgeRelations.ts`（`readEdgeRelationId` 只读盘兼容），`_config.json` 显式保留。树强校验唯一 `graphHierarchy.ts`（唯一父/无环/≤100，违规降级 related 不删边，depth 派生不落盘）；新建连线必须选关系。
- **从属边样式（11-09 回滚，勿加回）**：不要双线轨道/层级徽标，只 `BaseEdge style`；标签由 `showEdgeRelationLabels` 控制。关联边强契约：`mandatoryLabel` 恒显示 + `data-tm-edge-relation-mandatory`。

## 缩放 / LOD（详见 11-09~11 日志）
- `zoomScale.ts` 唯一比例尺：100%＝raw 0.65、5%~100%、`COMPACT_START_PERCENT=20`；滚轮 `clampWheelDelta`+`wheelDeltaStep` 由 rAF 派发；**禁 CSS transition:transform**；端点按显示百分比判定；左下 `ZoomResetButton` 常驻、只 zoomTo、`pointer-events-auto`。
- **P0**：视觉变量按连续 zoom 写画布最外层 CSS 变量（零重渲染），绝不用 `lodZoom` 台阶；`KnowledgeCard` 两层壳（anchor 外层尺寸/Handle/测量/落盘全不动，glyph-layer 内层唯一 `scale(var(--tm-glyph-comp))`）；禁 `scale(1/zoom)` 改节点尺寸。
- 字形唯一源 `glyphScaleForRatio`；紧凑区 `comp=1.3/ratio` → 屏幕倍率恒 1.3（**文字仍保持**，用户选可读性优先于零重叠）。`lod.ts` 按退场序列（游离→深叶→浅主干→树根，父不先于子）分位铺 100%→20%，滞回/树根恒留/pin/选中强制，渐隐关键帧 240ms `both`；`hidden` 只渲染不落盘；**禁离散档位/按深度分配**。
- **永久显示层数**：默认 2、上限 100（`normalizePreservedDepth`）；`skeletonIds` 只依赖层级、禁读坐标，**层数优先于零重叠**；`lodPreferences.ts` 持久化，`useSemanticLod` 写进 signature。
- `lodPressure.ts` 三铁律＝只依赖静态布局+ratio（不看可见集合，否则自激）/ w 有界 / 两端固定；退场顺序仍由语义树唯一决定。折叠徽标 `computeCollapsedCounts` 绝不写 `nodes[].data`，走 `lodCollapseStore`（先写快照再通知）。
- **P1.9 碰撞抽稀**：不改坐标；100% 恒等点绝不裁剪；障碍必须是**所有更高优先级节点**；父被裁连带裁子树。**P2 多级布局插值 / 坐标随 zoom 变：不做**。
- **画布只读**：`computeCanvasReadOnly(zoom,hidden)`＝`!isAtMaxZoom || hidden>0`；`canvasReadOnlyStore` 按 tabId 隔离；**唯一写闸门 `useGraph.ts` 的 `guardCanvasEdit`** 包全部 CRUD/连接/样式/锚点；四条捷径另拦（onConnect onConfirm、格式刷 onEdgeClick、deleteElements、undo/redo+Enter/Tab）；`elementsSelectable` 保留、只读纯视图不落盘。
- **两段镜头**：`LOD_FLOOR_RATIO` 必须从 `COMPACT_START_RATIO` 派生；紧凑区可见集合冻结+跳过碰撞抽稀+`displayPercent` 回吐真实值，**一行坐标都不改**。`DENSITY_STEP_SCALING_ENABLED=false`（用户 20:46「步进慢，恢复上次配置」）→ 应用入口 `zoomStepSensitivityForGraph` 恒 1，滚轮/按钮固定步进；公式保留可一键切回，**禁擅自改回 true**；另一旋钮 `MAX_WHEEL_DELTA=80`。
- **缩放滑动条**：`CanvasZoomSlider.tsx` 与 `CanvasReadOnlyBanner` 同挂 top-center Panel，提示条在上、slider 在下；显隐**只**由 banner 的 `!state.readOnly` 判定（slider 禁自己判只读）；5~100% step1 受控 range → `zoomTo(fromDisplayPercent(p), {duration:0})` 保持 pan、不 fitView、不写坐标。
- 图型 `graphProfiles.ts`（auto/tree/flow/network，用户 off/force 压过图型）；`roomOverview` 三铁律（独立 session/Provider/隐藏 Handle）；`viewportReturn` 按 tab 不落盘。

## 多选 / 布局变换
- **水平镜像**唯一规则源 `mirrorSelection.ts`：中轴＝选中包围盒中点，`x'=2*axis-(x+width)`、y/尺寸/data 不动；**锚点只翻选中端 `u→1-u`**；`curveControl` 两端全选中 `v→-v`；未选中保持引用、两次幂等、<2 返回 null。
- 接线 `selectionMirrorOperations.ts` 一次写回（pause→set→resume→commit 合成一条 undo）；`useGraph` 过 `guardCanvasEdit`；`SelectionMirrorMenu` 是 top-center Panel、**按钮不要忙碌禁用**。
- **选中子树** `selectSubtree.ts`（复用 `buildHierarchy` 沿 subordinate BFS、含根、替换式选中、幂等）；`selectionSubtreeOperations` 只写 `nodes[].selected`，不落盘/不进 undo/**不过写闸门**。菜单单选≥1 即出现，镜像区仍只在≥2 可写时渲染；右键另有「选中子树」。

## 统一资源树（2026-11-11，后续整合查看入口的底座）
- 唯一实现 `electron/services/unified-document-tree-service.js`（纯 ESM、IO 由 deps 注入）：`root / kb:<cardPath> / doc:<cardPath>:<docId> / group:orphans`；**key 对渲染层不透明**，只由 `parseUnifiedTreeKey`/`cardTreeKey`/`documentTreeKey` 编解码，UI 只按 `kind`/`hasChildren`/`origin` 递归。加新分组只改主进程。
- **按层 + 只列有文档的节点**：房间层读父房间 meta（连线子节点）+ 自身 meta（房间森林第一层）+ 自身 tree.json，每层最多 2 份 meta；深层留到下次展开。`buildSubordinateForest(meta)` 是模块级导出纯函数（source=父→target=子、旧值兼容、多父/环/自环/超 100 层降级、related 不入）。
- **剪枝铁律**：`documentPresence` 一次 TTL 缓存的目录级探测，只读 tree.json 清单（`rooms` 自身有文档 / `prefixes` 物理祖先），**不读 .tdoc 正文、不写索引**；`isRelevant` 必须同时判物理后代与**沿 forest 下溯的连线子树**——连线子节点和父是同级目录，前缀判断覆盖不到，否则深层文档点不到。空节点不列；仅作路径的保留并标 `origin='path'`。离散分组同样剪枝。
- **来源区分**：`origin='room'`（房间包含）/ `'subordinate'`（从属连线）/ `'path'`（仅路径），DTO 在 `fs-backend.ts`，视图用 GitBranch 图标 + 副标题行徽标「房间/从属/仅路径」（**徽标必须在第二行**，标题行文本供 GUI 精确匹配）、path 灰显但可展开；诊断 `data-tm-unified-tree-origin/-has-docs`。
- `resolveDocumentPath` 必须按 `forest.parentOf` 补**连线祖先链**，否则 `expandPath` 展开到一半断链；房间子节点的物理链不变。
- 搜索/定位走派生索引 `.topomind/document-tree-index.json`（stat 签名增量、丢失自愈、首次搜索才建），`if (!q) return []` 是硬约束；服务里**禁回灌** `scanDocumentEntries`/`listDocumentCandidates` 全量扫描。
- IPC 四层同步：`preload.js` 白名单与 `main.js` 三通道 → `file-service.js` → `fs-backend.ts`（类型+`_call`）→ `storage/file.ts`（`requireRootDir()`）→ `service.ts`（logger 后 throw）→ `types.ts`。漏一层即回归失败。
- 前端分层 `src/features/documents/unifiedTree/`：`TreeDataSource` 协议 / 适配 / `useUnifiedTree`（惰性、按 key 缓存、inflight 合并、expandPath/refresh、loadCount）/ 搜索 hook / `UnifiedTreeView`+`DocumentCandidateRow`。两个弹窗默认只加载 root 层，输入 query 才 debounce 切平铺。
- **旧契约不得丢**：「↳ 路径」单独成行且参与检索、面包屑唯一源 `formatDocumentSource`、8 篇上限、`excludeDocId`、`dialog.links` 兜底回显、`data-tm-link-document-id/-path`、`data-tm-doc-link-item/-path`。第 27/28 组回归 + GUI 阶段 T/U 锁「默认 1 层 / 连线树逐层」。

## 画布状态抽屉（2026-11-11）
- 面包屑/最近打开/镜头状态三块融合进 `LodControl.tsx` 的 top-left Panel 抽屉；`GraphPage` 不再挂绝对定位层。
- 整体 + 4 区（path/view/recent/details）独立折叠；偏好 `canvasStatusPreferences.ts`（`topomind_canvas_status_v1`、useSyncExternalStore、先写快照再通知）；`CanvasStatusSection` 用 max-height/opacity 折叠且 **DOM 常驻**（GUI 要读隐藏诊断 textContent）。
- **长路径**：控件宽度固定；标题栏只显示「首段 / … / 当前段」+ tooltip；完整链路在「位置」区纵向滚动、逐段可点；折叠态只留标题胶囊。所有 `data-tm-lod-*` 诊断属性与关键文案必须留在 DOM，精简 UI 不得删。

## 学习统计面板（2026-11-11 精简）
- 算法唯一源 `analytics.ts`→`shared/utils/learningAnalytics.ts`，`runtime.ts`/`useLearningRuntimeState.ts` 不动；只改视图。
- 信息架构固定「头部 + 一行筛选 → 今日 Hero → 4 KPI → 热力图/趋势两图 → 按需分布或当日明细」；**禁回灌**英文 eyebrow、功能自述、目标分析/范围观察/结论段、24 小时网格、重复指标卡；5 个关键指标各只出现一次。
- 共用原语 `LearningStatisticsParts.tsx`：**所有热力图共用 `HEAT_CELL_SIZE=13` + `HeatCell` + `heatCellStyle`**（正方形格/gap-1/选中 ring/悬停读数），色阶只用 accent 的 `color-mix`，禁硬编码橙红 hex、禁 `w-full` 拉伸长条。
- `<h1>学习统计</h1>` 必须在 loading 首屏可见（SSR 守卫）。**当天明细是与每日记录同款的半小时热力图**（2×24=48 格，上 :00–:30 / 下 :30–:00，点击有色格才展开 ≤3 条）；唯一算法源 `buildDayHalfHourBuckets`（48 桶/1800s/墙钟分摊/跨午夜折回/防死循环），`appendSessionHours` 仍供范围统计复用，禁回灌 session 长列表。

## 设计 / CSS / 门禁
- 单色制：浅色 `--color-primary`==`--color-accent`(`#0969da`) 勿"修复"，颜色只在 `tokens.css`；CSS 变量不配透明度修饰符（用 color-mix）；BlockNote 内部样式写 `SmartDocumentEditor.css` + `!important`；SVG `style={{fill:'var(--x)'}}`。
- 插件门禁禁 builtin/`shared/` 引用 `@/stores/*`；共享状态放 `src/shared/ui/<Comp>/xxxStore.ts` 或 `src/plugins/public/xxxStore.ts`；runtime guards 用 `loadModuleWithVite()`。
