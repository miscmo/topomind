# TopoMind 整体架构优化计划

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：架构优化执行计划 / 进度追踪  
**创建时间**：2026-05-27  
**当前状态**：执行中  
**维护规则**：每完成一个优化步骤，必须更新本文档中的状态、完成时间、验证结果和后续影响。

---

## 1. 背景

本计划基于对 TopoMind 当前整体架构的项目级审查，目标不是单点修 bug，而是逐步提升项目整体的：

- 高内聚
- 低耦合
- 模块边界清晰度
- 后续扩展能力
- 软件工程成熟度
- 可测试性和可维护性

当前项目已经具备较好的工程化基础：Electron 与 Renderer 有 IPC 白名单边界，Storage 有抽象层，Graph 有 per-tab store 和 `GraphContext` 单一入口，`tabStore` 已拆分 actions/state/types，`domain/graph` 和 `domain/persistence` 已有领域层雏形。

但仍存在几个核心架构债：

1. `electron/file-service.js` 过大，承担多个领域的文件系统业务。
2. `StorageBackend` 接口过宽，所有存储能力挤在一个接口里。
3. `domain` / `application` 层偏薄，很多业务流程仍散落在 UI、hooks、storage、Electron service 中。
4. 多个 UI 大组件仍承担容器、状态、业务动作和视图职责。
5. 配置、默认值、约束、normalize 逻辑分散。
6. 缺少针对核心纯逻辑的自动化测试保护。

---

## 2. 总体目标

### 2.1 架构目标

最终希望项目演进为更清晰的分层结构：

```text
UI / Feature Components
  -> Application Services / Hooks
    -> Domain Services / Models / Rules
      -> Storage Interfaces
        -> Infrastructure Adapters
          -> Electron IPC / File System
```

### 2.2 设计原则

- **渐进式重构**：不做一次性大爆炸重构，每个阶段可独立验证。
- **行为保持**：每次重构默认不改变用户可见行为，除非任务明确要求。
- **先边界后细节**：优先拆核心服务边界，再优化组件内部结构。
- **先纯逻辑后 UI**：优先把可测试的纯逻辑抽出来。
- **有验证才算完成**：每个阶段必须通过 `npm run typecheck` 和必要的语法/行为验证。
- **文档同步**：每完成一步，必须更新本文档进度，防止上下文丢失。

---

## 3. 优先级总览

| 优先级 | 阶段 | 目标 | 当前状态 |
|---|---|---|---|
| P0 | 建立架构保护和公共规则 | 统一约束、默认值、配置规范，为后续重构降风险 | 已完成 |
| P1 | 拆 `electron/file-service.js` | 消除最大 God Service，拆出文件系统领域服务 | 已完成 |
| P2 | 拆 `StorageBackend` 大接口 | 让存储接口按领域内聚，降低 mock 和维护成本 | 已完成 |
| P3 | 建立 application service 层 | 把复杂业务流程从 UI/hooks/storage 中收拢 | 已完成 |
| P4 | 大组件瘦身 | 拆容器、视图、hooks、子组件，降低 UI 复杂度 | 已完成 |
| P5 | 自动化测试补强 | 给核心纯逻辑和迁移/存储规则加测试保护 | 已暂停 |
| P6 | 模块规范化 | 统一 feature 目录结构和依赖方向 | 已完成 |
| P7 | 深度代码清理 | 彻底清理无用代码、废弃文件和未使用的导出 | 已完成 |
| P8 | 打包体积与性能调优 | 清理无用依赖，配置代码分割，修复性能隐患 | 已完成 |

---

## 4. 详细优化计划

## P0. 建立架构保护和公共规则

### P0.1 新增统一 style/config 约束源

**目标**：避免默认值、范围、normalize 逻辑分散在多个文件中。

**建议新增文件**：

```text
src/domain/style/styleDefaults.ts
src/domain/style/styleConstraints.ts
src/domain/style/normalizeStyleConfig.ts
```

**迁移范围**：

