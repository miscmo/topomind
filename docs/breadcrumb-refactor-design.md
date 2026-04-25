# 面包屑导航重构设计方案

> 目标：在不改变用户认知的前提下，重构当前面包屑导航，使其成为一个**单一职责、可复用、可测试、对 Tab 友好**的导航系统。

---

## 1. 现状理解

### 1.1 当前面包屑的职责

当前面包屑组件位于 `src/components/Breadcrumb/Breadcrumb.tsx`，它直接承担了以下职责：

1. 读取当前导航状态（`roomStore` / `tabStore`）
2. 推导面包屑显示内容
3. 触发导航动作（返回根级、跳转历史房间）
4. 记录日志（`logAction`）
5. 直接依赖图谱上下文 `useGraphContext()` 调用导航方法

### 1.2 当前数据来源

面包屑展示逻辑依赖两套状态源：

- **全局模式**：读取 `roomStore`
- **Tab 模式**：读取 `tabStore.getTabById(tabId)`

其中关键字段包括：

- `currentKBPath`
- `currentRoomPath`
- `currentRoomName`
- `roomHistory`
- `tab.label`

### 1.3 当前导航链路

当前点击行为对应的链路如下：

- 点击根节点
  - `Breadcrumb` 直接调用 `graph.navigateToRoot()`
- 点击历史节点
  - `Breadcrumb` 直接调用 `graph.navigateToRoom(index)`
- `useGraph` 内部再根据是否有 `tabId`，决定写入 `tabStore` 还是 `roomStore`
- 之后触发 `loadRoom()` 完成房间切换

### 1.4 当前实现的主要问题

1. **职责过多**
   - 组件同时负责展示、派生、导航、日志、状态兼容。
2. **Tab / 非 Tab 分支散落**
   - 组件内存在明显的“双分支判断”，可维护性一般。
3. **显示逻辑与导航逻辑耦合**
   - 面包屑的“如何展示”与“点击后做什么”混在一个组件里。
4. **缺少统一的数据模型**
   - 当前渲染依赖 `roomStore` / `tabStore` 原始字段，不利于后续扩展（例如：折叠、溢出、跳转菜单、最近路径等）。
5. **测试粒度不够清晰**
   - 很难单独测试“路径计算”与“导航行为”。

---

## 2. 重构目标

### 2.1 设计目标

重构后的面包屑应满足：

- **单一职责**：组件只负责渲染，状态派生与交互由专门层处理
- **统一模型**：不再直接消费 store 原始字段，而是消费标准化的 crumb model
- **Tab 友好**：Tab 与非 Tab 模式共享同一套计算规则
- **可扩展**：支持未来增加“折叠省略 / 右键跳转 / 快捷菜单 / 最近历史”等能力
- **易测试**：路径计算、点击行为、边界情况都可独立测试
- **可观测**：导航日志统一封装，避免散落在组件层

### 2.2 非目标

本次重构不优先解决：

- 图谱本身的导航算法改写
- `roomStore` / `tabStore` 的整体架构重构
- 业务层新增复杂路由系统

本次只聚焦“面包屑导航层”的设计升级。

---

## 3. 推荐的目标架构

### 3.1 分层设计

建议将面包屑拆成三层：

1. **数据适配层**
   - 从 `roomStore` / `tabStore` 提取当前导航状态
   - 统一转换为 `BreadcrumbState`

2. **领域计算层**
   - 根据 `BreadcrumbState` 计算 `BreadcrumbItem[]`
   - 决定哪些 item 可点击、哪些 item 为当前项、是否显示根节点

3. **UI 渲染层**
   - 只负责展示 crumbs、处理点击事件、无状态渲染

### 3.2 推荐模块拆分

建议新增以下模块：

- `src/components/Breadcrumb/Breadcrumb.tsx`
  - 纯 UI 入口组件
- `src/components/Breadcrumb/useBreadcrumbModel.ts`
  - 读取 store 并产出标准化面包屑数据
- `src/components/Breadcrumb/breadcrumb.types.ts`
  - 定义 crumb 数据结构
- `src/components/Breadcrumb/breadcrumb.utils.ts`
  - 纯函数：路径规范化、显示名计算、序列生成
- `src/components/Breadcrumb/breadcrumb.actions.ts`
  - 统一包装导航行为与日志埋点

如果希望更轻量，也可以不拆太细，但至少应保证“展示逻辑”与“导航逻辑”分离。

---

## 4. 目标数据模型

### 4.1 面包屑标准模型

建议统一为如下模型：

```ts
export interface BreadcrumbItem {
  id: string
  label: string
  path: string
  kind: 'root' | 'history' | 'current'
  clickable: boolean
}

export interface BreadcrumbState {
  kbPath: string | null
  roomPath: string | null
  roomName: string
  rootLabel: string
  items: BreadcrumbItem[]
  isAtRoot: boolean
}
```

### 4.2 设计原则

- `items` 是最终渲染的数据源
- `kind` 只用于视觉/行为区分，不参与业务判断
- `clickable` 由计算层决定，UI 只管渲染
- `path` 保留给后续右键菜单、复制路径、调试信息等能力

---

## 5. 推荐交互设计

### 5.1 面包屑语义

建议定义清晰语义：

- **根节点**
  - KB 名称或“知识库”
  - 当处于 KB 根时不可点击或表现为当前态
