package com.orchestrator.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
@Slf4j
public class BatchExecutionRegistry {

    private static final long SSE_TIMEOUT = 3_600_000L;

    private final ConcurrentHashMap<UUID, AtomicBoolean> cancelFlags = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, UUID> currentRunIds = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, CopyOnWriteArrayList<SseEmitter>> sseListeners = new ConcurrentHashMap<>();

    public void registerBatch(UUID batchId) {
        cancelFlags.put(batchId, new AtomicBoolean(false));
    }

    public void unregisterBatch(UUID batchId) {
        cancelFlags.remove(batchId);
        currentRunIds.remove(batchId);
        sseListeners.remove(batchId);
    }

    public boolean isCancelRequested(UUID batchId) {
        AtomicBoolean flag = cancelFlags.get(batchId);
        return flag != null && flag.get();
    }

    public boolean requestCancel(UUID batchId) {
        AtomicBoolean flag = cancelFlags.get(batchId);
        if (flag == null) {
            return false;
        }
        return flag.compareAndSet(false, true);
    }

    public void setCurrentRunId(UUID batchId, UUID runId) {
        if (runId == null) {
            currentRunIds.remove(batchId);
        } else {
            currentRunIds.put(batchId, runId);
        }
    }

    public UUID getCurrentRunId(UUID batchId) {
        return currentRunIds.get(batchId);
    }

    public SseEmitter registerListener(UUID batchId) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);
        sseListeners.computeIfAbsent(batchId, k -> new CopyOnWriteArrayList<>()).add(emitter);

        Runnable cleanup = () -> {
            CopyOnWriteArrayList<SseEmitter> list = sseListeners.get(batchId);
            if (list != null) {
                list.remove(emitter);
                if (list.isEmpty()) {
                    sseListeners.remove(batchId);
                }
            }
        };

        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(t -> cleanup.run());

        return emitter;
    }

    public void emitEvent(UUID batchId, String eventName, Object data) {
        CopyOnWriteArrayList<SseEmitter> listeners = sseListeners.get(batchId);
        if (listeners == null || listeners.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : listeners) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(data, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                log.debug("Failed to send SSE event {} for batch {}: {}", eventName, batchId, e.getMessage());
            }
        }
    }

    public void completeListeners(UUID batchId) {
        CopyOnWriteArrayList<SseEmitter> listeners = sseListeners.remove(batchId);
        if (listeners == null) {
            return;
        }
        for (SseEmitter emitter : listeners) {
            try {
                emitter.complete();
            } catch (Exception e) {
                log.debug("Failed to complete SSE emitter for batch {}: {}", batchId, e.getMessage());
            }
        }
    }

    public BatchProgressListener createProgressListener(UUID batchId) {
        return new BatchProgressListener() {
            @Override
            public void onBatchStarted(UUID id, int totalSuites) {
                emitEvent(id, "batch-started", Map.of("batchId", id.toString(), "totalSuites", totalSuites));
            }

            @Override
            public void onSuiteStarted(UUID id, UUID suiteId, String suiteName, UUID runId) {
                emitEvent(id, "suite-started", Map.of(
                        "suiteId", suiteId.toString(),
                        "suiteName", suiteName,
                        "runId", runId.toString()));
            }

            @Override
            public void onSuiteCompleted(UUID id, com.orchestrator.dto.SuiteBatchRunResult result) {
                var payload = new java.util.HashMap<String, Object>();
                payload.put("suiteId", result.getSuiteId().toString());
                payload.put("suiteName", result.getSuiteName());
                if (result.getRunId() != null) {
                    payload.put("runId", result.getRunId().toString());
                }
                payload.put("status", result.getStatus());
                if (result.getErrorMessage() != null) {
                    payload.put("errorMessage", result.getErrorMessage());
                }
                emitEvent(id, "suite-completed", payload);
            }

            @Override
            public void onBatchComplete(UUID id, String status, int succeeded, int failed, int totalSuites) {
                emitEvent(id, "batch-complete", Map.of(
                        "batchId", id.toString(),
                        "status", status,
                        "succeeded", succeeded,
                        "failed", failed,
                        "totalSuites", totalSuites));
                completeListeners(id);
            }

            @Override
            public void onBatchError(UUID id, String message) {
                emitEvent(id, "batch-error", Map.of("batchId", id.toString(), "message", message));
                completeListeners(id);
            }
        };
    }
}
