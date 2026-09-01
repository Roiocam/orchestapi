package com.orchestrator.dto;

import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CronPreviewResponse {
    private boolean valid;
    private String error;
    /** IANA zone used to interpret the cron expression (e.g. Asia/Shanghai). */
    private String timezone;
    /** Next fire times as UTC naive LocalDateTime (same contract as nextRunAt). */
    private List<LocalDateTime> nextFireTimes;
}
