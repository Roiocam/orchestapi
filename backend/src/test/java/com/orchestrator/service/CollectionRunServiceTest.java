package com.orchestrator.service;

import com.orchestrator.dto.BatchStartResponse;
import com.orchestrator.dto.RunRequest;
import com.orchestrator.dto.SuiteBatchRunResult;
import com.orchestrator.dto.SuiteExecutionResult;
import com.orchestrator.exception.NotFoundException;
import com.orchestrator.model.ApiCollection;
import com.orchestrator.model.Environment;
import com.orchestrator.model.RunSchedule;
import com.orchestrator.model.TestRun;
import com.orchestrator.model.TestSuite;
import com.orchestrator.model.enums.BatchScopeType;
import com.orchestrator.model.enums.BatchStatus;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.TaskScheduler;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
    @Mock ScheduleService scheduleService;
    @Mock BatchExecutionService batchExecutionService;

    CollectionService collectionService;

    @BeforeEach
    void setUp() {
        collectionService = new CollectionService(
                collectionRepository,
                projectRepository,
                suiteRepository,
                scheduleService,
                batchExecutionService);
    }

    @Test
    void runEmptyCollectionReturnsBatchId() {
        UUID collectionId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("Empty").build()));
        when(scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId))
                .thenReturn(List.of());
        when(batchExecutionService.createAndStartCollectionBatch(collectionId, "Empty", null, List.of()))
                .thenReturn(batchId);

        BatchStartResponse response = collectionService.run(collectionId, null);

        assertEquals(batchId, response.getBatchId());
        verify(batchExecutionService).createAndStartCollectionBatch(collectionId, "Empty", null, List.of());
    }

    @Test
    void runMissingCollectionThrowsNotFound() {
        UUID missing = UUID.randomUUID();
        when(collectionRepository.findById(missing)).thenReturn(Optional.empty());

        assertThrows(NotFoundException.class, () -> collectionService.run(missing, null));
    }

    @Test
    void runPassesEnvironmentOverrideAndStartsAsyncBatch() {
        UUID collectionId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        UUID suiteId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(suiteId).name("alpha").collectionId(collectionId).build();

        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("MCP").build()));
        when(scheduleService.resolveTargetSuites(ScheduleScopeType.COLLECTION, collectionId))
                .thenReturn(List.of(suite));
        when(batchExecutionService.createAndStartCollectionBatch(collectionId, "MCP", envId, List.of(suite)))
                .thenReturn(batchId);

        RunRequest request = new RunRequest(envId);
        BatchStartResponse response = collectionService.run(collectionId, request);

        assertEquals(batchId, response.getBatchId());
        verify(batchExecutionService).createAndStartCollectionBatch(collectionId, "MCP", envId, List.of(suite));
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
    @Mock BatchExecutionService batchExecutionService;

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
                taskScheduler,
                batchExecutionService);
    }

    @Test
    void executeSuitesSequentiallyContinuesAfterFailure() {
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        UUID run1 = UUID.randomUUID();
        UUID run2 = UUID.randomUUID();
        UUID run3 = UUID.randomUUID();
        TestSuite s1 = TestSuite.builder().id(UUID.randomUUID()).name("a").build();
        TestSuite s2 = TestSuite.builder().id(UUID.randomUUID()).name("b").build();
        TestSuite s3 = TestSuite.builder().id(UUID.randomUUID()).name("c").build();
        Environment env = Environment.builder().id(envId).name("dev").build();

        when(runService.createRun(s1.getId(), envId, TriggerType.MANUAL, null, batchId))
                .thenReturn(TestRun.builder().id(run1).build());
        when(runService.createRun(s2.getId(), envId, TriggerType.MANUAL, null, batchId))
                .thenReturn(TestRun.builder().id(run2).build());
        when(runService.createRun(s3.getId(), envId, TriggerType.MANUAL, null, batchId))
                .thenReturn(TestRun.builder().id(run3).build());

        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);
        when(executionService.prepareSuiteRun(any(), eq(envId))).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(1).build())
                .thenThrow(new RuntimeException("boom"))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(1).build());

        List<SuiteBatchRunResult> results = scheduleService.executeSuitesSequentially(
                List.of(s1, s2, s3), envId, TriggerType.MANUAL, null, batchId, null, null, null);

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
    void executeSuitesSequentiallyStopsWhenCancelRequested() {
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        UUID run1 = UUID.randomUUID();
        TestSuite s1 = TestSuite.builder().id(UUID.randomUUID()).name("a").build();
        TestSuite s2 = TestSuite.builder().id(UUID.randomUUID()).name("b").build();
        Environment env = Environment.builder().id(envId).name("dev").build();

        when(runService.createRun(s1.getId(), envId, TriggerType.MANUAL, null, batchId))
                .thenReturn(TestRun.builder().id(run1).build());

        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);
        when(executionService.prepareSuiteRun(any(), eq(envId))).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(1).build());

        java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger(0);
        List<SuiteBatchRunResult> results = scheduleService.executeSuitesSequentially(
                List.of(s1, s2), envId, TriggerType.MANUAL, null, batchId,
                () -> checks.incrementAndGet() > 2, null, null);

        assertEquals(1, results.size());
        verify(runService).createRun(s1.getId(), envId, TriggerType.MANUAL, null, batchId);
        verify(runService, never()).createRun(s2.getId(), envId, TriggerType.MANUAL, null, batchId);
    }

    @Test
    void executeSuitesSequentiallyUsesManualTriggerAndNullScheduleId() {
        UUID envId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(UUID.randomUUID()).name("solo").build();
        Environment env = Environment.builder().id(envId).name("dev").build();
        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);

        when(runService.createRun(suite.getId(), envId, TriggerType.MANUAL, null, null))
                .thenReturn(TestRun.builder().id(runId).build());
        when(executionService.prepareSuiteRun(suite.getId(), envId)).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(0).build());

        scheduleService.executeSuitesSequentially(List.of(suite), envId, TriggerType.MANUAL, null);

        var order = inOrder(runService, executionService);
        order.verify(runService).createRun(suite.getId(), envId, TriggerType.MANUAL, null, null);
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
        when(runService.createRun(suite.getId(), defaultEnvId, TriggerType.MANUAL, null, null))
                .thenReturn(TestRun.builder().id(runId).build());
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(0).build());

        scheduleService.executeSuitesSequentially(List.of(suite), null, TriggerType.MANUAL, null);

        var order = inOrder(executionService, runService);
        order.verify(executionService).prepareSuiteRun(suite.getId(), null);
        order.verify(runService).createRun(suite.getId(), defaultEnvId, TriggerType.MANUAL, null, null);
    }

    @Test
    void scheduledCollectionRunCreatesBatch() {
        UUID scheduleId = UUID.randomUUID();
        UUID collectionId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(UUID.randomUUID()).name("alpha").collectionId(collectionId).build();

        RunSchedule schedule = RunSchedule.builder()
                .id(scheduleId)
                .scopeType(ScheduleScopeType.COLLECTION)
                .scopeId(collectionId)
                .environmentId(envId)
                .cronExpression("0 0 * * * *")
                .active(true)
                .build();

        when(scheduleRepository.findById(scheduleId)).thenReturn(Optional.of(schedule));
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("MCP").build()));
        when(suiteRepository.findByCollectionIdOrderByNameAsc(collectionId)).thenReturn(List.of(suite));
        when(batchExecutionService.createScheduledBatch(
                BatchScopeType.COLLECTION, collectionId, "MCP", envId, scheduleId, List.of(suite)))
                .thenReturn(batchId);

        scheduleService.executeScheduledRun(scheduleId);

        verify(batchExecutionService).createScheduledBatch(
                BatchScopeType.COLLECTION, collectionId, "MCP", envId, scheduleId, List.of(suite));
        verify(batchExecutionService).executeBatch(batchId, List.of(suite), envId, TriggerType.SCHEDULED, scheduleId);
        verify(batchExecutionService, never()).executeEmptyBatch(any());
    }

    @Test
    void scheduledSuiteRunDoesNotCreateBatch() {
        UUID scheduleId = UUID.randomUUID();
        UUID suiteId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        TestSuite suite = TestSuite.builder().id(suiteId).name("solo").build();
        Environment env = Environment.builder().id(envId).name("dev").build();

        RunSchedule schedule = RunSchedule.builder()
                .id(scheduleId)
                .scopeType(ScheduleScopeType.SUITE)
                .scopeId(suiteId)
                .suiteId(suiteId)
                .environmentId(envId)
                .cronExpression("0 0 * * * *")
                .active(true)
                .build();

        when(scheduleRepository.findById(scheduleId)).thenReturn(Optional.of(schedule));
        when(suiteRepository.findById(suiteId)).thenReturn(Optional.of(suite));
        when(runService.createRun(suiteId, envId, TriggerType.SCHEDULED, scheduleId, null))
                .thenReturn(TestRun.builder().id(runId).build());
        ExecutionService.PreparedExecution prepared =
                new ExecutionService.PreparedExecution(List.of(), java.util.Map.of(), env, null);
        when(executionService.prepareSuiteRun(suiteId, envId)).thenReturn(prepared);
        when(executionService.executePreparedNonInteractive(prepared))
                .thenReturn(SuiteExecutionResult.builder().status("SUCCESS").totalDurationMs(0).build());

        scheduleService.executeScheduledRun(scheduleId);

        verify(batchExecutionService, never()).createScheduledBatch(any(), any(), any(), any(), any(), any());
        verify(runService).createRun(suiteId, envId, TriggerType.SCHEDULED, scheduleId, null);
    }

    @Test
    void scheduledEmptyCollectionCreatesEmptyBatch() {
        UUID scheduleId = UUID.randomUUID();
        UUID collectionId = UUID.randomUUID();
        UUID envId = UUID.randomUUID();
        UUID batchId = UUID.randomUUID();

        RunSchedule schedule = RunSchedule.builder()
                .id(scheduleId)
                .scopeType(ScheduleScopeType.COLLECTION)
                .scopeId(collectionId)
                .environmentId(envId)
                .cronExpression("0 0 * * * *")
                .active(true)
                .build();

        when(scheduleRepository.findById(scheduleId)).thenReturn(Optional.of(schedule));
        when(collectionRepository.findById(collectionId))
                .thenReturn(Optional.of(ApiCollection.builder().id(collectionId).name("Empty").build()));
        when(suiteRepository.findByCollectionIdOrderByNameAsc(collectionId)).thenReturn(List.of());
        when(batchExecutionService.createScheduledBatch(
                BatchScopeType.COLLECTION, collectionId, "Empty", envId, scheduleId, List.of()))
                .thenReturn(batchId);

        scheduleService.executeScheduledRun(scheduleId);

        verify(batchExecutionService).createScheduledBatch(
                BatchScopeType.COLLECTION, collectionId, "Empty", envId, scheduleId, List.of());
        verify(batchExecutionService).executeEmptyBatch(batchId);
        verify(batchExecutionService, never()).executeBatch(any(), any(), any(), any(), any());
    }

    @Test
    void resolveBatchStatusMapsOutcomes() {
        List<SuiteBatchRunResult> allSuccess = List.of(
                SuiteBatchRunResult.builder().status("SUCCESS").build(),
                SuiteBatchRunResult.builder().status("SUCCESS").build());
        assertEquals(BatchStatus.SUCCESS, BatchExecutionService.resolveBatchStatus(allSuccess, false));

        List<SuiteBatchRunResult> mixed = List.of(
                SuiteBatchRunResult.builder().status("SUCCESS").build(),
                SuiteBatchRunResult.builder().status("FAILURE").build());
        assertEquals(BatchStatus.PARTIAL_FAILURE, BatchExecutionService.resolveBatchStatus(mixed, false));

        List<SuiteBatchRunResult> allFail = List.of(
                SuiteBatchRunResult.builder().status("FAILURE").build());
        assertEquals(BatchStatus.FAILURE, BatchExecutionService.resolveBatchStatus(allFail, false));

        assertEquals(BatchStatus.CANCELLED, BatchExecutionService.resolveBatchStatus(mixed, true));
    }
}
