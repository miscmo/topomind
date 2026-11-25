# TopoMind 统一控件设计规范

> 版本 v1.3.1 · 2026-11-21（标题栏控制区重构 + 右栏按需展开 + 样式设置迁入设置页；
> 补 §8.1 两条实测踩坑：设置页的两层 Provider 降级、失焦隐藏的 `relatedTarget === null`）
> 适用：所有 renderer UI（首页、知识库、画布、右栏、文档编辑器、插件视图、对话框）。
> 目标风格基准：用户已确认的全局导航栏 / 设置页 / 横向 tab 栏（48px rail、
> `--radius-md`、单色蓝 accent、`--shadow-popover`、11–13px 字号、图标 `strokeWidth 1.8`）。

## 1. 为什么要这份规范

`tokens.css` 早已是颜色 / 圆角 / 阴影 / 字号的唯一真源，但实际观感仍然不统一：
**值统一了，组合方式没统一**。同一个「次要描边按钮」在画布状态抽屉、画布浮层按钮组、
知识库对话框、插件面板里被手写了十几遍，圆角（`md / lg / xl / 2xl / full`）、
hover 色、disabled 透明度、图标尺寸（`h-3 / h-3.5 / size=13`）、层级
（`z-[100] / 1200 / 3001 / 4000`）各写各的。项目里虽然早有 `shared/ui/button.tsx`
等基础件，但几乎没有被复用。

因此本规范把「控件的完整视觉组合」也收成唯一真源，并用门禁锁住新增代码。

## 2. 唯一真源（三层，不要绕过）

| 层 | 文件 | 职责 | 允许出现字面色值 |
| --- | --- | --- | --- |
| 值 | `src/styles/tokens.css` | 颜色、间距、圆角、字号、阴影、层级、**控件级语义 token** | ✅ 仅此一处 |
| 组合 | `src/styles/controls.css` | `.tm-*` 控件类，集中定义 hover / active / disabled / focus | ❌ 只能 `var(--...)` |
| 引用 | `src/shared/ui/controlStyles.ts` | `TM_UI` 常量（类型安全的类名引用） | ❌ 只能字符串类名 |

`src/main.tsx` 必须按顺序引入 `base.css` → `tokens.css` → `controls.css`。
**禁止出现第四份真源**：不要在组件里内联 Tailwind 视觉类、不要在常量文件里写样式串、
不要复制另一套色值到 TS（历史教训见 `tokens.css` 顶部注释）。

## 3. 控件清单

| 类 | 用途 | 尺寸 / 关键值 | `TM_UI` 键 |
| --- | --- | --- | --- |
| `.tm-surface` | 普通浮层 / 卡片底板 | `--control-radius` + `--shadow-sm` | `surface` |
| `.tm-popover` | 弹出层底板 | `--radius-lg` + `--shadow-popover` | `popover` |
| `.tm-menu` / `.tm-menu-item` | 下拉 / 右键菜单 | 统一行高、hover、`[data-active]` | `menu` / `menuItem` |
| `.tm-menu-group` / `-title` | 合并菜单的分组标题 | 细分隔线 + 10px 字 | `menuGroup` / `menuGroupTitle` |
| `.tm-btn` | 次要按钮（最高频） | 24px 高 / 11px 字 / 7px 圆角 | `button` |
| `.tm-btn--primary` | 对话框主操作 | brand 填充 + `--shadow-md` | `buttonPrimary` |
| `.tm-btn--lg` | 表单主操作 | 32px 高 / 13px 字 | `buttonPrimaryLg` |
| `.tm-btn--active` | 分段控件选中项 | accent 填充 | `buttonActive` |
| `.tm-btn--ghost` | 无边框轻量按钮 | 透明底 | `buttonGhost` |
| `.tm-icon-btn` | 纯图标按钮 | 24×24 / 线宽 1.8 | `iconButton` |
| `.tm-icon-btn--outlined` | 带描边图标按钮 | 同上 + 边框 | `iconButtonOutlined` |
| `.tm-icon-btn--lg` | 导航栏图标按钮 | 36×36 | `iconButtonLg` |
| `.tm-pill` / `.tm-pill-btn` | 画布胶囊提示条 | `--control-radius-pill` | `pill` / `pillButton` |
| `.tm-input` / `.tm-select` | 输入框 / 下拉 | 28px 高 / 统一 focus ring | `input` / `select` |
| `.tm-badge` | 计数 / 状态徽标 | 10px 字 / tabular-nums | `badge` 等变体 |
| `.tm-section-header` | 可折叠分区标题行 | 统一 hover | `sectionHeader` |
| `.tm-scroll` | 滚动区 | 6px 细滚动条 | `scroll` |
| `.tm-icon` / `--sm` / `--lg` | 图标 | 14 / 12 / 18px，线宽 1.8 | `icon` / `iconSm` / `iconLg` |
| `.tm-tab-strip` | 顶栏横向 tab 容器 | `--tab-gap` 间隙 + 贴底对齐 + `overflow: visible` | `tabStrip` |
| `.tm-tab` / `--active` | 知识库 tab / 激活态 | 26px 高 / 弹性宽 88–180px / Π 形连体 | `tab` / `tabActive` |
| `.tm-tab-icon` | tab 图标 | 12px，激活时 accent 色 | `tabIcon` |
| `.tm-tab-label` / `--fade` | tab 文字 | 短名省略号 / 长名渐隐收尾 | `tabLabel` / `tabLabelFade` |
| `.tm-tab-trailing` / `-dot` / `-close` | 未保存圆点与关闭按钮 | hover 时圆点淡出、× 淡入 | `tabTrailing` / `tabDot` / `tabClose` |
| `.tm-tab-action--count` | 「⋯N」溢出按钮（仅真实溢出时） | 26px 高 | `tabActionCount` |
| `.tm-tab-menu-row` / `-label` | 溢出菜单行 | 图标 + 名称 + 关闭 | `tabMenuRow` / `tabMenuLabel` |

