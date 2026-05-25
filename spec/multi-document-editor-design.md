# TopoMind 多类型文档编辑器设计与执行计划

## 1. 背景

TopoMind 当前的节点详情编辑以 Markdown 为中心：右侧详情面板通过 `DetailPanel` 加载节点文档，再交给 `MarkdownWorkspace` 和 `MarkdownSourceEditor` 编辑或预览。现有机制已经稳定支持：

- 节点默认详情文档：`_content.md`
- 节点卡片摘要文档：`_card.md`
- 额外 Markdown 详情文档：`_content/*.md`
- Markdown 附件、预览、目录、保存、自动保存等体验

新的产品方向是支持多种独立文档类型：

- 普通 Markdown 文档
- 智能文档，即类似飞书、Notion 的块级编辑器文档
- 思维导图文档
- 流程图文档

第一阶段不做文档内嵌和 transclusion。每种文档先作为独立文档打开、编辑、保存。

## 2. 核心目标

1. 保留现有 Markdown 编辑器和旧文档格式，不破坏当前用户数据。
2. 新增 typed document 系统，支持不同文档类型拥有自己的标准存储格式。
3. 将右侧详情区域逐步升级为文档中心，而不是把 Markdown 编辑器改造成大杂烩。
4. 支持新建、重命名、删除、打开多类型文档。
5. 每种文档使用独立编辑器，统一接入保存、dirty 状态、关闭前 flush 保存等应用级能力。
6. 执行过程中每完成一个阶段，必须更新本文档中的执行计划状态，防止后续修改失去方向。

## 3. 非目标

第一阶段明确不做：

- 文档内嵌
- 块引用 transclusion
- 多人协同编辑
- 云同步
- 智能文档和 Markdown 双向实时同步
- 主知识图谱与思维导图/流程图的双向自动转换
- 强制迁移旧 Markdown 文档

这些能力可以在多类型文档基础设施稳定后再设计。

## 4. 当前系统边界

### 4.1 现有 Markdown 编辑入口

当前主要链路：

```txt
DetailPanel
  -> MarkdownWorkspace
    -> MarkdownSourceEditor
    -> MarkdownPreview
```

相关文件：

- `src/components/RightPanel/DetailTab/DetailPanel.tsx`
- `src/components/MarkdownWorkspace/MarkdownWorkspace.tsx`
- `src/components/MarkdownWorkspace/MarkdownSourceEditor.tsx`
- `src/components/MarkdownWorkspace/MarkdownPreview.tsx`
- `src/stores/draftStore.ts`
- `src/stores/cardContentStore.ts`

### 4.2 现有存储接口

当前文档接口位于 storage service 和 file backend 中：

```ts
listDetailDocuments(cardPath)
readDetailDocument(cardPath, documentPath)
writeDetailDocument(cardPath, documentPath, content)
createDetailDocument(cardPath, name)
renameDetailDocument(cardPath, documentPath, nextName)
deleteDetailDocument(cardPath, documentPath)
```

这些接口当前只处理 Markdown 字符串。

### 4.3 现有文件结构

节点目录当前可能类似：

```txt
某节点/
  _content.md
  _card.md
  _content/
    会议记录.md
  _attach/
    image.png
  子节点A/
  子节点B/
```

Electron 文件服务当前对额外详情文档有明确限制：只支持 `_content` 目录下一级 `.md` 文件。因此新 typed document 不应复用旧 `createDetailDocument` 链路。

## 5. 总体架构决策

### 5.1 旧 Markdown 系统和新 typed document 系统共存

旧系统继续负责：

```txt
_content.md
_card.md
_content/*.md
```

新系统负责：

```txt
_docs/manifest.json
_docs/markdown/*.md
_docs/smart/*.tdoc.json
_docs/mindmap/*.tmind.json
_docs/flowchart/*.tflow.json
```

### 5.2 MarkdownWorkspace 保持稳定

`MarkdownWorkspace` 和 `MarkdownSourceEditor` 不直接改造成块级编辑器。它们作为 Markdown 类型编辑器继续存在。

未来统一入口应变成：

```txt
DocumentWorkspace
  -> DocumentSidebar
  -> DocumentEditorHost
    -> MarkdownWorkspace
    -> SmartDocumentEditor
    -> MindMapDocumentEditor
    -> FlowchartDocumentEditor
```

### 5.3 新文档通过类型分发编辑器

核心分发逻辑：

