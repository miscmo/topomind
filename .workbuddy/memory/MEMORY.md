# TopoMind 铁律（细节与验证过程见 `.workbuddy/memory/2026-11-*.md`）

## 门禁
`typecheck` → `node --check` → `verify:critical` → `verify:plugins` → `vite build --outDir outputs/.tmp-build-N` → 拷 `dist/` → `verify:linked:gui`。改能力必同步断言组 + 反向验证（旧实现 exit 1 → 原子恢复 + sha256）；纯函数 esbuild 真跑。Node22 `.mts` 需 `--experimental-strip-types --experimental-specifier-resolution=node`。GUI 三禁用 flag；CDP 超时换端口；EPERM→Defender 排除；个人目录删除→回收站+备份+sha256+每批10；`outputs/` 删除被 `SAFE_DELETE_FAIL_CLOSED` 拦不绕过。用户要求「只测当前 bug」时只跑定向脚本。

## 性能（勿回退）
唯一真源 `performanceContract.ts` → `core/performance-log.ts` → `performanceStatistics.ts` → monitor 插件；样本从 `action='性能:记录'` 反解。注册表 6 类 21 指标，画布动作走 `params.operation` 维度，阈值写回 `params.thresholdMs`。新埋点只用 `measurePerformance/startPerformanceSpan/startCanvasSpan`；`isSlowSample=success&&durationMs>thresholdMs`；`filterPerformanceSamples` 必须合并 `DEFAULT_PERFORMANCE_FILTERS`；`shouldReport` 的 force/fail 短路别删。`SCALE_ADJUSTED_OPERATIONS` 仅 5 项，改清单同步第40/44组。手势耗时唯一 `gestureTiming.ts`；标定 CLI 必须 esbuild 打包。`PerformanceTab` 只编排、零 effect；`detail_save` 0.2；`public/api.ts` 新字段可选；颜色只用 `tokens.css`+`color-mix`。多选选中态唯一写入 `graphStore.applySelectionChanges`（禁回 `setNodes`）。LOD 签名满缩放**必须保留 selectedNodeId**、只剔除 selectedKey；满缩放短路只跳 hidden/折叠/边遍历。`graphHierarchy.ts` 的 `attach` 只重算 `edge.target` 子树，禁改回从 source 遍历。其余：`useSemanticLod` 单遍、`performanceStarts` 1000ms TTL、`inflightGraphRef`、`readCanvasScale()` 容忍 mock。

## 房间 / 存储（勿回退）
摘要唯一 `room-summary-service.js`；格式边界唯一 `graph-meta-service.js` 的 `read/writeGraphMeta`（v2 索引 + `nodes/edges-0..15.json`，FNV-1a%16，未知 version 抛错，v1 不改写）。`roomLoader.ts` 只调一次 `graphMetaToRoomGraph`，`replaceGraph` 不重复 `buildNodesMap`。**`loadRoom` 不改 tab `roomPath/roomHistory` ⇒ 所有原地刷新（含移动撤销/前进）必须 `graph.refreshCurrentRoom()`，禁传源/目标路径**。新建零 await；删除→`temporal.pause()`→`void saveLater`；批量样式唯一 `applyNodeStylePatch/clearNodeStyles`；禁回灌 `loadRoom/saveNow/全量 setNodes(map)`。字段白名单 7 处（`types/graph.ts`、`domain/graph/model.ts`、`graphMapper` 双向、`normalizeGraphMeta.ts`、`core/storage/file.ts`、`core/fs-backend.ts`、`graphBuilder`）；草稿正文不进 localStorage；`requireRootDir()` 抛错不静默返回空。全量扫描合理保留：换房间/导航/跨房间移动/关闭 flush/导入。刻意未做：两次 IPC 合并、`saveLater` 合并 meta、切换房间前置串行保存。

## 文档 / 双链
`docId=doc_+32hex`，关联≤8 只记 `child.linkedDocuments`，写库必经 `createLinkedDocumentWriter`。**ownerCardPath 铁律**：右栏/草稿/附件/缓存键一律 `documentCardPath`；面包屑唯一 `formatDocumentSource`；开 chip 先 `flushDocumentSave()`→查锁→`enterRoomInTab`。资源树唯一 `unified-document-tree-service.js`，key 只由 `parseUnifiedTreeKey/cardTreeKey/documentTreeKey` 编解码；`buildSubordinateForest` source=父→target=子，多父/环/超100层降级 related。`documentPresence` TTL 目录级剪枝（只读 tree.json、不读正文、不写索引），`isRelevant` 同判物理后代与 forest 下溯，`origin` 徽标第二行，搜索走派生索引且 `if(!q) return []`；旧契约 8 篇上限 / `excludeDocId` / `data-tm-*`。

