# OrchestAPI OAuth Service Account Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 OrchestAPI 在不改变入站认证的前提下，通过 Deployment 注入的 OAuth Client Credentials 自动获取、缓存并注入 Service Account Bearer Token。

**Architecture:** 使用 Deployment 级 `OAuthProperties` 和后端 `OAuthTokenProvider`。Provider 以 `client_credentials` 调用 Token Endpoint，在 JVM 内按 `expires_in` 缓存并提前刷新；`OAuthRequestAuthorizer` 在 `ExecutionService` 的出站 Header 组装阶段按 Step 的 `oauthMode` 注入 Token。Client Secret 仅来自外部 Kubernetes Secret，所有执行结果和 curl 展示都脱敏。

**Tech Stack:** Java 21, Spring Boot 3.3.7, Spring Web `RestTemplate`, Spring Boot `@ConfigurationProperties`, JPA/Flyway PostgreSQL, JUnit 5/Mockito/Spring MockRestServiceServer, React 19, TypeScript, Ant Design, Kubernetes Kustomize。

**Spec:** `docs/superpowers/specs/2026-08-31-orchestapi-oauth-service-account-token-design.md`

## Global Constraints

- OAuth grant type 固定为 `client_credentials`；OrchestAPI 不调用 IdP Admin API，不创建 Client 或 Service Account。
- `ORCHESTAPI_OAUTH_ENABLED` 默认 `false`；启用时 endpoint、client ID 和 client secret 必须完整，生产 profile 只允许 HTTPS Token Endpoint。
- Client Secret 通过外部 Kubernetes Secret 的 `secretKeyRef` 注入；不得在 Git、数据库、前端响应、执行结果或日志中保存明文凭据/Token。
- Token 只在后端 JVM 内存缓存；刷新窗口默认 60 秒；并发刷新必须 single-flight。
- `TestStep.oauthMode` 只有 `INHERIT` 和 `DISABLED`，数据库默认 `INHERIT`；Step 显式 `Authorization` 优先于 Environment 手工 Header，Environment 手工 Header 优先于自动 OAuth。
- 自动 OAuth 只作用于 `ExecutionService` 发出的测试请求，不改变 OrchestAPI 入站 REST、Actuator、Mock、Webhook、Axios 或 EventSource 的认证行为。
- MVP 不因目标请求 `401` 自动重放业务请求；已有用户配置的 response-handler retry 行为保持不变。
- 保持 Java 21、本仓库单镜像/单 Deployment/`replicas: 1` 和 `/orchestapi` context path；不引入 Spring Security、Redis 或多 Environment OAuth 凭据。
- 每个实现切片先运行 focused test，再运行 backend/full/build/deployment verification；本地结果不得表述为 Starbucks 真实环境证明。

## File Map

### OAuth 配置与 Token 生命周期

- Create: `backend/src/main/java/com/orchestrator/config/OAuthProperties.java` — 绑定并校验 `orchestapi.oauth.*` 配置。
- Create: `backend/src/main/java/com/orchestrator/config/OAuthConfiguration.java` — 注册 OAuth RestTemplate、Clock 和 enabled/no-op Provider。
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthAccessToken.java` — 内部 Token 值、类型和过期时间，禁止明文 `toString()`。
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenProvider.java` — Token Provider 接口。
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenErrorCode.java` — 稳定错误分类。
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenException.java` — 安全错误消息和错误码。
- Create: `backend/src/main/java/com/orchestrator/oauth/NoopOAuthTokenProvider.java` — OAuth 关闭时的 no-op 实现。
- Create: `backend/src/main/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProvider.java` — Token Endpoint 请求、缓存、刷新和并发控制。
- Modify: `backend/src/main/resources/application.yml` — OAuth 默认属性和环境变量映射。
- Test: `backend/src/test/java/com/orchestrator/oauth/OAuthPropertiesTest.java`。
- Test: `backend/src/test/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProviderTest.java`。

### Step 合约与持久化

- Create: `backend/src/main/java/com/orchestrator/model/enums/OAuthMode.java` — `INHERIT`/`DISABLED`。
- Modify: `backend/src/main/java/com/orchestrator/model/TestStep.java` — 持久化 `oauthMode`。
- Modify: `backend/src/main/java/com/orchestrator/dto/TestStepRequest.java` — 接收 OAuth mode。
- Modify: `backend/src/main/java/com/orchestrator/dto/TestStepResponse.java` — 返回 OAuth mode。
- Modify: `backend/src/main/java/com/orchestrator/service/TestStepService.java` — create/update 映射。
- Modify: `backend/src/main/java/com/orchestrator/dto/TestSuiteImportRequest.java` — suite import 的 OAuth mode。
- Modify: `backend/src/main/java/com/orchestrator/service/TestSuiteService.java` — import 映射。
- Modify: `backend/src/main/java/com/orchestrator/service/ImportService.java` — curl/import 默认值保持 `INHERIT`。
- Modify: `backend/src/main/resources/db/migration/V31__add_oauth_mode_to_test_steps.sql` — 现有 Step 的非空默认列。
- Test: `backend/src/test/java/com/orchestrator/TestStepOAuthModeApiTest.java`。

