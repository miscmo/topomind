# TopoMind 长期约定

## 验证手段
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- 回归：`npm run verify:critical`（末尾 "Critical regression checks verified" 即通过；日志里 "save failed" 是预期分支）、`verify:graph-store`、`verify:plugins:static`
- 构建：`npx vite build`（renderer / main / preload 三阶段）

## 铁律：删字段/改能力时必须同步回归脚本
`scripts/verify-critical-regressions.mts` 会断言具体字段。曾因移除块级公式按钮删了 `canConvertBlockMath` 而测试没同步 → 误判成"预存 bug"。改动后先跑上面三条再收工。

## 文档会话 / 草稿存储（right-panel）
- **完整文档正文绝不能持久化进 localStorage**（旧代码按路径整篇写入，含 base64 图片，无上限无淘汰 → `QuotaExceededError` 刷屏）。注意：这与下面 Vite 启动卡死**无关**，勿再误判。
- 现状：`draftStore` 的 `partialize` 只持久化 `cardDrafts`（小文本片段）；detail 草稿仅内存态（`detailDrafts`），`DocumentEditorHost` 用 `isContentLoaded` 门控挂载，全新启动由 read effect 从 topo 读回再挂载。
- `getItem` 内有 `cleanupLegacyDetailDrafts`：清理旧版 `topomind-draft-storage:detail:*` 大 blob + 清空 index 的 `detailEntries`，幂等。
- 权威副本在 topo（`storage.writeTopoDocument`），关闭/切换时 close-guard 把脏草稿 flush 过去。
- **不要**引入"删除最大历史草稿"之类 eviction——会误删别的文档唯一的未保存副本（2026 早期回归过）。

## Electron / Vite 启动卡死
- **真元凶：Vite 依赖扫描 esbuild OOM**。项目根下堆积几十个 `build-*`/`outputs`/`release`/`stats.html`（每个都是完整 dist 含 index.html），Vite 默认把项目内**所有 `*.html`** 当扫描入口 → 内存暴涨 + `The service is no longer running` → 应用卡加载。报错特征：`Failed to scan for dependencies from entries:` 后一长串 `build-*/index.html`。修复：`vite.config.js` 的 `optimizeDeps.entries: ['index.html']`。这些陈旧产物也应清理出工作区。
- 主进程若以"纯 Node"启动（缺 app/BrowserWindow），根因常是环境继承了 `ELECTRON_RUN_AS_NODE=1`。已在 `vite.config.js` 的 `onstart` 里用 `startup(..., { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })` 剥离（该修复曾丢失后补回）。

## 架构约束：GraphContextProvider
- `GraphPage.tsx` 在返回 JSX **之前**就调用 `useGraphPageActions({ graph })`，而 `<GraphContextProvider>` 只包返回的 JSX。故该调用链里的所有 hook（含 `useNodeActions`、`useNodeMoveToRoom`）运行在 Provider **之外**。
- **铁律**：链内 hook 绝不能直接 `useGraphContext()`，否则抛 `useGraphContext must be used within GraphContextProvider` → 整棵"知识库标签页"被 ErrorBoundary 兜底，表现为「标签加载失败」+「右侧笔记打不开」。需要 `graph` 就由上层作**参数**传入。
- 该崩溃会级联成多个看似独立的报错，定位时认准单一根因。

## 编辑器：BlockNote / ProseMirror
- **不要在 `appendTransaction` 里同步改文档**（`setNodeMarkup` 会重建块 nodeView，连续输入时打断输入状态 → markdown 输入规则 `- `→列表偶发失效）。正确做法：`appendTransaction` 只记「脏块 id」进 pending 并 `return null`；用 `new Plugin({ view(editorView) })` 存 `EditorView`（不要用私有 `_tiptapEditor`），在停止输入 ~1s / blur / destroy 时批量 flush；延迟写入按**块 id** 定位（位置会漂移），`addToHistory:false` + pluginKey meta 防递归。
- IME：`view.composing` 为真时 Tiptap input rule 直接跳过（原生行为）；中文标点下 `-` 是全角 `－`，不匹配 `/^\s?[-+*]\s$/`。这类"不触发"不是 bug，先让用户自查输入法中英文标点、是否在块首输入。

### 分栏能力评估（2026-08-25）
- BlockNote 0.51.4 核心是块级垂直流，默认一行一块。官方 `@blocknote/xl-multi-column` 可引入 `columnList`/`column` + `multiColumnDropCursor`。
- **硬约束**：① 版本必须配对（0.54 需整体升级 core/react 0.54.x）；② **License 是 `GPL-3.0 OR Proprietary`**，闭源商用需订阅，有合规风险，集成前先确认。
- 第三方 `blocknote-layout` peer 依赖比现版旧，不作主路径；自研 ProseMirror 横向容器不划算。

### xl-multi-column 集成必踩坑
- **字典未合并 → 编辑器整体崩溃**：`withMultiColumn(schema)` 只加块，不合并字典；`useCreateBlockNote` 也不像 `<BlockNote>` 那样合并 `locale`。结果 `editor.dictionary.multi_column` 缺失 → `getMultiColumnSlashMenuItems` 抛 `Multi-column dictionary not found`。修复：在 `useSmartDocumentEditorModel.ts` 的 `useCreateBlockNote` 选项里传
  `dictionary: { ...en /* @blocknote/core/locales */, multi_column: multiColumnLocales.en }`（换成 `zh` 即整体中文化，属独立改动）。
