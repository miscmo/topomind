# TopoMind 长期约定

## 文档会话 / 草稿存储（right-panel）
- **detail 草稿（完整文档正文）绝不能再持久化进 localStorage**。旧代码曾把整个 BlockNote 文档（可能含 base64 图片）按路径写入 localStorage，无大小上限、无淘汰，会触发 `QuotaExceededError` 刷屏（2026 早期）。注意：2026-08-15 一度把它误判为"启动卡死"的根因，实际启动卡死是下文 Vite 扫描 `build-*` 产物所致，二者无关。
  - 现状：`draftStore` 的 `partialize` 只持久化 `cardDrafts`（小文本片段）；detail 草稿仅内存态（`detailDrafts`），编辑器加载完成后才挂载（DocumentEditorHost 用 `isContentLoaded` 门控），全新启动由 read effect 从 topo 读回内容再挂载，因此去持久化不会空白。
  - `getItem` 内有 `cleanupLegacyDetailDrafts`：启动时清理旧版 `topomind-draft-storage:detail:*` 大 blob 并清空 index 的 `detailEntries`，恢复被撑爆的配额。幂等，仅影响 localStorage。
- 已保存内容权威副本在 topo（`storage.writeTopoDocument`）；关闭/切换时 close-guard 会把脏草稿 flush 到 topo。localStorage 只当作"小文本卡片草稿"缓存，**不要把完整文档塞进去**。
- 不要再引入"删除最大的历史草稿"之类 eviction：会误删别的文档尚未保存的唯一副本（2026 早期回归过）。

## Electron 启动 / Vite dev 启动卡死
- **Vite 依赖扫描引发的 esbuild 崩溃（真正的"启动卡死 + 内存暴涨"元凶）**：项目根下堆积了几十个 `build-*`、`outputs`、`release`、`stats.html` 等陈旧产物，每个都是完整 `dist`（含 index.html）。Vite 默认把项目内**所有 `*.html`** 当依赖扫描入口，esbuild 被迫解析几十棵完整依赖树 → 内存暴涨、`The service is no longer running`（扫描进程被 OOM/超时杀掉）→ renderer 依赖更新失败、应用卡在加载。报错特征：`Failed to scan for dependencies from entries:` 后列出一长串 `build-*/index.html`。**修复**：`vite.config.js` 的 `optimizeDeps.entries: ['index.html']` 限定只扫真正的入口（2026-08-15 已加）。这些陈旧 `build-*` 目录也应清理出工作区（它们还会拖慢 git/tsc/grep）。
- 若主进程以"纯 Node"模式启动，内置模块（app/BrowserWindow）缺失，窗口建不出来。根因常是环境继承了 `ELECTRON_RUN_AS_NODE=1`（来自父终端/IDE，Windows 用户/系统环境变量里查不到）。已在 `vite.config.js` 的 `onstart` 里 `startup(..., { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })` 剥离。该修复曾丢失，2026-08-15 重新补回。

## SmartDocumentBlockMenu 快捷块格式 tile（选中态功能）
- 拖拽手柄菜单顶部"快捷块格式"tile 的可见方块放在内层 `<span class="tm-smart-block-menu__tile-fill">`（框架碰不到，Mantine/BlockNote 的菜单项高亮覆盖打不到它）。选中态 = accent 填充 + 白字，不是对号（不要加 `checked`）。
- **字号坑**：`.bn-menu-item`/`.mantine-Menu-item` 自带约 14px 字号，会覆盖写在菜单项类上的 `font-size`。把方块移到内层 span 后该覆盖失效，span 上写的字号会真实生效——所以 tile 方块曾因 `font-size:17px` 突然变大。方块字号务必写 `14px`（对齐菜单默认），不要写 17px（2026-08-15 修过一次）。

