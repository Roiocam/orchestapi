# Environment-scoped OAuth Service Account Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OrchestAPI 的出站 OAuth 2.0 client_credentials 能力从 Deployment 全局配置改造成 Environment 级配置，Client Secret 由现有 Environment API/UI 脱敏保存，并在第一个符合条件的真实出站请求前惰性获取和缓存 Service Account Token。

**Architecture:** Environment 是 OAuth 配置唯一权威边界。持久化使用 Environment 一对一 OAuth 子表和递增 revision；事务内把配置复制成不可变 EnvironmentOAuthSnapshot，ExecutionService 将 snapshot 传给按 environmentId 隔离的 Token Provider。Provider 在 JVM 内存中做每 Environment single-flight 和 refresh-skew，Authorizer 只在目标 HTTP exchange 前按 Header 优先级注入 Bearer Token。入站认证、浏览器认证、Mock、Webhook、Actuator 和现有手工 Authorization 逻辑不变。

**Tech Stack:** Java 21, Spring Boot, Spring MVC/JPA, Flyway, PostgreSQL/H2 tests, React/TypeScript, Vite, Kubernetes Kustomize.

**Spec:** docs/superpowers/specs/2026-08-31-orchestapi-oauth-environment-scoped-design.md

## Global Constraints

- OAuth grant 固定为 client_credentials；OrchestAPI 不调用 IdP Admin API，也不创建 Client、Service Account 或权限策略。
- OAuth 配置只从当前选中的 Environment 读取；删除现有 orchestapi.oauth Deployment properties，不保留隐式全局 fallback。
- Client Secret 只保存在 Environment OAuth Secret 字段；API/UI 仅返回 masked value 和 clientSecretConfigured，update 省略或提交 masked value 时保留原值，清除必须显式 clearClientSecret=true。
- Access Token 只存在当前 JVM 的 Environment-scoped Provider cache，不进入数据库、前端、执行结果、SSE、curl、变量提取或日志；本次不引入跨 Pod cache。
- 只有真实 eligible Step 即将调用目标 HTTP endpoint 时才触发 token 获取；Environment save/read、应用启动、run preparation、curl preview、manual Authorization 和 DISABLED Step 均不得触发。
- Header 优先级固定为 Step 显式 Authorization > Environment 手工 Authorization > Environment 自动 OAuth；Step oauthMode 保留 INHERIT/DISABLED，默认 INHERIT。
- Token endpoint 失败时当前 Step 安全失败且目标请求不发出；MVP 不因目标 401 自动刷新或重放业务请求。
- 普通执行、单 Step、定时、SSE、dependency 和 side-effect 请求都必须复用同一不可变 OAuth snapshot 与同一 Provider 语义，异步阶段不得懒加载 JPA Entity。
- Kubernetes 最终只渲染一个 Deployment；OAuth 不再使用 Deployment 环境变量或 orchestapi-oauth Secret ref，Deployment 仍可引用外部数据库 Secret。
- 修改 public contract 时先完成对应 focused test，再进入下一层；Java 使用仓库约定的 Java 21，前端使用现有 lockfile 和 npm scripts。

## Implementation Tasks

### Task 1: 建立 Environment OAuth domain contract 与数据库 schema

**Files**

- Create backend/src/main/java/com/orchestrator/model/EnvironmentOAuthConfig.java。
- Create backend/src/main/java/com/orchestrator/oauth/EnvironmentOAuthSnapshot.java。
- Create backend/src/main/java/com/orchestrator/dto/EnvironmentOAuthRequest.java 和 EnvironmentOAuthResponse.java（按仓库 DTO package 实际位置落盘）。
- Modify backend/src/main/java/com/orchestrator/model/Environment.java、EnvironmentRequest、EnvironmentResponse。
- Create backend/src/main/resources/db/migration/V32__create_environment_oauth_configs.sql。
- Create backend/src/test/java/com/orchestrator/model/EnvironmentOAuthConfigTest.java。

**Contract and implementation details**

