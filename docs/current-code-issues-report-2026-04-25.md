# 当前代码问题复盘报告（2026-04-25）

> 目的：在你已经按上一版建议更新代码后，重新检查“原来提到的问题是否还存在”，并结合当前代码结构，给出一份可直接交给 Claude Code 继续实现的整改依据。

## 结论先行

上一版报告里提到的核心问题，**大部分仍然存在，只是部分已经被拆分和缓解**。

最明显的变化是：

- `Breadcrumb` 已经拆成了 `useBreadcrumbModel` 和 `useBreadcrumbActions`，比之前更接近“展示层 + 领域层”分离
- 面包屑不再是纯 UI 大杂烩，结构上已经明显更好了
- `useGraph` 也已经拆出 `graphBuilder` 和 `graphOperations`

但新的代码里仍然保留了几类更深层的问题，主要集中在：

- `GraphPage` 仍然过重
- Tab / 全局模式的状态来源仍然不统一
- `useGraph` 依旧承担了太多控制职责
- `useNavContext` 仍然是兼容层写法，且语义不够稳定
- store 之间仍有较多“桥接式同步”
- 部分逻辑虽然拆分了，但没有真正形成单一事实来源

---

## 一、上一版报告中的问题是否还存在

### 1. `GraphPage` 职责过重 —— 仍然存在

当前 `src/components/GraphPage.tsx` 仍然同时处理：

- 页面布局
- 图谱渲染
- 右侧面板宽度拖拽
- 视图日志埋点
- 搜索同步
- 选中节点同步
- tab / room 状态恢复
- 房间加载触发
- 快捷键与上下文菜单连接
- 右侧详情/样式面板切换

这说明页面层依然不是“薄容器”，而是一个非常重的业务编排点。

**结论**：问题仍然存在，而且是当前最优先要继续处理的问题之一。

---

### 2. Tab / 全局模式分支散落太多 —— 仍然存在，但比之前更集中了一点

你已经把一部分分流抽到 `useNavContext`、`useBreadcrumbModel`、`useBreadcrumbActions` 里了，这比之前强。

但当前状态读取仍然是多头的：

- `useGraph` 里根据 `tabId` 直接走 `tabStore` 或 `roomStore`
- `useNavContext` 同样再做一遍分流
- `GraphPage` 里还保留了 tab / global 兼容桥接
- `Breadcrumb` 直接基于 tab / global 两套来源计算

这说明“分流”虽然被抽出，但**统一模型还没有真正形成**。

**结论**：问题仍然存在，只是从“散在页面各处”变成了“集中在几个基础 hook 里”。

---

### 3. 导航逻辑与 UI 耦合 —— 部分改善，但仍未彻底解决

现在 `Breadcrumb` 已经拆成：

- `useBreadcrumbModel`
- `useBreadcrumbActions`
- `Breadcrumb` 纯展示

这是明显进步。

但是动作层里仍然只是“包装后再调用 `graph.navigateToRoot` / `graph.navigateToRoom`”，所以真正的导航语义仍然主要由 `useGraph` 决定。

也就是说：

- UI 层耦合减轻了
- 但导航控制权仍然高度集中在图谱 hook 中

**结论**：问题有所缓解，但没有根治。

---

### 4. `useGraph` 过于庞大 —— 仍然存在

虽然你已经把构建和 CRUD 拆到：

- `src/hooks/useGraph/graphBuilder.ts`
- `src/hooks/useGraph/graphOperations.ts`

但 `useGraph` 本身仍然保留了大量职责：

- load / save / flush
- navigation
- React Flow handlers
- search highlight
- layout
- dirty state
- active selection sync
- tab / room 兼容逻辑

所以它依然是一个“核心控制器”式 hook，而不是轻量组合层。

**结论**：问题仍然存在，只是拆出了局部子模块，并没有把复杂度从根上降下来。

---

### 5. 状态同步依赖过多“兼容桥接” —— 仍然存在