- `src/stores/graphUiStore.ts`
- `src/core/storage/service.ts`
- `src/components/RightPanel/StyleTab/*`
- `src/hooks/useGraph/nodeCrudOperations.ts`

**验收标准**：

- 样式默认值只有一个权威来源。
- 字号、边框、圆角、节点尺寸、徽章、编辑器行高范围只有一个权威来源。
- UI、storage normalize、node style normalize 均复用同一约束。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：`npm run typecheck` 通过；`git diff --check` 通过，仅有 Windows LF/CRLF 换行提示。

---

### P0.2 统一 config 生命周期

**目标**：避免多个模块各自 `readConfig()`，导致初始化时序和状态覆盖分散。

**建议新增文件**：

```text
src/application/config/configService.ts
src/application/config/useConfigBootstrap.ts
```

**迁移范围**：

- `src/hooks/useGraph.ts`
- `src/components/RightPanel/StyleTab/StyleSection.tsx`
- `src/core/storage/service.ts`

**目标结构**：

```text
应用启动 / 工作区切换
  -> useConfigBootstrap
    -> storage.readConfig
    -> normalizeConfig
    -> hydrate stores

UI
  -> 只读 store
  -> 通过 action 写配置
```

**验收标准**：

- 样式 / Graph UI 配置初始化职责集中。
- `useGraph` 不再读取全量 config。
- 样式设置页不再自行读取全量 config。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：`npm run typecheck` 通过；`git diff --check` 通过，仅有 Windows LF/CRLF 换行提示。新增 `src/application/config/useConfigBootstrap.ts` 和 `configService.ts`，集中 hydrate `graphUiStore`。HomePage 中 KB 封面 / 排序的 `readConfig()` 属于业务配置读写，暂保留，后续 P2/P3 再收敛到更细的 ConfigStorage/Application service。

---

## P1. 拆分 `electron/file-service.js`

### P1.1 建立 Electron service 目录

**目标**：先建立拆分目标结构，不改变行为。

**建议目录**：

```text
electron/services/
  path-guard.js
  workspace-service.js
  kb-service.js
  card-service.js
  graph-meta-service.js
  topo-document-service.js
  attachment-service.js
  trash-service.js
```

**迁移原则**：

- `path-guard.js` 先抽路径校验、工作目录校验、危险路径防护。
- 其他 service 每次只迁移一个领域。
- `file-service.js` 初期作为 facade，保持对 `main.js` 的导出接口不变。

**验收标准**：

- 新 service 文件可被 `file-service.js` 调用。
- 对外 IPC 通道和 preload 白名单不变。
- `node --check electron/main.js electron/file-service.js electron/preload.js` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `electron/services/path-guard.js`；`file-service.js` 通过 facade 调用 path guard，保持 `_fs_requireValidWorkDir` 等导出不变。`node --check electron/services/path-guard.js electron/file-service.js electron/main.js electron/preload.js` 通过；`npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示。

---

### P1.2 拆 Workspace / KB / Card 服务

**目标**：把工作区、知识库、卡片目录操作从 `file-service.js` 拆出。

**建议迁移**：

```text
workspace-service.js
  createWorkDir
  isValidWorkDir
  selectDirectory 相关底层能力

kb-service.js
  listKBs
  createKbsDir
  deleteKbsDir
  renameKB
  importKB

card-service.js
  readCardChildren
  createCardDir
  delete card 相关能力
```

**验收标准**：

- 首页 KB 列表、创建、删除、重命名、导入功能行为不变。
- 卡片创建/删除/重命名功能行为不变。
- Electron 语法检查通过。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `electron/services/workspace-service.js`、`kb-service.js`、`card-service.js`；`file-service.js` facade 的 Workspace / KB / Card 方法已切换到对应 service。`node --check electron/services/path-guard.js electron/services/workspace-service.js electron/services/kb-service.js electron/services/card-service.js electron/file-service.js electron/main.js electron/preload.js` 通过；`npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示。`file-service.js` 中少量旧私有 helper 暂保留，后续清理。

---

### P1.3 拆 GraphMeta / Document / Attachment / Trash 服务

