# OrchestAPI OAuth Service Account Token 设计

**状态：** 已获用户确认的设计，等待书面 Spec review

**日期：** 2026-08-31

## 1. 背景与当前证据

本次需求是让 OrchestAPI 在执行测试请求时，自动使用 Starbucks/IdP 已预置的 Service Account Client 获取 OAuth Access Token。这里的“自动创建 Token”指按需 mint ephemeral access token，不指由 OrchestAPI 创建或管理 IdP Client。

当前代码的边界如下：

- `Environment` 只保存目标 `baseUrl`、变量、默认 Header 和 Connector，没有 OAuth 配置。
- `ExecutionService` 在 `buildHeaders(...)` 中合并环境 Header 和 Step Header，再通过 `RestTemplate.exchange(...)` 发出请求。
- 现有 Token 做法是用户建立一个 dependency-only、cacheable 的手工 Token 步骤，再通过提取变量注入 `Authorization`；这条路径必须保持兼容。
- 前端直接使用 Axios 和原生 `EventSource`；目标 API Token 不应进入浏览器。
- 当前内部部署决策是单镜像、单 Deployment、外部 Secret 引用，且不增加 OrchestAPI 入站认证。

## 2. 目标

1. 使用 OAuth 2.0 `client_credentials` 自动获取 Service Account Bearer Token。
2. 后端持有 Client Secret，Token 只在后端内存中缓存和使用。
3. 对普通执行、定时执行和 SSE 执行统一生效。
4. 保持现有手工 Authorization 和 Token 依赖步骤兼容。
5. 支持 Step 级别关闭自动 OAuth，避免所有请求被强制加上 Token。
6. 维持当前入站路由、Mock、Webhook、Actuator 和部署资源边界。

## 3. 非目标

- 不调用 Keycloak/IdP Admin API，不自动创建 Client、Service Account 或权限策略。
- 不实现 OrchestAPI 自身的 OAuth 登录、JWT 校验或 Keycloak Authorization Services。
- 不在浏览器中保存、刷新或传递目标 API Token。
- 不实现 password grant、authorization code、refresh token、UMA/RPT。
- MVP 不因目标请求 `401` 自动重放业务请求；尤其不重放可能有副作用的 POST。
- 不实现每个数据库 Environment 独立 OAuth 凭据。若后续需要多 Client、多租户或 UI 管理凭据，另立 Environment-scoped OAuth 项目。

## 4. 方案选择

### 4.1 Deployment 级 OAuth 配置（采用）

Deployment 注入一套 OAuth Client Credentials。后端提供单一 Token Provider，在所有启用 OAuth 的出站测试请求前获取或复用 Token。

优点：

- Client Secret 可完全由外部 Kubernetes Secret 管理，不进入数据库；
- 不需要给现有 Environment 表增加敏感字段或加密方案；
- 适合当前 Starbucks 单 Deployment、单内部服务实例；
- Token 生命周期、刷新、脱敏集中在一个后端边界内。

代价：

- 一个 Deployment 只能使用一套 OAuth Client；
- 不同目标系统需要不同 Client 时，需要拆分 Deployment 或后续引入 Environment-scoped 配置。

### 4.2 Environment 级数据库配置

每个 Environment 保存 token endpoint、client ID、scope 和 Secret 引用/密文。

优点是支持多个目标 IdP；代价是需要数据库迁移、Secret 加密或密钥引用协议、UI 配置和更复杂的凭据轮换，超出本次单 Deployment 最小改造范围。

### 4.3 继续使用手工 Token 步骤

只增加 Token 步骤模板或文档，不改变执行器。

该方案无法真正自动管理 OAuth Token，且 Token 会进入执行结果、提取变量和 curl 展示链路，不能满足本需求的安全和生命周期要求。

## 5. 总体架构

### 5.1 组件职责

#### `OAuthProperties`

使用 Spring Boot `@ConfigurationProperties(prefix = "orchestapi.oauth")` 读取 Deployment 配置。`enabled=false` 时使用 no-op provider；`enabled=true` 时校验 endpoint、client ID 和 Client Secret。

#### `OAuthTokenProvider`

提供以下后端内部接口：

```java
OAuthAccessToken getToken();
void invalidate();
```

`OAuthAccessToken` 只在服务内部传递，至少包含 Token 值、Token 类型和过期时间；其 `toString()` 必须脱敏。

#### `ClientCredentialsOAuthTokenProvider`

使用独立的 HTTP Client 向 Token Endpoint 发送 `application/x-www-form-urlencoded` 请求，不复用测试请求的自动 Header 注入链路。

默认使用 `client_secret_basic`；为兼容需要在表单传 Secret 的 IdP，允许显式配置 `client_secret_post`。grant type 固定为 `client_credentials`。scope 使用 OAuth 约定的空格分隔字符串，audience 为可选参数。

#### `OAuthRequestAuthorizer`

