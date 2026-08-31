package com.orchestrator.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.DefaultHierarchyIds;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CollectionResponse {

    private UUID id;
    private UUID projectId;
    private String name;
    private String description;
    @JsonProperty("isDefault")
    private boolean defaultHierarchy;
    private int suiteCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static CollectionResponse from(ApiCollection collection, int suiteCount) {
        return CollectionResponse.builder()
                .id(collection.getId())
                .projectId(collection.getProjectId())
                .name(collection.getName())
                .description(collection.getDescription())
                .defaultHierarchy(DefaultHierarchyIds.DEFAULT_COLLECTION_ID.equals(collection.getId()))
                .suiteCount(suiteCount)
                .createdAt(collection.getCreatedAt())
                .updatedAt(collection.getUpdatedAt())
                .build();
    }
}
