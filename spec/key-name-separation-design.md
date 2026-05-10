# Key-Name 分离设计方案

> 稳定标识符（key）与显示名称（name）分离，解决目录名限制与用户命名需求之间的矛盾。

## 1. 背景与目标

### 问题

当前 `_graph.json` 中 `children` 的 key 直接使用目录名，存在两个核心矛盾：

1. **目录名限制**：文件系统目录名不允许 `/ \ : * ? " < > |` 等字符，但用户希望节点名称自由使用这些字符。
2. **重命名代价高**：如果 key 就是目录名，重命名节点需要同时修改目录名、FSB 中的实际目录、所有引用该节点的边记录。

### 目标

- **key**：稳定标识符，基于 name 生成 slug，仅作定位用，**不可修改**（重命名不改变 key）。
- **name**：显示名称，允许任意 Unicode 字符，可随时修改。
- 完全兼容现有存储格式，不修改 `_graph.json` 结构，不修改目录结构。

---

## 2. Slug 生成算法

### 2.1 核心规则

```typescript
function toSlug(name: string): string {
  // 1. 归一化空白字符（空格、Tab、换行 → 连字符）
  let slug = name.trim().replace(/\s+/g, '-')

  // 2. 移除不允许出现在目录名中的字符（/ \ : * ? " < > |）
  slug = slug.replace(/[\\/:*?"<>|]/g, '')

  // 3. 转为小写（Unicode 大小写折叠，非 ASCII 字符保留原样）
  slug = slug.toLowerCase()

  // 4. 去除头尾的非字母数字字符
  slug = slug.replace(/^[^a-zA-Z0-9]+/, '')
  slug = slug.replace(/[^a-zA-Z0-9]+$/, '')

  // 5. 合并连续分隔符
  slug = slug.replace(/-+/g, '-')

  // 6. 限制最大长度 64 字符（保留前缀，截断尾部）
  if (slug.length > 64) {
    slug = slug.slice(0, 64)
  }

  return slug || 'node'
}
```

### 2.2 Unicode 处理

- **中文、日文、韩文**：直接保留，不做拼音转换（如 "节点测试" → slug 保留）。
- **emoji**：移除（如 "节点😀" → "节点"）。
- **变音符号**：保留基础字符（如 "café" → "caf-e"）。
- **阿拉伯文/希伯来文**：保留原样，文件系统在大多数情况下可以处理。

### 2.3 边界情况

| 输入 | slug 输出 | 说明 |
|------|-----------|------|
| `""` | `"node"` | 空名称回退 |
| `"   "` | `"node"` | 仅空白字符 |
| `"foo/bar"` | `"foo-bar"` | 移除 `/` |
| `"  foo  "` | `"foo"` | trim + 合并 |
| `"fоо"`（西里尔 о） | `"fоо"` | 不转为 ASCII |

---

## 3. 冲突处理

### 3.1 冲突检测时机

在同一个 KB 下，以 roomRef 为作用域进行 key 唯一性检测。在执行以下操作时触发检测：

- 新建节点
- 重命名节点（key 依赖 name，name 改变可能导致 key 变化）
- 从其他 KB 导入节点

### 3.2 冲突后缀格式

当检测到 key 冲突时，自动追加数字后缀：

```
原始 slug + "-" + 序号（从 1 开始）
```

示例：`node-1`, `node-2`, `test-node-3`。

### 3.3 冲突处理示例

用户在同一 KB 下连续创建名为 "节点" 的卡片：

| 操作 | 输入 name | 生成 slug | 实际 key |
|------|-----------|-----------|----------|
| 创建1 | `"节点"` | `"节点"` | `"节点"` |
| 创建2 | `"节点"` | `"节点"` | `"节点-1"` |
| 创建3 | `"节点"` | `"节点"` | `"节点-2"` |

### 3.4 迁移场景中的冲突检测

对于旧数据（无 key 字段，key 等于 name），迁移时需：

1. 扫描目标 KB 的现有所有 key
2. 按 slug 生成新 key，若冲突则追加后缀

---

## 4. 数据结构

### 4.1 `_graph.json` 格式（不变）

```json
{
  "children": {
    "节点": { "name": "节点", "hasChildren": false },
    "节点-1": { "name": "节点", "hasChildren": false }
  },
  "edges": [...],
  "zoom": 1,
  "pan": { "x": 0, "y": 0 }
}
```

