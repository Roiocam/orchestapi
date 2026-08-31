package com.orchestrator.oauth;

import java.util.Objects;
import java.util.UUID;

/**
 * Immutable OAuth configuration copied from an Environment before execution can leave its transaction.
 * The client secret is intentionally only accessible to the token provider and is redacted from diagnostics.
 */
public record EnvironmentOAuthSnapshot(
        UUID environmentId,
        long revision,
        boolean enabled,
        String tokenEndpoint,
        String clientId,
        String clientSecret,
        String scopes,
        String audience,
        String clientAuthMethod,
        long refreshSkewSeconds,
        long requestTimeoutMs) {

    public EnvironmentOAuthSnapshot {
        environmentId = Objects.requireNonNull(environmentId, "environmentId");
        tokenEndpoint = normalize(tokenEndpoint);
        clientId = normalize(clientId);
        clientSecret = normalize(clientSecret);
        scopes = normalize(scopes);
        audience = normalize(audience);
        clientAuthMethod = normalize(clientAuthMethod);
    }

    public boolean hasClientSecret() {
        return !clientSecret.isBlank();
    }

    @Override
    public String toString() {
        return "EnvironmentOAuthSnapshot[environmentId=" + environmentId
                + ", revision=" + revision
                + ", enabled=" + enabled
                + ", tokenEndpoint=" + tokenEndpoint
                + ", clientId=" + clientId
                + ", clientSecret=<redacted>"
                + ", scopes=" + scopes
                + ", audience=" + audience
                + ", clientAuthMethod=" + clientAuthMethod
                + ", refreshSkewSeconds=" + refreshSkewSeconds
                + ", requestTimeoutMs=" + requestTimeoutMs + "]";
    }

    private static String normalize(String value) {
        return value == null ? "" : value;
    }
}
