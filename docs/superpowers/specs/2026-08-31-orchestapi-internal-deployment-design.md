# OrchestAPI Starbucks 内部部署设计

## 目标与范围

本次把 OrchestAPI 的生产交付改造成与 Agent Session 相同的内部 Kubernetes 部署习惯：前端和后端由构建机本地或 CI 构建，Docker 只封装已生成的 JAR，运行参数由 Kubernetes 注入，PostgreSQL 是外部依赖，并通过 Ingress 提供同域路径入口。

用户选择最小改造的单镜像方案。`deploy.sh` 使用 `VITE_BASE_PATH=/orchestapi/` 构建前端，并通过 Maven `frontend-static` profile 把静态资源嵌入 Spring Boot JAR；root `Dockerfile` 只使用 Starbucks 内部 Java 运行时镜像封装该 JAR。本次不拆分前端和后端，不引入 Keycloak、Redis 或新的应用认证，也不改变 REST DTO 和业务功能。

对应的验收项位于 `docs/intent/2026-08-31-internal-deployment/03-acceptance-checklist.md`。

## 已确认的公共契约

| 用途 | 公开地址 |
| --- | --- |
| Web UI | `https://<internal-host>/orchestapi/` |
| 管理 REST 与 SSE | `https://<internal-host>/orchestapi/api/**` |
| Mock 流量 | `https://<internal-host>/orchestapi/mock/{serverId}/**` |
| Webhook 流量 | `https://<internal-host>/orchestapi/webhook/{id}/**` |
| Kubernetes health probe | `http://<pod>:8080/orchestapi/actuator/health` |

构建前端时固定 `VITE_BASE_PATH=/orchestapi/`，运行后端时固定 `CONTEXT_PATH=/orchestapi`。两者必须相同，且 Ingress 不得 rewrite 路径。这样现有前端 Axios interceptor、EventSource 地址和后端基于 `HttpServletRequest` 生成的 Mock/Webhook URL 都保持一致。

## 部署构成

新增 `k8s/base/` 作为只包含 Deployment 的可复用清单根：

- `Deployment`：单副本 `orchestapi`，内嵌 `SPRING_PROFILES_ACTIVE`、`SERVER_PORT`、`CONTEXT_PATH` 和 JVM 参数，并通过外部 Secret 注入数据库参数；包含资源请求/限制、滚动更新策略、readiness/liveness/startup probes 与非 root 容器安全上下文。
- Service、Ingress/Gateway、NetworkPolicy、Namespace 和镜像拉取权限由 Starbucks 平台提供，不由本仓库创建。

`k8s/overlays/internal-example/` 只负责替换 Deployment 的镜像名、tag 和 namespace。真实 namespace、Secret、入口域名、TLS、allowlist 和网络策略不写入仓库。

## 运行配置与敏感边界

运行参数使用 Spring Boot 标准环境变量：

| 类别 | 参数 |
| --- | --- |
| Deployment env | `SPRING_PROFILES_ACTIVE=prod`、`SERVER_PORT=8080`、`CONTEXT_PATH=/orchestapi`、`JAVA_OPTS` |
| Secret | `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` |
| 平台参数 | Namespace、Service、Ingress/Gateway、TLS、allowlist、NetworkPolicy、镜像仓库/标签 |

生产 profile 将 actuator health 详情设为 `never`；health 仍用于 kubelet probe，但不向普通受限内网用户暴露数据库细节。没有 Secret 清单实体、真实值或独立 ConfigMap；非敏感变量直接位于 Deployment。

## 可用性边界

后端初始 `replicas: 1`。Suite 执行和 webhook 监听用 JVM 内存中的 `SseEmitter` 与 registry；调度任务也没有分布式锁。直接扩成多副本会产生跨 Pod 实时事件丢失和重复调度风险。

前端资源仍封装在后端镜像，因此本次不能独立扩缩 UI。后续若需要高可用，应先将运行 registry、webhook event fanout 和调度锁迁移到共享基础设施，再把前后端拆成独立服务。

## 交付和验证

实现会提供：

1. 为路径前缀和生产安全收紧的最小配置变更；
2. 只含 Deployment 的 Kubernetes base 与示例 internal overlay；
3. `deploy.sh`、本地 Maven JAR 构建、Starbucks runtime-only 镜像封装、`.env`/Secret 键说明、发布、回滚和集群验证文档；
4. focused backend tests、frontend production build、JAR 静态资源检查与 `kubectl kustomize` 渲染检查。

真实集群部署还需要平台提供 Namespace、Service、Ingress/Gateway、host、Ingress 类型/CIDR、TLS Secret、NetworkPolicy、镜像拉取权限、PostgreSQL endpoint 和创建的数据库 Secret。代码库验证不能替代该环境的 rollout、Ingress allowlist 和实际数据库连通性证明。
