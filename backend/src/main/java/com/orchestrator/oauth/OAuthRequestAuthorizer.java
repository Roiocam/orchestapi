package com.orchestrator.oauth;

import com.orchestrator.model.TestStep;
import org.springframework.http.HttpHeaders;

public interface OAuthRequestAuthorizer {

    void apply(TestStep step, HttpHeaders headers);

    void applyPreview(TestStep step, HttpHeaders headers);
}
