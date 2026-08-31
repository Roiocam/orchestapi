package com.orchestrator.dto;

import com.orchestrator.model.TestSuite;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TestSuiteResponse {

    private UUID id;
    private UUID collectionId;
    private String name;
    private String description;
    private UUID defaultEnvironmentId;
    private int stepCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static TestSuiteResponse from(TestSuite suite) {
        return TestSuiteResponse.builder()
                .id(suite.getId())
                .collectionId(suite.getCollectionId())
                .name(suite.getName())
                .description(suite.getDescription())
                .defaultEnvironmentId(suite.getDefaultEnvironmentId())
                .stepCount(suite.getSteps() != null ? suite.getSteps().size() : 0)
                .createdAt(suite.getCreatedAt())
                .updatedAt(suite.getUpdatedAt())
                .build();
    }
}
