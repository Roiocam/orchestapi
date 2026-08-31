# OrchestAPI Environment-scoped OAuth Service Account Token 设计

**状态：** 待用户 review

**日期：** 2026-08-31

**替代关系：** 本文 supersede `2026-08-31-orchestapi-oauth-service-account-token-design.md` 中的 Deployment 级 OAuth 配置方案。已合并的全局实现只作为迁移起点，不作为最终配置边界。

## 1. 背景与当前证据

本次需求仍然是让 OrchestAPI 使用 Starbucks/IdP 预先创建的 Service Account Client，
通过 OAuth 2.0 `client_credentials` 获取短期 Bearer Access Token。这里的“自动创建
Token”指按需 mint access token，不指由 OrchestAPI 创建或管理 IdP Client。

当前仓库的权威配置边界是 `Environment`：

- `Environment` 持有目标 `baseUrl`、变量、默认 Header、Connector 和文件；
- `EnvironmentController`、`EnvironmentService` 和 `EnvironmentDetailPage` 已提供完整的
  create/update/read 配置链路；
- `ExecutionService` 的普通执行、单 Step 执行、定时执行和 SSE 执行最终都使用解析出的
  `Environment`；
- Environment 变量已有 Secret 标记、API 脱敏和更新时保留 masked value 的语义；
- 当前 OAuth 实现从 Deployment 的 `ORCHESTAPI_OAUTH_*` 进程变量读取一套全局 Client，
  与上述 Environment 权威边界不一致。

## 2. 目标

1. OAuth 配置归属于 Environment，每个 Environment 可以使用不同的 IdP Client。
2. Client Secret 复用 Environment 的 Secret 配置语义，由 Environment API/UI 脱敏保存。
3. 只有真正执行符合条件的出站测试请求时，才惰性获取 Token。
4. Token 按 Environment 隔离缓存、并发 single-flight，并在过期前刷新。
5. 普通执行、单 Step 执行、定时执行、SSE 和 side effect 统一使用同一套 Environment-scoped Provider。
6. 保持现有手工 Authorization、Token dependency step 和 Step `oauthMode` 兼容。
7. 不改变 OrchestAPI 入站认证、浏览器认证、Mock、Webhook、Actuator 或内部入口边界。

## 3. 非目标

- 不调用 Keycloak/IdP Admin API，不创建或管理 Client、Service Account 和权限策略。
- 不实现 OrchestAPI 自身的 OAuth 登录、JWT 校验、UMA/RPT 或浏览器 OAuth flow。
- 不把 Access Token 持久化到数据库、前端、执行结果、SSE 事件或日志。
- 不实现 password grant、authorization code、refresh token。
- MVP 不因目标请求 `401` 自动刷新并重放业务请求，尤其不重放可能有副作用的 POST。
- 不继续支持 Deployment 级 `ORCHESTAPI_OAUTH_*` 作为第二套隐式配置来源；最终只有 Environment 配置生效。
- 不在本次工作中引入多副本共享 Token cache、分布式锁或跨实例 Token 存储。

## 4. 方案选择

### 4.1 方案 A：Environment 下的 typed OAuth 配置（采用）

在现有 `Environment` 下增加独立的 `oauth` 配置类别，通过一对一持久化模型承载：

```text
Environment
  ├── variables
  ├── headers
  ├── connectors
  └── oauthConfig
```

API/UI 使用 `oauth.enabled`、`oauth.tokenEndpoint`、`oauth.clientId` 等结构化字段；
这些字段在语义上对应此前的 `ORCHESTAPI_OAUTH_*`，但不再是 Pod 的进程级环境变量。

优点：

- 配置和目标系统 Environment 同生命周期，执行时天然使用被选择的 Environment；
- 可在保存时做完整校验，避免字符串 key 拼写错误；
- OAuth Secret 有明确的 write-only/masked API 契约；
- 不会把 OAuth 配置混入普通变量解析、默认 Header 或前端 Token 流程；
- Token cache 可以用 `environmentId + oauth revision` 做隔离和失效判断。

代价是增加一张 Environment 子表、API DTO 和 Environment 页面配置区域，需要一次 schema
migration。

### 4.2 方案 B：复用 EnvironmentVariable 的保留 key

把 `ORCHESTAPI_OAUTH_ENABLED`、`ORCHESTAPI_OAUTH_CLIENT_ID` 等作为普通 Environment
变量保存，并把 Client Secret 标为 `secret=true`。

优点是数据库迁移少，能复用现有变量表；代价是配置依赖字符串约定，UI 难以表达字段级
校验和 Secret 生命周期，OAuth 配置可能被普通占位符/提取变量流程意外引用，也无法清楚
表达 revision 和禁用/清理语义。因此不采用。

### 4.3 方案 C：Environment 非敏感配置 + Kubernetes Secret 引用