**规则：**
- key = slug-based key，**不等于** `name`
- `name` 字段始终存在，表示显示名
- 当 `name` 与 slug 不一致（如重命名后 key 保持不变），`name` 存储新名称

### 4.2 GraphMeta 类型

```typescript
// src/core/storage/adapter/graph.ts

interface GraphChild {
  name: string           // 显示名称（用户可编辑）
  hasChildren?: boolean
  x?: number
  y?: number
}

interface GraphMeta {
  children: Record<string, GraphChild> // key = slug-based stable key
  edges: GraphEdge[]
  zoom?: number
  pan?: { x: number; y: number }
}
```

### 4.3 React Flow 节点

```typescript
// node.id = slug-based key（如 "节点" 或 "节点-1"）
// node.data.name = 显示名称（如 "节点" 或 "节点"）

const rfNode = {
  id: key,                    // slug-based stable key
  data: {
    key,                      // 稳定标识符
    name: displayName,         // 显示名称（可修改）
    cardRef,                  // KB 相对路径（由 key 重建）
    hasChildren,
    ...
  }
}
```

### 4.4 cardRef 重建规则

通过 `{kbPath}/{key}` 重建 cardRef。目录名恒等于 key，因此：

```
cardRef = joinRefs(kbPath, key)
```

无需 `resolveRoomChildRef` 额外处理。

---

## 5. 写路径

### 5.1 新建节点

```
用户输入 name
  → toSlug(name) 生成 slug
  → 检测 key 冲突（有冲突则追加 -N 后缀）
  → 调用 FSB.mkDir 创建目录（目录名 = key）
  → 写入 _graph.json（key = 稳定 key，name = 显示名）
```

### 5.2 重命名节点

```
用户修改 name（新 name）
  → toSlug(newName) 生成新 slug
  → 检测 key 冲突
  → 若 key 不变：只更新 _graph.json 中该 key 的 name 字段（目录不动）
  → 若 key 变化：
      1. 调用 FSB.renameDir 改目录名
      2. 更新所有以该节点为 source/target 的边的引用
      3. 更新 _graph.json 的 key
```

**注意**：当新 slug 与旧 key 相同时（用户修改 name 但 slug 不变），目录不需要改名。key 不变，GraphMeta 中的 name 字段更新即可。

### 5.3 `buildMetaFromNodesEdges` 修复（核心 bug 修复）

当前 `buildMetaFromNodesEdges` 中硬编码了 `roomRef: ''`，导致 key 生成错误。

修复后：

```typescript
// src/hooks/useGraph/graphBuilder.ts

export function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  roomRef: string  // 新增参数：从调用方传入当前房间路径
): GraphMeta {
  const roomNodes: RoomNode[] = nodes.map(n => ({
    cardRef: resolveRoomChildRef(roomRef, n.id),  // 不再硬编码 ''
    displayName: n.data?.name ?? basenameRef(n.id) ?? n.id,
    hasChildren: n.data?.hasChildren ?? false,
  }))

  // ...

  return roomGraphToGraphMeta({
    roomRef,  // ← 修复：传入实际 roomRef
    nodes: roomNodes,
    edges: roomEdges,
    viewport,
  })
}
```

调用方（`graphOperations.ts` 中的 `saveNow` / `scheduleSave`）传入 `getActiveNavState().roomPath`：

```typescript
// src/hooks/useGraph/graphOperations.ts

const dirPath = getActiveNavState().roomPath
// ...
buildMetaFromNodesEdges(nodesRef.current, edgesRef.current, dirPath)
```

---

## 6. 读路径

### 6.1 完整读路径

```
磁盘 _graph.json
  → FSB.readGraphMeta()
  → convertFSBToGraph() → GraphMeta（key = 目录名，name = 显示名）
  → roomGraphToGraphMeta()
  → buildNodes() → React Flow nodes

React Flow node.id = key（slug-based stable key）
node.data.name = 显示名
node.data.cardRef = joinRefs(kbPath, key)
```

### 6.2 目录名与 key 的映射

由于目录名恒等于 key，读路径无需额外转换：

```
目录名 → key（直接映射）
```

`convertFSBToGraph` 中原有的 `fromKBRelativeRef` 逻辑保持不变，仅在写入时确保 key 正确。

---

