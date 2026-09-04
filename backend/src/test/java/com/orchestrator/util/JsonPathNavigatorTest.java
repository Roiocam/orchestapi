package com.orchestrator.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class JsonPathNavigatorTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private static final String SAMPLE = """
            {
              "id": "root-1",
              "data": {
                "items": [
                  {"name": "alpha", "id": "a1", "score": 1},
                  {"name": "beta", "id": "b2", "score": 2},
                  {"name": "beta", "id": "b3", "score": 3}
                ]
              }
            }
            """;

    @Test
    void extractsNestedField() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.id")).isEqualTo("root-1");
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items[0].id")).isEqualTo("a1");
    }

    @Test
    void extractsViaFilterEquals() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items[?(@.name=='beta')].id"))
                .isEqualTo("b2");
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items[?(@.name=='alpha')].score"))
                .isEqualTo("1");
    }

    @Test
    void filterMissReturnsEmpty() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items[?(@.name=='missing')].id"))
                .isEqualTo("");
    }

    @Test
    void filterTakesFirstWhenMultipleMatch() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items[?(@.name=='beta')].id"))
                .isEqualTo("b2");
    }

    @Test
    void lengthAndSizeAliases() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items.length()")).isEqualTo("3");
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items.size()")).isEqualTo("3");
    }

    @Test
    void extractAsNodeForTypeChecks() {
        JsonNode node = JsonPathNavigator.extractAsNode(mapper, SAMPLE, "$.data.items[?(@.name=='alpha')]");
        assertThat(node.isObject()).isTrue();
        assertThat(node.get("id").asText()).isEqualTo("a1");
    }

    @Test
    void wholeArrayStillReturnedWithoutFilter() {
        assertThat(JsonPathNavigator.extractAsText(mapper, SAMPLE, "$.data.items"))
                .startsWith("[");
    }

    @Test
    void normalizeAddsRootAndRewritesSize() {
        assertThat(JsonPathNavigator.normalizePath("data.items.size()")).isEqualTo("$.data.items.length()");
        assertThat(JsonPathNavigator.normalizePath("$.a")).isEqualTo("$.a");
    }
}
