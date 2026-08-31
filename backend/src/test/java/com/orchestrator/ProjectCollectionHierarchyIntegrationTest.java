package com.orchestrator;

import com.orchestrator.model.DefaultHierarchyIds;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:hierarchy;INIT=CREATE SCHEMA IF NOT EXISTS orchestrator"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectCollectionHierarchyIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void defaultProjectAndCollectionExistAfterMigrationSeed() throws Exception {
        mockMvc.perform(get("/api/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + DefaultHierarchyIds.DEFAULT_PROJECT_ID + "')]", hasSize(1)));

        mockMvc.perform(get("/api/collections")
                        .param("projectId", DefaultHierarchyIds.DEFAULT_PROJECT_ID.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + DefaultHierarchyIds.DEFAULT_COLLECTION_ID + "')]", hasSize(1)));
    }

    @Test
    void createSuiteWithoutCollectionIdUsesDefaultCollection() throws Exception {
        String body = """
                {
                  "name": "Compat Suite %s",
                  "description": "legacy create path"
                }
                """.formatted(System.nanoTime());

        mockMvc.perform(post("/api/test-suites")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.collectionId").value(DefaultHierarchyIds.DEFAULT_COLLECTION_ID.toString()));
    }
}
