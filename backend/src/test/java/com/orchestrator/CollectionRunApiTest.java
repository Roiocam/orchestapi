package com.orchestrator;

import com.orchestrator.controller.CollectionController;
import com.orchestrator.dto.CollectionRunResponse;
import com.orchestrator.dto.CollectionSuiteRunResult;
import com.orchestrator.exception.GlobalExceptionHandler;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.service.CollectionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CollectionRunApiTest {

    private MockMvc mockMvc;
    private CollectionService service;

    @BeforeEach
    void setUp() {
        service = mock(CollectionService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new CollectionController(service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void postRunReturnsCollectionRunResponse() throws Exception {
        UUID collectionId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID suiteId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        when(service.run(eq(collectionId), any())).thenReturn(CollectionRunResponse.builder()
                .collectionId(collectionId)
                .collectionName("MCP")
                .environmentId(envId)
                .totalSuites(1)
                .succeeded(1)
                .failed(0)
                .results(List.of(CollectionSuiteRunResult.builder()
                        .suiteId(suiteId)
                        .suiteName("alpha")
                        .runId(runId)
                        .status("SUCCESS")
                        .build()))
                .build());

        mockMvc.perform(post("/api/collections/{id}/run", collectionId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"environmentId\":\"" + envId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.collectionId").value(collectionId.toString()))
                .andExpect(jsonPath("$.collectionName").value("MCP"))
                .andExpect(jsonPath("$.environmentId").value(envId.toString()))
                .andExpect(jsonPath("$.totalSuites").value(1))
                .andExpect(jsonPath("$.succeeded").value(1))
                .andExpect(jsonPath("$.failed").value(0))
                .andExpect(jsonPath("$.results[0].suiteId").value(suiteId.toString()))
                .andExpect(jsonPath("$.results[0].runId").value(runId.toString()))
                .andExpect(jsonPath("$.results[0].status").value("SUCCESS"));
    }

    @Test
    void postRunMissingCollectionReturns404() throws Exception {
        UUID missing = UUID.randomUUID();
        when(service.run(eq(missing), isNull())).thenThrow(new NotFoundException("Collection not found: " + missing));

        mockMvc.perform(post("/api/collections/{id}/run", missing))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Collection not found: " + missing));
    }

    @Test
    void postRunEmptyCollectionReturnsZeroSuites() throws Exception {
        UUID collectionId = UUID.randomUUID();
        when(service.run(eq(collectionId), isNull())).thenReturn(CollectionRunResponse.builder()
                .collectionId(collectionId)
                .collectionName("Empty")
                .totalSuites(0)
                .succeeded(0)
                .failed(0)
                .results(List.of())
                .build());

        mockMvc.perform(post("/api/collections/{id}/run", collectionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalSuites").value(0))
                .andExpect(jsonPath("$.results").isEmpty());
    }
}
