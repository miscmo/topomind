# TopoMind 第8轮维护报告

**日期**: 2026-04-17
**分支**: feat/vue3-migration
**维护轮次**: 第8轮

---

## 一、检查了哪些功能

本轮维护覆盖了以下功能模块的代码审查和架构评估：

### 1. 图谱引擎 (Graph Engine)
- `src/composables/useGraph.js` — ELK 布局、节点位置管理、缩放/平移、样式更新
- `src/composables/useGraphDOM.js` — DOM 事件绑定（拖拽、缩放、右键菜单）、节点 resize
- `src/core/cy-manager.js` — Cytoscape 实例生命周期管理（LUR 缓存、激活/卸载）

### 2. 详情面板 (Detail Panel)
- `src/components/DetailPanel.vue` — Markdown 渲染/编辑、图片加载、目录导航、样式面板

### 3. Git 面板 (Git Panel)
- `src/components/GitPanel.vue` — 提交、历史、同步、冲突解决

### 4. 存储层 (Storage Layer)
- `src/composables/useStorage.js` — 存储 API composable，封装 IPC 桥接
- `src/core/storage.js` — 业务层唯一入口

### 5. 其他组件
- `src/components/Grid.vue` — 网格背景绘制
- `src/components/StylePanel.vue` — 节点/边样式配置面板
- `src/core/git-backend.js` — Git 后端缓存 + TTL 清理

### 架构审查维度（10项）
代码结构、模块分层、架构设计、状态管理、文件组织、用户交互体验、UI 展示与样式、功能逻辑合理性、性能优化、可维护性提升

审查方式：3个并行子代理（架构/性能审查、代码质量审查、安全审查），每维度按 CRITICAL / HIGH / MEDIUM / LOW 分级。

---

## 二、修复了哪些 Bug

**本轮为纯审查轮次，未实施修复。** 以下为审查发现的待修复 Bug，按严重程度排列：

### CRITICAL（关键 — 必须修复）

#### 1. useGraphDOM.js — Document 级别事件监听器泄漏（疑似）
- **文件**: `src/composables/useGraphDOM.js` 第 301-302 行
- **问题**: 拖拽 resize 时在 `document` 上注册 `mousemove` 和 `mouseup` 监听器
- **代码**:
  ```javascript
  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
  ```
- **分析**: 清理函数 `_domCleanupByCy.set(c, ...)` 中**包含**了对 document 监听器的移除（第 308-309 行），逻辑上应该是正确的。但审查关注点在于：当有多个 Cytoscape 实例（多个 roomKey）时，所有实例共用同一个 document 事件处理函数引用（onMousemove / onMouseup），如果这些函数内部引用了特定实例的 Cytoscape 引用，则存在跨实例状态污染风险。
- **建议**: 验证清理函数在所有场景下（正常切换房间、关闭标签、错误退出）是否都被正确调用。建议增加单元测试覆盖实例切换场景。

#### 2. useGraph.js — ELK 布局回调中缺少 loadSeq 检查（陈旧闭包）
- **文件**: `src/composables/useGraph.js` 第 279-294 行
- **问题**: `error` 和 `stop` 回调闭包中没有检查 `_loadRoomSeq`，在快速切换房间时可能对已卸载的 Cytoscape 实例执行操作
- **代码**:
  ```javascript
  error: (e) => {
    logger.warn('useGraph', 'ELK布局失败，回退到中心化:', e)
    cy.value.nodes().positions(n => ({ x: 0, y: 0 }))  // ← 无 loadSeq 检查
    cy.value.center()
    _grid?.drawGrid()
  },
  stop: () => {
    if (targetViewport) {
      cy.value.zoom(targetViewport.zoom)  // ← 无 loadSeq 检查
      cy.value.pan(targetViewport.pan)
    } else {
      cy.value.zoom(keepZoom)
      cy.value.center()
    }
    _grid?.drawGrid()
  },
  ```
