# TopoMind — 可漫游拓扑知识大脑

一个知识图谱可视化工具，以「知识卡片房间」为核心模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

## 快速开始

### Electron 桌面端

```bash
npm install
npm run dev      # 开发模式（带 DevTools）
npm start        # 生产模式
```

打包为安装程序：

```bash
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage)
```

## 项目结构

```
├── index.html                 # 主入口
├── package.json               # 项目依赖 + 构建脚本
├── vite.config.js             # Vite 配置
├── electron/                  # Electron 专属代码
│   ├── main.js                # 主进程（窗口、菜单、IPC、文件系统、Git）
│   └── preload.js             # 预加载（安全暴露 Node API）
├── src/
│   ├── main.js                # Vue 应用入口
│   ├── App.vue                # 根组件
│   ├── assets/                # 静态资源
│   ├── components/            # Vue 组件
│   │   ├── graph/             # 图谱相关组件
│   │   ├── room/              # 房间相关组件
│   │   └── ui/                # UI 组件
│   ├── composables/           # Vue 组合式 API
│   │   ├── useGraph.js         # 图谱核心逻辑（Cytoscape 封装）
│   │   ├── useGraphDOM.js      # 图谱 DOM 事件处理
│   │   ├── useStorage.js       # 存储抽象层
│   │   ├── useGit.js           # Git 集成
│   │   ├── useGrid.js          # 网格系统
│   │   ├── useNodeBadges.js    # 节点标记
│   │   └── useResizeDrag.js    # 节点缩放拖拽
│   ├── core/                  # 核心模块
│   │   ├── fs-backend.js       # IPC 文件系统调用
│   │   └── storage.js         # 统一存储适配器
│   └── stores/                # Pinia 状态管理
│       ├── app.js             # 应用全局状态
│       ├── room.js            # 当前房间状态
│       ├── git.js             # Git 状态
│       └── modal.js           # 弹窗状态
├── docs/                      # 文档
├── SPEC.md                    # 详细技术规范
└── README.md                  # 本文件
```

## 技术栈

- **前端框架**: [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **图谱引擎**: [Cytoscape.js](https://js.cytoscape.org/)
- **Markdown**: [marked.js](https://marked.js.org/)
- **Git 集成**: [simple-git](https://github.com/steveukx/git-js)
- **桌面端**: [Electron](https://www.electronjs.org/)

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
    │   └── [子节点].md                   # 节点文档
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
- **Markdown 支持**: 完整的 Markdown 渲染
- **图片支持**: 嵌入图片，自动清理 Blob URL
- **Git 版本控制**: 内置 Git 支持（本地仓库）
- **搜索**: 支持节点名称搜索

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

## IPC 通道白名单

与 Electron 主进程通信的通道（通过 `window.electronAPI.invoke`）：

### 文件系统
- `fs:create-kb` - 创建知识库
- `fs:read-kb` - 读取知识库列表
- `fs:create-room` - 创建房间（子目录）
- `fs:delete-room` - 删除房间
- `fs:read-graph` - 读取图谱数据
- `fs:write-graph` - 写入图谱数据
- `fs:read-file` - 读取文件内容
- `fs:write-file` - 写入文件
- `fs:delete-file` - 删除文件

### Git
- `git:check-available` - 检查 Git 是否可用
- `git:init` - 初始化仓库
- `git:get-status` - 获取状态
- `git:commit` - 提交
- `git:push` - 推送
- `git:pull` - 拉取

### 应用
- `app:select-directory` - 选择目录
- `app:get-path` - 获取路径

## License

MIT