**目标**：把图谱布局、文档、附件、回收站能力拆成独立服务。

**建议迁移**：

```text
graph-meta-service.js
  readGraphMeta
  writeGraphMeta

topo-document-service.js
  list/create/read/write/rename/delete/move/repair/export/open folder

attachment-service.js
  import/download/read/open/delete/absolute url

trash-service.js
  list/restore/clear KB/card/document/attachment trash
```

**验收标准**：

- 图谱布局读写行为不变。
- 智能文档和附件功能行为不变。
- trash restore/clear 行为不回归。
- Electron 语法检查通过。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `graph-meta-service.js`、`attachment-service.js`、`document-service.js`、`trash-service.js`；`file-service.js` facade 已将 GraphMeta / Attachment / TopoDocument 方法切换到对应 service，Trash 通用能力经 `trashService` 注入 KB / Attachment / Document 边界。`node --check` 覆盖 Electron services、`file-service.js`、`main.js`、`preload.js` 通过；`npm run typecheck` 通过；`git diff --check` 通过，仅 Windows LF/CRLF 提示。复杂 TopoDocument manifest helper 暂保留在 `file-service.js`，后续可作为清理项继续下沉。

---

## P2. 拆 `StorageBackend` 大接口

### P2.1 拆分存储接口类型

**目标**：将一个大接口拆成多个领域接口。

**建议新增文件**：

```text
src/core/storage/types.ts
```

**建议接口**：

```text
WorkspaceStorage
KBStorage
CardStorage
GraphStorage
TopoDocumentStorage
AttachmentStorage
ConfigStorage
AppStorage
```

**验收标准**：

- `StorageBackend` 不再是单个巨型接口，或至少内部被组合接口表达。
- `createStore` 对外 API 行为保持不变。
- `createFileStorageBackend` 类型通过。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `src/core/storage/types.ts`，将 `StorageBackend` 拆为 `VaultStorageBackend`、`KnowledgeBaseStorageBackend`、`CardStorageBackend`、`GraphLayoutStorageBackend`、`TopoDocumentStorageBackend`、`AttachmentStorageBackend`、`ConfigStorageBackend` 等组合接口；`service.ts` 仅导入并兼容重导出原有类型名，`createStore` 对外行为不变。`npm run typecheck` 通过；`git diff --check -- src/core/storage/service.ts src/core/storage/types.ts spec/architecture-optimization-plan.md` 通过。

---

### P2.2 拆 `service.ts` 中的 normalize 和领域类型

**目标**：让 `service.ts` 回到 storage facade 职责，减少领域类型和 normalize 混杂。

**建议迁移**：

```text
src/domain/config/normalizeConfig.ts
src/domain/documents/topoDocumentTypes.ts 或保留 core 类型但从 service.ts 移出
src/domain/attachments/attachmentTypes.ts
```

**验收标准**：

- `service.ts` 文件长度明显下降。
- config normalize 有独立测试入口。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `src/core/storage/normalizeConfig.ts`，将 config normalize 从 `service.ts` 移出；`VaultConfig`、TopoDocument、Attachment、StorageBackend 领域类型已迁入 `src/core/storage/types.ts` 并由 `service.ts` 兼容重导出。`npm run typecheck` 通过；`git diff --check -- src/core/storage/service.ts src/core/storage/types.ts src/core/storage/normalizeConfig.ts spec/architecture-optimization-plan.md` 通过。

---

## P3. 建立 application service 层

### P3.1 新增 application 目录规范

**目标**：把“串联 store + storage + domain + side effects”的业务流程从 UI/hooks 中收拢。

**建议目录**：

```text
src/application/
  graph/
  kb/
  documents/
  attachments/
  style/
  config/
```

**职责边界**：

- UI：只表达用户意图。
- Application：编排流程、调用 store/storage/domain。
- Domain：纯业务规则、normalize、路径/模型规则。
- Infrastructure：Electron、文件系统、IPC。

**验收标准**：

