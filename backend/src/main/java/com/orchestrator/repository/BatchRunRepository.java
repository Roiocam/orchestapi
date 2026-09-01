package com.orchestrator.repository;

import com.orchestrator.model.BatchRun;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.UUID;

public interface BatchRunRepository extends JpaRepository<BatchRun, UUID>, JpaSpecificationExecutor<BatchRun> {
}