## 4. 正确用法

```tsx
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'

// 布局类留在组件里，视觉类一律取 TM_UI
<button className={tmUI('nodrag nowheel min-w-0 flex-1', TM_UI.button)}>
  撤销
</button>

// 或直接用类名（存量迁移 / 非 TS 场景）
<button className="nodrag nowheel tm-icon-btn tm-icon-btn--outlined">…</button>
```

**分工原则**：`controls.css` 只管视觉（颜色、圆角、边框、阴影、字号、交互态），
组件里只留布局（宽高、flex、margin、`nodrag nowheel`、`pointer-events`）。
这样画布几何、React Flow Panel 坐标、GUI 断言依赖的 DOM 结构都不受影响。

## 5. 硬性禁止（门禁会拦截）

1. 组件里出现字面色值 `#xxx` / `rgb(...)` / `rgba(...)` —— 用 `var(--color-*)`；
   SVG 绘图确实需要时，优先抽成 token，存量走基线。
2. 新增 `z-[数字]` —— 用 `--z-*` 变量（`--z-popover` / `--z-global` 等已补全）。
3. 新增 `rounded-[Npx]`、`shadow-[...rgba...]`、`text-[Npx]` —— 用 token / `.tm-*`。
4. 在 `controls.css` 里写 `!important`：项目有精确 className 断言，全局覆盖会误伤。
5. 新增含 `<button>` 的 UI 文件却不使用 `tm-*` 或 `TM_UI`。
6. 在 `controlStyles.ts` 里内联 Tailwind 视觉串（会形成第二份真源）。

## 6. 画布铁律（与导航层改造共用，勿回退）

- `#app-layout` 不得改成 flex 两栏；`#graph-panel` 保持 `absolute inset-0 isolate overflow-clip`。
- `<NavRail />` 只在 `App.tsx` 挂一次，是 z-40 的 absolute 浮层。
- `GraphPage` / `GraphCanvas` 不订阅 `layoutStore`；让位只靠 html dataset 驱动 CSS。
- **32px 顶栏（`--titlebar-height`）是 `App.tsx` flex-col 里唯一允许占文档流的兄弟。**
  禁止在标题栏下方新增第二条横向 `shrink-0` 条：画布净高会永久少一档，
  `#graph-panel` 高度与 React Flow Panel 坐标全变。横向 tab 栏必须活在标题栏内部。
- 标题栏 `aria-label="折叠右侧面板"` / `展开右侧面板` / `应用菜单`、
  `ariaLabel="右侧面板分区"` 是 GUI 稳定选择器，禁止删除。