```tsx
switch (document.type) {
  case 'markdown':
    return <MarkdownWorkspace />
  case 'smart':
    return <SmartDocumentEditor />
  case 'mindmap':
    return <MindMapDocumentEditor />
  case 'flowchart':
    return <FlowchartDocumentEditor />
}
```

### 5.4 新 JSON 文档必须带 schema 和 version

所有非 Markdown typed document 都必须包含：

```json
{
  "schema": "topomind.xxx-document",
  "version": 1
}
```

这样后续可以安全做格式迁移。

## 6. 文档类型模型

```ts
export type TopoDocumentType =
  | 'markdown'
  | 'smart'
  | 'mindmap'
  | 'flowchart'

export interface TopoDocumentManifestItem {
  id: string
  type: TopoDocumentType
  title: string
  path: string
  createdAt: number
  updatedAt: number
  version: number
}

export interface TopoDocumentManifest {
  version: 1
  documents: TopoDocumentManifestItem[]
}
```

## 7. 推荐文件结构

单个节点目录未来可演进为：

```txt
某节点/
  _content.md
  _card.md
  _content/
    会议记录.md
    资料整理.md

  _docs/
    manifest.json

    markdown/
      新Markdown文档.md

    smart/
      产品规划.tdoc.json

    mindmap/
      研究框架.tmind.json

    flowchart/
      注册流程.tflow.json

  _attach/
    image.png

  子节点A/
  子节点B/
```

## 8. Manifest 格式

```json
{
  "version": 1,
  "documents": [
    {
      "id": "doc_01H00000000000000000000000",
      "type": "markdown",
      "title": "新Markdown文档",
      "path": "markdown/新Markdown文档.md",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "version": 1
    },
    {
      "id": "doc_01J00000000000000000000000",
      "type": "smart",
      "title": "产品规划",
      "path": "smart/产品规划.tdoc.json",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "version": 1
    }
  ]
}
```

## 9. 各类型文档格式

### 9.1 Markdown 文档

新 typed Markdown 文档保存为普通 `.md` 文件：

```txt
_docs/markdown/xxx.md
```

内容仍然是 Markdown 字符串。编辑器继续复用现有 `MarkdownWorkspace`。

### 9.2 智能文档

保存路径：

```txt
_docs/smart/xxx.tdoc.json
```

推荐格式：

```ts
export interface SmartDocument {
  schema: 'topomind.smart-document'
  version: 1
  title: string
  blocks: SmartBlock[]
  metadata: {
    createdAt: number
    updatedAt: number
  }
}

export type SmartBlock =
  | ParagraphBlock
  | HeadingBlock
  | TodoBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | ImageBlock
  | AttachmentBlock
```

MVP 阶段先支持：

- 标题
- 段落
- 列表
- 待办
- 引用
- 代码块
- 分割线

### 9.3 思维导图文档

保存路径：

```txt
_docs/mindmap/xxx.tmind.json
```

推荐格式：

```ts
export interface MindMapDocument {
  schema: 'topomind.mindmap-document'
  version: 1
  title: string
  rootId: string
  nodes: Record<string, MindMapNode>
  edges: MindMapEdge[]
  viewport?: {
    zoom: number
    pan: { x: number; y: number }
  }
}

export interface MindMapNode {
  id: string
  text: string
  parentId?: string
  position?: { x: number; y: number }
  collapsed?: boolean
  style?: {
    color?: string
    backgroundColor?: string
  }
}

export interface MindMapEdge {
  id: string
  source: string
  target: string
}
```

### 9.4 流程图文档

保存路径：

```txt
_docs/flowchart/xxx.tflow.json
```

推荐格式：

```ts
export interface FlowchartDocument {
  schema: 'topomind.flowchart-document'
  version: 1
  title: string
  nodes: Record<string, FlowchartNode>
  edges: FlowchartEdge[]
  viewport?: {
    zoom: number
    pan: { x: number; y: number }
  }
}

export interface FlowchartNode {
  id: string
  type: 'start' | 'end' | 'process' | 'decision' | 'io' | 'note'
  text: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
}

export interface FlowchartEdge {
  id: string
  source: string
  target: string
  label?: string
  style?: {
    lineMode?: 'straight' | 'smoothstep'
    lineStyle?: 'solid' | 'dashed'
    color?: string
    arrow?: boolean
  }
}
```

## 10. Storage API 设计

### 10.1 保留旧 API

旧 API 不删除、不改语义：