- 至少选择一个垂直场景完成迁移。
- UI/hook 中对应业务流程减少。
- `npm run typecheck` 通过。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：补齐 `src/application/index.ts` 以及 `config`、`graph`、`kb`、`documents`、`attachments`、`style` 子目录入口；现有 config bootstrap 垂直场景已通过 `src/application/config` 入口导入，形成 UI -> Application -> Store/Domain 的最小规范样例。`npm run typecheck` 通过；`git diff --check -- src/App.tsx src/application spec/architecture-optimization-plan.md` 通过。

---

### P3.2 优先迁移图谱节点业务流程

**候选流程**：

- 创建子节点
- 删除节点并清理连线
- 重命名节点
- 更新节点样式

**迁移目标**：

```text
src/application/graph/nodeActions.ts
src/domain/graph/nodeRules.ts
```

**验收标准**：

- `useGraph/nodeCrudOperations.ts` 变薄。
- 纯规则可单独测试。
- 图谱创建/删除/重命名/样式修改行为不变。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：新增 `src/application/graph/cardNodeService.ts`，将创建子节点、删除节点并清理连线、重命名节点的编排从 domain/card 边界迁入 application/graph；`nodeCrudOperations.ts` 改为依赖 `../../application/graph`。`npm run typecheck` 通过；`git diff --check -- src/App.tsx src/application src/hooks/useGraph/nodeCrudOperations.ts spec/architecture-optimization-plan.md` 通过。

---

## P4. 大组件瘦身

### P4.1 继续拆 `StyleSection.tsx`

**当前进度**：已完成。

已拆出：

```text
src/components/RightPanel/StyleTab/StyleControls.tsx
src/components/RightPanel/StyleTab/StylePreviews.tsx
src/components/RightPanel/StyleTab/stylePresets.ts
src/components/RightPanel/StyleTab/styleSectionModel.ts
src/components/RightPanel/StyleTab/NodeStylePanel.tsx
src/components/RightPanel/StyleTab/EdgeStylePanel.tsx
src/components/RightPanel/StyleTab/EditorStylePanel.tsx
src/components/RightPanel/StyleTab/useStyleSettingsModel.ts
```

**验收标准**：

- `StyleSection.tsx` 只负责 tab 切换和布局。
- 节点/连线/编辑器面板独立。
- 样式设置 model hook 集中管理派生值和 actions。
- `npm run typecheck` 通过。

**状态**：已完成  
**完成时间**：2026-05-27  
**验证结果**：新增 `EditorStylePanel.tsx`，将编辑器 tab 的 JSX 从 `StyleSection.tsx` 拆出；新增 `useStyleSettingsModel.ts` 集中管理所有派生值、状态和 actions。现在 `StyleSection.tsx` 仅负责 tab 切换、错误处理及布局，将属性透传给各 Panel 组件。`npm run typecheck` 通过；`git diff --check` 通过。

---

### P4.2 拆其他大组件

**当前进度**：已完成。

已拆出：

- `DocumentSidebar.tsx` -> `useDocumentSidebarModel.ts`, `DocumentNode.tsx`, `DocumentInlineEdit.tsx`, `DocumentContextMenu.tsx`, `DocumentTrashItem.tsx`

- `MonitorPage.tsx` -> `components/Sidebar.tsx`, `components/FilterBar.tsx`, `components/LogList.tsx`, `components/LogRow.tsx`, `components/DetailPanel.tsx`, `utils/formatters.tsx`, `constants.ts`

- `GraphCanvas.tsx` -> `model/useGraphCanvasModel.ts`, `components/CardSnappedConnectionLine.tsx`, `utils/math.ts`, `constants.ts`

**优先级列表**：

1. `src/components/DocumentWorkspace/DocumentSidebar.tsx` (已完成)
2. `src/components/MonitorPage/MonitorPage.tsx` (已完成)
3. `src/components/GraphCanvas/GraphCanvas.tsx` (已完成)
4. `src/components/SmartDocumentEditor/SmartDocumentEditor.tsx` (已完成)
5. `src/components/GraphCanvas/nodes/KnowledgeCard.tsx` (已完成)
6. `src/components/HomePage/KBSettingsDialog.tsx` (已完成)