- **历史节点**
  - 当前路径中可回退的祖先房间
  - 点击后跳转到指定历史索引
- **当前节点**
  - 最终位置，不可点击

### 5.2 点击行为规范

- 点击根节点：回到 KB 根
- 点击历史节点：跳转至对应历史索引
- 点击当前节点：无动作

### 5.3 扩展交互建议

后续可扩展：

- `...` 折叠长路径
- 悬停显示完整路径
- 右键菜单：复制路径 / 在新窗口打开 / 固定当前节点
- 键盘快捷键：`Alt + ←` 返回上一层、`Alt + ↑` 回到根级

---

## 6. 重构后的核心流程

### 6.1 读取导航状态

统一由 `useBreadcrumbModel(tabId)` 完成：

- 判断是 Tab 模式还是全局模式
- 读取对应 store 状态
- 标准化为统一结构

### 6.2 计算 crumbs

计算规则建议如下：

1. 没有 KB 根路径时不渲染
2. 生成 root crumb
3. 将 `roomHistory` 映射为历史 crumbs
4. 如当前不在 root，则追加 current crumb
5. 若当前已在 root，则 root crumb 作为当前态

### 6.3 交互执行

点击交互不直接写在组件里，而是通过 action 层：

- `navigateToRoot(tabId)`
- `navigateToHistory(tabId, index)`

动作层统一处理：

- 日志记录
- Tab / 非 Tab 模式分流
- 是否需要保存当前房间
- 调用 `useGraph` 或 store action

---

## 7. 与现有代码的兼容策略

### 7.1 保留现有业务能力

重构必须保持：

- Tab 模式与非 Tab 模式均可用
- 面包屑仍能驱动 `useGraph.navigateToRoot / navigateToRoom`
- 现有日志语义不丢失
- 现有导航栈行为不被破坏

### 7.2 推荐兼容方式

建议采用“逐步替换”而不是“一次性重写”：

1. 先新增 `useBreadcrumbModel`
2. 再把现有 `Breadcrumb.tsx` 改为消费新 model
3. 保持 `useGraph` 导航 API 不变
4. 最后再考虑是否进一步抽出 `breadcrumb.actions.ts`

这样可以把风险控制在最小范围内。

---

## 8. 代码结构建议

建议最终目录如下：

```text
src/components/Breadcrumb/
├── Breadcrumb.tsx
├── Breadcrumb.module.css
├── breadcrumb.types.ts
├── breadcrumb.utils.ts
├── breadcrumb.actions.ts
└── useBreadcrumbModel.ts
```

如果希望更保守，也可以暂时只新增：

```text
src/components/Breadcrumb/
├── Breadcrumb.tsx
├── Breadcrumb.module.css
└── useBreadcrumbModel.ts
```

---

## 9. 实现建议

### 9.1 首选原则：纯函数优先

尽量将以下逻辑做成纯函数：

- 生成 root label
- 判断是否在 root
- 将 history 转换为 crumbs
- 计算当前 crumb 是否可点击

这样会显著提升可测试性。

### 9.2 store 读取建议

建议由 hook 层统一读取：

- `tabId` 作为输入
- 内部自动选择 `roomStore` 或 `tabStore`
- 对外返回 `BreadcrumbState`

不要在 UI 组件内部分散调用多个 store selector。

### 9.3 日志建议

日志建议保留，但统一从 action 层发出：

- `房间:返回根级`
- `房间:导航`

这样便于后续统一升级日志参数和埋点策略。

---

## 10. 建议的迁移步骤

### Phase 1：提取数据模型

- 新增 `breadcrumb.types.ts`
- 新增 `useBreadcrumbModel.ts`
- 保持旧 UI 不变，仅替换数据来源

### Phase 2：拆分交互

- 新增 `breadcrumb.actions.ts`
- 将点击处理从组件中移出
- 保持 `logAction` 和 `useGraph` 调用不变

### Phase 3：增强 UI 能力

- 支持长路径折叠
- 支持 tooltip / menu
- 统一样式规范

### Phase 4：补齐测试

- 单测：模型计算
- 单测：点击行为
- 组件测试：根节点、历史节点、当前节点状态

---

## 11. 测试方案

建议至少覆盖以下场景：

1. **全局模式**
   - 无房间时不渲染
   - 在 KB 根时 root 状态正确
2. **Tab 模式**
   - 正确读取对应 tab 的 `roomHistory`
   - 切换 Tab 后面包屑显示同步
3. **历史跳转**
   - 点击历史节点后，路径与历史栈正确收缩
4. **根级返回**
   - 点击 root 后回到 KB 根
5. **边界情况**
   - 空 history
   - rootPath 缺失
   - 当前项名称为空

---

## 12. 推荐的最终形态

最终理想状态是：

- `Breadcrumb.tsx` 只是一个“可读性很高”的展示入口
- 所有导航规则集中在 `useBreadcrumbModel` 和 `breadcrumb.actions`
- 任何未来导航增强，只需要改模型，不需要重写 UI
- 面包屑成为一个真正可复用的导航组件，而不是 GraphPage 的附属逻辑

---

## 13. 一句话结论

**把面包屑从“页面内的临时导航按钮”升级为“标准化的导航领域组件”**，通过“状态适配 + 领域建模 + UI 渲染”三层拆分，既保留现有行为，又为后续扩展和测试打下稳定基础。
