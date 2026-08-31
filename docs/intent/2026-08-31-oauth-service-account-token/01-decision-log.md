# 决策记录

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| Service Account 生命周期 | 由 Starbucks/IdP 预先创建 Client；OrchestAPI 只消费凭据 | 避免给测试编排服务授予 Keycloak/IdP Admin API 高权限 |
| OAuth 流程 | 固定使用 OAuth 2.0 `client_credentials` | Service Account 是机器身份，不需要浏览器登录、`userinfo`、refresh token 或 UMA/RPT |
| 配置边界 | OAuth 配置归属于被选择的 Environment，每个 Environment 可使用不同 Client | Environment 已是目标系统 baseUrl、变量、Header 和 Connector 的权威配置边界 |
| 凭据来源 | Client Secret 放在 Environment OAuth Secret 配置中，由现有 Environment API/UI 脱敏保存 | 鉴权配置与 Environment 同生命周期；禁止通过 Deployment 全局变量或前端响应传递明文 |
| Token 所有权 | Token 只在后端按 Environment 隔离的 Provider 内存缓存，不持久化、不返回前端 | 防止 Token 进入数据库、浏览器、执行结果或日志 |
| 自动注入范围 | 只注入 `ExecutionService` 发出的出站测试请求 | 不改变 OrchestAPI 入站 REST、Actuator、Mock 和 Webhook 的认证边界 |
| Step 控制 | 新增 `oauthMode`：`INHERIT`（默认）或 `DISABLED` | 允许环境内同时存在需要 OAuth 和不需要 OAuth 的测试步骤 |
| Header 优先级 | Step 显式 `Authorization` > Environment 手工 `Authorization` > 自动 OAuth | 保持现有手工 Token/依赖步骤兼容，并让显式配置可覆盖自动行为 |
| Token 触发与刷新 | 仅在第一个符合条件的真实出站请求前惰性获取；按 `expires_in` 提前 60 秒刷新；同一 Environment 同时只允许一次刷新 | 避免无请求时获取 Token，并避免并发执行造成 Token 请求风暴 |
| 失败重试 | Token Endpoint 失败时安全失败；MVP 不对业务请求 `401` 自动重放 | 避免 POST 等有副作用请求被重复执行 |
| Provider 范围 | 支持 `client_secret_basic`，可选 `client_secret_post`；scope/audience 可配置；按 Environment 隔离 cache | 兼容 Starbucks 常见 Keycloak/OAuth 配置，并确保不同目标系统不共用 Token |
| Out of scope | 不实现 IdP Client 自动创建、入站应用认证、浏览器 OAuth 登录、UMA/RPT、跨 Pod cache | 这些是独立的权限和生命周期项目，不属于本次出站 Token 获取改造 |

### 设计修订（2026-08-31）

此前的 Deployment 级 OAuth 方案已根据用户确认改为 Environment-scoped OAuth：OAuth
配置和 Client Secret 由 Environment 管理，Token 仅在真实 eligible Step 出站请求前惰性获取。
详见 `docs/superpowers/specs/2026-08-31-orchestapi-oauth-environment-scoped-design.md`。
