# OpenSpec 规范文档

**项目**：TopoMind — 可漫游拓扑知识大脑
**版本**：v3.0.0
**最后更新**：2026-04-08
**状态**：已实现

---

## 1. 项目概述

TopoMind 是一个纯前端的个人知识大脑工具，核心是**知识卡片房间**模型——每个知识域是一个可视化容器卡片，双击即可"走进"查看内部子概念，支持无限层级嵌套。用于 AI / 计算机领域知识沉淀与学习。

### 1.1 核心定位

| 维度 | 说明 |
|------|------|
| 可视化 | 拓扑地图、Compound Graph 嵌套分组、ELK 分层布局 |
| 交互 | 卡片房间钻入/钻出、缩放漫游、分层显示 |
| 内容 | 节点 = 知识概念卡片；连线 = 概念关系；每张卡片绑定 Markdown 文档 |
| 编辑 | 双击空白创建、Tab 添加子节点、右侧面板内联编辑 Markdown |
| 持久化 | localStorage 自动保存全部修改（含节点位置），支持 JSON 导入/导出 |
| 模式 | 纯前端、本地运行、无后端、无构建步骤、双击 index.html 即可运行 |

---

## 2. 技术栈（强制）

| 类别 | 技术 | 版本 | CDN | 用途 |
|------|------|------|-----|------|
| 图谱引擎 | Cytoscape.js | 3.28.1 | unpkg | 节点/边渲染、交互、compound graph |
| 布局算法 | elkjs | 0.9.3 | unpkg | ELK 分层拓扑布局计算 |
| 布局桥接 | cytoscape-elk | 2.2.0 | unpkg | Cytoscape 与 ELK 的适配层 |
| Markdown | marked.js | 12.0.0 | unpkg | Markdown → HTML 渲染 |
| 持久化 | IndexedDB | 原生 | — | 结构化数据存储（节点/边/图片索引） |
| 文件系统 | File System Access API | 原生 | — | 本地磁盘读写 Markdown/图片（Chrome/Edge） |
| 画布 | Canvas 2D | 原生 | — | 网格背景绘制 |
| 部署 | GitHub Pages | — | — | GitHub Actions 自动部署 |

**约束**：

- 纯 HTML + JavaScript + CSS
- 无框架（无 React/Vue）、无 npm、无打包工具
- 所有第三方库通过 CDN `<script>` 引入
- 双击 `index.html` 即可本地运行

---

## 3. 项目结构

```
topomind/
├── index.html                    # 主入口（纯 HTML 骨架，无内联 CSS/JS）
├── README.md                     # 项目说明
├── SPEC.md                       # 本规范文档
├── .gitignore
├── setup-github.sh               # GitHub 一键部署脚本
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Pages 自动部署流水线
└── src/
    ├── css/
    │   ├── base.css              # Reset + 三栏布局 + 通用按钮/表单
    │   ├── graph.css             # 图谱面板 + 网格 + 工具栏 + 面包屑
    │   ├── nav.css               # 左侧导航目录
    │   ├── detail.css            # 右侧详情面板 + Markdown 渲染
    │   ├── modal.css             # 模态框 + 右键菜单
    │   └── editor.css            # Markdown 编辑器 + 内联输入 + 悬停按钮
    ├── js/
    │   ├── config.js             # 全局状态变量 + 工具函数
    │   ├── graph.js              # Cytoscape 初始化 + 节点/边样式定义
    │   ├── storage.js            # localStorage 持久化（保存/加载/清除）
    │   ├── detail.js             # 详情面板渲染 + 内联编辑模式切换
    │   ├── nav.js                # 左侧导航目录动态构建
    │   ├── room.js               # 房间视野管理 + 面包屑 + 钻入/退出
    │   ├── crud.js               # 节点/边 CRUD + 右键菜单 + 导入导出
    │   ├── interaction.js        # 搜索 + 键盘快捷 + 悬停高亮 + 缩放控制
    │   ├── grid.js               # 网格背景绘制 + 拖拽保存
    │   └── main.js               # 启动入口 + 事件绑定 + 自动保存
    └── data/
        ├── colors.js             # 39 个域颜色方案
        ├── graph-data.js         # 36 个节点 + 23 条边的默认数据
        └── markdown.js           # 33 个节点的 Markdown 文档内容
```

