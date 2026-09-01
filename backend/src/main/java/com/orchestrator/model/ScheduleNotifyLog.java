package com.orchestrator.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "orchestapi_schedule_notify_logs", schema = "orchestrator")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ScheduleNotifyLog {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "schedule_id")
    private UUID scheduleId;

    @Column(name = "event_id", length = 64)
    private String eventId;

    @Column(name = "event_name", length = 200)
    private String eventName;

    @Column(name = "business_id", length = 200)
    private String businessId;

    @Column(name = "notify_url", nullable = false, length = 2000)
    private String notifyUrl;

    @Column(nullable = false)
    @Builder.Default
    private Boolean success = false;

    @Column(name = "http_status")
    private Integer httpStatus;

    @Column(name = "request_body", columnDefinition = "TEXT")
    private String requestBody;

    @Column(name = "response_body", columnDefinition = "TEXT")
    private String responseBody;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "duration_ms", nullable = false)
    @Builder.Default
    private Long durationMs = 0L;

    @Column(name = "batch_id")
    private UUID batchId;

    @Column(name = "run_status", length = 30)
    private String runStatus;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
