package com.orchestrator.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentOAuthRequest {

    @Builder.Default
    private boolean enabled = false;

    private String tokenEndpoint;
    private String clientId;
    private String clientSecret;
    private String scopes;
    private String audience;
    private String clientAuthMethod;

    @Builder.Default
    private Long refreshSkewSeconds = 60L;

    @Builder.Default
    private Long requestTimeoutMs = 10_000L;

    @Builder.Default
    private boolean clearClientSecret = false;
}
