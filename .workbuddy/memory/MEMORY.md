# TopoMind 长期约定

## 验证手段（每次迭代后必跑）
- 类型：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- 回归：`npm run verify:critical`（末尾 "Critical regression checks verified" 即通过；日志里 "save failed" 是预期分支）、`verify:graph-store`、`verify:plugins:static`
- 构建：`npx vite build`（renderer/main/preload 三阶段）
- **铁律**：删字段/改能力后必须同步回归脚本（`scripts/verify-critical-regressions.mts` 断言具体字段）。曾因删 `canConvertBlockMath` 没同步测试 → 误判"预存 bug"。

## 架构/运行时铁律
- **GraphContextProvider 约束**：`GraphPage.tsx` 在返回 JSX **之前**就调用 `useGraphPageActions({graph})`，而 Provider 只包返回的 JSX → 链内 hook 运行在 Provider **之外**。绝不能直接 `useGraphContext()`，否则抛错 → 「标签加载失败」+「右侧笔记打不开」。需要 `graph` 就由上层作参数传入。
- **Vite 启动卡死**：真元凶是 esbuild 依赖扫描 OOM——项目根堆积的 `build-*/outputs/release/stats.html`（完整 dist 含 index.html）被当扫描入口 → 内存暴涨。修复：`vite.config.js` 的 `optimizeDeps.entries:['index.html']`；陈旧产物应清出工作区。主进程若以纯 Node 启动（缺 app/BrowserWindow），常是继承了 `ELECTRON_RUN_AS_NODE=1`，已在 onstart 用 `startup(...,{env:{...process.env, ELECTRON_RUN_AS_NODE: undefined}})` 剥离。
- **文档草稿存储**：完整正文**绝不**进 localStorage（旧代码整篇写含 base64 图片 → `QuotaExceededError`）。权威副本在 topo（`storage.writeTopoDocument`），关闭/切换由 close-guard flush。`draftStore.partialize` 只持久化 `cardDrafts` 小片段；detail 草稿仅内存态。**勿**引入"删最大历史草稿"eviction（会误删别的文档唯一未保存副本）。
- **打包 EPERM rename**：`win-unpacked.tmp→win-unpacked` 的 EPERM 是 Windows Defender 实时防护锁刚解压的 electron 二进制。根治：管理员 PowerShell `Add-MpPreference -ExclusionPath 'D:\Code\topomind_latest\topomind'` 后再 `npm run build:win`。