- EnvironmentOAuthConfig 使用 environment_id 一对一主键外键，字段包括 enabled、tokenEndpoint、clientId、clientSecret、scopes、audience、clientAuthMethod、refreshSkewSeconds、requestTimeoutMs、revision、createdAt、updatedAt。
- 增加不可变 snapshot，构造签名固定为：UUID environmentId、long revision、boolean enabled、String tokenEndpoint、String clientId、String clientSecret、String scopes、String audience、String clientAuthMethod、long refreshSkewSeconds、long requestTimeoutMs。snapshot 不暴露可变 Entity 或 JPA lazy relation。
- 增加写入 DTO：上述可配置字段加 boolean clearClientSecret；响应 DTO 不含明文 Secret，只返回 masked clientSecret 与 boolean clientSecretConfigured。
- 默认 enabled=false、client_auth_method=client_secret_basic、refreshSkewSeconds=60、requestTimeoutMs=10000。enabled=true 时校验绝对 http(s) endpoint、非空 clientId/clientSecret、支持的认证方式、正 timeout 和合法 refresh skew；生产 profile 的 endpoint 必须为 HTTPS。
- migration 创建 orchestrator.orchestapi_environment_oauth_configs，environment_id 为主键并级联删除；为已有 Environment 回填 disabled 默认行，保证升级前后行为一致；revision 初始为 1。
- 先写模型/default/validation/snapshot focused tests，再实现使其通过。

**Verification**

执行 backend Maven focused test：mvn -Dtest=EnvironmentOAuthConfigTest test。预期先以 RED 证明 contract 缺失，再以 GREEN 证明默认值、校验边界、masked response contract 和 snapshot copy 均成立；随后执行 git diff --check。

**Commit**

提交 feat: add environment OAuth configuration contract。

### Task 2: 接通持久化、Environment API 与 Secret 安全映射

**Files**

- Create backend/src/main/java/com/orchestrator/repository/EnvironmentOAuthConfigRepository.java。
- Modify EnvironmentRepository 的 detail fetch/query，使 Environment 执行准备可以取得 OAuth 配置。
- Modify EnvironmentService、EnvironmentController、EnvironmentRequest、EnvironmentResponse 的 create/update/get/list 映射。
- Create/modify focused tests：EnvironmentOAuthServiceTest、EnvironmentOAuthApiTest，以及需要补充的 repository migration test。

**Contract and implementation details**

- create Environment 时在同一事务创建 disabled OAuth config；带 enabled OAuth 时执行完整字段校验并保存 Secret。
- update 时区分三种输入：Secret 省略、现有 masked value 都保留数据库 Secret；提交新非 masked Secret 才替换；clearClientSecret=true 时清空且禁止同时提交新 Secret。clear 操作不能由普通 placeholder 或变量解析触发。
- 每次 OAuth 配置有效更新递增 revision；启用状态、endpoint、client、scope/audience、认证方式、timeout/skew 和 Secret 变化都使 revision 失效。无 OAuth 变化的 Environment 更新不得意外清空 Secret。
- EnvironmentResponse.from、分页列表、错误消息和审计相关映射全部走 masked 输出；任何 controller serialization、日志或异常都不能出现原始 Secret。
- Repository/detail fetch 同时取得 vars、headers、connectors 与 OAuth，避免在异步执行中触发 lazy load；Environment 删除依靠事务/数据库 cascade 删除 OAuth 行。

**Verification**

运行 mvn -Dtest=EnvironmentOAuthServiceTest,EnvironmentOAuthApiTest test，并用 MockMvc 断言 create/update/get 的字段校验、masked Secret 保留、clear 行为、revision 递增和删除级联。额外用 rg 检查响应序列化路径不存在 raw clientSecret 输出。

**Commit**

提交 feat: persist environment OAuth settings safely。

### Task 3: 将 Token Provider 改成按 Environment 隔离

**Files**

- Delete backend/src/main/java/com/orchestrator/config/OAuthProperties.java。
- Modify OAuthTokenProvider、ClientCredentialsOAuthTokenProvider、NoopOAuthTokenProvider、OAuthConfiguration、OAuthAccessToken 及相关异常/脱敏类。
- Replace or update oauth package tests；新增 EnvironmentOAuthTokenProviderTest。
- Modify backend/src/main/resources/application.yml，移除 orchestapi.oauth properties binding。

**Contract and implementation details**

