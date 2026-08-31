#!/usr/bin/env bash

# OrchestAPI Starbucks internal deployment entrypoint.
#
# Build ownership stays split: Node/npm + Maven run on the host (or CI),
# Docker only packages the resulting Spring Boot JAR. Default release path
# builds, pushes, and can apply the stg Deployment (agent-session style).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-registry-stg.vestack.sbuxcf.net/agent-develop-lifecycle-management}"
IMAGE_NAME="${IMAGE_NAME:-orchestapi}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-${IMAGE_REGISTRY_PREFIX%/}/${IMAGE_NAME}}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-registry-stg.vestack.sbuxcf.net/yunxiao-paas/openjdk:21-ea-23-jdk-bullseye-1}"
VITE_BASE_PATH="${VITE_BASE_PATH:-/orchestapi/}"
IMAGE_TAG="${IMAGE_TAG:-}"
IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"
MAVEN_BIN="${MAVEN_BIN:-}"

# Match the live Starbucks stg Deployment (container name is c0).
K8S_NAMESPACE="${K8S_NAMESPACE:-developer-portal-stg}"
K8S_DEPLOYMENT="${K8S_DEPLOYMENT:-orchestapi}"
K8S_CONTAINER="${K8S_CONTAINER:-c0}"

SKIP_INSTALL="${SKIP_INSTALL:-false}"
SKIP_TESTS="${SKIP_TESTS:-true}"
# Default release path pushes the image (use --no-push / --jar-only to opt out).
PUSH_IMAGE="${PUSH_IMAGE:-true}"
APPLY_K8S="${APPLY_K8S:-false}"
BUILD_IMAGE="${BUILD_IMAGE:-true}"
DRY_RUN="false"
FRONTEND_CLEAN="false"
TAG_PROVIDED="false"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

generate_version() {
  date +%Y%m%d-%H%M%S
}

show_help() {
  cat <<'EOF'
OrchestAPI Starbucks 内部部署脚本

用法:
  ./deploy.sh                              # 交互：自动生成版本号，询问是否 kubectl 更新
  ./deploy.sh --skip-install --apply-k8s   # 无 tag 时同样自动生成版本号
  ./deploy.sh <image-tag> [options]

默认流程（与 agent-session 一致）:
  1. 本机 npm 构建前端（VITE_BASE_PATH=/orchestapi/）
  2. 本机 Maven package，把 frontend/dist 打进 JAR
  3. Docker 构建 runtime 镜像
  4. docker push 到 Starbucks 内部仓库
  5. 打印 kubectl set image；加 --apply-k8s 时直接更新 Deployment

默认 Kubernetes 目标:
  namespace=developer-portal-stg  deployment=orchestapi  container=c0

选项:
  -h, --help                 显示帮助
  --dry-run                  只输出计划，不执行 npm、Maven、Docker 或 kubectl
  --skip-install             跳过 npm ci
  --clean-frontend           构建前删除 frontend/dist
  --test                     Maven 构建时执行测试（默认跳过测试）
  --jar-only                 只构建本地 JAR（不构建/推送镜像，不更新 k8s）
  --push                     构建后 push 镜像（默认已开启，可显式写出）
  --no-push                  只构建本地镜像，不 push
  --apply-k8s                push 后执行 kubectl set image 并等待 rollout
  --image-repository REPO    完整镜像仓库路径
  --image-prefix PREFIX      镜像仓库前缀
  --image-name NAME          镜像名（默认 orchestapi）
  --image-tag TAG            镜像 tag；也可用第一个位置参数
  --runtime-image IMAGE      Docker runtime FROM 镜像
  --platform PLATFORM        Docker 构建平台（默认 linux/amd64）
  --namespace NS             Kubernetes namespace（默认 developer-portal-stg）
  --deployment NAME          Kubernetes Deployment 名称（默认 orchestapi）
  --container NAME           Kubernetes container 名称（默认 c0）

环境变量:
  IMAGE_REPOSITORY, IMAGE_REGISTRY_PREFIX, IMAGE_NAME, IMAGE_TAG
  RUNTIME_IMAGE, VITE_BASE_PATH, IMAGE_PLATFORM, MAVEN_BIN
  SKIP_INSTALL, SKIP_TESTS, PUSH_IMAGE, APPLY_K8S
  K8S_NAMESPACE, K8S_DEPLOYMENT, K8S_CONTAINER

示例:
  ./deploy.sh
  ./deploy.sh 20260831-211800 --skip-install --apply-k8s
  ./deploy.sh 20260831-01 --skip-install --no-push
  ./deploy.sh 20260831-01 --jar-only
EOF
}