### 3.1 JS 加载顺序（依赖链）

```
数据层:  colors.js → markdown.js → graph-data.js
核心层:  config.js → graph.js → storage.js → detail.js → nav.js → room.js → crud.js → interaction.js → grid.js
启动:    main.js
```

所有模块通过全局变量通信，加载顺序严格保证依赖关系。

---

## 4. 数据结构规范

### 4.1 节点 (Node)

```javascript
{
  data: {
    id: string,         // 唯一标识（英文，如 'transformer'）
    label: string,      // 显示名称（如 'Transformer'）
    level: 1 | 2 | 3,  // 层级：1=顶层域, 2=子域, 3=细节
    parent: string      // 父节点 ID（可选，实现 Cytoscape compound graph 嵌套）
  },
  position: {
    x: number,          // 画布 X 坐标（持久化保存）
    y: number           // 画布 Y 坐标（持久化保存）
  },
  classes: 'card'       // CSS 类，固定为 'card'
}
```

### 4.2 边 (Edge)

```javascript
{
  data: {
    id: string,         // 唯一 ID（如 'e1'）
    source: string,     // 源节点 ID
    target: string,     // 目标节点 ID
    relation: string,   // 关系类型：'演进' | '依赖' | '相关'
    weight: string      // 视觉权重：'main'（主线）| 'minor'（次线）
  }
}
```

### 4.3 Markdown 文档

```javascript
var MD = {};                        // 全局对象
MD['node-id'] = '# 标题\n内容...'; // key=节点ID，value=Markdown字符串
```

### 4.4 颜色方案

```javascript
var DOMAIN_COLORS = {
  'node-id': {
    bg: '#4a6fa5',      // 叶子节点填充色 / 父节点边框色
    border: '#3d5d8a',  // 父节点文字色
    light: '#e8eef6'    // 父节点背景色 / 文字背景底板色
  }
};
```

颜色继承规则：子节点如无自定义颜色，沿 parent 链向上查找最近的颜色配置。

### 4.5 持久化存储

存储引擎：`IndexedDB`（数据库名 `topomind-db`），搭配 `File System Access API` 读写本地文件。

**IndexedDB Object Stores**：

| Store | keyPath | 主要字段 |
|-------|---------|----------|
| `nodes` | `id` | id, label, level, parent, posX, posY |
| `edges` | `id` | id, source, target, relation, weight |
| `markdown` | `id` | id, content, updatedAt |
| `images` | `id` | id, nodeId, filename, mime, size, createdAt, blob(降级) |
| `meta` | `key` | key=colors/view/workDirHandle, value |

**本地文件结构**（File System Access 模式）：

```
{工作目录}/
├── docs/
│   ├── {nodeId}.md    # 每个节点一个 Markdown 文件
│   └── ...
└── images/
    ├── img-xxx.png    # 图片原始文件
    └── ...
```

---

## 5. 功能需求

### 5.1 界面布局（三栏固定分栏）

#### 左侧导航面板（200px 固定宽度）

- 标题栏：显示 "🧠 知识目录"
- 导航树：动态生成，显示当前房间的直接子节点
  - 每项左侧有域颜色竖条
  - 有子概念的项显示数量徽标
  - 每项右侧有 "＋" 快捷添加子节点按钮
  - 当前选中项蓝色高亮
- 进入房间后顶部显示 "← 返回上一层" 按钮
- 底部显示 "＋ 新建卡片" 虚线按钮
- 单击导航项：选中节点 + 显示详情
- 双击导航项：钻入该节点房间

#### 中间图谱画布（flex:1 填充）

