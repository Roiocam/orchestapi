# 决策记录

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| Service Account 生命周期 | 由 Starbucks/IdP 预先创建 Client；OrchestAPI 只消费凭据 | 避免给测试编排服务授予 Keycloak/IdP Admin API 高权限 |
| OAuth 流程 | 固定使用 OAuth 2.0 `client_credentials` | Service Account 是机器身份，不需要浏览器登录、`userinfo`、refresh token 或 UMA/RPT |
| 配置边界 | 首版使用 Deployment 级的一套 OAuth Client Credentials | 当前是单 Deployment 内部部署，避免数据库迁移、密钥加密和多环境凭据管理 |
| 凭据来源 | Client Secret 从外部 Kubernetes Secret 注入；非敏感参数放 Deployment 配置 | 与现有 Starbucks 内部部署的 Secret 外置约束一致，禁止在 Git 或前端保存明文 |
| Token 所有权 | Token 只在后端 Token Provider 内存缓存，不持久化、不返回前端 | 防止 Token 进入数据库、浏览器、执行结果或日志 |
| 自动注入范围 | 只注入 `ExecutionService` 发出的出站测试请求 | 不改变 OrchestAPI 入站 REST、Actuator、Mock 和 Webhook 的认证边界 |
| Step 控制 | 新增 `oauthMode`：`INHERIT`（默认）或 `DISABLED` | 允许环境内同时存在需要 OAuth 和不需要 OAuth 的测试步骤 |
| Header 优先级 | Step 显式 `Authorization` > Environment 手工 `Authorization` > 自动 OAuth | 保持现有手工 Token/依赖步骤兼容，并让显式配置可覆盖自动行为 |
| Token 刷新 | 按 `expires_in` 提前 60 秒刷新；同一时刻只允许一次刷新 | 避免并发执行造成 Token 请求风暴 |
| 失败重试 | Token Endpoint 失败时安全失败；MVP 不对业务请求 `401` 自动重放 | 避免 POST 等有副作用请求被重复执行 |
| Provider 范围 | 支持 `client_secret_basic`，可选 `client_secret_post`；scope/audience 可配置 | 兼容 Starbucks 常见 Keycloak/OAuth 配置，但不引入无边界的任意参数 |
| Out of scope | 不实现 IdP Client 自动创建、入站应用认证、浏览器 OAuth 登录、UMA/RPT | 这些是独立的权限和生命周期项目，不属于本次出站 Token 获取改造 |
