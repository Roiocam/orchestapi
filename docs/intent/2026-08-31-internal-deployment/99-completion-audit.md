# 内部部署改造完成审计

日期：2026-08-31

## 已完成的交付范围

- 保持方案 C：一个 Docker 镜像、一个 Kubernetes Service，前端静态资源嵌入后端 JAR。
- 生产运行时固定使用 `/orchestapi` context path；前端通过 `VITE_BASE_PATH=/orchestapi/` 构建；Ingress 不做路径 rewrite。
- 新增 production health 脱敏、OCI version/revision 标签、单副本 Kubernetes Deployment、受限 Ingress/NetworkPolicy 示例层和内部部署运行手册。
- 未添加或变更应用认证、业务 API、数据库 migration、第二个服务或真实基础设施配置。

## 本地与仓库证据

| 项目 | 命令或检查 | 结果 |
| --- | --- | --- |
| 后端测试 | Java 21 下 `mvn test`（`backend/`） | 3 个测试通过，包含 `/orchestapi/actuator/health` 的 production profile 回归测试。 |
| 前端基路径 | `VITE_BASE_PATH=/orchestapi/ npm --prefix frontend run build` | 通过；输出产物带 `/orchestapi/` 基路径。 |
| Kubernetes 渲染 | `kubectl kustomize k8s/overlays/internal-example` | 通过；输出 ConfigMap、Service、Deployment、Ingress、NetworkPolicy 共 5 个资源。 |
| 清单安全性 | 渲染检查与 `rg '^kind: Secret$' k8s` | 保持单副本、统一前缀与 `secretKeyRef`；未提交 Secret 清单。 |
| 最终镜像 | `docker build`，传入 `VITE_BASE_PATH`、`APP_VERSION=verification`、`VCS_REF` | 通过。 |
| 镜像运行时 | `docker inspect orchestapi:verification` | 返回 `verification 66841bfe54b1d2c34cc5c17bf0e86b918abd5ed7 orchestapi`。 |
| 本地容器冒烟 | 临时 PostgreSQL + `orchestapi:verification`，请求 `http://localhost:18080/orchestapi/actuator/health` | 返回精确 `{"status":"UP"}`，不含依赖 details；临时容器和网络已清理。 |

## 已知基线信号

- `npm --prefix frontend run lint` 在依赖安装后报告 45 个既有前端 lint 错误。本次改动没有修改 `frontend/`；该检查未作为本次部署改造通过的证据。
- 后端 H2 测试日志仍会报告既有 PostgreSQL 类型兼容告警，本地 Mongo 未启动也会有连接告警；Maven 最终结果为 `BUILD SUCCESS`。
- `npm ci` 报告现有依赖审计问题；本次没有升级或修改依赖。

## 未验证的 Starbucks 平台门禁

以下项未执行，不能由本地或静态清单替代：

- 内部镜像仓库推送、签名或扫描，以及环境自有 namespace/overlay 的审批。
- 实际 PostgreSQL 连通性、账号权限、Flyway migration 与备份/回退策略。
- 真实 IngressClass、TLS、DNS、CIDR allowlist 与 NetworkPolicy controller 命名空间选择器。
- 内网 UI、REST、SSE、Mock、Webhook 的真实流量，以及 allowlist 外来源被拒绝的验证。
- 集群 rollout、监控接入和 `kubectl rollout undo` 回滚演练。

部署前必须由 Starbucks 平台负责人将 `internal-example` 复制为环境自有 overlay，替换所有 `.invalid`、`192.0.2.0/32`、示例 namespace、镜像地址、Ingress controller selector 与 TLS Secret 占位值，并执行上述线上门禁。