### 出站注入与脱敏

- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthRequestAuthorizer.java` — live/preview Header 注入边界。
- Create: `backend/src/main/java/com/orchestrator/oauth/DefaultOAuthRequestAuthorizer.java` — mode、已有 Header 和 Token Provider 的决策，注册为 Spring `@Component`。
- Create: `backend/src/main/java/com/orchestrator/oauth/RequestHeaderRedactor.java` — `Authorization` 脱敏。
- Modify: `backend/src/main/java/com/orchestrator/service/ExecutionService.java` — 在现有 Header 组装、执行结果、curl 和 OAuth 错误路径接入新边界。
- Test: `backend/src/test/java/com/orchestrator/oauth/OAuthRequestAuthorizerTest.java`。
- Test: `backend/src/test/java/com/orchestrator/oauth/RequestHeaderRedactorTest.java`。
- Test: `backend/src/test/java/com/orchestrator/ExecutionServiceOAuthTest.java`。

### 前端 Step 控制和导入导出

- Modify: `frontend/src/types/testSuite.ts` — `OAuthModeType`、Step request/response 字段。
- Modify: `frontend/src/components/StepEditor.tsx` — OAuth mode 选择和保存。
- Modify: `frontend/src/pages/TestSuiteDetailPage.tsx` — duplicate Step 保留 OAuth mode。
- Modify: `frontend/src/services/testSuiteApi.ts` — suite export 保留 OAuth mode。

### 部署、文档和验收

- Modify: `k8s/base/deployment.yaml` — OAuth 非敏感变量和外部 Secret 引用。
- Modify: `k8s/README.md` — OAuth Secret、Token Endpoint 网络前置条件和发布说明。
- Modify: `README.md` — 自动 OAuth 与手工 Token 的使用边界。
- Modify: `test-script/verify-deployment-only.sh` — 验证 OAuth Secret 引用和无明文凭据。
- Modify: `docs/intent/2026-08-31-oauth-service-account-token/03-acceptance-checklist.md` — 实现后回填 focused/deployment/live evidence 状态。

---

### Task 1: 建立 OAuth 配置、错误和 Token 内部契约

**Files:**
- Create: `backend/src/main/java/com/orchestrator/config/OAuthProperties.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthAccessToken.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenProvider.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenErrorCode.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthTokenException.java`
- Modify: `backend/src/main/resources/application.yml`
- Test: `backend/src/test/java/com/orchestrator/oauth/OAuthPropertiesTest.java`

**Interfaces:**
- Produces `OAuthProperties`, `OAuthAccessToken`, `OAuthTokenProvider`, `OAuthTokenErrorCode` and `OAuthTokenException` for Tasks 2–4.
- `OAuthTokenProvider` exposes exactly `OAuthAccessToken getToken()` and `void invalidate()`.
- `OAuthAccessToken` exposes `value()`, `tokenType()`, `expiresAt()` and `authorizationValue()`; `toString()` returns a representation with the token value replaced by `<redacted>`.

- [ ] **Step 1: Write failing property validation tests.**

Add tests covering disabled defaults, enabled required fields, supported authentication methods, timeout/refresh bounds, and absolute HTTP(S) endpoint validation:

```java
@Test
void disabledOAuthDoesNotRequireCredentials() {
    OAuthProperties properties = new OAuthProperties();
    properties.setEnabled(false);

    assertThatCode(properties::validate).doesNotThrowAnyException();
}

@Test
void enabledOAuthRequiresEndpointClientIdAndSecret() {
    OAuthProperties properties = new OAuthProperties();
    properties.setEnabled(true);

    assertThatThrownBy(properties::validate)
        .isInstanceOf(OAuthTokenException.class)
        .extracting("code")
        .isEqualTo(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID);
}

@Test
void enabledOAuthAcceptsBasicAndPostClientAuthentication() {
    OAuthProperties properties = validProperties("client_secret_basic");
    assertThatCode(properties::validate).doesNotThrowAnyException();

    properties.setClientAuthMethod("client_secret_post");
    assertThatCode(properties::validate).doesNotThrowAnyException();
}
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run from `backend/`:

```bash
mvn -Dtest=OAuthPropertiesTest test
```

Expected: compilation/test failure because the OAuth contract classes do not exist.

- [ ] **Step 3: Implement the configuration contract.**

Define `OAuthProperties` with defaults matching the spec:

```java
private boolean enabled = false;
private String tokenEndpoint = "";
private String clientId = "";
private String clientSecret = "";
private String scopes = "";
private String audience = "";
private String clientAuthMethod = "client_secret_basic";
private long refreshSkewSeconds = 60;
private long requestTimeoutMs = 10_000;
```

