# Starbucks 内部 Kubernetes 部署

本目录提供单镜像、单 Service 的内部部署模板。应用、REST/SSE、Mock 与 Webhook 都通过同一个无重写前缀 `/orchestapi` 暴露；首版仅依赖网络边界限制访问，不变更应用认证。

`overlays/internal-example` **不可直接部署**。其中的 `orchestapi-internal`、`replace-me` tag、`.invalid` 主机名和 `192.0.2.0/32` 都是安全占位符；镜像仓库默认指向已在 Starbucks 项目中使用的 `registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi`，也必须由环境负责人确认或覆盖。开始部署前，平台负责人必须将该目录复制到环境自有的 overlay，并用已批准的命名空间、镜像仓库与 tag、IngressClass/注解、TLS Secret、访问 CIDR、以及 Ingress controller 命名空间选择器替换这些值。

不要直接对 `k8s/base` 或 `overlays/internal-example` 执行 `kubectl apply`。基础层默认拒绝所有入站流量；示例层只适用于渲染和作为环境配置起点。

## 运行约束

- 保持一个镜像和一个名为 `orchestapi` 的 ClusterIP Service；前端资源已嵌入 Spring Boot JAR。
- 后端和前端必须使用同一前缀：`CONTEXT_PATH=/orchestapi` 与构建参数 `VITE_BASE_PATH=/orchestapi/`。
- Ingress 将 `/orchestapi` 原样转发，不使用 rewrite；因此 `/orchestapi/api/**`、`/orchestapi/mock/**` 与 `/orchestapi/webhook/**` 保留正确路径。
- Deployment 固定为一个常驻副本。SSE、Webhook 监听器、运行注册表和调度在当前版本中均为进程本地状态，不能通过横向扩容获得 HA。

## 构建并发布镜像

采用与 `agent-session` 相同的职责边界：前端和后端在构建机本地完成，Docker 不再运行 Node 或 Maven，只把已验证的 Spring Boot JAR 封装进运行时镜像。默认运行时 `FROM` 使用从 `agent-session`/Starbucks 项目构建配置中核对的 Java 基础镜像；平台若分配了其他批准镜像，通过 `RUNTIME_IMAGE` 覆盖。

先确认构建机具备 Java 21、Node/npm、Maven（或 `backend/mvnw`）和 Docker，并登录内部镜像仓库。最小本地构建命令：

```bash
./deploy.sh "$IMAGE_TAG" --skip-install
```

脚本会依次执行：

1. `VITE_BASE_PATH=/orchestapi/ npm run build`；
2. `mvn clean package -Dfrontend.dist.dir=.../frontend/dist`，生成 `backend/target/orchestapi-1.0.0.jar`，并校验 JAR 内含 `static/index.html`；
3. `docker build`，仅将该 JAR 封装为运行时镜像。

默认只构建本地镜像，不会 push 或修改集群。需要发布到 Starbucks 内部仓库时显式执行：

```bash
IMAGE_REPOSITORY=registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management/orchestapi \
  ./deploy.sh "$IMAGE_TAG" --skip-install --push
```

只需要 JAR（例如交给其他制品流程）时：

```bash
./deploy.sh "$IMAGE_TAG" --skip-install --jar-only
```

查看命令计划而不执行任何构建或发布动作：

```bash
./deploy.sh "$IMAGE_TAG" --dry-run
```

`--apply-k8s` 只在镜像已经推送并且当前 kubeconfig/namespace 已获批准时使用；它执行 `kubectl set image`，不会创建数据库 Secret。推送镜像和生成环境 overlay 仍由拥有相应内部平台权限的发布流程负责。

## 在集群外管理数据库凭据

先在本机或受控 CI 工作目录准备一个不纳入 Git 的 `SECRET_ENV_FILE`。该文件仅含三项键：`DB_URL`、`DB_USERNAME`、`DB_PASSWORD`。不要使用 `--from-literal`，避免凭据进入 shell 历史或任务日志。

```bash
kubectl -n "$DEPLOY_NAMESPACE" create secret generic orchestapi-db \
  --from-env-file="$SECRET_ENV_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Kubernetes 清单只引用名为 `orchestapi-db` 的现有 Secret；不会创建或提交 Secret 资源。数据库网络可达性、证书要求与最小权限由环境团队确认。

## 渲染、发布与回滚

令 `OVERLAY_DIR` 指向已经替换所有占位值的环境自有 overlay，`DEPLOY_NAMESPACE` 与其中命名空间一致。

```bash
kubectl kustomize "$OVERLAY_DIR" > /tmp/orchestapi-rendered.yaml
kubectl apply -k "$OVERLAY_DIR"
kubectl -n "$DEPLOY_NAMESPACE" rollout status deployment/orchestapi --timeout=5m
```

发生发布回归时，回退 Deployment 的上一修订：

```bash
kubectl -n "$DEPLOY_NAMESPACE" rollout undo deployment/orchestapi
```

发布前应保留渲染结果供审查，确认其中仍为一个副本、`CONTEXT_PATH` 为 `/orchestapi`、Ingress 没有 rewrite 注解，并且只含对 `orchestapi-db` 的 Secret 引用。

## 上线验证与证据边界

在真实内部域名、已批准访问源和生产数据库可用后，验证以下项目：

- 浏览器访问 `/orchestapi/`，静态资源与客户端路由正常。
- `GET /orchestapi/actuator/health` 返回 `UP` 且不暴露依赖细节。
- 执行一个受控 REST 请求，以及一次 SSE suite run，确认长连接未被缓冲或超时中断。
- 分别执行一个 `/orchestapi/mock/**` 请求和一个 `/orchestapi/webhook/**` 回调请求。
- 从 allowlist 外的源地址访问，确认 Ingress/CIDR 策略拒绝；同时确认 NetworkPolicy 的 controller 命名空间选择器符合实际安装方式。
- 记录一次回滚演练、TLS 握手和 PostgreSQL 连通性结果。

仓库内的构建、测试和 Kustomize 渲染只能证明交付物的静态与本地行为，不能证明上述任何集群、网络、TLS、数据库或流量验证结果。