## 图谱存储 / `_graph.json`（P0 轻量节点 + P1 分片）
- **唯一格式边界**：`electron/services/graph-meta-service.js` 是「逻辑 meta ↔ 磁盘」的唯一实现（纯 ESM、IO 由 deps 注入，迁移脚本复用同一份）。**禁止**在主进程任何地方直接 `_fs_readJsonFile(_graph.json).children` —— v2 房间索引里根本没有 children，会静默读成空图。已知必须走逻辑读的点：`card-service.readCardChildren`、`_fs_moveTopoNodesToRoom`（读/写/回滚 4 处）、`readRoomNodeSummaries`、`updateCardName`(file.ts)。
- **v2 格式**：`_graph.json = {version:2, zoom, pan, ...}`，节点/边按 id 的 FNV-1a 取模落 `_graph/nodes-<0..15>.json` / `edges-<0..15>.json`，K=16 固定。写侧只覆盖内容变化的分片（键排序后 `JSON.stringify` 比较，消除遍历顺序影响），**索引最后写**（它是格式开关，v1→v2 途中崩溃时磁盘仍是完整 v1）。未知 version 读写都抛错。
- **旧库零改写**：写侧跟随现有格式 —— v1 有数据的旧档继续单文件，只有空/新房间默认 v2；显式升级走 `scripts/migrate-graph-shards.mts`（默认 dry-run，`--apply` 才写、写前备份、真跑往返校验、`--verify` 复核）。
- **P0 轻量节点**：新建节点只写父 `children`，不 mkdir、不写空图；物化由既有 `ensureDir` 在首次写文档/下钻/导入附件时自动发生。摘要用 `existsSync` 短路，不引入 `materialized` 标记。
- **新增节点字段要同步 7 处白名单**：`src/types/graph.ts`、`src/domain/graph/model.ts`(KBNode+RoomGraphNode)、`graphMapper.ts` 双向、`normalizeGraphMeta.ts`、`src/core/storage/file.ts`(FSBGraphChild + convertFSBToGraph + **convertGraphToFSB 的 map 本体**)、`src/core/fs-backend.ts`、`graphBuilder.ts`(buildMetaFromNodesEdges + buildNodes)。`kind` 已按此预留；`buildNodes` 的 type 仍统一 `knowledgeCard`，接形状节点时只改映射 + 注册 nodeTypes。
- **回归必须真跑到读库入口**：`verify-critical-regressions.mts` 用内存 fs 真跑分片读写、esbuild 打包真跑 kind 全链路、真跑 `readCardChildren` 对 v2 房间。反向验证过：注释里保留 `readGraphMeta(...)` 字面量能蒙混静态断言，只有真跑断言拦得住。
- **迁移往返校验必须「边顺序无关」**：v2 读回 edges 按分片桶序 0..15 拼接，与 v1 原数组顺序不同；`migrateRoom` 用严格数组顺序比较会让所有多边房间 100% 误报失败（真实库首轮 6/10 中招，数据其实一条没丢）。统一走 `graphMetaComparisonKey(meta)`（递归排序键 + edges 按 id 排序，丢边/改字段仍严格检出），主进程与迁移脚本 `--verify` 共用一份。**回归样本必须含多条边且跨多个分片**，否则测不到顺序重排。
- **迁移失败要隔离残留分片**：失败时只恢复 `_graph.json` 索引，`_graph/` 目录残留会让脚本「拒绝覆盖未知数据」永久卡住；`quarantineShards()` 把它 rename 到备份区 `<backupDir>/_shards_quarantine/`（保留证据、不删除），`--apply` 前与 catch 里都要调。

