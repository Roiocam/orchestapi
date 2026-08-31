package com.orchestrator;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "server.servlet.context-path=/orchestapi",
        "spring.datasource.url=jdbc:h2:mem:spafallback;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SpaFallbackIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void refreshOnMockServerReturnsIndexHtml() throws Exception {
        mockMvc.perform(get("/orchestapi/mock-server").contextPath("/orchestapi"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("spa-index")));
    }

    @Test
    void refreshOnNestedFrontendRouteReturnsIndexHtml() throws Exception {
        mockMvc.perform(get("/orchestapi/mock-server/abc-123").contextPath("/orchestapi"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("spa-index")));
    }

    @Test
    void unknownApiPathDoesNotFallBackToSpa() throws Exception {
        mockMvc.perform(get("/orchestapi/api/does-not-exist").contextPath("/orchestapi"))
                .andExpect(status().isNotFound());
    }

    @Test
    void missingAssetDoesNotFallBackToSpa() throws Exception {
        mockMvc.perform(get("/orchestapi/assets/missing-bundle.js").contextPath("/orchestapi"))
                .andExpect(status().isNotFound());
    }
}
