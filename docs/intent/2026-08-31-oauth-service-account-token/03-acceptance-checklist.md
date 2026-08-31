# OAuth Service Account Token 验收清单

| 编号 | 用户可观察结果 | 来源 | 需要的证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| A1 | 开启 OAuth 并配置有效 Client 后，执行一个继承 OAuth 的测试步骤，目标请求自动带有 `Authorization: Bearer <token>` | `00-raw-input.md`；`01-decision-log.md` 自动注入范围 | Token Endpoint 请求记录（脱敏）和目标请求 Header 断言 | focused 通过：`ExecutionServiceOAuthTest` 断言目标收到实际 Bearer，结果 Header 已脱敏 |
| A2 | Token 请求使用 `grant_type=client_credentials`，并按配置发送 Client Authentication、scope 和可选 audience | `01-decision-log.md` OAuth 流程/Provider 范围 | Mock Token Endpoint 校验 form、认证方式和参数 | focused 通过：`ClientCredentialsOAuthTokenProviderTest` 覆盖 basic/post、scope、audience |
| A3 | 同一 Deployment 内并发执行多个步骤时，未过期 Token 被复用；接近过期时只刷新一次 | `01-decision-log.md` Token 刷新 | Token Endpoint 调用次数、过期前刷新测试 | focused 通过：并发 single-flight、缓存复用、`invalidate` 刷新测试 |
| A4 | Client Secret 和 Access Token 不出现在数据库、前端响应、执行结果、curl 预览或应用日志中 | `00-raw-input.md`；`01-decision-log.md` Token 所有权/凭据来源 | 日志、HTTP 响应、持久化内容和 curl 的脱敏扫描 | focused 通过：Provider 错误不回显上游正文/Secret，执行结果和 curl 使用 redactor；仓库扫描仅命中合成测试值 |
| A5 | Step 设置为 `DISABLED` 时不发送自动 OAuth；Step 显式 Authorization 仍覆盖自动 Token | `01-decision-log.md` Step 控制/Header 优先级 | ExecutionService focused tests 和 UI 保存/读取断言 | focused 通过：`ExecutionServiceOAuthTest`、`TestStepOAuthModeApiTest`、StepEditor |
| A6 | OAuth 关闭时，现有手工 Authorization、Token 依赖步骤和缓存机制继续工作 | `01-decision-log.md` Header 优先级；现有 README 手工 Token 流程 | OAuth disabled 回归测试和既有执行测试 | focused 通过：OAuth 关闭走 no-op，既有 Maven 全量测试 26/26 |
| A7 | Token Endpoint 超时、4xx/5xx 或返回无效 Token 时，执行得到安全、可定位的 OAuth 错误，不暴露上游响应或凭据 | `01-decision-log.md` 失败重试 | 错误码/消息测试及日志脱敏断言 | focused 通过：不可用、401、无效 token response 均映射稳定错误码 |
| A8 | 普通执行、定时执行和 SSE 执行都使用同一套后端 Token Provider；浏览器不需要持有目标 API Token | `00-raw-input.md`；`01-decision-log.md` 自动注入范围 | 三条执行路径的集成/focused proof | code-path 通过：三类执行汇聚 `ExecutionService.executeStep`；浏览器不新增 Token API；真实三路径集群证明待 Starbucks 验证 |
| A9 | 入站 REST、Actuator、Mock、Webhook 的认证行为不因本次改造改变 | `00-raw-input.md`；`01-decision-log.md` 自动注入范围 | 现有路由回归测试和部署 smoke test | focused 通过：未引入入站安全过滤器，`ProductionDeploymentConfigurationTest` health smoke 通过；真实入口 allowlist 待现场验证 |
| A10 | Kubernetes 清单仍只渲染一个 Deployment；OAuth Client Secret 只通过外部 Secret 引用，不出现明文或 Secret manifest | `00-raw-input.md`；既有内部部署决策 | `kubectl kustomize` 输出扫描和 Secret 引用检查 | local render 通过：`verify-deployment-only.sh` 通过，单 Deployment、外部 `secretKeyRef`、无 Secret/ConfigMap/明文 token |
