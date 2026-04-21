# TopoMind — 可漫游拓扑知识大脑

一个知识图谱可视化工具，以「知识卡片房间」为核心模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

## 快速开始

### Electron 桌面端

```bash
pnpm install
pnpm dev      # 开发模式（带 DevTools）
pnpm start    # 生产模式
```

打包为安装程序：

```bash
pnpm run build:win    # Windows (.exe)
pnpm run build:mac    # macOS (.dmg)
pnpm run build:linux  # Linux (.AppImage)
```

## 项目结构

```
├── index.html                 # 主入口
├── package.json               # 项目依赖 + 构建脚本
├── vite.config.js             # Vite 配置
├── tsconfig.json              # TypeScript 配置
├── electron/                  # Electron 专属代码
│   ├── main.js                # 主进程（窗口、菜单、IPC）
│   └── file-service.js        # 文件系统服务
├── src/
│   ├── main.tsx               # React 应用入口
│   ├── App.tsx                # 根组件（路由 + ReactFlowProvider）
│   ├── types/                 # TypeScript 类型定义
│   │   └── index.ts           # barrel 导出
│   ├── stores/                # Zustand 状态管理
│   │   ├── appStore.ts        # 应用全局状态（view、选中节点等）
│   │   ├── roomStore.ts       # 房间导航状态（当前房间、历史栈）
│   │   ├── gitStore.ts        # Git 状态
│   │   ├── promptStore.ts     # Prompt 弹窗状态
│   │   └── monitorStore.ts    # 监控页面状态
│   ├── hooks/                 # React 自定义 Hooks
│   │   ├── useGraph.ts        # 图谱核心逻辑（节点/边 CRUD、房间加载）
│   │   ├── useLayout.ts       # ELK.js 分层布局
│   │   ├── useStorage.ts      # 存储抽象层（Store 模块封装）
│   │   ├── useGit.ts          # Git 操作封装
│   │   ├── useKeyboard.ts     # 快捷键处理
│   │   ├── useContextMenu.ts   # 右键菜单逻辑
│   │   └── useDoubleClick.ts  # 双击检测
│   ├── nodes/                 # React Flow 自定义节点
│   │   └── KnowledgeCard.tsx  # 知识卡片节点
│   ├── components/            # React 组件
│   │   ├── HomePage.tsx       # 首页（知识库列表）
│   │   ├── GraphPage.tsx      # 图谱页面（三栏布局）
│   │   ├── MonitorPage/       # 日志监控页面
│   │   ├── DetailPanel/       # 右侧详情面板
│   │   ├── NavTree/           # 左侧导航树
│   │   ├── Toolbar/           # 图谱工具栏
│   │   ├── SearchBar/         # 搜索框
│   │   ├── Breadcrumb/        # 面包屑导航
│   │   ├── ContextMenu/       # 右键菜单
│   │   ├── GitPanel/          # Git 面板
│   │   └── PromptModal/       # Prompt 弹窗（替代 window.prompt）
│   ├── contexts/              # React Context
│   │   └── GraphContext.tsx   # 图谱单例（React Flow 节点/边 + 操作方法）
│   ├── core/                  # 核心模块
│   │   ├── fs-backend.ts      # IPC 文件系统调用（Electron 桥接）
│   │   ├── git-backend.ts     # Git 操作封装 + 内存缓存
│   │   ├── storage.ts         # 统一存储适配器
│   │   ├── log-backend.ts     # 日志后端
│   │   └── logger.ts          # 日志工具
│   └── styles/                # 全局样式
│       └── base.css           # CSS 变量定义
├── docs/                      # 文档
├── SPEC.md                    # 详细技术规范
└── README.md                  # 本文件
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
- `fs:init-work-dir` - 初始化工作目录
- `fs:set-work-dir` - 设置工作目录
- `fs:select-work-dir-candidate` - 选择工作目录候选
- `fs:create-work-dir` - 创建工作目录
- `fs:list-children` - 列出子项
- `fs:mk-dir` - 创建目录
- `fs:rm-dir` - 删除目录
- `fs:read-graph-meta` - 读取图谱元数据
- `fs:write-graph-meta` - 写入图谱元数据
- `fs:read-file` - 读取文件
- `fs:write-file` - 写入文件
- `fs:write-blob-file` - 写入二进制文件
- `fs:read-blob-file` - 读取二进制文件

### Git
- `git:check-available` - 检查 Git 是否可用
- `git:init` - 初始化仓库
- `git:get-status` - 获取状态
- `git:commit` - 提交
- `git:push` - 推送
- `git:pull` - 拉取

### 应用
- `app:select-directory` - 选择目录
- `app:open-in-finder` - 在文件管理器中打开
- `app:get-last-opened-kb` - 获取上次打开的知识库

## License

MIT