# OrchestAPI Internal Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, single-image Kubernetes deployment template for restricted Starbucks internal access under `/orchestapi`, without changing application authentication or business APIs.

**Architecture:** Keep the existing multi-stage root Dockerfile: Vite assets are built with `VITE_BASE_PATH=/orchestapi/` and copied into the Spring Boot JAR. Kubernetes runs one non-root backend Pod with `CONTEXT_PATH=/orchestapi`, external PostgreSQL credentials injected only from a pre-created Secret, and a no-rewrite Ingress mapping the same prefix to the single Service. The base Kustomize target is safe-by-default; the internal example overlay uses non-routable example networking values until the platform owner substitutes its approved ones.

**Tech Stack:** Java 21, Spring Boot 3.3, Vite/React, Docker multi-stage builds, Kubernetes `apps/v1`, `networking.k8s.io/v1`, Kustomize via `kubectl kustomize`.

**Spec:** `docs/superpowers/specs/2026-08-31-orchestapi-internal-deployment-design.md`

## Global Constraints

- Preserve one image and one Kubernetes Service; do not split frontend and backend.
- Do not add Keycloak, Redis, application authentication, API/DTO changes, or a database migration.
- Build with Java 21; the local default Java 25 does not run Lombok annotation processing correctly for this project.
- Production backend `replicas` is exactly `1` because SSE, webhook listeners, run registry, and scheduling are process-local.
- Public paths are `/orchestapi/**`, `/orchestapi/api/**`, `/orchestapi/mock/**`, and `/orchestapi/webhook/**`; Ingress does not rewrite paths.
- No actual host, CIDR, namespace, registry address, database value, TLS secret, username, password, token, or Kubernetes `Secret` manifest is committed.
- The internal example overlay deliberately uses `.invalid` names and `192.0.2.0/32`; it is renderable but not deployable until a Starbucks platform owner supplies approved values.
- Preserve local `docker-compose.yml` as the development workflow.
- Do not claim real-cluster rollout, allowlist enforcement, or PostgreSQL connectivity without a live platform verification.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `Dockerfile` | Preserve the existing one-image build and attach immutable OCI version/revision labels. |
| `backend/src/main/resources/application-prod.yml` | Hide actuator dependency details in the `prod` profile. |
| `backend/src/test/resources/application-test.yml` | Create the H2 `orchestrator` schema before Hibernate starts so the existing test profile is valid. |
| `backend/src/test/java/com/orchestrator/ProductionDeploymentConfigurationTest.java` | Prove the production health endpoint works through `/orchestapi` and has no dependency details. |
| `k8s/base/*.yaml` | Complete, reusable ConfigMap, Deployment, Service, Ingress, and default-deny NetworkPolicy. |
| `k8s/overlays/internal-example/*` | Renderable, deny-by-default Starbucks adaptation point for image, namespace, Ingress, CIDR, and NetworkPolicy selectors. |
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

### Task 2: Kubernetes base and restricted internal overlay

**Files:**

- Create: `k8s/base/kustomization.yaml`
- Create: `k8s/base/configmap.yaml`
- Create: `k8s/base/deployment.yaml`
- Create: `k8s/base/service.yaml`
- Create: `k8s/base/ingress.yaml`
- Create: `k8s/base/network-policy.yaml`
- Create: `k8s/overlays/internal-example/kustomization.yaml`
- Create: `k8s/overlays/internal-example/ingress-private.yaml`
- Create: `k8s/overlays/internal-example/network-policy-allow-ingress.yaml`

**Interfaces:**

- Consumes: image `orchestapi:dev`, port `8080`, `CONTEXT_PATH=/orchestapi`, existing environment variables `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD`, and a pre-created Secret named `orchestapi-db`.
- Produces: `orchestapi` Deployment/Service/Ingress/NetworkPolicy resources and a Kustomize overlay that emits the exact same path and one-replica runtime contract.

- [ ] **Step 1: Prove the Kustomize target does not exist yet.**

```bash
kubectl kustomize k8s/overlays/internal-example
```

