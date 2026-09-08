package com.orchestrator.service;

import com.fasterxml.jackson.core.JsonPointer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.orchestrator.model.CursorPaginationConfig;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

/** Per-execution page evidence and cursor state; an incomplete tail is replaced on every poll. */
final class CursorPaginationState {
    private static final int MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
    private final CursorPaginationConfig config;
    private final ObjectMapper mapper;
    private final ArrayNode completed;
    private final Set<String> seen = new HashSet<>();
    private String url;
    private String next;
    private ArrayNode currentItems;
    private int pages = 1;
    private long completedBytes;

    CursorPaginationState(CursorPaginationConfig config, ObjectMapper mapper, String url) {
        this.config = config;
        this.mapper = mapper;
        this.url = url;
        completed = mapper.createArrayNode();
        seen.add(cursorValue(url, config.cursorParam()));
    }

    String url() { return url; }

    /** Retains full-page evidence but replaces the last partial page to avoid duplicate items. */
    String accept(String body) {
        try {
            if (completedBytes + utf8Size(body) > MAX_EVIDENCE_BYTES) {
                throw new IllegalArgumentException("cursor pagination exceeded 16 MiB evidence limit");
            }
            JsonNode root = mapper.readTree(body);
            if (root == null) throw new IllegalArgumentException("cursor pagination response is empty");
            JsonNode items = root.at(config.itemsPath());
            JsonNode cursor = root.at(config.nextCursorPath());
            if (!items.isArray() || cursor.isMissingNode()
                    || !(cursor.isNull() || cursor.isTextual() || cursor.isIntegralNumber())) {
                throw new IllegalArgumentException("cursor pagination response must contain an items array and scalar/null next cursor");
            }
            next = cursor.isNull() || cursor.asText().isEmpty() ? null : cursor.asText();
            currentItems = (ArrayNode) items;
            ArrayNode combined = completed.deepCopy().addAll(currentItems);
            JsonPointer pointer = JsonPointer.compile(config.itemsPath());
            JsonNode parent = root.at(pointer.head());
            if (!(parent instanceof ObjectNode object)) {
                throw new IllegalArgumentException("cursor pagination items must be an object property");
            }
            object.set(pointer.last().getMatchingProperty(), combined);
            return mapper.writeValueAsString(root);
        } catch (java.io.IOException exception) {
            throw new IllegalArgumentException("cursor pagination response is not valid JSON", exception);
        }
    }

    /** Advances only from a completed page, preserving the server's opaque cursor verbatim. */
    boolean advance() {
        if (next == null) return false;
        if (seen.contains(next)) {
            throw new IllegalArgumentException("cursor pagination returned a repeated cursor");
        }
        if (pages >= config.maxPages()) {
            throw new IllegalArgumentException("cursor pagination exceeded maxPages=" + config.maxPages());
        }
        seen.add(next);
        pages++;
        completed.addAll(currentItems);
        completedBytes += utf8Size(currentItems.toString());
        url = replaceCursor(url, config.cursorParam(), next);
        return true;
    }

    static String cursorValue(String url, String param) {
        String query = URI.create(url).getRawQuery();
        if (query != null) {
            for (String part : query.split("&")) {
                String[] pair = part.split("=", 2);
                if (decode(pair[0]).equals(param)) return pair.length == 2 ? decode(pair[1]) : "";
            }
        }
        return "";
    }

    private static String replaceCursor(String url, String param, String value) {
        URI uri = URI.create(url);
        String encoded = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
        var parts = new ArrayList<String>();
        boolean replaced = false;
        if (uri.getRawQuery() != null) {
            for (String part : uri.getRawQuery().split("&")) {
                if (decode(part.split("=", 2)[0]).equals(param)) {
                    if (!replaced) parts.add(param + "=" + encoded);
                    replaced = true;
                } else {
                    parts.add(part);
                }
            }
        }
        if (!replaced) parts.add(param + "=" + encoded);
        String base = url.split("[?#]", 2)[0];
        return base + "?" + String.join("&", parts)
                + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static int utf8Size(String text) {
        return text.getBytes(StandardCharsets.UTF_8).length;
    }
}
