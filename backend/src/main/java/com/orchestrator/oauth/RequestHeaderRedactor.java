package com.orchestrator.oauth;

import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class RequestHeaderRedactor {

    public Map<String, String> toDisplayMap(HttpHeaders headers) {
        Map<String, String> display = new LinkedHashMap<>();
        if (headers == null) {
            return display;
        }
        headers.forEach((name, values) -> {
            if (values != null && !values.isEmpty()) {
                display.put(name, redact(name, String.join(", ", values)));
            }
        });
        return display;
    }

    public String redact(String headerName, String value) {
        if (headerName != null && HttpHeaders.AUTHORIZATION.equalsIgnoreCase(headerName)) {
            if (value != null && value.matches("(?i)^Bearer\\s+<redacted>$")) {
                return value;
            }
            return "<redacted>";
        }
        return value;
    }
}