当前代码里仍可看到大量桥接关系：

- tab 内状态写入后，仍需兼容 app-level store
- `GraphPage` 里仍保留全局搜索同步
- 选中节点还要在 tab store 和 app store 之间同步
- room 状态仍需在某些时机恢复到 `roomStore`

这种设计说明系统还处于“迁移过渡态”，而不是已经收敛到单一数据源。

**结论**：问题仍然存在，而且是后续 bug 的高风险来源。

---

### 6. 副作用管理分散且时序复杂 —— 仍然存在

`GraphPage` 和 `useGraph` 里仍然有：

- `useEffect`
- `queueMicrotask`
- ref 兜底
- 手动监听 / 释放
- load request 序号防抖式控制

这些手法本身不是坏的，但说明时序已经复杂到需要很多保护层。

**结论**：问题仍然存在，且未来容易继续恶化。

---

### 7. 类型和接口不统一 —— 仍然存在

TypeScript 的使用范围是足够的，但语义模型还不够统一：

- `NavState`、`BreadcrumbState`、`GraphState`、tab state、room state 各自独立
- 这些对象之间没有形成统一的导航领域模型
- 一些函数仍然依赖“隐式字段语义”而不是明确的领域接口

**结论**：问题仍然存在，只是代码可读性比之前略好。

---

### 8. 可测试性不足 —— 仍然存在

虽然已经抽出了部分纯计算层，但关键业务流程仍然散落在：

- hook
- store
- component
- async effect

之间。

因此以下内容依旧难测：

- tab / global 的真实导航分支
- history index 的正确映射
- room restore 的时序
- dirty 状态的稳定性

**结论**：问题仍然存在，只是比之前更容易对部分纯函数写测试了。

---

## 二、当前代码的新问题

除了上一版问题仍在之外，新的实现方式还暴露出一些新的结构问题。

### 1. `useNavContext` 语义偏“兼容层”，不是稳定领域层

`src/hooks/useNavContext.ts` 现在返回的是：

- `kbPath`
- `roomPath`
- `roomName`
- `searchQuery`
- `selectedNodeId`
- `setSearchQuery`

看起来像是统一导航上下文，但它实际上仍然是：

- Tab 模式直接读 `tabStore`
- 非 Tab 模式直接读 `roomStore + appStore`
- 内部还包含写操作 `setSearchQuery`

这会导致它既不像纯数据适配器，也不像纯导航服务。

**新问题点**：这个 hook 的职责边界不清，后续会继续变成“谁都能往里塞一点兼容逻辑”的聚合点。

---

### 2. `useBreadcrumbActions` 现在是“动作包装层”，但信息仍然不完整

`Breadcrumb` 点击历史项时会把：

- `index`
- `roomName`
- `roomPath`

传给动作层，但真正执行时只是调用 `graph.navigateToRoom(index)`。

也就是说这些额外参数目前只用于日志，不参与导航决策。

**新问题点**：动作接口看似丰富，实际上导航语义仍然只依赖 index；如果历史结构变化，日志和真实导航状态可能再次分离。

---

### 3. `navigateToRoom` 中仍然存在可疑的重复 / 无效分支

在 `src/hooks/useGraph.ts` 中：

- `navigateToRoom` 先计算 `dirPath`
- 再赋值 `savedDirPath = dirPath`
- 然后判断 `if (savedDirPath && savedDirPath !== dirPath)`

这里的判断逻辑从字面上看几乎永远不会成立，因为两者来源相同。

这类代码通常意味着：

- 迁移时留下的分支没有完全清理
- 或者逻辑意图已经变化，但旧保护没更新

**新问题点**：存在“看起来像保护，实际上没效果”的分支，应该清理，否则会误导后续维护者。

---

### 4. `useGraph` 仍然承担状态、IO、导航、视图四种角色

当前 `useGraph` 同时做了：

- 状态管理
- 文件读写
- 图数据转换
- 导航编排
- React Flow 事件处理
- dirty 状态广播