- **安装**：版本须精确配对（0.51.4 ↔ 0.51.4），不要顺手升级 BlockNote；曾因 peer-dep / Windows EPERM / 沙箱 / npm 缓存锁连环失败，最终 `--no-save` + 新 `--cache` 装好，再手工往 `package.json` 补条目。

### 链接点击拦截（两层）
1. **可编辑模式（可靠入口）**：在 `useCreateBlockNote` 配置注册 `links: { onClick }`。BlockNote 的 Link 扩展 `handleClick` 在 editable 时直接 `window.open`，`onClick` 早于它执行，返回 `true` 即不再跳转。**务必走这个钩子，不能只靠 DOM 捕获**。
2. **只读兜底**：只读时 `handleClick` 提前 `return false` 不调 `onClick`，需在 `SmartDocumentEditor.tsx` 的 `editorRoot` 捕获阶段拦 `<a[href]>`。两路调同一个 `openLinkMenu`，带 200ms 去抖防重复触发。
- 桥接层 `editorLinkInterceptor.ts`：`emitEditorLinkClick`/`setEditorLinkClickHandler`、`isNavigableHref`(http/https/mailto/ftp)、`shouldInterceptLink`（排除 `#` 与 `javascript:`）。只拦外部/导航链接，不动文档内锚点。
- 外部打开走 Electron 安全通道 `window.electronAPI?.invoke('app:openExternal', href)`，非 Electron 回退 `window.open(href,'_blank','noopener,noreferrer')`。菜单关闭：点外 / Esc / 编辑器滚动；视口边缘自动上翻左移。

### 快捷块格式 tile（SmartDocumentBlockMenu）
- 可见方块放内层 `<span class="tm-smart-block-menu__tile-fill">`（框架的菜单高亮覆盖打不到）。选中态 = accent 填充 + 白字，**不是对号**（别加 `checked`）。
- **字号坑**：`.bn-menu-item`/`.mantine-Menu-item` 自带 ~14px 会覆盖菜单项类上的 `font-size`；移到内层 span 后该覆盖失效、span 的字号真实生效。方块字号必须写 `14px`，写 17px 会突然变大（修过一次）。

### DocumentMetaPicker（emoji-mart 宽度坑）
- 弹层里的 `Picker` 是 **Web Component（Shadow DOM），宽度写死约 350px，根本不认 `width` prop**（`props.width` 在 `emoji-mart/dist/browser.js` 里不存在），传了被静默忽略。
- 故**不能**用固定窄宽度（如 280）+ `overflow-hidden` 去包——会被裁掉右侧图标。正确做法：弹层不设固定 `width`，用 `boxSizing:'content-box'` 自适应；视口钳制用估算值（360×560 icon / 320 color），`max-w-[95vw]` 兜底。
- `previewPosition`/`searchPosition`/`emojiSize`/`maxSearchResults`/`theme` 是**真实生效**的 prop。要搜索栏就设 `searchPosition` 为 `"static"` 或 `"sticky"`（默认 sticky，`"none"` 关掉）。

### 编辑器视觉约定（SmartDocumentEditor.css）
- **交互/高亮一律 `--color-accent`，`--color-primary` 只留给真正的超链接文字**（否则代码/数学和链接撞色）。
- 行内代码/数学：accent 极淡 tint 背景（`color-mix(accent 10~12%, transparent)`）+ 等宽 + 0.25em 圆角、无边框、无中性灰底。大面积容器走蓝调：引用块 `accent 7%`+左边框 `35%`、表头 `accent 9%`、数学块 `accent 7%`+边框 `18%`。UI 控件背景仍保留中性 `bg-muted`。
- 标题阶梯：H1 1.5 / H2 1.28 / H3 1.14 / H4 1.05 / H5 1.0 / H6 0.95 em。
- 代码块字号用相对值 `0.9em`（勿写 px），随 `--topomind-smart-body-font-size` 缩放；行号用 CSS 计数器伪元素，不参与复制。
- 原生代码块 `<select>` 语言下拉是**死 DOM**（被 `> div:first-child{display:none}` 整块隐藏），`CustomCodeBlock` 只 `querySelector('select')` 程序读值，勿再为它加样式。
- **纸张深色变量必须双写选择器** `html[data-theme='dark'], .dark`（对齐 `tokens.css:135`），否则只按 `data-theme` 切主题的入口会拿到浅色纸张。