```ts
listDetailDocuments(cardPath: string): Promise<DetailDocumentItem[]>
readDetailDocument(cardPath: string, documentPath: string): Promise<string>
writeDetailDocument(cardPath: string, documentPath: string, content: string): Promise<void>
createDetailDocument(cardPath: string, name: string): Promise<DetailDocumentItem>
renameDetailDocument(cardPath: string, documentPath: string, nextName: string): Promise<DetailDocumentItem>
deleteDetailDocument(cardPath: string, documentPath: string): Promise<void>
```

### 10.2 新增 typed document API

```ts
listTopoDocuments(cardPath: string): Promise<TopoDocumentManifestItem[]>

createTopoDocument(
  cardPath: string,
  input: {
    type: TopoDocumentType
    title: string
  }
): Promise<TopoDocumentManifestItem>

readTopoDocument(
  cardPath: string,
  documentId: string
): Promise<unknown>

writeTopoDocument(
  cardPath: string,
  documentId: string,
  content: unknown
): Promise<void>

renameTopoDocument(
  cardPath: string,
  documentId: string,
  title: string
): Promise<TopoDocumentManifestItem>

deleteTopoDocument(
  cardPath: string,
  documentId: string
): Promise<void>
```

### 10.3 Electron IPC

新增 IPC 通道：

```txt
fs:listTopoDocuments
fs:createTopoDocument
fs:readTopoDocument
fs:writeTopoDocument
fs:renameTopoDocument
fs:deleteTopoDocument
```

不要直接让 UI 使用通用 `fs:readFile` / `fs:writeFile` 绕过 manifest 操作 typed document。

## 11. UI 模块设计

推荐新增目录：

```txt
src/components/DocumentWorkspace/
  DocumentWorkspace.tsx
  DocumentSidebar.tsx
  DocumentEditorHost.tsx
  documentTypes.ts

src/components/SmartDocumentEditor/
  SmartDocumentEditor.tsx
  smartDocumentTypes.ts
  blocks/

src/components/MindMapDocumentEditor/
  MindMapDocumentEditor.tsx
  mindmapTypes.ts

src/components/FlowchartDocumentEditor/
  FlowchartDocumentEditor.tsx
  flowchartTypes.ts
```

现有目录保留：

```txt
src/components/MarkdownWorkspace/
```

## 12. 右侧详情面板演进

当前 `DetailPanel` 负责过多：

- 选中节点解析
- 文档列表
- Markdown 加载
- Markdown 草稿
- Markdown 保存
- 详情 header
- 侧栏交互

后续应拆分为：

```txt
DetailPanel
  -> 负责节点选择、nodePath、空状态

DocumentWorkspace
  -> 负责文档列表、文档选择、新建/重命名/删除

DocumentEditorHost
  -> 负责根据文档类型渲染编辑器
```

## 13. Dirty 状态和保存协议

每个新编辑器应支持统一保存协议：

```ts
export interface DocumentEditorHandle {
  save: () => Promise<void>
  isDirty: () => boolean
}
```

切换文档、切换节点、关闭 tab、关闭应用前必须 flush 当前 dirty 文档。

旧 Markdown 文档可以先沿用现有 `draftStore` 和 `registerTabSaver`，新 typed document 逐步接入统一协议。

## 14. 智能文档编辑器选型

选型结论：

1. Phase 4 起智能文档直接采用 BlockNote，目标是让编辑体验尽量接近 Notion / 飞书等成熟块编辑器。
2. `SmartDocumentEditor` 是唯一允许直接依赖 BlockNote 的适配层，业务层、文档中心和 storage 层都不直接依赖 BlockNote API。
3. typed smart document 的外层仍使用 TopoMind 自有 schema，内部 `blocks` 存储 BlockNote block JSON，便于未来迁移、校验和导出。
4. 已按方案 B 升级到 React 19 + 最新 BlockNote + Mantine 9：`react@19.2.6`、`react-dom@19.2.6`、`@types/react@19.2.15`、`@types/react-dom@19.2.3`、`@blocknote/core@0.51.2`、`@blocknote/react@0.51.2`、`@blocknote/mantine@0.51.2`、`@mantine/core@9.2.1`、`@mantine/hooks@9.2.1`。

后续如需更深定制，可在 `SmartDocumentEditor` 内部评估 Tiptap / ProseMirror / Lexical，但外部接口保持稳定。

## 15. 执行计划维护规则

### 15.1 必须维护本文档

后续每完成一个阶段或 PR，必须更新本文档的执行计划表，至少包括：

- 阶段状态
- 完成日期
- 实际修改摘要
- 验证命令和结果
- 遗留问题
- 下一步建议