Environment 保存 endpoint、Client ID 等，Secret 仍由 Pod 的外部 Secret 注入。

这会把同一个 Environment 的鉴权配置拆到数据库和 Deployment 两个所有权边界，单个
Environment 无法独立迁移或复制，也不符合“鉴权放在 Environment 里”的决定。因此不采用。

## 5. 配置与持久化契约

### 5.1 Environment OAuth 配置模型

增加 `EnvironmentOAuthConfig`（名称可按项目现有命名规范微调），与
`orchestapi_environments` 一对一关联。建议表：

```text
orchestrator.orchestapi_environment_oauth_configs
```

字段：

| 字段 | 说明 |
| --- | --- |
| `environment_id` | 主键，同时外键引用 `orchestapi_environments.id`，级联删除 |
| `enabled` | 是否为该 Environment 启用自动 OAuth，默认 false |
| `token_endpoint` | 绝对 `http(s)` Token Endpoint |
| `client_id` | Starbucks/IdP 预创建的 Service Account Client ID |
| `client_secret` | Secret 值，仅后端使用；API 不返回明文 |
| `scopes` | 可选，空格分隔 scope |
| `audience` | 可选目标 audience |
| `client_auth_method` | `client_secret_basic` 或 `client_secret_post`，默认 basic |
| `refresh_skew_seconds` | 提前刷新窗口，默认 60 |
| `request_timeout_ms` | Token 请求超时，默认 10000 |
| `revision` | 每次 OAuth 配置更新递增，用于 cache 失效 |
| `created_at` / `updated_at` | 审计时间 |

迁移创建表并为现有 Environment 回填一条 disabled 配置，确保旧 Environment 的行为
保持不变。OAuth 配置保存和 Environment 删除使用同一事务；删除 Environment 时级联
删除其 OAuth 配置。

### 5.2 API DTO 契约

`EnvironmentRequest` 增加：

```json
{
  "oauth": {
    "enabled": true,
    "tokenEndpoint": "https://idp.example.test/oauth/token",
    "clientId": "orders-service-account",
    "clientSecret": "write-only-secret",
    "scopes": "orders.read orders.write",
    "audience": "orders-api",
    "clientAuthMethod": "client_secret_basic",
    "refreshSkewSeconds": 60,
    "requestTimeoutMs": 10000,
    "clearClientSecret": false
  }
}
```

`EnvironmentResponse` 返回：

```json
{
  "oauth": {
    "enabled": true,
    "tokenEndpoint": "https://idp.example.test/oauth/token",
    "clientId": "orders-service-account",
    "clientSecret": "••••••••",
    "clientSecretConfigured": true,
    "scopes": "orders.read orders.write",
    "audience": "orders-api",
    "clientAuthMethod": "client_secret_basic",
    "refreshSkewSeconds": 60,
    "requestTimeoutMs": 10000
  }
}
```

规则：

- create/update 在 `enabled=true` 时校验 endpoint、Client ID、Client Secret、认证方式、
  timeout 和 refresh skew；生产 profile 要求 HTTPS。
- create 时必须提交 Secret；update 时 masked value 或省略 Secret 表示保留原值，避免
  UI 读取后保存时清空凭据。若需要删除 Secret，必须显式提交
  `clearClientSecret=true`，且不能同时提交新的 Secret。
- Secret 清理通过显式的 OAuth 配置清除动作完成，不能靠把 masked 文本当作真实 Secret。
- `clientSecretConfigured` 只表示是否有值，不泄漏值本身。
- `EnvironmentResponse`、分页列表、错误消息、审计日志、导出和前端状态都不得返回
  明文 Client Secret。

### 5.3 去除 Deployment 全局来源

实现完成后删除 `application.yml` 中的 `orchestapi.oauth` 进程变量绑定，以及
Kubernetes Deployment 中的 `ORCHESTAPI_OAUTH_*` 配置和 `orchestapi-oauth` Secret 引用。
Deployment 仍只从外部 `orchestapi-db` Secret 获取数据库凭据。现有已配置的全局 OAuth
值不自动迁移；发布前应按 Environment 逐个录入同一组配置并验证。

## 6. Token 触发时机（已确认）

采用惰性获取，不在 Environment 保存、读取、应用启动、执行准备或 curl 预览阶段获取
Token。

### 6.1 触发条件

在 `ExecutionService` 已解析当前 Environment 的变量和 Header、即将发送目标 HTTP 请求
时：

```text
OAuth disabled                  -> 不请求 Token
Step.oauthMode=DISABLED         -> 不请求 Token
Step/Environment 有 Authorization -> 不请求 Token
无手工 Authorization + INHERIT  -> OAuth Provider 获取/复用 Token
                                      -> 写入 Bearer Header
                                      -> 调用目标服务
```

