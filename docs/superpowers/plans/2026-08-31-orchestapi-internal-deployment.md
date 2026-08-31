# OrchestAPI Internal Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, single-image Kubernetes deployment template for restricted Starbucks internal access under `/orchestapi`, without changing application authentication or business APIs.

**Architecture:** Keep one runtime image and one Kubernetes Deployment, but move build ownership to the host/CI: Vite assets are built with `VITE_BASE_PATH=/orchestapi/`, Maven copies `frontend/dist` into the Spring Boot JAR, and Docker only packages that JAR into a Starbucks internal Java runtime image. Kubernetes runs one non-root backend Pod with `CONTEXT_PATH=/orchestapi`, non-sensitive runtime variables inline in the Deployment, and external PostgreSQL credentials injected only from a pre-created Secret. The Starbucks platform owns the Service, Ingress/Gateway, NetworkPolicy, Namespace, and image-pull permissions that expose the Pod.

**Tech Stack:** Java 21, Spring Boot 3.3, Vite/React, local Maven packaging, runtime-only Docker packaging, Kubernetes `apps/v1`, `networking.k8s.io/v1`, Kustomize via `kubectl kustomize`.

**Spec:** `docs/superpowers/specs/2026-08-31-orchestapi-internal-deployment-design.md`

## Global Constraints

- Preserve one image and one Kubernetes Deployment; do not split frontend and backend.
- Do not add Keycloak, Redis, application authentication, API/DTO changes, or a database migration.
- Build with Java 21; the local default Java 25 does not run Lombok annotation processing correctly for this project.
- Production backend `replicas` is exactly `1` because SSE, webhook listeners, run registry, and scheduling are process-local.
- Public paths are `/orchestapi/**`, `/orchestapi/api/**`, `/orchestapi/mock/**`, and `/orchestapi/webhook/**`; the platform Service/Ingress/Gateway must not rewrite paths.
- No environment-specific host, CIDR, namespace, database value, TLS secret, username, password, token, or Kubernetes `Secret` manifest is committed. The image registry/base-image defaults are the Starbucks paths verified from the related internal projects and remain overrideable by the platform owner.
- The internal example overlay deliberately uses an example namespace, registry tag, and no platform routing resources; it is renderable but not deployable until a Starbucks platform owner supplies the Deployment image/namespace and external resources.
- Preserve local `docker-compose.yml` as the development workflow; it consumes the image produced by `deploy.sh` rather than rebuilding Node/Maven inside Docker.
- Do not claim real-cluster rollout, allowlist enforcement, or PostgreSQL connectivity without a live platform verification.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `Dockerfile` | Package a locally built executable JAR into the Starbucks internal Java runtime image and attach immutable OCI version/revision labels. |
| `deploy.sh` | Build frontend and backend locally, validate the JAR contents, optionally package/push the runtime image, and optionally print/apply the Kubernetes image update. |
| `backend/pom.xml` | Provide the `frontend-static` profile that copies a supplied Vite `dist` directory into the JAR resources during Maven packaging. |
| `.dockerignore` | Keep Docker context limited to the locally produced JAR and runtime packaging inputs. |
| `backend/src/main/resources/application-prod.yml` | Hide actuator dependency details in the `prod` profile. |
| `backend/src/test/resources/application-test.yml` | Create the H2 `orchestrator` schema before Hibernate starts so the existing test profile is valid. |
| `backend/src/test/java/com/orchestrator/ProductionDeploymentConfigurationTest.java` | Prove the production health endpoint works through `/orchestapi` and has no dependency details. |
| `k8s/base/deployment.yaml` | Reusable single-replica Deployment with inline non-sensitive env and external database Secret references. |
| `k8s/base/kustomization.yaml` | Kustomize base that renders only `deployment.yaml`. |
| `k8s/overlays/internal-example/kustomization.yaml` | Renderable Deployment-only Starbucks adaptation point for image and namespace. |
| `k8s/README.md` | Safe build, secret creation, render, deploy, rollback, and live verification runbook. |
| `README.md` | Link the project-level deployment section to the internal Kubernetes runbook. |

### Task 1: Production runtime contract and focused proof

**Files:**

- Modify: `Dockerfile`
- Create: `backend/src/main/resources/application-prod.yml`
- Modify: `backend/src/test/resources/application-test.yml`
- Create: `backend/src/test/java/com/orchestrator/ProductionDeploymentConfigurationTest.java`

**Interfaces:**

- Consumes: existing `CONTEXT_PATH` mapping in `backend/src/main/resources/application.yml`, existing `/actuator/health` endpoint, and Docker build argument `VITE_BASE_PATH`.
- Produces: the `prod` Spring profile, the immutable OCI labels `org.opencontainers.image.version` and `org.opencontainers.image.revision`, and a focused regression test for `/orchestapi/actuator/health`.