- 改 className 前先搜 `scripts/verify-critical-regressions.mts`，确认没有整串精确断言。
  已被锁死的例子：`id="app-layout" className="relative w-full h-full"`、
  `id="graph-panel" className="absolute inset-0 isolate overflow-clip`、
  吸顶层两串、` <FileText className="h-4 w-4" />`。

## 7. 门禁与工作流

```bash
npm run verify:design     # 单独校验设计契约 + 基线
npm run verify            # 一键：design + typecheck + critical + plugins + lint:baseline
                          # 走 scripts/verify-all.mjs 顺序执行；Windows PowerShell 5.1
                          # 不支持 &&，禁止把总入口改回 && 串联
npm run build             # 自动经 prebuild 触发 verify:design
node scripts/verify-design-system.mjs --update   # 迁移一批后收紧基线（需 review diff）
```

- `scripts/design-system-baseline.json` 登记**存量**视觉值，按「文件 × 违规类型」计数。
- 规则是**只减不增**：新增任意一处硬编码值即 `exit 1`；存量减少会提示可收紧基线。
  这样既不要求一次性改完几百处历史代码，又能保证从今天起不再劣化。
- `verify-critical` 第 59 组断言机制本身没被拆掉（契约文件、入口引入、
  npm 脚本、基线文件、TM_UI 与 CSS 一一对应）；**第 60 组**锁住横向 tab 的架构
  （单条顶栏、只渲染 kb 类型、稳定 zone 测量、弹性压缩、无「+」、Π 形连体、
  拖拽安全带、no-drag、不抢 Ctrl+Tab / Ctrl+1..9、Π 形对比度前提、
  GUI 阶段 AH 12 条运行时证据存在）。
- 没有采用 ESLint 自定义规则：项目 lint 基线是 `0 errors`，给存量加 error 规则会
  一次性打破几十个文件；静态门禁 + 基线更适合渐进收敛。

## 8. 横向知识库 tab 栏（信息架构）

**三层职责，不要混**：

| 层 | 位置 | 管什么 |
| --- | --- | --- |
| 全局导航 | 标题栏 + 左侧 NavRail | 首页（标题栏）；学习记录 / 日志与性能 / 设置（rail 底部）；账户与工作区（最下） |
| 左栏页面 | NavRail 顶部（仅画布页） | AI Agent / 知识库列表 / 节点结构（左栏显示哪一页） |
| 工作区切换 | 顶栏横向 tab | **只放 `type === 'kb'` 的已打开知识库**（在哪些文档间切换） |
| 对象上下文 | 右侧 absolute 浮层 | 详情 / 样式 / 文档编辑器 |

- 系统页仍然进入 `tabStore.tabs`（`App.tsx` 依赖 `activeTab.viewId` 决定视图显隐），
  **只在 TabBar 渲染层过滤掉**；不要改 store 或 App 的挂载逻辑。
- 系统页激活时所有 tab 呈非活跃态，由左侧 NavRail 的图标承担激活指示；
  首页则由标题栏按钮的高亮承担；点任一 tab 一步回到画布。
- 顶栏三段：左＝导航栏显隐 + 首页 + 汉堡应用菜单，中＝tab 区 +
  `--tab-drag-gutter: 88px` 恒定拖拽安全带 + 剩余可拖留白，右＝三个窗口按钮。
  学习计时等 titlebar 插件 widget 已于 2026-11-25 移除，当日时长改由左侧导航
  「学习记录」表盘承载。**tab 区不再设百分比硬限宽**（旧的
  `--tab-zone-max: 60%` 已删除：它会人为制造溢出）。
- **Chrome 式弹性宽度（唯一正确算法，见 `TabBar.tsx`）**
  1. `ResizeObserver` 只能观察 `data-tm-tab-zone`（中段容器，`flex-1`、宽度稳定）。
     **绝不能观察 `.tm-tab-strip` 自身**：strip 宽度由 tab 内容决定，测它会产生
     「渲染 2 个 → 算出只放得下 1 个 → 只剩 1 个 → 算出还是 1 个」的正反馈，
     表现就是「打开两个知识库也折叠成下拉」（2026-11-21 实测修复的 bug）。
  2. 可用宽度 = zone 宽 − gutter − 父级 `columnGap`；宽度常量只在 `tokens.css`
     定义一份，运行时由 `readTabMetrics()` 读取，TS 侧不写死数字。
  3. `n × --tab-min-width + 间隙 ≤ 可用宽度` → **全部横向展示**，每个 tab 宽度
     `clamp(min, 可用宽度/n, max)`，由 `--tab-current-width` 注入 strip。
  4. 只有「n 个都压到最小宽度仍放不下」→ 预留 `--tab-overflow-width` 后
     尽量多显示几个，可见 tab 一律保持最小宽度，其余收进「⋯N」菜单。
     **激活 tab 永远保持在可见列表里**（空间不足时换入末尾）。
  5. 菜单复用 `.tm-menu` / `.tm-menu-item` 与 `activateTab` / `closeTab` / `flushTabs`。