- **底层**：Canvas 点阵网格背景（可切换显示/隐藏）
- **主体**：Cytoscape.js 图谱容器
- **覆盖层 UI**：
  - 顶部居中：标题栏（当前房间名或应用名称）
  - 标题下方：面包屑导航（仅在房间内显示）
  - 左上角：关系图例（演进绿/依赖橙/相关灰虚线）
  - 右上角：搜索输入框
  - 左下角：缩放百分比指示器
  - 右下角：缩放控制按钮组（＋/－/⊡）
  - 底部居中：工具栏
  - 浮动：节点悬停快捷按钮（＋/⤯/✏）
  - 浮动：画布内联输入框
  - 底部偏上：保存指示器（"✓ 已保存"）
  - 底部偏上：快捷键提示条（启动后 4 秒消失）

#### 右侧详情面板（320px 固定宽度）

- 标题栏：节点名称 + 域颜色竖条
- 操作按钮行：
  - ✏️ 编辑（切换到内联编辑模式）
  - 📷 图片（插入本地图片）
  - ⚙ 属性（打开节点属性模态框）
  - 🗑 删除（确认删除节点）
  - 阅读/编辑 模式切换按钮组
- 内容区：
  - 阅读模式：Markdown 渲染 HTML + 子概念标签云
  - 编辑模式：textarea 内联 Markdown 编辑器
  - 默认：占位提示 "📖 点击节点查看详情"

---

### 5.2 知识卡片房间模型（核心）

这是应用的核心交互范式，实现无限层级的钻入/钻出导航。

#### 概念

- **卡片 (Card)**：每个节点渲染为一张卡片
  - 有子节点的卡片 = **容器卡片**（浅色背景 + 彩色边框，内部包含子节点）
  - 无子节点的卡片 = **叶子卡片**（深色填充 + 白色文字）
- **房间 (Room)**：任何有子节点的卡片都可以作为一个"房间"
- **当前视野**：`null`（全局）或某个房间节点 ID

#### 进入房间 (enterRoom)

1. 保存当前编辑内容 (`flushEdit`)
2. 隐藏所有元素
3. 确定可见元素：
   - 全局视野（null）：仅显示 level=1 节点 + 它们之间的边
   - 房间内（非 null）：父容器设为透明不可交互（`room-active` 类），仅显示其直接子节点 + 子节点之间的边
4. 次线边（`weight=minor`）仅在 zoom ≥ 0.8 时显示
5. **智能布局判断**：
   - 如果可见节点已有合理位置（非零、非重叠 >30%）→ 仅 `cy.fit()` 居中
   - 否则 → 执行 ELK 布局（全局方向 RIGHT，房间内方向 DOWN）
6. 更新面包屑、导航树、标题、缩放指示器
7. 自动保存状态

#### 钻入 (drillInto)

- 有子节点 → 将当前房间压入历史栈，进入新房间
- 叶子节点 → 仅选中并显示详情

#### 返回 (goBack)

- 从历史栈弹出上一层房间
- 历史栈为空时返回全局视野

#### 面包屑导航

- 格式：`🏠 全局 › 父房间名 › ... › 当前房间名`
- 每个历史层级可点击直接跳转
- "🏠 全局" 链接清空历史回到顶层

#### 父容器透明化

进入房间后，父容器节点应用 `room-active` 样式：

- 背景透明、边框消失、标签隐藏、padding 归零
- 不响应鼠标事件（`events: 'no'`）
- 子节点直接铺满画布作为视觉顶层

---

### 5.3 图谱节点结构（默认数据）

#### 顶层 8 大领域（Level 1）

| ID | 名称 | 颜色 |
|----|------|------|
| ai-base | AI 基础 | 蓝 #4a6fa5 |
| ml-base | 机器学习 | 绿 #5a8f7b |
| dl-core | 深度学习 | 紫 #7b68ae |
| nlp | 自然语言处理 | 橙 #c0723a |
| cv | 计算机视觉 | 青 #2e86ab |
| speech | 语音音频 | 粉 #a23b72 |
| llm | 大模型 LLM | 红 #d64045 |
| ai-eng | AI 工程部署 | 灰绿 #5b7065 |

#### LLM 子节点（Level 2，必须包含）

