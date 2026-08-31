# 原始输入

> 请你将这个项目，改造为：`/Users/jingchen/IdeaProject/opensource/agent-session` 这种部署方式，我需要在 starbucks 内部部署。

后续确认：

- 首版只允许受限内网访问，暂不改应用认证。
- 选择方案 C：保留单镜像，只改造部署，不拆分前后端服务。
- 公共路径使用单一前缀：`https://<internal-host>/orchestapi/`。