Token 请求发生在真正的目标请求之前；如果 Token Endpoint 失败，当前 Step 返回安全的
OAuth 错误，目标服务不会被调用。

### 6.2 不触发 Token 的路径

- `prepareSuiteRun` / `prepareStepRun`；
- 仅打开、保存或查看 Environment；
- `generateCurl`（只显示 `Bearer <redacted>`）；
- Step 显式 `Authorization`；
- Environment 默认 Header 中已有 `Authorization`；
- Step 设置为 `DISABLED`；
- 无需发出目标请求的空 suite、跳过 Step 和失败依赖；
- Verification Connector 请求（它们不属于测试 Step 出站 HTTP 注入链路）。

### 6.3 缓存和刷新

Provider 的缓存项至少包含 `environmentId`、OAuth `revision`、Access Token、token type、
`expiresAt` 和 `refreshAt`。Token 值只存在 JVM 内存，不持久化。

- 同一 Environment 且 revision 未变时，当前时间早于 `refreshAt` 直接复用；
- `refreshAt = issuedAt + max(1, expiresIn - refreshSkewSeconds)`；
- 首次符合条件的 Step 触发第一次 Token 请求；
- 多个并发 run 使用同一 Environment 时，每个 Environment 只有一次并发刷新请求；
- revision 变化或 EnvironmentService 更新/删除时清除该 Environment 的缓存；
- 不同 Environment 即使 Client ID 相同，也不共享 Token；
- 当前单副本部署不引入跨 Pod cache，未来扩容需单独设计。

Provider 接收不可变的 `EnvironmentOAuthSnapshot`，而不是持有 JPA Entity，避免在 SSE、
定时执行的异步阶段访问已关闭的 Hibernate Session。`PreparedExecution` 在事务内加载
并复制 OAuth snapshot。

### 6.4 目标请求失败边界

MVP 不对目标服务的 `401` 自动触发刷新和请求重放。目标请求返回的 `401` 仍按普通目标
响应处理；只有缓存到达 `refreshAt` 或 Environment 配置 revision 变化时，下一次符合
条件的请求才会获取新 Token。

## 7. 运行时组件与请求流

### 7.1 组件职责

#### `EnvironmentOAuthConfig`

表示一个 Environment 的 OAuth 配置和校验规则，负责将 API DTO 转换为安全的不可变
snapshot。它不负责发 HTTP 请求。

#### `EnvironmentOAuthTokenProvider`

按 snapshot 获取或复用 Token，按 `environmentId` 隔离缓存和 single-flight 刷新；使用
snapshot 的 `requestTimeoutMs` 创建或复用对应超时的 Token HTTP Client。

#### `OAuthRequestAuthorizer`

接口改为显式接收 `EnvironmentOAuthSnapshot`（或 Environment），例如：

```java
void apply(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers);
void applyPreview(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers);
```

它只负责判断 Step/Header/Environment 条件和注入 Header，不处理入站请求。

#### `ExecutionService`

继续负责 Environment 解析、URL/query/body/Header 合并和目标请求执行；在 Header 组装
阶段把已解析的 Environment OAuth snapshot 交给 authorizer。普通、定时、SSE、side effect
和依赖 Step 均复用此路径。

### 7.2 请求流

```text
runSuite / runStep / schedule / SSE
              |
              v
      resolve selected Environment
              |
              v
      resolve env + Step headers
              |
              v
      OAuthRequestAuthorizer
        |-- disabled / manual Authorization / DISABLED -> skip
        |-- cache hit -> reuse environment token
        `-- cache miss/refresh -> client_credentials Token Endpoint
              |
              v
      add actual Authorization: Bearer <token>
              |
              v
      RestTemplate.exchange -> target API
```

Token Endpoint 请求不进入 `StepExecutionResult`、SSE 事件、变量提取或 curl 输出。

## 8. Header 优先级与兼容性

保持现有优先级：

```text
Step 显式 Authorization
    > Environment 手工 Authorization
    > Environment OAuth 自动 Token
