package com.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.controller.TestStepController;
import com.orchestrator.dto.TestStepRequest;
import com.orchestrator.dto.TestStepResponse;
import com.orchestrator.model.enums.OAuthMode;
import com.orchestrator.service.ExecutionService;
import com.orchestrator.service.ImportService;
import com.orchestrator.service.TestStepService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TestStepOAuthModeApiTest {

    private final UUID suiteId = UUID.randomUUID();
    private MockMvc mockMvc;
    private TestStepService stepService;

    @BeforeEach
    void setUp() {
        stepService = mock(TestStepService.class);
        ExecutionService executionService = mock(ExecutionService.class);
        ObjectMapper objectMapper = new ObjectMapper();
        ImportService importService = new ImportService(stepService, objectMapper);
        TestStepController controller = new TestStepController(stepService, importService, executionService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void explicitDisabledModeRoundTripsThroughCreateApi() throws Exception {
        when(stepService.create(eq(suiteId), any(TestStepRequest.class)))
                .thenReturn(TestStepResponse.builder().oauthMode(OAuthMode.DISABLED.name()).build());

        mockMvc.perform(post("/api/test-suites/{suiteId}/steps", suiteId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(stepJson("DISABLED")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.oauthMode").value("DISABLED"));

        ArgumentCaptor<TestStepRequest> request = ArgumentCaptor.forClass(TestStepRequest.class);
        verify(stepService).create(eq(suiteId), request.capture());
        assertThat(request.getValue().getOauthMode()).isEqualTo(OAuthMode.DISABLED);
    }

    @Test
    void omittedOrNullModeDefaultsToInheritForJsonImport() throws Exception {
        when(stepService.create(eq(suiteId), any(TestStepRequest.class)))
                .thenAnswer(invocation -> {
                    TestStepRequest request = invocation.getArgument(1);
                    return TestStepResponse.builder().oauthMode(request.getOauthMode().name()).build();
                });

        importJson("{\"name\":\"imported\",\"method\":\"GET\",\"url\":\"/public\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.oauthMode").value("INHERIT"));
        importJson("{\"name\":\"null-mode\",\"method\":\"GET\",\"url\":\"/public-2\",\"oauthMode\":null}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.oauthMode").value("INHERIT"));

        ArgumentCaptor<TestStepRequest> request = ArgumentCaptor.forClass(TestStepRequest.class);
        verify(stepService, times(2)).create(eq(suiteId), request.capture());
        assertThat(request.getAllValues())
                .extracting(TestStepRequest::getOauthMode)
                .containsExactly(OAuthMode.INHERIT, OAuthMode.INHERIT);
    }

    private org.springframework.test.web.servlet.ResultActions importJson(String stepJson) throws Exception {
        return mockMvc.perform(post("/api/test-suites/{suiteId}/steps/import-json", suiteId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(new ObjectMapper().writeValueAsString(Map.of("json", stepJson))));
    }

    private String stepJson(String oauthMode) {
        return "{\"name\":\"step\",\"method\":\"GET\",\"url\":\"/public\","
                + "\"headers\":[],\"queryParams\":[],\"bodyType\":\"NONE\",\"body\":\"\","
                + "\"oauthMode\":\"" + oauthMode + "\",\"dependencies\":[],\"responseHandlers\":[],"
                + "\"extractVariables\":[],\"verifications\":[],\"responseValidations\":[]}";
    }
}