## 编辑器：BlockNote / ProseMirror
- **别在 `appendTransaction` 同步改文档**：`setNodeMarkup` 重建 nodeView 打断输入；改为只记脏块 id 进 pending + `return null`，用 `new Plugin({view})` 存 `EditorView`，停止输入~1s/blur/destroy 时按**块 id** 批量 flush（`addToHistory:false`+pluginKey meta 防递归）。
- **浮层一律 portal 到 `document.body`**：`usePortalElement(null)` 返回 body，controller 未传 `portalElement` 走默认 body。给浮层写样式带 `.smart-document-content`/`.bn-block-outer` 前缀**永不成立**，也拿不到 `--topomind-smart-*` 变量；改之前用 `el.matches()` 验一次。
- **侧栏（＋/⠿）垂直对齐用运行时实测**：`Range.selectNodeContents(.bn-inline-content)` 取第一行矩形，以 `SideMenuExtension.referencePos.y` 为基准算 delta 写 inline `margin-top`；容器高度须 `height:auto !important` 覆盖 BlockNote 按 `[data-level]` 写死的 30/108/84/67px。别用菜单自身 `getBoundingClientRect()` 当基准（首帧落位前读到 0）。
- **标题留白是「场景变量」结构**：各级 `--tm-heading-gap-top/-bottom`（em 相对自身字号）由 `.bn-block-outer` 上的 `--tm-heading-gap-{top,bottom}-override` 覆盖：正常 H1~H6 递减（约 40→18px）｜首块 `0`（文档开头不顶空白）｜连续标题固定 `0.4/0.25 × 正文字号 × 间距比`（与级别无关）。文档顶部边距交给 `.bn-editor` 的 24px（写在 `SmartDocumentEditor.css`，勿用 Tailwind 任意变体），不靠标题 padding。侧栏是浮层继承不到 → 由 `SmartDocumentSideMenu.getHeadingGapCategory()` 打 `data-tm-gap-*`。
- **标题阶梯**：H1 1.75 / H2 1.45 / H3 1.25 / H4 1.12 / H5 1.0 / H6 0.9 em（28/23.2/20/17.9/16/14.4px）。按级别写样式**必须** `:has(> h1…h6)`，勿用 `[data-level="N"]`（首个 heading 无该属性，旧 H1 规则从未生效）。`:has()` **不能嵌套** `:has()`。
- **xl-multi-column 坑**：`useCreateBlockNote` 须传 `dictionary:{...zh, multi_column: multiColumnLocales.zh}`（否则 "Multi-column dictionary not found" 整体崩溃）；版本须精确配对 0.51.4↔0.51.4。License `GPL-3.0 OR Proprietary`，闭源商用需订阅。
- **「内容区顶部」统一取 `.bn-editor` 的 padding-top（24px）**：滚动容器 `.tm-smart-editor-scroll` 的 paddingTop 是 0。目录跳转与 scroll-spy 若按滚动容器算，点首块 H1 会把标题顶到容器上沿（顶部留白滚光、字顶像被裁），且该 scrollTop 被 `topomind_scroll_<docKey>` 持久化 → 每次打开都复现（2026-11-04）。统一走 `smartDocumentUtils.getEditorTopInset()`；切文档先 `scrollTop=0`；恢复阅读位置用 `MIN_RESTORE_SCROLL_TOP=48` 过滤历史脏值。**看到「顶部被裁」先量 scrollTop，别只量 padding。**
- **目录控件隐藏只认 `mouseleave`**：`useSmartDocumentEditorModel.handleTocItemClick` 末尾会 `editor.focus()`，目录项按钮失焦 → 冒泡到 `nav` 的 `onBlur`；若把 `onBlur` 也绑到收起逻辑，点击目录项就会「自动隐藏」。触发条/面板只保留 `onMouseEnter` 展开 + `onMouseLeave`（150ms 延迟）隐藏，别绑 `onBlur`。
- **贴右缘浮层别压原生滚动条**：编辑器 `.tm-smart-editor-scroll` 是原生滚动条，宽度靠运行时 `offsetWidth - clientWidth` 实测（Windows 经典 15px，overlay 0），浮层 `right = 滚动条宽 + 6px`；面板 `right` 再加触发条宽，二者右/左沿相接。别写死 `right:0`。
- 行内公式/粘贴/链接拦截等见 `useSmartDocumentEditorModel.ts` 与 `editorLinkInterceptor.ts`。

