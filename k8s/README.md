# Starbucks 内部 Kubernetes 部署

本目录现在只渲染一个 `apps/v1 Deployment`：应用以单副本运行，配置中的非敏感变量直接写在 Deployment，数据库凭据只通过外部预创建的 `orchestapi-db` Secret 引用。

`k8s/overlays/internal-example` 不能直接部署。它只用于把镜像、Namespace 和资源名称参数化；其中的 `orchestapi-internal`、`replace-me` tag 以及内部仓库示例都必须替换为平台批准的值。

## 清单边界

执行：

```bash
kubectl kustomize k8s/overlays/internal-example
```

预期只输出一个 `Deployment/orchestapi`，不会输出 ConfigMap、Service、Ingress、NetworkPolicy 或 Secret。

Deployment 内嵌的非敏感环境变量为：

```text
SPRING_PROFILES_ACTIVE=prod
SERVER_PORT=8080
CONTEXT_PATH=/orchestapi
JAVA_OPTS=-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0
```

OAuth Service Account 配置也通过 Deployment 环境变量传入。示例 base 默认关闭
OAuth，且只保留外部 Secret 引用；平台管理的 overlay 在上线前必须把
`ORCHESTAPI_OAUTH_ENABLED` 改为 `true`，填写批准的 Token Endpoint、Client ID、
scope/audience 等非敏感值，并要求外部 Secret `orchestapi-oauth` 存在且包含
`client-secret` key：

```text
ORCHESTAPI_OAUTH_ENABLED=false
ORCHESTAPI_OAUTH_TOKEN_ENDPOINT=
ORCHESTAPI_OAUTH_CLIENT_ID=
ORCHESTAPI_OAUTH_CLIENT_SECRET=<来自外部 Secret orchestapi-oauth/client-secret>
ORCHESTAPI_OAUTH_SCOPES=
ORCHESTAPI_OAUTH_AUDIENCE=
ORCHESTAPI_OAUTH_CLIENT_AUTH_METHOD=client_secret_basic
ORCHESTAPI_OAUTH_REFRESH_SKEW_SECONDS=60
ORCHESTAPI_OAUTH_REQUEST_TIMEOUT_MS=10000
```

这是出站服务调用能力，不会创建 IdP/Keycloak Client 或修改应用入站认证。
OAuth Client 由 Starbucks/IdP 预先创建，Pod 使用 `client_credentials` 获取并在
进程内缓存短期 Bearer Token。平台还需允许 Pod 到 Token Endpoint 的 DNS、TLS
和 egress；Token Endpoint 不应通过浏览器访问。

数据库环境变量仍从外部 Secret `orchestapi-db` 读取：`DB_URL`、`DB_USERNAME`、`DB_PASSWORD`。仓库不会创建或保存 Secret。

## Starbucks 平台需要另外提供

因为本仓库不再创建 Service、Ingress 和 NetworkPolicy，平台侧需要提供：

- 一个选择标签 `app.kubernetes.io/name: orchestapi`、目标端口 `8080` 的 Service；
- 内部 Ingress/Gateway，将 `/orchestapi` 原样转发到该 Service，不做 rewrite，并配置 TLS、内网 DNS、allowlist 和 SSE 长连接超时；
- 对应的 NetworkPolicy/网络边界，仅允许批准的内网来源访问；
- 目标 Namespace（Kustomize 不会创建 Namespace）；
- 私有镜像仓库的节点拉取权限或 `imagePullSecret`；
- 可从该 Namespace 访问的外部 PostgreSQL。

Service/Ingress 必须保持以下路径契约：

```text
/orchestapi
/orchestapi/
/orchestapi/api/**
/orchestapi/mock/**
/orchestapi/webhook/**
```

无尾斜杠的 `/orchestapi` 必须单独转发到应用（与 agent-session nginx
`location = /agents` 同理）。只配 `location /orchestapi/` 时，浏览器访问
`/orchestapi` 不会命中。应用侧启用 `server.tomcat.use-relative-redirects=true`，
将 `/orchestapi` 相对重定向到 `/orchestapi/`，避免 Kong 把 Location 改成错误的
host/scheme。

首版保持 `replicas: 1`。SSE、Webhook 监听器、运行注册表和调度状态目前都在进程内，不能直接横向扩容。

## 发布前准备

先复制示例 Kustomize overlay 到平台管理的私有部署仓库或受控目录，并替换：

```yaml
namespace: <approved-namespace>
images:
  - name: orchestapi
    newName: <approved-registry>/orchestapi
    newTag: <immutable-tag>
```

确认镜像已推送并可被集群拉取。例如：

```bash
IMAGE=registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi:3c7941c
docker login registry-stg.vestack.sbuxcf.net
docker push "$IMAGE"
```

如果平台使用其他仓库，必须同时替换 overlay 中的 `newName`。

创建外部数据库 Secret（文件不要提交 Git）：

```bash
kubectl -n "$DEPLOY_NAMESPACE" create secret generic orchestapi-db \
  --from-env-file="$SECRET_ENV_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`SECRET_ENV_FILE` 仅包含 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`。首次启动会执行 Flyway migration，数据库账号需要具备相应 schema/table DDL 权限。

创建外部 OAuth Secret（文件不要提交 Git；Secret 名称和 key 必须与 Deployment
引用一致）：

```bash
kubectl -n "$DEPLOY_NAMESPACE" create secret generic orchestapi-oauth \
  --from-literal=client-secret="$OAUTH_CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```

开启 OAuth 前先确认该 Secret 已存在，并在平台 overlay 中填入非敏感配置。仓库
不会创建或保存 OAuth Secret，也不会在清单中写入 Client Secret 或 Access Token。

## 渲染、发布与回滚

```bash
kubectl config current-context
kubectl get namespace "$DEPLOY_NAMESPACE"

kubectl kustomize "$OVERLAY_DIR" > /tmp/orchestapi-rendered.yaml
kubectl diff -k "$OVERLAY_DIR"
kubectl apply -k "$OVERLAY_DIR"
kubectl -n "$DEPLOY_NAMESPACE" rollout status deployment/orchestapi --timeout=5m
```

检查 Pod 状态和日志：

```bash
kubectl -n "$DEPLOY_NAMESPACE" get pods -l app.kubernetes.io/name=orchestapi
kubectl -n "$DEPLOY_NAMESPACE" logs deployment/orchestapi
```

回滚 Deployment：

```bash
kubectl -n "$DEPLOY_NAMESPACE" rollout undo deployment/orchestapi
```

镜像回滚不会自动回滚已经执行的数据库 migration，需要按数据库变更策略单独处理。

## 上线验证

平台提供 Service/Ingress 后，从批准的内网来源验证：

```bash
curl -fsS https://<internal-host>/orchestapi/actuator/health
```

还需验证 UI、REST、SSE、Mock、Webhook、TLS/DNS、数据库 migration，以及非 allowlist 来源被拒绝。仓库构建和 Kustomize 渲染只能证明本地交付物，不能替代真实集群、网络、数据库或入口验证。
