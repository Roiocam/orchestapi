package com.orchestrator.service;

import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.BatchScopeType;
import com.orchestrator.model.enums.BatchStatus;
import com.orchestrator.model.enums.TriggerType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class BatchExecutionService {

    private final ScheduleService scheduleService;
    private final BatchRunService batchRunService;
    private final BatchExecutionRegistry registry;

    @Async
    public void executeBatchAsync(UUID batchId,
                                  List<TestSuite> suites,
                                  UUID environmentId,
                                  TriggerType triggerType,
                                  UUID scheduleId) {
        executeBatch(batchId, suites, environmentId, triggerType, scheduleId);
    }

    public void executeBatch(UUID batchId,
                             List<TestSuite> suites,
                             UUID environmentId,
                             TriggerType triggerType,
                             UUID scheduleId) {
        executeBatchAndCollect(batchId, suites, environmentId, triggerType, scheduleId);
    }

    public List<SuiteBatchRunResult> executeBatchAndCollect(UUID batchId,
                                                             List<TestSuite> suites,
                                                             UUID environmentId,
                                                             TriggerType triggerType,
                                                             UUID scheduleId) {
        registry.registerBatch(batchId);
        BatchProgressListener listener = registry.createProgressListener(batchId);

        try {
            listener.onBatchStarted(batchId, suites.size());

            List<SuiteBatchRunResult> results = scheduleService.executeSuitesSequentially(
                    suites,
                    environmentId,
                    triggerType,
                    scheduleId,
                    batchId,
                    () -> registry.isCancelRequested(batchId),
                    listener,
                    registry);

            BatchStatus status = resolveBatchStatus(results, registry.isCancelRequested(batchId));
            int succeeded = countByStatus(results, "SUCCESS");
            int failed = countFailures(results);

            batchRunService.finalizeBatch(batchId, status, succeeded, failed);
            listener.onBatchComplete(batchId, status.name(), succeeded, failed, suites.size());
            return results;
        } catch (Exception e) {
            log.error("Batch {} execution failed unexpectedly: {}", batchId, e.getMessage(), e);
            batchRunService.finalizeBatch(batchId, BatchStatus.FAILURE, 0, suites.size());
            listener.onBatchError(batchId, e.getMessage());
            return List.of();
        } finally {
            registry.unregisterBatch(batchId);
        }
    }

    public void executeEmptyBatch(UUID batchId) {
        registry.registerBatch(batchId);
        BatchProgressListener listener = registry.createProgressListener(batchId);
        try {
            listener.onBatchStarted(batchId, 0);
            batchRunService.finalizeBatch(batchId, BatchStatus.SUCCESS, 0, 0);
            listener.onBatchComplete(batchId, BatchStatus.SUCCESS.name(), 0, 0, 0);
        } finally {
            registry.unregisterBatch(batchId);
        }
    }

    public UUID createAndStartCollectionBatch(UUID collectionId,
                                              String collectionName,
                                              UUID environmentId,
                                              List<TestSuite> suites) {
        var batch = batchRunService.createBatch(
                BatchScopeType.COLLECTION,
                collectionId,
                collectionName,
                environmentId,
                TriggerType.MANUAL,
                null,
                suites.size());
        UUID batchId = batch.getId();
        executeBatchAsync(batchId, suites, environmentId, TriggerType.MANUAL, null);
        return batchId;
    }

    public UUID createScheduledBatch(BatchScopeType scopeType,
                                     UUID scopeId,
                                     String scopeName,
                                     UUID environmentId,
                                     UUID scheduleId,
                                     List<TestSuite> suites) {
        var batch = batchRunService.createBatch(
                scopeType,
                scopeId,
                scopeName,
                environmentId,
                TriggerType.SCHEDULED,
                scheduleId,
                suites.size());
        return batch.getId();
    }

    static BatchStatus resolveBatchStatus(List<SuiteBatchRunResult> results, boolean cancelled) {
        if (cancelled) {
            return BatchStatus.CANCELLED;
        }
        if (results.isEmpty()) {
            return BatchStatus.SUCCESS;
        }
        int succeeded = countByStatus(results, "SUCCESS");
        int failed = countFailures(results);
        if (failed == 0) {
            return BatchStatus.SUCCESS;
        }
        if (succeeded == 0) {
            return BatchStatus.FAILURE;
        }
        return BatchStatus.PARTIAL_FAILURE;
    }

    private static int countByStatus(List<SuiteBatchRunResult> results, String status) {
        return (int) results.stream().filter(r -> status.equals(r.getStatus())).count();
    }

    private static int countFailures(List<SuiteBatchRunResult> results) {
        return (int) results.stream().filter(r -> !"SUCCESS".equals(r.getStatus())).count();
    }
}