- [ ] **Step 1: Write the failing production-profile endpoint test.**

Create `ProductionDeploymentConfigurationTest` with the exact Spring test configuration and assertions below. It reuses the existing H2 test profile and adds `prod` only for the production actuator policy.

```java
@SpringBootTest(properties = {
        "server.servlet.context-path=/orchestapi",
        "spring.datasource.url=jdbc:h2:mem:proddeployment;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator"
})
@AutoConfigureMockMvc
@ActiveProfiles({"test", "prod"})
class ProductionDeploymentConfigurationTest {
    @Autowired private MockMvc mockMvc;

    @Test
    void healthIsAvailableThroughDeploymentPrefixWithoutDependencyDetails() throws Exception {
        mockMvc.perform(get("/orchestapi/actuator/health").contextPath("/orchestapi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }
}
```

- [ ] **Step 2: Run the focused test to verify the current test database precondition fails.**

Run from `backend/` with Java 21:

```bash
task_java_home=$(/usr/libexec/java_home -v 21)
JAVA_HOME="$task_java_home" PATH="$task_java_home/bin:$PATH" mvn -Dtest=ProductionDeploymentConfigurationTest test
```

Expected: the context starts using the test-local schema initializer, then the assertion fails because the production profile does not yet exist and health details still contain `components`.

- [ ] **Step 3: Make the minimal runtime and test-profile changes.**

Add `backend/src/main/resources/application-prod.yml`:

```yaml
management:
  endpoint:
    health:
      show-details: never
```

Change only the H2 URL in `backend/src/test/resources/application-test.yml` to:

```yaml
url: jdbc:h2:mem:testdb;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator
```

In the final `runtime` stage of `Dockerfile`, add immutable build metadata without changing the entrypoint or image layout:

```dockerfile
ARG APP_VERSION=dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="OrchestAPI" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"
```

- [ ] **Step 4: Run focused and existing backend tests under Java 21.**

```bash
task_java_home=$(/usr/libexec/java_home -v 21)
JAVA_HOME="$task_java_home" PATH="$task_java_home/bin:$PATH" mvn -Dtest=ProductionDeploymentConfigurationTest,ApiTestOrchestratorApplicationTests test
```

Expected: all three test methods pass. If a failure remains, preserve its full output and do not broaden the change beyond the test profile or production actuator policy without a new scope decision.

- [ ] **Step 5: Commit the focused runtime change.**

```bash
git add Dockerfile backend/src/main/resources/application-prod.yml \
  backend/src/test/resources/application-test.yml \
  backend/src/test/java/com/orchestrator/ProductionDeploymentConfigurationTest.java
git commit -m "chore: harden production deployment runtime"
```

### Task 2: Kubernetes Deployment-only base and overlay

> **Current contract (2026-08-31):** This task is Deployment-only. The earlier five-resource draft was superseded by the user's confirmation of “单 Deployment + 外部 Secret 引用”; do not recreate the old ConfigMap, Service, Ingress, or NetworkPolicy manifests.

**Files:**

- Modify: `k8s/base/kustomization.yaml`
- Modify: `k8s/base/deployment.yaml`
- Modify: `k8s/overlays/internal-example/kustomization.yaml`
- Delete: unused ConfigMap, Service, Ingress, and NetworkPolicy templates

**Interfaces:**

- Consumes: image `orchestapi:dev`, port `8080`, `CONTEXT_PATH=/orchestapi`, existing environment variables `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD`, and a pre-created Secret named `orchestapi-db`.
- Produces: one `orchestapi` Deployment and a Kustomize overlay that emits the one-replica runtime contract; the external Secret and platform routing resources remain outside this repository.

- [x] **Step 1: Render the confirmed Deployment-only target.**

```bash
kubectl kustomize k8s/overlays/internal-example
```

Expected: exactly one `apps/v1 Deployment/orchestapi` is rendered.

- [x] **Step 2: Keep the base to one Deployment and inline non-sensitive variables.**

`k8s/base/kustomization.yaml` references only `deployment.yaml`. The Deployment uses `replicas: 1`, image `orchestapi:dev`, inline `SPRING_PROFILES_ACTIVE=prod`, `SERVER_PORT=8080`, `CONTEXT_PATH=/orchestapi`, and `JAVA_OPTS=-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0`. It contains three `valueFrom.secretKeyRef` entries for keys `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` from the external Secret `orchestapi-db`. It keeps the rolling update strategy, port `8080`, probes at `/orchestapi/actuator/health`, non-root security context, and resource requests/limits.

- [x] **Step 3: Keep the internal example overlay as a Deployment adaptation point.**

