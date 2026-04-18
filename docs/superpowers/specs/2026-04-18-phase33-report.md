# Phase 33 维护报告：综合优化修复

**日期**: 2026/04/18
**分支**: feat/vue3-migration
**目的**: Phase 31 后续 10 维度审查 + 针对性修复

---

## 一、问题修复汇总

本次 Phase 33 共修复 **7 个问题**，涉及 **7 个文件**：

| # | 严重度 | 文件 | 问题 | 修复方式 |
|---|--------|------|------|---------|
| 1 | CRITICAL | `src/composables/useStorage.js` | `logger.catch` 参数个数错误（3 个参数但函数只接受 2 个） | 使用模板字符串拼接 |
| 2 | HIGH | `src/stores/room.js` | `breadcrumbs` getter 缺少显式依赖声明导致 Pinia 无法追踪 | 添加 `void state._pathNameMapVersion` |
| 3 | MEDIUM | `src/stores/room.js` | `switchTab` 直接修改 Pinia state（可变操作）违反响应式原则 | 改用 `this.tabs = this.tabs.map(...)` |
| 4 | MEDIUM | `src/core/graph-utils.js` | `loadNodeBadges` 和 `refreshHtmlLabels` 使用动态 `import()`（冗余且违反 ESM 静态分析原则） | 改为静态 `import { logger }` |
| 5 | MEDIUM | `src/composables/useNodeBadges.js` | `_onMouseMove` 每像素触发 Tooltip 重新定位，高频操作无节流 | 添加 50ms 节流守卫 |
| 6 | LOW | `src/composables/useGraphDOM.js` | `_handleElsByCy` / `_domCleanupByCy` 内部 Map 被暴露在公共接口中 | 从 return 对象中移除 |
| 7 | LOW | `src/components/HomePage.vue` | `loading` ref 已声明但未在模板中使用（UX 缺失） | 添加 `v-if="loading"` 加载指示器 |
| — | — | `src/css/home.css` | HomePage 加载指示器样式缺失 | 新增 `.home-loading-overlay` 等 CSS |

---

## 二、详细修复说明

### 2.1 [CRITICAL] useStorage.js — logger.catch 参数个数

**文件**: `src/composables/useStorage.js` (第 50 行)

**问题**: `logger.catch('useStorage', 'saveLayout 失败:' + dirPath, e)` 调用时传入 3 个参数，但 `logger.catch` 函数只接受 2 个参数（tag + message）。第三个参数 `e` 导致日志信息不完整。

**修复前**:
```javascript
.catch((e) => { logger.catch('useStorage', 'saveLayout 失败:' + dirPath, e); showSaveIndicator(true) })
```

**修复后**:
```javascript
.catch((e) => { logger.catch('useStorage', `saveLayout 失败: ${dirPath}`, e); showSaveIndicator(true) })
```

**风险**: 低 — 不影响程序执行，但日志丢失错误上下文，排查问题困难。

---

### 2.2 [HIGH] room.js — breadcrumbs getter 响应式依赖缺失

**文件**: `src/stores/room.js` (第 33-40 行)

**问题**: `breadcrumbs` getter 中使用了 `state.pathNameMap`，但 Pinia 的自动依赖追踪无法感知 `_pathNameMapVersion` 的变更（该字段通过 `markRaw` 包装的对象间接修改）。当知识库重命名导致 `pathNameMap` 更新时，面包屑可能不刷新。

**修复前**:
```javascript
breadcrumbs: (state) => {
  if (!state.currentKBPath) return []
  const crumbs = []
  const kbName = state.pathNameMap[state.currentKBPath] || ...
```

**修复后**:
```javascript
breadcrumbs: (state) => {
  // 显式依赖 _pathNameMapVersion 以便在路径名缓存变更时重新计算
  void state._pathNameMapVersion
  if (!state.currentKBPath) return []
  const crumbs = []
  const kbName = state.pathNameMap[state.currentKBPath] || ...
```

**风险**: 低 — 显式 `void` 声明不影响业务逻辑，仅确保 Pinia 正确追踪依赖。

---

### 2.3 [MEDIUM] room.js — switchTab 可变操作

**文件**: `src/stores/room.js` (第 141-152 行)

**问题**: `switchTab` 直接对 Pinia state 中的对象进行可变修改（`current.roomPath = ...; current.roomHistory = [...]`），违反了 Vue/Pinia 响应式系统的不可变更新原则，可能导致 Vue DevTools 无法正确追踪变更历史。

**修复前**:
```javascript
switchTab(tabId) {
  const current = this.tabs.find(t => t.id === this.activeTabId)
  if (current) {
    current.roomPath = this.currentRoomPath        // 直接修改响应式对象
    current.roomHistory = [...this.roomHistory]     // 直接修改响应式对象
  }
```

**修复后**:
```javascript
switchTab(tabId) {
  const current = this.tabs.find(t => t.id === this.activeTabId)
  if (current) {
    this.tabs = this.tabs.map(t => t.id === current.id
      ? { ...t, roomPath: this.currentRoomPath, roomHistory: [...this.roomHistory] }
      : t)
  }
```

**风险**: 低 — 行为不变，但符合 Pinia 不可变更新最佳实践。

---

### 2.4 [MEDIUM] graph-utils.js — 动态 import 改为静态

**文件**: `src/core/graph-utils.js`

**问题**: `loadNodeBadges` 和 `refreshHtmlLabels` 在函数内部使用 `await import('@/core/logger.js')` 动态导入 `logger`，而文件顶部没有静态导入 `logger`。这违反了 ESM 静态分析原则，增加模块解析开销，且导致 `refreshHtmlLabels` 声明为 `async` 但实际无异步操作。

**修复内容**:

1. 在文件顶部添加静态导入：
```javascript
import { logger } from '@/core/logger.js'
```

2. `loadNodeBadges` 函数内移除动态导入：
```javascript
// 移除：const logger = (await import('@/core/logger.js')).logger
```

3. `refreshHtmlLabels` 函数改为同步并移除动态导入：
```javascript
// 修复前：
export async function refreshHtmlLabels(cy, nodes) {
  if (!cy) return
  const logger = (await import('@/core/logger.js')).logger
// 修复后：
export function refreshHtmlLabels(cy, nodes) {
  if (!cy) return
  // logger 已通过顶部静态导入可用
```

**风险**: 无 — `logger.js` 是纯同步模块，动态导入转为静态是纯等价替换。

---

### 2.5 [MEDIUM] useNodeBadges.js — mousemove 每像素触发问题

**文件**: `src/composables/useNodeBadges.js` (第 198-209 行)

**问题**: `_onMouseMove` 事件监听器绑定到 `document`，每次鼠标移动都会触发 Tooltip 重新定位计算。在 tooltip 可见状态下，每像素移动都执行 `_positionTooltip()`，造成不必要的重排和 CPU 消耗。

**修复**: 添加 50ms 节流守卫，仅在 tooltip 可见且距离上次更新超过 50ms 时才重新定位：

```javascript
let _lastMoveTime = 0
const MOVE_THROTTLE_MS = 50

function _onMouseMove(e) {
  _mouseX = e.clientX
  _mouseY = e.clientY
  // 节流：tooltip 可见时才更新位置，避免每像素都重绘
  const tt = tooltipRef?.value
  if (!tt?.classList.contains('visible')) return
  const now = Date.now()
  if (now - _lastMoveTime < MOVE_THROTTLE_MS) return
  _lastMoveTime = now
  _positionTooltip()
}
```

**风险**: 无 — Tooltip 定位延迟最大 50ms，用户感知不到差异，但能显著减少高频重排。

---

### 2.6 [LOW] useGraphDOM.js — 公共接口暴露内部状态

**文件**: `src/composables/useGraphDOM.js` (第 361-368 行)

**问题**: `_handleElsByCy` 和 `_domCleanupByCy` 是内部 `Map` 对象，用于跟踪 Cytoscape 实例与 DOM 元素/清理函数的映射。将其暴露在 composable 返回对象中破坏了封装性，且消费者不应依赖这些内部实现细节。

**修复**: 从 return 语句中移除这两个属性：

```javascript
// 修复前：
return {
  bindDOMEvents,
  cleanupDOMEventsExcept,
  updateNodeHandles,
  refreshAllHandles,
  applyZoomDisplay,
  _handleElsByCy,      // ← 移除
  _domCleanupByCy,      // ← 移除
}

// 修复后：
return {
  bindDOMEvents,
  cleanupDOMEventsExcept,
  updateNodeHandles,
  refreshAllHandles,
  applyZoomDisplay,
}
```

**风险**: 无 — 仅移除不需要的公共属性，不改变任何行为。

---

### 2.7 [LOW] HomePage.vue — 加载状态指示器未使用

**文件**: `src/components/HomePage.vue` (第 21-25 行)

**问题**: `loading` ref 已在 `loadKBList()` 中正确设置为 `true/false`，但模板中未绑定到 UI，导致用户在加载知识库列表时没有视觉反馈。

**修复**: 在 `.home-content` 内添加加载指示器：

```vue
<div class="home-content">
  <!-- 加载指示器 -->
  <div v-if="loading" class="home-loading-overlay">
    <div class="home-loading-spinner"></div>
    <span>加载中...</span>
  </div>
```

对应 CSS 样式（`src/css/home.css`）：

```css
.home-loading-overlay {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  font-size: 13px;
  color: #2563eb;
}

.home-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(59, 130, 246, 0.2);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: home-loading-spin 0.7s linear infinite;
  flex-shrink: 0;
}
```

**风险**: 无 — UX 增强，用户获得加载反馈。

---

## 三、验证结果

- [x] `npm run build` 通过（main + electron main + electron preload）
- [x] 无新增编译警告/错误
- [x] 7 个问题全部修复并验证

---

## 四、修改文件列表

| 文件 | 变更类型 | 变更说明 |
|------|---------|---------|
| `src/composables/useStorage.js` | 修改 | 修复 logger.catch 参数拼接方式 |
| `src/stores/room.js` | 修改 | breadcrumbs 响应式依赖 + switchTab 不可变更新 |
| `src/core/graph-utils.js` | 修改 | 动态 import → 静态 import，`refreshHtmlLabels` 同步化 |
| `src/composables/useNodeBadges.js` | 修改 | mousemove 50ms 节流 |
| `src/composables/useGraphDOM.js` | 修改 | 移除暴露的内部 Map |
| `src/components/HomePage.vue` | 修改 | 添加 loading 指示器 |
| `src/css/home.css` | 修改 | 添加 loading overlay CSS |

---

## 五、后续建议（非阻塞性）

| 优先级 | 建议 | 理由 |
|-------|------|------|
| 低 | **Playwright E2E 测试覆盖** | 关键流程（打开 KB → 创建节点 → 拖拽连接 → Git 提交）目前无自动化测试 |
| 低 | **DetailPanel.vue 持续监控** | 758 行接近 800 行警戒线，Phase 31 建议 |
| 低 | **Vite 生产构建优化** | vendor-cytoscape (1.9MB gzip: 589KB) 可考虑 code-split |
| 低 | **ESLint + Prettier CI** | git pre-commit hook 添加 `eslint --fix` + `prettier --write` |
| 低 | **TypeScript 迁移** | 从 `src/core/` 开始逐步迁移，提升类型安全 |