transformer, rag, agent, sft, ppo, moe, quantization, prompt

#### 其他域的子节点（Level 2）

- AI 基础：线性代数、概率统计、优化理论
- 机器学习：监督学习、无监督学习、强化学习
- 深度学习：CNN、RNN、GAN
- NLP：词嵌入、BERT、GPT
- CV：目标检测、图像分割
- 语音音频：语音识别、语音合成
- AI 工程：模型部署、MLOps

#### 三级节点（Level 3，Transformer 下）

self-attention, multi-head, ffn, positional-encoding

#### 关系类型

| 关系 | weight | 视觉 | 含义 |
|------|--------|------|------|
| 演进 | main | 绿色实线 + 箭头 | 知识发展路径 |
| 依赖 | main | 橙色实线 + 箭头 | 前置知识依赖 |
| 相关 | minor | 灰色虚线，无箭头 | 关联知识点 |

---

### 5.4 缩放联动显示规则

| 缩放级别 | 显示内容 |
|----------|----------|
| < 60% | 主线边隐藏文字标签 |
| 60% ~ 80% | 主线边显示标签（演进/依赖），次线边（相关）隐藏 |
| ≥ 80% | 次线边也显示 |

---

### 5.5 节点交互

| 操作 | 目标 | 效果 |
|------|------|------|
| 单击节点 | 图谱节点 | 选中节点，右侧显示 Markdown 详情，导航树同步高亮 |
| 双击节点 | 图谱节点 | 有子节点→钻入房间；叶子→选中并显示详情 |
| 单击空白 | 图谱背景 | 取消选中，显示占位提示 |
| 双击空白 | 图谱背景 | 弹出输入框，在当前房间创建新卡片 |
| 右击节点 | 图谱节点 | 弹出节点右键菜单 |
| 右击边 | 图谱边 | 弹出边右键菜单 |
| 悬停节点 | 图谱节点 | 高亮该节点及关联边/邻居，其他元素淡化；400ms 后显示快捷操作按钮 |
| 移出节点 | 图谱节点 | 恢复正常显示 |
| 拖拽节点 | 图谱节点 | 移动位置，释放后自动保存 |
| 滚轮 | 图谱 | 缩放画布（灵敏度 0.2，范围 15%~350%） |
| 拖拽画布 | 图谱背景 | 平移视图 |

---

### 5.6 键盘快捷键

| 按键 | 前提条件 | 效果 |
|------|---------|------|
| `Esc` | 任何时候 | 关闭所有模态框；取消连线模式；清空搜索 |
| `Backspace` | 不在输入框/模态框中，且在某房间内 | 返回上一层 |
| `Tab` | 有选中节点，不在输入框/模态框中 | 弹出输入框为选中节点添加子概念 |
| `Delete` | 有选中节点，不在输入框/模态框中 | 弹出删除确认 |

---

### 5.7 右键菜单

#### 节点右键菜单

| 菜单项 | 功能 |
|--------|------|
| 🔍 聚焦 | 钻入该节点房间 |
| ⚙ 属性 | 打开节点编辑模态框 |
| ✏️ 文档 | 选中节点并切换到编辑模式 |
| ＋ 子节点 | 弹出输入框添加子概念 |
| ⤯ 连线 | 进入连线模式，以该节点为源 |
| 🗑 删除 | 弹出删除确认 |

#### 边右键菜单

| 菜单项 | 功能 |
|--------|------|
| ⚙ 编辑 | 打开边编辑模态框（修改关系类型） |
| 🗑 删除 | 直接删除该边 |

---

### 5.8 工具栏按钮

| 按钮 | 功能 |
|------|------|
| ＋ 节点 | 在当前房间新建卡片 |
| ⤯ 连线 | 进入连线模式（以选中节点为源，依次点击源→目标） |
| ⊞ 网格 | 切换网格背景显示/隐藏 |
| ↓ 导出 | 导出全部数据为 `topomind-data.json` |
| ↑ 导入 | 从 `.json` 文件导入数据 |
| 📁 目录 | 选择/切换本地工作目录（Chrome/Edge） |
| ↺ 重置 | 清除所有保存数据，恢复默认（带确认） |