## 编辑器 / 画布 / UI
勿在 `appendTransaction` 同步改文档；公式唯一 `mathRender.ts`；装饰唯一 `titleDecorations.ts`。**粘贴铁律**：应用内复制带 `blocknote/html` ⇒ 直接 `defaultPasteHandler()`（须早于清洗链）；兜底清洗链 `mathPaste.ts` 的 `ALLOWED_TAGS`/`KNOWN_HTML_TAGS` 必须同时覆盖 checkbox input、媒体(audio/video/embed/source/track)、结构(details/summary/figure/figcaption)，`ALLOWED_ATTR` 必须含 style/open/controls 等，否则变字面文本或丢颜色；`style` 取值只能由 `restrictInlineStyle` hook 放行 color/background-color/text-align（DOMPurify 不校验 CSS 值），`data-*` 默认全放行；`hasMeaningfulHtmlStructure` 正则须含上述标签；docLink external renderer 必须带 `data-inline-content-type/data-doc-id/data-title`；代码 `<xxx>` 仍必须转义。**斜杠菜单**：`slashMenuItems` 合并默认项/多列项/自定义项后**必须过 `groupSlashMenuItems` 稳定归拢**（BlockNote `SuggestionMenu` 用 `key={group}` 且只在 group 变化时插标题，group 交替 ⇒ 两个 `key="基础"` 触发 duplicate key；`filterSuggestionItems` 保序，归拢对查询子集同样有效）。锚点归边 `EdgeAnchor{u,v}`；`relationLabel` 7 处白名单；关系仅 related/subordinate，树校验唯一 `graphHierarchy.ts`（违规降级不删边）；从属边不要双线轨道/徽标。`zoomScale.ts` 唯一比例尺（100%=raw 0.65，`COMPACT_START_PERCENT=20`），禁 transform transition / `scale(1/zoom)` / `lodZoom` 台阶。画布只读 `computeCanvasReadOnly`，唯一写闸门 `guardCanvasEdit`，`DENSITY_STEP_SCALING_ENABLED=false`，`MAX_WHEEL_DELTA=80`。`lod.ts` 退场 100%→20%（滞回/树根恒留/pin/选中，240ms），`hidden` 只渲染不落盘，P2 多级布局插值不做。镜像唯一 `mirrorSelection.ts`，树序唯一 `treeOrder.ts`。设计：单色制，浅色 `--color-primary`==`--color-accent`(`#0969da`) 勿"修复"；颜色只在 `tokens.css`；`--color-background-primary` 未定义 ⇒ 用 `--color-surface`；禁 builtin/`shared/` 引用 `@/stores/*`。右栏：`#app-layout` 不得 flex 两栏；`#graph-panel` `absolute inset-0 isolate overflow-clip`；右栏 `absolute`+`z-30`、折叠只 `hidden`；层级 0<30<50<60<10000<99999；`LinkDocumentDialog` 数据 hook 放条件挂载 Body；列表视觉唯一 `shared/ui/panelList.tsx`。自动显隐统一 `applyRightPanelAutoVisibility`，只认 `data.hasDetail===true`，真实画布点击才折叠，pin 短路放 store 内。

## 跨房间批量移动（勿回退）
落点唯一 `planRoomPlacement`（整批同一个 (dx,dy)、环就近试探；禁退回包围盒右侧）；`_fs_moveTopoNodesToRoom` 第5参 `positionsByNode` 只服务撤销，返回 `positions` 必带。目标搜索唯一 IPC `fs:listRoomNodeTargets`，防环覆盖源房间+节点及后代，别绕过 `graphMetaService`。多选右键：打开菜单冻结 `selectedIds` 快照，`useNodeMoveToRoom` 只认显式 nodeIds；**必须接 `onSelectionContextMenu`** + 容器兜底（xyflow nodesselection-rect 吞右键），`openSelectionMenu` 按数量分流；`onNodeContextMenu` 决策源 `contextMenuSelection.ts`。撤销/前进：`pushToast` 必须写 `action`；`nodeMoveHistoryStore` 运行时双栈（不落盘、不进 zundo），撤销带 `positionsByNode`、前进不带；toast 与常驻按钮共用 `undoMove()`；三处刷新一律 `refreshCurrentRoom()` 禁切房间。常驻按钮在 `LodControl` 工具条、`data-tm-canvas-status-body` 之前。

