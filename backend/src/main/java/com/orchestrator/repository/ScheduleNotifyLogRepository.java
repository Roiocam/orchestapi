package com.orchestrator.repository;

import com.orchestrator.model.ScheduleNotifyLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.UUID;

public interface ScheduleNotifyLogRepository
        extends JpaRepository<ScheduleNotifyLog, UUID>, JpaSpecificationExecutor<ScheduleNotifyLog> {
}