Expected: failure because `k8s/overlays/internal-example/kustomization.yaml` is absent.

- [ ] **Step 2: Create the base Kustomize resources.**

Use this resource list in `k8s/base/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - configmap.yaml
  - deployment.yaml
  - service.yaml
  - ingress.yaml
  - network-policy.yaml
```

`configmap.yaml` must set only these non-sensitive values:

```yaml
data:
  SPRING_PROFILES_ACTIVE: prod
  SERVER_PORT: "8080"
  CONTEXT_PATH: /orchestapi
  JAVA_OPTS: -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0
```

`deployment.yaml` must use `replicas: 1`, `image: orchestapi:dev`, `envFrom.configMapRef.name: orchestapi-config`, and three `valueFrom.secretKeyRef` entries for keys `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` from Secret `orchestapi-db`. Set `strategy.rollingUpdate.maxUnavailable: 0`, use port `8080`, and configure all three probes to request `/orchestapi/actuator/health`. Use `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, `seccompProfile.type: RuntimeDefault`, requests `cpu: 250m`/`memory: 512Mi`, and limits `cpu: "1"`/`memory: 1Gi`.

`service.yaml` must expose only a `ClusterIP` Service named `orchestapi`, port `8080`, targeting the same labeled pods.

`ingress.yaml` must be a generic no-rewrite `networking.k8s.io/v1` Ingress. Its only path is `/orchestapi` with `pathType: Prefix`, Service `orchestapi`, and port `8080`. Use host `orchestapi.invalid` in base so applying base alone cannot claim a real corporate hostname.

`network-policy.yaml` must select only the `app.kubernetes.io/name: orchestapi` pods, set `policyTypes: [Ingress]`, and have `ingress: []`. This ensures the base is deny-by-default rather than accidentally allowing all namespaces.

- [ ] **Step 3: Create the restricted internal example overlay.**

Set `namespace: orchestapi-internal` in the overlay `kustomization.yaml`, include `../../base`, and use Kustomize `images` to turn `orchestapi` into `registry.internal.invalid/orchestapi:replace-me`.

Patch the Ingress with the following deliberate non-production values and SSE-safe Nginx annotations:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/whitelist-source-range: 192.0.2.0/32
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: internal-nginx
  tls:
    - hosts: [orchestapi.internal.invalid]
      secretName: orchestapi-tls
  rules:
    - host: orchestapi.internal.invalid
      http:
        paths:
          - path: /orchestapi
            pathType: Prefix
            backend:
              service:
                name: orchestapi
                port:
                  number: 8080
```

Patch the base NetworkPolicy ingress list to allow TCP/8080 only from namespaces carrying `kubernetes.io/metadata.name: ingress-nginx`. The runbook must require a platform owner to replace this selector when its controller namespace differs.

- [ ] **Step 4: Render and assert the deployment contract.**

```bash
kubectl kustomize k8s/overlays/internal-example > /tmp/orchestapi-internal.yaml
rg -n '^kind: (ConfigMap|Deployment|Service|Ingress|NetworkPolicy)$' /tmp/orchestapi-internal.yaml
rg -n 'replicas: 1|CONTEXT_PATH: /orchestapi|path: /orchestapi|/orchestapi/actuator/health|secretKeyRef|whitelist-source-range' /tmp/orchestapi-internal.yaml
if rg -n '^kind: Secret$' k8s; then exit 1; fi
```

Expected: exactly five Kubernetes kinds appear, the rendered Deployment remains single replica and Secret-referenced, the unified prefix appears in Ingress/probes/config, and no Secret manifest exists.

- [ ] **Step 5: Commit the Kubernetes resources.**

```bash
git add k8s/base k8s/overlays/internal-example
git commit -m "chore: add internal Kubernetes deployment manifests"
```

### Task 3: Build, release, rollback, and operator documentation

**Files:**

