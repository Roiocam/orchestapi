package com.orchestrator.oauth;

import com.orchestrator.model.TestStep;
import com.orchestrator.model.enums.OAuthMode;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

import java.util.Objects;

@Component
public class DefaultOAuthRequestAuthorizer implements OAuthRequestAuthorizer {

    private final OAuthTokenProvider tokenProvider;

    public DefaultOAuthRequestAuthorizer(OAuthTokenProvider tokenProvider) {
        this.tokenProvider = Objects.requireNonNull(tokenProvider, "tokenProvider");
    }

    @Override
    public void apply(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers) {
        if (!shouldApply(step, oauth, headers)) {
            return;
        }
        headers.set(HttpHeaders.AUTHORIZATION, tokenProvider.getToken(oauth).authorizationValue());
    }

    @Override
    public void applyPreview(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers) {
        if (!shouldApply(step, oauth, headers)) {
            return;
        }
        headers.set(HttpHeaders.AUTHORIZATION, "Bearer <redacted>");
    }

    private boolean shouldApply(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers) {
        return headers != null
                && oauth != null
                && oauth.enabled()
                && step != null
                && (step.getOauthMode() == null || step.getOauthMode() == OAuthMode.INHERIT)
                && !headers.containsKey(HttpHeaders.AUTHORIZATION);
    }
}
