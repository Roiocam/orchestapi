package com.orchestrator.config;

import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.DefaultHierarchyIds;
import com.orchestrator.model.Project;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ensures the migration-seeded default project/collection exist even when
 * Flyway is disabled (e.g. H2 tests with ddl-auto).
 */
@Component
@RequiredArgsConstructor
public class DefaultHierarchySeeder implements ApplicationRunner {

    private final ProjectRepository projectRepository;
    private final ApiCollectionRepository collectionRepository;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!projectRepository.existsById(DefaultHierarchyIds.DEFAULT_PROJECT_ID)) {
            projectRepository.save(Project.builder()
                    .id(DefaultHierarchyIds.DEFAULT_PROJECT_ID)
                    .name("Default Project")
                    .description("Auto-created to preserve existing suites")
                    .build());
        }
        if (!collectionRepository.existsById(DefaultHierarchyIds.DEFAULT_COLLECTION_ID)) {
            collectionRepository.save(ApiCollection.builder()
                    .id(DefaultHierarchyIds.DEFAULT_COLLECTION_ID)
                    .projectId(DefaultHierarchyIds.DEFAULT_PROJECT_ID)
                    .name("Default Collection")
                    .description("Auto-created to preserve existing suites")
                    .build());
        }
    }
}
