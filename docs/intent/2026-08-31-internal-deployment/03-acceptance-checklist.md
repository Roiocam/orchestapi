# 验收清单

| 编号 | 用户可观察结果 | 来源 | 需要的证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| A1 | 可构建一个包含前端静态资源和后端的版本化生产镜像。 | 用户选择方案 C。 | Docker build 成功，镜像标签通过构建参数传入。 | 待实现 |
| A2 | 内网用户可通过 `https://<internal-host>/orchestapi/` 打开 UI，REST、SSE、Mock、Webhook 都保留在该前缀下。 | 用户确认单前缀契约。 | 前端构建检查、后端 context path 测试、Ingress 清单检查。 | 待实现 |
| A3 | Kubernetes 可从外部 PostgreSQL 启动应用并执行已有 Flyway migration。 | 用户要求 Starbucks 内部部署。 | Deployment 的 Secret/ConfigMap 引用和数据库启动说明。 | 待实现 |
| A4 | 生产配置不含 Git 中的用户名、密码、Token 或实际网络地址。 | 受限内网和内部部署要求。 | Secret 引用检查、仓库敏感值扫描。 | 待实现 |
| A5 | 不改变现有应用认证；访问限制由内部 Ingress 白名单和网络策略模板提供。 | 用户明确确认。 | 无认证代码差异，部署文档列出平台侧必须填入的入口控制参数。 | 待实现 |
| A6 | 后端健康探针可在 `/orchestapi/actuator/health` 工作，且生产健康响应不泄露详细依赖状态。 | 内部生产部署基线。 | 配置测试和 Deployment probe 检查。 | 待实现 |
| A7 | 首版后端只部署一个副本，并在文档中说明扩容前提。 | 当前 SSE、Webhook 和调度实现。 | Deployment `replicas: 1` 和部署文档。 | 待实现 |
| A8 | 交付可渲染的 Kustomize 清单和部署/回滚/验证说明；未宣称真实集群已发布。 | 内部部署目标和证据边界。 | `kubectl kustomize` 输出、文档命令和验证记录。 | 待实现 |
