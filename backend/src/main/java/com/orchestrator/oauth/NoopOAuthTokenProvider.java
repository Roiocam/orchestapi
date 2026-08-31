package com.orchestrator.oauth;

import java.util.UUID;

public class NoopOAuthTokenProvider implements OAuthTokenProvider {

    @Override
    public OAuthAccessToken getToken(EnvironmentOAuthSnapshot oauth) {
        throw new OAuthTokenException(
                OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                "OAuth token provider is disabled");
    }

    @Override
    public void invalidate(UUID environmentId) {
        // No token is held when OAuth is disabled.
    }
}