这已经不是简单 hook，而是一个混合了 domain service、adapter 和 controller 的组合体。

**新问题点**：拆分虽然开始了，但角色划分仍旧混乱，后续继续扩展会越来越难维护。

---

### 5. 选中状态仍然双写，容易产生“来源不一致”

当前逻辑里：

- tab 模式下会写 `tabStore`
- 同时 app store 还保留 `selectedNodeId`
- `GraphPage` 里又有效果同步 app store 和 active tab 的 selected node

这会让“当前到底谁是选中状态的真值来源”变得不稳定。

**新问题点**：双写问题依旧，没有真正解决。

---

### 6. `AppStore` 仍然是高耦合的“大一统状态仓库”

`src/stores/appStore.ts` 里同时包含：

- UI 视图状态
- 右侧面板状态
- 右键菜单状态
- grid 显示状态
- 搜索状态
- 选中节点/边状态
- 默认连线样式
- KB 刷新触发器

它本质上是一个大而全的 UI store。

**新问题点**：虽然 Zustand 方便，但这个 store 仍然缺少领域拆分，后期会越来越难定位某个状态属于哪一层。

---

### 7. 导航相关概念仍未统一命名

当前代码中已经有很多相近概念：

- `roomPath`
- `kbPath`
- `currentRoomPath`
- `currentKBPath`
- `roomHistory`
- `selectedNodeId`
- `selectedEdgeId`
- `tab.currentRoomPath`

这些字段语义接近，但并不完全一致。

**新问题点**：命名体系不统一，容易导致新同学误用字段，也容易让旧逻辑在迁移时出错。

---

### 8. 从结构上看，项目正在形成“兼容层套兼容层”

目前的做法是：

- 页面层兼容全局 / tab
- nav hook 再兼容一次
- breadcrumb 再抽一次
- graph hook 再兜底一次

这种结构虽然短期可运行，但长期会形成“层层适配、层层同步”的局面。

**新问题点**：如果不尽快收口，这个项目会进入典型的“维护靠经验，排错靠猜”的状态。

---

## 三、当前最值得优先解决的问题

### P0

1. **确认单一事实来源**
   - 选中节点
   - 搜索词
   - 当前路径
   - 当前 tab / room 状态

2. **继续拆 `useGraph` 的职责**
   - load / save
   - navigation
   - selection sync
   - React Flow handlers
   - persistence

3. **去掉明显无效或重复的分支**
   - 尤其是导航和保存中的冗余条件

### P1

4. **统一 `NavState` / `BreadcrumbState` / tab state 的领域语义**
5. **让 `GraphPage` 变成更薄的页面编排层**
6. **减少 app store 与 tab store 的双写**

### P2

7. **补齐关键路径测试**
8. **把兼容层逐步收敛成明确的迁移策略**
9. **整理命名和领域模型**

---

## 四、建议给 Claude Code 的实现顺序

如果你下一步要直接让 Claude Code 实现，我建议按下面顺序推进：

1. 先统一导航领域模型，明确 `room` / `kb` / `tab` 的语义
2. 再拆 `useGraph` 中的导航和持久化逻辑
3. 然后把 `GraphPage` 变薄，把同步逻辑下放或上移到专用层
4. 最后去掉 app store / tab store 的重复状态写入

这样改动风险最小，而且每一步都容易验证。

---

## 五、最终判断

你这次的更新**确实解决了一部分表层问题**，尤其是：

- 面包屑已经明显更模块化
- 图谱逻辑开始分层

但从结构上看，项目仍然处在“重构进行中”的阶段，核心问题并没有消失，只是从“散乱暴露”变成了“在基础层聚集”。

所以现在最适合继续做的，不是再加新特性，而是继续：

- 收敛状态来源
- 收紧导航领域模型
- 降低 `GraphPage` 和 `useGraph` 的控制器化程度

这会直接决定后面代码还能不能继续健康演进。