require_command() {
  [[ "${DRY_RUN:-false}" == "true" ]] && return
  command -v "$1" >/dev/null 2>&1 || die "未找到命令: $1"
}

run_cmd() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if [[ "$DRY_RUN" != "true" ]]; then
    "$@"
  fi
}

normalize_base_path() {
  local value="$1"
  value="/${value#/}"
  value="${value%/}/"
  printf '%s' "$value"
}

resolve_maven_command() {
  if [[ -n "$MAVEN_BIN" ]]; then
    printf '%s\n' "$MAVEN_BIN"
  elif command -v mvn >/dev/null 2>&1; then
    printf '%s\n' "mvn"
  elif [[ -x "$BACKEND_DIR/mvnw" ]]; then
    printf '%s\n' "$BACKEND_DIR/mvnw"
  elif [[ -f "$BACKEND_DIR/mvnw" ]]; then
    printf '%s\n' "bash $BACKEND_DIR/mvnw"
  else
    die "未找到 Maven：请安装 mvn，或提供 backend/mvnw"
  fi
}

require_java_21() {
  [[ "$DRY_RUN" == "true" ]] && return 0

  local java_command="java"
  if [[ -n "${JAVA_HOME:-}" ]]; then
    java_command="$JAVA_HOME/bin/java"
  fi
  [[ -x "$java_command" || "$java_command" == "java" ]] || die "JAVA_HOME 无效：$JAVA_HOME"

  local java_major
  java_major="$($java_command -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
  [[ "$java_major" == "21" ]] || die "需要 Java 21 构建，当前检测到 Java ${java_major:-unknown}；请设置 JAVA_HOME"
}

prompt_apply_k8s() {
  local answer=""
  echo ""
  read -r -p "推送镜像后是否执行 kubectl 更新部署 (${K8S_NAMESPACE}/${K8S_DEPLOYMENT})? [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      APPLY_K8S="true"
      ;;
  esac
}

