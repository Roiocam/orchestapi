package com.orchestrator.dto;

import com.orchestrator.model.EnvironmentOAuthConfig;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentOAuthResponse {

    private boolean enabled;
    private String tokenEndpoint;
    private String clientId;
    private String clientSecret;
    private boolean clientSecretConfigured;
    private String scopes;
    private String audience;
    private String clientAuthMethod;
    private long refreshSkewSeconds;
    private long requestTimeoutMs;

    public static EnvironmentOAuthResponse from(EnvironmentOAuthConfig config) {
        boolean configured = config != null
                && config.getClientSecret() != null
                && !config.getClientSecret().isBlank();
        if (config == null) {
            return EnvironmentOAuthResponse.builder()
                    .enabled(false)
                    .clientSecret("")
                    .clientSecretConfigured(false)
                    .clientAuthMethod(EnvironmentOAuthConfig.CLIENT_SECRET_BASIC)
                    .refreshSkewSeconds(60)
                    .requestTimeoutMs(10_000)
                    .build();
        }
        return EnvironmentOAuthResponse.builder()
                .enabled(config.isEnabled())
                .tokenEndpoint(config.getTokenEndpoint())
                .clientId(config.getClientId())
                .clientSecret(configured ? EnvironmentOAuthConfig.MASKED_SECRET : "")
                .clientSecretConfigured(configured)
                .scopes(config.getScopes())
                .audience(config.getAudience())
                .clientAuthMethod(config.getClientAuthMethod())
                .refreshSkewSeconds(config.getRefreshSkewSeconds())
                .requestTimeoutMs(config.getRequestTimeoutMs())
                .build();
    }
}
