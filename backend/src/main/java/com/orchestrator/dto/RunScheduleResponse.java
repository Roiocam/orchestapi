package com.orchestrator.dto;

import lombok.*;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RunScheduleResponse {
    private String id;
    private String scopeType;
    private String scopeId;
    private String scopeName;
    private Integer suiteCount;
    /** Present when scopeType is SUITE (back-compat). */
    private String suiteId;
    /** Present when scopeType is SUITE (back-compat). */
    private String suiteName;
    private String environmentId;
    private String environmentName;
    private String cronExpression;
    private Boolean active;
    private String description;
    private LocalDateTime lastRunAt;
    private LocalDateTime nextRunAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
