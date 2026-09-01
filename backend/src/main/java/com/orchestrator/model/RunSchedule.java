package com.orchestrator.model;

import com.orchestrator.model.enums.ScheduleNotifyOn;
import com.orchestrator.model.enums.ScheduleScopeType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.SQLRestriction;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "orchestapi_run_schedules", schema = "orchestrator")
@SQLRestriction("deleted_at IS NULL")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RunSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "scope_type", nullable = false, length = 20)
    @Builder.Default
    private ScheduleScopeType scopeType = ScheduleScopeType.SUITE;

    @Column(name = "scope_id", nullable = false)
    private UUID scopeId;

    /**
     * Populated only when {@link #scopeType} is {@link ScheduleScopeType#SUITE}
     * for backwards-compatible queries. Null for collection/project scopes.
     */
    @Column(name = "suite_id")
    private UUID suiteId;

    @Column(name = "environment_id", nullable = false)
    private UUID environmentId;

    @Column(name = "cron_expression", nullable = false, length = 100)
    private String cronExpression;

    @Column(nullable = false)
    @Builder.Default
    private Boolean active = true;

    @Column(length = 255)
    private String description;

    @Column(name = "notify_enabled", nullable = false)
    @Builder.Default
    private Boolean notifyEnabled = false;

    @Column(name = "notify_url", length = 2000)
    private String notifyUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "notify_on", nullable = false, length = 20)
    @Builder.Default
    private ScheduleNotifyOn notifyOn = ScheduleNotifyOn.ON_FAILURE;

    @Column(name = "notify_event_name", length = 200)
    private String notifyEventName;

    @Column(name = "notify_business_id", length = 200)
    private String notifyBusinessId;

    @Column(name = "notify_operator", length = 100)
    private String notifyOperator;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "notify_extra_labels", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, String> notifyExtraLabels = new LinkedHashMap<>();

    @Column(name = "last_run_at")
    private LocalDateTime lastRunAt;

    @Column(name = "next_run_at")
    private LocalDateTime nextRunAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (notifyExtraLabels == null) {
            notifyExtraLabels = new LinkedHashMap<>();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
