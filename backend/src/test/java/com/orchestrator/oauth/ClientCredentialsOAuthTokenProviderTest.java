package com.orchestrator.oauth;

import com.orchestrator.config.OAuthProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.ExpectedCount.times;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.startsWith;

class ClientCredentialsOAuthTokenProviderTest {

    private static final String ENDPOINT = "https://idp.example.test/oauth/token";

    private RestTemplate restTemplate;
    private MockRestServiceServer server;
    private MutableClock clock;
    private OAuthProperties properties;

    @BeforeEach
    void setUp() {
        restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        clock = new MutableClock(Instant.parse("2030-01-01T00:00:00Z"));
        properties = validProperties("client_secret_basic");
    }

    @Test
    void requestsClientCredentialsAndReusesTokenUntilRefreshAt() {
        server.expect(once(), requestTo(ENDPOINT))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header(HttpHeaders.AUTHORIZATION, startsWith("Basic ")))
                .andExpect(header(HttpHeaders.CONTENT_TYPE, startsWith(MediaType.APPLICATION_FORM_URLENCODED_VALUE)))
                .andExpect(content().string(allOf(
                        containsString("grant_type=client_credentials"),
                        containsString("scope=orders.read"))))
                .andRespond(withSuccess(
                        "{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":300}",
                        MediaType.APPLICATION_JSON));

        ClientCredentialsOAuthTokenProvider provider = provider();

        assertThat(provider.getToken().value()).isEqualTo("token-1");
        clock.advanceSeconds(239);
        assertThat(provider.getToken().value()).isEqualTo("token-1");
        server.verify();
    }

    @Test
    void serializesConcurrentRefreshes() throws Exception {
        server.expect(once(), requestTo(ENDPOINT))
                .andRespond(withSuccess(
                        "{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":300}",
                        MediaType.APPLICATION_JSON));

        ClientCredentialsOAuthTokenProvider provider = provider();
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Future<String>> futures = IntStream.range(0, 8)
                    .mapToObj(index -> executor.submit(() -> provider.getToken().value()))
                    .toList();

            assertThat(futures).allSatisfy(future -> assertThat(future.get()).isEqualTo("token-1"));
        } finally {
            executor.shutdownNow();
        }
        server.verify();
    }

    @Test
    void sendsPostClientAuthenticationAndAudience() {
        properties.setClientAuthMethod("client_secret_post");
        properties.setAudience("orders-api");
        server.expect(once(), requestTo(ENDPOINT))
                .andExpect(method(HttpMethod.POST))
                .andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
                .andExpect(content().string(allOf(
                        containsString("client_id=service-client"),
                        containsString("client_secret=client-secret-value"),
                        containsString("audience=orders-api"))))
                .andRespond(withSuccess(
                        "{\"access_token\":\"token-post\",\"token_type\":\"Bearer\",\"expires_in\":300}",
                        MediaType.APPLICATION_JSON));

        assertThat(provider().getToken().authorizationValue()).isEqualTo("Bearer token-post");
        server.verify();
    }

    @Test
    void mapsHttpRejectionWithoutExposingResponseBody() {
        server.expect(once(), requestTo(ENDPOINT))
                .andRespond(withStatus(UNAUTHORIZED)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("secret upstream response"));

        assertThatThrownBy(() -> provider().getToken())
                .isInstanceOf(OAuthTokenException.class)
                .satisfies(error -> {
                    OAuthTokenException exception = (OAuthTokenException) error;
                    assertThat(exception.getCode()).isEqualTo(OAuthTokenErrorCode.OAUTH_TOKEN_REQUEST_REJECTED);
                    assertThat(exception.getHttpStatus()).isEqualTo(401);
                    assertThat(exception).hasMessageNotContaining("secret upstream response");
                    assertThat(exception).hasMessageNotContaining("client-secret-value");
                });
        server.verify();
    }

    @Test
    void mapsConnectionFailureToEndpointUnavailable() {
        server.expect(once(), requestTo(ENDPOINT))
                .andRespond(withException(new IOException("connection refused")));

        assertThatThrownBy(() -> provider().getToken())
                .isInstanceOf(OAuthTokenException.class)
                .extracting("code")
                .isEqualTo(OAuthTokenErrorCode.OAUTH_TOKEN_ENDPOINT_UNAVAILABLE);
        server.verify();
    }

    @Test
    void rejectsInvalidTokenResponses() {
        server.expect(once(), requestTo(ENDPOINT))
                .andRespond(withSuccess(
                        "{\"access_token\":\"token-1\",\"token_type\":\"MAC\",\"expires_in\":300}",
                        MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> provider().getToken())
                .isInstanceOf(OAuthTokenException.class)
                .extracting("code")
                .isEqualTo(OAuthTokenErrorCode.OAUTH_TOKEN_RESPONSE_INVALID);
        server.verify();
    }

    @Test
    void refreshesAfterRefreshAtAndInvalidateForcesRefresh() {
        server.expect(times(2), requestTo(ENDPOINT))
                .andRespond(withSuccess(
                        "{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":120}",
                        MediaType.APPLICATION_JSON));

        ClientCredentialsOAuthTokenProvider provider = provider();
        assertThat(provider.getToken().value()).isEqualTo("token-1");
        provider.invalidate();
        assertThat(provider.getToken().value()).isEqualTo("token-1");
        server.verify();
    }

    private ClientCredentialsOAuthTokenProvider provider() {
        return new ClientCredentialsOAuthTokenProvider(properties, restTemplate, clock);
    }

    private OAuthProperties validProperties(String authMethod) {
        OAuthProperties result = new OAuthProperties();
        result.setEnabled(true);
        result.setTokenEndpoint(ENDPOINT);
        result.setClientId("service-client");
        result.setClientSecret("client-secret-value");
        result.setScopes("orders.read");
        result.setClientAuthMethod(authMethod);
        result.setRefreshSkewSeconds(60);
        result.setRequestTimeoutMs(10_000);
        return result;
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advanceSeconds(long seconds) {
            instant = instant.plusSeconds(seconds);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
