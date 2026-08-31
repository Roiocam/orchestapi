# 决策记录

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 交付形态 | 单个 Spring Boot 镜像和单个 Kubernetes Service | 用户选择最小改造的方案 C。 |
| 访问控制 | 不增加 Keycloak 或应用认证 | 首版只限受限内网；入口由企业 Ingress 白名单和网络策略负责。 |
| 对外路径 | 所有入口位于 `/orchestapi` 前缀下 | 当前前端会按 Vite base path 拼接 REST/SSE URL；这个路径无需改调用代码。 |
| API 路径 | `/orchestapi/api/**` | 保留既有 controller 的 `/api/**` 合约。 |
| Mock/Webhook 路径 | `/orchestapi/mock/**` 与 `/orchestapi/webhook/**` | 保留既有后端路由和回调 URL 生成逻辑。 |
| 后端副本数 | 首版固定为 1 | SSE emitter、run registry、webhook listener 和调度执行有进程内状态，尚未实现跨副本协调。 |
| 敏感配置 | Kubernetes Secret 引用，不提交真实值 | 参考项目的 ConfigMap 中存在明文敏感值；本项目不得复制这一模式。 |
| 本地 Compose | 保留 | 继续作为开发环境，不是内部生产部署描述。 |
| Kubernetes 资源边界 | 本仓库只提交一个 Deployment；ConfigMap 变量内嵌，数据库 Secret 外部提供 | Starbucks 平台负责 Service、Ingress/Gateway、NetworkPolicy、Namespace 与镜像拉取权限。 |