## 图谱连线
- **锚点归属「边」不归属节点，且只贴节点边框**：`edge.data.sourceAnchor/targetAnchor` = `EdgeAnchor{u,v}`（归一化，至少一个分量为 0/1；空/非法=自动交点；旧存档框内点由 `projectAnchorToBorder` 按像素距离投影到最近边框）。**锚点只决定出线位置/方向，不是线头**（2026-11-04 用户明确纠正，别改回「直接连到锚点」）：两个边框交点一律经 `offsetBorderPoints` 沿连线方向外推 6px 才得到 `sx/sy/tx/ty`，线与边框始终留间隙、线头不与手柄重合。手柄贴 `getEdgeParams` 返回的 `sourceBorder/targetBorder`，工具栏避让也按这两个点算；出线方向统一按交点所在边框判断（已删 `getAnchorSide`/`anchorSideToPosition`）。改边字段必须同步这些持久化点：`normalizeGraphMeta` / `file.ts` 的 `convertFSBToGraph` **与 `convertGraphToFSB` 的 `edges.map` 本体** / `graphMapper` 双向 / `graphBuilder` 保存+加载 / minimap。**只在返回类型里加字段不算数**——曾在 `convertGraphToFSB` 漏写 map 字段，画面生效但 `_graph.json` 从来没有锚点，重开知识库全部复位。
- **回归断言必须跑真实数据往返**：`source.includes('字段名')` 这类源码字面量断言在同文件多函数时会互相掩盖（类型声明/读入函数有该字样就通过）。`verify-critical-regressions.mts` 已用 `esbuild build({write:false})` + data URL import 加载 `file.ts`，真跑 `convertGraphToFSB → JSON 序列化 → convertFSBToGraph` 往返并断言值不丢；已反向验证删掉修复会让回归 exit 1。
- **光测序列化往返还不够，必须测到「写库入口」**：曲线第一版回归只测了 `file.ts` 往返，`updateEdgeStyle`（真正的写库函数）里的 8 字段白名单把新字段整个吞掉 → 设置既不写内存也不落盘，回归全绿。现在 `verify-critical-regressions.mts` 额外用 esbuild 打包 `edgeOperations.ts`、注入假 `storeApi`/`saveLater` 真跑 `updateEdgeStyle`，断言 `setEdges` + `saveLater` 调用数与写入值；bundle 需 `banner: {js:'globalThis.window = globalThis.window || {};'}` 让 log-backend 的 `_api()` 返回 null。已两次反向验证（临时恢复旧白名单）精确 exit 1。
- **「字段白名单/子集类型」是本项目反复出 bug 的模式**：锚点持久化 6 处白名单、`updateEdgeStyle` 8 字段变化检测 + `shouldPersist`、`VaultConfig`/`graphEventHandlers` 手写的 `defaultEdgeStyle` 子集类型，每次加字段都漏。根治方向：① `updateEdgeStyle` 改成构造 `nextData` 后遍历字段并集浅比较 + `Object.entries(style).some(...)` 通用透传；② 子集类型一律改 `Partial<DefaultEdgeStyle>` / `Partial<EdgeStylePatch>` 引用同一份定义。新增字段后别再逐个补白名单。
- **默认样式的历史兼容规则会吞掉新枚举值**：`normalizeDefaultEdgeStyle` 的 `lineMode` 曾写死 `edgeDefaultsVersion===2 && style.lineMode==='smoothstep' ? 'smoothstep' : defaults.lineMode`，新增 `'curve'` 后默认选曲线刷新就被重置成直线；同理 `currentEdgeStyle` 派生、`addEdge`、格式刷快照都要显式带新字段（否则面板无法回显/新建边不继承）。
- **`EdgeLabelRenderer` 内浮层一律 `zIndex:10`**：否则被 `.react-flow__node` 盖住，真实鼠标点不到按钮，但 DOM `.click()` 却能触发 → 极易误判成事件 bug。同层多浮层再分层：锚点手柄 11 > 快捷工具栏 10。
- **`EdgeLabelRenderer` 坐标系就是 flow 单位**（viewport scale 只做视觉缩放）：浮层 `offsetWidth` 读到的布局尺寸可直接与 flow 坐标比较，勿再除 zoom；缩放很小时浮层视觉随之变小是既有行为。选中连线的工具栏走 `EdgeToolbarAnchor` 自动避让两端手柄（上/下/左/右×2 档，`edgeToolbarPlacement.ts` 纯函数）。
- **拖动类交互只在组件内 preview**：pointerup 才一次性写 store + 落盘；每帧 `setEdges` 会产生大量撤销历史与保存。右侧样式滑杆同理（草稿 + pointerup/keyup/blur 一次提交），别用 range 的 `onChange` 直写。
- **曲线 `u` 区间 `[0.25,0.75]` 是数学边界，别为「位置自由度」放宽**：二次贝塞尔 `C=2P-(S+T)/2`，C 沿连线投影 = `L·(2u-0.5)`；`u<0.25` 会把 C 推到起点外侧 → 端点切线反向、曲线回勾钻回节点（0.15 时实测回勾约 3% 线长）。`domain/graph/edgeCurve.ts` 的 `CURVE_POSITION_MIN/MAX` 是唯一来源，拖拽反推与面板 hint 都引用它。要更大范围就得改三次贝塞尔，不能只调常量。
- **Electron 里不要 `window.confirm`**：破坏性操作走 `useConfirmStore.getState().open()` / `useConfirmStore((s)=>s.open)`，`ConfirmModal` 已在 `App.tsx` 全局挂载（overlay z-[99999]）。当前只有浮窗工具栏「删除连线」加了确认，右键菜单 `useEdgeActions.handleEdgeDelete`（走 `deleteElements`）仍是一键生效。
- **`EdgeToolbarAnchor` 内的下拉/展开面板必须 `position:absolute`**：它用 ResizeObserver 量 `boxRef`（工具栏 children 容器）的 offsetWidth/Height 做避让重算；任何参与文档流的新内容都会撑大工具栏 → 展开/收起时浮层位置跳动。`QuickEdgeStylePopover` 即按此挂在 `relative` 的工具栏根 div 下方，并自带 `pointerEvents:'all'`（`.react-flow__edgelabel-renderer` 是 none）。浮窗内所有 range 都必须「草稿 + pointerup/keyup/blur 一次提交」。
- **连线预设色板只有一份**：`domain/style/styleDefaults.ts` 的 `EDGE_COLOR_PRESETS`，右侧样式面板与画布浮窗菜单都引用它，禁止在 TS 侧另写 hex 数组。浮窗样式改动统一 `onStyleChange(patch)` → `updateEdgeStyle`，切曲线复用 `seedCurveControlOnModeSwitch`。

