# TopoMind CardSpec 受限渲染器技术方案（阶段 5）

- 版本：v1.1
- 日期：2026-11-22（v1.1 记录实现落地与偏差，见 §10）
- 状态：**已实现**（验证门禁通过；`flowchart` 组件按 §0 决策 6 暂缓）
- 上游文档：`docs/design/ai-knowledge-card-master-plan.md` v1.1（§4 决策表、§5.3 CardSpec、§11 决策补充）
- 交接对象：实现 agent
- 本文只描述技术方案，不含实现代码

---

## 0. 决策摘要

1. CardSpec 是**第三种文档类型与第二种容器类型**：`container.type='cardspec'`，落盘 `.cardspec.json`，schema `topomind.card-spec` v1。
2. **预览不用 SVG 导出**：CardSpec 预览是受限 React 组件的实时 DOM 渲染（无脚本、纯展示），不经过 `svgPreviewQueue`；`visible=false` 时静态占位，与 Excalidraw 预览同一 LOD 闸门。
3. **编辑器是全屏结构化编辑器**：复用 `ContainerFullscreenEditorHost`（读盘 / 400ms debounce / close-guard / revision bump 全通用），Editor 侧为「组件列表 + 属性表单 + 实时预览」，不做拖拽排版（阶段 8），AI 生成（阶段 6）不依赖本编辑器、直接产出 CardSpec 走同一 normalize。
4. **媒体资源存 `_docs/assets/`**：`image`/`audio`/`video` 的 `src` 仅允许该目录内相对路径；新增主进程 IPC 校验解析为 `file:// URL；v1 不支持远程 URL。
5. **`html` 组件仅占位**：类型注册、数据可保存，渲染为「HTML 组件（默认关闭）」占位卡，不渲染任何内容；沙箱渲染推迟到阶段 8 评估。
6. **`flowchart` 组件为阶段内 P2**：引用同节点 `_docs/` 下既有 Excalidraw 文档并复用 SVG 预览管线；若拖期可不阻塞阶段 5 交付，未知/缺失引用一律降级占位。
7. **数据绑定 v1 只解析 `static` 与 `title`**；`summary`/`doc`/`children` 保留字段、渲染降级为占位，不做数据抹除。
8. 文本组件**只渲染纯文本**（保留换行），不支持 markdown / HTML，从根上杜绝注入。

非目标（本阶段明确不做）：

- 不做拖拽设计器（阶段 8）、不接 AI（阶段 6/7）、不做 HTML 沙箱渲染（阶段 8）。
- 不做远程 URL 媒体、不做资源去重、不做全局搜索索引卡片正文。
- 不做布局原语扩展（`stack`/`grid` 之外的分栏、头图、时间线等；见 §11 开放项）。
- 不改动外层关系树、节点白名单、LOD、选中、生命周期搬运的任何逻辑。

---

## 1. 现状事实基线（2026-11-22 核对）

| 主题 | 位置 | 现状 |
| --- | --- | --- |
| 领域层容器注册表 | `src/domain/container/containerTypes.ts` | `ContainerTypeSpec` = `id / documentType / schema / version / createEmpty / normalize / serialize / getSceneVersion?`，纯数据无 React 无 IO；注册即接入全链路 |
| 渲染层注册表 | `GraphCanvas/containers/containerRenderers.tsx` | `Preview`（节点内只读）+ `Editor`（必须 `React.lazy`）；`ContainerPreviewProps` 含 `visible` LOD 闸门 |
| 静态装配点 | `GraphCanvas/containers/registerContainers.tsx` | 新增容器 = 一个 spec import + 一个 `registerContainerRenderer`；注释明确 v1 不走插件系统 |
| 全屏编辑宿主 | `ContainerFullscreenEditorHost.tsx` | **完全通用**：按 `session.containerType` 查领域 spec 与渲染器；读盘 / normalize / 400ms debounce 落盘 / close-guard / 卸载 flush / bump revision 全部与类型无关，零改动可复用 |
| 活跃会话 | `activeContainerStore.ts` | 全局单会话；双击节点写入会话，portal 全屏挂载 |
| Excalidraw 预览管线 | `ContainerSvgPreview.tsx` + `svgPreviewQueue.ts` | 官方 `exportToSvg` + LRU 缓存 + 并发队列，**与 excalidraw 强耦合**；CardSpec 不复用，`flowchart` 组件（P2）复用 |
| 文档类型枚举 | `src/core/topoDocumentTypes.ts` | `TOPO_DOCUMENT_TYPES = ['smart','mindmap','excalidraw']`；右栏 surface 由 `TOPO_PANEL_DOCUMENT_TYPES` 单独控制，cardspec 只进前者 |
| 容器创建入口 | `GraphPage/model/useNodeActions.ts:58-97` | `handleNewContainerChild` **硬编码 excalidraw**：建节点 → `createTopoDocument({type:'excalidraw'})` → 写 `kind/container` 指针 → flush + 原地刷新；失败保留普通节点。泛化此函数即可支持 cardspec |
| 文档读写 | `src/core/storage/types.ts:165-166` | 只有 JSON 文档读写（`readTopoDocument`/`writeTopoDocument`），**无二进制资源 API**——媒体链路是全新工作 |
| 扩展名/Schema 表 | 主需求文档 §1 基线 | `electron/file-service.js:537-546`（表+schema）、`:1658`（注入）、`electron/services/document-id-service.js:24-28`、`scripts/verify-critical-regressions.mts:9694` 夹具；隐含消费点 `:805` 扫描正则、`:510` 导入重映射回落 |
| 事件/只读解耦 | v1.4 全屏改造 | 编辑在全屏层，无 React Flow transform 祖先；容器编辑与 `computeCanvasReadOnly` 解耦已定案，CardSpec 直接继承 |

---

## 2. 数据模型：CardSpec v1

### 2.1 顶层结构

```ts
const CARDSPEC_DOCUMENT_SCHEMA = 'topomind.card-spec'
const CARDSPEC_DOCUMENT_VERSION = 1
const CARDSPEC_CONTAINER_TYPE = 'cardspec'

