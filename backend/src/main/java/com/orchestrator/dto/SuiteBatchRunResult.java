package com.orchestrator.dto;

import lombok.*;

import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SuiteBatchRunResult {
    private UUID suiteId;
    private String suiteName;
    private UUID runId;
    private String status;
    private String errorMessage;
}