#### 缩放控制按钮

| 按钮 | 功能 |
|------|------|
| ＋ | 放大 1.3 倍 |
| － | 缩小 1.3 倍 |
| ⊡ | 适配全部可见元素到视口 |

---

### 5.9 模态框

#### 节点编辑模态框

- 字段：ID（英文，编辑时禁用）、名称、层级（顶层/子域）、父节点（下拉）
- 操作：取消 / 保存

#### 边编辑模态框

- 字段：源节点（下拉）、目标节点（下拉）、关系类型（依赖/演进/相关）
- 操作：取消 / 保存

#### Markdown 编辑器模态框

- 双标签：编辑 / 预览
- 编辑区：等宽字体 textarea
- 预览区：实时 Markdown 渲染
- 操作：取消 / 保存

#### 删除确认模态框

- 显示待删除节点名称
- 删除逻辑：递归删除节点及所有子节点、关联边、Markdown 内容
- 操作：取消 / 确认删除（红色危险按钮）

---

### 5.10 Markdown 详情

每个节点的 Markdown 文档应包含：

- 定义
- 核心思想
- 结构 / 关键点
- 应用场景
- 关联知识点
- 代码块
- 链接、图片、列表、表格

渲染配置：`marked.js`，`breaks: true, gfm: true`

详情面板额外展示：如果节点有子概念，在文档下方显示**子概念标签云**（彩色圆角标签，可点击钻入）。

---

### 5.11 搜索功能

- 位于图谱面板右上角
- 实时搜索（`input` 事件触发）
- 搜索范围：节点 `label` 和 `id`
- 匹配方式：大小写不敏感子串匹配
- 匹配节点添加黄色边框高亮（`#f1c40f`）
- 清空输入 / 按 Esc 移除高亮

---

### 5.12 自然编辑交互

| 操作 | 方式 |
|------|------|
| 新建领域 | 双击画布空白 → 弹出 prompt 输入名称 → 自动生成 ID 和颜色 |
| 添加子节点 | 选中节点 → 按 Tab → 输入名称；或悬停节点 → 点"＋"按钮 |
| 画连线 | 悬停节点 → 点"⤯"按钮 → 点目标节点 → 选关系类型 |
| 编辑文档 | 右侧面板切换到编辑模式直接写 Markdown；或悬停节点 → 点"✏"按钮 |
| 删除节点 | 选中节点 → 按 Delete 键 → 确认 |
| 左侧导航添加 | 点击域名右侧"＋"按钮 → 输入名称 |

所有创建操作**无需手动填写 ID**（自动生成）、**无需选择层级**（自动推断）。

---

### 5.13 持久化存储（IndexedDB + 本地文件系统混合）

#### 存储架构

```
本地磁盘（用户选择的工作目录）          IndexedDB（浏览器内）
┌──────────────────────────┐      ┌─────────────────────┐
│ ~/TopoMind/              │      │ topomind-db          │
│ ├── docs/                │      │ ├── nodes (结构+位置) │
│ │   ├── transformer.md   │      │ ├── edges (关系)      │
│ │   └── ...              │      │ ├── markdown (文档)    │
│ └── images/              │      │ ├── images (图片索引)  │
│     ├── img-xxx.png      │      │ └── meta (颜色/视野)   │
│     └── ...              │      └─────────────────────┘
└──────────────────────────┘
```

| 存储位置 | 存储内容 | 原因 |
|----------|----------|------|
| **本地磁盘** | Markdown 文档（.md 文件）、图片原始文件 | 可迁移、可外部编辑、可 Git 管理、无配额限制 |
| **IndexedDB** | 节点/边/位置/颜色/视野/图片索引 | 结构化查询快、异步不阻塞、启动快 |

#### 浏览器兼容

