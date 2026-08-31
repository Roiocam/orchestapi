package com.orchestrator.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class SpaWebConfigTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "",
            "mock-server",
            "mock-server/abc-123",
            "environments",
            "environments/11111111-1111-1111-1111-111111111111",
            "test-suites/abc",
            "runs",
            "webhooks",
            "webhooks/xyz"
    })
    void servesSpaIndexForFrontendRoutes(String path) {
        assertThat(SpaWebConfig.shouldServeSpaIndex(path)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "api",
            "api/mock-servers",
            "api/environments/1",
            "mock",
            "mock/server-id/foo",
            "webhook",
            "webhook/id/callback",
            "actuator",
            "actuator/health"
    })
    void doesNotServeSpaIndexForBackendPrefixes(String path) {
        assertThat(SpaWebConfig.shouldServeSpaIndex(path)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "assets/index-abc123.js",
            "icon.svg",
            "favicon.ico",
            "assets/style.css"
    })
    void doesNotServeSpaIndexForMissingStaticAssets(String path) {
        assertThat(SpaWebConfig.shouldServeSpaIndex(path)).isFalse();
    }

    @Test
    void toleratesLeadingSlash() {
        assertThat(SpaWebConfig.shouldServeSpaIndex("/mock-server")).isTrue();
        assertThat(SpaWebConfig.shouldServeSpaIndex("/api/runs")).isFalse();
    }
}