- OAuthTokenProvider public contract 改为 getToken(EnvironmentOAuthSnapshot oauth) 与 invalidate(UUID environmentId)；不得再接收全局 properties。
- ClientCredentialsOAuthTokenProvider 的 cache key 是 environmentId，cache entry 至少保存 revision、accessToken、tokenType、expiresAt、refreshAt；不同 Environment 即使 clientId 相同也不共享。
- 每个 Environment 使用独立 monitor/lock 完成 double-check single-flight：refresh window 内复用，过期/接近过期时同一 Environment 只有一个 token endpoint 请求；其他 Environment 不互相阻塞。
- refreshAt 使用 issuedAt + max(1, expiresIn - refreshSkewSeconds)，处理 expires_in 缺失、非正值、invalid token_type、空 access_token 和 HTTP 4xx/5xx；错误映射为 OAUTH_CONFIGURATION_INVALID、OAUTH_TOKEN_ENDPOINT_UNAVAILABLE、OAUTH_TOKEN_REQUEST_REJECTED、OAUTH_TOKEN_RESPONSE_INVALID。
- 支持 client_secret_basic 和 client_secret_post；按 snapshot 的 scopes、audience、requestTimeoutMs 组装请求。Secret、Basic header、form body、access token 和上游 response body 不写日志。
- Provider 只保存 JVM 内存数据；revision 变化由 invalidate 清除对应 environmentId，不增加 DB token 表、Redis 或跨 Pod 协议。Noop provider 保持 OAuth disabled 时无请求行为。

**Verification**

运行 mvn -Dtest=ClientCredentialsOAuthTokenProviderTest,OAuthConfigurationTest,EnvironmentOAuthTokenProviderTest test。测试至少覆盖两个 Environment endpoint/client 隔离、basic/post form、scope/audience、cache hit、refresh skew、并发 single-flight、revision invalidate 和安全错误。

**Commit**

提交 feat: scope OAuth token cache to environments。

### Task 4: 在 ExecutionService 中实现惰性触发与不可变 snapshot 传递

**Files**

- Modify OAuthRequestAuthorizer、DefaultOAuthRequestAuthorizer 及 authorizer tests。
- Modify ExecutionService、PreparedExecution 及执行相关测试。
- Update existing ExecutionServiceOAuthTest and add trigger-timing/async-path tests.

**Contract and implementation details**

- Authorizer 接口签名固定为 apply(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers) 与 applyPreview(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers)；preview 只能写 Bearer <redacted>，不得调用 Provider。
- prepareSuiteRun/prepareStepRun 在事务内解析 Environment 详情并复制 OAuth snapshot；PreparedExecution 只携带 immutable snapshot，不在 scheduled/SSE async 阶段访问 lazy JPA。
- executeStep 的顺序必须是：解析 URL/query/body；合并 Environment 与 Step headers；判断 Step.oauthMode 和手工 Authorization；仅在没有手工 Authorization 且为 INHERIT 且 OAuth enabled 时调用 Provider；注入 Bearer；最后才执行目标 RestTemplate.exchange。
- runSuite、runStep、schedule、SSE、dependency 与 side-effect 继续汇聚到同一路径。Verification Connector 请求不进入自动 OAuth 注入链。
- 手工 Authorization 检查要覆盖 Step header 和 Environment default header；显式 Step header 覆盖 Environment header；OAuth disabled 或 oauthMode=DISABLED 时完全保持旧行为。
- Provider 异常转换为当前 Step 安全错误并短路目标请求；目标服务 401 只按普通响应处理，不触发刷新/重放；curl 预览不产生网络调用。

**Verification**

运行 mvn -Dtest=ExecutionServiceOAuthTest,OAuthRequestAuthorizerTest,OAuthTriggerTimingTest test。断言 prepare、curl、manual Authorization、DISABLED、空/跳过/失败依赖不请求 Token；首个 eligible Step 才请求；后续复用；refresh window 只刷新一次；不同 Environment 使用各自 snapshot/token；Token 失败时目标 exchange 次数为零。补充 scheduled/SSE prepared execution 证明事务关闭后仍可使用 snapshot。

**Commit**

提交 feat: trigger OAuth lazily per environment。

### Task 5: 在 Environment 页面提供 OAuth 配置并保留 Step 例外开关

**Files**

- Create frontend/src/components/EnvironmentOAuthSection.tsx（或仓库现有组件目录中的等价文件）。
- Modify frontend/src/types/environment.ts、environmentApi、EnvironmentDetailPage。
- Modify frontend StepEditor、TestSuiteDetailPage、testSuiteApi、导入/导出/复制类型（仅在回归需要时）。
- Add/update frontend tests or type-level fixtures where repository has an established pattern。

**Contract and implementation details**