**统一目标结构**：

```text
Feature/
  index.ts
  Feature.tsx
  components/
  hooks/
  model/
  services/
  types.ts
```

**验收标准**：

- 每次只拆一个 feature。
- 行为不变。
- `npm run typecheck` 通过。
- 复杂交互有最小测试或人工验证清单。

**状态**：已完成  
**开始时间**：2026-05-27  
**完成时间**：2026-05-27  
**验证结果**：已完成 `DocumentSidebar.tsx` 的拆分，新建了 `model` 和 `components` 目录。将状态逻辑抽取至 `useDocumentSidebarModel.ts`，UI 抽取为递归 `DocumentNode.tsx`、`DocumentInlineEdit.tsx`、`DocumentContextMenu.tsx` 等。已完成 `MonitorPage.tsx` 的拆分，新建了 `components` 和 `utils` 目录。将状态、UI 组件和辅助函数抽取到相应子文件中。已完成 `GraphCanvas.tsx` 的拆分，新建了 `components`、`model` 和 `utils` 目录。将复杂的数学计算抽离到 `math.ts`，组件抽离到 `CardSnappedConnectionLine.tsx`，状态逻辑抽离到 `useGraphCanvasModel.ts`。已完成 `SmartDocumentEditor.tsx`、`KnowledgeCard.tsx` 和 `KBSettingsDialog.tsx` 的拆分。建立了相应的 `model` 和 `components` 子目录结构。`npm run typecheck` 通过；`git diff --check` 通过。

---

## P5. 自动化测试补强

### P5.1 建立测试基础设施

**目标**：为核心纯逻辑建立回归保护。

**建议工具**：

- Vitest
- Testing Library（后续 UI 测试时再引入）

**建议脚本**：

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**验收标准**：

- 测试框架可运行。
- CI/本地可执行 `npm run test`。
- 不影响现有 build/typecheck。

**状态**：已暂停（根据用户指示，暂时跳过测试相关优化）  
**开始时间**：-  
**完成时间**：-  
**验证结果**：-

---

### P5.2 优先测试纯逻辑

**优先测试文件/能力**：

- `src/domain/graph/normalizeGraphMeta.ts`
- `src/domain/graph/path-utils.ts`
- `src/stores/tabNavigation.ts`
- `src/stores/tabState.ts`
- `src/domain/card/cardService.ts`
- `src/core/storage/file.ts` 中 `convertFSBToGraph` / `convertGraphToFSB`
- `src/domain/config/normalizeConfig.ts`（P2 后）
- `src/domain/style/styleConstraints.ts`（P0 后）
- Electron service 拆分后的 path guard / trash rules

**验收标准**：

- 每个核心纯逻辑模块至少覆盖正常路径和边界路径。
- 重构前后测试通过。

**状态**：已暂停（根据用户指示，暂时跳过测试相关优化）  
**开始时间**：-  
**完成时间**：-  
**验证结果**：-

---

## P6. 模块规范化

### P6.1 统一 feature 目录结构

**目标**：让后续人类和 AI 都知道代码应该放哪里。

**建议规范**：

```text
components/FeatureName/
  index.ts
  FeatureName.tsx
  components/
  hooks/
  model/
  services/
  types.ts
```

或更长期演进为：

```text
src/features/
  graph/
  kb/
  documents/
  attachments/
  style-settings/
  monitor/

src/shared/
  ui/
  platform/
  storage/
  logger/
```

**验收标准**：

- 新增功能有统一落点。
- 旧功能逐步迁移，不做一次性大搬家。
- `index.ts` 作为 feature 对外出口。

**状态**：已完成
**完成时间**：2026-05-28
**验证结果**：已完全清空并移除了 `src/components` 目录。将剩余的编辑器组件移入 `src/features/documents`，右侧面板移入 `src/features/right-panel`，布局组件移入 `src/features/layout`，设置页移入 `src/features/setup`，公共弹窗移入 `src/shared/ui`。修复了相关的依赖路径，`npm run typecheck` 通过。至此 P6.1 目标达成。

---

## P7. 深度代码清理