`validate()` must reject enabled configurations with blank endpoint/client ID/secret, unsupported auth method, non-positive timeout, negative refresh skew, or a non-absolute/non-HTTP(S) endpoint. It must throw `OAuthTokenException` with `OAUTH_CONFIGURATION_INVALID` and a safe message that contains no secret.

Define `OAuthTokenErrorCode` values `OAUTH_CONFIGURATION_INVALID`, `OAUTH_TOKEN_ENDPOINT_UNAVAILABLE`, `OAUTH_TOKEN_REQUEST_REJECTED`, and `OAUTH_TOKEN_RESPONSE_INVALID`. `OAuthTokenException` stores only the enum, safe message, and optional HTTP status; it must not expose the upstream response body.

Add this default binding to `application.yml` without putting a credential in the file:

```yaml
orchestapi:
  oauth:
    enabled: ${ORCHESTAPI_OAUTH_ENABLED:false}
    token-endpoint: ${ORCHESTAPI_OAUTH_TOKEN_ENDPOINT:}
    client-id: ${ORCHESTAPI_OAUTH_CLIENT_ID:}
    client-secret: ${ORCHESTAPI_OAUTH_CLIENT_SECRET:}
    scopes: ${ORCHESTAPI_OAUTH_SCOPES:}
    audience: ${ORCHESTAPI_OAUTH_AUDIENCE:}
    client-auth-method: ${ORCHESTAPI_OAUTH_CLIENT_AUTH_METHOD:client_secret_basic}
    refresh-skew-seconds: ${ORCHESTAPI_OAUTH_REFRESH_SKEW_SECONDS:60}
    request-timeout-ms: ${ORCHESTAPI_OAUTH_REQUEST_TIMEOUT_MS:10000}
```

- [ ] **Step 4: Run the focused test and verify it passes.**

```bash
mvn -Dtest=OAuthPropertiesTest test
```

Expected: all property validation and redacted `toString()` assertions pass.

- [ ] **Step 5: Commit the contract slice.**

```bash
git add backend/src/main/java/com/orchestrator/config/OAuthProperties.java \
  backend/src/main/java/com/orchestrator/oauth \
  backend/src/main/resources/application.yml \
  backend/src/test/java/com/orchestrator/oauth/OAuthPropertiesTest.java
git commit -m "feat: add OAuth service account token contracts"
```

Acceptance coverage: A7 (configuration/error contract), A4 (internal Token representation), A6 (OAuth disabled default).

### Task 2: 实现 client_credentials Token Provider、缓存和失败映射

**Files:**
- Create: `backend/src/main/java/com/orchestrator/config/OAuthConfiguration.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/NoopOAuthTokenProvider.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProvider.java`
- Test: `backend/src/test/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProviderTest.java`

**Interfaces:**
- Consumes Task 1 `OAuthProperties`, `OAuthAccessToken`, `OAuthTokenProvider` and `OAuthTokenException`.
- Produces a singleton `OAuthTokenProvider` bean. Disabled configuration produces `NoopOAuthTokenProvider`; enabled configuration produces `ClientCredentialsOAuthTokenProvider`.
- `ClientCredentialsOAuthTokenProvider` constructor accepts `OAuthProperties`, a dedicated `RestTemplate`, and an injectable `Clock` so refresh tests do not depend on wall-clock sleeps.

- [ ] **Step 1: Write failing HTTP/cache tests.**

Use `MockRestServiceServer` on the dedicated OAuth `RestTemplate`. Assert that the token endpoint receives form data and Basic authentication, then assert one upstream request for two provider calls:

```java
@Test
void requestsClientCredentialsAndReusesTokenUntilRefreshAt() {
    server.expect(ExpectedCount.once(), requestTo("https://idp.example.test/oauth/token"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, startsWith("Basic ")))
        .andExpect(content().string(allOf(
            containsString("grant_type=client_credentials"),
            containsString("scope=orders.read"))))
        .andRespond(withSuccess(
            "{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":300}",
            MediaType.APPLICATION_JSON));

    assertThat(provider.getToken().value()).isEqualTo("token-1");
    assertThat(provider.getToken().value()).isEqualTo("token-1");
    server.verify();
}

@Test
void serializesConcurrentRefreshes() throws Exception {
    server.expect(ExpectedCount.once(), requestTo("https://idp.example.test/oauth/token"))
        .andRespond(withSuccess(
            "{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":300}",
            MediaType.APPLICATION_JSON));
    ExecutorService executor = Executors.newFixedThreadPool(8);
    try {
        List<Future<String>> futures = IntStream.range(0, 8)
            .mapToObj(index -> executor.submit(() -> provider.getToken().value()))
            .toList();
        assertThat(futures).allSatisfy(future -> assertThat(future.get()).isEqualTo("token-1"));
    } finally {
        executor.shutdownNow();
    }
    server.verify();
}
```

Add tests for `client_secret_post`, optional `audience`, invalid response, Token Endpoint 401/500, connection timeout, non-Bearer token type, `expires_in <= 0`, and `invalidate()`.