- **影响**: 快速切换房间时，可能在已 unmount 的 cy 实例上调用 `.nodes()`、`.zoom()` 等，导致静默错误或警告
- **建议修复**:
  ```javascript
  error: (e) => {
    if (loadSeq !== _loadRoomSeq) return  // ← 添加检查
    logger.warn('useGraph', 'ELK布局失败，回退到中心化:', e)
    cy.value.nodes().positions(n => ({ x: 0, y: 0 }))
    cy.value.center()
    _grid?.drawGrid()
  },
  stop: () => {
    if (loadSeq !== _loadRoomSeq) return  // ← 添加检查
    // ...
  },
  ```

### HIGH（高优先级 — 合并前应修复）

#### 3. GitPanel.vue — inline 引用错误（模板 ref 与 prop 混淆）
- **文件**: `src/components/GitPanel.vue` 第 428 行
- **问题**: watch 回调中使用了未定义的 `inline` 变量，应使用 `props.inline`
- **代码**:
  ```javascript
  watch(() => props.inline, (_inline) => {
    if (inline && !gitStore.isOpen) {  // ← BUG: inline 未定义，应为 props.inline
      gitStore.openForKB(gitStore.kbPath || roomStore.currentKBPath || '')
    }
  })
  ```
- **影响**: 在 inline 模式下切换 Tab 时，自动打开 GitStore 的逻辑永远不会触发，用户需要手动触发
- **修复**: `if (inline && !gitStore.isOpen)` → `if (props.inline && !gitStore.isOpen)`

#### 4. DetailPanel.vue — 图片加载竞态条件（未修复）
- **文件**: `src/components/DetailPanel.vue` 第 332 行
- **问题**: `loadNodeContent` 函数递增 `_version` 后用 `Promise.all` 并行加载子卡片和 Markdown，但在 catch 分支中使用 `++_version` 作为新版本号，与函数开头声明的 `version` 逻辑重复且不一致
- **代码**:
  ```javascript
  const version = ++_version
  const [kids, md] = await Promise.all([...])
  if (version !== _version) return  // 已切换到其他节点
  ```
- **影响**: 如果 `loadNodeContent` 被并发调用两次，第二次调用的 `version` 检查可能无法正确阻止第一次调用的结果写入
- **建议**: 在 `Promise.all` 内部也检查 `_version` 变化，或使用 `AbortController`

### MEDIUM（中优先级 — 建议修复）

#### 5. useGraph.js — activateViewport 中未调用 _grid?.drawGrid()
- **文件**: `src/composables/useGraph.js` 第 296-299 行
- **问题**: `else if (targetViewport)` 分支设置缩放后未调用 `_grid?.drawGrid()`，导致网格背景与节点不同步
- **对比**: 其余两个分支（第 268-278 行和第 300-303 行）都调用了 `_grid?.drawGrid()`

#### 6. DetailPanel.vue — 图片加载缺少错误状态 UI
- **文件**: `src/components/DetailPanel.vue`
- **问题**: 图片加载失败时没有视觉反馈（loading spinner 或 error icon），用户无法区分加载中、加载失败、图片不存在三种状态
- **建议**: 增加 `_imageLoading` / `_imageError` 状态，在模板中渲染对应的 UI

#### 7. GitPanel.vue — Git 远程 URL 未验证
- **文件**: `src/components/GitPanel.vue`
- **问题**: 用户输入 Git 远程仓库 URL 时未验证格式，可能导致无效 URL 被存储

#### 8. GitPanel.vue — 大文件警告阈值
- **问题**: 提交大文件时没有警告提示，可能导致仓库体积快速增长

#### 9. storage.js — 批量删除未校验路径越界
- **文件**: `src/core/storage.js`
- **问题**: `deleteMany` 等批量操作未对每个路径进行工作目录越界校验

#### 10. Grid.vue — 拖拽时 canvas 缩放不一致
- **文件**: `src/components/Grid.vue`
- **问题**: resize handle 拖拽时缩放逻辑可能与主容器不一致

---

## 三、实现了哪些功能

本轮为纯审查轮次，**无新增功能**。

---

## 四、优化了哪些架构/代码/交互

本轮为纯审查轮次，**无架构优化**。以下为待优化的改进方向（供后续迭代参考）：

### 待优化项（从审查中识别）