The overlay sets `namespace: orchestapi-internal`, includes `../../base`, and uses Kustomize `images` to turn `orchestapi` into `registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi:replace-me`. Replace the example namespace, registry, and tag before deployment; all platform routing, namespace, network, and Secret resources are managed outside this repository.

- [x] **Step 4: Render and assert the deployment contract.**

```bash
kubectl kustomize k8s/overlays/internal-example > /tmp/orchestapi-internal.yaml
rg -n '^kind: Deployment$' /tmp/orchestapi-internal.yaml
rg -n 'replicas: 1|CONTEXT_PATH|/orchestapi/actuator/health|secretKeyRef|orchestapi-db' /tmp/orchestapi-internal.yaml
if rg -n '^kind: (ConfigMap|Service|Ingress|NetworkPolicy|Secret)$' /tmp/orchestapi-internal.yaml; then exit 1; fi
```

Expected: exactly one Deployment appears, its inline runtime variables and external Secret references are present, and no platform resource or Secret manifest exists. The focused repository check is `./test-script/verify-deployment-only.sh`.

### Task 3: Build, release, rollback, and operator documentation

**Files:**

- Create: `k8s/README.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 1’s `APP_VERSION`, `VCS_REF`, `VITE_BASE_PATH`, and `CONTEXT_PATH` contract plus Task 2’s `orchestapi-db` Secret and `internal-example` overlay.
- Produces: safe build, Secret creation, rendering, deployment, rollout, rollback, and smoke-verification commands that do not embed an environment secret.

- [x] **Step 1: Write the non-deployable overlay guard into the runbook.**

At the start of `k8s/README.md`, state that `internal-example` uses `orchestapi-internal` and a `replace-me` tag; its registry path is a Starbucks staging example that must be confirmed or overridden. The overlay must be copied to an environment-owned overlay and edited before `kubectl apply -k`.

- [ ] **Step 2: Document exact image and Secret workflows.**

Include these command forms, retaining only environment variables or a local ignored file for credentials:

```bash
./deploy.sh "$IMAGE_TAG" --skip-install --push

kubectl -n "$DEPLOY_NAMESPACE" create secret generic orchestapi-db \
  --from-env-file="$SECRET_ENV_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Document that `SECRET_ENV_FILE` has exactly `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD`; it remains outside Git. Do not use `kubectl create secret ... --from-literal` in documentation because it encourages shell history leaks.

- [ ] **Step 3: Document render, deployment, rollback, and evidence boundaries.**

Include these commands with an environment-owned overlay path:

```bash
kubectl kustomize "$OVERLAY_DIR" > /tmp/orchestapi-rendered.yaml
kubectl apply -k "$OVERLAY_DIR"
kubectl -n "$DEPLOY_NAMESPACE" rollout status deployment/orchestapi --timeout=5m
kubectl -n "$DEPLOY_NAMESPACE" rollout undo deployment/orchestapi
```

List live acceptance probes: the prefixed UI, `/orchestapi/actuator/health`, a REST request, an SSE suite run, a Mock request, a Webhook request, and a source address outside the allowlist returning denial. State explicitly that repository checks do not prove any live item.

- [ ] **Step 4: Link the runbook from the project README.**

Add one concise `### Starbucks 内部 Kubernetes` subsection after the existing Context Path section. It must link to `k8s/README.md`, state that the repository applies a single Deployment while platform routing resources expose `/orchestapi`, and state that the included overlay is an example rather than an apply-ready production configuration.

- [ ] **Step 5: Verify documentation safety and commit it.**

```bash
rg -n --glob '*.md' 'DB_PASSWORD=|DB_URL=jdbc:postgresql://[0-9]|token=|secret=' \
  k8s docs/intent/2026-08-31-internal-deployment
git add README.md k8s/README.md
git commit -m "docs: document internal Kubernetes deployment"
```

Expected: the deployment-specific documents contain no credential-looking values. Existing local-development placeholders in the root README (for example, `your_password`) are outside this deployment scan and must not be copied into the internal overlay.

### Task 4: Integrated local verification and final evidence

**Files:**

- Modify: `docs/intent/2026-08-31-internal-deployment/03-acceptance-checklist.md`
- Create: `docs/intent/2026-08-31-internal-deployment/99-completion-audit.md`

**Interfaces:**

- Consumes: all runtime, manifest, and runbook outputs from Tasks 1–3.
- Produces: evidence-backed acceptance status that distinguishes local/repository proof from unperformed Starbucks cluster proof.

- [ ] **Step 1: Run all relevant local verification under Java 21.**