### 15.2 状态枚举

执行计划状态只能使用：

- `未开始`
- `进行中`
- `已完成`
- `已阻塞`
- `已调整`
- `已放弃`

### 15.3 不允许跳过计划更新

如果代码已经实现但本文档未更新，该阶段不能视为完成。

### 15.4 计划调整规则

如果执行过程中发现原计划不合适，允许调整，但必须在对应阶段的 `计划变更记录` 中写明：

- 为什么调整
- 调整前方案
- 调整后方案
- 是否影响旧 Markdown 编辑器
- 是否影响已有用户数据

## 16. 分阶段执行计划

| 阶段 | 状态 | 目标 | 主要文件/模块 | 验证方式 | 完成日期 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 已完成 | typed document 类型和存储基础设施 | `src/core/storage/*`, `electron/file-service.js`, `electron/main.js`, `electron/preload.js` | `npm run typecheck`、`git diff --check` | 2026-05-24 |
| Phase 2 | 已完成 | 文档中心 UI 抽象，旧 Markdown 继续可用 | `DetailPanel`, `DocumentWorkspace` | `npm run typecheck`、`node --check`、`git diff --check` | 2026-05-24 |
| Phase 3 | 已完成 | 新 typed Markdown 文档支持 | `DocumentEditorHost`, `MarkdownWorkspace`, storage | `npm run typecheck`、`node --check`、`git diff --check` | 2026-05-24 |
| Phase 4 | 已完成 | 智能文档 MVP | `SmartDocumentEditor` | `npm run typecheck`、`npm run build`、`node --check`、`git diff --check` | 2026-05-24 |
| Phase 5 | 已完成 | 思维导图文档 | `MindMapDocumentEditor` | `npm run typecheck`、`npm run build`、`node --check`、`git diff --check` | 2026-05-24 |
| Phase 6 | 已完成 | 流程图文档 | `FlowchartDocumentEditor` | `npm run typecheck`、`npm run build`、`node --check`、`git diff --check` | 2026-05-24 |
| Phase 7 | 已完成 | 导入导出、格式校验、manifest 修复 | storage, editor utils | `npm run typecheck`、`npm run build`、`node --check`、`git diff --check` | 2026-05-24 |

## 17. Phase 1 详细计划：typed document 基础设施

### 目标

新增 typed document 的类型、manifest 读写、文件后端和 storage API，不改变现有 UI 行为。

### 任务

1. 新增 typed document 类型定义。
2. 新增 `_docs/manifest.json` 读写能力。
3. 新增 `listTopoDocuments`。
4. 新增 `createTopoDocument`。
5. 新增 `readTopoDocument`。
6. 新增 `writeTopoDocument`。
7. 新增 `renameTopoDocument`。
8. 新增 `deleteTopoDocument`。
9. 新增 Electron IPC 白名单和 handler。
10. 保证旧 `listDetailDocuments/readDetailDocument/writeDetailDocument` 行为不变。

### 验证

```bash
npm run typecheck
```

如有测试框架覆盖 storage，则补充对应 storage/file-service 测试。

### 退出标准

- 旧 Markdown 文档读取、保存、新建、重命名、删除不受影响。
- 新 `_docs/manifest.json` 能自动创建和维护。
- 不允许 UI 直接绕过 manifest 写 typed document。

### 计划变更记录

- 2026-05-24：Phase 1 已完成。实际修改包括：在 `electron/file-service.js` 新增 `_docs/manifest.json` 管理、typed document CRUD、四种文档类型的初始内容生成和安全路径校验；在 `electron/main.js` 注册 `fs:listTopoDocuments`、`fs:createTopoDocument`、`fs:readTopoDocument`、`fs:writeTopoDocument`、`fs:renameTopoDocument`、`fs:deleteTopoDocument`；在 `electron/preload.js` 加入对应白名单；在 `src/core/fs-backend.ts`、`src/core/storage/file.ts`、`src/core/storage/service.ts` 和 `src/core/storage/index.ts` 暴露 renderer 侧 storage API 与类型。旧 Markdown 文档链路未改动。
- 验证结果：`npm run typecheck` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：当前阶段只完成基础设施，没有接入右侧文档中心 UI；尚未添加自动化 storage/file-service 测试。
- 下一步：进入 Phase 2，抽象 `DocumentWorkspace`、`DocumentSidebar` 和 `DocumentEditorHost`，并保持旧 Markdown 文档体验不回退。

