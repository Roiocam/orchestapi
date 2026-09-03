package com.orchestrator.controller;

import com.orchestrator.dto.ManualInputRequest;
import com.orchestrator.dto.RunRequest;
import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.enums.TriggerType;
import com.orchestrator.service.ExecutionService;
import com.orchestrator.service.RunRegistry;
import com.orchestrator.service.RunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/test-suites/{suiteId}")
@RequiredArgsConstructor
@Slf4j
public class ExecutionController {

    private final ExecutionService executionService;
    private final RunRegistry runRegistry;
    private final RunService runService;

    @PostMapping("/run")
    public SuiteExecutionResult runSuite(@PathVariable UUID suiteId,
                                          @RequestBody(required = false) RunRequest request) {
        UUID envId = request != null ? request.getEnvironmentId() : null;

        // Prepare to resolve effective environment
        ExecutionService.PreparedExecution prepared = executionService.prepareSuiteRun(suiteId, envId);
        UUID effectiveEnvId = prepared.env().getId();

        // Persist run
        TestRun testRun = runService.createRun(suiteId, effectiveEnvId, TriggerType.MANUAL, null);
        UUID runId = testRun.getId();

        try {
            SuiteExecutionResult result = executionService.runSuite(suiteId, envId);
            runService.completeRun(runId, result);
            return result;
        } catch (Exception e) {
            runService.failRun(runId, e.getMessage());
            throw e;
        }
    }

    @PostMapping("/steps/{stepId}/run")
    public SuiteExecutionResult runStep(@PathVariable UUID suiteId,
                                         @PathVariable UUID stepId,
                                         @RequestBody(required = false) RunRequest request) {
        UUID envId = request != null ? request.getEnvironmentId() : null;

        // Prepare to resolve effective environment
        ExecutionService.PreparedExecution prepared = executionService.prepareStepRun(suiteId, stepId, envId);
        UUID effectiveEnvId = prepared.env().getId();

        // Persist run
        TestRun testRun = runService.createRun(suiteId, effectiveEnvId, TriggerType.MANUAL, null);
        UUID runId = testRun.getId();

        try {
            SuiteExecutionResult result = executionService.runStep(suiteId, stepId, envId);
            runService.completeRun(runId, result);
            return result;
        } catch (Exception e) {
            runService.failRun(runId, e.getMessage());
            throw e;
        }
    }

    @PostMapping("/run/{runId}/inputs")
    public ResponseEntity<Void> submitManualInput(@PathVariable UUID suiteId,
                                                   @PathVariable UUID runId,
                                                   @RequestBody ManualInputRequest request) {
        runRegistry.submitInput(runId, request.getValues());
        return ResponseEntity.ok().build();
    }

    @PostMapping("/run/{runId}/cancel")
    public ResponseEntity<Void> cancelRun(@PathVariable UUID suiteId,
                                           @PathVariable UUID runId) {
        runRegistry.cancelRun(runId);
        return ResponseEntity.ok().build();
    }

    // ── SSE streaming endpoints ─────────────────────────────────────────

    @GetMapping(value = "/run/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamSuiteRun(@PathVariable UUID suiteId,
                                      @RequestParam(required = false) UUID environmentId) {
        SseEmitter emitter = new SseEmitter(3_600_000L); // 60 min timeout

        // Load all data inside transaction
        ExecutionService.PreparedExecution prepared = executionService.prepareSuiteRun(suiteId, environmentId);
        UUID effectiveEnvId = prepared.env().getId();

        // Persist run to DB
        TestRun testRun = runService.createRun(suiteId, effectiveEnvId, TriggerType.MANUAL, null);
        UUID runId = testRun.getId();

        // Register this run with the persisted ID
        runRegistry.registerRun(runId, emitter);

        // Cancel run if SSE connection times out or client disconnects
        emitter.onTimeout(() -> runRegistry.cancelRun(runId));
        emitter.onCompletion(() -> runRegistry.unregisterRun(runId));

        Thread.ofVirtual().name("sse-suite-" + suiteId).start(() -> {
            runStreamingExecution(emitter, prepared, runId);
        });

        return emitter;
    }

    @GetMapping(value = "/steps/{stepId}/run/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamStepRun(@PathVariable UUID suiteId,
                                     @PathVariable UUID stepId,
                                     @RequestParam(required = false) UUID environmentId) {
        SseEmitter emitter = new SseEmitter(300_000L);

        // Load all data inside transaction
        ExecutionService.PreparedExecution prepared = executionService.prepareStepRun(suiteId, stepId, environmentId);
        UUID effectiveEnvId = prepared.env().getId();

        // Persist run to DB
        TestRun testRun = runService.createRun(suiteId, effectiveEnvId, TriggerType.MANUAL, null);
        UUID runId = testRun.getId();

        // Register this run with the persisted ID
        runRegistry.registerRun(runId, emitter);

        // Cancel run if SSE connection times out or client disconnects
        emitter.onTimeout(() -> runRegistry.cancelRun(runId));
        emitter.onCompletion(() -> runRegistry.unregisterRun(runId));

        Thread.ofVirtual().name("sse-step-" + stepId).start(() -> {
            runStreamingExecution(emitter, prepared, runId);
        });

        return emitter;
    }

    /**
     * Execution results are persisted independently of the SSE socket.
     * A client disconnect (Broken pipe / already-completed emitter) must not
     * fail the run or wipe step results from history.
     */
    private void runStreamingExecution(SseEmitter emitter,
                                       ExecutionService.PreparedExecution prepared,
                                       UUID runId) {
        List<StepExecutionResult> persistedSteps = new ArrayList<>();
        try {
            sendSse(emitter, "run-started", Map.of("runId", runId.toString()));

            SuiteExecutionResult finalResult = executionService.executePrepared(prepared, stepResult -> {
                persistedSteps.add(stepResult);
                runService.saveProgress(runId, SuiteExecutionResult.builder()
                        .status("RUNNING")
                        .steps(List.copyOf(persistedSteps))
                        .totalDurationMs(persistedSteps.stream()
                                .mapToLong(StepExecutionResult::getDurationMs)
                                .sum())
                        .build());
                sendSse(emitter, "step", stepResult);
            }, runId, runRegistry, emitter);

            runService.completeRun(runId, finalResult);
            sendSse(emitter, "complete", finalResult);
            completeQuietly(emitter);
        } catch (Exception e) {
            runService.failRun(runId, e.getMessage());
            sendSse(emitter, "run-error",
                    Map.of("message", e.getMessage() != null ? e.getMessage() : "Unknown error"));
            completeQuietly(emitter);
        } finally {
            runRegistry.unregisterRun(runId);
        }
    }

    private void sendSse(SseEmitter emitter, String eventName, Object data) {
        try {
            emitter.send(SseEmitter.event()
                    .name(eventName)
                    .data(data, MediaType.APPLICATION_JSON));
        } catch (Exception e) {
            log.warn("SSE {} event not delivered (client likely disconnected): {}", eventName, e.getMessage());
        }
    }

    private void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception e) {
            log.debug("SSE emitter already completed: {}", e.getMessage());
        }
    }
}
