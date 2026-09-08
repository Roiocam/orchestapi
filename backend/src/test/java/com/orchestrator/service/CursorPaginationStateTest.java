package com.orchestrator.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.model.CursorPaginationConfig;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

/** Exercises opaque URL cursors, bounded scans and page replacement without an HTTP stub. */
class CursorPaginationStateTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void opaqueCursorsPreserveEncodingAndOtherQueryParameters() {
        var state = state(10, "https://example.test/events?filter=a%2Fb&cursor=0&limit=200");
        state.accept("{\"data\":{\"items\":[],\"nextCursor\":\"page+/= &中文\"}}");
        assertThat(state.advance()).isTrue();
        assertThat(state.url()).isEqualTo("https://example.test/events?filter=a%2Fb&cursor=page%2B%2F%3D%20%26%E4%B8%AD%E6%96%87&limit=200");
        assertThat(CursorPaginationState.cursorValue(state.url(), "cursor")).isEqualTo("page+/= &中文");
    }

    @Test
    void emptyTailRetainsCursorAndCompletedItems() throws Exception {
        var state = state(10, "https://example.test/events?cursor=0&limit=200");
        state.accept("{\"data\":{\"items\":[1],\"nextCursor\":\"200\"}}");
        state.advance();
        String empty = state.accept("{\"data\":{\"items\":[],\"nextCursor\":null}}");
        assertThat(mapper.readTree(empty).at("/data/items")).hasSize(1);
        assertThat(state.advance()).isFalse();
        assertThat(state.url()).contains("cursor=200");
        String arrived = state.accept("{\"data\":{\"items\":[2],\"nextCursor\":null}}");
        assertThat(mapper.readTree(arrived).at("/data/items")).hasSize(2);
    }

    @Test
    void stopsAtPageBoundAndCursorCycles() {
        var bounded = state(1, "https://example.test/events?cursor=0");
        bounded.accept("{\"data\":{\"items\":[],\"nextCursor\":\"200\"}}");
        assertThatThrownBy(bounded::advance).hasMessageContaining("maxPages=1");
        var cyclic = state(10, "https://example.test/events?cursor=0");
        cyclic.accept("{\"data\":{\"items\":[],\"nextCursor\":\"200\"}}");
        cyclic.advance();
        cyclic.accept("{\"data\":{\"items\":[],\"nextCursor\":\"0\"}}");
        assertThatThrownBy(cyclic::advance).hasMessageContaining("repeated cursor");
    }

    @Test
    void rejectsMalformedOrUnboundedEvidence() {
        var state = state(10, "https://example.test/events?cursor=0");
        assertThatThrownBy(() -> state.accept("not-json")).hasMessageContaining("not valid JSON");
        assertThatThrownBy(() -> state.accept("{\"data\":{\"items\":[]}}"))
                .hasMessageContaining("items array and scalar/null next cursor");
        assertThatThrownBy(() -> state.accept("{\"data\":{\"items\":{},\"nextCursor\":null}}"))
                .hasMessageContaining("items array");
        assertThatThrownBy(() -> state.accept("x".repeat(16 * 1024 * 1024 + 1)))
                .hasMessageContaining("16 MiB");
    }

    private CursorPaginationState state(int maxPages, String url) {
        return new CursorPaginationState(new CursorPaginationConfig("cursor", "/data/nextCursor", "/data/items", maxPages), mapper, url);
    }
}
