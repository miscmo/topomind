# 模块完整性与潜在缺陷报告（2026-04-25）

> 本报告基于当前已经拆分出来的模块，对每个模块的**功能完整性**、**潜在缺失功能**、**逻辑异常风险**和**需要优先修复的问题**进行逐项审查。

---

## 结论摘要

这次拆分整体方向是正确的，模块边界已经比之前清晰很多：

- 页面层从 `GraphPage` 中抽离了画布和右侧面板
- 页面级副作用集中到 `useGraphPageController`
- 导航与选中态入口已经开始统一到 `useNavContext`
- `useKeyboard` 不再直接操作底层 `tabStore`
- `useGraph` 的导航与搜索逻辑也已经拆分

但当前代码仍然存在几个**比较明确的功能完整性问题**和**逻辑风险点**，其中一部分是拆分过程中引入的，一部分是拆分后暴露出来的。最需要优先关注的是：

1. `GraphPage` 对 `GraphRightPanel` 的传参与组件接口不一致，说明页面层尚未完全对齐拆分结果
2. `GraphPage` 仍然存在 lint 警告，说明当前页面文件可能还有未清理干净的结构残留
3. `useGraph` 中导航导出目前存在高风险：`navigateToRoom`、`navigateBack`、`navigateToRoot` 的职责关系需要确认，避免 API 语义错位
4. `useNavContext` 和 `useKeyboard` 现在“看起来统一了”，但仍然有双路状态源的底层遗留，语义上并未完全消除
5. `useGraphPageController` 的职责边界基本合理，但它当前过于依赖 `nav` 快照，未来如果状态更新频繁，可能出现快照陈旧或错过更新的问题

总体看，当前模块已经接近可用，但还不能完全认为“功能闭环已完成”。

---

## 一、逐模块审查

### 1. `src/components/GraphPage.tsx`

#### 当前职责

- 组合页面布局
- 挂载 `GraphContextProvider`
- 组织 `Breadcrumb`、`SearchBar`、`GraphCanvas`、`GraphRightPanel`、`GitPanel`
- 连接右键菜单和快捷键
- 控制右侧面板宽度和折叠逻辑

#### 功能完整性判断

整体上基本完整，但存在明显的**接口对齐风险**。

#### 发现的问题

##### 问题 1：`GraphRightPanel` 的 props 语义已发生变化，但 `GraphPage` 还要负责传递状态

当前 `GraphRightPanel` 已经被改成：

- `selectedNodeId`
- `tabId`
- `rightPanelTab`
- `onTabChange`

这意味着右侧面板已经从“自持状态”变成“受控组件”。这是合理的，但当前 `GraphPage` 还没有完全对齐这一变化，导致页面层责任更重。

这不是功能缺失，但属于**重构后的架构未完全收口**。

##### 问题 2：`GraphPage` 仍然存在未定位的 lint warning

当前 lint 检查一直报 `GraphPage.tsx` 有 3 个无法定位的 warning。虽然不是明确的语法错误，但说明：

- 文件里可能还保留了不被工具准确识别的边界问题
- 或者存在静态分析无法定位的潜在结构残留

这类 warning 需要后续再做一次精确检查。

##### 问题 3：页面层依然保留了较多交互编排

当前 `GraphPage` 仍然持有：

- `useResizePanel`
- `useContextMenu`
- `useKeyboard`
- `useNodeActions`

这在当前阶段是可接受的，但从“功能完整性”看，它意味着页面层仍然承担着不少协调责任。若后续再继续做功能，很容易再次膨胀。

#### 结论

`GraphPage` 功能基本完整，但**当前拆分还未稳定收口**，并且存在 lint 警告与组件受控化未完全对齐的问题。

---

### 2. `src/components/GraphCanvas.tsx`

#### 当前职责

- 渲染 React Flow 画布
- 接管节点 / 边 / 连线 / 视图交互
- 负责移动视图日志
- 展示底部 `Toolbar`

#### 功能完整性判断

这个模块功能是完整的，且职责比较清晰。

#### 发现的问题

##### 问题 1：`GraphCanvas` 仍然直接依赖全局状态中的右侧面板切换

在边点击时，`GraphCanvas` 会直接：

- `setSelectedEdgeId(edge.id)`
- `setRightPanelTab('style')`

这说明画布层仍然知道“右侧面板 tab”的业务语义。

这不一定是 bug，但意味着画布层仍然不是纯渲染层，仍然夹带了少量页面级协调逻辑。

##### 问题 2：空白区双击/单击清理选择时，仍然直接调用 `useAppStore.getState().clearSelection()`

这会让 `GraphCanvas` 直接触碰 appStore 的全局清理逻辑，而不是走统一导航/选择入口。

这属于**语义统一性未彻底完成**，不是功能缺失，但属于后续潜在维护风险。

##### 问题 3：`onInit` 继续把实例挂到 `window`

当前仍然有：