## DocumentMetaPicker 图标选择器（emoji-mart 宽度坑）
- `DocumentMetaPicker.tsx` 是文档列表项右键"更换图标 / 修改字体颜色"的弹层。图标用 `@emoji-mart/react` 动态加载的 `Picker`。
- **emoji-mart v5.6.0 的 `Picker` 是 Web Component（Shadow DOM），宽度写死在 Shadow DOM（约 350px），根本不认 `width` 这个 prop**（`props.width` 在 `emoji-mart/dist/browser.js` 里不存在，也没有 width 默认值）。给它传 `width={...}` 会被静默忽略。
- 因此弹层**不能用固定窄宽度（如 280）+ `overflow-hidden` 去包 picker**——picker 仍是 350px 会被裁掉右侧一截图标。正确做法：弹层去掉固定 `width`，用 `boxSizing:'content-box'`（避免 1px 边框吃掉 2px 内容）让面板按 picker 自然宽度自适应；视口钳制用估算值（panelWidth=360, panelHeight=560 icon/320 color）。`max-w-[95vw]` 兜底防止超宽。
- 对照：`previewPosition` / `searchPosition` / `emojiSize` / `maxSearchResults` / `theme` 都是**真实生效**的 prop（与 `width` 不同）。要搜图标就把 `searchPosition` 设 `"static"` 或 `"sticky"`（默认 `"sticky"`，`"none"` 会关掉搜索栏）。

## 编辑器内链接点击拦截（不直接跳转）
- **两层拦截**（2026-08-18 修正：单靠 DOM 捕获在可编辑模式不可靠）：
  1. **可编辑模式（可靠入口）**：在 `useCreateBlockNote` 的编辑器配置里注册 `links: { onClick }` 钩子。BlockNote 的 Link 扩展 `handleClick` 在 `editable` 时会**直接 `window.open`**；`onClick` 运行于 `handleClick` 内部、早于 `window.open`，返回 `true` 即表示已处理、不再跳转。钩子里 `event.preventDefault()` + 把 `{href, rect}` 通过模块级桥（`editorLinkInterceptor.ts` 的 `emitEditorLinkClick`/`setEditorLinkClickHandler`）转交给组件弹菜单。**务必走这个钩子，不要只靠 DOM 捕获**。
  2. **只读模式兜底**：只读时 `handleClick` 提前 `return false`（不调 `onClick`），浏览器对 `<a href>` 走默认跳转。`SmartDocumentEditor.tsx` 在 `editorRoot` 捕获阶段 `click` 拦截 `<a[href]>`（`preventDefault`+`stopPropagation`）兜底；桥接 handler 与 DOM 监听都调用同一个 `openLinkMenu`，并带 200ms 去抖防止同一次点击被两路各触发一次。
- 桥接层 `editorLinkInterceptor.ts`：`setEditorLinkClickHandler` / `emitEditorLinkClick`（组件挂载时注册、卸载注销；模型层只持模块级引用，调用时读最新值）、`isNavigableHref`（http/https/mailto/ftp）、`shouldInterceptLink`（广义：排除 `#` 与 `javascript:`）。
- 仅拦截外部/导航链接，不影响文档内相对锚点。
- 外部打开走 Electron 安全通道：`window.electronAPI?.invoke('app:openExternal', href)`（preload 白名单 `app:openExternal`）；非 Electron 环境回退 `window.open(href,'_blank','noopener,noreferrer')`。
- 菜单关闭：点菜单外 / Esc / 编辑器滚动（scrollContainer scroll）均关闭；视口边缘自动上翻/左移钳制。

## 编辑器"同一行多块 / 分栏"能力评估（2026-08-25）
- 现状：BlockNote 0.51.4（已装）核心是块级垂直流，**默认一行一块**，无并排。
- 官方方案：`@blocknote/xl-multi-column`（最新 0.54.0，未装），引入 `columnList`+`column` 块，配 `multiColumnDropCursor` 支持把块拖到另一块侧边变并排（腾讯文档/Notion 式分栏）。
- **硬性约束**：① 版本必须配对——xl-multi-column 0.54 要配 `@blocknote/core`/`react` 0.54.x，现 0.51.4 基本得整体升级 BlockNote，有 breaking-change 风险；② **License：`GPL-3.0 OR Proprietary`**——闭源/商用需订阅，仅开源可在 GPL 下免费。商用产品直接集成有合规风险，需先确认许可证。
- 第三方 `blocknote-layout` 也提供拖拽分栏，但 peer 依赖 `@blocknote/core 0.47.1`（比现版旧），API 兼容性未验证，不作主路径。
- 自研 ProseMirror 横向容器块 + 重写 drop cursor 可行但工作量大、需长期维护，不划算。

