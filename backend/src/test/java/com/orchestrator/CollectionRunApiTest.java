package com.orchestrator;

import com.orchestrator.controller.CollectionController;
import com.orchestrator.dto.BatchStartResponse;
import com.orchestrator.exception.GlobalExceptionHandler;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.service.CollectionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
    void postRunReturns202WithBatchId() throws Exception {
        UUID collectionId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();

        when(service.run(eq(collectionId), any())).thenReturn(BatchStartResponse.builder()
                .batchId(batchId)
                .build());

        mockMvc.perform(post("/api/collections/{id}/run", collectionId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.batchId").value(batchId.toString()));
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
    void postRunEmptyCollectionReturns202WithBatchId() throws Exception {
        UUID collectionId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        when(service.run(eq(collectionId), isNull())).thenReturn(BatchStartResponse.builder()
                .batchId(batchId)
                .build());

        mockMvc.perform(post("/api/collections/{id}/run", collectionId))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.batchId").value(batchId.toString()));
    }
}