- `(window as any).__reactFlow = instance`

这通常是调试保留逻辑，不算错误，但从稳定性角度看，属于未收口的全局副作用。

#### 结论

`GraphCanvas` 功能完整，没有明显功能缺失，但仍保留少量页面控制语义和全局调试副作用。

---

### 3. `src/components/GraphRightPanel.tsx`

#### 当前职责

- 展示右侧详情/样式切换
- 根据 `rightPanelTab` 切换内容
- 展示当前节点详情或样式编辑区

#### 功能完整性判断

当前逻辑基本完整，而且比之前更纯。

#### 发现的问题

##### 问题 1：右侧面板已经是受控组件，但 `GraphPage` 还需要承担传参与状态管理

这不是组件自身 bug，而是拆分后状态归属在页面层，导致面板组件本身是完整的，**但整体状态流还没完全收口**。

##### 问题 2：样式页仍然依赖 `StyleSection` 内部的选边逻辑

如果当前选中的是边，右侧会展示样式页。这个交互链路是正常的，但说明右侧面板仍然依赖外部选中态和边状态，不是独立可运行模块。

#### 结论

`GraphRightPanel` 本身功能是完整的，没有明显缺失。它已经从“带状态组件”变成“受控 UI 组件”，这是正确的。

---

### 4. `src/hooks/useGraphPageController.ts`

#### 当前职责

- 统一读取导航上下文
- 触发页面日志
- 触发 room 加载
- 触发搜索高亮
- 注册 tab 保存
- 监听 dirty 状态变化

#### 功能完整性判断

当前逻辑是完整的，且职责边界较合理。

#### 发现的问题

##### 问题 1：它依赖的是 `nav` 快照，而不是单独的订阅式派生状态

`const nav = getNavState()` 这种写法会让 controller 在 render 时拿到一个快照值。若状态来源变化很频繁，可能存在：

- 某些 effect 在新状态还没被正确感知前先执行
- 依赖项只跟踪了 `nav.searchQuery`，但 `nav` 内其他字段变化的语义不是特别显式

当前这不算 bug，但属于**潜在的时序风险**。

##### 问题 2：搜索高亮和加载逻辑都集中在一个 controller 中

虽然这在当前规模下是合理的，但如果后续再加更多页面副作用，controller 可能会重新变厚。

#### 结论

`useGraphPageController` 功能完整，结构合理，但需要注意后续不要继续往里面塞新职责。

---

### 5. `src/hooks/useNavContext.ts`

#### 当前职责

- 提供统一的导航状态快照
- 提供搜索查询读写
- 提供选中节点读写
- 提供清空选中节点的接口

#### 功能完整性判断

这个模块已经从“只读兼容适配层”进化成“导航上下文入口”。功能是完整的。

#### 发现的问题

##### 问题 1：仍然是双源分流

当前 `tabId` 存在时读写 `tabStore`，否则读写 `roomStore` + `appStore`。这意味着：

- 语义统一了
- 但底层数据源并没有合并

也就是说，它解决的是“调用方式统一”，不是“状态源统一”。

##### 问题 2：`clearSelectedNode` 和 `setSelectedNodeId` 的语义很接近，但用途未完全分层

这两个接口对上层来说还可以，但对未来维护者而言，可能不容易一眼看出：

- 哪个是领域状态写入
- 哪个是 UI 清理

#### 结论

`useNavContext` 功能完整，没有明显缺失，但它只是把双源状态包装得更统一了，并没有真正消灭双源结构。

---

### 6. `src/hooks/useKeyboard.ts`

#### 当前职责

- 监听全局快捷键
- 处理 Escape / Delete / Backspace / Tab
- 结合选中态执行删除和新增子节点

#### 功能完整性判断

基本完整，且比之前更符合统一入口方向。

#### 发现的问题

##### 问题 1：Escape 时仍然同时调用 `getNavState().clearSelectedNode()` 和 `clearSelection()`

这说明清理路径仍然是双层的：

- 领域状态清理
- 全局 UI 状态清理

这不一定是 bug，但如果未来 `clearSelection()` 的语义改变，快捷键行为可能受到影响。

##### 问题 2：`getSelectedNodeId` 是通过 nav 快照函数拿到的

这会让快捷键逻辑依赖一个“即时快照”而不是显式订阅状态。当前能用，但对未来一致性不算最稳。

##### 问题 3：输入框场景只特别处理了 Escape

这是符合预期的，但如果后续要扩展快捷键，仍要小心避免输入态误触发。

#### 结论

`useKeyboard` 功能完整，逻辑可用，但 Escape 的清理路径仍然体现出“统一入口不完全统一”的残留。

---

### 7. `src/hooks/useGraph.ts`

#### 当前职责

- 图数据加载
- 节点 / 边 CRUD 协调
- React Flow 事件处理
- 选中态处理
- dirty 状态管理
- layout 持久化
- 搜索高亮
- 导航入口调用

