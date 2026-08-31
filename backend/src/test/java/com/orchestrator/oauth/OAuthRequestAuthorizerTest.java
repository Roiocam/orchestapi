package com.orchestrator.oauth;

import com.orchestrator.config.OAuthProperties;
import com.orchestrator.model.TestStep;
import com.orchestrator.model.enums.OAuthMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OAuthRequestAuthorizerTest {

    private OAuthProperties properties;
    private OAuthTokenProvider provider;
    private DefaultOAuthRequestAuthorizer authorizer;

    @BeforeEach
    void setUp() {
        properties = new OAuthProperties();
        properties.setEnabled(true);
        provider = mock(OAuthTokenProvider.class);
        when(provider.getToken()).thenReturn(
                new OAuthAccessToken("token-1", "Bearer", Instant.parse("2030-01-01T00:05:00Z")));
        authorizer = new DefaultOAuthRequestAuthorizer(properties, provider);
    }

    @Test
    void injectsBearerTokenOnlyWhenInheritedAndAuthorizationIsAbsent() {
        HttpHeaders headers = new HttpHeaders();

        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), headers);

        assertThat(headers.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer token-1");
        verify(provider).getToken();
    }

    @Test
    void disabledModeAndExistingAuthorizationDoNotCallProvider() {
        HttpHeaders disabledHeaders = new HttpHeaders();
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.DISABLED).build(), disabledHeaders);

        HttpHeaders manualHeaders = new HttpHeaders();
        manualHeaders.set("authorization", "Bearer manual");
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), manualHeaders);

        assertThat(manualHeaders.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer manual");
        verifyNoInteractions(provider);
    }

    @Test
    void disabledDeploymentAndPreviewNeverCallProvider() {
        properties.setEnabled(false);
        HttpHeaders disabledDeployment = new HttpHeaders();
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), disabledDeployment);
        assertThat(disabledDeployment).isEmpty();

        properties.setEnabled(true);
        HttpHeaders preview = new HttpHeaders();
        authorizer.applyPreview(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), preview);
        assertThat(preview.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer <redacted>");
        verifyNoInteractions(provider);
    }

    @Test
    void previewAddsRedactedBearerWithoutMintingToken() {
        HttpHeaders headers = new HttpHeaders();

        authorizer.applyPreview(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), headers);

        assertThat(headers.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer <redacted>");
        verifyNoInteractions(provider);
    }
}