## 设计系统（2026-10-31 起治理）
### 品牌色：单色制 Monochrome Brand（用户决策，勿改回双色）
- 只有一个色相 **GitHub 蓝**：浅色下 `--color-primary` **等于** `--color-accent`（`#0969da`，hover `#0550ae`）。历史上 `:root` 的藏青 `#1a3a5c`+`#3498db` 是永不生效的死值（浅色运行时唯一主题 `github-light`，见 `themeStore.ts`），已删；`src/types/constants.ts` 的 `COLORS`（同款藏青、零引用）也一并删。
- 两个 token 保留纯属**语义约定**：交互/选中用 accent，品牌/CTA 用 primary，浅色下像素相同——**不要以为改其中一个界面会变**，也别再试图"修复"同色现象。深色 `#9bd2ff`(primary) vs `#4aa8ff`(accent) 是同一蓝的明度变体，不是第二个品牌色。
- 铁律：**颜色只在 `tokens.css` 定义一份**，TS 侧不复制 hex（需要就 `getComputedStyle(...).getPropertyValue('--color-x')` 或内联 var）。

### shared/ui 组件层（写 UI 前先看有没有现成的）
- `EmptyState.tsx`：**所有空占位必须用它**。props `icon/title/description/action/size(sm列表内嵌13px|md面板级14px|lg hero 18px)/bordered(虚线卡片)/className`。
- `SegmentedControl.tsx`：**所有互斥单选切换必须用它**。泛型 `T extends string|number|boolean`，`size(sm 24px/11px 给标题栏；md 32px/12px 给面板)`、`grow`(是否等分)、`fullWidth`、`ariaLabel`；内部 `role=radiogroup`+`role=radio`。
- `modal.ts`（`modalOverlayBaseClassName/Enter/PanelEnterClassName`）+ 统一 `z-[10000]`：所有模态对话框走它，别自定 `fixed inset-0 bg-black/x`。非模态 popover 例外（`DocumentMetaPicker` 保持 1300）。键盘三件套：打开聚焦首个控件、overlay 级 Esc、关闭把焦点还给触发元素。Toast 已提升 `z-[100000]`。
- 全局 `:focus-visible`（accent 2px outline + 2px offset）在 `base.css`，已移除各处 `focus-visible:outline-none + ring-*` 补丁。**不要**再逐个补焦点环。
- **踩坑（2026-11-02）**：要排除一类元素（如 `[contenteditable]`）必须写进原规则的 `:not()`，不能靠"后面再写一条 `outline:none` 覆盖"——`[tabindex]:not([tabindex='-1']):focus-visible` 特异性是 (0,3,0)（`:not()` 内选择器计入权重），压过 `[contenteditable]:focus-visible` 的 (0,2,0)，导致点击编辑器被描蓝框。ProseMirror 根同时有 `contenteditable` + `tabindex="0"`，且 Chrome 对 contenteditable 鼠标点击也匹配 `:focus-visible`。

### Tailwind / CSS 坑
- **CSS 变量不能配透明度修饰符**：`bg-[var(--x)]/30`、`text-[var(--x)]/60` 在 **v3.4 无效**（变量不可解析，`/30` 被忽略甚至整条规则不生成）。要半透明必须写 `bg-[color-mix(in_srgb,var(--x)_45%,transparent)]`。
- 先确认类真的生成（历史 `h-5.5` 无刻度 → 改 `h-6`）。
- `tailwind.config.js` 的 `borderRadius`/`boxShadow` 已映射到 token（`rounded-xl`→12px、`2xl`→16px、`3xl`→`--radius-2xl` 24px；`shadow-*` 全 token）。圆角任意值已清零，写圆角请用这阶梯。
- 阴影 token：`--shadow-sm/md/lg/xl/popover/inset-highlight/focus-ring`。浮层统一 `--shadow-popover`；按钮内高光用 `--shadow-inset-highlight`（深色下是纯下落，白内高光在深色面是脏边）；focus ring 用 `--shadow-focus-ring`。**有意保留**非层级的方向性阴影（左侧面板 `-4px 0 24px`、危险态侧光、内描边）与 22~30px 数据展示级字号。

### SVG / 图标
- SVG 取主题色**必须** `style={{ fill: 'var(--x)' }}` / `style={{ stroke: 'var(--x)' }}`，**不要**写 `fill="var(--x)"`（presentation attribute 对 `var()` 有浏览器历史 bug，jointjs 这类 `setAttribute` 的库尤甚）。React inline style 里可直接写 `'var(--x)'` 字符串。
- **禁用 HTML 实体图标**（`&#10005;` 等），一律 lucide（实体图标字重/基线/字号随字体回退漂移）。例外：`CustomTitleBar` 的 10px 发丝线窗口控制 glyph（lucide 24 网格缩到 10px 视觉退化）。
- 保留不改：`FlowchartDocumentEditor` 的 jointjs 节点/连线色（画布内容色，非 UI chrome，且 `var()` 不保证生效）。

### 治理基线（2026-10-31 审计时 Level 1/5）
`tokens.css` 自称 single source of truth，但 `space-*`、`font-size-*`、`line-height-*`、`z-*`、`font-family`、`left/right-panel-width`、`header/toolbar-height` **实测 `var()` 引用全为 0**——仍未治理。`components.json` 的 alias 指向不存在的 `src/components/`。已完成：① 单色制 ② `--color-bg-float`+`h-5.5` ③ Tailwind 映射 + Toast 层级 ④ 全局 focus-visible ⑤ 组件层（对话框统一 + EmptyState/SegmentedControl）。
