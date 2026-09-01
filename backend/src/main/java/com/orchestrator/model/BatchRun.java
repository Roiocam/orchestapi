package com.orchestrator.model;

import com.orchestrator.model.enums.BatchScopeType;
import com.orchestrator.model.enums.BatchStatus;
import com.orchestrator.model.enums.TriggerType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "orchestapi_batch_runs", schema = "orchestrator")
@SQLRestriction("deleted_at IS NULL")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BatchRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "scope_type", nullable = false, length = 20)
    private BatchScopeType scopeType;

    @Column(name = "scope_id", nullable = false)
    private UUID scopeId;

    @Column(name = "scope_name", length = 200)
    private String scopeName;

    @Column(name = "environment_id")
    private UUID environmentId;

    @Column(name = "schedule_id")
    private UUID scheduleId;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_type", nullable = false, length = 20)
    private TriggerType triggerType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    @Builder.Default
    private BatchStatus status = BatchStatus.RUNNING;

    @Column(name = "total_suites", nullable = false)
    @Builder.Default
    private int totalSuites = 0;

    @Column(nullable = false)
    @Builder.Default
    private int succeeded = 0;

    @Column(nullable = false)
    @Builder.Default
    private int failed = 0;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        if (startedAt == null) {
            startedAt = LocalDateTime.now();
        }
    }
}