## 18. Phase 2 详细计划：文档中心 UI 抽象

### 目标

将右侧详情区域拆成文档中心结构，但旧 Markdown 文档体验保持一致。

### 任务

1. 新增 `DocumentWorkspace`。
2. 新增 `DocumentSidebar`。
3. 新增 `DocumentEditorHost`。
4. `DetailPanel` 只保留节点路径解析、空状态和与图谱相关的上下文。
5. 文档列表合并 legacy Markdown documents 和 typed documents。
6. 旧 Markdown 文档继续使用 `MarkdownWorkspace`。

### 验证

```bash
npm run typecheck
```

手动验证：

- 选择节点后能看到默认详情。
- `_content.md` 可预览、编辑、保存。
- `_card.md` 可打开。
- `_content/*.md` 可打开、重命名、删除。
- 新 typed document 列表不影响旧文档。

### 退出标准

- 旧 Markdown 文档交互无回退。
- 文档 UI 已具备类型分发入口。

### 计划变更记录

- 2026-05-24：Phase 2 已完成。实际修改包括：新增 `src/components/DocumentWorkspace/DocumentWorkspace.tsx`、`DocumentEditorHost.tsx`、`DocumentSidebar.tsx`、`documentTypes.ts`；`DetailPanel` 改为通过 `DocumentWorkspace` 渲染右侧文档区域，并同时加载 legacy Markdown documents 与 typed documents；`DocumentEditorHost` 继续用 `MarkdownWorkspace` 承载旧 Markdown 文档，typed document 本阶段显示占位编辑器；`MarkdownWorkspace` 增加 `editorContent` 扩展点并支持 typed document 列表项作为固定文档展示。
- 验证结果：`npm run typecheck` 通过；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；typed document 当前只显示占位编辑器，创建和真实编辑留到 Phase 3+。
- 下一步：进入 Phase 3，支持通过 typed document 系统创建普通 Markdown 文档，并让 `DocumentEditorHost` 对 typed Markdown 复用 `MarkdownWorkspace` 的真实编辑能力。

## 19. Phase 3 详细计划：typed Markdown 文档

### 目标

支持通过新 typed document 系统创建普通 Markdown 文档，保存到 `_docs/markdown/*.md`。

### 任务

1. 新建文档弹窗支持选择 `Markdown 文档`。
2. 创建 `_docs/markdown/*.md` 文件和 manifest 条目。
3. `DocumentEditorHost` 对 `markdown` 类型复用 `MarkdownWorkspace`。
4. 保存 typed Markdown 时走 `writeTopoDocument`。
5. 旧 Markdown 文档仍走旧 API。

### 验证

```bash
npm run typecheck
```

手动验证：

- 新建 typed Markdown。
- 输入内容后自动保存。
- 切换节点再回来内容仍存在。
- 旧 `_content.md` 和 `_content/*.md` 不受影响。

### 退出标准

- 新旧 Markdown 共存。
- 新 Markdown 可通过 manifest 管理。

### 计划变更记录

- 2026-05-24：Phase 3 已完成。实际修改包括：`MarkdownWorkspace` 的文档列表右键菜单新增 typed Markdown 创建入口；`DocumentWorkspace` 和 `DocumentEditorHost` 透传 `onCreateTopoMarkdownDocument`；`DocumentEditorHost` 对 typed Markdown 不再显示占位，而是复用真实 `MarkdownWorkspace` 编辑/预览体验；`DetailPanel` 新增 typed Markdown 创建逻辑，并在读取、保存、缓存同步时按文档类型分流：typed Markdown 走 `readTopoDocument/writeTopoDocument`，旧 Markdown 继续走 `readDetailDocument/writeDetailDocument`。
- 验证结果：`npm run typecheck` 通过；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；typed Markdown 暂不支持重命名/删除，仍作为 manifest 固定项展示，后续可在文档中心操作模型中补齐。
- 下一步：进入 Phase 4，实现智能文档 MVP，并继续通过 `DocumentEditorHost` 分发到专用编辑器适配层。

## 20. Phase 4 详细计划：智能文档 MVP

### 目标

基于 BlockNote 实现第一版块级智能文档，编辑体验对齐 Notion / 飞书。

### 任务

1. 升级 React 19、BlockNote 最新版和 Mantine 9，统一智能文档编辑器依赖栈。
2. 新增 `SmartDocumentEditor` 适配层，封装 `@blocknote/react` 和 `@blocknote/mantine`。
3. 使用 BlockNote 原生块编辑能力支持标题、段落、列表、待办、引用、代码块等成熟交互。
4. 保存为 `_docs/smart/*.tdoc.json`。
5. 支持 dirty 状态和关闭前保存。
6. 样式适配当前 light/dark theme。

