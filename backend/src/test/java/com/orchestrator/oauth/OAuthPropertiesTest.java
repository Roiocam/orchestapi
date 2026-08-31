package com.orchestrator.oauth;

import com.orchestrator.config.OAuthProperties;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OAuthPropertiesTest {

    @Test
    void disabledOAuthDoesNotRequireCredentials() {
        OAuthProperties properties = new OAuthProperties();
        properties.setEnabled(false);

        assertThatCode(properties::validate).doesNotThrowAnyException();
    }

    @Test
    void enabledOAuthRequiresEndpointClientIdAndSecret() {
        OAuthProperties properties = new OAuthProperties();
        properties.setEnabled(true);

        assertThatThrownBy(properties::validate)
                .isInstanceOf(OAuthTokenException.class)
                .satisfies(error -> assertThat(((OAuthTokenException) error).getCode())
                        .isEqualTo(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID));
    }

    @Test
    void enabledOAuthAcceptsBasicAndPostClientAuthentication() {
        OAuthProperties properties = validProperties("client_secret_basic");
        assertThatCode(properties::validate).doesNotThrowAnyException();

        properties.setClientAuthMethod("client_secret_post");
        assertThatCode(properties::validate).doesNotThrowAnyException();
    }

    @Test
    void enabledOAuthRejectsInvalidEndpointAndTimeoutValues() {
        OAuthProperties properties = validProperties("client_secret_basic");
        properties.setTokenEndpoint("file:///tmp/token");
        assertThatThrownBy(properties::validate)
                .isInstanceOf(OAuthTokenException.class)
                .hasMessageContaining("endpoint");

        properties = validProperties("client_secret_basic");
        properties.setRequestTimeoutMs(0);
        assertThatThrownBy(properties::validate)
                .isInstanceOf(OAuthTokenException.class)
                .hasMessageContaining("timeout");

        properties = validProperties("client_secret_basic");
        properties.setRefreshSkewSeconds(-1);
        assertThatThrownBy(properties::validate)
                .isInstanceOf(OAuthTokenException.class)
                .hasMessageContaining("refresh");
    }

    @Test
    void accessTokenAuthorizationValueAndStringAreSafe() {
        OAuthAccessToken token = new OAuthAccessToken(
                "sensitive-access-token", "Bearer", Instant.parse("2030-01-01T00:00:00Z"));

        assertThat(token.authorizationValue()).isEqualTo("Bearer sensitive-access-token");
        assertThat(token.toString()).contains("<redacted>").doesNotContain("sensitive-access-token");
    }

    private OAuthProperties validProperties(String authMethod) {
        OAuthProperties properties = new OAuthProperties();
        properties.setEnabled(true);
        properties.setTokenEndpoint("https://idp.example.test/oauth/token");
        properties.setClientId("service-client");
        properties.setClientSecret("client-secret-value");
        properties.setClientAuthMethod(authMethod);
        properties.setScopes("orders.read");
        properties.setRefreshSkewSeconds(60);
        properties.setRequestTimeoutMs(10_000);
        return properties;
    }
}
