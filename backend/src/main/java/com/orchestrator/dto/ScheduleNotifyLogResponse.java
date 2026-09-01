package com.orchestrator.dto;

import lombok.*;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ScheduleNotifyLogResponse {
    private String id;
    private String scheduleId;
    private String eventId;
    private String eventName;
    private String businessId;
    private String notifyUrl;
    private Boolean success;
    private Integer httpStatus;
    private String requestBody;
    private String responseBody;
    private String errorMessage;
    private Long durationMs;
    private String batchId;
    private String runStatus;
    private LocalDateTime createdAt;
}
