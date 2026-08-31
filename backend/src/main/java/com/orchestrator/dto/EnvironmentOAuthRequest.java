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
    private long refreshSkewSeconds = 60;

    @Builder.Default
    private long requestTimeoutMs = 10_000;

    @Builder.Default
    private boolean clearClientSecret = false;
}