### 验证

```bash
npm run typecheck
```

手动验证：

- 新建智能文档。
- 编辑多个块。
- 切换文档自动保存。
- 关闭重开后恢复。
- 中文输入法行为正常。

### 退出标准

- BlockNote 块编辑体验可用。
- 不影响 Markdown 编辑器。

### 计划变更记录

- 2026-05-24：Phase 4 已完成并按产品要求改为直接使用 BlockNote。实际修改包括：安装 `@blocknote/core@0.51.2`、`@blocknote/react@0.51.2`、`@blocknote/mantine@0.51.2`；新增 `src/components/SmartDocumentEditor/SmartDocumentEditor.tsx` 和 `smartDocumentTypes.ts`，实现 BlockNote 适配层；`SmartDocumentEditor` 负责 BlockNote 初始化、主题适配、变更回传和标题编辑；`smartDocumentTypes.ts` 保持 TopoMind smart document 外层 schema，并将内部 `blocks` 规范为 BlockNote block JSON，同时兼容迁移此前轻量 MVP 的块格式；`MarkdownWorkspace` 文档右键菜单新增 `新建智能文档`；`DocumentWorkspace` 和 `DocumentEditorHost` 透传 `onCreateTopoSmartDocument`，并在 `type === 'smart'` 时渲染 BlockNote 版 `SmartDocumentEditor`；`DetailPanel` 新增 typed smart 创建、读取和保存分流，smart 文档读取后以 JSON 字符串进入现有 dirty/auto-save 链路，保存时转回对象写入 `_docs/smart/*.tdoc.json`。
- 2026-05-24：按方案 B 完成 React 19 + 最新 BlockNote + Mantine 9 升级。依赖更新为 `react@19.2.6`、`react-dom@19.2.6`、`@types/react@19.2.15`、`@types/react-dom@19.2.3`、`@blocknote/core@0.51.2`、`@blocknote/react@0.51.2`、`@blocknote/mantine@0.51.2`、`@mantine/core@9.2.1`、`@mantine/hooks@9.2.1`。React 19 类型收紧引发的修复包括：`App.tsx` 中 `inert` 改为 boolean，`MarkdownWorkspace` 中 auto-save timer ref 显式初始化，`MarkdownPreview` 的 `surfaceRef` 允许 `null`。`smartDocumentTypes.ts` 的 `blocknoteVersion` 元数据更新为 `0.51.2`。
- 验证结果：`npm run typecheck` 通过；`npm run build` 通过，仅输出 Vite 大 chunk 警告；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；BlockNote 的上传、协作、导入导出、扩展块和块级定制菜单尚未接入；typed smart 暂不支持重命名/删除。
- 下一步：进入 Phase 5，实现独立思维导图文档编辑器，并继续保持 Markdown 与 smart 文档链路隔离。

## 21. Phase 5 详细计划：思维导图文档

### 目标

实现独立思维导图文档编辑器。

### 任务

1. 新增 `MindMapDocumentEditor`。
2. 使用独立 `MindMapDocument` 格式。
3. 支持新增、编辑、删除节点。
4. 支持节点拖拽和折叠。
5. 保存 viewport。
6. 保存为 `_docs/mindmap/*.tmind.json`。

### 验证

```bash
npm run typecheck
```

手动验证：

- 新建思维导图。
- 编辑节点和结构。
- 拖拽后保存位置。
- 关闭重开恢复。

### 退出标准

- 思维导图文档独立可用。
- 不与主知识图谱存储混淆。

### 计划变更记录