```

Environment OAuth disabled 时，现有手工 Header、Token dependency step、提取变量和缓存
行为不变。Step `oauthMode` 继续保留 `INHERIT` / `DISABLED`，用于在同一个 Environment
中允许个别 Step 禁用自动 OAuth。

## 9. Secret、错误与日志

- Client Secret 只在 Environment 的后端 Secret 字段和本次 Token 请求内使用；Access Token
  只在 Provider 缓存和目标请求内使用。
- API/UI 始终返回 masked Secret 和 `clientSecretConfigured`，不返回明文。
- Provider 不记录 form、Basic Header、Client Secret、Access Token 或上游响应正文。
- 稳定错误码继续使用：`OAUTH_CONFIGURATION_INVALID`、`OAUTH_TOKEN_ENDPOINT_UNAVAILABLE`、
  `OAUTH_TOKEN_REQUEST_REJECTED`、`OAUTH_TOKEN_RESPONSE_INVALID`。
- Environment 保存时的配置错误返回字段级安全错误；执行期间 Token 失败返回 Step 安全
  错误，目标请求不发出。
- `requestHeaders`、执行结果和 curl 对 Authorization 使用 `<redacted>`；SSE 复用同一脱敏
  结果。
- Environment Secret 当前复用仓库已有的 masked-secret 语义；数据库加密、外部 KMS 或
  Secret rotation workflow 不在本次范围内，后续可单独演进。

## 10. 前端与 API 影响

- EnvironmentDetailPage 增加 OAuth 配置区域，包含启用开关、Endpoint、Client ID、Secret、
  scopes、audience、认证方式、refresh skew 和 timeout。
- Secret 输入采用与现有 Environment Secret variable 相同的 masked/reveal/update-preserve
  交互；列表页只显示启用状态和是否已配置 Secret，不显示 Secret。
- StepEditor 保留 `INHERIT` / `DISABLED` 控件，不再提供全局 OAuth 配置。
- 不新增前端 Token API；Axios、EventSource 和浏览器永远只访问 OrchestAPI。
- OAuth 配置不进入普通 Environment variable placeholder 解析，也不作为默认 Header 自动
  回显。

## 11. Kubernetes 与发布迁移

最终 Kubernetes 仍只渲染一个 `Deployment`，且不创建 `Secret`、ConfigMap、Service、
Ingress 或 NetworkPolicy。Deployment 只保留数据库外部 Secret 引用和运行时基础变量；
OAuth 配置全部来自数据库中的 Environment。

从当前全局实现迁移时：

1. 从平台 overlay/Deployment 删除 `ORCHESTAPI_OAUTH_*` 和 `orchestapi-oauth` Secret 引用；
2. 在目标 Environment 页面录入同一 Token Endpoint、Client ID、scope/audience 和认证方式；
3. 在 Environment Secret 字段写入 Client Secret，保存后确认只显示 masked value；
4. 先执行一个低风险 Step 验证 Token Endpoint 和目标服务权限，再启用更多 Step；
5. 保留 `oauthMode=DISABLED` 的 Step 作为不需要 OAuth 的例外；
6. 现场仍需验证 IdP、DNS/TLS/egress、数据库、入口 allowlist 和目标 API 权限。

## 12. 测试与验收策略

### 后端 focused tests

1. Environment OAuth API：create/update/get 的字段校验、masked Secret 保留、clear 行为和
   revision 递增。
2. Persistence：旧 Environment 回填 disabled config；OAuth config cascade delete；不同
   Environment 配置正确读取。
3. Provider：两个 Environment endpoint/client 隔离；`client_credentials` form、Basic/Post、
   scope/audience、按 Environment cache、并发 single-flight、refresh skew 和 revision 失效。
4. Trigger timing：prepare、curl、manual Authorization、DISABLED 不请求 Token；第一个
   eligible Step 才请求；后续 Step 复用；过期窗口刷新一次。
5. Execution paths：普通 run、scheduled prepared run、SSE prepared run、dependency 和
   side effect 使用同一个 Environment snapshot/provider。
6. Security：Secret/Token 不进入 response、SSE、curl、logs、variables、数据库 Token 表。
7. Failure：Environment 配置错误、timeout、4xx/5xx、invalid token response 安全失败且目标
   请求不发出；不做 401 replay。
8. Regression：OAuth disabled 时现有手工 Token dependency、入站 REST、Actuator、Mock、
   Webhook 和 SPA 路由不变。

### 前端与部署验证

- `npm run build` 验证 Environment OAuth UI、Step mode 和 DTO；
- `mvn test` 验证 API、Provider、ExecutionService 和回归测试；
- Kustomize 输出只含一个 Deployment，且不再包含 OAuth Secret ref、OAuth 明文或 Secret
  manifest；
- 本地 Mock Token Endpoint 证明惰性触发、缓存和 Environment 隔离；真实 Starbucks IdP、
  网络和权限仍需现场验证。

## 13. 验收映射

现有 A1–A10 清单需要按新配置边界重新执行：A1–A7 增加 Environment 选取和 Token 触发
时机证据；A8 验证四类执行路径传递同一个 Environment snapshot；A9 保持入站边界；A10
改为验证 Deployment 不再携带 OAuth 全局变量且仍只有一个 Deployment。真实 Starbucks
环境的 Client Secret、Token 权限、网络出口和入口 allowlist 仍是现场证据。

## 14. 后续演进边界

以下需求另立设计：数据库 Secret 加密/KMS、Secret rotation workflow、多个 OAuth Client
按租户继承、跨 Pod Token cache、目标请求 401 安全重试、IdP Admin API 自动建 Client、
UMA/RPT，以及 OrchestAPI 入站 Keycloak 授权。