- **不要「+」按钮**：打开知识库统一走首页的知识库卡片；
  tab 栏只负责在已打开的知识库之间切换。
- 所有 tab 交互元素继承根节点的 `WebkitAppRegion: 'no-drag'`；
  Electron 的 `app-region: drag` 会吞掉重叠区域的全部指针事件。
- 快捷键：`Alt+1..9` 直达、`Ctrl+PageUp/PageDown` 前后切、中键关闭。
  `Ctrl+Tab`（右栏显隐）与 `Ctrl+1..9`（全局导航）已占用，禁止挪用。
- **Π 形连体视觉**：活跃 tab 上方 `--tab-radius-top` 圆角、下方直角、
  `border-bottom: 0`、`box-shadow: none`；底色用 `--tab-active-bg`，
  画布页由 `[data-tm-active-view='kb']` 换成 `--color-canvas-bg`，
  首页/系统页保持 `--color-surface`；`::after` 一条 1px 同色块盖住顶栏
  `border-b`，让内容页看起来是从 tab 里向上延伸出来的。
  非活跃项透明融入顶栏、相邻之间一条极淡竖线；长名字用 mask 渐隐收尾；
  未保存时右侧 6px 圆点，hover 时淡出并让 × 淡入；
  窗口失焦（`data-tm-titlebar-unfocused='true'`）只降文字/图标对比，
  **不动底色与结构**，否则连体感会忽明忽暗地跳。
- **Π 形成立的前提：顶栏底色必须比内容区深一档**。github-light 的
  `--titlebar-bg` 为 `#eaeef2`、内容区 `#ffffff`；两者接近同色时活跃 tab
  会退化成「一条普通文字」，连体感完全看不出来（2026-11-21 截图实测）。
  调主题时先保住这档明度差，改浅顶栏等于改坏 Π 形。
  该前提由 `verify-critical` 第 60 组静态断言 + GUI 阶段 AH
  「Π 形对比度」实测（`titlebarBg !== bg && bg === graphBg`）双重锁定。

## 8.1 标题栏控制区 / 右栏显隐 / 样式设置归属（2026-11-21 重构）

**顶栏最左侧从左到右**：`导航栏显隐按钮` → `首页按钮` → `三条横线应用菜单` →
`tab zone`。原来的软件图标与学习计时 titlebar widget 均已删除；首页从左侧 rail
迁入后仍保留 `data-tm-nav-item="home"`，GUI 契约不随位置变化。
顶栏不再挂任何插件 widget，`data-tm-tab-zone` 是控制区之后唯一的宽度测量基准。

**导航栏显隐只有唯一开关**：`layoutStore.railVisible`（全局二态，持久化到
`topomind_navigation_v2`，兼容旧 `v1` 的 `railMode:'hidden'`）。按钮在标题栏，
`aria-label` 为 `收起全局导航栏` / `展开全局导航栏`，在任何视图（含画布）行为一致。
以下全部移除，**禁止回灌**：6px 边缘触发条、鼠标靠近左缘唤出、`Ctrl+B`、NavRail 内的
pin / 收起按钮、设置页的「自动 / 常驻 / 隐藏」三态、笔记库二级面板与专注模式
（`Ctrl+Shift+F`）、顶部品牌按钮。

**右栏不再有手动按钮**：标题栏的折叠按钮与「详情/样式」分段控件都已删除。
显隐逻辑：
- 按需展开：点击节点文档图标 / 关联文档图标（`applyRightPanelAutoVisibility(true)`）、
  新建文档（`useDetailDocuments` 里 `expandRightPanel()` + `setRightPanelTab('detail')`）；
