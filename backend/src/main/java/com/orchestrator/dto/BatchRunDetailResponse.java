package com.orchestrator.dto;

import lombok.*;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BatchRunDetailResponse {
    private BatchRunResponse batch;
    private List<CollectionSuiteRunResult> runs;
}