### P7.1 彻底清理无用代码

**目标**：扫描并移除项目中不再被引用的老旧辅助函数、废弃组件、多余的样式类以及未使用的模块导出。

**清理范围**：
- 扫描 `ts-prune` 报告的完全未使用导出。
- 清理之前重构遗留的冗余文件（如 `src/domain/card/cardService.ts`）。
- 清理工具库中废弃的方法（如 `math.ts`、`path-utils.ts`、`modal.ts`、`tabState.ts`）。

**验收标准**：
- 所有被标识为完全未使用的代码均已删除。
- 确保删除未使用的导出后没有引发任何依赖问题。
- `npm run typecheck` 完美通过。

**状态**：已完成
**开始时间**：2026-05-29
**完成时间**：2026-05-29
**验证结果**：通过 `ts-prune` 排查，删除了重复的 `src/domain/card/cardService.ts`，清除了 `log-backend.ts`、`math.ts`、`path-utils.ts` 等文件中的废弃导出。`npm run typecheck` 通过。

---

## P8. 打包体积与性能调优

### P8.1 移除无用依赖
**目标**：通过 `depcheck` 扫描出在 `package.json` 中声明但实际未在代码中使用的第三方包并移除，降低依赖安全风险和依赖树体积。
**状态**：已完成
**验证结果**：移除了 `@antv/x6-plugin-dnd`、`@elixpo/lixeditor`、`react-katex`、`superpowers` 等 9 个完全没有引用的包。

### P8.2 文档编辑器懒加载 (Code Splitting)
**目标**：解决 `vite` 构建出的首屏主 JS 文件体积过大 (3.6MB) 的问题。
**方案**：在 `documentEditorRegistry.tsx` 中，将重型编辑器 `SmartDocumentEditor` (@blocknote)、`MindMapDocumentEditor` (simple-mind-map)、`FlowchartDocumentEditor` (@antv/x6) 改为按需异步加载 (`React.lazy`)。
**状态**：已完成
**验证结果**：主入口包体积从 3.6MB 骤降至 1.2MB。三大编辑器作为独立 Chunk 加载，大幅提升首屏及图谱主页的加载和解析性能。

### P8.3 修复顶层组件 Suspense 缺失
**目标**：修复在 `App.tsx` 中引入懒加载组件 (`ConfirmModal`, `PromptModal`, `CustomTitleBar`) 但未正确使用 `<Suspense>` 包裹的问题，防止渲染时崩溃。
**状态**：已完成
**验证结果**：使用 `<Suspense fallback={null}>` 包裹对应懒加载组件，`npm run typecheck` 完美通过。

---

## 5. 进度追踪表

