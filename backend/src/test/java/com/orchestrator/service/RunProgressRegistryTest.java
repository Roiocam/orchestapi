package com.orchestrator.service;

import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RunProgressRegistryTest {

    private RunProgressRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new RunProgressRegistry();
    }

    @Test
    void openEmitAndCompleteLifecycle() {
        UUID runId = UUID.randomUUID();
        assertFalse(registry.hasActiveSession(runId));

        registry.open(runId);
        assertTrue(registry.hasActiveSession(runId));

        StepExecutionResult step = StepExecutionResult.builder()
                .stepId(UUID.randomUUID())
                .stepName("one")
                .status("SUCCESS")
                .durationMs(10)
                .build();
        registry.emitStep(runId, step);

        SuiteExecutionResult result = SuiteExecutionResult.builder()
                .status("SUCCESS")
                .steps(List.of(step))
                .totalDurationMs(10)
                .build();
        registry.complete(runId, result);

        assertFalse(registry.hasActiveSession(runId));
    }

    @Test
    void errorClearsActiveSession() {
        UUID runId = UUID.randomUUID();
        registry.open(runId);
        registry.error(runId, "boom");
        assertFalse(registry.hasActiveSession(runId));
    }

    @Test
    void closeClearsActiveSession() {
        UUID runId = UUID.randomUUID();
        registry.open(runId);
        registry.close(runId);
        assertFalse(registry.hasActiveSession(runId));
    }

    @Test
    void emitWithoutOpenIsNoOp() {
        UUID runId = UUID.randomUUID();
        registry.emitStep(runId, StepExecutionResult.builder()
                .stepId(UUID.randomUUID())
                .stepName("ghost")
                .status("SUCCESS")
                .durationMs(1)
                .build());
        assertFalse(registry.hasActiveSession(runId));
    }
}