## 7. 核心操作行为变更

### 7.1 创建节点

| 步骤 | 行为 |
|------|------|
| 输入 | 用户输入显示名称 `"新节点"` |
| 生成 slug | `"新节点"` |
| 检测冲突 | 检查 KB 下是否已存在 key `"新节点"` |
| 冲突处理 | 有冲突则追加 `-1`、`-2` 等后缀 |
| 创建目录 | `FSB.mkDir(kbPath, finalKey)` |
| 写入 GraphMeta | `children[finalKey] = { name: "新节点", ... }` |
| 返回 | `{ key: finalKey, name: "新节点" }` |

### 7.2 重命名节点

| 场景 | 行为 |
|------|------|
| 新 name 生成相同 slug | key 不变，只更新 `children[key].name` |
| 新 name 生成不同 slug，无冲突 | 重命名目录 + 更新所有边引用 + 更新 GraphMeta |
| 新 name 生成不同 slug，有冲突 | 提示用户冲突，阻止操作（或自动加后缀） |

### 7.3 同名冲突（同一 KB 下）

当用户创建同名节点时：

1. slug 相同 → 检测到 key 已存在
2. 自动分配 `"name-1"` / `"name-2"` 等后缀
3. 两个节点 key 不同（稳定标识符），name 相同（显示名）

### 7.4 删除节点

1. 删除目录（FSB.rmDir）
2. 从 `children` 中移除 key 对应条目
3. 从 `edges` 中移除所有关联边

key 永久释放，后续可被新节点复用。

---

## 8. 现有数据迁移

### 8.1 迁移策略：惰性迁移

现有数据（key = name，即没有实现分离）通过以下方式迁移：

- **首次访问时迁移**：打开一个 KB 时，检测是否需要迁移
- **迁移操作幂等**：已迁移的数据不重复迁移

### 8.2 迁移检查条件

满足以下任一条件时需要迁移：

1. 存在 key 包含 `/`（旧 bug 导致的绝对路径混入）
2. 存在 key 包含文件系统禁止字符
3. 存在 key 长度超过 64 字符

满足以下条件时无需迁移：

- 所有 key 仅由合法目录名字符组成
- `name === key`（尚未被重命名为 slug 不同的名称）

### 8.3 迁移操作

```typescript
function migrateGraphMeta(meta: GraphMeta, kbPath: string): GraphMeta {
  const newChildren: Record<string, GraphChild> = {}
  const keyMapping = new Map<string, string>() // 旧 key → 新 key

  for (const [oldKey, child] of Object.entries(meta.children)) {
    let newKey = oldKey
    // 如果 key 包含非法字符或过长，生成新 slug
    if (containsIllegalChar(oldKey) || oldKey.length > 64) {
      newKey = toSlug(child.name || oldKey)
    }
    // 冲突检测
    newKey = resolveKeyConflict(newKey, Object.keys(newChildren))
    keyMapping.set(oldKey, newKey)
    newChildren[newKey] = { ...child }
  }

  // 更新边的 source/target 引用
  const newEdges = meta.edges.map(e => ({
    ...e,
    source: keyMapping.get(e.source) ?? e.source,
    target: keyMapping.get(e.target) ?? e.target,
  }))

  return { ...meta, children: newChildren, edges: newEdges }
}
```

### 8.4 迁移原子性

迁移操作作为整体写入 `_graph.json`，失败时回滚。不单独修改目录结构。

---

## 9. Key 不可变性保证

### 9.1 什么情况下 key 不变

- 用户编辑显示名称（name），但 slug 不变 → key 不变，目录不动
- 用户重命名导致 slug 变化 → key 变化（目录改名）

### 9.2 Key 变化后需要同步更新的内容

| 数据 | 更新方式 |
|------|----------|
| 目录名 | `FSB.renameDir(oldKey, newKey)` |
| 边的 source/target | 遍历 edges，将旧 key 替换为新 key |
| 子房间 GraphMeta | 读取子房间 `_graph.json`，更新 `children` 中的 key |
| 父房间 `_graph.json` | 更新子房间节点的 `path` 字段（指向新目录） |

### 9.3 重命名失败的回滚

如果重命名操作中途失败（如边更新失败），需要回滚：

