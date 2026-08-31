package com.orchestrator.service;

import com.orchestrator.dto.CollectionRunResponse;
import com.orchestrator.dto.RunRequest;
import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.Environment;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.ScheduleScopeType;
import com.orchestrator.model.enums.TriggerType;
import com.orchestrator.repository.ApiCollectionRepository;
import com.orchestrator.repository.EnvironmentRepository;
import com.orchestrator.repository.ProjectRepository;
import com.orchestrator.repository.RunScheduleRepository;
import com.orchestrator.repository.TestSuiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.TaskScheduler;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CollectionRunServiceTest {

    @Mock ApiCollectionRepository collectionRepository;
    @Mock ProjectRepository projectRepository;
    @Mock TestSuiteRepository suiteRepository;
    @Mock RunService runService;
    @Mock ExecutionService executionService;
    @Mock ScheduleService scheduleService;

    CollectionService collectionService;

    @BeforeEach
    void setUp() {
        collectionService = new CollectionService(
                collectionRepository,
                projectRepository,
                suiteRepository,
                scheduleService);
    }

    @Test
    void runEmptyCollectionReturnsZeroSuites() {
        UUID collectionId = UUID.randomUUID();
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("Empty").build()));
        when(scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId))
                .thenReturn(List.of());
        when(scheduleService.executeSuitesSequentially(List.of(), null, TriggerType.MANUAL, null))
                .thenReturn(List.of());

        CollectionRunResponse response = collectionService.run(collectionId, null);

        assertEquals(collectionId, response.getCollectionId());
        assertEquals("Empty", response.getCollectionName());
        assertEquals(0, response.getTotalSuites());
        assertEquals(0, response.getSucceeded());
        assertEquals(0, response.getFailed());
        assertTrue(response.getResults().isEmpty());
        assertNull(response.getEnvironmentId());
    }

    @Test
    void runMissingCollectionThrowsNotFound() {
        UUID missing = UUID.randomUUID();
        when(collectionRepository.findById(missing)).thenReturn(Optional.empty());

        assertThrows(NotFoundException.class, () -> collectionService.run(missing, null));
    }

    @Test
    void runPassesEnvironmentOverrideAndManualTrigger() {
        UUID collectionId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID suiteId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(suiteId).name("alpha").collectionId(collectionId).build();
        SuiteBatchRunResult batchResult = SuiteBatchRunResult.builder()
                .suiteId(suiteId)
                .suiteName("alpha")
                .runId(UUID.randomUUID())
                .status("SUCCESS")
                .build();

        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("MCP").build()));
        when(scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId))
                .thenReturn(List.of(suite));
        when(scheduleService.executeSuitesSequentially(List.of(suite), envId, TriggerType.MANUAL, null))
                .thenReturn(List.of(batchResult));

        RunRequest request = new RunRequest(envId);
        CollectionRunResponse response = collectionService.run(collectionId, request);

        assertEquals(envId, response.getEnvironmentId());
        assertEquals(1, response.getTotalSuites());
        assertEquals(1, response.getSucceeded());
        assertEquals(0, response.getFailed());
        assertEquals("SUCCESS", response.getResults().getFirst().getStatus());
    }
}

@ExtendWith(MockitoExtension.class)
class ScheduleBatchRunTest {

    @Mock RunScheduleRepository scheduleRepository;
    @Mock TestSuiteRepository suiteRepository;
    @Mock ApiCollectionRepository collectionRepository;
    @Mock ProjectRepository projectRepository;
    @Mock EnvironmentRepository environmentRepository;
    @Mock RunService runService;
    @Mock ExecutionService executionService;
    @Mock TaskScheduler taskScheduler;

    ScheduleService scheduleService;

    @BeforeEach
    void setUp() {
        scheduleService = new ScheduleService(
                scheduleRepository,
                suiteRepository,
                collectionRepository,
                projectRepository,
                environmentRepository,
                runService,
                executionService,
                taskScheduler);
    }

    @Test
    void executeSuitesSequentiallyContinuesAfterFailure() {
        UUID envId = UUID.randomUUID();
        UUID run1 = UUID.randomUUID();
        UUID run2 = UUID.randomUUID();
        UUID run3 = UUID.randomUUID();
        TestSuite s1 = TestSuite.builder().id(UUID.randomUUID()).name("a").build();
        TestSuite s2 = TestSuite.builder().id(UUID.randomUUID()).name("b").build();
        TestSuite s3 = TestSuite.builder().id(UUID.randomUUID()).name("c").build();
        Environment env = Environment.builder().id(envId).name("dev").build();

        when(runService.createRun(s1.getId(), envId, TriggerType.MANUAL, null))
                .thenReturn(TestRun.builder().id(run1).build());
        when(runService.createRun(s2.getId(), envId, TriggerType.MANUAL, null))
                .thenReturn(TestRun.builder().id(run2).build());
        when(runService.createRun(s3.getId(), envId, TriggerType.MANUAL, null))
                .thenReturn(TestRun.builder().id(run3).build());

        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);
        when(executionService.prepareSuiteRun(any(), eq(envId))).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(1).build())
                .thenThrow(new RuntimeException("boom"))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(1).build());

        List<SuiteBatchRunResult> results = scheduleService.executeSuitesSequentially(
                List.of(s1, s2, s3), envId, TriggerType.MANUAL, null);

        assertEquals(3, results.size());
        assertEquals("SUCCESS", results.get(0).getStatus());
        assertEquals("FAILURE", results.get(1).getStatus());
        assertEquals("boom", results.get(1).getErrorMessage());
        assertEquals("SUCCESS", results.get(2).getStatus());

        verify(runService).failRun(run2, "boom");
        verify(runService, never()).failRun(eq(run1), any());
        verify(runService, never()).failRun(eq(run3), any());
    }

    @Test
    void executeSuitesSequentiallyUsesManualTriggerAndNullScheduleId() {
        UUID envId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(UUID.randomUUID()).name("solo").build();
        Environment env = Environment.builder().id(envId).name("dev").build();
        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);

        when(runService.createRun(suite.getId(), envId, TriggerType.MANUAL, null))
                .thenReturn(TestRun.builder().id(runId).build());
        when(executionService.prepareSuiteRun(suite.getId(), envId)).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(0).build());

        scheduleService.executeSuitesSequentially(List.of(suite), envId, TriggerType.MANUAL, null);

        var order = inOrder(runService, executionService);
        order.verify(runService).createRun(suite.getId(), envId, TriggerType.MANUAL, null);
        order.verify(executionService).prepareSuiteRun(suite.getId(), envId);
        order.verify(executionService).executePreparedNonInteractive(prepared);
        order.verify(runService).completeRun(eq(runId), any());
    }

    @Test
    void executeSuitesSequentiallyResolvesPerSuiteEnvironmentWhenOverrideMissing() {
        UUID defaultEnvId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(UUID.randomUUID()).name("solo").build();
        Environment env = Environment.builder().id(defaultEnvId).name("default").build();
        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);

        when(executionService.prepareSuiteRun(suite.getId(), null)).thenReturn(prepared);
        when(runService.createRun(suite.getId(), defaultEnvId, TriggerType.MANUAL, null))
                .thenReturn(TestRun.builder().id(runId).build());
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(0).build());

        scheduleService.executeSuitesSequentially(List.of(suite), null, TriggerType.MANUAL, null);

        var order = inOrder(executionService, runService);
        order.verify(executionService).prepareSuiteRun(suite.getId(), null);
        order.verify(runService).createRun(suite.getId(), defaultEnvId, TriggerType.MANUAL, null);
    }
}