- [ ] **Step 2: Run the focused test and verify it fails.**

```bash
mvn -Dtest=ClientCredentialsOAuthTokenProviderTest test
```

Expected: compilation failure because the provider/configuration beans do not exist.

- [ ] **Step 3: Implement the dedicated OAuth HTTP client and provider.**

Register `oauthRestTemplate` with `RestTemplateBuilder`, using `requestTimeoutMs` for connect/read timeouts. Register `Clock.systemUTC()` and the conditional Provider bean in `OAuthConfiguration`; call `OAuthProperties.validate()` for both enabled and disabled configurations. Annotate `DefaultOAuthRequestAuthorizer` with `@Component` so `ExecutionService` can inject the `OAuthRequestAuthorizer` interface. In the `prod` profile, reject enabled Token Endpoints whose scheme is not `https` before the first execution.

Build each Token request as `application/x-www-form-urlencoded`:

```java
form.add("grant_type", "client_credentials");
if (!properties.getScopes().isBlank()) form.add("scope", properties.getScopes().trim());
if (!properties.getAudience().isBlank()) form.add("audience", properties.getAudience().trim());
```

For `client_secret_basic`, set HTTP Basic with UTF-8 and do not put the secret in the form. For `client_secret_post`, add `client_id` and `client_secret` to the form. Parse only `access_token`, `token_type`, and `expires_in`.

Implement cache state as `volatile CachedToken cachedToken`, where `CachedToken` stores the internal `OAuthAccessToken` and `refreshAt`. Return the cached value before `refreshAt`; otherwise enter a synchronized double-check path, request one fresh token, and set:

```java
expiresAt = issuedAt.plusSeconds(expiresIn);
refreshAt = issuedAt.plusSeconds(Math.max(1, expiresIn - refreshSkewSeconds));
```

Map HTTP 4xx/5xx to `OAUTH_TOKEN_REQUEST_REJECTED`, connection/TLS/timeout errors to `OAUTH_TOKEN_ENDPOINT_UNAVAILABLE`, and missing/invalid fields or non-Bearer types to `OAUTH_TOKEN_RESPONSE_INVALID`. Log only endpoint host, status, duration and cache result; never log request form, Basic credentials, response body or Token.

- [ ] **Step 4: Run provider tests and inspect security assertions.**

```bash
mvn -Dtest=OAuthPropertiesTest,ClientCredentialsOAuthTokenProviderTest test
```

Expected: all request, cache, concurrency and safe-error tests pass; test output contains no `token-1` or `client-secret-value` in application log assertions.

- [ ] **Step 5: Commit the Provider slice.**

```bash
git add backend/src/main/java/com/orchestrator/config/OAuthConfiguration.java \
  backend/src/main/java/com/orchestrator/oauth/NoopOAuthTokenProvider.java \
  backend/src/main/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProvider.java \
  backend/src/test/java/com/orchestrator/oauth/ClientCredentialsOAuthTokenProviderTest.java
git commit -m "feat: add cached OAuth client credentials provider"
```

Acceptance coverage: A1 (Token acquisition), A2 (request contract), A3 (cache/refresh/concurrency), A7 (safe upstream failure).

### Task 3: 增加 Step oauthMode 并保持 CRUD/import/export 兼容

**Files:**
- Create: `backend/src/main/java/com/orchestrator/model/enums/OAuthMode.java`
- Create: `backend/src/main/resources/db/migration/V31__add_oauth_mode_to_test_steps.sql`
- Modify: `backend/src/main/java/com/orchestrator/model/TestStep.java`
- Modify: `backend/src/main/java/com/orchestrator/dto/TestStepRequest.java`
- Modify: `backend/src/main/java/com/orchestrator/dto/TestStepResponse.java`
- Modify: `backend/src/main/java/com/orchestrator/service/TestStepService.java`
- Modify: `backend/src/main/java/com/orchestrator/dto/TestSuiteImportRequest.java`
- Modify: `backend/src/main/java/com/orchestrator/service/TestSuiteService.java`
- Modify: `backend/src/main/java/com/orchestrator/service/ImportService.java`
- Test: `backend/src/test/java/com/orchestrator/TestStepOAuthModeApiTest.java`

**Interfaces:**
- Adds `OAuthMode.INHERIT` and `OAuthMode.DISABLED`.
- `TestStepRequest.oauthMode` defaults to `INHERIT`; `TestStepResponse.oauthMode` always returns the persisted enum name.
- Existing JSON imports that omit `oauthMode` deserialize to `INHERIT`; exported suites include the field.

- [ ] **Step 1: Write the failing API and migration contract test.**

Create a `@SpringBootTest` + `@AutoConfigureMockMvc` test under the existing `test` profile. Create a suite, create a Step with `oauthMode=DISABLED`, GET it, then import a suite JSON that omits the field and assert `INHERIT`:

```java
mockMvc.perform(post("/api/test-suites")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"oauth-mode-suite\",\"description\":\"\"}"))
    .andExpect(status().isCreated());

mockMvc.perform(post("/api/test-suites/{suiteId}/steps", suiteId)
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
            {"name":"anonymous","method":"GET","url":"/public",
             "headers":[],"queryParams":[],"bodyType":"NONE","body":"",
             "oauthMode":"DISABLED","dependencies":[],"responseHandlers":[],
             "extractVariables":[],"verifications":[],"responseValidations":[]}
            """))
    .andExpect(status().isCreated())
    .andExpect(jsonPath("$.oauthMode").value("DISABLED"));
```

- [ ] **Step 2: Run the contract test and verify it fails.**

```bash
mvn -Dtest=TestStepOAuthModeApiTest test
```

Expected: the API does not yet recognize or return `oauthMode`.

- [ ] **Step 3: Add the enum, column and DTO/service mappings.**

Add `V31__add_oauth_mode_to_test_steps.sql`:

```sql
ALTER TABLE orchestrator.orchestapi_test_steps
    ADD COLUMN oauth_mode VARCHAR(16) NOT NULL DEFAULT 'INHERIT';

ALTER TABLE orchestrator.orchestapi_test_steps
    ADD CONSTRAINT orchestapi_test_steps_oauth_mode_check
    CHECK (oauth_mode IN ('INHERIT', 'DISABLED'));
```

Map the JPA field as `@Enumerated(EnumType.STRING)` with `@Column(name = "oauth_mode", nullable = false, length = 16)` and a Java default of `OAuthMode.INHERIT`. Normalize a JSON `null` to `OAuthMode.INHERIT` in `TestStepService.create/update` and `TestSuiteService.buildStepRequest`. Set/get the field in `TestStepResponse.from` and `TestSuiteImportRequest.ImportStepDto`. Leave `ImportService.parseCurl` on the DTO default so imported curl steps inherit OAuth.

- [ ] **Step 4: Verify CRUD, import and migration behavior.**

```bash
mvn -Dtest=TestStepOAuthModeApiTest test
mvn test
```

Expected: explicit `DISABLED` round-trips; omitted import field becomes `INHERIT`; all existing backend tests remain green.

- [ ] **Step 5: Commit the persistence/API slice.**

```bash
git add backend/src/main/java/com/orchestrator/model/enums/OAuthMode.java \
  backend/src/main/java/com/orchestrator/model/TestStep.java \
  backend/src/main/java/com/orchestrator/dto/TestStepRequest.java \
  backend/src/main/java/com/orchestrator/dto/TestStepResponse.java \
  backend/src/main/java/com/orchestrator/service/TestStepService.java \
  backend/src/main/java/com/orchestrator/dto/TestSuiteImportRequest.java \
  backend/src/main/java/com/orchestrator/service/TestSuiteService.java \
  backend/src/main/java/com/orchestrator/service/ImportService.java \
  backend/src/main/resources/db/migration/V31__add_oauth_mode_to_test_steps.sql \
  backend/src/test/java/com/orchestrator/TestStepOAuthModeApiTest.java
git commit -m "feat: persist OAuth mode on test steps"
```

Acceptance coverage: A5 (Step control), A6 (manual/import compatibility), A10 (migration remains additive).

### Task 4: 接入 ExecutionService、结果脱敏和 curl preview

**Files:**
- Create: `backend/src/main/java/com/orchestrator/oauth/OAuthRequestAuthorizer.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/DefaultOAuthRequestAuthorizer.java`
- Create: `backend/src/main/java/com/orchestrator/oauth/RequestHeaderRedactor.java`
- Modify: `backend/src/main/java/com/orchestrator/service/ExecutionService.java`
- Test: `backend/src/test/java/com/orchestrator/oauth/OAuthRequestAuthorizerTest.java`
- Test: `backend/src/test/java/com/orchestrator/oauth/RequestHeaderRedactorTest.java`
- Test: `backend/src/test/java/com/orchestrator/ExecutionServiceOAuthTest.java`

**Interfaces:**
- `OAuthRequestAuthorizer` exposes `void apply(TestStep step, HttpHeaders headers)` for live execution and `void applyPreview(TestStep step, HttpHeaders headers)` for curl generation. Neither method processes inbound requests.
- `RequestHeaderRedactor` exposes `Map<String, String> toDisplayMap(HttpHeaders headers)` and `String redact(String headerName, String value)`; matching `Authorization` is case-insensitive.
- `DefaultOAuthRequestAuthorizer` consumes Task 2 `OAuthProperties`, `OAuthTokenProvider` and Task 3 `OAuthMode`.

- [ ] **Step 1: Write authorizer and redaction tests.**

Cover all precedence paths:

```java
@Test
void injectsBearerTokenOnlyWhenInheritedAndAuthorizationIsAbsent() {
    TestStep step = TestStep.builder().oauthMode(OAuthMode.INHERIT).build();
    HttpHeaders headers = new HttpHeaders();

    authorizer.apply(step, headers);

    assertThat(headers.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer token-1");
    verify(provider).getToken();
}

@Test
void disabledModeAndExistingAuthorizationDoNotCallProvider() {
    HttpHeaders manual = new HttpHeaders();
    manual.set(HttpHeaders.AUTHORIZATION, "Bearer manual");
    authorizer.apply(TestStep.builder().oauthMode(OAuthMode.DISABLED).build(), manual);
    authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), manual);

    assertThat(manual.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer manual");
    verifyNoInteractions(provider);
}

@Test
void redactorMasksAuthorizationInDisplayMap() {
    HttpHeaders headers = new HttpHeaders();
    headers.set("authorization", "Bearer token-1");

    assertThat(redactor.toDisplayMap(headers).get("authorization")).isEqualTo("<redacted>");
}
```

- [ ] **Step 2: Run focused authorizer tests and verify they fail.**

```bash
mvn -Dtest=OAuthRequestAuthorizerTest,RequestHeaderRedactorTest test
```

Expected: compilation failure because the authorizer and redactor do not exist.

- [ ] **Step 3: Implement live/preview authorization and redaction.**

`DefaultOAuthRequestAuthorizer.apply(...)` must return without calling the Provider when OAuth is disabled, `oauthMode=DISABLED`, or `headers` already contains `Authorization`. Otherwise call `provider.getToken()` and set `Authorization` to the Token's authorization value. `applyPreview(...)` must follow the same decision but set `Bearer <redacted>` without any network call.

In `ExecutionService`, inject the authorizer and update the private Header builder in this order:

```java
applyEnvironmentHeaders(httpHeaders, step, env, allExtractedVars, manualInputValues);
oauthRequestAuthorizer.apply(step, httpHeaders);
applyStepHeaders(httpHeaders, step, env, allExtractedVars, manualInputValues);
```

Use the live method in all `executeStep` paths, including dependency-only, scheduled and SSE execution. Use the preview method only from `generateCurl`.

After live headers are assembled, pass the actual `HttpHeaders` to `RestTemplate.exchange`, but build `requestHeadersMap` with `RequestHeaderRedactor.toDisplayMap(...)`. Use the same display map for `StepExecutionResult.requestHeaders`, request-header variable extraction, and the `RestClientException` error result. Ensure `generateCurl` runs with preview headers and never requests a real Token.

Catch `OAuthTokenException` before `executeWithRetry` and return an `ERROR` `StepExecutionResult` with response code `0`, a safe OAuth error message, empty response data, redacted/empty request headers, and no target HTTP call. Do not let Token acquisition errors escape as an unstructured 500.

- [ ] **Step 4: Add ExecutionService integration tests.**

Mock `TestStepRepository`, `TestSuiteRepository`, `EnvironmentRepository`, verification/validation services, and the target `RestTemplate`; use a real provider mock for the authorizer. Assert the target exchange receives `Bearer token-1`, manual Header wins, disabled mode skips the provider, and a provider exception produces `ERROR` without invoking the target client. Assert `generateCurl` contains `Authorization: Bearer <redacted>` and not the real Token.

Use this target-call assertion shape:

```java
verify(targetRestTemplate).exchange(
    eq(URI.create("https://api.example.test/orders")),
    eq(HttpMethod.GET),
    argThat(entity -> "Bearer token-1".equals(
        entity.getHeaders().getFirst(HttpHeaders.AUTHORIZATION))),
    eq(String.class));
```

- [ ] **Step 5: Run focused and full backend tests.**

```bash
mvn -Dtest=OAuthRequestAuthorizerTest,RequestHeaderRedactorTest,ExecutionServiceOAuthTest test
mvn test
```

Expected: automatic injection, precedence, preview, safe failure and existing execution tests pass.

- [ ] **Step 6: Commit the execution slice.**

```bash
git add backend/src/main/java/com/orchestrator/oauth/OAuthRequestAuthorizer.java \
  backend/src/main/java/com/orchestrator/oauth/DefaultOAuthRequestAuthorizer.java \
  backend/src/main/java/com/orchestrator/oauth/RequestHeaderRedactor.java \
  backend/src/main/java/com/orchestrator/service/ExecutionService.java \
  backend/src/test/java/com/orchestrator/oauth/OAuthRequestAuthorizerTest.java \
  backend/src/test/java/com/orchestrator/oauth/RequestHeaderRedactorTest.java \
  backend/src/test/java/com/orchestrator/ExecutionServiceOAuthTest.java
git commit -m "feat: inject and redact OAuth service account tokens"
```

Acceptance coverage: A1 (target Header), A4 (redaction), A5 (mode/precedence), A7 (safe failure), A8 (shared execution path), A9 (no inbound path change).

### Task 5: 在前端暴露 Step OAuth mode 并保持 suite export/duplicate

**Files:**
- Modify: `frontend/src/types/testSuite.ts`
- Modify: `frontend/src/components/StepEditor.tsx`
- Modify: `frontend/src/pages/TestSuiteDetailPage.tsx`
- Modify: `frontend/src/services/testSuiteApi.ts`