| # | 类别 | 文件 | 问题 | 改进方向 |
|---|------|------|------|----------|
| 1 | 可维护性 | useGraph.js | ELK 布局回调无 loadSeq 检查 | 添加陈旧闭包保护 |
| 2 | 可维护性 | GitPanel.vue | inline 引用错误 | 修正为 props.inline |
| 3 | 可维护性 | DetailPanel.vue | 并发竞态条件 | 增强版本检查逻辑 |
| 4 | 可维护性 | useGraph.js | activateViewport 缺少 drawGrid 调用 | 补全网格绘制 |
| 5 | 用户体验 | DetailPanel.vue | 图片加载无错误状态 | 增加 loading/error UI |
| 6 | 性能 | DetailPanel.vue | Promise.all 并发场景下无 Abort | 考虑 AbortController |
| 7 | 安全 | GitPanel.vue | 远程 URL 无验证 | 添加 URL 格式校验 |
| 8 | 安全 | storage.js | 批量操作缺路径校验 | 每条路径独立校验 |
| 9 | 性能 | DetailPanel.vue | 图片加载无大小限制 | 添加最大尺寸校验 |
| 10 | 可维护性 | useGraphDOM.js | document 监听器需要验证清理覆盖 | 增加集成测试 |

---

## 五、修改的文件列表

本轮为纯审查轮次，**无文件修改**。以下是审查涉及的文件清单：

### 核心图谱引擎
- `src/composables/useGraph.js` — ELK 布局、陈旧闭包问题
- `src/composables/useGraphDOM.js` — Document 监听器泄漏风险
- `src/core/cy-manager.js` — 实例生命周期管理

### 面板组件
- `src/components/DetailPanel.vue` — 图片加载竞态、错误状态
- `src/components/GitPanel.vue` — inline 引用错误、URL 验证缺失
- `src/components/StylePanel.vue` — 样式面板审查
- `src/components/Grid.vue` — 网格背景审查

### 存储与后端
- `src/composables/useStorage.js` — 安全（null 检查正确）
- `src/core/storage.js` — 批量操作路径校验
- `src/core/git-backend.js` — TTL 缓存机制审查

### 本轮前序修复（来自第7轮，已提交）
- `src/core/logger.js` — logger.warn → logger.catch
- `src/core/git-backend.js` — GitCache TTL 清理
- `src/components/DetailPanel.vue` — Blob URL 内存泄漏、sanitizeHtml XSS 防护

---

## 六、注意事项

### 1. 立即需要修复的 Bug
- **GitPanel.vue:428** — `inline` → `props.inline`，inline 模式下 Git 面板自动打开功能损坏
- **useGraph.js:279-294** — ELK 布局回调缺少 loadSeq 检查，快速切换房间时可能操作已卸载的实例

### 2. 需要关注的架构风险
- **多实例 document 监听器**: useGraphDOM.js 的 document 级别事件监听虽然在 cleanup 函数中有移除逻辑，但需要确保在所有退出路径（正常切换、错误退出、超时）下都被调用。建议增加集成测试覆盖多房间切换场景。
- **DetailPanel 并发竞态**: `loadNodeContent` 的版本检查在 Promise.all 场景下存在边界情况，建议用 AbortController 替代版本号方案。

### 3. 安全建议
- Git 远程 URL 校验（防止 SSRF 或恶意路径）
- 图片文件大小限制（防止大文件攻击）
- 批量存储操作的路径校验

### 4. 验证状态
| 检查项 | 状态 |
|--------|------|
| 开发服务器运行 | 正常（端口 5173） |
| 编译构建 | 正常（230 模块，~10s） |
| 内存泄漏（Blob URL） | 已修复（第7轮） |
| IPC 安全 | 已加固（第7轮） |
| logger.warn → logger.catch | 已修复（第7轮） |
| GitCache TTL 清理 | 已修复（第7轮） |

### 5. 下一步建议
1. 优先修复 GitPanel.vue:428 的 inline 引用错误（5 分钟修复，影响明确）
2. 修复 useGraph.js 的陈旧闭包问题（loadSeq 检查，10 分钟）
3. 补充 DetailPanel.vue 的图片加载错误状态 UI（30 分钟）
4. 考虑为 useGraphDOM.js 的多实例场景添加集成测试

---

*报告生成时间: 2026-04-17 | 维护轮次: 第8轮（纯审查）*