| 浏览器 | File System Access API | 行为 |
|--------|----------------------|------|
| Chrome/Edge 86+ | 支持 | 混合模式：本地文件 + IndexedDB |
| Safari/Firefox | 不支持 | 降级为纯 IndexedDB（Markdown 和图片 Blob 存 IndexedDB） |

#### IndexedDB 表结构

| Object Store | keyPath | 字段 |
|-------------|---------|------|
| `nodes` | `id` | id, label, level, parent, posX, posY |
| `edges` | `id` | id, source, target, relation, weight |
| `markdown` | `id` | id, content, updatedAt |
| `images` | `id` | id, nodeId, filename, mime, size, createdAt, blob(降级模式) |
| `meta` | `key` | key, value |

#### 保存触发时机

| 时机 | 写入方式 |
|------|----------|
| 节点拖拽释放 | 批量更新 nodes 表（300ms 防抖） |
| 新增/删除节点 | 增量更新 nodes 表 |
| 重命名节点 | 更新单条 node |
| 新增/删除连线 | 增量更新 edges 表 |
| Markdown 编辑（1 秒防抖） | 写入 markdown 表 + 本地 .md 文件 |
| 切换阅读/编辑模式 | 写入 markdown 表 + 本地 .md 文件 |
| 进入/退出房间 | 更新 meta 中的 view |
| 图片粘贴/拖拽 | 写入 images 表 + 本地文件 |
| 页面关闭/刷新前 | 同步写入全部未保存内容 |

#### 启动流程

1. 初始化 IndexedDB
2. 尝试从 localStorage 迁移旧数据（自动清除旧存储）
3. 尝试恢复上次的工作目录授权
4. 从 IndexedDB 加载全部图结构
5. 如无存档 → 写入默认数据
6. 进入保存的视野状态

#### 工作目录管理

- 工具栏 `📁 目录` 按钮 → 打开系统目录选择器
- 选择后自动创建 `docs/` 和 `images/` 子目录
- 将 IndexedDB 中的 Markdown 同步写出到本地 `.md` 文件
- 目录授权句柄保存在 IndexedDB，下次打开自动恢复

#### 图片存储

- **上传方式**：编辑区粘贴（Ctrl+V）、拖拽、📷 按钮选择文件
- **自动压缩**：>500KB 的图片自动压缩为 WebP（最大 1920px，质量 85%）
- **引用格式**：`![描述](images/img-xxx.ext)` 相对路径
- **渲染**：从 IndexedDB/本地文件读取 Blob → ObjectURL 显示
- **级联删除**：删除节点时自动清理关联图片
- **兼容**：不支持 File System 的浏览器将图片 Blob 存入 IndexedDB

#### 迁移能力

| 场景 | 方式 |
|------|------|
| 拷贝到另一台电脑 | 整个工作目录拷贝 → 打开 TopoMind → 选择该目录 |
| 导出为 JSON | ↓ 导出 按钮（含节点位置，不含图片） |
| 从 JSON 导入 | ↑ 导入 按钮 |
| Git 版本管理 | 对工作目录 `git init` |
| 网盘同步 | 工作目录放在 iCloud/OneDrive 中 |

#### 存储状态栏

图谱面板左上角显示当前存储模式和统计：
- 混合模式：`📁 TopoMind | 36 节点 · 33 文档 · 5 图片`
- 纯浏览器：`💾 浏览器存储 | 36 节点 · 33 文档`

---

### 5.14 导入导出

#### 导出

- 格式：JSON 文件（`topomind-data.json`）
- 内容：nodes（含位置坐标）、edges、markdown、colors
- 方式：Blob → ObjectURL → `<a>` 下载

#### 导入

- 格式：`.json` 文件
- 流程：读取 → 解析 → 清空当前数据 → 恢复 colors → nodes（含位置）→ edges → markdown → 重置视野 → 保存
- 错误处理：解析失败弹出 alert

---

### 5.15 网格背景系统

- **实现**：`<canvas>` 绘制，与 Cytoscape 图层分离，2x Retina 适配
- **网格样式**：
  - 小点：基础间距 20px，动态密度调整，颜色 `rgba(160,170,185,0.25)`
  - 大点：每 5 个小点，颜色 `rgba(140,150,165,0.4)`
  - 原点十字线：蓝色虚线 `rgba(52,152,219,0.15)`