**Interfaces:**
- `OAuthModeType` is exactly `'INHERIT' | 'DISABLED'`.
- `TestStep` and `TestStepRequest` carry `oauthMode: OAuthModeType`.
- No frontend API is added for Client Secret, access token, runtime OAuth status, or target IdP login.

- [ ] **Step 1: Extend TypeScript types and add the failing build expectation.**

Add `oauthMode` to both Step interfaces and add it to `exportSuite` and the duplicate request. The initial build should fail until `StepEditor` includes the new required request property.

- [ ] **Step 2: Add the StepEditor control.**

Initialize state with `step?.oauthMode ?? 'INHERIT'`. Render a small Select next to the existing dependency/cache controls:

```tsx
<Space size={4}>
  <span style={{ color: '#8c8c8c', fontSize: 11 }}>OAuth:</span>
  <Select
    size="small"
    value={oauthMode}
    onChange={setOauthMode}
    options={[
      { label: 'Inherit deployment OAuth', value: 'INHERIT' },
      { label: 'Disable automatic OAuth', value: 'DISABLED' },
    ]}
    style={{ width: 190 }}
  />
</Space>
```

Include `oauthMode` in the `TestStepRequest` assembled by `handleSave`. Do not render a token, client ID, client secret, or Token Endpoint in the UI.

- [ ] **Step 3: Preserve mode during duplicate and export.**

In `TestSuiteDetailPage.handleDuplicateStep`, copy `oauthMode`. In `testSuiteApi.exportSuite`, include `oauthMode` in each exported step JSON. Existing imported JSON without the field remains compatible through the backend default.

- [ ] **Step 4: Run frontend verification.**

```bash
npm --prefix frontend run build
npm --prefix frontend run lint
```

Expected: TypeScript/Vite build and ESLint pass; no OAuth secret/token string is introduced into the frontend bundle or source.

- [ ] **Step 5: Commit the frontend slice.**

```bash
git add frontend/src/types/testSuite.ts \
  frontend/src/components/StepEditor.tsx \
  frontend/src/pages/TestSuiteDetailPage.tsx \
  frontend/src/services/testSuiteApi.ts
git commit -m "feat: expose OAuth mode on test steps"
```

Acceptance coverage: A5 (user-visible Step control), A6 (export/import compatibility), A8 (browser never owns target Token).

### Task 6: 更新单 Deployment 外部 Secret 契约和操作文档

**Files:**
- Modify: `k8s/base/deployment.yaml`
- Modify: `k8s/README.md`
- Modify: `README.md`
- Modify: `test-script/verify-deployment-only.sh`

**Interfaces:**
- Consumes the runtime environment variable names from Task 1.
- Produces a single Deployment with non-sensitive OAuth settings inline and `ORCHESTAPI_OAUTH_CLIENT_SECRET` from external Secret `orchestapi-oauth`, key `client-secret`.
- Does not create a Kubernetes `Secret`, ConfigMap, Service, Ingress, NetworkPolicy, or a second Deployment.

- [ ] **Step 1: Add OAuth env entries to the Deployment.**

Keep the existing four inline runtime variables and three database `secretKeyRef` entries. Add these OAuth entries to the same container:

```yaml
- name: ORCHESTAPI_OAUTH_ENABLED
  value: "false"
- name: ORCHESTAPI_OAUTH_TOKEN_ENDPOINT
  value: ""
- name: ORCHESTAPI_OAUTH_CLIENT_ID
  value: ""
- name: ORCHESTAPI_OAUTH_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: orchestapi-oauth
      key: client-secret
      optional: true
- name: ORCHESTAPI_OAUTH_SCOPES
  value: ""
- name: ORCHESTAPI_OAUTH_AUDIENCE
  value: ""
- name: ORCHESTAPI_OAUTH_CLIENT_AUTH_METHOD
  value: client_secret_basic
- name: ORCHESTAPI_OAUTH_REFRESH_SKEW_SECONDS
  value: "60"
- name: ORCHESTAPI_OAUTH_REQUEST_TIMEOUT_MS
  value: "10000"
```

The environment-owned overlay changes `ORCHESTAPI_OAUTH_ENABLED` to `"true"`, fills the endpoint/client ID/scope/audience values, and requires the external Secret to exist before rollout. No value containing a Secret or Token may be committed.

- [ ] **Step 2: Extend the deployment-only verification script.**

Require the OAuth variable names, `name: orchestapi-oauth`, and `key: client-secret`. Keep the existing checks for exactly one Deployment and forbidden resource kinds. Add a fail-closed scan for literal credential assignments and Token-looking values:

```bash
if grep -qE 'ORCHESTAPI_OAUTH_CLIENT_SECRET:[[:space:]]*[^[:space:]]|Bearer[[:space:]]+[A-Za-z0-9._~-]{20,}' <<<"$rendered"; then
  echo "deployment contains a literal OAuth credential or bearer token" >&2
  exit 1
fi
```

