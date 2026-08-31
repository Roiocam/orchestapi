package com.orchestrator.oauth;

import com.orchestrator.model.TestStep;
import org.springframework.http.HttpHeaders;

public interface OAuthRequestAuthorizer {

    void apply(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers);

    void applyPreview(TestStep step, EnvironmentOAuthSnapshot oauth, HttpHeaders headers);
}
