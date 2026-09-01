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
    /** Same shape as run list items (no resultData). */
    private List<TestRunResponse> runs;
}