- 前端 Environment OAuth type 包含 enabled、tokenEndpoint、clientId、clientSecret、clientSecretConfigured、scopes、audience、clientAuthMethod、refreshSkewSeconds、requestTimeoutMs、clearClientSecret；clientAuthMethod 只允许 client_secret_basic/client_secret_post。
- EnvironmentDetailPage 新增启用开关、Endpoint、Client ID、Secret、scopes、audience、认证方式、refresh skew、timeout；保存时保留 omitted/masked Secret，清除使用显式 clear action。复用现有 Environment Secret variable 的 masked/reveal/update-preserve 交互，不把 Secret 放进普通变量或默认 header UI。
- Environment 列表/详情只显示 enabled 与 Secret configured 状态；不新增 token fetch API，不在浏览器、Axios、EventSource 或页面状态中请求/缓存 Access Token。
- StepEditor 保留 oauthMode INHERIT/DISABLED 默认值、导入导出和复制兼容；不得把全局 OAuth 配置重新加入 Step 或 Suite。

**Verification**

运行 npm run build，并执行仓库已有 frontend test/lint 命令（若有）。手动检查 Environment 新建、编辑、masked Secret 回显后保存、显式清除、启用校验和 Step DISABLED 交互；确认构建产物不包含 Token endpoint 请求逻辑。

**Commit**

提交 feat: configure OAuth per environment in UI。

### Task 6: 删除 Deployment 全局 OAuth 来源并更新部署文档/检查脚本

**Files**

- Modify k8s/base/deployment.yaml、相关 overlays、k8s/README.md、根 README.md。
- Modify test-script/verify-deployment-only.sh 及部署验收 checklist。
- Modify application.yml 或 profile 配置中遗留的 orchestapi.oauth 绑定。

**Contract and implementation details**

- Deployment 删除所有 ORCHESTAPI_OAUTH_* env、secretKeyRef 和 orchestapi-oauth Secret 引用；保留现有数据库外部 Secret 和运行时基础变量。
- Kustomize 输出必须仍只有一个 Deployment，不创建 Secret、ConfigMap、Service、Ingress、NetworkPolicy；不要把 Environment Client Secret 复制到 manifest。
- 更新部署说明为：先部署 JAR/image，再通过 Environment API/UI 录入 endpoint/client/scopes/audience/auth method 和 Secret；发布迁移不自动把旧全局值写入任何 Environment。
- verify-deployment-only.sh 先增加 fail-closed 断言检查 ORCHESTAPI_OAUTH_、orchestapi-oauth、Secret/ConfigMap/Service/Ingress/NetworkPolicy 和 Deployment 数量；以旧 manifest 证明检查会失败，删除全局来源后再次运行通过。
- 文档明确受限内网部署、外部数据库 Secret、Environment 脱敏 Secret、lazy token 时机和现场 Starbucks IdP/DNS/TLS/egress/权限验证边界。

**Verification**

运行脚本、kustomize build（使用仓库既有 overlay 命令）和 rg -n 检查全仓库不再存在 Deployment OAuth 绑定；检查输出中只有一个 Deployment 且没有 OAuth Secret 明文或 Secret manifest。文档中的命令需与当前脚本和 overlay 路径一致。

**Commit**

提交 docs: move OAuth ownership to environments。

### Task 7: 完成全量验证、验收证据和最终边界审查

**Files**

- Modify docs/acceptance/2026-08-31-orchestapi-oauth-service-account-token-checklist.md（或仓库中现有对应 checklist）。
- 如验证暴露契约性问题，只在对应源码/测试文件中补最小修复；不扩大到入站认证或 IdP Admin API。

**Verification sequence**

1. 在 backend 使用 Java 21 执行 mvn test，记录 focused tests 与 baseline-equivalent warnings/failures 的区别；确认 H2 JSONB/Mongo monitor 等已知日志不被误判为 OAuth 回归。
2. 在 frontend 执行 npm run build，并运行现有 lint/test 命令；记录依赖审计提示但不将其伪装成 OAuth 通过证据。
3. 执行 Kustomize/render/check script，确认单 Deployment、仅数据库外部 Secret 引用、无 ORCHESTAPI_OAUTH_、无 orchestapi-oauth、无额外 workload/resource。
4. 用本地 mock token endpoint + mock target 验证惰性触发、Environment 隔离、缓存/refresh/single-flight、manual header 优先级、Token 失败短路和不做 401 replay。
5. 使用 git diff --check、全局 source audit 和 API response fixture 检查 raw Secret/Token 不进入 response、SSE、curl、日志、变量、数据库持久化。
6. 更新 checklist 的 A1-A10 映射：A1-A7 增加 Environment 选择与触发时机证据；A8 证明普通/scheduled/SSE/dependency/side-effect snapshot 传递；A9 保持入站边界；A10 证明单 Deployment 且无全局 OAuth。
7. 最终 review 必须确认没有 OAuthProperties 全局 binding、Kubernetes OAuth Secret ref、Spring Security/浏览器 OAuth flow、IdP Admin API、401 自动重放或 Token 持久化；真实 Starbucks IdP、DNS/TLS、egress、数据库、入口 allowlist 和目标 API 权限标记为现场待验证证据，而不是本地通过。

