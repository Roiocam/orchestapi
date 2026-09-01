package com.orchestrator.dto;

import lombok.*;

import java.time.LocalDateTime;
import java.util.Map;

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
    private Boolean notifyEnabled;
    private String notifyUrl;
    private String notifyOn;
    private String notifyEventName;
    private String notifyBusinessId;
    private String notifyOperator;
    private Map<String, String> notifyExtraLabels;
    private LocalDateTime lastRunAt;
    private LocalDateTime nextRunAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
