package com.orchestrator;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "server.servlet.context-path=/orchestapi",
        "spring.datasource.url=jdbc:h2:mem:proddeployment;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator"
})
@AutoConfigureMockMvc
@ActiveProfiles({"test", "prod"})
class ProductionDeploymentConfigurationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthIsAvailableThroughDeploymentPrefixWithoutDependencyDetails() throws Exception {
        mockMvc.perform(get("/orchestapi/actuator/health").contextPath("/orchestapi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }
}
