# [OPEN] Debug Session: auth-register-500

## Summary

- Session ID: `auth-register-500`
- Symptom: 前端调用 `POST /auth/register` 返回 `500 Internal Server Error`
- Expected: 注册成功，或至少返回明确的 4xx 业务错误

## Hypotheses

1. 注册处理器在写入用户前触发数据库约束或 SQL 执行错误，但被统一包装成了 500。
2. 请求体解析成功，但密码哈希或 token 生成过程抛错，导致注册流程中途失败。
3. 数据库连接正常但初始化数据表缺失，`INSERT users` 或相关查询直接报表不存在。
4. 注册成功后的响应构造阶段失败，例如用户对象或 token 序列化时出现异常。
5. 当前环境变量或密钥配置不完整，导致注册流程内部依赖初始化异常。

## Plan

1. 在 `POST /auth/register` 服务端链路增加最小化调试日志上报点。
2. 复现一次注册请求，收集运行时日志与服务端响应。
3. 用日志证据排除或确认上述假设。
4. 仅在证据确认根因后做最小修复。
5. 复验注册并对比修复前后结果。