```typescript
async function renameNodeSafe(key, newName): Promise<void> {
  const newKey = toSlug(newName)
  if (newKey === key) return

  // 1. 备份当前 GraphMeta
  const backup = await readGraphMeta(kbPath)

  try {
    // 2. 重命名目录
    await FSB.renameDir(kbPath, key, newKey)
    // 3. 更新边引用
    await updateEdgesInGraphMeta(kbPath, key, newKey)
    // 4. 写入新 GraphMeta
    await writeGraphMeta(kbPath, newMeta)
  } catch (e) {
    // 5. 回滚：还原目录名
    await FSB.renameDir(kbPath, newKey, key)
    throw e
  }
}
```

---

## 10. 类型定义变更

### 10.1 新增类型

```typescript
// src/domain/card/types.ts 或新建 key-name.ts

export interface KeyNamePair {
  key: string      // slug-based stable identifier
  name: string     // display name (any characters)
}

/**
 * 生成稳定 key
 * @param name display name
 * @param existingKeys 当前 KB 下已存在的 key 集合（用于冲突检测）
 */
export function generateKey(name: string, existingKeys?: Set<string>): string

/**
 * 检测 key 冲突并生成无冲突 key
 */
export function resolveKeyConflict(slug: string, existingKeys: string[]): string

/**
 * 更新 GraphMeta 中的 key（重命名场景）
 */
export function renameKey(
  meta: GraphMeta,
  oldKey: string,
  newKey: string
): GraphMeta

/**
 * 更新边的 source/target 引用
 */
export function updateEdgeRefs(
  edges: GraphEdge[],
  oldKey: string,
  newKey: string
): GraphEdge[]
```

### 10.2 修改类型

```typescript
// src/core/storage/adapter/graph.ts

interface GraphChild {
  name: string      // 显示名称（已有）
  hasChildren?: boolean
  x?: number
  y?: number
  // 注：key 不存储在 GraphMeta 内，通过 Record 的 key 获取
}

// KnowledgeNode.data 保持不变（已有 name 字段）
interface KnowledgeNode {
  id: string        // key = slug-based stable key
  data: {
    key: string
    name: string
    cardRef: string
    hasChildren: boolean
    // ...
  }
  // ...
}
```

---

## 11. 影响范围

| 模块 | 文件 | 变更内容 | 风险 |
|------|------|----------|------|
| **storage/adapter** | `adapter/graph.ts` | 类型定义更新 | 低 |
| **storage/engines** | `engines/file.ts` | `convertGraphToFSB` key 生成逻辑（修复 bug） | 中 |
| **storage/service** | `service.ts` | `writeLayout`/`readLayout` 可能需要传递 roomRef | 中 |
| **graphBuilder** | `useGraph/graphBuilder.ts` | `buildMetaFromNodesEdges` 传入 roomRef（修复 bug） | 高 |
| **graphOperations** | `useGraph/graphOperations.ts` | 所有调用 `buildMetaFromNodesEdges` 的地方传 roomRef | 高 |
| **roomLoader** | `useGraph/roomLoader.ts` | 读路径可能需要处理 key != name 的情况 | 中 |
| **cardService** | `cardService.ts` | `createChildCard` / `renameCard` 集成 slug 生成和冲突检测 | 高 |
| **path-utils** | `path-utils.ts` | 可能需要新增 slug 工具函数 | 低 |
| **UI/GraphCanvas** | `GraphCanvas.tsx` | 节点 label 显示 name（而非 key） | 低 |
| **迁移脚本** | 新建 `migrateGraphMeta.ts` | 惰性迁移现有数据 | 中 |

---

## 12. 总结

| 项目 | 说明 |
|------|------|
| 核心思想 | key = slug-based stable key，name = display name，完全分离 |
| slug 规则 | 移除 `/ \ : * ? " < > |`，转小写，合并分隔符，限制 64 字符 |
| 目录名 | 恒等于 key，目录名限制由 slug 算法兜底 |
| 冲突处理 | 追加 `-N` 后缀，保证 key 在同一 KB 下唯一 |
| 现有数据 | 惰性迁移，迁移操作幂等 |
| 关键 bug 修复 | `buildMetaFromNodesEdges` 传入实际 roomRef，修复 key 生成错误 |
| 影响范围 | 核心在 storage 层 + graphOperations 层，影响面较大但集中 |
| 兼容性 | 完全兼容现有 `_graph.json` 格式，目录结构不变 |