- 按需收起：点击空白画布（`applyRightPanelAutoVisibility(false)`）、拖分隔条过半 / 双击；
- **失焦隐藏**：`RightPanelContainer` 监听 `focusin/focusout/pointerdown`，只在
  「焦点确实从右栏内部移出」时折叠（`hadFocusRef`）。必须排除右栏内交互、
  `[role="dialog"]` / `[role="menu"]` / `[data-tm-keep-right-panel]` / `.tm-menu` 等
  portal，以及 `pinned` / `maximized` 状态。不要用全局点击直接折叠：右栏刚展开时
  画布上的 `pointerdown` 会把刚创建的展开态立刻收掉。
- **`relatedTarget === null` 一律不折叠（实测踩坑）**：`contenteditable.blur()`、
  程序化失焦、切出窗口都会让 `focusout` 的 `relatedTarget` 为空、`activeElement`
  变成 `body`。若按「焦点不在右栏内」直接折叠，编辑器会被卸载，debounce 里
  还没落盘的正文随之丢失 —— GUI 阶段 D「编辑关联文档写入 node-b」失败后，
  关联列表 / 双链引用 / 编辑器工具栏 40+ 条断言连锁崩溃。
  `onFocusOut` 遇到 `relatedTarget === null` 直接 return；`collapseIfFocusLost`
  再兜一层 `activeElement` 为 `null` / `body` / `html` 时 return。
  **点画布空白收起右栏不靠这条路径**：既有 `applyRightPanelAutoVisibility(false)`
  已在 `useGraphCanvasModel` 的 pane 点击里处理，新增失焦逻辑只负责「焦点明确
  移到右栏外另一个可聚焦控件」的场景。两处都由 `verify-critical` 第 61 组锁定。
- `Ctrl+Tab` 保留为键盘可达性与 GUI 夹具入口（界面无按钮，不是第二套 UI 控件），
  `rightPanelPinned` 会通过 `collapseRightPanel` 的短路继续挡住它。

**样式设置的归属**：
- 全局默认样式（节点卡片 / 连线样式 / 连线关系）迁入 `SettingsPage` 的
  `data-tm-settings-style` 分组，直接复用 `StyleSection`；
- `useStyleSettingsModel` 改用 `useOptionalGraphContext()`：设置页不在
  `GraphContextProvider` 内，拿不到画布时节点 / 连线级写入降级为空操作，
  全局默认样式仍可编辑。`useGraphContext()` 的抛错语义保持不变；
- **两层 Provider 都要降级（易漏，实测踩坑）**：`GraphStoreProvider` 只挂在
  `App.tsx` 的知识库标签页内部，设置页是独立的 `data-tm-app-view="secondary"`
  视图，不在其中。`useStyleSettingsModel` 还有 4 处读画布选中态
  （`selectedEdge` / 两端 label / `selectedNodes`），只改 GraphContext 不够 ——
  直接 `useGraphStore` 会抛 `Missing GraphStoreProvider`，被二级视图
  `ErrorBoundary` 整页拦成「二级视图页面加载失败」，GUI 阶段 AI 起连锁失败。
  因此 `graphStore.tsx` 提供 `useOptionalGraphStore`：内部 `useContext` 拿不到
  Provider 时，退回模块级惰性空 store（`getDetachedGraphStore`）作只读兜底。
  **不要在设置页外面再包一层 `GraphStoreProvider`**：那会创建第二个带
  `setupTemporalMapSync` 订阅的画布状态，语义上等于「设置页有一个空画布」。
  空 store 恒无选中项，节点 / 连线级写入本就走 `graph?.` 空操作，全局默认样式
  与连线关系（来自 `graphUiStore` / `useStorage`）照常可编辑；
- 右栏 `style` 分区只保留一条「已迁移到设置」引导（`data-tm-settings-style-entry`），
  不再渲染第二份样式面板；画布右键「连线样式」改为跳到设置页并预置
  `stylePanelTab='edges'`；
- 不要在设置页另造一个 `aria-label="样式面板分区"`，复用同一组件以免选择器分裂。

