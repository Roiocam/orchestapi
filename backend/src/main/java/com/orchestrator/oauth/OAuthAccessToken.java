package com.orchestrator.oauth;

import java.time.Instant;

public record OAuthAccessToken(String value, String tokenType, Instant expiresAt) {

    public String authorizationValue() {
        return tokenType + " " + value;
    }

    @Override
    public String toString() {
        return "OAuthAccessToken[value=<redacted>, tokenType=" + tokenType + ", expiresAt=" + expiresAt + "]";
    }
}
