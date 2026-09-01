package com.orchestrator.controller;

import com.orchestrator.dto.DashboardStatsResponse;
import com.orchestrator.dto.PageResponse;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.dto.TestRunResponse;
import com.orchestrator.model.enums.RunStatus;
import com.orchestrator.service.RunProgressRegistry;
import com.orchestrator.service.RunService;
import com.orchestrator.service.ScheduleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/runs")
@RequiredArgsConstructor
@Slf4j
public class RunController {

    private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
            "startedAt", "completedAt", "status", "totalDurationMs", "triggerType", "createdAt");
    private static final int MAX_PAGE_SIZE = 100;

    private final RunService runService;
    private final ScheduleService scheduleService;
    private final RunProgressRegistry runProgressRegistry;

    @GetMapping("/stats")
    public DashboardStatsResponse getStats() {
        return DashboardStatsResponse.builder()
                .totalRuns(runService.countAll())
                .successCount(runService.countByStatus(RunStatus.SUCCESS))
                .failureCount(runService.countByStatus(RunStatus.FAILURE))
                .partialFailureCount(runService.countByStatus(RunStatus.PARTIAL_FAILURE))
                .cancelledCount(runService.countByStatus(RunStatus.CANCELLED))
                .runningCount(runService.countByStatus(RunStatus.RUNNING))
                .activeSchedules(scheduleService.countActive())
                .build();
    }

    @GetMapping
    public PageResponse<TestRunResponse> findAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String suiteName,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID environmentId,
            @RequestParam(required = false) String triggerType,
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
        return runService.findAll(suiteName, status, environmentId, triggerType, from, to,
                PageRequest.of(page, size, sort));
    }

    @GetMapping("/{id}")
    public TestRunResponse findById(@PathVariable UUID id) {
        return runService.findById(id);
    }

    /**
     * Attach to an existing run's step-level progress via SSE.
     * For completed runs, sends a snapshot {@code complete} event immediately.
     */
    @GetMapping(value = "/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID id) {
        TestRunResponse run = runService.findById(id);

        if (!"RUNNING".equals(run.getStatus())) {
            SseEmitter emitter = new SseEmitter(30_000L);
            Thread.ofVirtual().name("sse-run-snapshot-" + id).start(() -> sendCompletedSnapshot(emitter, run));
            return emitter;
        }

        if (runProgressRegistry.hasActiveSession(id)) {
            return runProgressRegistry.registerListener(id);
        }

        // Run is RUNNING but progress session not yet open (race) or lost after restart —
        // open a listener session so the execution thread can fan-out when it starts,
        // and also poll DB as a fallback completion path.
        SseEmitter emitter = runProgressRegistry.registerListener(id);
        Thread.ofVirtual().name("sse-run-watch-" + id).start(() -> watchUntilComplete(id, emitter));
        return emitter;
    }

    private void sendCompletedSnapshot(SseEmitter emitter, TestRunResponse run) {
        try {
            emitter.send(SseEmitter.event()
                    .name("run-started")
                    .data(Map.of("runId", run.getId().toString()), MediaType.APPLICATION_JSON));

            SuiteExecutionResult result = run.getResultData();
            if (result != null) {
                emitter.send(SseEmitter.event()
                        .name("complete")
                        .data(result, MediaType.APPLICATION_JSON));
            } else {
                String message = "CANCELLED".equals(run.getStatus())
                        ? "Run was cancelled"
                        : "No result data available for this run";
                emitter.send(SseEmitter.event()
                        .name("run-error")
                        .data(Map.of("message", message), MediaType.APPLICATION_JSON));
            }
            emitter.complete();
        } catch (Exception e) {
            log.warn("Failed to send run snapshot for {}: {}", run.getId(), e.getMessage());
            emitter.completeWithError(e);
        }
    }

    private void watchUntilComplete(UUID runId, SseEmitter emitter) {
        try {
            for (int i = 0; i < 7200; i++) { // up to ~60 min at 500ms
                Thread.sleep(500);
                if (!runProgressRegistry.hasActiveSession(runId)) {
                    // Session finished via normal complete/error fan-out
                    return;
                }
                TestRunResponse current = runService.findById(runId);
                if (!"RUNNING".equals(current.getStatus())) {
                    if (runProgressRegistry.hasActiveSession(runId)) {
                        SuiteExecutionResult result = current.getResultData();
                        if (result != null) {
                            runProgressRegistry.complete(runId, result);
                        } else {
                            runProgressRegistry.error(runId,
                                    "CANCELLED".equals(current.getStatus())
                                            ? "Run was cancelled"
                                            : "Run finished without result data");
                        }
                    }
                    return;
                }
            }
            runProgressRegistry.error(runId, "Timed out waiting for run progress");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.debug("Run watch ended for {}: {}", runId, e.getMessage());
            try {
                emitter.completeWithError(e);
            } catch (Exception ignored) {
            }
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        runService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/export")
    public ResponseEntity<TestRunResponse> export(@PathVariable UUID id) {
        TestRunResponse run = runService.export(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=run-" + id + ".json")
                .contentType(MediaType.APPLICATION_JSON)
                .body(run);
    }
}
