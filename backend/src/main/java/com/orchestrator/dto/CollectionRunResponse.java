package com.orchestrator.dto;

import lombok.*;

import java.util.List;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CollectionRunResponse {
    private UUID collectionId;
    private String collectionName;
    private UUID environmentId;
    private int totalSuites;
    private int succeeded;
    private int failed;
    private List<CollectionSuiteRunResult> results;
}
