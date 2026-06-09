# 前端同步策略小结（阶段 E04）

## 1. 结论

TopoMind 纯 Web 第一阶段采用“在线优先 + 短期本地脏队列”策略，不引入完整离线优先架构，也不在本阶段引入 IndexedDB 作为新的主线依赖。

约束如下：

1. 服务端是权威数据源。
2. 前端允许本地即时交互，但只对高频场景保留短期 dirty queue。
3. 当前 `LocalDB` 只作为过渡期本地镜像/队列适配层，不再被视为主数据源。
4. 新前端主线不得扩展 Electron `localdb:*` 依赖面，只能逐步缩减。
5. IndexedDB 暂不进入当前阶段；若后续确有浏览器持久离线需求，再单独立项设计。

## 2. 当前实现现状

基于当前代码审阅：

- `apps/web/src/application/cloud/useCloudBootstrapSync.ts` 负责登录后拉取 bootstrap，并写入本地镜像。
- `apps/web/src/application/cloud/useCloudSyncEngine.ts` 已成为主同步入口，按“push outbox -> pull events”执行。
- `apps/web/src/application/cloud/useCloudPullSync.ts` 与 `useCloudPushSync.ts` 仍保留旧拆分实现，功能上与 `useCloudSyncEngine.ts` 存在重叠。
- `apps/web/src/core/localdb-backend.ts` 在浏览器 preview 中提供 fallback，本质上仍承担本地镜像、outbox、冲突记录等职责。

这意味着当前代码已经偏向“在线优先 + 本地缓存/队列”，但 `LocalDB` 角色仍偏重，需要在后续 G/H/I 阶段继续收敛。

## 3. 本阶段决策

### 3.1 保留什么

- 保留 bootstrap 本地镜像，用于首屏加载后驱动现有 UI。
- 保留 sync pull 增量回放到本地镜像。
- 保留文档与图谱布局等高频写场景的 dirty queue / outbox。
- 保留冲突记录能力，继续消费服务端 `409` 返回。

### 3.2 不做什么

- 不实现完整离线优先。
- 不把所有实体写操作都先落本地、再长期等待后台回放。
- 不新增基于 IndexedDB 的新一套同步引擎。
- 不继续加深对 Electron LocalDB IPC 的依赖。

### 3.3 LocalDB 的阶段性定位

`LocalDB` 在当前阶段仅保留为“兼容层”：

- 承载 bootstrap/pull 后的本地镜像；
- 承载文档内容、布局 patch 等高频修改的短期脏数据；
- 承载 sync push 冲突记录与有限重试状态；
- 不再作为知识库、卡片、文档元数据的长期权威来源。

## 4. 对后续任务的约束

### G01 / G02

- 建立统一 HTTP client。
- `cloud-api.ts` 统一复用该 client。
- 登录、注册、refresh、bootstrap、sync pull/push 继续走 HTTP 主链路。

### G03 / G04 / G05

- `remote-storage-backend` 直接面向 Go API，而不是面向本地目录。
- 工作区状态以 `currentWorkspaceId` 为核心，不再依赖 `currentWorkspaceRoot`。
- Setup 流程只保留登录、注册、工作区选择，不再暴露本地目录入口。

### H01 / H02

- 图谱布局与文档内容继续采用“本地即时更新 + 防抖/批量提交”。
- 高速交互期间不逐次请求后端。
- flush 失败时保留 dirty 状态和冲突提示。

### I03

- 逐步把 `LocalDB` 从 Electron IPC 依赖迁移为 Web 可替代实现。
- 若浏览器端后续确需持久缓存，再评估是否引入 IndexedDB，并单独定义数据边界。

## 5. 执行建议

1. 从 G01 开始先统一 HTTP client，减少散落 fetch。
2. 随后在 G03 建立 `remote-storage-backend`，让知识库/卡片/文档/布局读写逐步脱离文件后端。
3. `useCloudSyncEngine.ts` 保留为阶段性同步主入口，`useCloudPullSync.ts` / `useCloudPushSync.ts` 后续可在主链稳定后收敛或删除。
4. 等 G/H 任务完成后，再进入 I 阶段清理 Electron LocalDB 主线依赖。