- **联动**：跟随画布缩放/平移/窗口大小变化实时重绘
- **开关**：工具栏 "⊞" 按钮切换

---

## 6. 视觉风格规范

### 6.1 色彩体系

| 角色 | 色值 | 用途 |
|------|------|------|
| 主色调 | `#1a3a5c` | 标题、按钮主色、导航高亮 |
| 强调色 | `#3498db` | 选中边框、搜索焦点 |
| 页面背景 | `#f0f2f5` | 全局背景 |
| 面板背景 | `#fff` | 三个面板 |
| 画布背景 | `#eef0f4` | 图谱画布区 |
| 主文字 | `#2d3436` | 正文 |
| 次要文字 | `#555` | 标签、提示 |
| 边框 | `#e0e4ea` / `#e8ecf0` | 分割线 |
| 危险色 | `#e74c3c` | 删除按钮 |
| 成功色 | `#2ecc71` | 保存指示器 |
| 搜索匹配 | `#f1c40f` | 搜索高亮 |
| 悬停高亮 | `#f39c12` | 节点悬停边框 |
| 演进边色 | `#5cb85c` | 演进关系 |
| 依赖边色 | `#e8913a` | 依赖关系 |
| 次线边色 | `#ccc` | 相关关系 |

### 6.2 8 域 8 色编码

每个顶层领域有独特颜色（bg/border/light 三色套），子节点继承父域颜色。

### 6.3 字体

- 系统字体：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- 代码字体：`"SF Mono", "Fira Code", Consolas, monospace`

### 6.4 圆角

- 模态框：12px
- 工具栏/标题栏：10px / 8px
- 按钮：7px / 6px
- 悬停操作按钮：50%（圆形）
- 叶子节点：8px
- 容器节点：12px

### 6.5 交互效果

- 毛玻璃：`backdrop-filter:blur(6px)` + 半透明白（标题、工具栏、图例、搜索、面包屑）
- 过渡动画：节点属性 0.3s、按钮 hover 0.12~0.15s
- 节点阴影：`underlay-color: #000, underlay-opacity: 0.06~0.08`（微阴影增加层次）
- 模态框遮罩：`backdrop-filter:blur(2px)` + 半透明黑

### 6.6 Markdown 渲染样式

- h1：20px 深蓝 + 底部 2px 分割线
- h2：16px 蓝色
- h3：14px 青蓝色
- 代码块：深色背景 `#1a2332` + 浅色文字
- 行内代码：浅灰背景 + 红色文字 `#c0392b`
- 引用块：左侧蓝色竖条 + 浅蓝背景
- 表格：完整边框 + 灰色表头

---

## 7. Cytoscape 图谱配置

### 7.1 引擎参数

- `minZoom: 0.15`
- `maxZoom: 3.5`
- `wheelSensitivity: 0.2`

### 7.2 节点样式

| 选择器 | 关键样式 |
|--------|----------|
| `node.card` | 圆角矩形，label 显示，过渡 0.3s |
| `node.card:parent` | 浅色背景 0.7 透明度，彩色边框，标签顶部居中 + 文字背景底板，padding 30px，underlay 阴影 |
| `node.card:childless` | 深色背景 0.92 透明度，白字居中，自适应宽高，padding 11px，underlay 阴影 |
| `node.selected` | 蓝色 `#3498db` 边框 3px |
| `node.highlighted` | 橙色 `#f39c12` 边框 3px |
| `node.faded` | 透明度 0.1 |
| `node.search-match` | 金黄 `#f1c40f` 边框 3px |
| `node.room-active` | 完全透明不可交互 |
| `.hidden` | `display: none` |

### 7.3 边样式