## 设计系统 / UI 铁律
- **单色制 Monochrome Brand（用户决策）**：浅色下 `--color-primary`==`--color-accent`(`#0969da`)，深色为同蓝明度变体——**不是第二个品牌色**，勿"修复"同色。铁律：**颜色只在 `tokens.css` 定义一份**，TS 侧不复制 hex。
- **shared/ui 组件**：所有空占位用 `EmptyState.tsx`；所有互斥单选切换用 `SegmentedControl.tsx`；所有模态对话框走 `modal.ts`+统一 `z-[10000]`（非模态 popover 例外）。全局 `:focus-visible`（accent 2px outline）在 `base.css`，勿逐个补焦点环。
- **卡片视觉通道所有权**：装饰层（背景/边框/字体/emoji）/结构层（右槽位系统专有）/语义层（左竖条=进度、标题前=标记，系统专有）三层分离。语义层**永不**被装饰覆盖、不进格式刷；emoji 禁承载状态。边框色优先级：显式 `data.nodeStyle.borderColor` > `domainColor` > 默认（须读未 merge 的原值）；节点 inline style 勿写 border-color（压过 hover 变体）。
- **「A 展开成 B」的 morph 动画**：用**同一个容器**过渡 width/height/radius/底色/边框，不要两套元素滑入滑出。右缘固定、向左长大时，内容层必须 `transform: translateX(d)` 与 `clip-path: inset(0 d bottom 0 round …)` 同节奏补偿（d = 面板宽−把手宽），否则从右往左揭开先露右侧留白 → 「空板」。别用前载 easing（前期张太快看不出生长）；内容别叠加延迟 opacity 淡入。层数不同的 token 阴影用两层 opacity 交叉淡入，别 transition box-shadow。中间帧验证用 `document.getAnimations().forEach(a => { a.pause(); a.currentTime = t })`，直接 screenshot 太慢会抓到完成态。

## Tailwind / CSS 坑
- **CSS 变量不能配透明度修饰符**：`bg-[var(--x)]/30` 在 v3.4 无效，须 `bg-[color-mix(in_srgb,var(--x)_45%,transparent)]`。
- **给 BlockNote 内部元素（`.bn-editor`/`.bn-container`）改样式，别用 Tailwind 任意变体 `[&_.bn-X]:!pt-6`**：本项目（tailwind 3.4.19）下整组**不生成 CSS**（dev/dist 都如此），编辑器会吃 BlockNote 默认样式。一律写进 `SmartDocumentEditor.css` 按 `.smart-document-content .bn-X` 作用域 + `!important` 覆盖。
- `tailwind.config.js` 已把 `borderRadius`/`boxShadow` 映射到 token（`rounded-xl`→12px、`2xl`→16px、`3xl`→24px）；阴影用 `--shadow-*` token。
- SVG 取主题色须 `style={{fill:'var(--x)'}}`，勿 `fill="var(--x)"`（presentation attribute 对 var() 有历史 bug）；禁用 HTML 实体图标，一律 lucide。
- 纸张深色变量须双写 `html[data-theme='dark'], .dark`，否则只按 data-theme 切主题的入口拿到浅色纸张。