**门禁**：`verify-critical` 第 58 / 60 组已按新契约改写，**第 61 组**锁住
「唯一开关 / 无第二套显隐入口 / 无手动右栏控件 / 失焦隐藏条件 / 新建文档展开 /
样式迁移 / optional GraphContext / **optional GraphStore** / GUI 阶段 AI」；
**第 69 组**锁住「标题栏不再有学习计时 widget、当日时长由 NavRail 单环表盘承载」，
第 74 组把首页锚点从已删除的 widget 改到 `data-tm-tab-zone`；
新加的 GraphStore 断言做过反向验证：把 model 改回 `useGraphStore(` → `exit 1`，
删掉 GUI 的崩溃证据字符串 → `exit 1`，均原子恢复。GUI 阶段 AI 实测画布页开关生效、
画布宽度恒定、系统页同态、**设置页无 ErrorBoundary 崩溃**（显式检查
`Missing GraphStoreProvider` / 「二级视图页面加载失败」）、样式设置落位，
并输出 `12/13-titlebar-*.png`。

## 9. 后续新增控件检查清单

1. 先查 `TM_UI` 是否已有对应控件；没有 → 先在 `controls.css` 加 `.tm-*` 类，
   再在 `controlStyles.ts` 加常量（两边必须一一对应）。
2. 颜色 / 圆角 / 阴影 / 字号 / 层级全部 `var(--...)`；新 token 加到 `tokens.css`。
3. 交互态写在 `controls.css`，不要在组件里各写一遍 hover。
4. 图标用 `.tm-icon*` 统一尺寸与线宽。
5. 新 tab / 顶栏控件必须 `no-drag`，且不得新增第二条占流横条。
6. 保留 `aria-label` / `title` / `data-tm-*`，GUI 回归大量依赖它们。
7. 跑 `npm run verify`，再跑 `npm run verify:linked:gui` 复核画布几何与截图。

## 10. 统一表情选择器（重构契约）

- **唯一门面**：`src/shared/ui/emoji/EmojiPickerPanel.tsx`。画布右键添加、点击卡片已有表情、
  文档树图标、文档右键 / 面包屑更换图标，四个入口全部复用同一面板、同一份最近使用、
  同一套定位与关闭逻辑；文档标题颜色仍走 `DocumentMetaPicker` 的独立色板。
- **交互引擎**：`emoji-picker-react@5.1.4`（MIT）承担虚拟滚动、键盘导航、ARIA、肤色与搜索；
  弹层定位用项目已装的 `@floating-ui/react`（flip / shift / 视口钳制）。
  禁止回灌 emoji-mart 的 Web Component、Shadow DOM、动态 import 与「加载中」占位。
- **数据本地化**：`scripts/build-emoji-assets.mjs` 在构建期合成 `emojiData.zh.json` ——
  picker 官方简体中文名 + emojibase 中文同义词 + `pinyin-pro` 全拼 / 首字母 +
  国内语义别名（点赞、收到、打工人、摸鱼…）+ 英文关键词。中文、拼音、英文均可搜，
  运行时零计算、零网络请求。「常用」= 最近使用 LRU（9）+ 国内高频置顶（27）。
- **字形统一**：`@lobehub/fluent-emoji-flat`（MIT，微软 Fluent Emoji Flat）按 unified 码点
  映射到本地 SVG；`EmojiGlyph` 覆盖网格、画布节点表情、文档树图标、面包屑。
  未命中或非 emoji 文本原样渲染，保证旧数据不丢失。资源由 `predev` / `prebuild`
  同步到 `public/fluent-emoji-flat/`，与 Excalidraw 字体一样不入库。
- **合规边界**：不引入微信 / QQ 贴纸表情（美术作品受著作权保护，商用需授权）。
  「国内常用」通过中文词库、语义别名、高频排序与最近使用实现，而不是搬运表情包。
- **视觉**：340px 宽、`--radius-md`、1px 描边、`--shadow-popover`、`--z-picker`；
  9 列网格、中文分类吸顶、底部中文名预览、Enter 选择 / Esc 关闭；
  颜色全部走 token，禁止渐变、弹跳、3D 表情与插画式空态。
- **持久化不变**：选中后仍写入 native 字符串，`_graph.json` 的 `emojis[]` 与
  文档 `icon` 字段零迁移。
- **门禁**：`verify-critical` 第 62 组锁住「单一门面 / 中文+拼音+英文词库 / 统一字形 /
  四入口收敛 / emoji-mart 不回灌 / predev-prebuild 生成链路」；`verify:design` 基线已收紧
  （`DocumentMetaPicker` 由 3 类违规收敛为 1 类，`KnowledgeCard` 移除一处魔法层级）。

