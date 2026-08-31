package com.orchestrator.oauth;

import com.orchestrator.model.TestStep;
import com.orchestrator.model.enums.OAuthMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OAuthRequestAuthorizerTest {

    private OAuthTokenProvider provider;
    private DefaultOAuthRequestAuthorizer authorizer;
    private EnvironmentOAuthSnapshot oauth;

    @BeforeEach
    void setUp() {
        provider = mock(OAuthTokenProvider.class);
        oauth = validSnapshot(true);
        when(provider.getToken(oauth)).thenReturn(
                new OAuthAccessToken("token-1", "Bearer", Instant.parse("2030-01-01T00:05:00Z")));
        authorizer = new DefaultOAuthRequestAuthorizer(provider);
    }

    @Test
    void injectsBearerTokenOnlyWhenInheritedAndAuthorizationIsAbsent() {
        HttpHeaders headers = new HttpHeaders();

        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), oauth, headers);

        assertThat(headers.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer token-1");
        verify(provider).getToken(oauth);
    }

    @Test
    void disabledModeAndExistingAuthorizationDoNotCallProvider() {
        HttpHeaders disabledHeaders = new HttpHeaders();
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.DISABLED).build(), oauth, disabledHeaders);

        HttpHeaders manualHeaders = new HttpHeaders();
        manualHeaders.set("authorization", "Bearer manual");
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), oauth, manualHeaders);

        assertThat(manualHeaders.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer manual");
        verifyNoInteractions(provider);
    }

    @Test
    void disabledEnvironmentAndPreviewNeverCallProvider() {
        EnvironmentOAuthSnapshot disabled = validSnapshot(false);
        HttpHeaders disabledDeployment = new HttpHeaders();
        authorizer.apply(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), disabled, disabledDeployment);
        assertThat(disabledDeployment).isEmpty();

        HttpHeaders preview = new HttpHeaders();
        authorizer.applyPreview(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), oauth, preview);
        assertThat(preview.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer <redacted>");
        verifyNoInteractions(provider);
    }

    @Test
    void previewAddsRedactedBearerWithoutMintingToken() {
        HttpHeaders headers = new HttpHeaders();

        authorizer.applyPreview(TestStep.builder().oauthMode(OAuthMode.INHERIT).build(), oauth, headers);

        assertThat(headers.getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer <redacted>");
        verifyNoInteractions(provider);
    }

    private EnvironmentOAuthSnapshot validSnapshot(boolean enabled) {
        return new EnvironmentOAuthSnapshot(
                UUID.randomUUID(), 1, enabled,
                "https://idp.example.test/oauth/token", "service-client", "client-secret",
                "orders.read", "", "client_secret_basic", 60, 10_000);
    }
}
