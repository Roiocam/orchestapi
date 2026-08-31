package com.orchestrator.oauth;

public class NoopOAuthTokenProvider implements OAuthTokenProvider {

    @Override
    public OAuthAccessToken getToken() {
        throw new OAuthTokenException(
                OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                "OAuth token provider is disabled");
    }

    @Override
    public void invalidate() {
        // No token is held when OAuth is disabled.
    }
}