**Commit**

提交 test: record environment OAuth acceptance evidence。

## Sequencing and Checkpoints

- Task 1 完成后暂停一次 contract checkpoint：确认 DTO 字段、Secret update 语义、migration 默认 disabled 和 snapshot 签名，再进入 service 实现。
- Task 2-4 是后端 vertical slice，按顺序执行；Task 4 完成后暂停一次运行时 checkpoint，审查真实触发点和 scheduled/SSE 不访问 lazy JPA 的证据。
- Task 5 与 Task 6 可在后端 slice 稳定后执行；两者都必须保持此前已确认的单 Deployment 受限内网部署边界。
- Task 7 是最终验证，不把 focused/local evidence 宣称为 Starbucks live proof；现场 IdP 和网络验证由部署方执行。
- 每个任务只提交本任务列出的窄范围 commit；若发现方向性问题，先停止并回到对应 checkpoint，不继续堆叠实现。

## Completion Criteria

- [x] Environment OAuth schema、DTO、masked Secret 语义和 revision 已由 focused tests 覆盖。
- [x] Provider 按 Environment 隔离并发缓存，支持 basic/post、scope/audience、refresh skew、invalidate 和安全错误。
- [x] Token 仅在第一个 eligible 真实目标请求前惰性获取；prepare/curl/manual/DISABLED 不触发；Token 失败不调用目标。
- [x] 普通、单 Step、scheduled、SSE、dependency、side-effect 均使用不可变 Environment snapshot。
- [x] 前端 Environment UI 可保存/更新/清除 masked Secret，Step INHERIT/DISABLED 保持兼容，浏览器不接触 Access Token。
- [x] application/Kubernetes 不再提供全局 OAuth 来源，单 Deployment 验收脚本通过。
- [x] Java、frontend、Kustomize、mock endpoint 和安全审查证据已记录；真实 Starbucks IdP/网络/权限证据明确留给现场部署。

## Verification record (2026-08-31)

- Backend: `JAVA_HOME=/Users/jingchen/Library/Java/JavaVirtualMachines/azul-21.0.10/Contents/Home PATH="/Users/jingchen/Library/Java/JavaVirtualMachines/azul-21.0.10/Contents/Home/bin:$PATH" mvn test` — `BUILD SUCCESS`, 65 tests, 0 failures/errors. H2 JSONB DDL、Webhook constraint 和本机 Mongo monitor 的既有警告未作为 OAuth 失败。
- Frontend: `npm run build` — TypeScript/Vite build succeeded. Existing bundle-size warning remains. `npm run lint` still reports the repository's pre-existing 45 errors; no new lint-clean claim is made.
- Deployment: `./test-script/verify-deployment-only.sh` and `kubectl kustomize k8s/overlays/internal-example` — exactly one Deployment, only database `secretKeyRef`, no Secret/ConfigMap/Service/Ingress/NetworkPolicy manifest, no `ORCHESTAPI_OAUTH_*` or `orchestapi-oauth` binding.
- Runtime/security: provider and ExecutionService tests cover mocked token endpoint/target ordering, per-Environment cache isolation, single-flight, refresh/revision behavior, manual Authorization precedence, preview no-network behavior, safe error short-circuit, and prepared snapshot use. Source audit confirms no browser token fetch/cache and no remaining global OAuth binding in runtime sources.
- Starbucks live proof remains pending: approved IdP Client/Secret, Environment API data entry, DNS/TLS/egress, external PostgreSQL, platform Service/Ingress/NetworkPolicy/allowlist, target API scopes and end-to-end SSE/scheduled traffic must be verified in the internal cluster.