## xl-multi-column 集成的两个必踩坑（2026-08-25 修复）
- **字典未合并导致编辑器整体崩溃**：`withMultiColumn(schema)` 只往 schema 加 `column`/`columnList` 块，**不会**把多语言字典并进编辑器；`useCreateBlockNote` 也**不会**像 `<BlockNote>` 组件那样做 `locale`/`dict` 合并。结果 `editor.dictionary.multi_column` 缺失，创建时 `getMultiColumnSlashMenuItems(editor)` 抛 `Multi-column dictionary not found`（React 报错 `<SmartDocumentEditor2> 渲染失败`）。修复：在 `useSmartDocumentEditorModel.ts` 的 `useCreateBlockNote` 选项里手动传入合并后的 `dictionary`：
  ```ts
  import { en as defaultEditorDictionary } from '@blocknote/core/locales'
  import { multiColumnDropCursor, locales as multiColumnLocales } from '@blocknote/xl-multi-column'
  // ...
  dictionary: { ...defaultEditorDictionary, multi_column: multiColumnLocales.en }
  ```
  - `@blocknote/core/locales` 的 `en` 与内部默认 `Pe` 是同一对象，spread 后其余 UI 仍是英文、零行为变化；`multiColumnLocales.en` 经 getter 解析为 `{ slash_menu: { two_columns, three_columns } }`，正好是 `getMultiColumnDictionary` 要的结构。
  - 若想让整个编辑器中文化，把 base 换成 `zh`（从 `@blocknote/core/locales` 导入）并把 `multi_column` 也改成 `multiColumnLocales.zh` 即可，但那是单独的本地化改动，不属于本 bug 修复范围。
- **安装坑**（见 2026-08-25 旧记录）：该包与 `@blocknote/core` 版本须精确配对（0.51.4 ↔ 0.51.4），不要顺手升级 BlockNote；安装曾因 peer-dep / Windows 安全删除 / EPERM / 沙箱 / npm 缓存锁连环失败，最终用 `--no-save` + 新 `--cache` 目录 + 关沙箱装好，且 `package.json` 是手动加 `"@blocknote/xl-multi-column": "0.51.4"`（因为用了 `--no-save`）。

## 编辑器 ProseMirror 插件：不要在输入过程中改文档（2026-09-03）
- **铁律**：不要在 `appendTransaction` 里对每个字符的改动同步 `setNodeMarkup`/改 doc。`setNodeMarkup` 用 ReplaceStep 替换块内容节点 → BlockNote 重建该块 nodeView DOM → 连续输入时反复重建会偶发打断浏览器输入状态与光标，导致 **markdown 输入规则（`- ` → 列表等）偶发失效**。
- 正确做法：`appendTransaction` 只把「脏块 id」记进 pending 集合并 **return null**；用 `new Plugin({ view(editorView) })` 保存 `EditorView`（不要依赖私有 `_tiptapEditor`），在停止输入 ~1s 后 / blur / plugin `destroy` 时统一 flush 批量写入。
- 延迟写入必须按**块 id** 定位（`blockContainer.attrs.id`），位置在延迟期间会漂移；事务仍要 `addToHistory:false` + pluginKey meta 防递归。
- IME：`view.composing` 为真时 Tiptap input rule 直接跳过（`@tiptap/core/dist/index.js` 的 `run()`），属原生行为；中文标点模式下 `-` 输出全角 `－`，不匹配 `/^\s?[-+*]\s$/`。这类"不触发"不是代码 bug，先让用户自查输入法中英文标点与是否在块首输入。

## 验证手段
- `node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- `node --experimental-strip-types scripts/verify-critical-regressions.mts`（末尾 "Critical regression checks verified" 即通过；日志里的 "save failed" 是预期测试分支，可忽略）
