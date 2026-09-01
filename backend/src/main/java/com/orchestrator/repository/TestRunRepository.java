package com.orchestrator.repository;

import com.orchestrator.model.TestRun;
import com.orchestrator.model.enums.RunStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TestRunRepository extends JpaRepository<TestRun, UUID>, JpaSpecificationExecutor<TestRun> {

    List<TestRun> findByBatchIdOrderByCreatedAtAsc(UUID batchId);

    Optional<TestRun> findByBatchIdAndSuiteIdAndStatus(UUID batchId, UUID suiteId, RunStatus status);

    List<TestRun> findByBatchIdAndStatus(UUID batchId, RunStatus status);
}
