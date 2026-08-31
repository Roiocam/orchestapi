# ============================================================
# OrchestAPI — Starbucks internal runtime image
#
# The frontend and Spring Boot JAR are built on the host (or in CI)
# before this file is evaluated. Docker only packages the immutable
# JAR into the internal Java runtime image.
# ============================================================

ARG RUNTIME_IMAGE=registry-stg.vestack.sbuxcf.net/yunxiao-paas/openjdk:21-ea-23-jdk-bullseye-1
FROM ${RUNTIME_IMAGE} AS runtime

ARG APP_VERSION=dev
ARG VCS_REF=unknown
ARG JAR_FILE=backend/target/orchestapi-1.0.0.jar
LABEL org.opencontainers.image.title="OrchestAPI" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

# The Starbucks base image already runs as non-root UID 185. Reuse that
# identity instead of modifying /etc/passwd or /etc/group at build time.
USER 0
RUN mkdir -p /app && chown -R 185:0 /app

WORKDIR /app

# Copy the locally built, executable Spring Boot JAR.
COPY --chown=185:0 ${JAR_FILE} app.jar

USER 185

EXPOSE 8080

# Health check using Spring Actuator (respects CONTEXT_PATH). The
# conditional keeps the image usable with either wget or curl-based bases.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["sh", "-c", "if command -v wget >/dev/null 2>&1; then wget -q --spider http://localhost:8080${CONTEXT_PATH:-}/actuator/health; elif command -v curl >/dev/null 2>&1; then curl -fsS http://localhost:8080${CONTEXT_PATH:-}/actuator/health >/dev/null; else exit 1; fi"]

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