根据 Step 的 `oauthMode`、已有 Header 和全局 OAuth 开关，决定是否调用 Token Provider 并写入 `Authorization`。该组件不处理入站 HTTP 请求。

#### `ExecutionService`

继续负责 URL、query、body、Header 合并和请求执行；在现有环境 Header 与 Step Header 合并流程中增加 OAuth authorizer，不改变执行拓扑、依赖缓存和调度模型。

### 5.2 请求数据流

```text
Test execution (sync / schedule / SSE)
        |
        v
ExecutionService -> build environment headers
        |
        v
OAuthRequestAuthorizer
        |-- oauthMode=DISABLED or explicit Authorization -> skip
        |-- cached token usable -> reuse
        `-- cache miss/refresh -> client_credentials Token Endpoint
        |
        v
set Authorization: Bearer <access_token>
        |
apply explicit Step headers (explicit Authorization wins)
        |
RestTemplate.exchange -> target API
```

Mock、Webhook 接收端和 OrchestAPI 自身 Controller 不经过这条出站注入链路。

## 6. 配置契约

建议的 Spring 配置属性和 Deployment 环境变量如下：

| Spring 属性 | 环境变量 | 必填条件 | 说明 |
| --- | --- | --- | --- |
| `orchestapi.oauth.enabled` | `ORCHESTAPI_OAUTH_ENABLED` | 无，默认 `false` | 是否启用自动 OAuth |
| `orchestapi.oauth.token-endpoint` | `ORCHESTAPI_OAUTH_TOKEN_ENDPOINT` | enabled 时必填 | OAuth Token Endpoint |
| `orchestapi.oauth.client-id` | `ORCHESTAPI_OAUTH_CLIENT_ID` | enabled 时必填 | 预置 Service Account Client ID |
| `orchestapi.oauth.client-secret` | `ORCHESTAPI_OAUTH_CLIENT_SECRET` | enabled 时必填 | 仅由外部 Secret 注入 |
| `orchestapi.oauth.scopes` | `ORCHESTAPI_OAUTH_SCOPES` | 可选 | 空格分隔 scope |
| `orchestapi.oauth.audience` | `ORCHESTAPI_OAUTH_AUDIENCE` | 可选 | Provider-specific audience |
| `orchestapi.oauth.client-auth-method` | `ORCHESTAPI_OAUTH_CLIENT_AUTH_METHOD` | 默认 `client_secret_basic` | 允许 `client_secret_basic` 或 `client_secret_post` |
| `orchestapi.oauth.refresh-skew-seconds` | `ORCHESTAPI_OAUTH_REFRESH_SKEW_SECONDS` | 默认 `60` | 提前刷新窗口 |
| `orchestapi.oauth.request-timeout-ms` | `ORCHESTAPI_OAUTH_REQUEST_TIMEOUT_MS` | 默认 `10000` | Token Endpoint 总请求超时 |

生产 profile 对 Token Endpoint 要求 HTTPS；开发 profile 可显式使用 HTTP 进行本地 Mock 测试。Endpoint 的网络出口、DNS、TLS 和 allowlist 由 Starbucks 平台配合提供。

## 7. Step 合约与 Header 优先级

在 `TestStep`、`TestStepRequest`、`TestStepResponse` 和前端类型中增加：

```text
oauthMode = INHERIT | DISABLED
```

数据库迁移为现有 Step 增加非空列，默认值为 `INHERIT`。OAuth 全局关闭时该字段不产生行为变化。

Header 的确定顺序为：

1. Environment 默认 Header；
2. 如果 Step 不是 `DISABLED`、OAuth 已启用且当前没有 `Authorization`，注入自动 Bearer Token；
3. Step 显式 Header 最后写入，因此显式 `Authorization` 覆盖自动 Token。

由此保持以下兼容性：

- 现有 Environment 手工 `Authorization` 优先于自动 Token；
- 现有 Token dependency step 和提取变量无需迁移；
- 需要匿名调用的 Step 可选择 `DISABLED`；
- 自动 OAuth 不会覆盖用户明确写入的 Header。

## 8. Token 生命周期与并发

Token Provider 在进程内保存一个缓存项，因为本次设计是一套 Deployment 级 Client：

- 使用 Token Endpoint 返回的 `expires_in` 计算 `expiresAt`；
- `refreshAt = issuedAt + max(1, expiresIn - refreshSkewSeconds)`；
- 当前时间早于 `refreshAt` 时直接复用；
- 进入刷新路径时使用 double-check + synchronized/single-flight，保证并发请求只触发一次 Token 请求；
- `invalidate()` 清除当前缓存，但不持久化任何 Access Token；
- 配置变更通过 Pod rollout 重新建立缓存，旧进程退出后 Token 自然丢弃。

Token 响应至少需要非空 `access_token` 和正数 `expires_in`。`token_type` 缺省时按 Bearer 处理；显式返回非 Bearer 类型时拒绝自动注入。

## 9. 错误、日志与脱敏

定义稳定的内部错误分类：

- `OAUTH_CONFIGURATION_INVALID`：启用后缺少 endpoint、client ID 或 Secret，或配置值非法；
- `OAUTH_TOKEN_ENDPOINT_UNAVAILABLE`：连接、TLS 或超时失败；
- `OAUTH_TOKEN_REQUEST_REJECTED`：Token Endpoint 返回 4xx/5xx；
- `OAUTH_TOKEN_RESPONSE_INVALID`：响应缺少有效 Access Token、过期时间或 Token 类型不支持。

错误消息只包含安全摘要（endpoint 主机、HTTP 状态、request correlation 信息），不包含 Client Secret、Access Token 和完整上游响应体。日志允许记录请求耗时、状态码、缓存命中/刷新结果，但禁止记录表单内容和 Token。

`StepExecutionResult.requestHeaders`、执行事件和 `generateCurl` 输出中的 `Authorization` 均使用 `<redacted>`。Token Endpoint 的内部请求不作为测试 Step 结果返回。

MVP 对目标 API 的 `401` 不自动重试。后续如确有需要，只能另行设计幂等方法、单次强制刷新和重试边界。

## 10. 前端与 API 影响

- 前端不新增 OAuth client、secret 或 access token API。
- StepEditor 增加 `OAuth: 继承 / 关闭自动注入` 控件，并随现有 Step DTO 保存。
- Environment 页面不展示 Secret；Deployment 级 OAuth 状态不通过前端暴露 Token。
- Axios 和原生 EventSource 继续只访问 OrchestAPI。SSE 流中的执行结果沿用后端脱敏后的 Header。
- 不增加 Spring Security 依赖；本次仅使用 Spring Web 的出站 HTTP 能力，不改变入站认证。

## 11. Kubernetes 部署契约

仍然只渲染一个 `Deployment`，不在仓库创建 `Secret`。OAuth 启用时，平台预创建外部 Secret（建议名称 `orchestapi-oauth`，key 为 `client-secret`），Deployment 通过 `secretKeyRef` 注入 `ORCHESTAPI_OAUTH_CLIENT_SECRET`。也可由平台将该 key 合并到已有外部 Secret，但不能写入 YAML 明文。

非敏感 OAuth 参数写入环境自有 overlay 的 Deployment；默认示例保持 OAuth 关闭或使用占位配置。平台还必须允许 Pod 到 Token Endpoint 的出站 DNS、TLS 和网络访问。

这项改造不改变既有内部入口：入站白名单、Service、Ingress/Gateway、NetworkPolicy、Namespace 和镜像拉取权限仍由 Starbucks 平台负责。

## 12. 测试与验证策略

### 后端 focused tests

1. 配置校验：关闭时允许缺省值；开启时缺少必填项失败；认证方式和 URL 校验正确。
2. Token 请求：断言 form 参数、Basic/Post 客户端认证、scope/audience 和响应解析。
3. Cache：多次获取只请求一次；接近过期刷新；并发刷新只有一个上游请求。
4. ExecutionService：`INHERIT` 注入、`DISABLED` 跳过、Environment/Step 手工 Authorization 优先级正确。
5. Redaction：执行结果、curl、日志测试数据中不出现实际 Token 或 Secret。
6. Failure：超时、4xx/5xx、无效响应映射为稳定 OAuth 错误，且不暴露上游正文。
7. Regression：OAuth 关闭时现有手工 Token dependency flow、同步执行、定时执行、SSE 执行和入站路由不变。

### 前端与部署验证

- `npm run build` 验证 Step DTO 和编辑器编译；手工检查 OAuth mode 的读写。
- `mvn test` 验证后端 focused/regression tests。
- `kubectl kustomize k8s/overlays/internal-example` 验证只输出一个 Deployment、Secret 仅为 `secretKeyRef`、不存在明文凭据。
- 本地可用 Mock Token Endpoint 做端到端执行证明；这不能替代 Starbucks 真实 Token Endpoint、数据库、Ingress 和网络策略验证。

## 13. 验收映射

本设计对应 `docs/intent/2026-08-31-oauth-service-account-token/03-acceptance-checklist.md` 的 A1–A10：Token 获取/参数/缓存由 OAuth Provider tests 覆盖；注入/兼容/路径范围由 ExecutionService 和回归测试覆盖；脱敏由结果/日志测试覆盖；Deployment 外部 Secret 和单资源边界由 Kustomize 检查覆盖。真实 Starbucks 环境的出口、凭据、Token 权限和入口 allowlist 仍需现场验证。

## 14. 后续演进边界

当出现以下需求时，应单独开设计而不是扩张本次 MVP：

- 每个 Environment 使用不同 Service Account Client；
- 通过 UI 创建、轮换或吊销 Client；
- 多副本共享 Token cache；
- 目标 API `401` 的安全重试；
- OrchestAPI 入站 Keycloak 登录、JWT 或细粒度权限控制；
- UMA/RPT 或资源实例级授权。
