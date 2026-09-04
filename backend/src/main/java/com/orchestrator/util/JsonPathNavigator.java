package com.orchestrator.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.jayway.jsonpath.Configuration;
import com.jayway.jsonpath.JsonPath;
import com.jayway.jsonpath.Option;
import com.jayway.jsonpath.spi.json.JacksonJsonNodeJsonProvider;
import com.jayway.jsonpath.spi.mapper.JacksonMappingProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Shared JSONPath evaluation (Jayway) for variable extraction, validations, mock/webhook matching.
 * <p>
 * Supports standard paths, array indexes, {@code length()}/{@code size()}, and filters such as
 * {@code $.data.items[?(@.name=='xxx')].id}. Filter/wildcard results that are arrays unwrap to the
 * first matching element for scalar extraction.
 */
public final class JsonPathNavigator {

    private static final Logger log = LoggerFactory.getLogger(JsonPathNavigator.class);

    private JsonPathNavigator() {}

    public static String extractAsText(ObjectMapper objectMapper, String json, String jsonPath) {
        if (json == null || json.isEmpty() || jsonPath == null || jsonPath.isEmpty()) {
            return "";
        }
        try {
            JsonNode root = objectMapper.readTree(json);
            return nodeToText(extractAsNode(objectMapper, root, jsonPath));
        } catch (Exception e) {
            log.warn("Failed to parse JSON for path extraction '{}': {}", jsonPath, e.getMessage());
            return "";
        }
    }

    public static JsonNode extractAsNode(ObjectMapper objectMapper, String json, String jsonPath) {
        if (json == null || json.isEmpty() || jsonPath == null || jsonPath.isEmpty()) {
            return MissingNode.getInstance();
        }
        try {
            JsonNode root = objectMapper.readTree(json);
            return extractAsNode(objectMapper, root, jsonPath);
        } catch (Exception e) {
            log.warn("Failed to parse JSON for path navigation '{}': {}", jsonPath, e.getMessage());
            return MissingNode.getInstance();
        }
    }

    public static JsonNode extractAsNode(ObjectMapper objectMapper, JsonNode root, String jsonPath) {
        if (root == null || jsonPath == null || jsonPath.isEmpty()) {
            return MissingNode.getInstance();
        }

        String path = normalizePath(jsonPath);
        Configuration conf = configuration(objectMapper);

        try {
            Object raw = JsonPath.using(conf).parse(root).read(path);
            JsonNode node = toJsonNode(objectMapper, raw);
            if (node == null || node.isMissingNode() || node.isNull()) {
                return MissingNode.getInstance();
            }
            return unwrapIndefiniteResult(node, path);
        } catch (Exception e) {
            log.debug("JSONPath '{}' evaluation failed: {}", path, e.getMessage());
            return MissingNode.getInstance();
        }
    }

    static String normalizePath(String jsonPath) {
        String path = jsonPath.trim();
        if (!path.startsWith("$")) {
            path = "$." + path;
        }
        // Preserve legacy alias: size() → length()
        path = path.replace(".size()", ".length()");
        return path;
    }

    private static Configuration configuration(ObjectMapper objectMapper) {
        return Configuration.builder()
                .jsonProvider(new JacksonJsonNodeJsonProvider(objectMapper))
                .mappingProvider(new JacksonMappingProvider(objectMapper))
                .options(Option.SUPPRESS_EXCEPTIONS)
                .build();
    }

    private static JsonNode toJsonNode(ObjectMapper objectMapper, Object raw) {
        if (raw == null) {
            return MissingNode.getInstance();
        }
        if (raw instanceof JsonNode node) {
            return node;
        }
        return objectMapper.valueToTree(raw);
    }

    /**
     * Filters and wildcards are indefinite paths and return arrays; take the first match
     * so variable extraction / equality matching stay scalar-friendly.
     */
    private static JsonNode unwrapIndefiniteResult(JsonNode node, String path) {
        if (!node.isArray()) {
            return node;
        }
        if (!(path.contains("[?") || path.contains("[*]") || path.contains(".."))) {
            return node;
        }
        if (node.isEmpty()) {
            return MissingNode.getInstance();
        }
        return node.get(0);
    }

    private static String nodeToText(JsonNode current) {
        if (current == null || current.isMissingNode() || current.isNull()) {
            return "";
        }
        if (current.isTextual()) {
            return current.asText();
        }
        if (current.isNumber() || current.isBoolean()) {
            return current.asText();
        }
        return current.toString();
    }
}
