package com.orchestrator.dto;

import lombok.*;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BatchRunExportResponse {
    private BatchRunResponse batch;
    private List<TestRunResponse> runs;
}