- [ ] **Step 3: Document the platform-owned Secret and egress prerequisites.**

In `k8s/README.md`, state that Starbucks must provision `orchestapi-oauth` with key `client-secret`, configure the non-sensitive OAuth variables in an environment-owned overlay, and allow Pod egress to the Token Endpoint DNS/TLS address. State explicitly that the checked-in overlay keeps OAuth disabled and remains an example, not an apply-ready production manifest.

In `README.md`, update the manual `AUTH_TOKEN` guidance to explain that deployment OAuth is the preferred Service Account path, manual dependency Token steps remain supported, and the browser never receives the target Token. Keep the existing `/orchestapi` and single Deployment instructions unchanged.

- [ ] **Step 4: Render and inspect the manifest.**

```bash
kubectl kustomize k8s/overlays/internal-example > /tmp/orchestapi-oauth-rendered.yaml
./test-script/verify-deployment-only.sh
```

Expected: exactly one Deployment, OAuth Secret only through `secretKeyRef`, no `kind: Secret`, no ConfigMap, no literal secret/token, and all existing probes/path/resource checks remain present.

- [ ] **Step 5: Commit the deployment/documentation slice.**

```bash
git add k8s/base/deployment.yaml k8s/README.md README.md test-script/verify-deployment-only.sh
git commit -m "docs: document OAuth secret deployment contract"
```

Acceptance coverage: A4 (external Secret/no literal), A9 (inbound deployment boundary), A10 (single Deployment and Secret reference).

### Task 7: 完成全量验证、验收回填和交付审计

**Files:**
- Modify: `docs/intent/2026-08-31-oauth-service-account-token/03-acceptance-checklist.md`
- Inspect: `docs/superpowers/specs/2026-08-31-orchestapi-oauth-service-account-token-design.md`
- Inspect: `docs/superpowers/plans/2026-08-31-orchestapi-oauth-service-account-token.md`

**Interfaces:**
- Consumes all Tasks 1–6 implementation and focused-test evidence.
- Produces an evidence-separated acceptance checklist: local focused proof, local deployment/render proof, and Starbucks live proof are recorded separately.

- [ ] **Step 1: Run the complete local verification matrix.**

```bash
cd backend && mvn test
cd ..
npm --prefix frontend run build
npm --prefix frontend run lint
./test-script/verify-deployment-only.sh
git diff --check
```

Expected: all commands exit 0. If an existing baseline failure appears, reproduce it on the pre-change commit before attributing it to OAuth.

- [ ] **Step 2: Run a local Token Endpoint integration proof.**

Start a local mock Token Endpoint that validates `grant_type=client_credentials`, configured client authentication and scope, returns a short-lived Bearer token, and records call count. Run a suite containing one `INHERIT` step twice and one `DISABLED` step. Verify one Token request before refresh, a new request after refresh, correct target Header, no Token in streamed result/curl, and no request to the Token Endpoint for the disabled step.

- [ ] **Step 3: Scan repository artifacts for secret leakage.**

```bash
rg -n --glob '!backend/target/**' --glob '!frontend/node_modules/**' \
  'client-secret-value|access_token[^\n]*token-|Bearer[[:space:]]+[A-Za-z0-9._~-]{20,}' \
  backend frontend k8s docs README.md
```

Expected: no real credential or Token value. Placeholder names in tests and documentation must remain non-sensitive and clearly synthetic.

- [ ] **Step 4: Update the acceptance checklist with evidence boundaries.**

For A1–A7, record focused/unit/integration test names and command outputs. For A8–A10, record local regression/render evidence and explicitly mark Starbucks Token Endpoint connectivity, external Secret mounting, database, Ingress, allowlist and NetworkPolicy as live evidence still required until the platform runs them.

- [ ] **Step 5: Perform final contract review.**

Check that no task introduced Spring Security, inbound auth, Admin API access, per-Environment credential storage, automatic `401` replay, or a second Kubernetes resource. Confirm `oauthMode` is serialized in create/update/import/export/duplicate paths and that all actual request Header maps are redacted before any result or extraction leaves the backend.

- [ ] **Step 6: Commit the evidence audit.**

```bash
git add docs/intent/2026-08-31-oauth-service-account-token/03-acceptance-checklist.md
git commit -m "test: record OAuth service account token acceptance evidence"
```

Acceptance coverage: A1–A10, with local and live evidence kept separate.

## Execution Order and Review Gates

1. Execute Tasks 1–2 and review the Token Provider contract/cache behavior before touching execution orchestration.
2. Execute Task 3 and review the public Step DTO/database contract before frontend changes.
3. Execute Task 4 and verify actual-vs-display Header separation before enabling any Deployment OAuth variable.
4. Execute Tasks 5–6 after backend behavior is stable; frontend and deployment changes must not introduce credentials.
5. Execute Task 7 only after all focused tests pass; do not claim Starbucks production readiness from local tests or Kustomize rendering alone.
