package com.orchestrator.config;

import com.orchestrator.oauth.OAuthTokenErrorCode;
import com.orchestrator.oauth.OAuthTokenException;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;

@Getter
@Setter
@ConfigurationProperties(prefix = "orchestapi.oauth")
public class OAuthProperties {

    private boolean enabled;
    private String tokenEndpoint = "";
    private String clientId = "";
    private String clientSecret = "";
    private String scopes = "";
    private String audience = "";
    private String clientAuthMethod = "client_secret_basic";
    private long refreshSkewSeconds = 60;
    private long requestTimeoutMs = 10_000;

    public void validate() {
        if (!enabled) {
            return;
        }

        requireText(tokenEndpoint, "OAuth token endpoint");
        requireText(clientId, "OAuth client id");
        requireText(clientSecret, "OAuth client secret");

        URI endpoint;
        try {
            endpoint = URI.create(tokenEndpoint.trim());
        } catch (IllegalArgumentException exception) {
            throw invalid("OAuth token endpoint must be a valid http(s) URL", exception);
        }
        if (!endpoint.isAbsolute()
                || !("http".equalsIgnoreCase(endpoint.getScheme())
                || "https".equalsIgnoreCase(endpoint.getScheme()))) {
            throw invalid("OAuth token endpoint must be an absolute http(s) URL", null);
        }

        if (!"client_secret_basic".equals(clientAuthMethod)
                && !"client_secret_post".equals(clientAuthMethod)) {
            throw invalid("OAuth client authentication method must be client_secret_basic or client_secret_post", null);
        }
        if (requestTimeoutMs <= 0) {
            throw invalid("OAuth request timeout must be greater than zero", null);
        }
        if (refreshSkewSeconds < 0) {
            throw invalid("OAuth refresh skew must not be negative", null);
        }
    }

    private void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw invalid(field + " must be configured when OAuth is enabled", null);
        }
    }

    private OAuthTokenException invalid(String message, Throwable cause) {
        if (cause == null) {
            return new OAuthTokenException(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID, message);
        }
        return new OAuthTokenException(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID, message, cause);
    }
}
