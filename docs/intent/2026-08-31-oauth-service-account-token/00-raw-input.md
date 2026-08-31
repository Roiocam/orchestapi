# 原始输入

> 当前这个 orchestapi 对于 OAUTH 的支持不够好，请你 plan 一下吗？

用户补充意图：

- OAuth 自动获取 Service Account Access Token。
- 采用方案 A：Starbucks/IdP 已经预先创建 Service Account Client，OrchestAPI 不负责创建 IdP Client，只负责通过 OAuth `client_credentials` 获取 Token。

沿用当前部署边界：

- 首版只允许受限内网访问，暂不修改 OrchestAPI 入站应用认证。
- 保持单镜像、单 Deployment 的内部部署形态。
- OAuth Client Secret 不进入 Git，不在前端浏览器中持有。
