package com.orchestrator.oauth;

import com.orchestrator.config.OAuthProperties;
import com.orchestrator.model.TestStep;
import com.orchestrator.model.enums.OAuthMode;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

import java.util.Objects;

@Component
public class DefaultOAuthRequestAuthorizer implements OAuthRequestAuthorizer {

    private final OAuthProperties properties;
    private final OAuthTokenProvider tokenProvider;

    public DefaultOAuthRequestAuthorizer(
            OAuthProperties properties, OAuthTokenProvider tokenProvider) {
        this.properties = Objects.requireNonNull(properties, "properties");
        this.tokenProvider = Objects.requireNonNull(tokenProvider, "tokenProvider");
    }

    @Override
    public void apply(TestStep step, HttpHeaders headers) {
        if (!shouldApply(step, headers)) {
            return;
        }
        headers.set(HttpHeaders.AUTHORIZATION, tokenProvider.getToken().authorizationValue());
    }

    @Override
    public void applyPreview(TestStep step, HttpHeaders headers) {
        if (!shouldApply(step, headers)) {
            return;
        }
        headers.set(HttpHeaders.AUTHORIZATION, "Bearer <redacted>");
    }

    private boolean shouldApply(TestStep step, HttpHeaders headers) {
        return headers != null
                && properties.isEnabled()
                && step != null
                && (step.getOauthMode() == null || step.getOauthMode() == OAuthMode.INHERIT)
                && !headers.containsKey(HttpHeaders.AUTHORIZATION);
    }
}
