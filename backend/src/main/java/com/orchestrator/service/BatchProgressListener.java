package com.orchestrator.service;

import com.orchestrator.dto.SuiteBatchRunResult;

import java.util.UUID;

/**
 * Optional callbacks for batch execution progress (e.g. SSE).
 */
public interface BatchProgressListener {

    default void onBatchStarted(UUID batchId, int totalSuites) {}

    default void onSuiteStarted(UUID batchId, UUID suiteId, String suiteName, UUID runId) {}

    default void onSuiteCompleted(UUID batchId, SuiteBatchRunResult result) {}

    default void onBatchComplete(UUID batchId, String status, int succeeded, int failed, int totalSuites) {}

    default void onBatchError(UUID batchId, String message) {}
}
