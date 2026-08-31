# 内部部署改造完成审计

日期：2026-08-31

## 已完成的交付范围

- 保持方案 C：一个 Docker 镜像、一个 Kubernetes Deployment，前端静态资源嵌入后端 JAR；数据库凭据从外部 Secret 引用。
- 生产运行时固定使用 `/orchestapi` context path；前端通过 `VITE_BASE_PATH=/orchestapi/` 构建；平台提供的 Service/Ingress/Gateway 不得做路径 rewrite。
- 新增 production health 脱敏、OCI version/revision 标签、单副本 Kubernetes Deployment 和 Deployment-only 内部部署运行手册；Service、Ingress/Gateway、NetworkPolicy 由平台负责。
- 未添加或变更应用认证、业务 API、数据库 migration、第二个服务或真实基础设施配置。

## 本地与仓库证据

| 项目 | 命令或检查 | 结果 |
| --- | --- | --- |
| 后端测试 | Java 21 下 `mvn test`（`backend/`） | 3 个测试通过，包含 `/orchestapi/actuator/health` 的 production profile 回归测试。 |
| 前端基路径 | `VITE_BASE_PATH=/orchestapi/ npm --prefix frontend run build` | 通过；输出产物带 `/orchestapi/` 基路径。 |
| Kubernetes 渲染 | `kubectl kustomize k8s/overlays/internal-example` | 通过；只输出一个 Deployment。 |
| 清单安全性 | `test-script/verify-deployment-only.sh` 与 `rg '^kind: Secret$' k8s` | 保持单副本、内嵌非敏感环境变量与外部 `secretKeyRef`；未提交 Secret 清单。 |
| 最终镜像 | `./deploy.sh verification2 --skip-install --platform linux/amd64` | 通过；本地前端构建、Java 21 Maven JAR 打包和 Starbucks runtime-only `docker build` 均完成。 |
| 镜像运行时 | `docker inspect registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi:verification2` | 返回运行用户 `185`、Java 21 runtime entrypoint、OCI version/revision labels 和 `/actuator/health` healthcheck。 |
| 本地应用健康 | Java 21 `ProductionDeploymentConfigurationTest` | 通过 `/orchestapi/actuator/health` 回归测试；真实 Starbucks PostgreSQL/Ingress 流量仍待平台验证。 |

## 已知基线信号

- `npm --prefix frontend run lint` 在依赖安装后报告 45 个既有前端 lint 错误。本次改动没有修改 `frontend/`；该检查未作为本次部署改造通过的证据。
- 后端 H2 测试日志仍会报告既有 PostgreSQL 类型兼容告警，本地 Mongo 未启动也会有连接告警；Maven 最终结果为 `BUILD SUCCESS`。
- `npm ci` 报告现有依赖审计问题；本次没有升级或修改依赖。

## 未验证的 Starbucks 平台门禁

以下项未执行，不能由本地或静态清单替代：

- 内部镜像仓库推送、签名或扫描，以及环境自有 namespace/overlay 的审批。
- 实际 PostgreSQL 连通性、账号权限、Flyway migration 与备份/回退策略。
- 平台 Service、Ingress/Gateway、TLS、DNS、CIDR allowlist 与 NetworkPolicy controller 命名空间选择器。
- 内网 UI、REST、SSE、Mock、Webhook 的真实流量，以及 allowlist 外来源被拒绝的验证。
- 集群 rollout、监控接入和 `kubectl rollout undo` 回滚演练。

部署前必须由 Starbucks 平台负责人将 `internal-example` 复制为环境自有 overlay，替换示例 namespace、镜像地址和 tag，并由平台另行配置 Service、Ingress/Gateway、NetworkPolicy、TLS、allowlist 与外部 Secret，然后执行上述线上门禁。

## 2026-08-31 构建路径跟进

根据用户确认，构建职责已切换为本地/CI 构建：`deploy.sh` 先使用 `VITE_BASE_PATH=/orchestapi/` 构建前端，再调用 Java 21 Maven 的 `frontend-static` profile 将 `frontend/dist` 复制进 Spring Boot JAR；根 `Dockerfile` 不再包含 Node/Maven builder，只通过 `RUNTIME_IMAGE`（默认 Starbucks 内部 Java 基础镜像）封装该 JAR。`--jar-only` 可在完全不运行 Docker 的情况下只产出 `backend/target/orchestapi-1.0.0.jar`，`--push` 和 `--apply-k8s` 均保持显式 opt-in。

## 2026-08-31 Deployment-only 变更

根据用户确认，Kubernetes 交付进一步收敛为单 Deployment：`k8s/base/kustomization.yaml` 和 `k8s/overlays/internal-example` 不再引用 ConfigMap、Service、Ingress 或 NetworkPolicy；四个非敏感配置直接内嵌在 Deployment，`DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 继续引用外部 `orchestapi-db` Secret。平台必须提供 Namespace、Service、Ingress/Gateway、NetworkPolicy 和镜像拉取权限，才能形成可访问的内部服务。

本地 follow-up 证据：

- `./test-script/verify-local-jar-deploy.sh` 通过；
- `VITE_BASE_PATH=/orchestapi/ npm run build` 通过；
- Java 21 `mvn clean package -Dfrontend.dist.dir=.../frontend/dist -DskipTests` 通过，JAR 含 `BOOT-INF/classes/static/index.html`；
- `./deploy.sh test-local-jar --skip-install --jar-only` 通过；
- runtime image 仍需使用已批准的 Starbucks registry 凭据进行真实构建/推送；本地未宣称内部仓库可达或集群已发布。
