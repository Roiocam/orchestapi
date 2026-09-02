package com.orchestrator.oauth;

import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Component
public class RequestHeaderRedactor {

    public static final String REDACTED = "<redacted>";

    public Map<String, String> toDisplayMap(HttpHeaders headers) {
        return toDisplayMap(headers, List.of());
    }

    public Map<String, String> toDisplayMap(HttpHeaders headers, Collection<String> secretValues) {
        Map<String, String> display = new LinkedHashMap<>();
        if (headers == null) {
            return display;
        }
        headers.forEach((name, values) -> {
            if (values != null && !values.isEmpty()) {
                display.put(name, redactSecrets(String.join(", ", values), secretValues));
            }
        });
        return display;
    }

    public Map<String, String> redactMap(Map<String, String> source, Collection<String> secretValues) {
        Map<String, String> display = new LinkedHashMap<>();
        if (source == null) {
            return display;
        }
        source.forEach((key, value) -> display.put(key, redactSecrets(value, secretValues)));
        return display;
    }

    /**
     * Replaces known secret values in {@code text}. Non-secret content (including Authorization
     * tokens that are not secret env values) is preserved for request replay.
     */
    public String redactSecrets(String text, Collection<String> secretValues) {
        if (text == null || text.isEmpty() || secretValues == null || secretValues.isEmpty()) {
            return text;
        }
        String result = text;
        List<String> sorted = secretValues.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .sorted(Comparator.comparingInt(String::length).reversed())
                .toList();
        for (String secret : sorted) {
            result = result.replace(secret, REDACTED);
        }
        return result;
    }
}
