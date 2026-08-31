package com.orchestrator.oauth;

import java.util.UUID;

public interface OAuthTokenProvider {

    OAuthAccessToken getToken(EnvironmentOAuthSnapshot oauth);

    void invalidate(UUID environmentId);
}
