package com.orchestrator.oauth;

public interface OAuthTokenProvider {

    OAuthAccessToken getToken();

    void invalidate();
}
