package com.orchestrator.oauth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.config.OAuthProperties;
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
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

@Slf4j
public class ClientCredentialsOAuthTokenProvider implements OAuthTokenProvider {

    private final OAuthProperties properties;
    private final RestTemplate restTemplate;
    private final Clock clock;
    private final ObjectMapper objectMapper;
    private final Object refreshMonitor = new Object();
    private volatile CachedToken cachedToken;

    public ClientCredentialsOAuthTokenProvider(
            OAuthProperties properties, RestTemplate restTemplate, Clock clock) {
        this(properties, restTemplate, clock, new ObjectMapper());
    }

    ClientCredentialsOAuthTokenProvider(
            OAuthProperties properties, RestTemplate restTemplate, Clock clock, ObjectMapper objectMapper) {
        this.properties = Objects.requireNonNull(properties, "properties");
        this.restTemplate = Objects.requireNonNull(restTemplate, "restTemplate");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.properties.validate();
    }

    @Override
    public OAuthAccessToken getToken() {
        Instant now = Instant.now(clock);
        CachedToken current = cachedToken;
        if (current != null && now.isBefore(current.refreshAt())) {
            return current.token();
        }

        synchronized (refreshMonitor) {
            now = Instant.now(clock);
            current = cachedToken;
            if (current != null && now.isBefore(current.refreshAt())) {
                return current.token();
            }

            CachedToken refreshed = requestToken();
            cachedToken = refreshed;
            return refreshed.token();
        }
    }

    @Override
    public void invalidate() {
        cachedToken = null;
    }

    private CachedToken requestToken() {
        URI endpoint = URI.create(properties.getTokenEndpoint().trim());
        long startedAt = clock.millis();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        addOptionalFormValue(form, "scope", properties.getScopes());
        addOptionalFormValue(form, "audience", properties.getAudience());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        if ("client_secret_basic".equals(properties.getClientAuthMethod())) {
            headers.setBasicAuth(
                    properties.getClientId(), properties.getClientSecret(), StandardCharsets.UTF_8);
        } else {
            form.add("client_id", properties.getClientId());
            form.add("client_secret", properties.getClientSecret());
        }

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    endpoint,
                    HttpMethod.POST,
                    new HttpEntity<>(form, headers),
                    String.class);
            OAuthAccessToken token = parseToken(response.getBody());
            Instant issuedAt = Instant.now(clock);
            long expiresIn = Duration.between(issuedAt, token.expiresAt()).getSeconds();
            Instant refreshAt = issuedAt.plusSeconds(
                    Math.max(1, expiresIn - properties.getRefreshSkewSeconds()));
            log.debug(
                    "OAuth token request endpointHost={} status={} durationMs={} cache=refreshed",
                    endpoint.getHost(),
                    response.getStatusCode().value(),
                    Math.max(0, clock.millis() - startedAt));
            return new CachedToken(token, refreshAt);
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

    private OAuthAccessToken parseToken(String responseBody) {
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
        Instant issuedAt = Instant.now(clock);
        Instant expiresAt;
        try {
            expiresAt = issuedAt.plusSeconds(expiresInSeconds);
        } catch (ArithmeticException exception) {
            throw invalidResponse();
        }
        return new OAuthAccessToken(accessToken.textValue(), "Bearer", expiresAt);
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

    private record CachedToken(OAuthAccessToken token, Instant refreshAt) {}
}
