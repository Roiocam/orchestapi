package com.orchestrator.oauth;

import org.junit.jupiter.api.AfterEach;
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
import java.util.UUID;
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
    private EnvironmentOAuthSnapshot oauth;

    @BeforeEach
    void setUp() {
        restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        clock = new MutableClock(Instant.parse("2030-01-01T00:00:00Z"));
        oauth = validSnapshot(UUID.randomUUID(), ENDPOINT, "service-client", "client_secret_basic", 10_000);
    }

    @AfterEach
    void tearDown() {
        server.reset();
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

        assertThat(provider.getToken(oauth).value()).isEqualTo("token-1");
        clock.advanceSeconds(239);
        assertThat(provider.getToken(oauth).value()).isEqualTo("token-1");
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
                    .mapToObj(index -> executor.submit(() -> provider.getToken(oauth).value()))
                    .toList();

            assertThat(futures).allSatisfy(future -> assertThat(future.get()).isEqualTo("token-1"));
        } finally {
            executor.shutdownNow();
        }
        server.verify();
    }

    @Test
    void sendsPostClientAuthenticationAndAudience() {
        oauth = validSnapshot(UUID.randomUUID(), ENDPOINT, "service-client", "client_secret_post", 10_000);
        oauth = new EnvironmentOAuthSnapshot(
                oauth.environmentId(), oauth.revision(), oauth.enabled(), oauth.tokenEndpoint(), oauth.clientId(),
                oauth.clientSecret(), oauth.scopes(), "orders-api", oauth.clientAuthMethod(),
                oauth.refreshSkewSeconds(), oauth.requestTimeoutMs());
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

        assertThat(provider().getToken(oauth).authorizationValue()).isEqualTo("Bearer token-post");
        server.verify();
    }

    @Test
    void mapsHttpRejectionWithoutExposingResponseBody() {
        server.expect(once(), requestTo(ENDPOINT))
                .andRespond(withStatus(UNAUTHORIZED)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("secret upstream response"));

        assertThatThrownBy(() -> provider().getToken(oauth))
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

        assertThatThrownBy(() -> provider().getToken(oauth))
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

        assertThatThrownBy(() -> provider().getToken(oauth))
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
        assertThat(provider.getToken(oauth).value()).isEqualTo("token-1");
        provider.invalidate(oauth.environmentId());
        assertThat(provider.getToken(oauth).value()).isEqualTo("token-1");
        server.verify();
    }

    @Test
    void isolatesCachesByEnvironmentAndRevision() {
        UUID firstId = UUID.randomUUID();
        UUID secondId = UUID.randomUUID();
        EnvironmentOAuthSnapshot first = validSnapshot(firstId, ENDPOINT + "-first", "first-client", "client_secret_basic", 10_000);
        EnvironmentOAuthSnapshot second = validSnapshot(secondId, ENDPOINT + "-second", "second-client", "client_secret_basic", 10_000);
        server.expect(once(), requestTo(ENDPOINT + "-first"))
                .andRespond(withSuccess("{\"access_token\":\"first-token\",\"token_type\":\"Bearer\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
        server.expect(once(), requestTo(ENDPOINT + "-second"))
                .andRespond(withSuccess("{\"access_token\":\"second-token\",\"token_type\":\"Bearer\",\"expires_in\":300}", MediaType.APPLICATION_JSON));

        ClientCredentialsOAuthTokenProvider provider = provider();

        assertThat(provider.getToken(first).value()).isEqualTo("first-token");
        assertThat(provider.getToken(second).value()).isEqualTo("second-token");
        assertThat(provider.getToken(first).value()).isEqualTo("first-token");
        server.verify();
    }

    @Test
    void revisionChangeForcesRefreshAndPassesEnvironmentTimeoutToFactory() {
        java.util.concurrent.atomic.AtomicLong timeout = new java.util.concurrent.atomic.AtomicLong();
        server.expect(times(2), requestTo(ENDPOINT))
                .andRespond(withSuccess("{\"access_token\":\"token-1\",\"token_type\":\"Bearer\",\"expires_in\":120}", MediaType.APPLICATION_JSON));
        EnvironmentOAuthSnapshot revised = new EnvironmentOAuthSnapshot(
                oauth.environmentId(), oauth.revision() + 1, oauth.enabled(), oauth.tokenEndpoint(), oauth.clientId(),
                oauth.clientSecret(), oauth.scopes(), oauth.audience(), oauth.clientAuthMethod(),
                oauth.refreshSkewSeconds(), 2_345);
        ClientCredentialsOAuthTokenProvider provider = new ClientCredentialsOAuthTokenProvider(
                requestTimeoutMs -> {
                    timeout.set(requestTimeoutMs);
                    return restTemplate;
                }, clock);

        provider.getToken(oauth);
        provider.getToken(revised);

        assertThat(timeout).hasValue(2_345);
        server.verify();
    }

    private ClientCredentialsOAuthTokenProvider provider() {
        return new ClientCredentialsOAuthTokenProvider(requestTimeoutMs -> restTemplate, clock);
    }

    private EnvironmentOAuthSnapshot validSnapshot(
            UUID environmentId, String endpoint, String clientId, String authMethod, long timeoutMs) {
        return new EnvironmentOAuthSnapshot(
                environmentId,
                1,
                true,
                endpoint,
                clientId,
                "client-secret-value",
                "orders.read",
                "",
                authMethod,
                60,
                timeoutMs);
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
