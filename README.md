# TopoMind — 可漫游拓扑知识大脑

一个纯前端的知识图谱可视化工具，以「知识卡片房间」为核心模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

## 在线体验

打开 `index.html` 即可运行，无需安装任何依赖。

## 项目结构

```
├── index.html                 # 主入口（纯 HTML 骨架）
├── src/
│   ├── css/
│   │   ├── base.css           # Reset + 布局 + 通用组件
│   │   ├── graph.css          # 画布 + 网格 + 控件 + 工具栏
│   │   ├── nav.css            # 左侧导航目录
│   │   ├── detail.css         # 右侧详情面板 + Markdown 渲染
│   │   ├── modal.css          # 模态框 + 右键菜单
│   │   └── editor.css         # 编辑器 + 内联输入 + 悬停按钮
│   ├── js/
│   │   ├── config.js          # 全局状态 + 配置常量
│   │   ├── graph.js           # Cytoscape 初始化 + 节点/边样式
│   │   ├── storage.js         # localStorage 自动持久化
│   │   ├── room.js            # 房间视野管理 + 面包屑导航
│   │   ├── detail.js          # 详情面板 + Markdown + 内联编辑
│   │   ├── nav.js             # 左侧导航目录构建
│   │   ├── crud.js            # 节点/边增删改 + 右键菜单 + 导入导出
│   │   ├── interaction.js     # 搜索 + 键盘快捷 + 悬停高亮
│   │   ├── grid.js            # 网格背景 + 对齐辅助 + snap
│   │   └── main.js            # 启动入口
│   └── data/
│       ├── colors.js          # 域颜色方案
│       ├── markdown.js        # 知识文档 Markdown 内容
│       └── graph-data.js      # 节点 + 边定义
├── .github/workflows/
│   └── deploy.yml             # GitHub Pages 自动部署
├── setup-github.sh            # GitHub 一键部署脚本
└── README.md
```

## 技术栈

- **图谱引擎**: [Cytoscape.js](https://js.cytoscape.org/) + [ELK](https://www.eclipse.org/elk/) 布局
- **Markdown**: [marked.js](https://marked.js.org/)
- **持久化**: localStorage
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
