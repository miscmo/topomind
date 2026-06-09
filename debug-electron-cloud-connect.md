# [OPEN] Debug Session: electron-cloud-connect

## Symptom

- Electron 桌面端提示：无法连接云端服务，请确认服务端已启动并可访问：`http://127.0.0.1:3000`
- 用户反馈后端实际已经启动

## Scope

- 仅做运行时证据采集与分析
- 在确认根因前不修改业务逻辑

## Hypotheses

1. Electron 运行时读取到的云端服务地址与后端真实监听地址不一致。
2. 后端进程已启动，但没有监听 `127.0.0.1:3000`，或仅监听了其他 host/port。
3. 桌面端与纯 Web 端读取了不同的环境变量来源，Electron 未继承正确配置。
4. 前端探测云端服务时访问的接口路径或健康检查策略不匹配，导致误判为服务不可达。

## Evidence Plan

- 确认本机 `3000` 端口监听状态和进程归属
- 对 `http://127.0.0.1:3000` 做最小 HTTP 探测
- 检查桌面端和 Web 端云端基地址配置来源
- 在必要时只添加埋点，记录 Electron 实际使用的服务地址与请求失败原因

## Status

- Root cause identified, minimal fix in progress

## Evidence

- `3000` 端口存在监听，且 `http://127.0.0.1:3000/health` 返回 `200 {"ok":true}`，说明后端服务可达。
- Electron 主进程日志显示桌面端实际加载的渲染地址为 `http://127.0.0.1:5173`。
- 后端当前开发配置 `apps/server/.env.dev` 仅允许 `CORS_ALLOWED_ORIGINS=http://localhost:5173`。
- 对 `Origin: http://127.0.0.1:5173` 的 `OPTIONS /auth/login` 预检返回 `204`，但没有 `Access-Control-Allow-Origin`。
- 对 `Origin: http://localhost:5173` 的同一预检返回 `204`，并携带 `Access-Control-Allow-Origin: http://localhost:5173`。

## Hypothesis Verification

| ID | Hypothesis | Status | Evidence Summary |
|----|------------|--------|------------------|
| A | Electron 运行时读取到的云端服务地址与后端真实监听地址不一致 | Rejected | Electron 与前端都指向 `http://127.0.0.1:3000`，后端健康检查可达 |
| B | 后端进程已启动，但没有监听 `127.0.0.1:3000`，或仅监听了其他 host/port | Rejected | `127.0.0.1:3000/health` 返回 `200` |
| C | 桌面端与纯 Web 端读取了不同的环境变量来源，Electron 未继承正确配置 | Partially confirmed | Electron 的 renderer origin 为 `http://127.0.0.1:5173`，与后端白名单中的 `http://localhost:5173` 不一致 |
| D | 前端探测云端服务时访问的接口路径或健康检查策略不匹配，导致误判为服务不可达 | Confirmed | 实际失败点是跨域预检未获得允许头，`fetch` 被浏览器内核拦截后被前端包装成“无法连接” |
