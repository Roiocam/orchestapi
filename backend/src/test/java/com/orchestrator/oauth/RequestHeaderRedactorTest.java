package com.orchestrator.oauth;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RequestHeaderRedactorTest {

    private final RequestHeaderRedactor redactor = new RequestHeaderRedactor();

    @Test
    void redactsAuthorizationCaseInsensitivelyAndPreservesOtherHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.add("authorization", "Bearer token-1");
        headers.add("X-Trace", "trace-1");

        Map<String, String> display = redactor.toDisplayMap(headers);

        assertThat(display.get("authorization")).isEqualTo("<redacted>");
        assertThat(display.get("X-Trace")).isEqualTo("trace-1");
        assertThat(redactor.redact("AUTHORIZATION", "Basic secret")).isEqualTo("<redacted>");
        assertThat(redactor.redact("X-Trace", "trace-1")).isEqualTo("trace-1");
    }
}
