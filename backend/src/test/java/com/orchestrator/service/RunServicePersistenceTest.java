package com.orchestrator.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orchestrator.dto.StepExecutionResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.enums.RunStatus;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.TestRunRepository;
import com.orchestrator.repository.TestSuiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RunServicePersistenceTest {

    @Mock TestRunRepository repository;
    @Mock TestSuiteRepository suiteRepository;
    @Mock EnvironmentRepository environmentRepository;

    ObjectMapper objectMapper = new ObjectMapper();
    RunService runService;

    @BeforeEach
    void setUp() {
        runService = new RunService(repository, suiteRepository, environmentRepository, objectMapper);
    }

    @Test
    void saveProgressKeepsRunningStatusAndStoresPromptStep() throws Exception {
        UUID runId = UUID.randomUUID();
        TestRun run = running(runId);
        when(repository.findById(runId)).thenReturn(Optional.of(run));
        when(repository.save(run)).thenReturn(run);

        runService.saveProgress(runId, partialWithPrompt());

        assertEquals(RunStatus.RUNNING, run.getStatus());
        assertNotNull(run.getResultData());
        SuiteExecutionResult stored = objectMapper.readValue(run.getResultData(), SuiteExecutionResult.class);
        assertEquals("RUNNING", stored.getStatus());
        assertEquals("prompt", stored.getSteps().get(0).getStepName());
        assertEquals("SUCCESS", stored.getSteps().get(0).getStatus());
    }

    @Test
    void failRunAfterProgressKeepsStepResults() throws Exception {
        UUID runId = UUID.randomUUID();
        TestRun run = running(runId);
        run.setResultData(objectMapper.writeValueAsString(partialWithPrompt()));
        when(repository.findById(runId)).thenReturn(Optional.of(run));
        when(repository.save(run)).thenReturn(run);

        runService.failRun(runId, "Broken pipe");

        assertEquals(RunStatus.FAILURE, run.getStatus());
        SuiteExecutionResult stored = objectMapper.readValue(run.getResultData(), SuiteExecutionResult.class);
        assertEquals("FAILURE", stored.getStatus());
        assertEquals(1, stored.getSteps().size());
        assertEquals("prompt", stored.getSteps().get(0).getStepName());
    }

    @Test
    void failRunDoesNotOverwriteCompletedRun() {
        UUID runId = UUID.randomUUID();
        TestRun run = running(runId);
        run.setStatus(RunStatus.SUCCESS);
        run.setCompletedAt(LocalDateTime.now());
        run.setResultData("{\"status\":\"SUCCESS\",\"steps\":[],\"totalDurationMs\":1}");
        when(repository.findById(runId)).thenReturn(Optional.of(run));

        runService.failRun(runId, "ResponseBodyEmitter has already completed");

        assertEquals(RunStatus.SUCCESS, run.getStatus());
        assertTrue(run.getResultData().contains("SUCCESS"));
        verify(repository).findById(runId);
        verify(repository, org.mockito.Mockito.never()).save(org.mockito.ArgumentMatchers.any());
    }

    private static TestRun running(UUID runId) {
        return TestRun.builder()
                .id(runId)
                .suiteId(UUID.randomUUID())
                .environmentId(UUID.randomUUID())
                .status(RunStatus.RUNNING)
                .startedAt(LocalDateTime.now())
                .build();
    }

    private static SuiteExecutionResult partialWithPrompt() {
        return SuiteExecutionResult.builder()
                .status("RUNNING")
                .totalDurationMs(200L)
                .steps(List.of(StepExecutionResult.builder()
                        .stepId(UUID.randomUUID())
                        .stepName("prompt")
                        .status("SUCCESS")
                        .responseCode(200)
                        .durationMs(200L)
                        .build()))
                .build();
    }
}
