# TopoMind — 可漫游拓扑知识大脑

一个知识图谱可视化工具，以「知识卡片房间」为核心模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

## 快速开始

### Electron 桌面端

```bash
pnpm install
pnpm dev      # 开发模式（Vite）
pnpm build    # 构建渲染进程
pnpm preview  # 预览构建产物
```

打包为安装程序：

```bash
pnpm run build:win    # Windows (.exe)
pnpm run build:mac    # macOS (.dmg)
pnpm run build:linux  # Linux (.AppImage)
```

## 项目结构

```
├── index.html
├── package.json
├── vite.config.js
├── tsconfig.json
├── electron/                  # Electron 主进程与底层服务
│   ├── main.js
│   ├── preload.js
│   ├── file-service.js
│   ├── git-service.js
│   ├── git-auth.js
│   └── log-service.js
├── src/
│   ├── App.tsx                # 应用入口与视图切换
│   ├── main.tsx
│   ├── components/
│   │   ├── GraphPage.tsx      # 图谱页外层，挂载 GraphContextProvider
│   │   ├── HomePage.tsx
│   │   ├── SetupPage.tsx
│   │   ├── MonitorPage/
│   │   ├── DetailPanel/
│   │   ├── NavTree/
│   │   ├── Toolbar/
│   │   ├── SearchBar/
│   │   ├── Breadcrumb/
│   │   ├── ContextMenu/
│   │   ├── GitPanel/
│   │   └── PromptModal/
│   ├── contexts/
│   │   └── GraphContext.tsx   # 共享单例 graph 实例，避免多次 useGraph()
│   ├── hooks/
│   │   ├── useGraph.ts
│   │   ├── useGraph/graphBuilder.ts
│   │   ├── useNodeActions.ts
│   │   ├── useLayout.ts
│   │   ├── useStorage.ts
│   │   ├── useGit.ts
│   │   ├── useKeyboard.ts
│   │   ├── useContextMenu.ts
│   │   └── useDoubleClick.ts
│   ├── stores/
│   │   ├── appStore.ts
│   │   ├── roomStore.ts
│   │   ├── promptStore.ts
│   │   ├── monitorStore.ts
│   │   └── gitStore.ts
│   ├── core/
│   │   ├── fs-backend.ts
│   │   ├── storage.ts
│   │   ├── git-backend.ts
│   │   ├── log-backend.ts
│   │   └── logger.ts
│   ├── nodes/
│   │   └── KnowledgeCard.tsx
│   ├── types/
│   └── styles/
├── docs/
│   ├── logging-system-design.md
│   └── optimization-report-2026-04-21.md
├── CLAUDE.md
├── SPEC.md
└── README.md
```

## 技术栈