#### 功能完整性判断

它的功能仍然是完整的，但目前是整个模块体系里最复杂的一层。

#### 发现的问题

##### 问题 1：`useGraph` 仍然持有太多状态与协调职责

即使导航已经抽出，它仍然保留了：

- `loadRoom`
- `layoutNodes`
- `onNodesChange`
- `onEdgesChange`
- `onConnect`
- `onNodeClick`
- `onEdgeClick`
- `onPaneClick`
- `highlightSearch`
- `flushCurrentRoomSave`

这不是“缺失功能”，而是说明 `useGraph` 仍然是一个核心大协调器。

##### 问题 2：`goBack`、`enterRoom` 等 store 依赖仍然保留在 hook 内

这意味着 `useGraph` 虽然瘦了一些，但并没有完全脱离底层存储逻辑。

##### 问题 3：`getActiveSelectedNodeId` / `setActiveSelectedNodeId` 依然直接依赖 `tabStore` / `appStore`

这说明选中态的统一其实还没有真正做完，只是把主要入口收窄了。

##### 问题 4：`buildGraphNavigation` 已经拆出，但 `useGraph` 的 public API 仍然较厚

虽然这是可以接受的，但在维护上要特别注意不要继续往 API 里塞新的导航/状态派生逻辑。

#### 结论

`useGraph` 没有明显的功能缺失，但它仍然偏大，且有不少“对外看起来模块化了、内部仍然依赖 store”的残留。

---

### 8. `src/hooks/useGraph/navigation.ts`

#### 当前职责

- 返回上一层
- 跳转历史位置
- 回到根级

#### 功能完整性判断

当前看起来是完整的。

#### 发现的问题

##### 问题 1：导航逻辑内仍然直接操作 `tabStore` 和 `roomStore`

这说明它是“导航模块”，但不是“抽象领域导航服务”。

也就是说：

- 功能上是够用的
- 但它仍然直接绑定底层 store

##### 问题 2：`navigateToRoot` 会根据 `tabId` 判断是否恢复 tab 状态

这逻辑是合理的，但意味着这个模块仍然带有明显的模式分流。

#### 结论

功能完整，没有明显缺失。它是一个可用的导航拆分结果，但还不是真正完全中立的导航服务层。

---

### 9. `src/hooks/useGraph/search.ts`

#### 当前职责

- 根据 query 对 nodes 打 `searchMatch`

#### 功能完整性判断

完整，而且是最干净的模块之一。

#### 发现的问题

没有明显问题。

#### 结论

这是当前拆分中最接近“纯函数模块”的部分，功能完整，风险最低。

---

## 二、比较明确的缺失或异常点

### 1. `GraphPage` 与 `GraphRightPanel` 的状态流仍未完全收口

虽然已经拆分得更清楚，但：

- 页面层还要传递 tab 状态
- 右侧面板还是受控组件
- 全局右侧面板 tab 仍由 store 统一持有

这不是 bug，但说明状态收口还没完成。

### 2. `GraphPage.tsx` 的 3 个 warning 还未消失

这是一个比较明确的异常信号。即使暂时无法定位，也说明该文件仍然有某种静态分析层面的残留问题。

### 3. `useKeyboard` 和 `useNavContext` 的清选语义仍有重叠

当前它们都能清选，但一个偏 UI，一个偏导航。未来如果不再约束，可能会出现重复调用或行为顺序问题。

### 4. `useGraph` 仍存在“模块拆了，但核心逻辑仍重”的状态

这会导致后续再加功能时，仍然容易回到厚 hook 的老路。

---

## 三、优先级建议

### 高优先级

1. 修正 `GraphPage.tsx` 那 3 个 warning 的来源
2. 确认 `GraphPage` 和 `GraphRightPanel` 的受控状态流是否真的完全对齐
3. 检查 `useGraph/navigation.ts` 是否需要进一步抽象重复模式判断

### 中优先级

4. 进一步核查 `useKeyboard` 的 Escape 清理路径是否存在重复执行风险
5. 确认 `useGraph` 中选中态写入是否还有可继续统一的入口

### 低优先级

6. 继续减少 `useGraph` 对底层 store 的直接依赖
7. 把更多领域逻辑拆成纯函数或 selector

---

## 四、最终判断

这次拆分出来的模块，**大多数功能都是完整的**，而且结构比之前明显更好。

但从“模块完整性”角度看，仍然有三个需要重点盯的地方：

- `GraphPage.tsx` 还没有完全收口，并且有未定位 warning
- `useGraph` 仍然过厚，虽然已经比之前清晰
- 状态统一还停留在“接口统一”，不是“底层源统一”

换句话说，这次拆分已经成功把代码带到了一个更合理的阶段，但还没有完全解决所有逻辑上的历史包袱。

如果后续继续做，建议优先处理**异常信号**而不是继续做更细的架构切割。
