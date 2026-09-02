package com.orchestrator.oauth;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class RequestHeaderRedactorTest {

    private final RequestHeaderRedactor redactor = new RequestHeaderRedactor();

    @Test
    void preservesAuthorizationUnlessValueIsAKnownSecret() {
        HttpHeaders headers = new HttpHeaders();
        headers.add("Authorization", "Bearer token-1");
        headers.add("X-Api-Key", "super-secret-key");
        headers.add("X-Trace", "trace-1");

        Map<String, String> display = redactor.toDisplayMap(headers, Set.of("super-secret-key"));

        assertThat(display.get("Authorization")).isEqualTo("Bearer token-1");
        assertThat(display.get("X-Api-Key")).isEqualTo(RequestHeaderRedactor.REDACTED);
        assertThat(display.get("X-Trace")).isEqualTo("trace-1");
    }

    @Test
    void redactsSecretSubstringsInBodyAndUrl() {
        String body = "{\"password\":\"p@ss\",\"token\":\"keep-me\"}";
        String redacted = redactor.redactSecrets(body, List.of("p@ss"));

        assertThat(redacted).isEqualTo("{\"password\":\"<redacted>\",\"token\":\"keep-me\"}");
        assertThat(redactor.redactSecrets("https://x/?k=p@ss", List.of("p@ss")))
                .isEqualTo("https://x/?k=<redacted>");
    }

    @Test
    void ignoresBlankSecretsAndRedactsLongestFirst() {
        String text = "ab abc";
        assertThat(redactor.redactSecrets(text, List.of("", " ", "abc", "ab")))
                .isEqualTo("<redacted> <redacted>");
    }
}