parse_args() {
  local positional_tag=""
  local push_flag_set="false"
  local apply_flag_set="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        show_help
        exit 0
        ;;
      --dry-run)
        DRY_RUN="true"
        shift
        ;;
      --skip-install)
        SKIP_INSTALL="true"
        shift
        ;;
      --clean-frontend)
        FRONTEND_CLEAN="true"
        shift
        ;;
      --test)
        SKIP_TESTS="false"
        shift
        ;;
      --jar-only)
        BUILD_IMAGE="false"
        PUSH_IMAGE="false"
        APPLY_K8S="false"
        push_flag_set="true"
        apply_flag_set="true"
        shift
        ;;
      --push)
        PUSH_IMAGE="true"
        push_flag_set="true"
        shift
        ;;
      --no-push)
        PUSH_IMAGE="false"
        push_flag_set="true"
        shift
        ;;
      --apply-k8s)
        APPLY_K8S="true"
        apply_flag_set="true"
        shift
        ;;
      --image-repository)
        [[ $# -ge 2 ]] || die "--image-repository 缺少参数"
        IMAGE_REPOSITORY="${2%/}"
        shift 2
        ;;
      --image-prefix)
        [[ $# -ge 2 ]] || die "--image-prefix 缺少参数"
        IMAGE_REGISTRY_PREFIX="${2%/}"
        IMAGE_REPOSITORY="${IMAGE_REGISTRY_PREFIX}/${IMAGE_NAME}"
        shift 2
        ;;
      --image-name)
        [[ $# -ge 2 ]] || die "--image-name 缺少参数"
        IMAGE_NAME="$2"
        IMAGE_REPOSITORY="${IMAGE_REGISTRY_PREFIX%/}/${IMAGE_NAME}"
        shift 2
        ;;
      --image-tag)
        [[ $# -ge 2 ]] || die "--image-tag 缺少参数"
        IMAGE_TAG="$2"
        TAG_PROVIDED="true"
        shift 2
        ;;
      --runtime-image)
        [[ $# -ge 2 ]] || die "--runtime-image 缺少参数"
        RUNTIME_IMAGE="$2"
        shift 2
        ;;
      --platform)
        [[ $# -ge 2 ]] || die "--platform 缺少参数"
        IMAGE_PLATFORM="$2"
        shift 2
        ;;
      --namespace)
        [[ $# -ge 2 ]] || die "--namespace 缺少参数"
        K8S_NAMESPACE="$2"
        shift 2
        ;;
      --deployment)
        [[ $# -ge 2 ]] || die "--deployment 缺少参数"
        K8S_DEPLOYMENT="$2"
        shift 2
        ;;
      --container)
        [[ $# -ge 2 ]] || die "--container 缺少参数"
        K8S_CONTAINER="$2"
        shift 2
        ;;
      --)
        shift
        while [[ $# -gt 0 ]]; do
          [[ -z "$positional_tag" ]] || die "只能指定一个 image tag"
          positional_tag="$1"
          TAG_PROVIDED="true"
          shift
        done
        ;;
      -* )
        die "未知参数: $1"
        ;;
      *)
        [[ -z "$positional_tag" ]] || die "只能指定一个 image tag"
        positional_tag="$1"
        TAG_PROVIDED="true"
        shift
        ;;
    esac
  done

  if [[ -n "$positional_tag" ]]; then
    IMAGE_TAG="$positional_tag"
  fi

  if [[ -z "$IMAGE_TAG" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      IMAGE_TAG="dry-run"
    else
      IMAGE_TAG="$(generate_version)"
    fi
  fi

  VITE_BASE_PATH="$(normalize_base_path "$VITE_BASE_PATH")"

  if [[ "$BUILD_IMAGE" != "true" ]]; then
    PUSH_IMAGE="false"
    APPLY_K8S="false"
  fi

  [[ "$BUILD_IMAGE" == "true" || "$push_flag_set" != "true" || "$PUSH_IMAGE" == "false" ]] \
    || die "--push 不能与 --jar-only 同时使用"
  [[ "$BUILD_IMAGE" == "true" || "$apply_flag_set" != "true" || "$APPLY_K8S" == "false" ]] \
    || die "--apply-k8s 需要先构建 runtime image"
  [[ "$PUSH_IMAGE" == "true" || "$APPLY_K8S" == "false" ]] \
    || die "--apply-k8s 需要先 push 镜像（去掉 --no-push）"
}

build_frontend() {
  if [[ "$FRONTEND_CLEAN" == "true" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "Would remove frontend/dist"
    else
      rm -rf "$FRONTEND_DIR/dist"
    fi
  fi

  if [[ "$SKIP_INSTALL" != "true" ]]; then
    require_command npm
    run_cmd npm --prefix "$FRONTEND_DIR" ci
  fi

  require_command npm
  echo "Frontend build: npm run build (VITE_BASE_PATH=$VITE_BASE_PATH)"
  run_cmd env "VITE_BASE_PATH=$VITE_BASE_PATH" npm --prefix "$FRONTEND_DIR" run build

  if [[ "$DRY_RUN" != "true" && ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
    die "前端构建未生成 frontend/dist/index.html"
  fi
}

build_backend_jar() {
  local maven_command
  local -a maven_command_parts
  local -a maven_args

  require_java_21

  if [[ "$DRY_RUN" == "true" ]]; then
    maven_command="mvn"
    maven_command_parts=(mvn)
  else
    maven_command="$(resolve_maven_command)"
    if [[ "$maven_command" == bash\ * ]]; then
      maven_command_parts=(bash "$BACKEND_DIR/mvnw")
    else
      maven_command_parts=("$maven_command")
    fi
  fi

  maven_args=(clean package -B "-Dfrontend.dist.dir=$FRONTEND_DIR/dist")
  if [[ "$SKIP_TESTS" == "true" ]]; then
    maven_args+=(-DskipTests)
  fi

  echo "Backend package: $maven_command clean package"
  (
    cd "$BACKEND_DIR"
    run_cmd "${maven_command_parts[@]}" "${maven_args[@]}"
  )

  if [[ "$DRY_RUN" == "true" ]]; then
    JAR_RELATIVE_PATH="backend/target/orchestapi-1.0.0.jar"
    return
  fi

  local jar_count
  jar_count="$(find "$BACKEND_DIR/target" -maxdepth 1 -type f -name 'orchestapi-*.jar' ! -name '*.original' | wc -l | tr -d ' ')"
  [[ "$jar_count" == "1" ]] || die "backend/target 中期望 1 个可执行 JAR，实际找到 $jar_count 个"

  JAR_PATH="$(find "$BACKEND_DIR/target" -maxdepth 1 -type f -name 'orchestapi-*.jar' ! -name '*.original' -print)"
  jar tf "$JAR_PATH" | grep -Fqx 'BOOT-INF/classes/static/index.html' \
    || die "JAR 未包含前端静态资源：BOOT-INF/classes/static/index.html"
  JAR_RELATIVE_PATH="${JAR_PATH#"$ROOT_DIR/"}"
}

build_runtime_image() {
  if [[ "$BUILD_IMAGE" != "true" ]]; then
    return 0
  fi

  local vcs_ref
  local -a docker_args
  local image_ref="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

  if [[ "$DRY_RUN" == "true" ]]; then
    vcs_ref="dry-run"
  else
    require_command docker
    vcs_ref="$(git -C "$ROOT_DIR" rev-parse --verify HEAD)"
  fi

  docker_args=(build)
  if [[ -n "$IMAGE_PLATFORM" ]]; then
    docker_args+=(--platform "$IMAGE_PLATFORM")
  fi
  docker_args+=(
    --build-arg "RUNTIME_IMAGE=$RUNTIME_IMAGE"
    --build-arg "JAR_FILE=$JAR_RELATIVE_PATH"
    --build-arg "APP_VERSION=$IMAGE_TAG"
    --build-arg "VCS_REF=$vcs_ref"
    --tag "$image_ref"
    "$ROOT_DIR"
  )

  echo "Runtime image: docker build (FROM $RUNTIME_IMAGE)"
  run_cmd docker "${docker_args[@]}"
  echo "Image built: $image_ref"

  if [[ "$PUSH_IMAGE" == "true" ]]; then
    require_command docker
    echo "Pushing image: $image_ref"
    run_cmd docker push "$image_ref"
    echo "Image pushed: $image_ref"
  fi
}

print_kubernetes_command() {
  local image_ref="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
  local -a kubectl_args
  kubectl_args=(kubectl -n "$K8S_NAMESPACE" set image "deployment/$K8S_DEPLOYMENT" "$K8S_CONTAINER=$image_ref")
  echo "Kubernetes update command:"
  echo "${kubectl_args[*]}"
}

update_kubernetes() {
  if [[ "$BUILD_IMAGE" != "true" || "$PUSH_IMAGE" != "true" ]]; then
    return 0
  fi

  print_kubernetes_command

  if [[ "$APPLY_K8S" != "true" ]]; then
    echo "跳过 kubectl 更新（需要时加 --apply-k8s，或在交互模式选择 y）"
    return 0
  fi

  require_command kubectl
  local image_ref="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
  local -a kubectl_args
  kubectl_args=(kubectl -n "$K8S_NAMESPACE" set image "deployment/$K8S_DEPLOYMENT" "$K8S_CONTAINER=$image_ref")
  echo "Applying Kubernetes image update..."
  run_cmd "${kubectl_args[@]}"
  run_cmd kubectl -n "$K8S_NAMESPACE" rollout status "deployment/$K8S_DEPLOYMENT" --timeout=180s
  echo "Deployment updated: ${K8S_NAMESPACE}/${K8S_DEPLOYMENT} -> ${image_ref}"
}

main() {
  parse_args "$@"

  # No explicit tag + TTY: agent-session style interactive apply prompt.
  if [[ "$TAG_PROVIDED" == "false" && "$DRY_RUN" != "true" && "$APPLY_K8S" != "true" ]]; then
    if [[ -t 0 ]]; then
      echo "自动生成版本号: $IMAGE_TAG"
      echo "目标镜像: ${IMAGE_REPOSITORY}:${IMAGE_TAG}"
      echo "K8s: ${K8S_NAMESPACE}/${K8S_DEPLOYMENT} (container=${K8S_CONTAINER})"
      prompt_apply_k8s
    fi
  elif [[ "$TAG_PROVIDED" == "false" && "$DRY_RUN" != "true" ]]; then
    echo "自动生成版本号: $IMAGE_TAG"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Dry run: image=${IMAGE_REPOSITORY}:${IMAGE_TAG} runtime=$RUNTIME_IMAGE push=$PUSH_IMAGE apply=$APPLY_K8S"
  else
    echo "Deploy plan: image=${IMAGE_REPOSITORY}:${IMAGE_TAG} push=$PUSH_IMAGE apply-k8s=$APPLY_K8S"
  fi

  require_java_21
  build_frontend
  build_backend_jar
  build_runtime_image
  update_kubernetes

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Local frontend + Maven JAR deployment plan is valid."
  elif [[ "$BUILD_IMAGE" == "true" ]]; then
    echo "Deployment artifact ready: ${IMAGE_REPOSITORY}:${IMAGE_TAG}"
  else
    echo "JAR ready: $JAR_PATH"
  fi
}

main "$@"