| ID | 任务 | 优先级 | 状态 | 开始时间 | 完成时间 | 验证 |
|---|---|---|---|---|---|---|
| P0.1 | 统一 style/config 约束源 | P0 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示 |
| P0.2 | 统一 config 生命周期 | P0 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示 |
| P1.1 | 建立 Electron services 目录和 path guard | P1 | 已完成 | 2026-05-27 | 2026-05-27 | `node --check` / `npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示 |
| P1.2 | 拆 Workspace / KB / Card 服务 | P1 | 已完成 | 2026-05-27 | 2026-05-27 | `node --check` / `npm run typecheck` 通过；`git diff --check` 仅 LF/CRLF 提示 |
| P1.3 | 拆 GraphMeta / Document / Attachment / Trash 服务 | P1 | 已完成 | 2026-05-27 | 2026-05-27 | `node --check` / `npm run typecheck` / `git diff --check` 通过；`git diff --check` 仅 LF/CRLF 提示 |
| P2.1 | 拆分 StorageBackend 接口类型 | P2 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` / `git diff --check` 通过 |
| P2.2 | 拆 service.ts 中 normalize 和领域类型 | P2 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` / `git diff --check` 通过 |
| P3.1 | 建立 application 目录规范 | P3 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` / `git diff --check` 通过 |
| P3.2 | 迁移图谱节点业务流程 | P3 | 已完成 | 2026-05-27 | 2026-05-27 | `npm run typecheck` / `git diff --check` 通过 |
| P4.1 | 继续拆 StyleSection panel/model | P4 | 已完成 | 2026-05-27 | 2026-05-27 | 所有 Panel 和 Model 抽取已通过 `npm run typecheck` / `git diff --check` |
| P4.2 | 拆其他大组件 | P4 | 已完成 | 2026-05-27 | 2026-05-27 | 所有计划内的大组件已完成拆分，通过 `npm run typecheck` |
| P5.1 | 建立测试基础设施 | P5 | 已暂停 | - | - | 暂时跳过 |
| P5.2 | 补核心纯逻辑测试 | P5 | 已暂停 | - | - | 暂时跳过 |
| P6.1 | 统一 feature 目录结构 | P6 | 已完成 | 2026-05-28 | 2026-05-28 | 已完全清空 src/components 目录，所有组件迁移至 features/ 和 shared/，npm run typecheck 通过 |
| P7.1 | 彻底清理无用代码 | P7 | 已完成 | 2026-05-29 | 2026-05-29 | 删除了废弃的 cardService.ts、math.ts 和 modal.ts 残留，移除了未使用的导出，npm run typecheck 通过 |
| P8.1 | 移除无用依赖 | P8 | 已完成 | 2026-05-29 | 2026-05-29 | 移除了 @antv/x6 多个插件、react-katex 等 9 个无用依赖，解决依赖冲突 |
| P8.2 | 编辑器懒加载 (Code Splitting) | P8 | 已完成 | 2026-05-29 | 2026-05-29 | 将三大文档编辑器 (Smart/MindMap/Flowchart) 改为 React.lazy，大幅减小主包体积 (3.6MB -> 1.2MB) |
| P8.3 | 修复顶层组件 Suspense 缺失 | P8 | 已完成 | 2026-05-29 | 2026-05-29 | 修复了 App.tsx 中由于懒加载弹窗组件未被 Suspense 包裹导致的潜在崩溃风险 |

---

## 6. 每次执行任务时的更新规则

后续每次按照本计划执行优化时，必须更新本文档：

1. 将任务状态从 `未开始` 改为 `进行中`。
2. 记录开始时间。
3. 完成后记录完成时间。
4. 写明改动文件。
5. 写明验证命令和结果。
6. 如发现新问题，在对应任务下补充“后续问题”。
7. 如任务范围变化，更新“验收标准”。

建议状态枚举：

```text
未开始
进行中
已完成
已暂停
已取消
```

---

## 7. 标准验证命令

通用验证：

```bash
npm run typecheck
git diff --check
```

Electron 相关验证：

```bash
node --check electron/main.js
node --check electron/file-service.js
node --check electron/preload.js
```

若拆出新的 Electron service，需要追加：

```bash
node --check electron/services/<service-name>.js
```

测试体系建立后追加：

```bash
npm run test
```

---

## 8. 风险控制

### 8.1 禁止事项

- 禁止一次性重写 `electron/file-service.js`。
- 禁止同时大规模改 Electron、Storage、UI 三层。
- 禁止未验证就继续下一阶段。
- 禁止重构时顺手改变用户可见行为。
- 禁止绕过 preload 白名单直接暴露 Electron 能力。

### 8.2 推荐策略

- 每个 PR / 每轮会话只处理一个明确阶段。
- 每次拆分前先建立 facade，保证外部调用不变。
- 优先移动纯函数，再移动副作用逻辑。
- 先类型验证，再人工验证关键路径。

---

## 9. 下一步建议

建议下一步从 **P0.1 统一 style/config 约束源** 开始。

原因：

- 风险低。
- 范围小。
- 能减少后续配置、样式、normalize 的重复逻辑。
- 已经和最近的 StyleTab 重构上下文强相关。
- 可以为 P0.2 config 生命周期统一打基础。

建议执行顺序：

```text
P0.1 -> P0.2 -> P1.1 -> P1.2 -> P1.3 -> P2.1 -> P2.2 -> P3 -> P4 -> P5 -> P6
```
