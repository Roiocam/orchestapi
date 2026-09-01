package com.orchestrator.service;

import com.orchestrator.dto.BatchRunDetailResponse;
import com.orchestrator.dto.BatchRunExportResponse;
import com.orchestrator.dto.BatchRunResponse;
import com.orchestrator.dto.CollectionSuiteRunResult;
import com.orchestrator.dto.PageResponse;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.BatchRun;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.BatchScopeType;
import com.orchestrator.model.enums.BatchStatus;
import com.orchestrator.model.enums.TriggerType;
import com.orchestrator.repository.BatchRunRepository;
import com.orchestrator.repository.TestRunRepository;
import com.orchestrator.repository.TestSuiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BatchRunService {

    private final BatchRunRepository repository;
    private final TestRunRepository testRunRepository;
    private final TestSuiteRepository suiteRepository;
    private final RunService runService;

    @Transactional
    public BatchRun createBatch(BatchScopeType scopeType,
                                UUID scopeId,
                                String scopeName,
                                UUID environmentId,
                                TriggerType triggerType,
                                UUID scheduleId,
                                int totalSuites) {
        BatchRun batch = BatchRun.builder()
                .scopeType(scopeType)
                .scopeId(scopeId)
                .scopeName(scopeName)
                .environmentId(environmentId)
                .scheduleId(scheduleId)
                .triggerType(triggerType)
                .status(BatchStatus.RUNNING)
                .totalSuites(totalSuites)
                .startedAt(LocalDateTime.now())
                .build();
        return repository.save(batch);
    }

    @Transactional
    public void finalizeBatch(UUID batchId, BatchStatus status, int succeeded, int failed) {
        BatchRun batch = repository.findById(batchId)
                .orElseThrow(() -> new NotFoundException("Batch not found: " + batchId));
        batch.setStatus(status);
        batch.setSucceeded(succeeded);
        batch.setFailed(failed);
        batch.setCompletedAt(LocalDateTime.now());
        repository.save(batch);
    }

    @Transactional(readOnly = true)
    public PageResponse<BatchRunResponse> findAll(String triggerType,
                                                   String status,
                                                   LocalDateTime from,
                                                   LocalDateTime to,
                                                   Pageable pageable) {
        Specification<BatchRun> spec = Specification.where(null);

        if (status != null && !status.isBlank()) {
            try {
                BatchStatus bs = BatchStatus.valueOf(status);
                spec = spec.and((root, query, cb) -> cb.equal(root.get("status"), bs));
            } catch (IllegalArgumentException ignored) {}
        }
        if (triggerType != null && !triggerType.isBlank()) {
            try {
                TriggerType tt = TriggerType.valueOf(triggerType);
                spec = spec.and((root, query, cb) -> cb.equal(root.get("triggerType"), tt));
            } catch (IllegalArgumentException ignored) {}
        }
        if (from != null) {
            spec = spec.and((root, query, cb) -> cb.greaterThanOrEqualTo(root.get("startedAt"), from));
        }
        if (to != null) {
            spec = spec.and((root, query, cb) -> cb.lessThanOrEqualTo(root.get("startedAt"), to));
        }

        Page<BatchRun> page = repository.findAll(spec, pageable);
        return PageResponse.from(page, this::toResponse);
    }

    @Transactional(readOnly = true)
    public BatchRunDetailResponse findById(UUID id) {
        BatchRun batch = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Batch not found: " + id));
        List<TestRun> childRuns = testRunRepository.findByBatchIdOrderByStartedAtAsc(id);
        List<CollectionSuiteRunResult> runs = childRuns.stream()
                .map(run -> CollectionSuiteRunResult.builder()
                        .suiteId(run.getSuiteId())
                        .suiteName(resolveSuiteName(run.getSuiteId()))
                        .runId(run.getId())
                        .status(run.getStatus().name())
                        .build())
                .toList();
        return BatchRunDetailResponse.builder()
                .batch(toResponse(batch))
                .runs(runs)
                .build();
    }

    @Transactional(readOnly = true)
    public BatchRunExportResponse export(UUID id) {
        BatchRun batch = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Batch not found: " + id));
        return BatchRunExportResponse.builder()
                .batch(toResponse(batch))
                .runs(runService.findDetailsByBatchId(id))
                .build();
    }

    @Transactional(readOnly = true)
    public BatchRun getEntity(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Batch not found: " + id));
    }

    @Transactional
    public void delete(UUID id) {
        BatchRun batch = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Batch not found: " + id));
        batch.setDeletedAt(LocalDateTime.now());
        repository.save(batch);
    }

    private BatchRunResponse toResponse(BatchRun batch) {
        return BatchRunResponse.builder()
                .id(batch.getId().toString())
                .scopeType(batch.getScopeType().name())
                .scopeId(batch.getScopeId().toString())
                .scopeName(batch.getScopeName())
                .environmentId(batch.getEnvironmentId() != null ? batch.getEnvironmentId().toString() : null)
                .scheduleId(batch.getScheduleId() != null ? batch.getScheduleId().toString() : null)
                .triggerType(batch.getTriggerType().name())
                .status(batch.getStatus().name())
                .totalSuites(batch.getTotalSuites())
                .succeeded(batch.getSucceeded())
                .failed(batch.getFailed())
                .startedAt(batch.getStartedAt())
                .completedAt(batch.getCompletedAt())
                .createdAt(batch.getCreatedAt())
                .build();
    }

    private String resolveSuiteName(UUID suiteId) {
        return suiteRepository.findById(suiteId)
                .map(TestSuite::getName)
                .orElse("(deleted)");
    }
}
