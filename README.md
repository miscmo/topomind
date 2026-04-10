# TopoMind — 可漫游拓扑知识大脑

一个知识图谱可视化工具，以「知识卡片房间」为核心模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

## 快速开始

### Electron 桌面端

```bash
npm install
npm start        # 启动应用
npm run dev      # 开发模式（带 DevTools）
```

打包为安装程序：

```bash
npm run build:mac    # macOS (.dmg)
npm run build:win    # Windows (.exe)
npm run build:linux  # Linux (.AppImage)
```

## 项目结构

```
├── index.html                 # 主入口（网页端 + Electron 共用）
├── package.json               # Electron 依赖 + 构建脚本
├── electron/                  # Electron 专属代码
│   ├── main.js                # 主进程（窗口、菜单、IPC）
│   ├── preload.js             # 预加载（安全暴露 Node API）
│   └── file-service.js        # 文件操作服务（fs 封装）
├── vendor/                    # CDN 库本地副本（Electron 离线用）
├── src/
│   ├── css/                   # 6 个样式模块
│   ├── js/                    # 10 个逻辑模块
│   └── data/                  # 3 个数据文件
├── assets/                    # 应用图标等资源
├── .github/workflows/
│   └── deploy.yml             # GitHub Pages 自动部署
└── setup-github.sh            # GitHub 一键部署脚本
```

## 存储架构

| 运行环境 | 结构数据 | Markdown/图片 |
|----------|----------|--------------|
| **Electron** | IndexedDB | Node.js fs 直接读写 `~/Documents/TopoMind/` |
| **Chrome/Edge** | IndexedDB | File System Access API 读写用户选择的目录 |
| **其他浏览器** | IndexedDB | IndexedDB Blob 存储（降级） |

工作目录结构（Electron / Chrome）：

```
~/Documents/TopoMind/
├── docs/            # 每个节点一个 .md 文件
│   ├── transformer.md
│   └── ...
└── images/          # 图片原始文件
    ├── img-xxx.png
    └── ...
```

## 技术栈

- **图谱引擎**: [Cytoscape.js](https://js.cytoscape.org/) + [ELK](https://www.eclipse.org/elk/) 布局
- **Markdown**: [marked.js](https://marked.js.org/)
- **持久化**: IndexedDB + File System Access API / Node.js fs
- **桌面端**: [Electron](https://www.electronjs.org/)
- **部署**: GitHub Pages（零配置）

## 快捷键

| 按键 | 功能 |
|------|------|
| 双击卡片 | 进入该卡片内部 |
| Backspace | 返回上一层 |
| Tab | 为选中节点添加子概念 |
| Delete | 删除选中节点 |
| Esc | 关闭弹窗/取消操作 |
| 双击空白 | 新建卡片 |

## License

MIT
