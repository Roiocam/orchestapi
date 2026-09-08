package com.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Verifies public config persistence, legacy updates, explicit disable and two-pass suite imports. */
@SpringBootTest(properties = {
        "spring.datasource.url=${CURSOR_TEST_JDBC_URL:jdbc:h2:mem:cursorpaging;MODE=PostgreSQL;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator}",
        "spring.datasource.driver-class-name=${CURSOR_TEST_JDBC_DRIVER:org.h2.Driver}",
        "spring.datasource.username=${CURSOR_TEST_DB_USER:sa}",
        "spring.datasource.password=${CURSOR_TEST_DB_PASSWORD:}",
        "spring.jpa.database-platform=${CURSOR_TEST_DIALECT:org.hibernate.dialect.H2Dialect}",
        "spring.jpa.hibernate.ddl-auto=${CURSOR_TEST_DDL:create-drop}",
        "spring.flyway.enabled=${CURSOR_TEST_FLYWAY:false}"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CursorPaginationApiIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;

    @Test
    void roundTripsAndPreservesConfigForLegacyUpdatesButAllowsExplicitDisable() throws Exception {
        String suite = createSuite();
        ObjectNode body = step();
        String response = mvc.perform(post("/api/test-suites/" + suite + "/steps")
                        .contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cursorPagination.maxPages").value(100))
                .andReturn().getResponse().getContentAsString();
        String path = "/api/test-suites/" + suite + "/steps/" + mapper.readTree(response).path("id").asText();
        mvc.perform(get(path)).andExpect(status().isOk())
                .andExpect(jsonPath("$.cursorPagination.cursorParam").value("cursor"));
        body.remove("cursorPagination");
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cursorPagination.cursorParam").value("cursor"));
        body.putNull("cursorPagination");
        mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cursorPagination").doesNotExist());
        mvc.perform(get(path)).andExpect(status().isOk())
                .andExpect(jsonPath("$.cursorPagination").doesNotExist());
    }

    @Test
    void suiteImportPreservesPaginationAfterDependencyWiring() throws Exception {
        ObjectNode request = mapper.createObjectNode().put("name", "cursor-import-" + System.nanoTime());
        ObjectNode reader = step();
        ((com.fasterxml.jackson.databind.node.ArrayNode) reader.get("responseHandlers"))
                .addObject().put("matchCode", "4xx").put("action", "FIRE_SIDE_EFFECT")
                .put("sideEffectStepName", "cleanup").put("priority", 1);
        request.putArray("steps").add(reader).addObject()
                .put("name", "cleanup").put("method", "DELETE").put("url", "https://example.test/session");
        String response = mvc.perform(post("/api/test-suites/import")
                        .contentType(MediaType.APPLICATION_JSON).content(request.toString()))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String suite = mapper.readTree(response).path("id").asText();
        mvc.perform(get("/api/test-suites/" + suite + "/steps"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].cursorPagination.cursorParam").value("cursor"));
    }

    @Test
    void rejectsMutationPagingAndInvalidBounds() throws Exception {
        String path = "/api/test-suites/" + createSuite() + "/steps";
        ObjectNode body = step();
        body.put("method", "POST");
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isBadRequest());
        body.put("method", "GET");
        ((ObjectNode) body.get("cursorPagination")).put("maxPages", 0);
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isBadRequest());
    }

    private String createSuite() throws Exception {
        String response = mvc.perform(post("/api/test-suites").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.createObjectNode().put("name", "cursor-" + System.nanoTime()).toString()))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(response).path("id").asText();
    }

    private ObjectNode step() throws Exception {
        return (ObjectNode) mapper.readTree("""
                {"name":"read_events","method":"GET","url":"https://example.test/events",
                 "queryParams":[{"key":"cursor","value":"0"},{"key":"limit","value":"200"}],
                 "cursorPagination":{"cursorParam":"cursor","nextCursorPath":"/data/nextCursor","itemsPath":"/data/items"},
                 "responseHandlers":[{"matchCode":"200","action":"RETRY","retryCount":20}],
                 "responseValidations":[{"validationType":"BODY_FIELD","jsonPath":"$","operator":"CONTAINS","expectedValue":"Skill"}]}
                """);
    }
}