## 全局导航层（勿回退）
`<NavRail />` 只在 `App.tsx` 挂一次，`absolute inset-y-0 left-0 z-40` 浮层；
**任何页面都不得把 `#app-layout` 改成 flex 两栏**，`GraphPage` / `GraphCanvas`
不得订阅 `layoutStore`。非画布视图 docked 让位靠
`html[data-tm-nav-rail-docked='true'] [data-tm-app-view]` 的 `left`；
画布页展开只让节点树 / top-left 状态抽屉右移（`data-tm-nav-rail-open`），
`data-tm-immersive` 隐藏诊断浮层并把 `.bn-container` 居中 820px。
`closePanel()` 只关二级面板（无 peek 复位）；插件 `contributes.navItems` 走
`executeCommand(openCommand)` 静态发现，只存 `staticNavItemsById`，
**禁并入 `listStaticRecords()`**（旧计数契约）。
**2026-11-21 显隐重构**：唯一状态 `layoutStore.railVisible`（全局二态，
持久化 `topomind_navigation_v2`，兼容旧 v1 的 `railMode:'hidden'`），唯一入口是
标题栏 `data-tm-nav-rail-toggle`（`aria-label` 收起/展开全局导航栏），
首页/画布/系统页行为一致。以下全部删除且**禁回灌**：6px 边缘触发条、
鼠标靠左唤出、`Ctrl+B`、NavRail 内 pin/收起按钮、设置页三态控件、
专注模式隐式隐藏导航栏、`railPeeking` / `railMode` / `NavRailMode`。
标题栏不再有 `折叠/展开右侧面板` 与 `右侧面板分区`；`Ctrl+Tab` 仅作键盘
可达性与 GUI 夹具入口（不是 UI 按钮）。`verify-critical` 第 58 / 60 / 61 组
+ GUI 阶段 AF / AI 是门禁；规范见 `docs/design/ui-control-system.md` §8.1。

**右栏显隐（勿回退）**：界面无任何手动折叠按钮。按需展开＝点节点文档/关联文档
图标（`applyRightPanelAutoVisibility(true)`）、新建文档（`useDetailDocuments`
里 `expandRightPanel()` + `setRightPanelTab('detail')`）；按需收起＝点空白画布、
拖分隔条过半/双击；**失焦隐藏**在 `RightPanelContainer`，必须只在「焦点确实从
右栏内部移出」时折叠（`hadFocusRef` + `focusout` 延迟一拍），排除 portal
(`[role=dialog]/[role=menu]/[data-tm-keep-right-panel]/.tm-menu`) 与
pinned/maximized。别用全局 pointerdown 直接折叠：会收掉刚展开的右栏。
**`focusout` 的 `relatedTarget === null` 必须直接 return，`activeElement` 为
null/body/html 也不折叠**：编辑器 `blur()` 会走这里，误判会卸载编辑器丢掉
debounce 里未落盘的正文（GUI 阶段 D 起 40+ 条连锁失败）。点画布空白收起
由既有 `applyRightPanelAutoVisibility(false)` 负责，别让失焦逻辑补位。
**样式设置归 SettingsPage**（`data-tm-settings-style` 复用 `StyleSection`）；
`useStyleSettingsModel` 必须用 `useOptionalGraphContext()` 降级（设置页不在
GraphContextProvider 内，`useGraphContext()` 抛错语义保持不变）；右栏 style
分区只留 `data-tm-settings-style-entry` 引导；画布右键「连线样式」跳设置页。
**两层 Provider 都要降级**：`GraphStoreProvider` 只在 `App.tsx` 的 kb 标签页内，
设置页是独立 secondary 视图；model 里 4 处读选中态必须用
`useOptionalGraphStore`（拿不到 Provider 时退到模块级惰性空 store 只读兜底），
只改 GraphContext 会抛 `Missing GraphStoreProvider` 被 ErrorBoundary 整页拦下
（GUI 阶段 AI 连锁失败）。**禁止给设置页再包一层 GraphStoreProvider**
（会造出第二个带 temporal 订阅的画布状态）。`verify-critical` 第 61 组已锁
`useOptionalGraphStore` 与 GUI 崩溃证据，两条都做过反向验证。

