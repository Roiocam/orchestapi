package com.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.controller.EnvironmentController;
import com.orchestrator.dto.EnvironmentOAuthResponse;
import com.orchestrator.dto.EnvironmentResponse;
import com.orchestrator.service.EnvironmentService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class EnvironmentOAuthApiTest {

    private MockMvc mockMvc;
    private EnvironmentService service;

    @BeforeEach
    void setUp() {
        service = mock(EnvironmentService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new EnvironmentController(service)).build();
    }

    @Test
    void createApiReturnsMaskedSecretAndConfiguredFlag() throws Exception {
        UUID id = UUID.randomUUID();
        EnvironmentOAuthResponse oauth = EnvironmentOAuthResponse.builder()
                .enabled(true)
                .tokenEndpoint("https://idp.example.test/oauth/token")
                .clientId("service-client")
                .clientSecret("••••••••")
                .clientSecretConfigured(true)
                .clientAuthMethod("client_secret_basic")
                .refreshSkewSeconds(60)
                .requestTimeoutMs(10_000)
                .build();
        when(service.create(any())).thenReturn(EnvironmentResponse.builder()
                .id(id)
                .name("orders")
                .baseUrl("https://api.example.test")
                .oauth(oauth)
                .build());

        String body = """
                {
                  "name": "orders",
                  "baseUrl": "https://api.example.test",
                  "oauth": {
                    "enabled": true,
                    "tokenEndpoint": "https://idp.example.test/oauth/token",
                    "clientId": "service-client",
                    "clientSecret": "client-secret-value",
                    "clientAuthMethod": "client_secret_basic",
                    "refreshSkewSeconds": 60,
                    "requestTimeoutMs": 10000
                  }
                }
                """;

        mockMvc.perform(post("/api/environments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.oauth.clientSecret").value("••••••••"))
                .andExpect(jsonPath("$.oauth.clientSecretConfigured").value(true))
                .andExpect(jsonPath("$.oauth.clientSecret").value(org.hamcrest.Matchers.not("client-secret-value")));

        ArgumentCaptor<com.orchestrator.dto.EnvironmentRequest> request =
                ArgumentCaptor.forClass(com.orchestrator.dto.EnvironmentRequest.class);
        verify(service).create(request.capture());
        assertThat(request.getValue().getOauth().getClientSecret()).isEqualTo("client-secret-value");
    }
}