- Create: `k8s/README.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 1’s `APP_VERSION`, `VCS_REF`, `VITE_BASE_PATH`, and `CONTEXT_PATH` contract plus Task 2’s `orchestapi-db` Secret and `internal-example` overlay.
- Produces: safe build, Secret creation, rendering, deployment, rollout, rollback, and smoke-verification commands that do not embed an environment secret.

- [ ] **Step 1: Write the non-deployable overlay guard into the runbook.**

At the start of `k8s/README.md`, state that `internal-example` uses `.invalid` endpoints, `192.0.2.0/32`, `orchestapi-internal`, and `registry.internal.invalid`; it must be copied to an environment-owned overlay and edited before `kubectl apply -k`.

- [ ] **Step 2: Document exact image and Secret workflows.**

Include these command forms, retaining only environment variables or a local ignored file for credentials:

```bash
docker build \
  --build-arg VITE_BASE_PATH=/orchestapi/ \
  --build-arg APP_VERSION="$IMAGE_TAG" \
  --build-arg VCS_REF="$(git rev-parse --verify HEAD)" \
  --tag "$IMAGE_REPOSITORY:$IMAGE_TAG" .

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

Add one concise `### Starbucks 内部 Kubernetes` subsection after the existing Context Path section. It must link to `k8s/README.md`, state that the release is a single image/service under `/orchestapi`, and state that the included overlay is an example rather than an apply-ready production configuration.

- [ ] **Step 5: Verify documentation safety and commit it.**

```bash
rg -n --glob '*.md' 'DB_PASSWORD=|DB_URL=jdbc:postgresql://[0-9]|token=|secret=' README.md k8s docs/intent/2026-08-31-internal-deployment docs/superpowers
git add README.md k8s/README.md
git commit -m "docs: document internal Kubernetes deployment"
```

Expected: the search exits with no matches. If it reports a credential-looking value, remove it before staging.

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
docker build --build-arg VITE_BASE_PATH=/orchestapi/ --build-arg APP_VERSION=verification --build-arg VCS_REF="$(git rev-parse --verify HEAD)" --tag orchestapi:verification .
docker inspect orchestapi:verification --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{.Config.User}}'
```

Expected: backend tests pass on Java 21, lint/build pass with the required prefix, Kustomize renders, Docker builds, and inspect returns `verification orchestapi`.

- [ ] **Step 2: Perform a local container health smoke only with a disposable PostgreSQL endpoint.**

Use the existing `docker-compose.yml` database or an explicitly created disposable database, run the image with `CONTEXT_PATH=/orchestapi`, wait for its health endpoint, then execute:

```bash
curl --fail --silent --show-error http://localhost:8080/orchestapi/actuator/health
```

Expected: a `UP` health response without a `components` object. Do not use any Starbucks database value for this local smoke.

- [ ] **Step 3: Record evidence per acceptance item.**

Mark A1–A8 in `03-acceptance-checklist.md` with the exact successful command/result. In `99-completion-audit.md`, list source/build/manifest/local-container evidence as completed and leave live PostgreSQL, Ingress allowlist, NetworkPolicy controller selector, TLS, rollout, Mock/Webhook/SSE real traffic, and rollback as unverified platform gates.

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

## Plan self-review

- Spec coverage: A1 is implemented by Task 1 image labels/build verification; A2 by Task 1 prefix health proof and Task 2 no-rewrite Ingress; A3 by Task 2 Secret references and external PostgreSQL configuration; A4 by Tasks 2–3 Secret-free manifest/runbook checks; A5 by Task 2 Ingress/NetworkPolicy and Task 3 platform allowlist instructions; A6 by Task 1 production health policy and probes; A7 by Task 2 `replicas: 1`; A8 by Tasks 2–4 rendering, runbook, and evidence audit. Task 4 explicitly retains required live gates.
- Scope: no task introduces authentication, a second service/image, distributed state, a schema migration, or a real infrastructure value.
- Contract consistency: every task uses one image, `CONTEXT_PATH=/orchestapi`, `VITE_BASE_PATH=/orchestapi/`, a single `orchestapi` Service, and `replicas: 1`.
- Safety: the only Secret interaction is an external `--from-env-file` reference; no YAML `kind: Secret` or literal secret is created.