## 11. 单一 Left Dock（左侧多页面，2026-11-24）

左侧现在是**一条 48px rail + 一个 280px 浮层面板**，不再为每类内容各造一条竖条。

- **职责分组（2026-11-25 改造）**：`NavRail` 顶部是 `HOST_DOCK_TABS` 的
  「左栏显示哪一页」（AI Agent → 知识库列表 → 节点结构，只在画布页出现）；
  底部是「去哪里」的工具组（学习记录 → 日志与性能 → 设置，连成一组、组内无分隔线），
  紧贴账户与工作区之上，账户组前保留一条细分隔线。首页搬到标题栏后不再由 rail 渲染，
  但仍留在 `HOST_NAV_ITEMS`（`placement: 'titlebar'`）供 `Control+1..9` 与激活态推导使用。
  两段共用同一条 rail、同一套 z-40 浮层，物理宽度不增加。左栏 tab 只在
  `activeTab.type === 'kb'` 时渲染，且用独立的 `data-tm-left-dock-tab`，
  **不带** `data-tm-nav-item`（不进 GUI 的 nav item id 白名单，也不占 `Control+1..9` 下标）。
- **单页语义 / 唯一开关**：`nodeTreePanelStore` 只有 `activePanelId` + `collapsed` 两个状态，
  **唯一写入口是 `setActivePanel`**（由 NavRail 竖 tab 调用）；点当前页 = 折叠、点别页 =
  换页并展开，同一时刻只有一个面板。页面态只在会话内有效、不落盘，刷新回到节点结构。
  与右栏「唯一开关 / 无手动按钮」的范式一致：面板内没有任何折叠按钮、把手或隐藏锚点，
  折叠态直接 `return null`，不渲染任何 DOM。不补快捷键、标题栏按钮等任何第二入口。
- **视觉语言**：把顶栏的 Π 形连体旋转 90° —— 激活 tab 底色用 `--color-surface`，
  `.tm-left-dock-tab--connected::after` 向右伸出 10px 盖住 rail 的 `border-r` 并压进面板左缘；
  整组只有**一条** 2px accent 指示条，按激活按钮实测位置 `translateY` 滑动。
  单色制下不用渐变 / 彩虹图标 / 玻璃拟态；字号、圆角、阴影、层级全部走 token 与 `.tm-*` 类。
- **外壳契约不可动**：`#app-layout` / `#graph-panel` 仍是绝对铺满，`NavRail` 仍是 App 层单例
  z-40 浮层，`layoutStore.railVisible` 仍是唯一二态；面板根 div、
  `data-tm-node-tree-*` 全套 GUI 稳定选择器、280px 宽度、`--tm-node-tree-offset` 让位与
  `html[data-tm-nav-rail-open]` 的两条让位规则**一字未改** —— 画布几何与 React Flow Panel
  坐标在任意展开/换页状态下都恒定。宽度刻意不做拖拽改宽，避免破坏这条像素契约。
- **AI Agent**：目前只是 `AgentPlaceholder` 空状态入口，不引入 AI SDK、会话状态、假输入框
  或网络调用；能力定下来后替换该组件即可，Dock 外壳零改动。
- **知识库列表**：第三页是轻量清单（只调 `storage.listKBs()`，点条目走
  `tabStore.openKnowledgeBase({ name })`）；封面 base64 / 节点计数 / 新建导入 / 拖动排序
  仍只属于首页，避免 280px 左栏重复首页的重型加载链路。三页共用同一个
  `isCanvasView` 渲染分支，显隐条件只有一处。
- **门禁**：`verify-critical` 第 72 组锁住「单一 store / 页面态不持久化 / tab 复用单例 rail /
  三页固定顺序 / GUI 选择器与让位变量保留 / 折叠态不渲染 / 占位页不伪装可用 /
  连体走 controls.css」；第 74 组锁住「标题栏首页位置与 GUI 选择器 / 工具组底部连组 /
  知识库列表页接线」；第 45 组锁住「唯一开关是竖 tab / collapsed 只由 setActivePanel 写入 /
  面板内无第二套显隐控件 / 状态抽屉让位公式不变」，并用 esbuild 真跑「点 tab 折叠、再点展开」。
