package com.orchestrator.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.orchestrator.model.DefaultHierarchyIds;
import com.orchestrator.model.Project;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProjectResponse {

    private UUID id;
    private String name;
    private String description;
    @JsonProperty("isDefault")
    private boolean defaultHierarchy;
    private int collectionCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static ProjectResponse from(Project project, int collectionCount) {
        return ProjectResponse.builder()
                .id(project.getId())
                .name(project.getName())
                .description(project.getDescription())
                .defaultHierarchy(DefaultHierarchyIds.DEFAULT_PROJECT_ID.equals(project.getId()))
                .collectionCount(collectionCount)
                .createdAt(project.getCreatedAt())
                .updatedAt(project.getUpdatedAt())
                .build();
    }
}