- 2026-05-24：Phase 5 已完成。实际修改包括：新增 `src/components/MindMapDocumentEditor/MindMapDocumentEditor.tsx` 和 `mindMapDocumentTypes.ts`，基于 `@xyflow/react` 实现独立思维导图文档编辑器；沿用 `_docs/mindmap/*.tmind.json` 的 `topomind.mindmap-document` 外层 schema，规范化 `rootId`、`nodes`、`edges`、`viewport` 和 `metadata`；支持编辑标题、编辑节点文本、从任意节点新增子主题、删除非根节点及其子树、拖拽保存节点位置、折叠/展开子树、保存 viewport。`DocumentEditorHost` 在 `type === 'mindmap'` 时渲染 `MindMapDocumentEditor`；`MarkdownWorkspace` 文档右键菜单新增 `新建思维导图`；`DocumentWorkspace` 透传 `onCreateTopoMindMapDocument`；`DetailPanel` 新增 typed mindmap 创建逻辑，并把 mindmap 纳入 structured typed document 读取/保存分流，读取后以 JSON 字符串进入现有 dirty/auto-save 链路，保存时转回对象写入 `_docs/mindmap/*.tmind.json`。
- 2026-05-24 运行时修复：`MindMapDocumentEditor` 内部的 `<ReactFlow>` 改为包裹独立 `ReactFlowProvider`，避免复用主知识图谱所在 `GraphPage` 的 provider，导致右侧思维导图挂载后污染左侧主画布的 React Flow 内部状态。
- 验证结果：`npm run typecheck` 通过；`npm run build` 通过，仅输出 Vite 大 chunk 警告；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；思维导图 MVP 暂不支持自动布局、节点样式定制、连线样式定制、键盘快捷键、批量框选和导入导出；typed mindmap 暂不支持重命名/删除。
- 下一步：进入 Phase 6，实现独立流程图文档编辑器，并继续保持 Markdown、smart 和 mindmap 文档链路隔离。

## 22. Phase 6 详细计划：流程图文档

### 目标

实现独立流程图文档编辑器。

### 任务

1. 新增 `FlowchartDocumentEditor`。
2. 使用独立 `FlowchartDocument` 格式。
3. 支持开始、结束、过程、判断节点。
4. 支持节点拖拽。
5. 支持连线和连线 label。
6. 保存 viewport。
7. 保存为 `_docs/flowchart/*.tflow.json`。

### 验证

```bash
npm run typecheck
```

手动验证：

- 新建流程图。
- 创建节点和连线。
- 编辑节点文本和连线 label。
- 关闭重开恢复。

### 退出标准

- 流程图文档独立可用。
- 不影响主图谱连线逻辑。

### 计划变更记录

- 2026-05-24：Phase 6 已完成。实际修改包括：新增 `src/components/FlowchartDocumentEditor/FlowchartDocumentEditor.tsx` 和 `flowchartDocumentTypes.ts`，基于 `@xyflow/react` 实现独立流程图文档编辑器；沿用 `_docs/flowchart/*.tflow.json` 的 `topomind.flowchart-document` 外层 schema，规范化 `nodes`、`edges`、`viewport` 和 `metadata`；renderer normalize 层会在空 `nodes` 的旧/初始 flowchart 内容中补默认开始节点，避免改动 Electron 存储初始化。编辑器支持编辑标题、添加开始/流程/判断/结束节点、编辑节点文本、切换节点类型、删除节点并清理相关连线、拖拽保存节点位置、拖拽创建连线、选择连线后编辑 label、删除连线、保存 viewport。`DocumentEditorHost` 在 `type === 'flowchart'` 时渲染 `FlowchartDocumentEditor`；`MarkdownWorkspace` 文档右键菜单新增 `新建流程图`；`DocumentWorkspace` 透传 `onCreateTopoFlowchartDocument`；`DetailPanel` 新增 typed flowchart 创建逻辑，并把 flowchart 纳入 structured typed document 读取/保存分流，读取后以 JSON 字符串进入现有 dirty/auto-save 链路，保存时转回对象写入 `_docs/flowchart/*.tflow.json`。
- 2026-05-24 运行时修复：`FlowchartDocumentEditor` 内部的 `<ReactFlow>` 同样包裹独立 `ReactFlowProvider`，作为所有 typed document 图形编辑器的隔离规则，避免流程图后续复现相同的主图谱画布污染问题。
- 验证结果：`npm run typecheck` 通过；`npm run build` 通过，仅输出 Vite 大 chunk 警告；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；流程图 MVP 暂不支持输入输出/备注/子流程等更多节点类型、真实流程图几何形状、自动布局、复制粘贴、撤销重做、节点 resize、批量选择、复杂锚点规则、流程校验和导入导出；typed flowchart 暂不支持重命名/删除。
- 下一步：进入 Phase 7，补齐导入导出、schema migration、manifest 校验和异常恢复能力。

## 23. Phase 7 详细计划：导入导出与可靠性

### 目标

增强文档系统可靠性，补齐导入导出和异常恢复。

### 任务

1. typed Markdown 导出。
2. 智能文档导出 JSON。
3. 思维导图导出 JSON 或图片。
4. 流程图导出 JSON 或图片。
5. manifest 校验和修复。
6. schema version migration 框架。
7. 文档缺失、manifest 损坏、类型不匹配时的错误提示。

