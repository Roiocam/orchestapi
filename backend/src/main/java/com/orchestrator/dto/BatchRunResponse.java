package com.orchestrator.dto;

import lombok.*;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BatchRunResponse {
    private String id;
    private String scopeType;
    private String scopeId;
    private String scopeName;
    private String environmentId;
    private String scheduleId;
    private String triggerType;
    private String status;
    private int totalSuites;
    private int succeeded;
    private int failed;
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private LocalDateTime createdAt;
}