```bash
task_java_home=$(/usr/libexec/java_home -v 21)
JAVA_HOME="$task_java_home" PATH="$task_java_home/bin:$PATH" mvn test -f backend/pom.xml
npm --prefix frontend run lint
VITE_BASE_PATH=/orchestapi/ npm --prefix frontend run build
kubectl kustomize k8s/overlays/internal-example > /tmp/orchestapi-internal.yaml
./deploy.sh verification --skip-install --platform linux/amd64
docker inspect registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi:verification --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{.Config.User}}'
```

Expected: backend tests pass on Java 21, the required-prefix frontend build passes, Kustomize renders one Deployment, the local Maven/JAR plus runtime-only Docker build passes, and inspect returns `verification 185`. Existing frontend lint findings remain baseline evidence unless frontend source is changed.

- [ ] **Step 2: Perform a local container health smoke only with a disposable PostgreSQL endpoint.**

Use the existing `docker-compose.yml` database or an explicitly created disposable database, run the image with `CONTEXT_PATH=/orchestapi`, wait for its health endpoint, then execute:

```bash
curl --fail --silent --show-error http://localhost:8080/orchestapi/actuator/health
```

Expected: a `UP` health response without a `components` object. Do not use any Starbucks database value for this local smoke.

- [ ] **Step 3: Record evidence per acceptance item.**

Mark A1–A8 in `03-acceptance-checklist.md` with the exact successful command/result. In `99-completion-audit.md`, list source/build/manifest/local-container evidence as completed and leave live PostgreSQL, platform Service/Ingress/Gateway, NetworkPolicy, TLS, rollout, Mock/Webhook/SSE real traffic, and rollback as unverified platform gates.

- [ ] **Step 4: Inspect the complete diff before the final commit.**

```bash
git diff --check HEAD~3..HEAD
git status --short
git log --oneline -4
```

Expected: no whitespace errors, only deployment-scope files changed, and the worktree is clean except for the two updated intent-audit files.

- [ ] **Step 5: Commit completion evidence.**

```bash
git add -f docs/intent/2026-08-31-internal-deployment/03-acceptance-checklist.md \
  docs/intent/2026-08-31-internal-deployment/99-completion-audit.md
git commit -m "docs: record internal deployment verification"
```

## 2026-08-31 Deployment-only amendment

用户确认将 Kubernetes 资源边界收敛为“单 Deployment + 外部 Secret 引用”。当前实现以 `k8s/base/deployment.yaml` 为唯一资源：四个原 ConfigMap 变量直接位于 `env`，`DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 仍使用 `secretKeyRef` 指向外部 `orchestapi-db`。`k8s/base/kustomization.yaml` 与 `k8s/overlays/internal-example/kustomization.yaml` 均只渲染这个 Deployment；相关无引用的 ConfigMap、Service、Ingress 和 NetworkPolicy 模板已删除。

Starbucks 平台必须在 Deployment 之外提供并配置：目标 Namespace、选择 `app.kubernetes.io/name: orchestapi` 且端口为 8080 的 Service、无 rewrite 的 `/orchestapi` Ingress/Gateway、内部 TLS/DNS/allowlist、NetworkPolicy、镜像拉取权限，以及外部 `orchestapi-db` Secret。平台入口仍需保留 `/orchestapi/`、`/orchestapi/api/**`、`/orchestapi/mock/**` 和 `/orchestapi/webhook/**` 路径契约。

当前验证命令：

```bash
./test-script/verify-deployment-only.sh
kubectl kustomize k8s/overlays/internal-example
```

预期结果是恰好一个 `Deployment`，无 ConfigMap、Service、Ingress、NetworkPolicy 或 Secret 清单，并且 Deployment 内含四个非敏感环境变量和三个外部 Secret 引用。

## Plan self-review

- Spec coverage: A1 is implemented by Task 1 image labels/build verification; A2 by the Deployment path contract plus the platform-owned Service/Ingress/Gateway; A3 by the Deployment Secret references and external PostgreSQL configuration; A4 by the Deployment-only Secret-free manifest/runbook checks; A5 by the platform-owned internal routing and NetworkPolicy instructions; A6 by Task 1 production health policy and probes; A7 by Task 2 `replicas: 1`; A8 by Tasks 2–4 rendering, runbook, and evidence audit. Task 4 explicitly retains required live gates.
- Scope: no task introduces authentication, a second service/image, distributed state, a schema migration, or a real infrastructure value.
- Contract consistency: the current amendment uses one image, one Deployment, `CONTEXT_PATH=/orchestapi`, `VITE_BASE_PATH=/orchestapi/`, external `orchestapi-db`, and `replicas: 1`; platform routing is explicitly outside the repository.
- Safety: the only Secret interaction is an external `--from-env-file` reference; no YAML `kind: Secret` or literal secret is created.