## 统一控件契约（勿回退）
三层唯一真源：`tokens.css`（值 + 控件级语义 token / `--z-*`）、`controls.css`
（`.tm-*` 组合与全部交互态）、`shared/ui/controlStyles.ts`（`TM_UI` 常量）。
`main.tsx` 必须 `import './styles/controls.css'`。组件只留布局类，视觉类用
`.tm-*` / `TM_UI`；禁止字面色值、`z-[N]`、`rounded-[Npx]`、手写阴影、`text-[Npx]`；
`controls.css` 禁 `!important`（会覆盖被精确断言的 className）。
`scripts/verify-design-system.mjs` + `design-system-baseline.json` 采用
**存量只减不增**，新增违规 exit 1；`prebuild` 自动跑；`verify-critical` 第 59 组
锁机制本身；规范见 `docs/design/ui-control-system.md`。改 className 前先搜
verify-critical 的整串断言（app-layout / graph-panel / 吸顶层 / `h-4 w-4` 图标）。

## 横向知识库 tab 栏（勿回退）
32px 顶栏（`--titlebar-height`）是 `App.tsx` flex-col 里**唯一允许占流的兄弟**；
下方新增第二条横向条会永久压矮 `#graph-panel`。`TabBar` 只渲染
`tabs.filter(type==='kb')`，系统页仍进 `tabStore` 但由左侧 NavRail 承担入口与激活指示。
顶栏三段：汉堡应用菜单 / tab zone（`ResizeObserver` 唯一测量对象）
+ `--tab-drag-gutter:88px` 拖拽安全带 / 右栏控件 + titlebar widget + 窗口按钮；
所有交互元素 `no-drag`。**禁止给 tab 区设百分比硬限宽**（旧 `--tab-zone-max:60%`
已删）、**禁止「+」按钮**（打开库统一走 NavRail 笔记库面板）。
宽度算法（Chrome 式）：`ResizeObserver` 只能观察 `data-tm-tab-zone`，
绝不能观察 `.tm-tab-strip` 自身（内容自适应宽度 → 正反馈 → 两个库也折叠成下拉）；
`n×min+gap ≤ 可用` 时全部横排、宽度 `clamp(min, 可用/n, max)` 由
`--tab-current-width` 注入；只有全压到 min 仍放不下才出现「⋯N」，激活 tab 恒可见。
**Π 形连体**（不是浮起卡片）：上圆下方、`border-bottom:0`、无 box-shadow、
底色 `--tab-active-bg`（kb 页换 `--color-canvas-bg`）、`::after` 1px 盖住顶栏 border-b；
**前提是顶栏底色比内容区深一档**（github-light `--titlebar-bg:#eaeef2` vs `#ffffff`），
否则活跃 tab 退化成一条普通文字。失焦只降文字/图标对比，不动底色结构。
快捷键 `Alt+1..9` / `Ctrl+PageUp/PageDown`，禁挪用 `Ctrl+Tab`（右栏）与
`Ctrl+1..9`（NavRail）。GUI 依赖的 `应用菜单` / `data-tm-active-view` /
`data-tm-tab-zone` 选择器禁删；右栏折叠按钮与 `右侧面板分区` 已移除
（GUI 夹具改走 `Ctrl+Tab`）。`verify-critical` 第 60 组 + GUI 阶段 AH 12 条
（含「Π 形对比度」实测 `titlebarBg !== bg && bg === graphBg`）是门禁；
规范见 `docs/design/ui-control-system.md` §8 / §8.1（v1.3）。

## 未修
多选 P1 剩余不做（rAF/订阅合并、`elevateNodesOnSelect`）；5k+ 拖框基线待宿主日志。监控：单日/5000 条窗口/趋势前后半/无越线告警，0.6 系数待样本。Delete/Backspace 删除不进回收站未改。
