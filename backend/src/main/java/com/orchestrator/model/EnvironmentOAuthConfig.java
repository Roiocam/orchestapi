package com.orchestrator.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.orchestrator.oauth.EnvironmentOAuthSnapshot;
import com.orchestrator.oauth.OAuthTokenErrorCode;
import com.orchestrator.oauth.OAuthTokenException;
import jakarta.persistence.*;
import lombok.*;

import java.net.URI;
import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "orchestapi_environment_oauth_configs", schema = "orchestrator")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentOAuthConfig {

    public static final String MASKED_SECRET = "••••••••";
    public static final String CLIENT_SECRET_BASIC = "client_secret_basic";
    public static final String CLIENT_SECRET_POST = "client_secret_post";

    @Id
    @Column(name = "environment_id", nullable = false)
    private UUID environmentId;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "environment_id", nullable = false)
    @JsonIgnore
    private Environment environment;

    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = false;

    @Column(name = "token_endpoint", nullable = false, length = 1000)
    @Builder.Default
    private String tokenEndpoint = "";

    @Column(name = "client_id", nullable = false, length = 255)
    @Builder.Default
    private String clientId = "";

    @Column(name = "client_secret", nullable = false, columnDefinition = "TEXT")
    @Builder.Default
    private String clientSecret = "";

    @Column(columnDefinition = "TEXT", nullable = false)
    @Builder.Default
    private String scopes = "";

    @Column(columnDefinition = "TEXT", nullable = false)
    @Builder.Default
    private String audience = "";

    @Column(name = "client_auth_method", nullable = false, length = 32)
    @Builder.Default
    private String clientAuthMethod = CLIENT_SECRET_BASIC;

    @Column(name = "refresh_skew_seconds", nullable = false)
    @Builder.Default
    private long refreshSkewSeconds = 60;

    @Column(name = "request_timeout_ms", nullable = false)
    @Builder.Default
    private long requestTimeoutMs = 10_000;

    @Column(nullable = false)
    @Builder.Default
    private long revision = 1;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static EnvironmentOAuthConfig disabled(UUID environmentId) {
        return EnvironmentOAuthConfig.builder()
                .environmentId(environmentId)
                .enabled(false)
                .build();
    }

    public void validate() {
        validate(false);
    }

    public void validate(boolean requireHttps) {
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
            throw invalid("OAuth token endpoint must be a valid http(s) URL");
        }
        if (!endpoint.isAbsolute()
                || !("http".equalsIgnoreCase(endpoint.getScheme())
                || "https".equalsIgnoreCase(endpoint.getScheme()))) {
            throw invalid("OAuth token endpoint must be an absolute http(s) URL");
        }
        if (requireHttps && !"https".equalsIgnoreCase(endpoint.getScheme())) {
            throw invalid("OAuth token endpoint must use https when the prod profile is active");
        }

        if (!CLIENT_SECRET_BASIC.equals(clientAuthMethod)
                && !CLIENT_SECRET_POST.equals(clientAuthMethod)) {
            throw invalid("OAuth client authentication method must be client_secret_basic or client_secret_post");
        }
        if (requestTimeoutMs <= 0) {
            throw invalid("OAuth request timeout must be greater than zero");
        }
        if (refreshSkewSeconds < 0) {
            throw invalid("OAuth refresh skew must not be negative");
        }
    }

    public EnvironmentOAuthSnapshot snapshot() {
        UUID id = Objects.requireNonNull(environmentId, "environmentId");
        return new EnvironmentOAuthSnapshot(
                id,
                revision,
                enabled,
                tokenEndpoint,
                clientId,
                clientSecret,
                scopes,
                audience,
                clientAuthMethod,
                refreshSkewSeconds,
                requestTimeoutMs);
    }

    @PrePersist
    protected void onCreate() {
        if (revision <= 0) {
            revision = 1;
        }
        if (clientAuthMethod == null || clientAuthMethod.isBlank()) {
            clientAuthMethod = CLIENT_SECRET_BASIC;
        }
        if (tokenEndpoint == null) tokenEndpoint = "";
        if (clientId == null) clientId = "";
        if (clientSecret == null) clientSecret = "";
        if (scopes == null) scopes = "";
        if (audience == null) audience = "";
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    private void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw invalid(field + " must be configured when OAuth is enabled");
        }
    }

    private OAuthTokenException invalid(String message) {
        return new OAuthTokenException(OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID, message);
    }
}
