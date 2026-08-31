# 验收清单

| 编号 | 用户可观察结果 | 来源 | 需要的证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| A1 | 可构建一个包含前端静态资源和后端的版本化生产镜像。 | 用户选择方案 C。 | 本地 `npm run build` + Java 21 `mvn clean package` 生成包含 `static/index.html` 的 JAR；runtime-only `docker build` 通过；`docker inspect` 输出版本与 revision。 | 本地通过 |
| A2 | Starbucks 平台提供的 Service/Ingress/Gateway 可将 `/orchestapi/` 及 REST、SSE、Mock、Webhook 路由到单 Deployment。 | 用户确认单前缀契约和单 Deployment 边界。 | Deployment 保持 `/orchestapi` context path；平台入口无 rewrite 并选择 `app.kubernetes.io/name: orchestapi`。 | 本地 Deployment/文档通过；真实内网流量待验证 |
| A3 | 单 Deployment 可从外部 PostgreSQL 启动应用并执行已有 Flyway migration。 | 用户要求 Starbucks 内部部署。 | Deployment 只引用外部 `orchestapi-db` Secret；一次临时 PostgreSQL 容器启动并通过 `/orchestapi` health。 | 本地通过；真实外部 PostgreSQL 待平台验证 |
| A4 | 生产配置不含 Git 中的用户名、密码、Token 或环境特定网络地址。 | 受限内网和内部部署要求。 | 清单无 `kind: Secret`，仅有 `secretKeyRef`；host、CIDR、namespace、TLS 和 tag 使用占位值；镜像 registry/base image 仅采用已核对的 Starbucks 内部默认路径且可覆盖；`k8s` 文档扫描无凭据形式。 | 清单/文档通过 |
| A5 | 不改变现有应用认证；访问限制由 Starbucks 平台提供的内部入口和网络策略负责。 | 用户明确确认。 | 应用认证源码未改；Deployment 不创建入口资源，文档要求平台配置内部 allowlist 和 NetworkPolicy。 | 清单/文档通过；真实入口策略待平台验证 |
| A6 | 后端健康探针可在 `/orchestapi/actuator/health` 工作，且生产健康响应不泄露详细依赖状态。 | 内部生产部署基线。 | `ProductionDeploymentConfigurationTest` 通过；三种 probe 与本地容器请求均使用该路径，响应为 `{"status":"UP"}`。 | 本地/清单通过 |
| A7 | 首版后端只部署一个副本，并在文档中说明扩容前提。 | 当前 SSE、Webhook 和调度实现。 | 渲染 Deployment 保持 `replicas: 1`；`k8s/README.md` 记录进程本地状态限制。 | 清单/文档通过 |
| A8 | 交付可渲染的单 Deployment Kustomize 清单和部署/回滚/验证说明；未宣称真实集群已发布。 | 内部部署目标和证据边界。 | `kubectl kustomize k8s/overlays/internal-example` 通过并只输出 1 个 Deployment；运行手册说明外部 Secret 与平台 Service/Ingress/NetworkPolicy、发布、回滚及线上验证步骤。 | 本地/文档通过；真实发布未执行 |
| A9 | 构建机可以不运行 Docker 编译前端或后端；也可以只交付 JAR。 | 用户确认本地 Maven 打包。 | `./deploy.sh <tag> --skip-install --jar-only` 通过；脚本 dry-run 明确显示 npm → Maven → 可选 Docker 封装顺序。 | 本地通过 |