| 选择器 | 关键样式 |
|--------|----------|
| `edge[weight="main"]` | 2px bezier 曲线，三角形箭头 |
| `edge[relation="演进"][weight="main"]` | 绿色 `#5cb85c`，标签 "演进" |
| `edge[relation="依赖"][weight="main"]` | 橙色 `#e8913a`，标签 "依赖" |
| `edge[weight="minor"]` | 1px dotted unbundled-bezier，灰色 `#ccc`，无箭头，透明度 0.4 |
| `edge.highlighted` | 3px，透明度 1，z-index 999 |
| `edge.faded` | 透明度 0.03 |

### 7.4 布局算法

- 算法：ELK layered
- 全局视野方向：RIGHT
- 房间内方向：DOWN
- 节点间距：动态 `max(30, 70 - nodeCount * 2)`
- 层间距：节点间距 + 25
- 节点放置策略：NETWORK_SIMPLEX

---

## 8. 全局状态管理

| 变量 | 类型 | 定义位置 | 说明 |
|------|------|---------|------|
| `selectedNode` | Cytoscape Node / null | config.js | 当前选中节点 |
| `edgeMode` | boolean | config.js | 是否处于连线模式 |
| `edgeModeSource` | Cytoscape Node / null | config.js | 连线模式的源节点 |
| `currentRoom` | string / null | config.js | 当前房间 ID |
| `roomHistory` | string[] | config.js | 房间历史栈 |
| `autoIdCounter` | number | config.js | 自增 ID（基于 Date.now()） |
| `edgeIdCounter` | number | crud.js | 边 ID 计数器 |
| `cy` | Cytoscape 实例 | graph.js | 图谱引擎 |
| `MD` | object | markdown.js | Markdown 文档集合 |
| `DOMAIN_COLORS` | object | colors.js | 颜色配置集合 |
| `gridEnabled` | boolean | grid.js | 网格显示开关 |

---

## 9. 部署

### 9.1 GitHub Actions 工作流

- 文件：`.github/workflows/deploy.yml`
- 触发：`push` 到 `main` 分支 / 手动触发
- 构建：直接上传全部静态文件为 Pages artifact（无构建步骤）
- 部署目标：GitHub Pages

### 9.2 一键部署脚本

- 文件：`setup-github.sh`
- 功能：创建 GitHub 公开仓库 → 提交代码 → 推送 → 启用 Pages

---

## 10. 变更日志

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0.0 | 2026-04-08 | 初始版本：8 大领域 + LLM 子节点，ELK 布局，分层显示，Markdown 详情 |
| v1.1.0 | 2026-04-08 | 新增节点/边 CRUD，Markdown 编辑器，右键菜单，导入导出 |
| v1.2.0 | 2026-04-08 | 新增聚焦视图（双击钻入，面包屑导航） |
| v1.3.0 | 2026-04-08 | Compound Graph 重构：嵌套分组，8 域 8 色，主线/次线分离，三栏布局 |
| v1.4.0 | 2026-04-08 | 自然交互升级：双击空白创建、Tab 快捷子节点、悬停操作按钮、内联编辑 |
| v1.5.0 | 2026-04-08 | 知识卡片房间模型：无限嵌套，双击进入/Backspace 退出 |
| v1.6.0 | 2026-04-08 | 视觉优化：文字不重叠、边层次化、缩放联动 |
| v1.7.0 | 2026-04-08 | 网格画布：点阵网格背景，网格开关 |
| v1.8.0 | 2026-04-08 | 自动保存：localStorage 持久化，保存指示器，重置功能 |
| v1.9.0 | 2026-04-08 | 进入房间后父容器透明消失 |
| v1.10.0 | 2026-04-08 | 修复切换卡片后修改丢失（智能布局判断） |
| v1.11.0 | 2026-04-08 | 修复编辑内容自动保存（flushEdit + 输入防抖 + beforeunload） |
| v2.0.0 | 2026-04-08 | 模块化拆分（19 个模块文件），移除自动整理/吸附对齐 |
| v3.0.0 | 2026-04-08 | 存储架构重构：IndexedDB + File System Access API 混合存储，图片上传（粘贴/拖拽/按钮），自动压缩，级联删除，localStorage 自动迁移，存储状态栏 |