### 验证

```bash
npm run typecheck
```

手动验证：

- manifest 损坏时有可理解错误。
- 文件缺失时不会导致整个详情面板崩溃。
- 导出内容可打开。

### 退出标准

- 多类型文档系统具备长期演进基础。

### 计划变更记录

- 2026-05-24：Phase 7 已完成基础可靠性闭环。实际修改包括：`electron/file-service.js` 增强 `_docs/manifest.json` 读取逻辑，支持 manifest 规范化、重复 id/path 去重、损坏 manifest 备份为 `.broken-{timestamp}`、从 `_docs/markdown|smart|mindmap|flowchart` 扫描文件重建 manifest、移除 manifest 中已丢失文件的条目、补回文件存在但 manifest 缺失的条目；新增 `repairTopoDocuments` 显式修复 API，返回 `repaired/corrupted/added/removed/documents`；结构化 typed document 写入时校验 schema 与文档类型匹配，并为缺少 schema 的旧内容补默认 schema/version；新增 `exportTopoDocument` API，按类型返回建议文件名、MIME 和文本内容，Markdown 导出 `.md`，smart/mindmap/flowchart 导出格式化 JSON。`electron/main.js` 注册 `fs:repairTopoDocuments` 和 `fs:exportTopoDocument` IPC；`electron/preload.js` 加入白名单；`src/core/fs-backend.ts`、`src/core/storage/file.ts`、`src/core/storage/service.ts` 和 `src/core/storage/index.ts` 补齐类型和方法。右侧文档列表对 typed document 右键菜单新增 `导出`，`DetailPanel` 调用 `storage.exportTopoDocument` 并通过浏览器 Blob 下载。
- 2026-05-24 审查修复：修正 `createTopoDocument` 的写入顺序，先读取/修复 manifest，再创建新文件并追加同一个 manifest item，避免自动扫描提前把新文件加入 manifest 后导致返回的 document id 被 path 去重丢弃；结构化文档写入改为总是克隆并补齐有效 `version`，不再只在缺 schema 时补 version；整理 storage barrel 导出格式，降低维护成本。
- 验证结果：`npm run typecheck` 通过；`npm run build` 通过，仅输出 Vite 大 chunk 警告；`node --check electron/file-service.js`、`node --check electron/main.js`、`node --check electron/preload.js` 通过；`git diff --check` 通过，仅输出 Windows LF/CRLF 提示。
- 遗留问题：尚未运行 Electron UI 手动验证；smart 当前导出为 JSON，尚未转换为 Markdown；mindmap/flowchart 当前导出为 JSON，尚未导出图片；导入 typed document、schema version migration 的多版本转换框架、可视化修复报告和自动化 storage 测试仍可继续增强。
- 下一步：可进入多类型文档 polish 阶段，补 typed document 重命名/删除 UI、导入入口、导出格式扩展和手动 Electron 回归验证。

## 24. 风险和应对

### 24.1 旧 Markdown 回归风险

风险：拆 `DetailPanel` 时破坏当前 Markdown 编辑、预览、自动保存。

应对：

- Phase 2 必须优先验证旧文档。
- 不在 Phase 1/2 改 `MarkdownSourceEditor` 的编辑行为。
- 保留旧 storage API。

### 24.2 manifest 和文件不同步

风险：manifest 中有文档，文件丢失；或文件存在但 manifest 缺失。

应对：

- 创建、删除、重命名必须通过 typed document API。
- Phase 7 增加 manifest 修复工具。

### 24.3 智能文档依赖锁定

风险：选择的块编辑器库后续不适合深度定制。

应对：

- 使用 `SmartDocumentEditor` 适配层隔离第三方库。
- 对外只暴露 TopoMind 自定义 JSON。

### 24.4 主图谱和文档图混淆

风险：思维导图/流程图使用节点和边，容易与知识图谱存储混淆。

应对：

- 文档图使用独立 schema。
- 可以复用 React Flow UI 技术，但不复用主知识图谱数据模型。

## 25. 后续工作原则

1. 每次开始实现前，先阅读本文档的执行计划。
2. 每次完成阶段后，先更新本文档，再声明阶段完成。
3. 任何阶段不得以破坏旧 Markdown 编辑器为代价。
4. 新文档类型优先独立可用，再考虑互相嵌入、互相转换。
5. 数据格式一旦写入用户磁盘，必须考虑版本和迁移。
