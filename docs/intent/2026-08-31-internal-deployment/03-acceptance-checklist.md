# 验收清单

| 编号 | 用户可观察结果 | 来源 | 需要的证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| A1 | 可构建一个包含前端静态资源和后端的版本化生产镜像。 | 用户选择方案 C。 | `docker build` 通过；`docker inspect` 输出 `verification <revision> orchestapi`。 | 本地通过 |
| A2 | 内网用户可通过 `https://<internal-host>/orchestapi/` 打开 UI，REST、SSE、Mock、Webhook 都保留在该前缀下。 | 用户确认单前缀契约。 | Java 21 的 context path 测试通过；`VITE_BASE_PATH=/orchestapi/ npm --prefix frontend run build` 通过；渲染 Ingress 为无 rewrite 的 `/orchestapi`。 | 本地/清单通过；真实内网流量待验证 |
| A3 | Kubernetes 可从外部 PostgreSQL 启动应用并执行已有 Flyway migration。 | 用户要求 Starbucks 内部部署。 | Deployment 只引用 `orchestapi-db` Secret；一次临时 PostgreSQL 容器启动并通过 `/orchestapi` health。 | 本地通过；真实外部 PostgreSQL 待平台验证 |
| A4 | 生产配置不含 Git 中的用户名、密码、Token 或实际网络地址。 | 受限内网和内部部署要求。 | 清单无 `kind: Secret`，仅有 `secretKeyRef`；示例 host、registry 与 CIDR 使用 `.invalid` 和文档占位值；`k8s` 文档扫描无凭据形式。 | 清单/文档通过 |
| A5 | 不改变现有应用认证；访问限制由内部 Ingress 白名单和网络策略模板提供。 | 用户明确确认。 | 应用认证源码未改；示例 Ingress 白名单与仅允许 ingress controller 的 NetworkPolicy 已渲染，文档要求平台替换占位值。 | 清单通过；真实入口策略待平台验证 |
| A6 | 后端健康探针可在 `/orchestapi/actuator/health` 工作，且生产健康响应不泄露详细依赖状态。 | 内部生产部署基线。 | `ProductionDeploymentConfigurationTest` 通过；三种 probe 与本地容器请求均使用该路径，响应为 `{"status":"UP"}`。 | 本地/清单通过 |
| A7 | 首版后端只部署一个副本，并在文档中说明扩容前提。 | 当前 SSE、Webhook 和调度实现。 | 渲染 Deployment 保持 `replicas: 1`；`k8s/README.md` 记录进程本地状态限制。 | 清单/文档通过 |
| A8 | 交付可渲染的 Kustomize 清单和部署/回滚/验证说明；未宣称真实集群已发布。 | 内部部署目标和证据边界。 | `kubectl kustomize k8s/overlays/internal-example` 通过并输出 5 个资源；运行手册提供环境 overlay、Secret、发布、回滚及线上验证步骤。 | 本地/文档通过；真实发布未执行 |
