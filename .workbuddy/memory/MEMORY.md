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

## 验证手段
- `node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- `node --experimental-strip-types scripts/verify-critical-regressions.mts`（末尾 "Critical regression checks verified" 即通过；日志里的 "save failed" 是预期测试分支，可忽略）
