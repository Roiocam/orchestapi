package com.orchestrator.oauth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

@Slf4j
public class ClientCredentialsOAuthTokenProvider implements OAuthTokenProvider {

    private final Function<Long, RestTemplate> restTemplateFactory;
    private final Clock clock;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<UUID, CachedToken> cachedTokens = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Object> refreshMonitors = new ConcurrentHashMap<>();

    public ClientCredentialsOAuthTokenProvider(
            Function<Long, RestTemplate> restTemplateFactory, Clock clock) {
        this(restTemplateFactory, clock, new ObjectMapper());
    }

    ClientCredentialsOAuthTokenProvider(
            Function<Long, RestTemplate> restTemplateFactory, Clock clock, ObjectMapper objectMapper) {
        this.restTemplateFactory = Objects.requireNonNull(restTemplateFactory, "restTemplateFactory");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    @Override
    public OAuthAccessToken getToken(EnvironmentOAuthSnapshot oauth) {
        validate(oauth);
        UUID environmentId = oauth.environmentId();
        Instant now = Instant.now(clock);
        CachedToken current = cachedTokens.get(environmentId);
        if (current != null && current.revision() == oauth.revision() && now.isBefore(current.refreshAt())) {
            return current.token();
        }

        Object refreshMonitor = refreshMonitors.computeIfAbsent(environmentId, ignored -> new Object());
        synchronized (refreshMonitor) {
            now = Instant.now(clock);
            current = cachedTokens.get(environmentId);
            if (current != null && current.revision() == oauth.revision() && now.isBefore(current.refreshAt())) {
                return current.token();
            }

            CachedToken refreshed = requestToken(oauth);
            cachedTokens.put(environmentId, refreshed);
            return refreshed.token();
        }
    }

    @Override
    public void invalidate(UUID environmentId) {
        if (environmentId != null) {
            cachedTokens.remove(environmentId);
        }
    }

    private CachedToken requestToken(EnvironmentOAuthSnapshot oauth) {
        URI endpoint = URI.create(oauth.tokenEndpoint().trim());
        long startedAt = clock.millis();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        addOptionalFormValue(form, "scope", oauth.scopes());
        addOptionalFormValue(form, "audience", oauth.audience());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        if ("client_secret_basic".equals(oauth.clientAuthMethod())) {
            headers.setBasicAuth(
                    oauth.clientId(), oauth.clientSecret(), StandardCharsets.UTF_8);
        } else {
            form.add("client_id", oauth.clientId());
            form.add("client_secret", oauth.clientSecret());
        }

        try {
            RestTemplate restTemplate = restTemplateFactory.apply(oauth.requestTimeoutMs());
            ResponseEntity<String> response = restTemplate.exchange(
                    endpoint,
                    HttpMethod.POST,
                    new HttpEntity<>(form, headers),
                    String.class);
            ParsedToken parsed = parseToken(response.getBody());
            Instant issuedAt = Instant.now(clock);
            Instant expiresAt;
            Instant refreshAt;
            try {
                expiresAt = issuedAt.plusSeconds(parsed.expiresInSeconds());
                refreshAt = issuedAt.plusSeconds(
                        Math.max(1, parsed.expiresInSeconds() - oauth.refreshSkewSeconds()));
            } catch (ArithmeticException exception) {
                throw invalidResponse();
            }
            OAuthAccessToken token = new OAuthAccessToken(parsed.value(), parsed.tokenType(), expiresAt);
            log.debug(
                    "OAuth token request endpointHost={} status={} durationMs={} cache=refreshed",
                    endpoint.getHost(),
                    response.getStatusCode().value(),
                    Math.max(0, clock.millis() - startedAt));
            return new CachedToken(oauth.revision(), token, refreshAt);
        } catch (OAuthTokenException exception) {
            throw exception;
        } catch (HttpStatusCodeException exception) {
            int status = exception.getStatusCode().value();
            log.debug(
                    "OAuth token request endpointHost={} status={} durationMs={} cache=failed",
                    endpoint.getHost(), status, Math.max(0, clock.millis() - startedAt));
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_TOKEN_REQUEST_REJECTED,
                    "OAuth token request was rejected by the endpoint (HTTP " + status + ")",
                    status);
        } catch (ResourceAccessException exception) {
            log.debug(
                    "OAuth token request endpointHost={} status=unavailable durationMs={} cache=failed",
                    endpoint.getHost(), Math.max(0, clock.millis() - startedAt));
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_TOKEN_ENDPOINT_UNAVAILABLE,
                    "OAuth token endpoint is unavailable");
        } catch (RestClientException exception) {
            log.debug(
                    "OAuth token request endpointHost={} status=unavailable durationMs={} cache=failed",
                    endpoint.getHost(), Math.max(0, clock.millis() - startedAt));
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_TOKEN_ENDPOINT_UNAVAILABLE,
                    "OAuth token endpoint is unavailable");
        }
    }

    private ParsedToken parseToken(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            throw invalidResponse();
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(responseBody);
        } catch (JsonProcessingException exception) {
            throw invalidResponse();
        }
        if (root == null || !root.isObject()) {
            throw invalidResponse();
        }

        JsonNode accessToken = root.get("access_token");
        JsonNode tokenType = root.get("token_type");
        JsonNode expiresIn = root.get("expires_in");
        if (accessToken == null || !accessToken.isTextual() || accessToken.textValue().isBlank()
                || tokenType == null || !tokenType.isTextual()
                || !"Bearer".equalsIgnoreCase(tokenType.textValue().trim())
                || expiresIn == null || !expiresIn.isIntegralNumber() || expiresIn.asLong() <= 0) {
            throw invalidResponse();
        }

        long expiresInSeconds = expiresIn.asLong();
        return new ParsedToken(accessToken.textValue(), "Bearer", expiresInSeconds);
    }

    private OAuthTokenException invalidResponse() {
        return new OAuthTokenException(
                OAuthTokenErrorCode.OAUTH_TOKEN_RESPONSE_INVALID,
                "OAuth token endpoint returned an invalid response");
    }

    private void addOptionalFormValue(
            MultiValueMap<String, String> form, String name, String value) {
        if (value != null && !value.isBlank()) {
            form.add(name, value.trim());
        }
    }

    private void validate(EnvironmentOAuthSnapshot oauth) {
        if (oauth == null || !oauth.enabled()) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth is not enabled for this environment");
        }
        if (oauth.tokenEndpoint().isBlank()
                || oauth.clientId().isBlank()
                || oauth.clientSecret().isBlank()) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth token endpoint, client id and client secret must be configured");
        }
        URI endpoint;
        try {
            endpoint = URI.create(oauth.tokenEndpoint().trim());
        } catch (IllegalArgumentException exception) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth token endpoint must be a valid http(s) URL");
        }
        if (!endpoint.isAbsolute()
                || !("http".equalsIgnoreCase(endpoint.getScheme())
                || "https".equalsIgnoreCase(endpoint.getScheme()))) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth token endpoint must be an absolute http(s) URL");
        }
        if (!"client_secret_basic".equals(oauth.clientAuthMethod())
                && !"client_secret_post".equals(oauth.clientAuthMethod())) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth client authentication method must be client_secret_basic or client_secret_post");
        }
        if (oauth.requestTimeoutMs() <= 0 || oauth.refreshSkewSeconds() < 0) {
            throw new OAuthTokenException(
                    OAuthTokenErrorCode.OAUTH_CONFIGURATION_INVALID,
                    "OAuth request timeout and refresh skew must be valid positive values");
        }
    }

    private record ParsedToken(String value, String tokenType, long expiresInSeconds) {}

    private record CachedToken(long revision, OAuthAccessToken token, Instant refreshAt) {}
}
