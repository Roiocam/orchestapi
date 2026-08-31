package com.orchestrator.model;

import com.orchestrator.oauth.EnvironmentOAuthSnapshot;
import com.orchestrator.oauth.OAuthTokenErrorCode;
import com.orchestrator.oauth.OAuthTokenException;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EnvironmentOAuthConfigTest {

    @Test
    void disabledConfigurationUsesSafeDefaultsAndCanCreateSnapshot() {
        UUID environmentId = UUID.randomUUID();
        EnvironmentOAuthConfig config = EnvironmentOAuthConfig.disabled(environmentId);

        assertThat(config.isEnabled()).isFalse();
        assertThat(config.getClientAuthMethod()).isEqualTo("client_secret_basic");
        assertThat(config.getRefreshSkewSeconds()).isEqualTo(60);
        assertThat(config.getRequestTimeoutMs()).isEqualTo(10_000);
        assertThat(config.getRevision()).isEqualTo(1);

        EnvironmentOAuthSnapshot snapshot = config.snapshot();
        assertThat(snapshot.environmentId()).isEqualTo(environmentId);
        assertThat(snapshot.revision()).isEqualTo(1);
        assertThat(snapshot.enabled()).isFalse();
        assertThat(snapshot.clientSecret()).isEmpty();
    }

    @Test
    void enabledConfigurationRequiresEndpointClientIdAndSecret() {
        EnvironmentOAuthConfig config = EnvironmentOAuthConfig.disabled(UUID.randomUUID());
        config.setEnabled(true);

        assertThatThrownBy(config::validate)
                .isInstanceOf(OAuthTokenException.class)
                .satisfies(error -> assertThat(((OAuthTokenException) error).getCode())
                        .isEqualTo(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID));
    }

    @Test
    void enabledConfigurationAcceptsSupportedAuthMethodsAndOptionalValues() {
        EnvironmentOAuthConfig config = validConfig("client_secret_basic");
        assertThatCode(config::validate).doesNotThrowAnyException();

        config.setClientAuthMethod("client_secret_post");
        config.setScopes("orders.read orders.write");
        config.setAudience("orders-api");
        assertThatCode(config::validate).doesNotThrowAnyException();
    }

    @Test
    void enabledConfigurationRejectsEndpointAuthTimeoutAndSkewValues() {
        EnvironmentOAuthConfig config = validConfig("client_secret_basic");
        config.setTokenEndpoint("file:///tmp/token");
        assertThatThrownBy(config::validate).hasMessageContaining("endpoint");

        config = validConfig("unsupported");
        assertThatThrownBy(config::validate).hasMessageContaining("authentication method");

        config = validConfig("client_secret_basic");
        config.setRequestTimeoutMs(0);
        assertThatThrownBy(config::validate).hasMessageContaining("timeout");

        config = validConfig("client_secret_basic");
        config.setRefreshSkewSeconds(-1);
        assertThatThrownBy(config::validate).hasMessageContaining("refresh");
    }

    @Test
    void snapshotIsImmutableAndDoesNotExposeSecretInToString() {
        EnvironmentOAuthConfig config = validConfig("client_secret_basic");

        EnvironmentOAuthSnapshot snapshot = config.snapshot();

        assertThat(snapshot.clientSecret()).isEqualTo("client-secret-value");
        assertThat(snapshot.toString()).contains("<redacted>")
                .doesNotContain("client-secret-value");
    }

    private EnvironmentOAuthConfig validConfig(String authMethod) {
        EnvironmentOAuthConfig config = EnvironmentOAuthConfig.disabled(UUID.randomUUID());
        config.setEnabled(true);
        config.setTokenEndpoint("https://idp.example.test/oauth/token");
        config.setClientId("service-client");
        config.setClientSecret("client-secret-value");
        config.setClientAuthMethod(authMethod);
        config.setRefreshSkewSeconds(60);
        config.setRequestTimeoutMs(10_000);
        return config;
    }
}