interface CardSpecContent {
  schema: 'topomind.card-spec'
  version: 1
  title: string
  layout: 'stack' | 'grid'        // grid v1 固定 2 列等宽
  components: CardComponent[]
  metadata?: {
    createdAt?: number
    updatedAt?: number
    generatedBy?: 'ai' | 'user'
  }
}

interface CardComponentBase {
  id: string
  styleRef?: string               // v1 仅 badge/progress 的 tone 枚举生效，其余保留不消费
  binding?: { kind: 'title' | 'summary' | 'doc' | 'children' | 'static' }
}

type CardComponent = CardComponentBase & (
  | { type: 'title';    props: { text: string; level?: 1 | 2 | 3 } }
  | { type: 'text';     props: { text: string; variant?: 'body' | 'caption' } }
  | { type: 'badge';    props: { text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' } }
  | { type: 'image';    props: { src: string; alt?: string; fit?: 'contain' | 'cover' } }
  | { type: 'audio';    props: { src: string; label?: string } }
  | { type: 'video';    props: { src: string; label?: string; poster?: string } }
  | { type: 'table';    props: { columns: string[]; rows: string[][] } }
  | { type: 'progress'; props: { value: number; label?: string; tone?: 'accent' | 'success' | 'warning' | 'danger' } }
  | { type: 'flowchart'; props: { documentId: string } }   // P2，见 §0 决策 6
  | { type: 'html';     props: { html?: string } }         // 占位，见 §0 决策 5
)
```

### 2.2 normalize 规则（纯函数，必须可独立打包验证）

- 未知 `version` / 缺失 `schema` → **抛错**，由适配层显示「版本不受支持」，不回写。
- 组件：缺 `id`/重复 `id` 丢弃；未知 `type` **保留数据**但渲染降级占位（为后续版本留路）；`props` 逐字段校验、脏值回落默认。
- `src` 校验（`image`/`audio`/`video`/`poster`）：必须以 `assets/` 开头；禁止绝对路径、`..`、反斜杠、协议头（`http:`/`file:` 等）、超长（≤512）；非法时保留原值并标记组件为「资源路径非法」降级态。扩展名白名单：
  - 图片：`png jpg jpeg gif webp svg`
  - 音频：`mp3 wav ogg m4a flac`
  - 视频：`mp4 webm mov`
- 限额（防失控、防 AI 输出撑爆节点）：组件 ≤50；id ≤64；title ≤200；text ≤4000；badge.text ≤50；table ≤10 列 ×100 行、单元格 ≤500；progress.value 夹取 0-100；组件总数超限截断。
- `serialize`：稳定 key 序、2 空格缩进；`getSceneVersion`：对规范化内容做 FNV-1a 哈希（供预览缓存失效键）。
- 模块**不得 import 任何 React / 编辑器包**，与 `excalidrawDocumentTypes.ts` 同规约，可被门禁脚本与主进程复用。

---

## 3. 文档类型接入清单（漏一处即「画面生效、重开丢失」）

1. `src/core/topoDocumentTypes.ts`：`TOPO_DOCUMENT_TYPES` 加 `'cardspec'`；**不进** `TOPO_PANEL_DOCUMENT_TYPES`。
2. `electron/file-service.js`：`TOPO_DOCUMENT_EXTENSIONS` 加 `cardspec: '.cardspec.json'`，`SCHEMAS` 加 `topomind.card-spec`。
3. `electron/file-service.js:1658`：注入 roomSummaryService 的扩展名表同步。
4. `electron/services/document-id-service.js:24-28`：`DOCUMENT_EXTENSIONS` 同步；验证 `:805` 扫描正则与 `:510` 导入重映射回落对新类型行为正确。
5. `scripts/verify-critical-regressions.mts:9694`：扩展名清单夹具加 `.cardspec.json`。
6. 新建 `src/features/documents/CardSpecDocument/cardSpecTypes.ts`：schema/version/类型/normalize/serialize/hash（对应 excalidrawDocumentTypes 的角色）。
7. 新建 `src/features/graph/GraphCanvas/containers/cardSpecContainerType.ts` 与渲染器，并在 `registerContainers.tsx` 装配。

---

## 4. 媒体资源链路（全新工作）

### 4.1 存储与解析

- 资源固定存 `<cardId>/_docs/assets/`，随节点目录搬运（跨房间移动、删除、导入导出自动跟随，复用现有目录链路）。
- 新增主进程 IPC（命名建议 `resolveCardAssetUrl`）：入参 `(cardPath, relPath)`；主进程侧校验归一化后必须落在该节点 `_docs/assets/` 内（拒绝 `..`/绝对路径/符号链接逃逸），存在则返回 `file://` 绝对 URL，不存在返回空。
- 渲染层只通过一个 `useCardAssetUrl(cardPath, src)` resolver 取 URL；若 `file://` 在打包后受 webSecurity 限制，升级为自定义 protocol（如 `tmasset://`）时只改 resolver 与主进程，组件零改动。
- 读失败/文件缺失：组件渲染「资源缺失」占位，不影响卡片其余部分。

### 4.2 导入

- 编辑器「添加媒体」按钮 → 主进程文件选择对话框 → 拷贝进 `_docs/assets/`（重名自动加 `-2` 后缀）→ 返回相对路径写入组件 `props.src`。
- 大小上限（主进程强制）：图片 20MB、音频/视频 200MB；超限拒绝并提示。
- 不允许粘贴/拖拽大段 base64 进 CardSpec；normalize 对 `data:` 协议一律拒绝。

### 4.3 渲染约束

- `<img loading="lazy">`；`<audio>/<video controls preload="metadata">`，**禁止自动播放**。
- 预览态（节点内）与编辑态预览面板同一组件树，保证所见即所得。

---

## 5. 渲染架构

### 5.1 预览（节点内，只读）

- `CardSpecPreview` 实现 `ContainerPreviewProps`：normalize（`useMemo`）→ 按 `layout` 渲染组件列表。
- `visible=false` → 静态占位「缩小显示中 · 放大后加载预览」（沿用现有文案模式）。
- normalize 抛错 → 「载荷版本不受支持，已保留原始数据」；空组件列表 → 「空白卡片 · 双击开始编辑」。
- 未知组件类型 → 「暂不支持的内容类型」占位；非法 src → 「资源路径非法」占位；资源缺失 → 「资源缺失」占位。**任何单个组件失败都不拖垮整张卡片。**
- 不导出 SVG、不进 `svgPreviewQueue`；受限组件 DOM 渲染成本低，配合 LOD visible 集合即可满足万级节点。

### 5.2 编辑器（全屏，lazy）

- `CardSpecEditor` 实现 `ContainerEditorProps`，`React.lazy` 注册，主 chunk 不含。
- 三区布局：左=组件列表（新增/删除/上下移动/类型选择），中=属性表单（按组件类型分发；媒体组件带「添加媒体」），右=实时预览（复用 §5.1 组件树）。
- `onChange` 产出**规范化后**的 CardSpec；宿主的 400ms debounce / close-guard / flush / bump revision 原样复用。
- 只读 JSON 查看面板（调试与 AI 产物核对用），不允许直接编辑 JSON（避免绕过 normalize；源码编辑需求留给阶段 8 设计器）。

### 5.3 创建入口

- 泛化 `useNodeActions.handleNewContainerChild`：按容器类型参数化（type/title/documentType），新增「知识卡片容器」右键菜单项；失败回退语义不变（保留普通节点、不留空指针容器）。
- 新卡片容器默认尺寸沿用 360×240，尺寸拖拽（v1.5）天然生效。

---

## 6. 事件、性能与安全

1. **事件**：编辑全屏承载，无 React Flow transform 祖先问题；预览态不挂任何交互实例（audio/video 的 controls 是原生控件，滚轮在控件上不冒泡缩放外层的问题由 `onWheelCapture` 既有守卫观察，GUI 验收覆盖）。
2. **性能**：仅 LOD 可见集合渲染预览；媒体 `preload="metadata"` + lazy；单活跃编辑器全局唯一（既有 store 保证）。
3. **安全**：文本纯渲染无注入面；资源 URL 由主进程校验产出；`html` 组件不渲染；CardSpec 内禁止可执行内容（无 script 字段、无事件属性）；normalize 是纯函数可离线验证。
4. **数据**：旧档零迁移；`container` 指针指向缺失文档时显示「载荷缺失」占位（既有语义）；未知组件/非法资源保留数据不回写抹除。

---

## 7. 验证门禁（阶段结束必做）

沿用主需求文档 §8 全部门禁，另增：

- 纯函数真跑：`normalizeCardSpec` / `serialize` / hash 经 esbuild 打包后执行（合法输入往返、未知 version 抛错、脏值回落、限额截断、`..`/协议头/绝对路径 src 拒绝、未知组件保留）。
- 扩展名清单断言含 `.cardspec.json`；文档创建/读回/重开不丢字段。
- 反向验证：临时移除 cardspec 注册 → 容器显示「载荷缺失/类型不支持」占位而不崩溃 → 原子恢复并校验 sha256。
- IPC 安全：构造 `../`、绝对路径、符号链接逃逸用例，主进程必须拒绝。
- 跨房间移动：含媒体资源的卡片容器移动后预览正常、资源可解析；导入导出往返保留 assets。
- GUI 验收：新建知识卡片容器 → 空白占位 → 双击全屏编辑 → 添加各类型组件（含媒体导入）→ 保存回预览；100% 缩放与 LOD 缩小两态正确；`flowchart`（P2）引用既有白板可渲染、引用缺失降级。

---

## 8. 开放项

| 开放项 | 说明 | 默认处理 |
| --- | --- | --- |
| 布局原语扩展 | 分栏 / 头图 / 时间线等 | v1 仅 `stack`/`grid(2列)`；用户在后续讨论中敲定后按「新布局 = 新枚举 + 渲染分支」扩展，不动 schema 版本 |
| AI 生成上下文 | 标题 / 文档摘要 / 子节点 / 关系的喂入范围 | 阶段 6 实现前与用户确认；上下文构造器按可配置设计 |
| `flowchart` 组件 | 引用同节点 Excalidraw 文档 | P2；阶段内未完成则渲染「流程图引用」占位，不阻塞交付 |
| `file://` vs 自定义 protocol | 打包后 webSecurity 行为未验证 | v1 `file://`；验收若受阻升级为 `tmasset://`，仅改 resolver |
| html 沙箱 | 禁 JS + CSP 的真实渲染 | 阶段 8 评估；本阶段仅占位 |

---

## 9. 交接说明

- 实现顺序建议：§3 文档类型接入 → `cardSpecTypes.ts`（normalize 先行并过纯函数门禁）→ 预览 → 全屏编辑器 → 媒体 IPC 与导入 → 创建入口 → 门禁收尾。
- 任何与本文冲突的实现期发现，先回到本文修订口径再动手；不要在代码里留下与文档不一致的"临时方案"。
- 阶段 6（AI 接入）的消费者是 `normalizeCardSpecContent` 与组件 schema，本文 §2 即 AI 输出的契约，改动需同步通知主需求文档。

---

## 10. 实现记录（2026-11-22）

阶段 5 已按 §9 顺序落地，业务代码清单：

| 层 | 文件 |
| --- | --- |
| 领域类型 / 纯函数 | `src/features/documents/CardSpecDocument/cardSpecTypes.ts` |
| 主进程纯路径规则 | `electron/services/card-asset-path.js`（新增，主进程与门禁共用） |
| 主进程资源/文档 | `electron/file-service.js`、`electron/main.js`、`electron/preload.js`、`electron/services/document-id-service.js` |
| 存储链路 | `src/core/fs-backend.ts`、`src/core/storage/{types,service,file}.ts`、`src/core/topoDocumentTypes.ts`、`src/features/documents/services/documentTypeRegistry.ts` |
| 容器接线 | `containers/containerRenderers.tsx`（新增 `cardPath`）、`nodes/ContainerCard/ContainerCard.tsx`、`containers/cardSpecContainerType.ts`、`containers/registerContainers.tsx` |
| 预览 / 编辑 | `containers/cardspec/{CardSpecPreview,CardSpecComponentList,CardComponentView,useCardAssetUrl,CardSpecEditor}.tsx/ts` |
| 创建入口 | `GraphPage/model/useNodeActions.ts`（泛化）、`useGraphPageActions.ts`、`components/GraphPageContextMenu.tsx` |
| 门禁 | `scripts/verify-critical-regressions.mts`（扩展名断言、CardSpec 纯函数真跑、路径越界真跑、接线静态断言） |

实现期相对方案的确认/偏差：

1. **`ContainerPreviewProps` 新增 `cardPath`**：媒体解析必须知道节点磁盘路径，由 `ContainerCard` 传入；Excalidraw 预览忽略该字段。
2. **路径规则抽成独立纯模块**：`file-service.js` 直接 import `electron`，门禁脚本无法真跑；抽出 `card-asset-path.js` 后，`normalizeCardAssetRelPath` 与 `cardAssetCategory` 可被 `verify:critical` 直接 import 并执行越界用例。
3. **`flowchart` 组件按 P2 暂缓**：只渲染「即将支持」占位，数据保留；未接 Excalidraw SVG 管线，不阻塞阶段交付。
4. **normalize 契约与 Excalidraw 对齐**：缺 `version` 按 v1 容忍、非对象输入回落空卡片；只有「显式未知 version」抛错。
5. **媒体导入对话框放在 main.js**：`file-service` 只做纯 fs（校验 + 拷贝 + 重名加后缀），渲染层经 `storage.importCardAsset` 弹窗；v1 仍用 `file://` URL，resolver 已隔离，未来升级 `tmasset://` 只改一处。
6. **设计门禁**：新 UI 文件全部使用 `--font-size-*` / `--color-*` token 与 `tm-*` 控件类，零新增视觉值违规。

验证结果：

- `npm run verify`（design / typecheck / verify:critical / verify:plugins / lint baseline）全绿；`node --check` 主进程文件通过；`npm run build` 通过，`CardSpecEditor` 独立 lazy chunk（约 13.8 kB），主 chunk 未污染。
- `verify:container:gui` **20/20**（既有 Excalidraw 容器全链路零回归）。
- `verify:linked:gui` **309/311**：阶段 AE 两条块菜单坐标断言为**既存测试脚本场景构造缺陷**（2026-11-21 已查明归属，基线同为 309/311），与本次改动无关。
- 尚未编写「知识卡片容器」专属 GUI 冒烟（新建 → 全屏编辑 → 媒体导入 → 落盘 → 重开）；这是阶段 5 收尾的唯一遗留，建议在阶段 6 接 AI 前补上。