- **前端框架**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **状态管理**: [Zustand](https://zustand.docs.pmnd.rs/)
- **图谱引擎**: [React Flow](https://reactflow.dev/) + [ELK.js](https://github.com/kieler/elkjs) 分层布局
- **Markdown**: [marked.js](https://marked.js.org/)
- **Git 集成**: [simple-git](https://github.com/steveukx/git-js)
- **桌面端**: [Electron](https://www.electronjs.org/)
- **样式**: CSS Modules（无 Tailwind）

## 存储架构

纯文件系统存储，无 IndexedDB。

### 数据目录结构

```
~/Documents/TopoMind/                    # 或用户选择的目录
├── _config.json                         # 全局配置（最近打开的 KB、排序、封面）
└── [知识库名称]/
    ├── _graph.json                      # 图谱元数据（节点、边、缩放、画布位置）
    ├── [节点名称]/
    │   ├── _graph.json                  # 子图谱元数据
    │   ├── [子节点]/
    │   │   └── ...
    │   └── README.md                    # 节点文档
    └── images/                          # 图片文件
        └── [图片文件]
```

### 数据文件格式

- **`_graph.json`**: 存储 `children`（子目录映射）、`edges`（边）、`zoom`、`pan`、`canvasBounds`
- **`_config.json`**: 存储 `lastOpenedKB`、`orders`（排序）、`covers`（封面）

### 节点标识

- 节点通过路径标识（如 `transformer/multi-head`），非 UUID
- 节点显示名称存储在父目录的 `_graph.json` 中，格式为 `children[目录名].name`

## 功能特性

- **无限嵌套**: 知识库 → 房间 → 子房间 → ...
- **双击钻入/退出**: 像文件系统一样浏览知识
- **拖拽编辑**: 自由调整节点位置
- **边模式**: 点击节点拖拽创建关联
- **Markdown 支持**: 完整的 Markdown 渲染与编辑
- **图片支持**: 嵌入图片，自动清理 Blob URL
- **Git 版本控制**: 内置 Git 支持（本地仓库）
- **搜索**: 支持节点名称搜索，高亮匹配
- **日志监控**: 内置日志系统查看页面

## 快捷键

| 按键 | 功能 |
|------|------|
| 双击卡片 | 进入该卡片内部 |
| Backspace | 返回上一层 |
| Tab | 为选中节点添加子概念 |
| Delete | 删除选中节点 |
| Esc | 关闭弹窗/取消操作 |
| 双击空白 | 新建卡片 |
| 鼠标右键 | 上下文菜单 |
| Ctrl+S / Cmd+S | 保存 Markdown（编辑模式下）|

## IPC 通道白名单

与 Electron 主进程通信的通道（通过 `window.electronAPI.invoke`）：

### 文件系统
- `fs:init`
- `fs:listChildren`
- `fs:mkDir`
- `fs:rmDir`
- `fs:saveKBOrder`
- `fs:getKBCover`
- `fs:saveKBCover`
- `fs:renameKB`
- `fs:readGraphMeta`
- `fs:writeGraphMeta`
- `fs:getDir`
- `fs:updateCardMeta`
- `fs:readFile`
- `fs:writeFile`
- `fs:deleteFile`
- `fs:writeBlobFile`
- `fs:readBlobFile`
- `fs:clearAll`
- `fs:openInFinder`
- `fs:countChildren`
- `fs:ensureCardDir`
- `fs:getRootDir`
- `fs:getLastOpenedKB`
- `fs:setLastOpenedKB`
- `fs:setWorkDir`
- `fs:selectWorkDirCandidate`
- `fs:createWorkDir`
- `fs:importKB`

### Git
- `git:checkAvailable`
- `git:init`
- `git:status`
- `git:statusBatch`
- `git:isDirty`
- `git:commit`
- `git:log`
- `git:diff`
- `git:diffFiles`
- `git:commitDiffFiles`
- `git:commitFileDiff`
- `git:fetch`
- `git:push`
- `git:pull`
- `git:remote:get`
- `git:remote:set`
- `git:conflict:list`
- `git:conflict:show`
- `git:conflict:resolve`
- `git:conflict:complete`
- `git:auth:setToken`
- `git:auth:getSSHKey`
- `git:auth:setAuthType`
- `git:auth:getAuthType`

### 应用 / 其他
- `app:openExternal`
- `log:write`
- `log:getBuffer`
- `log:query`
- `log:setLevel`
- `log:clear`
- `log:getAvailableDates`
- `log:getLogDir`

## 当前代码审查结论

通读当前代码后，项目整体结构已经比较清晰，Electron 主进程、React 渲染层、存储层和 Git/日志能力边界也较明确；但仍有一些值得优先关注的问题：

1. **文档与实现多处不一致**
   - README / SPEC 中曾使用了旧版 IPC 名称、旧脚本命令、旧版本号。
   - 这会直接误导后续开发者或 AI 代理。

2. **GraphPage 责任仍然偏重**
   - `GraphPage.tsx` 同时处理页面骨架、图谱初始化、搜索联动、快捷键、上下文菜单、日志埋点。
   - 目前虽已通过 `GraphContext` 和 `useNodeActions` 做过拆分，但后续仍建议继续把页面级编排和图谱交互进一步解耦。

3. **`useGraph` 负担较大**
   - 该 hook 同时负责 room 加载、状态维护、节点边 CRUD、持久化、防抖保存、导航和搜索高亮。
   - 后续维护时容易出现 stale closure、状态同步、保存时机相关 bug。

4. **渲染层对存储模型耦合较深**
   - 例如节点 ID、路径、目录层级、README.md 和 `_graph.json` 的映射关系已经深入多个组件和 hook。
   - 这保证了效率，但会提高未来做存储演进或批量迁移时的成本。

5. **部分实现细节存在潜在一致性风险**
   - 例如 `roomStore` 的历史栈语义、`goBack` / `navigateToHistoryIndex` / `enterRoom` 之间的关系较绕。
   - 这类逻辑在复杂导航路径下容易回归，需要测试覆盖。

6. **预加载层仍有 `console.error` / `console.warn`**
   - 主体渲染层已经尽量切到 `logger`，但 preload 里仍保留原生命令行输出。
   - 如果希望日志体系彻底统一，后续可考虑收口。

7. **项目缺少自动化质量说明**
   - 仓库中有 `scripts/run-tests.mjs` 与 `playwright` 依赖，但 README 未明确测试入口与当前测试覆盖范围。
   - 建议后续补充“如何验证”的稳定流程。

## License

MIT