package com.orchestrator.controller;

import com.orchestrator.dto.BatchRunDetailResponse;
import com.orchestrator.dto.BatchRunResponse;
import com.orchestrator.dto.CollectionSuiteRunResult;
import com.orchestrator.dto.PageResponse;
import com.orchestrator.exception.ConflictException;
import com.orchestrator.model.BatchRun;
import com.orchestrator.model.enums.BatchStatus;
import com.orchestrator.service.BatchExecutionRegistry;
import com.orchestrator.service.BatchRunService;
import com.orchestrator.service.RunRegistry;
import com.orchestrator.service.RunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/batches")
@RequiredArgsConstructor
@Slf4j
public class BatchController {

    private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
            "startedAt", "completedAt", "status", "totalSuites", "triggerType", "createdAt");
    private static final int MAX_PAGE_SIZE = 100;

    private final BatchRunService batchRunService;
    private final BatchExecutionRegistry registry;
    private final RunRegistry runRegistry;
    private final RunService runService;

    @GetMapping
    public PageResponse<BatchRunResponse> findAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String triggerType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) LocalDateTime from,
            @RequestParam(required = false) LocalDateTime to,
            @RequestParam(defaultValue = "startedAt") String sortBy,
            @RequestParam(defaultValue = "desc") String sortDir) {
        if (!ALLOWED_SORT_FIELDS.contains(sortBy)) sortBy = "startedAt";
        if (size < 1) size = 10;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;
        if (page < 0) page = 0;
        Sort sort = sortDir.equalsIgnoreCase("asc")
                ? Sort.by(sortBy).ascending()
                : Sort.by(sortBy).descending();
        return batchRunService.findAll(triggerType, status, from, to, PageRequest.of(page, size, sort));
    }

    @GetMapping("/{id}")
    public BatchRunDetailResponse findById(@PathVariable UUID id) {
        return batchRunService.findById(id);
    }

    @GetMapping(value = "/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID id) {
        BatchRunDetailResponse detail = batchRunService.findById(id);
        SseEmitter emitter = registry.registerListener(id);

        if (!BatchStatus.RUNNING.name().equals(detail.getBatch().getStatus())) {
            Thread.ofVirtual().name("sse-batch-snapshot-" + id).start(() -> {
                try {
                    emitter.send(SseEmitter.event()
                            .name("batch-started")
                            .data(Map.of(
                                    "batchId", id.toString(),
                                    "totalSuites", detail.getBatch().getTotalSuites()),
                                    MediaType.APPLICATION_JSON));

                    for (CollectionSuiteRunResult run : detail.getRuns()) {
                        if (run.getRunId() != null) {
                            emitter.send(SseEmitter.event()
                                    .name("suite-completed")
                                    .data(Map.of(
                                            "suiteId", run.getSuiteId().toString(),
                                            "suiteName", run.getSuiteName(),
                                            "runId", run.getRunId().toString(),
                                            "status", run.getStatus()),
                                            MediaType.APPLICATION_JSON));
                        }
                    }

                    emitter.send(SseEmitter.event()
                            .name("batch-complete")
                            .data(Map.of(
                                    "batchId", id.toString(),
                                    "status", detail.getBatch().getStatus(),
                                    "succeeded", detail.getBatch().getSucceeded(),
                                    "failed", detail.getBatch().getFailed(),
                                    "totalSuites", detail.getBatch().getTotalSuites()),
                                    MediaType.APPLICATION_JSON));
                    emitter.complete();
                } catch (Exception e) {
                    log.warn("Failed to send batch snapshot for {}: {}", id, e.getMessage());
                    emitter.completeWithError(e);
                }
            });
        }

        return emitter;
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<BatchRunResponse> cancel(@PathVariable UUID id) {
        BatchRun batch = batchRunService.getEntity(id);
        if (batch.getStatus() != BatchStatus.RUNNING) {
            throw new ConflictException("Batch is not running: " + batch.getStatus());
        }

        registry.requestCancel(id);

        UUID currentRunId = registry.getCurrentRunId(id);
        if (currentRunId != null) {
            runRegistry.cancelRun(currentRunId);
            runService.cancelRun(currentRunId);
        }

        return ResponseEntity.ok(batchRunService.findById(id).getBatch());
    }
}
